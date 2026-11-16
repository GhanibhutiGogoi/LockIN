import './style.css';
import { DwellRule, fitEnvelope, outsideEvidence, type Envelope, type RuleState } from './rules';
import { StudyUI } from './study-ui';
import { usableFrame } from './core/frame-time';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const video = $<HTMLVideoElement>('camera');
const startButton = $<HTMLButtonElement>('start');
const stopButton = $<HTMLButtonElement>('stop');
const calibrationButton = $<HTMLButtonElement>('calibrate');
const dot = $('gaze-dot');
const toleranceInput = $<HTMLInputElement>('tolerance');
const durationInput = $<HTMLInputElement>('duration');
const showDotInput = $<HTMLInputElement>('show-dot');
const overlay = $('calibration');
const canvas = document.createElement('canvas');
canvas.width = 640; canvas.height = 480;
const context = canvas.getContext('2d', { willReadFrequently: true })!;
const dwell = new DwellRule();

let stream: MediaStream | null = null;
let worker: Worker | null = null;
let workerReady = false;
let workerBusy = false;
let running = false;
let starting = false;
let generation = 0;
let lastFrame = 0;
let lastVideoTime = -1;
let lastResult = 0;
let lastCapture = -Infinity;
let raf = 0;
let envelope: Envelope | null = null;
let calibration: 'idle' | 'points' | 'fitting' | 'validation' = 'idle';
let firstValidSeen = false;
let pointIndex = 0;
let pointTimer: ReturnType<typeof setTimeout> | null = null;
let calibrationSize = [0, 0];
let validationErrors: number[] = [];
let latestGaze: number[] | null = null;
let frames = 0;
let fpsStart = 0;
const study = new StudyUI({ stopTracking: () => stop() });

const targets = [[0, 0], [-.42, -.4], [0, -.4], [.42, -.4], [.42, 0], [.42, .4], [0, .4], [-.42, .4], [-.42, 0]];
const validationTargets = [[-.23, -.19], [.24, .21], [0, 0]];

function notice(message: string, error = false) {
  $('notice').textContent = message;
  $('notice').hidden = !message;
  $('notice').classList.toggle('error', error);
}

function setState(state: RuleState, title: string, detail: string) {
  $('state').dataset.state = state;
  $('state-label').textContent = title;
  $('state-detail').textContent = detail;
}

function displayUnknown(detail: string) {
  study.invalidate();
  dwell.update(performance.now(), null, Number(durationInput.value));
  setState('unknown', '无法判断', detail);
  $('dwell-progress').style.width = '0%';
  $('dwell-value').textContent = `0.0 / ${Number(durationInput.value).toFixed(1)} s`;
  dot.hidden = true;
}

function showGaze() {
  dot.hidden = !latestGaze || !showDotInput.checked || calibration !== 'idle' || !envelope;
  if (latestGaze) {
    dot.style.left = `${(latestGaze[0] + .5) * innerWidth}px`;
    dot.style.top = `${(latestGaze[1] + .5) * innerHeight}px`;
  }
}

function beginPoint() {
  if (pointTimer) clearTimeout(pointTimer);
  const validation = calibration === 'validation';
  const points = validation ? validationTargets : targets;
  const p = points[pointIndex];
  const target = $('calibration-target');
  target.hidden = false;
  target.style.left = `${(p[0] + .5) * 100}%`;
  target.style.top = `${(p[1] + .5) * 100}%`;
  document.querySelector<HTMLElement>('.calibration-copy')!.style.top = Math.abs(p[1]) < .15 ? '23%' : '50%';
  $('calibration-phase').textContent = validation ? '独立位置验证' : '个人校准';
  $('calibration-title').textContent = validation ? '再看三个点，检查一下误差。' : '看着圆点，保持自然坐姿。';
  $('calibration-description').textContent = '不需要点击圆点；保持注视，采集完成后自动移动。';
  $('point-steps').innerHTML = points.map((_, i) => `<span class="${i < pointIndex ? 'done' : i === pointIndex ? 'current' : ''}"></span>`).join('');
  $('calibration-count').textContent = `${pointIndex + 1} / ${points.length} · 等待眼睛张开、脸部清晰`;
  worker!.postMessage({ type: 'point', point: { index: pointIndex, x: p[0], y: p[1], validation } });
  pointTimer = setTimeout(() => cancelCalibration('当前点没有收集到足够有效数据。请正对摄像头、改善光线后重新校准。'), 15000);
}

function cancelCalibration(message = '校准已取消。点击「开始校准」可以重新尝试。') {
  if (pointTimer) clearTimeout(pointTimer);
  pointTimer = null;
  worker?.postMessage({ type: 'cancelPoint' });
  calibration = 'idle';
  overlay.hidden = true;
  envelope = null;
  calibrationButton.disabled = !workerReady;
  calibrationButton.innerHTML = '开始校准 <span>◎</span>';
  $('accuracy-value').textContent = '尚未校准';
  notice(message);
  displayUnknown('尚未完成校准。');
}

function handleWorker(data: any) {
  if (data.type === 'loading') {
    setState('unknown', '加载模型中', data.message);
  } else if (data.type === 'result') {
    workerBusy = false;
    const receivedAt = performance.now();
    if (!usableFrame(data.capturedAt, receivedAt, lastCapture)) {
      latestGaze = null;
      displayUnknown('刚返回的帧已过期，等待新画面。');
      return;
    }
    lastCapture = data.capturedAt;
    lastResult = receivedAt;
    frames++;
    if (lastResult - fpsStart >= 1000) {
      $('fps').textContent = `${(frames * 1000 / (lastResult - fpsStart)).toFixed(1)} FPS`;
      frames = 0; fpsStart = lastResult;
    }
    $('face-value').textContent = `${data.face ? '已检测' : '未检测'} / ${data.face ? data.eyesOpen ? '张开' : '闭合' : '—'}`;
    $('head-value').textContent = data.features ? `${data.features[0].toFixed(2)} / ${data.features[1].toFixed(2)}` : '— / —';
    latestGaze = data.gaze;
    $('coordinate').textContent = latestGaze ? `X ${latestGaze[0].toFixed(2)}  Y ${latestGaze[1].toFixed(2)}` : 'X —  Y —';
    if (calibration !== 'idle') { dot.hidden = true; return; }
    if (!envelope) {
      if (data.features && data.gaze) {
        calibrationButton.disabled = false;
        if (!firstValidSeen) {
          firstValidSeen = true;
          notice('模型已返回有效 gaze 数据。请保持正常坐姿，点击「开始校准」。');
        }
        setState('unknown', '等待校准', '点击「开始校准」，建立你的屏内参考范围。');
      } else {
        setState('unknown', '等待有效画面', '请正对摄像头、睁开眼睛，并保持脸部清晰。');
      }
      dot.hidden = true; return;
    }
    if (!data.features || !data.gaze) {
      displayUnknown(data.face ? '眼睛闭合或眼部数据不可靠。' : '没有检测到清晰的脸部。');
      return;
    }
    const outside = outsideEvidence(data.features, envelope, Number(toleranceInput.value));
    study.observe({ t: data.capturedAt, valid: true, onScreen: !outside, gaze: data.gaze, features: data.features });
    const result = dwell.update(lastResult, outside, Number(durationInput.value));
    const labels: Record<RuleState, [string, string]> = {
      unknown: ['无法判断', '等待有效跟踪数据。'],
      screen: ['看向屏幕', '眼部与头部特征处于个人屏内参考范围。'],
      candidate: ['疑似屏外', '已超出校准范围，正在累计持续时间。'],
      away: ['看向屏幕外', '规则判定：持续超出个人屏内参考范围。'],
      recovering: ['正在看回来', '特征已回到范围，等待持续 1 秒确认。'],
    };
    setState(result.state, ...labels[result.state]);
    $('dwell-progress').style.width = `${result.progress * 100}%`;
    $('dwell-value').textContent = `${(result.awayMs / 1000).toFixed(1)} / ${Number(durationInput.value).toFixed(1)} s`;
    showGaze();
  } else if (data.type === 'pointProgress') {
    if (calibration !== 'points' && calibration !== 'validation') return;
    const count = calibration === 'validation' ? validationTargets.length : targets.length;
    $('calibration-count').textContent = `${pointIndex + 1} / ${count} · 已采集 ${data.count} / 7`;
  } else if (data.type === 'pointDone') {
    if (calibration !== 'points' && calibration !== 'validation') return;
    if (data.index !== pointIndex) return;
    if (pointTimer) clearTimeout(pointTimer);
    if (data.validation) {
      const dx = (data.predicted[0] - data.target[0]) * innerWidth;
      const dy = (data.predicted[1] - data.target[1]) * innerHeight;
      validationErrors.push(Math.hypot(dx, dy) / Math.hypot(innerWidth, innerHeight));
    }
    pointIndex++;
    const count = calibration === 'validation' ? validationTargets.length : targets.length;
    if (pointIndex < count) { beginPoint(); return; }
    if (calibration === 'points') {
      calibration = 'fitting';
      workerBusy = true;
      $('calibration-target').hidden = true;
      $('calibration-title').textContent = '正在修正注视坐标…';
      $('calibration-count').textContent = '保持窗口大小不变';
      worker!.postMessage({ type: 'fit' });
    } else {
      calibration = 'idle';
      overlay.hidden = true;
      calibrationButton.disabled = false;
      calibrationButton.innerHTML = '重新校准 <span>◎</span>';
      const mean = validationErrors.reduce((a, b) => a + b, 0) / validationErrors.length;
      $('accuracy-value').textContent = `对角线 ${(mean * 100).toFixed(1)}%`;
      notice(mean > .12 ? '校准完成，但注视坐标误差较大。可以先观察屏外规则；如蓝点偏离明显，请改善光线、坐正后重新校准。' : '校准完成。先看屏幕四角，再转头或低头，观察状态；规则误报时可以调大「几何容差」。');
      dwell.reset();
    }
  } else if (data.type === 'fitted') {
    if (calibration !== 'fitting') return;
    workerBusy = false;
    envelope = fitEnvelope(data.baseline);
    calibration = 'validation';
    pointIndex = 0;
    validationErrors = [];
    beginPoint();
  } else if (data.type === 'idle') {
    workerBusy = false;
  } else if (data.type === 'error') {
    if (calibration !== 'idle') cancelCalibration(`校准失败：${data.message}`);
    else displayUnknown('模型处理失败，请停止后重新启动。');
    notice(`模型错误：${data.message}`, true);
    workerBusy = false;
  }
}

function createWorker(): Promise<void> {
  workerReady = false; workerBusy = true;
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('gaze-worker.js', document.baseURI));
    worker = w;
    const timer = setTimeout(() => reject(new Error('模型加载超时。请刷新重试，并检查浏览器是否支持 WebGL / WebAssembly。')), 60000);
    w.onmessage = ({ data }) => {
      if (w !== worker) return;
      if (data.type === 'ready') {
        clearTimeout(timer);
        workerReady = true; workerBusy = false;
        $('backend').textContent = `/ ${data.backend.toUpperCase()}`;
        resolve();
      } else if (data.type === 'error' && !workerReady) {
        clearTimeout(timer); reject(new Error(data.message));
      } else handleWorker(data);
    };
    w.onerror = event => { clearTimeout(timer); reject(new Error(event.message || '浏览器无法启动模型线程')); if (workerReady) { stop(); notice('模型线程异常，请重新启用摄像头。', true); } };
    w.postMessage({ type: 'init', baseUrl: new URL('.', document.baseURI).href });
  });
}

function frameLoop(now: number) {
  if (!running) return;
  if (workerReady && !workerBusy && now - lastFrame >= 100 && video.readyState >= 2 && !video.paused && !video.ended && video.currentTime !== lastVideoTime && calibration !== 'fitting') {
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    workerBusy = true; lastFrame = now; lastVideoTime = video.currentTime;
    worker!.postMessage({ type: 'frame', buffer: image.data.buffer, width: canvas.width, height: canvas.height, timestamp: now }, [image.data.buffer]);
  }
  if (workerReady && lastResult > 0 && now - lastResult > 1500 && calibration === 'idle') displayUnknown('跟踪数据中断，等待恢复。');
  raf = requestAnimationFrame(frameLoop);
}

async function start() {
  if (starting || running) return;
  const id = ++generation;
  starting = true;
  startButton.disabled = true; stopButton.disabled = false;
  notice('请允许访问摄像头。首次启动需要加载本地模型，可能需要十几秒。');
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('摄像头需要 localhost 或 HTTPS，请通过本地服务打开本页。');
    const acquired = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false });
    if (id !== generation) { acquired.getTracks().forEach(t => t.stop()); return; }
    stream = acquired;
    acquired.getVideoTracks().forEach(track => track.addEventListener('ended', () => {
      if (stream === acquired) { stop(); notice('摄像头连接已中断，请重新启用。', true); }
    }));
    video.srcObject = stream;
    await video.play();
    if (id !== generation) return;
    if (video.videoWidth && video.videoHeight) {
      canvas.width = 640;
      canvas.height = Math.round(640 * video.videoHeight / video.videoWidth);
    }
    $('camera-placeholder').hidden = true;
    $('camera-led').classList.add('active');
    running = true;
    fpsStart = performance.now();
    raf = requestAnimationFrame(frameLoop);
    await createWorker();
    if (id !== generation) return;
    setState('unknown', '正在预热', '正在处理首帧，首次推理可能需要十几秒。');
    notice('摄像头与模型已加载，正在等待首帧有效 gaze 数据。首次推理可能需要十几秒，之后会明显加快。');
  } catch (e) {
    if (id !== generation) return;
    const name = e instanceof Error ? e.name : '';
    const message = name === 'NotAllowedError' ? '摄像头权限未获允许。请在浏览器地址栏允许摄像头，然后重试。' : name === 'NotFoundError' ? '没有找到摄像头，请连接摄像头后重试。' : e instanceof Error ? e.message : String(e);
    stop(); notice(message, true);
  } finally { if (id === generation) starting = false; }
}

function stop() {
  study.end('camera-stopped');
  generation++;
  running = false; starting = false;
  cancelAnimationFrame(raf);
  if (pointTimer) clearTimeout(pointTimer);
  pointTimer = null;
  worker?.terminate(); worker = null;
  workerReady = false; workerBusy = false;
  stream?.getTracks().forEach(t => t.stop()); stream = null;
  video.srcObject = null;
  envelope = null; calibration = 'idle'; firstValidSeen = false;
  latestGaze = null; lastResult = 0; lastFrame = 0; lastCapture = -Infinity; lastVideoTime = -1; frames = 0;
  dwell.reset();
  overlay.hidden = true; dot.hidden = true;
  startButton.disabled = false; stopButton.disabled = true; calibrationButton.disabled = true;
  calibrationButton.innerHTML = '开始校准 <span>◎</span>';
  $('camera-placeholder').hidden = false;
  $('camera-led').classList.remove('active');
  $('backend').textContent = '/ OFF'; $('fps').textContent = '— FPS';
  $('face-value').textContent = '— / —'; $('head-value').textContent = '— / —';
  $('accuracy-value').textContent = '尚未校准'; $('coordinate').textContent = 'X —  Y —';
  $('dwell-progress').style.width = '0%';
  setState('unknown', '已停止', '摄像头已关闭；本次个人校准数据已清除。');
}

async function startCalibration() {
  if (!running || !workerReady || calibration !== 'idle') return;
  calibrationButton.disabled = true;
  envelope = null; dot.hidden = true;
  dwell.reset();
  worker!.postMessage({ type: 'reset' });
  if (!running) return;
  notice('');
  calibration = 'points'; pointIndex = 0;
  calibrationSize = [innerWidth, innerHeight];
  overlay.hidden = false;
  beginPoint();
}

startButton.addEventListener('click', start);
stopButton.addEventListener('click', () => { stop(); notice('摄像头已停止。再次启用时需要重新校准。'); });
calibrationButton.addEventListener('click', startCalibration);
$('cancel-calibration').addEventListener('click', () => cancelCalibration());
showDotInput.addEventListener('change', showGaze);
for (const input of [toleranceInput, durationInput]) input.addEventListener('input', () => {
  $('tolerance-label').textContent = `${Number(toleranceInput.value).toFixed(2)}×`;
  $('duration-label').textContent = `${Number(durationInput.value).toFixed(1)} s`;
  $('dwell-value').textContent = `0.0 / ${Number(durationInput.value).toFixed(1)} s`;
  dwell.reset();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { latestGaze = null; displayUnknown('页面在后台，暂停判断。'); }
});
window.addEventListener('resize', () => {
  if ((envelope || calibration !== 'idle') && (Math.abs(innerWidth - calibrationSize[0]) > 3 || Math.abs(innerHeight - calibrationSize[1]) > 3)) {
    cancelCalibration('窗口尺寸发生变化，请重新校准，以免注视坐标失准。');
  }
});
window.addEventListener('pagehide', stop);

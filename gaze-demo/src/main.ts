import './style.css';
import { DwellRule, fitEnvelope, attentionEvidence, ScreenEvidence, type Envelope, type RuleState } from './rules';
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
const screenEvidence = new ScreenEvidence();

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
  screenEvidence.reset();
  study.invalidate();
  dwell.update(performance.now(), null, Number(durationInput.value));
  setState('unknown', 'Tracking unavailable', detail);
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
  screenEvidence.reset();
  if (pointTimer) clearTimeout(pointTimer);
  const validation = calibration === 'validation';
  const points = validation ? validationTargets : targets;
  const p = points[pointIndex];
  const target = $('calibration-target');
  target.hidden = false;
  target.style.left = `${(p[0] + .5) * 100}%`;
  target.style.top = `${(p[1] + .5) * 100}%`;
  document.querySelector<HTMLElement>('.calibration-copy')!.style.top = Math.abs(p[1]) < .15 ? '23%' : '50%';
  $('calibration-phase').textContent = validation ? 'Independent validation' : 'Personal calibration';
  $('calibration-title').textContent = validation ? 'Look at three more points to check the error.' : 'Look at the dot and sit comfortably.';
  $('calibration-description').textContent = 'No clicking is needed. Keep looking at the dot until sampling finishes and it moves.';
  $('point-steps').innerHTML = points.map((_, i) => `<span class="${i < pointIndex ? 'done' : i === pointIndex ? 'current' : ''}"></span>`).join('');
  $('calibration-count').textContent = `${pointIndex + 1} / ${points.length} · Waiting for open eyes and a clear face`;
  worker!.postMessage({ type: 'point', point: { index: pointIndex, x: p[0], y: p[1], validation } });
  pointTimer = setTimeout(() => cancelCalibration('Not enough valid samples were collected at this point. Face the camera, improve the lighting, and recalibrate.'), 15000);
}

function cancelCalibration(message = 'Calibration cancelled. Click Start calibration to retry.') {
  if (pointTimer) clearTimeout(pointTimer);
  pointTimer = null;
  worker?.postMessage({ type: 'cancelPoint' });
  calibration = 'idle';
  overlay.hidden = true;
  envelope = null;
  calibrationButton.disabled = !workerReady;
  calibrationButton.innerHTML = 'Start calibration <span>◎</span>';
  $('accuracy-value').textContent = 'Not calibrated';
  notice(message);
  displayUnknown('Calibration has not been completed.');
}

function handleWorker(data: any) {
  if (data.type === 'loading') {
    setState('unknown', 'Loading model', data.message);
  } else if (data.type === 'result') {
    workerBusy = false;
    const receivedAt = performance.now();
    if (!usableFrame(data.capturedAt, receivedAt, lastCapture)) {
      latestGaze = null;
      displayUnknown('The returned frame is stale. Waiting for a new frame.');
      return;
    }
    lastCapture = data.capturedAt;
    lastResult = receivedAt;
    frames++;
    if (lastResult - fpsStart >= 1000) {
      $('fps').textContent = `${(frames * 1000 / (lastResult - fpsStart)).toFixed(1)} FPS`;
      frames = 0; fpsStart = lastResult;
    }
    $('face-value').textContent = `${data.face ? 'Detected' : 'Not detected'} / ${data.face ? data.eyesOpen ? 'Open' : 'Closed' : '—'}`;
    $('head-value').textContent = data.features ? `${data.features[0].toFixed(2)} / ${data.features[1].toFixed(2)}` : '— / —';
    latestGaze = data.gaze;
    $('coordinate').textContent = latestGaze ? `X ${latestGaze[0].toFixed(2)}  Y ${latestGaze[1].toFixed(2)}` : 'X —  Y —';
    if (calibration !== 'idle') { dot.hidden = true; return; }
    if (!envelope) {
      if (data.features && data.gaze) {
        calibrationButton.disabled = false;
        if (!firstValidSeen) {
          firstValidSeen = true;
          notice('The model has returned valid gaze data. Sit comfortably and click Start calibration.');
        }
        setState('unknown', 'Waiting for calibration', 'Click Start calibration to establish your on-screen reference range.');
      } else {
        setState('unknown', 'Waiting for a valid frame', 'Face the camera with your eyes open and your face clearly visible.');
      }
      dot.hidden = true; return;
    }
    const decision = attentionEvidence({ face: data.face, head: data.diagnostic?.head ?? [], eyesOpen: data.eyesOpen, eyeAspect: data.diagnostic?.eyeAspect, features: data.features, mappedGaze: data.mappedGaze }, envelope, Number(toleranceInput.value));
    const outside = screenEvidence.update(data.capturedAt, decision.outside, decision.confirmMs);
    study.observe({ t: data.capturedAt, valid: outside !== null, onScreen: outside === null ? null : !outside, gaze: data.gaze, features: data.features });
    const result = dwell.update(lastResult, outside, Number(durationInput.value));
    const labels: Record<RuleState, [string, string]> = {
      unknown: ['Tracking unavailable', 'Waiting for valid tracking data.'],
      screen: ['Looking at the screen', 'Eye and head features are within your on-screen reference range.'],
      candidate: ['Possible off-screen gaze', 'Outside the calibrated range. Accumulating dwell time.'],
      away: ['Looking away', 'Rule decision: sustained departure from your on-screen reference range.'],
      recovering: ['Checking return', 'Features are back within range. Waiting for a one-second sustained return.'],
    };
    setState(result.state, ...labels[result.state]);
    $('dwell-progress').style.width = `${result.progress * 100}%`;
    $('dwell-value').textContent = `${(result.awayMs / 1000).toFixed(1)} / ${Number(durationInput.value).toFixed(1)} s`;
    showGaze();
  } else if (data.type === 'pointProgress') {
    if (calibration !== 'points' && calibration !== 'validation') return;
    const count = calibration === 'validation' ? validationTargets.length : targets.length;
    $('calibration-count').textContent = `${pointIndex + 1} / ${count} · Collected ${data.count} / 7`;
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
      $('calibration-title').textContent = 'Adjusting gaze coordinates…';
      $('calibration-count').textContent = 'Keep the window size unchanged';
      worker!.postMessage({ type: 'fit' });
    } else {
      calibration = 'idle';
      overlay.hidden = true;
      calibrationButton.disabled = false;
      calibrationButton.innerHTML = 'Recalibrate <span>◎</span>';
      const mean = validationErrors.reduce((a, b) => a + b, 0) / validationErrors.length;
      $('accuracy-value').textContent = `Diagonal ${(mean * 100).toFixed(1)}%`;
      notice(mean > .12 ? 'Calibration complete, but gaze coordinate error is high. You can inspect the off-screen rule first. If the blue dot is clearly displaced, improve the lighting, sit upright, and recalibrate.' : 'Calibration complete. Look at the screen corners, then turn or lower your head and observe the state. Increase Geometry tolerance if the rule produces false positives.');
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
    if (calibration !== 'idle') cancelCalibration(`Calibration failed: ${data.message}`);
    else displayUnknown('Model processing failed. Stop and restart tracking.');
    notice(`Model error: ${data.message}`, true);
    workerBusy = false;
  }
}

function createWorker(): Promise<void> {
  workerReady = false; workerBusy = true;
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('gaze-worker.js', document.baseURI));
    worker = w;
    const timer = setTimeout(() => reject(new Error('Model loading timed out. Refresh and retry, and check that your browser supports WebGL / WebAssembly.')), 60000);
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
    w.onerror = event => { clearTimeout(timer); reject(new Error(event.message || 'The browser could not start the model worker')); if (workerReady) { stop(); notice('The model worker failed. Please restart the camera.', true); } };
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
  if (workerReady && lastResult > 0 && now - lastResult > 1500 && calibration === 'idle') displayUnknown('Tracking interrupted. Waiting to resume.');
  raf = requestAnimationFrame(frameLoop);
}

async function start() {
  if (starting || running) return;
  const id = ++generation;
  starting = true;
  startButton.disabled = true; stopButton.disabled = false;
  notice('Allow camera access. Loading the local model on first startup may take several seconds.');
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access requires localhost or HTTPS. Open this page through the local server.');
    const acquired = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false });
    if (id !== generation) { acquired.getTracks().forEach(t => t.stop()); return; }
    stream = acquired;
    acquired.getVideoTracks().forEach(track => track.addEventListener('ended', () => {
      if (stream === acquired) { stop(); notice('Camera connection interrupted. Please restart the camera.', true); }
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
    setState('unknown', 'Warming up', 'Processing the first frame. Initial inference may take several seconds.');
    notice('The camera and model are loaded. Waiting for the first valid gaze frame. Initial inference may take several seconds; subsequent frames should be faster.');
  } catch (e) {
    if (id !== generation) return;
    const name = e instanceof Error ? e.name : '';
    const message = name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access in the browser address bar and retry.' : name === 'NotFoundError' ? 'No camera found. Connect a camera and retry.' : e instanceof Error ? e.message : String(e);
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
  calibrationButton.innerHTML = 'Start calibration <span>◎</span>';
  $('camera-placeholder').hidden = false;
  $('camera-led').classList.remove('active');
  $('backend').textContent = '/ OFF'; $('fps').textContent = '— FPS';
  $('face-value').textContent = '— / —'; $('head-value').textContent = '— / —';
  $('accuracy-value').textContent = 'Not calibrated'; $('coordinate').textContent = 'X —  Y —';
  $('dwell-progress').style.width = '0%';
  setState('unknown', 'Stopped', 'The camera is off and the calibration data for this run has been cleared.');
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
stopButton.addEventListener('click', () => { stop(); notice('The camera has stopped. Recalibrate when you start it again.'); });
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
  if (document.hidden) { latestGaze = null; displayUnknown('The page is in the background. Detection is paused.'); }
});
window.addEventListener('resize', () => {
  if ((envelope || calibration !== 'idle') && (Math.abs(innerWidth - calibrationSize[0]) > 3 || Math.abs(innerHeight - calibrationSize[1]) > 3)) {
    cancelCalibration('Window dimensions changed. Recalibrate to keep gaze coordinates aligned.');
  }
});
window.addEventListener('pagehide', stop);

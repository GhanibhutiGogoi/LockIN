import {GazeCapture} from './gaze.js';

const $=id=>document.getElementById(id);
let modelMessage='';
const gaze=new GazeCapture($('camera'),message=>{modelMessage=message;$('model-message').textContent=message;});
let starting=false,generation=0,startError='',savedReport=null,diagnosticPreview=false;
const explanations={
  stopped:['还没开始','先打开摄像头，等模型识别到清晰的人脸和眼睛。','等待启动'],
  camera_unavailable:['摄像头暂不可用','检查摄像头是否被遮挡、断开或被其他应用占用。必要时停止后重新打开。','无法判断'],
  camera_changed:['摄像头画面尺寸改变','请停止后重新打开摄像头，并重新校准，避免沿用旧画面的坐标映射。','需要重新启动'],
  loading:['正在加载眼动模型','模型在本机浏览器运行。首次加载和首帧推理可能需要十几秒，请稍等。','加载中'],
  worker_error:['眼动模型运行失败','请停止后重新启动。如果仍失败，把下方模型信息发给我。','无法判断'],
  calibrating:['正在校准与验证','保持自然坐姿，注视圆点；不用点击。','采样中'],
  waiting_for_frame:['等待新画面','暂时没有足够新的模型结果，蓝点已隐藏。请检查光线和摄像头画面。','数据中断 / 等待首帧'],
  no_face:['没有识别到人脸','面向摄像头，确保脸部完整、明亮，避免逆光。','无法判断'],
  eyes_unavailable:['眼部暂不可用','模型没有得到可用的眼部数据。请睁开眼睛，调整光线或眼镜反光。','无法判断'],
  no_gaze:['暂时没有注视坐标','已收到画面，但模型没有给出有效位置。请调整光线和坐姿。','无法判断'],
  uncalibrated:['可以开始校准了','点击「开始校准」。依次看 9 个点，再看 3 个新位置验证效果。','人脸和眼部可用'],
  tracking:['正在跟踪你的视线','依次看下方左、中、右三个区域。观察蓝点是否跟随，是否有持续偏移或抖动。','有效'],
};

function render(){
  const d=gaze.diagnostics(),live=gaze.cameraLive(),active=!!gaze.stream||live;
  const failedMapping=!!d.report&&!d.report.passed&&!d.calibrated&&d.phase==='idle'&&!d.issue;
  if(!failedMapping)diagnosticPreview=false;
  const [title,help,signal]=explanations[d.reason]||explanations.no_gaze;
  $('tracking-title').textContent=title;$('tracking-help').textContent=help;$('signal-status').textContent=signal;
  if(d.issue==='viewport_changed')$('tracking-help').textContent='窗口大小或缩放已改变，旧校准已失效，请重新校准。';
  else if(d.issue==='timeout')$('tracking-help').textContent='这次校准超时了。请改善光线后重试；反复超时可停止后重新打开。';
  else if(d.issue==='fit_failed')$('tracking-help').textContent='这轮坐标映射没有拟合成功。请依次注视不同位置，保持坐姿后重试；眼动模型仍可用。';
  else if(failedMapping&&d.reason==='uncalibrated'){
    $('tracking-title').textContent=diagnosticPreview?'诊断预览：精度未达标':'校准误差偏大';
    $('tracking-help').textContent=diagnosticPreview?'观察黄色点是否跟随视线、是否偏向同一侧。它仅用于诊断，不作为合格的 gaze 使用。':'可以先点击「预览估计点」观察偏移，再保存下方校准结果。无需一直重复校准。';
  }
  $('start-camera').disabled=starting||active;$('stop-camera').disabled=!starting&&!active;
  $('start-calibration').disabled=starting||!gaze.ready||!live||!d.valid||d.phase!=='idle';
  $('start-calibration').textContent=savedReport?'重新校准':'开始校准';
  $('camera-badge').textContent=starting?'正在启动':active?'已启动':'未启动';
  $('camera-placeholder').hidden=live;
  $('camera-message').textContent=startError||(['worker_error','camera_changed'].includes(d.reason)||d.issue==='fit_failed'?modelMessage:starting?'请在浏览器提示中允许摄像头访问。':'画面仅在本机处理，不上传。');
  $('calibration-status').textContent=d.phase!=='idle'?(d.phase==='fitting'?'拟合坐标映射':'正在采样'):d.calibrated?'已通过粗粒度验证':d.issue==='viewport_changed'?'窗口改变，需重新校准':savedReport&&!savedReport.passed?'验证未通过':'尚未校准';
  $('preview-unvalidated').hidden=!failedMapping;
  $('preview-unvalidated').disabled=!live||!d.valid;
  $('preview-unvalidated').textContent=diagnosticPreview?'关闭诊断预览':'预览估计点（仅诊断）';
  $('diagnostic-note').hidden=!diagnosticPreview;
  const positionInViewport=Number.isFinite(d.x)&&Number.isFinite(d.y)&&Math.abs(d.x)<=.5&&Math.abs(d.y)<=.5;
  const dot=$('gaze-dot');dot.hidden=!(d.valid&&(d.calibrated?d.on_screen===true:diagnosticPreview)&&positionInViewport&&$('show-dot').checked);
  dot.dataset.mode=diagnosticPreview?'diagnostic':'calibrated';
  if(!dot.hidden){dot.style.left=(d.x+.5)*100+'%';dot.style.top=(d.y+.5)*100+'%';}
  if(d.report&&d.report!==savedReport){savedReport=d.report;renderReport();}
  $('validation-result').hidden=!savedReport;
  if(savedReport){
    $('validation-badge').textContent=!d.calibrated&&savedReport.passed?'上次结果 · 当前需校准':savedReport.passed?'粗粒度验证通过':'建议重新校准';
    $('validation-badge').classList.toggle('warn',!d.calibrated);
  }
  renderOffscreen(d);
}

function renderOffscreen(d){
  const r=d.offscreen||{state:'unknown',away_ms:0,events:[]};
  const labels={screen:['看向屏幕（规则估计）','头部和眼部处于个人屏内参考范围，不累计离屏时间。'],
    candidate:['疑似离屏 · 正在计时','有效离屏达到30秒时记录一次分心事件。请观察这一状态是否符合你的实际行为。'],
    away:['分心事件：持续离屏30秒','本轮已经触发；继续离屏不会重复触发。看回屏幕后可开始下一轮。'],
    recovering:['正在看回屏幕','离屏计时已清零，持续看回约1秒后重新允许触发。'],
    unknown:['无法判断 · 计时暂停','短暂眨眼不计入离屏时长；较长的不可靠输入会清除未完成计时。']};
  const [title,help]=d.calibrated?(labels[r.state]||labels.unknown):['离屏30秒规则 · 等待有效校准','请先通过校准；黄色诊断预览不参与分心判断。'];
  $('offscreen-title').textContent=title;$('offscreen-help').textContent=help;
  const seconds=Math.min(30,r.away_ms/1000);$('offscreen-timer').textContent=seconds.toFixed(1)+' / 30.0 秒';$('offscreen-progress').value=seconds;
  $('offscreen-events').replaceChildren(...r.events.slice(-5).reverse().map(e=>{const li=document.createElement('li');li.textContent=`第 ${e.id} 次分心事件：有效离屏 ${(e.duration_ms/1000).toFixed(1)} 秒（30秒规则）`;return li;}));
}

function renderReport(){
  const r=savedReport;if(!r)return;
  $('mean-error').textContent=Math.round(r.meanErrorPx)+' px';$('max-error').textContent=Math.round(r.maxErrorPx)+' px';
  $('validation-copy').textContent=r.passed?'这三个位置没有参与校准。下面的偏差来自模型在这些新位置的估计；仍请亲自检查跟随方向与稳定性。':'模型在新位置上偏差较大。可以用「预览估计点」检查跟随方向；请保存这次结果，便于判断原因。此结果不进入分心判断。';
  $('point-errors').replaceChildren(...r.points.map((p,i)=>{const li=document.createElement('li');
    const dx=(p.predicted[0]-p.target[0])*r.viewport[0],dy=(p.predicted[1]-p.target[1])*r.viewport[1];
    li.textContent=`验证点 ${i+1}：偏差 ${Math.round(p.errorPx)} px（水平${dx<0?'左':'右'} ${Math.round(Math.abs(dx))} px，垂直${dy<0?'上':'下'} ${Math.round(Math.abs(dy))} px）`;return li;}));
  $('export-report').disabled=false;
}

function clearReport(){savedReport=null;diagnosticPreview=false;$('validation-result').hidden=true;$('export-report').disabled=true;}
$('start-camera').onclick=async()=>{
  const id=++generation;starting=true;startError='';clearReport();render();
  try{await gaze.start();}
  catch(e){if(id===generation){gaze.stop();startError=e.name==='NotAllowedError'?'摄像头权限未开放。请在地址栏的网站设置里允许摄像头，再点击打开。':e.name==='NotFoundError'?'没有找到摄像头，请检查设备连接。':'摄像头启动失败，请关闭其他占用摄像头的应用后重试。';}}
  finally{if(id===generation){starting=false;render();}}
};
$('stop-camera').onclick=()=>{generation++;gaze.stop();starting=false;startError='';render();};
$('start-calibration').onclick=()=>{clearReport();try{gaze.calibrate();}catch(e){startError=e.message;}render();};
$('cancel-cal').onclick=()=>{gaze.cancel();render();};
$('show-dot').onchange=render;
$('preview-unvalidated').onclick=()=>{diagnosticPreview=!diagnosticPreview;render();};
$('export-report').onclick=()=>{
  if(!savedReport)return;
  const current=gaze.diagnostics();
  const report={created_at:new Date().toISOString(),model:'WebEyeTrack / pretrained BlazeGaze + MediaPipe',
    calibration:'9 point affine mapping; 3 held-out targets; frozen pretrained weights',validation:savedReport,
    current,offscreen:current.offscreen,offscreen_rule:{method:'personal_head_iris_envelope_v1',threshold_ms:30000,heuristic:true},display_mode:diagnosticPreview?'diagnostic_preview':'standard'};
  const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='lockin-gaze-test.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
window.addEventListener('keydown',e=>{if(e.key==='Escape'&&gaze.phase!=='idle'){gaze.cancel();render();}});
window.addEventListener('pagehide',()=>{generation++;gaze.stop();});
setInterval(render,100);render();

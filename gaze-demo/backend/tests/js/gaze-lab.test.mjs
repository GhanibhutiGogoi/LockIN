import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../../static/gaze-lab.js',import.meta.url),'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;});
function lab(){
  const nodes=new Map();let tick,resolveStart,rejectStart;const downloads=[];
  const node=id=>{
    if(!nodes.has(id))nodes.set(id,{id,hidden:false,disabled:false,checked:true,textContent:'',style:{},dataset:{},children:[],
      classList:{toggle(){}},replaceChildren(...children){this.children=children;},append(...children){this.children.push(...children);},click(){this.onclick?.();}});
    return nodes.get(id);
  };
  class Camera {
    constructor(_video,status){this.status=status;}
    ready=false;live=false;calibrated=false;phase='idle';validationReport=null;
    d={valid:false,calibrated:false,reason:'stopped',phase:'idle'};
    async start(){this.live=true;await new Promise((yes,no)=>{resolveStart=yes;rejectStart=no;});this.ready=true;}
    stop(){this.live=false;this.ready=false;this.calibrated=false;this.d={valid:false,calibrated:false,reason:'stopped',phase:'idle'};}
    cameraLive(){return this.live;}
    diagnostics(){return this.d;}
    calibrate(){this.phase='points';this.d={valid:false,calibrated:false,reason:'calibrating',phase:'points'};}
    cancel(){this.phase='idle';this.d={valid:true,calibrated:false,reason:'uncalibrated',phase:'idle'};}
  }
  const document={getElementById:node,createElement:tag=>tag==='a'?{click(){downloads.push(this);}}:{textContent:'',append(){}}};
  const context={document,GazeCapture:Camera,innerWidth:1200,innerHeight:800,window:{addEventListener(){}},
    performance:{now:()=>1000},Date,Blob,URL:{createObjectURL:blob=>{downloads.push(blob);return 'blob:test';},revokeObjectURL(){}},
    setInterval:fn=>{tick=fn;return 1;},clearInterval(){},setTimeout:fn=>{fn();return 1;}};
  vm.createContext(context);vm.runInContext(source.replace(/^import .*;\r?\n/gm,'')+'\nglobalThis.camera=typeof gaze!=="undefined"?gaze:null;',context);
  return {node,context,downloads,tick:()=>tick?.(),resolve:()=>resolveStart?.(),reject:e=>rejectStart?.(e),
    async start(){assert.equal(typeof node('start-camera').onclick,'function','start control is not wired');const pending=node('start-camera').onclick();return {pending};}};
}
const tracked={valid:true,calibrated:true,on_screen:true,x:.25,y:-.25,reason:'tracking',phase:'idle',ageMs:20,inferenceMs:40};

test('the trial never starts a camera on page load and enables calibration only with usable gaze',async()=>{
  const ui=lab();assert.equal(ui.context.camera?.live,false);
  const {pending}=await ui.start();assert.equal(ui.node('start-calibration').disabled,true);
  ui.resolve();await pending;
  ui.context.camera.d={valid:false,calibrated:false,reason:'no_face',phase:'idle'};ui.tick();
  assert.equal(ui.node('start-calibration').disabled,true);
  ui.context.camera.d={...tracked,calibrated:false,reason:'uncalibrated'};ui.tick();
  assert.equal(ui.node('start-calibration').disabled,false);
});

test('stopping while camera permission is pending keeps the trial stopped after the late start',async()=>{
  const ui=lab();const {pending}=await ui.start();ui.node('stop-camera').click();ui.resolve();await pending;
  assert.equal(ui.node('start-camera').disabled,false);
  assert.equal(ui.node('stop-camera').disabled,true);
  assert.equal(ui.node('gaze-dot').hidden,true);
});

test('live dot follows calibrated model coordinates and hides immediately for uncertain input',async()=>{
  const ui=lab();const {pending}=await ui.start();ui.resolve();await pending;
  ui.context.camera.d=tracked;ui.tick();
  assert.equal(ui.node('gaze-dot').hidden,false);
  assert.equal(ui.node('gaze-dot').style.left,'75%');assert.equal(ui.node('gaze-dot').style.top,'25%');
  for(const d of [{...tracked,valid:false,reason:'no_face'},{...tracked,valid:false,reason:'waiting_for_frame'},{...tracked,calibrated:false,reason:'uncalibrated'}]){
    ui.context.camera.d=d;ui.tick();assert.equal(ui.node('gaze-dot').hidden,true);
  }
});

test('denied camera access shows a readable error and leaves a usable retry button',async()=>{
  const ui=lab();const {pending}=await ui.start();ui.reject(Object.assign(Error('denied'),{name:'NotAllowedError'}));await pending;
  assert.match(ui.node('camera-message').textContent,/权限|允许/);
  assert.equal(ui.node('start-camera').disabled,false);
  assert.equal(ui.node('stop-camera').disabled,true);
});

test('validation error report survives stopping and exports no image or facial landmarks',async()=>{
  const ui=lab();const {pending}=await ui.start();ui.resolve();await pending;
  ui.context.camera.d={...tracked,report:{passed:true,meanErrorPx:80,maxErrorPx:120,viewport:[1200,800],
    points:[{target:[0,0],predicted:[.1,0],errorPx:120}]}};ui.tick();
  assert.match(ui.node('mean-error').textContent,/80/);
  ui.node('stop-camera').click();assert.equal(ui.node('validation-result').hidden,false);
  assert.equal(ui.node('export-report').disabled,false);ui.node('export-report').click();
  const report=JSON.parse(await ui.downloads.find(v=>v instanceof Blob).text());
  assert.equal(report.validation.meanErrorPx,80);
  assert.equal(report.model,'WebEyeTrack / pretrained BlazeGaze + MediaPipe');
  assert.equal('image' in report,false);assert.equal('landmarks' in report,false);
});

test('first-run model failures expose their cause before any validation report exists',async()=>{
  const ui=lab();const {pending}=await ui.start();ui.resolve();await pending;
  ui.context.camera.d={valid:false,calibrated:false,reason:'worker_error',phase:'idle'};
  ui.context.camera.status('眼动 worker 版本不匹配，请运行 npm run build 再刷新。');ui.tick();
  assert.equal(ui.node('validation-result').hidden,true);
  assert.match(ui.node('camera-message').textContent,/npm run build/);
});

test('degenerate calibration explains the retry in the visible status before a report exists',async()=>{
  const ui=lab();const {pending}=await ui.start();ui.resolve();await pending;
  ui.context.camera.d={...tracked,calibrated:false,reason:'uncalibrated',issue:'fit_failed'};
  ui.context.camera.status('校准数据变化不足，请依次注视各点后重试。');ui.tick();
  assert.equal(ui.node('start-calibration').disabled,false);
  assert.match(ui.node('camera-message').textContent,/校准数据变化不足/);
});

const failedReport={passed:false,meanErrorPx:260,maxErrorPx:350,viewport:[1200,800],
  points:[{target:[0,0],predicted:[.25,.1],errorPx:310}]};
test('failed validation permits an explicit diagnostic dot without claiming calibrated gaze',async()=>{
  const ui=lab();const {pending}=await ui.start();ui.resolve();await pending;
  ui.context.camera.d={...tracked,calibrated:false,on_screen:null,reason:'uncalibrated',report:failedReport};ui.tick();
  assert.equal(ui.node('gaze-dot').hidden,true);
  assert.equal(ui.node('preview-unvalidated').hidden,false);
  assert.equal(typeof ui.node('preview-unvalidated').onclick,'function');
  ui.node('preview-unvalidated').click();
  assert.equal(ui.node('gaze-dot').hidden,false);
  assert.equal(ui.node('gaze-dot').dataset.mode,'diagnostic');
  assert.match(ui.node('tracking-title').textContent,/诊断|未达标/);
  assert.equal(ui.context.camera.d.calibrated,false);
  ui.node('export-report').click();
  const report=JSON.parse(await ui.downloads.find(v=>v instanceof Blob).text());
  assert.equal(report.current.calibrated,false);assert.equal(report.validation.passed,false);
});

test('diagnostic preview hides uncertain frames and is revoked by resize or a new calibration',async()=>{
  const ui=lab();const {pending}=await ui.start();ui.resolve();await pending;
  ui.context.camera.d={...tracked,calibrated:false,reason:'uncalibrated',report:failedReport};ui.tick();
  assert.equal(typeof ui.node('preview-unvalidated').onclick,'function');ui.node('preview-unvalidated').click();
  const failed=ui.context.camera.d;
  ui.context.camera.d={...failed,valid:false,reason:'no_face'};ui.tick();assert.equal(ui.node('gaze-dot').hidden,true);
  assert.match(ui.node('tracking-title').textContent,/没有识别到人脸/);
  ui.context.camera.d=failed;ui.tick();assert.equal(ui.node('gaze-dot').hidden,false);
  ui.context.camera.d={...failed,issue:'viewport_changed',report:null};ui.tick();assert.equal(ui.node('gaze-dot').hidden,true);
  ui.context.camera.d=failed;ui.tick();assert.equal(ui.node('gaze-dot').hidden,true);
  ui.node('preview-unvalidated').click();ui.node('start-calibration').click();
  assert.equal(ui.node('gaze-dot').hidden,true);
});

test('each validation point reports the direction of offset as well as total distance',async()=>{
  const ui=lab();const {pending}=await ui.start();ui.resolve();await pending;
  ui.context.camera.d={...tracked,calibrated:false,reason:'uncalibrated',report:failedReport};ui.tick();
  assert.match(ui.node('point-errors').children[0].textContent,/右 300 px/);
  assert.match(ui.node('point-errors').children[0].textContent,/下 80 px/);
});

test('off-screen status exposes the thirty-second count and auditable event in the exported report',async()=>{
  const ui=lab();const {pending}=await ui.start();ui.resolve();await pending;
  const event={id:1,reason:'continuous_offscreen_30s',duration_ms:30000,captured_at_ms:40000};
  ui.context.camera.d={...tracked,on_screen:false,report:{...failedReport,passed:true},
    offscreen:{state:'away',away_ms:30000,threshold_ms:30000,count:1,events:[event]}};ui.tick();
  assert.match(ui.node('offscreen-title').textContent,/分心|离屏/);
  assert.match(ui.node('offscreen-timer').textContent,/30\.0/);
  assert.match(ui.node('offscreen-events').children[0].textContent,/30/);
  ui.node('export-report').click();const report=JSON.parse(await ui.downloads.find(v=>v instanceof Blob).text());
  assert.equal(report.offscreen?.events[0].reason,'continuous_offscreen_30s');
});

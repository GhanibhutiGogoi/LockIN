import test from 'node:test';
import assert from 'node:assert/strict';
import * as lifecycle from '../../static/lifecycle.js';
import {GazeCapture} from '../../static/gaze.js';

// A fixed interval used to quantize 3.9s requests to 6s, breaking the 4s gate.
test('3.9 second requests start the next capture at completion without overlap',async()=>{
  assert.ok(lifecycle.CaptureLoop,'completion-paced capture loop is missing');
  let now=0,pending=null,finish;const starts=[];
  const loop=new lifecycle.CaptureLoop(()=>{
    starts.push(now);return new Promise(r=>finish=r);
  },{now:()=>now,schedule:(fn,delay)=>{pending={fn,delay};return 1;},cancel:()=>pending=null});
  loop.start();assert.deepEqual(starts,[0]);
  now=3900;finish();await Promise.resolve();
  assert.equal(pending.delay,0);pending.fn();assert.deepEqual(starts,[0,3900]);
  now=7800;finish();await Promise.resolve();pending.fn();
  assert.deepEqual(starts,[0,3900,7800]);
  loop.stop();finish();await Promise.resolve();assert.equal(pending,null);
});

test('fast requests wait only the remainder of the cadence',async()=>{
  assert.ok(lifecycle.CaptureLoop,'completion-paced capture loop is missing');
  let now=0,finish,pending;
  const loop=new lifecycle.CaptureLoop(()=>new Promise(r=>finish=r),{
    now:()=>now,schedule:(fn,delay)=>{pending={fn,delay};return 1;},cancel:()=>pending=null});
  loop.start();now=1200;finish();await Promise.resolve();
  assert.equal(pending.delay,1800);loop.stop();assert.equal(pending,null);
});

test('browser timer functions are invoked with their valid receiver',t=>{
  t.mock.method(globalThis,'clearTimeout',function(){
    if(this!==undefined&&this!==globalThis)throw new TypeError('Illegal invocation');
  });
  const loop=new lifecycle.CaptureLoop(async()=>{});
  assert.doesNotThrow(()=>loop.stop());
});

async function camera(t,{expression=false,model,workerReady=true,sourceWidth=640,sourceHeight=480,borrowed=false,onCalibrationPoint}={}){
  let now=1000,loop;const messages=[],trackEvents={},draws=[],reads=[];
  const track={readyState:'live',muted:false,getSettings(){return {deviceId:'test-camera'};},addEventListener(kind,fn){trackEvents[kind]=fn;},stop(){this.readyState='ended';}};
  const stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
  const video={videoWidth:sourceWidth,videoHeight:sourceHeight,readyState:4,currentTime:1,presentedFrames:1,paused:false,ended:false,srcObject:null,play:async()=>{},getVideoPlaybackQuality(){return {totalVideoFrames:this.presentedFrames};}};
  const nodes={calibration:{hidden:true},target:{style:{}},'cal-status':{textContent:''}};
  const globals={document:{createElement:()=>({getContext:()=>({drawImage(_video,...rect){draws.push(rect);},getImageData(...rect){reads.push(rect);return {data:new Uint8ClampedArray(4)};}})}),getElementById:id=>nodes[id]},
    navigator:{mediaDevices:{getUserMedia:async()=>stream}},location:{origin:'http://localhost:8000'},innerWidth:1000,innerHeight:800,devicePixelRatio:2,
    screen:{width:1000,height:800,availLeft:0,availTop:0},screenX:0,screenY:0,
    Worker:class {
      postMessage(message){
        messages.push(message);
        if(message.type==='init'&&workerReady)this.onmessage({data:{type:'ready',protocolVersion:5,captureRounds:true}});
        if(message.type==='frame')this.onmessage({data:{type:'result',capturedAt:message.timestamp,captureRound:message.captureRound,face:true,eyesOpen:true,gaze:[0,0]}});
      }
      terminate(){}
    }};
  const originals=new Map();let gaze;
  t.after(()=>{gaze?.stop();for(const [key,original] of originals)original?Object.defineProperty(globalThis,key,original):delete globalThis[key];});
  for(const [key,value] of Object.entries(globals)){
    const original=Object.getOwnPropertyDescriptor(globalThis,key);
    originals.set(key,original);
    Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  }
  t.mock.method(performance,'now',()=>now);
  t.mock.method(globalThis,'setInterval',fn=>{loop=fn;return 1;});
  t.mock.method(globalThis,'clearInterval',()=>{});
  gaze=new GazeCapture(video,()=>{},{expression,model,onCalibrationPoint});await gaze.start(borrowed?stream:undefined);gaze.calibrated=true;gaze.size=[1000,800];
  return {gaze,video,track,stream,messages,draws,reads,trackEvent(kind){trackEvents[kind]?.();},setTime(time){now=time;},tick(time){now=time;loop();}};
}

test('a borrowed camera stays owned by the study UI and calibration targets go to its renderer',async t=>{
  const targets=[];
  const c=await camera(t,{borrowed:true,onCalibrationPoint:point=>targets.push(point)});
  c.gaze.calibrate();
  assert.deepEqual(targets.at(-1),{x:.5,y:.5,index:1,total:9,validation:false,count:0});
  c.gaze.stop();
  assert.equal(targets.at(-1),null);
  assert.equal(c.video.srcObject,null);
  assert.equal(c.track.readyState,'live');
});

test('manual calibration and validation wait for separate start actions without point timers',async t=>{
  const targets=[];
  const c=await camera(t,{borrowed:true,onCalibrationPoint:point=>targets.push(point)});
  c.gaze.manualStages=true;
  c.gaze.calibrate();
  assert.equal(c.gaze.phase,'awaiting-start');
  assert.equal(targets.at(-1).awaitingStart,true);
  assert.equal(c.messages.filter(m=>m.type==='point').length,0);
  c.setTime(30000);c.gaze.startCalibrationStage();
  assert.equal(c.messages.at(-1).point.startedAt,30000);
  for(let index=0;index<9;index++)c.gaze.next({index,validation:false,calibrationId:c.gaze.calibrationId});
  assert.equal(c.gaze.phase,'fitting');
  c.gaze.worker.onmessage({data:{type:'fitted',calibrationId:c.gaze.calibrationId}});
  assert.equal(c.gaze.phase,'awaiting-start');
  assert.equal(targets.at(-1).validation,true);
  assert.equal(c.messages.filter(m=>m.type==='point').length,9);
  c.setTime(90000);c.gaze.startCalibrationStage();
  assert.equal(c.messages.at(-1).point.validation,true);
  assert.equal(c.messages.at(-1).point.startedAt,90000);
});

test('quick validation starts its original deadline after the instructions are dismissed',async t=>{
  const c=await camera(t,{borrowed:true,onCalibrationPoint:()=>{}});
  c.gaze.manualStages=true;c.gaze.canRecheck=true;
  assert.equal(c.gaze.revalidate(),true);
  c.setTime(60000);c.gaze.startCalibrationStage();
  assert.equal(c.gaze.quickDeadline,68000);
  c.gaze.cancel();c.gaze.startCalibrationStage();
  assert.equal(c.gaze.phase,'idle');
});

test('16:9 camera frames preserve geometry in both canvas sampling and worker input',async t=>{
  const c=await camera(t,{sourceWidth:1280,sourceHeight:720});c.tick(1000);
  const frame=c.messages.find(m=>m.type==='frame');
  assert.equal(frame.width,640);assert.equal(frame.height,360);
  assert.deepEqual(c.draws[0],[0,0,640,360]);assert.deepEqual(c.reads[0],[0,0,640,360]);
  assert.equal(c.gaze.sample().valid,true);
});

test('missing intrinsic video dimensions cannot submit a guessed 4:3 frame to the model',async t=>{
  const c=await camera(t,{sourceWidth:0,sourceHeight:0});c.tick(1000);
  assert.equal(c.messages.filter(m=>m.type==='frame').length,0);assert.equal(c.gaze.sample().valid,false);
  c.video.videoWidth=1280;c.video.videoHeight=720;c.tick(1100);
  assert.equal(c.messages.find(m=>m.type==='frame').height,360);
});

test('a camera geometry change invalidates the old mapping and requires a fresh worker',async t=>{
  const c=await camera(t);c.tick(1000);assert.equal(c.gaze.sample().calibrated,true);
  c.video.videoWidth=1280;c.video.videoHeight=720;
  assert.equal(c.gaze.sample().valid,false);assert.equal(c.gaze.sample().calibrated,false);
  assert.equal(c.gaze.diagnostics().reason,'camera_changed');
  c.video.presentedFrames=2;c.tick(1100);assert.equal(c.messages.filter(m=>m.type==='frame').length,1);
});

test('a saved validation report retains source and processed dimensions after stopping',async t=>{
  const c=await camera(t,{sourceWidth:1280,sourceHeight:720});c.tick(1000);c.gaze.calibrate();
  for(let i=0;i<9;i++)c.gaze.worker.onmessage({data:pointReply(c)});
  const fit=c.messages.filter(m=>m.type==='fit').at(-1);
  c.gaze.worker.onmessage({data:{type:'fitted',calibrationId:fit.calibrationId}});
  for(let i=0;i<3;i++)c.gaze.worker.onmessage({data:pointReply(c)});
  const report=c.gaze.validationReport;c.gaze.stop();
  assert.equal(report.camera?.source_width,1280);assert.equal(report.camera?.source_height,720);
  assert.equal(report.camera?.input_width,640);assert.equal(report.camera?.input_height,360);
});

test('camera adapter can stop on an independent page without calibration controls',async t=>{
  const c=await camera(t);document.getElementById=()=>null;
  assert.doesNotThrow(()=>c.gaze.stop());
});

test('facial sample uses real frame age and does not require gaze calibration',async t=>{
  const c=await camera(t),names=Array.from({length:52},(_,i)=>'b'+i);
  c.tick(1000);c.gaze.calibrated=false;c.gaze.latest.open=false;
  c.gaze.latest.blendshapes=names.map(name=>[name,.2]);
  assert.deepEqual(c.gaze.facialSample(names).values,Array(52).fill(.2));
  c.tick(3000);assert.equal(c.gaze.facialSample(names).valid,false);
});

test('a frozen webcam frame expires instead of being stamped as new gaze',async t=>{
  const c=await camera(t);c.tick(1000);assert.equal(c.gaze.sample().valid,true);
  c.tick(3000);c.tick(6000);
  assert.equal(c.gaze.sample().valid,false);
  assert.equal(c.messages.filter(m=>m.type==='frame').length,1);
  c.video.currentTime=2;c.video.presentedFrames=2;c.tick(6100);assert.equal(c.gaze.sample().valid,true);
});

test('advancing playback clock without new presented frames cannot refresh gaze',async t=>{
  const c=await camera(t);c.tick(1000);assert.equal(c.gaze.sample().valid,true);
  c.video.currentTime=2;c.tick(2000);c.video.currentTime=3;c.tick(3000);
  assert.equal(c.gaze.sample().valid,false);
  assert.equal(c.messages.filter(m=>m.type==='frame').length,1);
});

test('unknown presented-frame freshness fails closed even with a running camera',async t=>{
  const c=await camera(t);c.video.getVideoPlaybackQuality=undefined;c.tick(1000);
  assert.equal(c.gaze.sample().valid,false);
});

test('background capture continues when presentation callbacks stop but decoded frames advance',async t=>{
  const c=await camera(t);
  c.gaze.hasFrameCallbacks=true;
  c.gaze.presentedFrame={id:1,at:1000};
  c.tick(1000);
  for(let time=1100;time<=5000;time+=100){c.video.presentedFrames++;c.tick(time);}
  assert.equal(c.gaze.sample().valid,true);
  assert.equal(c.gaze.latest.t,5000);
  // A stopped decoder and an advancing playback clock must still expire.
  c.video.currentTime=20;c.tick(6300);
  assert.equal(c.gaze.sample().valid,false);
});

test('decoded-frame fallback does not refresh a frame first observed after a long polling gap',async t=>{
  const c=await camera(t);c.gaze.hasFrameCallbacks=true;c.tick(1000);
  c.video.presentedFrames=50;c.tick(5000);
  assert.equal(c.gaze.sample().valid,false);
  c.tick(5100);assert.equal(c.gaze.sample().valid,false);
  c.video.presentedFrames=51;c.tick(5200);assert.equal(c.gaze.sample().valid,true);
});

for(const state of ['ended','muted','paused'])test(`gaze immediately becomes invalid when camera is ${state}`,async t=>{
  const c=await camera(t);c.tick(1000);assert.equal(c.gaze.sample().valid,true);
  if(state==='ended')c.track.readyState='ended';
  if(state==='muted')c.track.muted=true;
  if(state==='paused')c.video.paused=true;
  assert.equal(c.gaze.sample().valid,false);
  c.video.currentTime=2;c.tick(1100);assert.equal(c.gaze.sample().on_screen,null);
});

test('expression evidence stays paired with its source face and expires with that frame',async t=>{
  const c=await camera(t),names=Array.from({length:52},(_,i)=>'b'+i);
  c.gaze.expressionEnabled=true;
  c.gaze.latestExpression={t:1000,face:true,blendshapes:names.map(n=>[n,.2]),expression:{model_id:'ferplus-8-a2a2ba6a',probabilities:[1,0,0,0,0,0,0,0]}};
  assert.equal(typeof c.gaze.expressionSample,'function');
  assert.equal(c.gaze.expressionSample(names).capturedAt,1000);
  c.gaze.latest={t:1100,face:true,blendshapes:names.map(n=>[n,.9])};
  assert.equal(c.gaze.expressionSample(names).values[0],.2);
  c.tick(2300);assert.equal(c.gaze.expressionSample(names).valid,false);
  c.gaze.stop();assert.equal(c.gaze.latestExpression,null);
});


function expressionFrame(c,t){
  c.setTime(t);
  c.gaze.worker.onmessage({data:{type:'result',capturedAt:t,face:true,eyesOpen:true,gaze:[0,0],
    blendshapes:Array.from({length:52},(_,i)=>['b'+i,.2]),expressionInput:new Float32Array(4096)}});
}
function expressionResult(c,t,probabilities){c.gaze.expressionWorker.onmessage({data:{type:'expression',capturedAt:t,model_id:'ferplus-8-a2a2ba6a',probabilities}});}
const expressionNames=Array.from({length:52},(_,i)=>'b'+i);

test('a late FER+ reply cannot revive evidence after a newer unusable face',async t=>{
  const c=await camera(t,{expression:true});expressionFrame(c,1000);
  c.setTime(1100);c.gaze.worker.onmessage({data:{type:'result',capturedAt:1100,face:false,blendshapes:[],expressionInput:null}});
  expressionResult(c,1000,[0,0,0,1,0,0,0,0]);
  assert.equal(c.gaze.expressionSample(expressionNames).valid,false);
});

test('all inferred posteriors and invalid boundaries survive slower upload polling',async t=>{
  const c=await camera(t,{expression:true});
  expressionFrame(c,1000);expressionResult(c,1000,[0,0,0,1,0,0,0,0]);
  expressionFrame(c,1450);expressionResult(c,1450,[1,0,0,0,0,0,0,0]);
  c.setTime(1550);c.gaze.worker.onmessage({data:{type:'result',capturedAt:1550,face:false,blendshapes:[],expressionInput:null}});
  expressionFrame(c,1900);expressionResult(c,1900,[0,0,0,1,0,0,0,0]);
  assert.equal(typeof c.gaze.expressionSamples,'function');
  const samples=c.gaze.expressionSamples(expressionNames);
  assert.deepEqual(samples.map(s=>s.capturedAt),[1000,1450,1550,1900]);
  assert.equal(samples[1].expression.probabilities[0],1);
  assert.equal(samples[2].valid,false);
  assert.deepEqual(c.gaze.expressionSamples(expressionNames),[]);
});

test('camera mute and worker errors invalidate pending inference and enqueue a boundary',async t=>{
  const c=await camera(t,{expression:true});expressionFrame(c,1000);
  c.track.muted=true;c.tick(1050);c.track.muted=false;
  expressionResult(c,1000,[0,0,0,1,0,0,0,0]);
  assert.equal(c.gaze.expressionSample(expressionNames).valid,false);
  expressionFrame(c,1500);
  c.gaze.worker.onmessage({data:{type:'error',message:'test failure'}});
  expressionResult(c,1500,[0,0,0,1,0,0,0,0]);
  assert.equal(c.gaze.expressionSample(expressionNames).valid,false);
});


test('a brief observed mute cannot be hidden by recovery before the next sampling tick',async t=>{
  const c=await camera(t,{expression:true});expressionFrame(c,1000);
  c.setTime(1050);c.track.muted=true;c.trackEvent('mute');c.track.muted=false;
  expressionResult(c,1000,[0,0,0,1,0,0,0,0]);
  assert.equal(c.gaze.expressionSample(expressionNames).valid,false);
});

function pointReply(c,overrides={}){
  const p=c.messages.filter(m=>m.type==='point').at(-1).point;
  return {type:'pointDone',...p,target:[p.x,p.y],predicted:[p.x,p.y],...overrides};
}

function completeCalibration(c){
  c.gaze.calibrate();
  for(let i=0;i<9;i++)c.gaze.worker.onmessage({data:pointReply(c)});
  c.gaze.worker.onmessage({data:{type:'fitted',calibrationId:c.gaze.calibrationId}});
  for(let i=0;i<3;i++)c.gaze.worker.onmessage({data:pointReply(c)});
  assert.equal(c.gaze.calibrated,true);
}

test('pause detaches the camera, resumes with two checks and rejects old capture results',async t=>{
  const targets=[],observations=[];
  const c=await camera(t,{borrowed:true,onCalibrationPoint:point=>targets.push(point)});
  c.gaze.onObservation=sample=>observations.push(sample);
  c.tick(1000);
  completeCalibration(c);
  const worker=c.gaze.worker,round=c.gaze.round;
  assert.equal(c.gaze.suspend(),true);
  assert.equal(c.video.srcObject,null);
  assert.equal(c.gaze.calibrated,false);
  assert.equal(c.gaze.worker,worker);
  assert.equal(await c.gaze.resume(c.stream),true);
  assert.equal(c.gaze.revalidate(),true);
  assert.deepEqual(targets.at(-1),{x:.27,y:.31,index:1,total:2,validation:true,count:0,recheck:true});
  const count=observations.length;
  c.setTime(1100);
  worker.onmessage({data:{type:'result',captureRound:round,capturedAt:1100,face:true,eyesOpen:true,gaze:[0,0],outside:true,calibrationId:c.gaze.calibrationId}});
  assert.equal(observations.length,count);
  assert.equal(c.gaze.sample().on_screen,null);
  worker.onmessage({data:pointReply(c)});
  assert.equal(c.gaze.calibrated,false);
  worker.onmessage({data:pointReply(c)});
  assert.equal(c.gaze.calibrated,true);
  assert.equal(c.gaze.offscreen.snapshot(1100).away_ms,0);
});

test('changed camera or viewport cannot reuse calibration',async t=>{
  const c=await camera(t,{borrowed:true});
  c.tick(1000);
  completeCalibration(c);
  assert.equal(c.gaze.suspend(),true);
  globalThis.innerWidth=900;
  assert.equal(await c.gaze.resume(c.stream),false);
  assert.equal(c.video.srcObject,null);
  assert.equal(c.gaze.calibrated,false);
});

test('a quick check cannot pass after its total deadline',async t=>{
  const c=await camera(t,{borrowed:true});
  c.tick(1000);
  completeCalibration(c);
  assert.equal(c.gaze.suspend(),true);
  assert.equal(await c.gaze.resume(c.stream),true);
  assert.equal(c.gaze.revalidate(),true);
  c.gaze.worker.onmessage({data:pointReply(c)});
  c.setTime(9100);
  c.gaze.worker.onmessage({data:pointReply(c)});
  assert.equal(c.gaze.calibrated,false);
  assert.equal(c.gaze.calibrationIssue,'timeout');
});

test('canceling calibration keeps its overlay closed when a collected point arrives late',async t=>{
  const c=await camera(t);c.gaze.calibrate();const late=pointReply(c);
  c.gaze.cancel();c.gaze.worker.onmessage({data:late});
  assert.equal(document.getElementById('calibration').hidden,true);
  assert.equal(c.gaze.point,null);
});

test('a duplicate or previous-round point cannot advance the current calibration',async t=>{
  const c=await camera(t);c.gaze.calibrate();const old=pointReply(c);
  c.gaze.worker.onmessage({data:old});assert.equal(c.gaze.index,1);
  c.gaze.worker.onmessage({data:old});assert.equal(c.gaze.index,1);
  c.gaze.calibrate();c.gaze.worker.onmessage({data:old});assert.equal(c.gaze.index,0);
});

test('a canceled fit cannot reopen validation over a new calibration',async t=>{
  const c=await camera(t);c.gaze.calibrate();
  for(let i=0;i<9;i++)c.gaze.worker.onmessage({data:pointReply(c)});
  const fit=c.messages.filter(m=>m.type==='fit').at(-1);
  c.gaze.calibrate();c.gaze.worker.onmessage({data:{type:'fitted',calibrationId:fit.calibrationId}});
  assert.equal(c.gaze.validation,false);
  assert.equal(c.gaze.index,0);
});

test('brief camera interruption discards the old gaze until a new frame is inferred',async t=>{
  const c=await camera(t);c.tick(1000);assert.equal(c.gaze.sample().valid,true);
  c.track.muted=true;c.trackEvent('mute');c.track.muted=false;
  assert.equal(c.gaze.sample().valid,false);
  c.video.presentedFrames=2;c.tick(1200);assert.equal(c.gaze.sample().valid,true);
});

test('a resize permanently invalidates calibration even if the window is resized back',async t=>{
  const c=await camera(t);c.tick(1000);
  globalThis.innerWidth=1100;assert.equal(c.gaze.sample().calibrated,false);
  globalThis.innerWidth=1000;assert.equal(c.gaze.sample().calibrated,false);
});

test('worker failure clears otherwise fresh gaze and requires recalibration',async t=>{
  const c=await camera(t);c.tick(1000);
  c.gaze.worker.onmessage({data:{type:'error',message:'inference failed'}});
  assert.equal(c.gaze.sample().valid,false);
  assert.equal(c.gaze.sample().calibrated,false);
});

test('empty and non-2D model outputs cannot become valid gaze',async t=>{
  const c=await camera(t);c.tick(1000);
  for(const value of [[],[0],[0,0,0],[0,NaN],null]){
    c.gaze.latest.gaze=value;assert.equal(c.gaze.sample().valid,false);
  }
});

test('independent validation retains actual pixel distances after subsequent live results',async t=>{
  const c=await camera(t);c.gaze.calibrate();
  for(let i=0;i<9;i++)c.gaze.worker.onmessage({data:pointReply(c)});
  const fit=c.messages.filter(m=>m.type==='fit').at(-1);
  c.gaze.worker.onmessage({data:{type:'fitted',calibrationId:fit.calibrationId}});
  for(let i=0;i<3;i++){
    const d=pointReply(c);d.predicted=[d.target[0]+.1,d.target[1]];
    c.gaze.worker.onmessage({data:d});
  }
  c.tick(1000);
  assert.equal(c.gaze.validationReport?.passed,true);
  assert.ok(Math.abs(c.gaze.validationReport.meanErrorPx-100)<1e-8);
  assert.equal(c.gaze.validationReport.points.length,3);
  assert.equal(c.gaze.sample().calibrated,true);
});

test('all three validation targets are unseen positions excluded from the personal fit',async t=>{
  const c=await camera(t);c.gaze.calibrate();
  for(let i=0;i<9;i++)c.gaze.worker.onmessage({data:pointReply(c)});
  const training=c.messages.filter(m=>m.type==='point').map(m=>[m.point.x,m.point.y]);
  const fit=c.messages.filter(m=>m.type==='fit').at(-1);
  c.gaze.worker.onmessage({data:{type:'fitted',calibrationId:fit.calibrationId}});
  for(let i=0;i<3;i++){
    const d=pointReply(c);
    assert.equal(training.some(p=>p[0]===d.target[0]&&p[1]===d.target[1]),false,'validation must not reuse a training location');
    c.gaze.worker.onmessage({data:d});
  }
});

test('detailed diagnostics preserve the original 0.22 validation gate and remain available after failure',async t=>{
  const c=await camera(t);c.gaze.calibrate();
  for(let i=0;i<9;i++)c.gaze.worker.onmessage({data:pointReply(c)});
  const fit={method:'median-7-affine-v1',matrix:[[1,0,0],[0,1,0]],pointErrors:Array(9).fill(0),rmse:0,inputSingularValues:[1,1],inputConditionNumber:1};
  c.gaze.worker.onmessage({data:{type:'fitted',calibrationId:c.gaze.calibrationId,fitDiagnostics:fit}});
  for(const error of [.24,.17,.30]){
    const d=pointReply(c);d.predicted=[d.target[0]+error,d.target[1]];
    d.diagnostics={sampleCount:7,rawSamples:Array(7).fill([.1,.2]),clippedSamples:0};
    c.gaze.worker.onmessage({data:d});
  }
  const report=c.gaze.calibrationDiagnostics();
  assert.equal(c.gaze.calibrated,false);
  assert.equal(report.validation.threshold,.22);
  assert.equal(report.fit,fit);
  assert.equal(report.points.length,3);
  assert.equal(report.points[0].mode,'validation');
  assert.ok(Math.abs(report.points[0].errorNormalized-.24)<1e-10);
  assert.ok(Math.abs(report.points[0].errorPx-240)<1e-8);
  c.gaze.calibrate();
  assert.equal(c.gaze.calibrationDiagnostics().fit,null);
  assert.equal(c.gaze.calibrationDiagnostics().points.length,0);
  assert.equal(report.points.length,3);
});

test('fallback observes frame age while the worker is busy and cannot rejuvenate a frozen frame',async t=>{
  const c=await camera(t),post=c.gaze.worker.postMessage.bind(c.gaze.worker);let held=false;
  c.gaze.worker.postMessage=m=>{if(m.type==='frame'&&!held){held=true;return;}post(m);};
  c.tick(1000);c.video.presentedFrames=2;c.tick(1100);
  c.setTime(6100);c.gaze.worker.onmessage({data:{type:'result',capturedAt:1000,face:true,eyesOpen:true,gaze:[0,0]}});
  c.tick(6100);assert.equal(c.gaze.sample().valid,false);
  c.video.presentedFrames=3;c.tick(6200);assert.equal(c.gaze.sample().valid,true);
});

test('counter advances first observed after a long timer gap cannot establish frame freshness',async t=>{
  const c=await camera(t);c.tick(1000);assert.equal(c.gaze.sample().valid,true);
  c.video.presentedFrames=2;c.tick(7000);assert.equal(c.gaze.sample().valid,false);
  c.video.presentedFrames=3;c.tick(7100);assert.equal(c.gaze.sample().valid,true);
});

test('an old generated worker fails with a build instruction rather than hanging on calibration',async t=>{
  const c=await camera(t);let status='';c.gaze.status=m=>status=m;
  c.gaze.worker.onmessage({data:{type:'ready'}});
  assert.equal(c.gaze.ready,false);assert.match(status,/npm run build/);
  assert.equal(c.gaze.diagnostics().reason,'worker_error');
});

test('EyeTheia rejects a worker that silently initializes another model',async t=>{
  const c=await camera(t,{model:'eyetheia',workerReady:false});let status='';c.gaze.status=m=>status=m;
  assert.equal(c.messages.find(m=>m.type==='init').model,'eyetheia');
  c.gaze.worker.onmessage({data:{type:'ready',protocolVersion:5,captureRounds:true,model:'blazegaze'}});
  assert.equal(c.gaze.ready,false);
  assert.match(status,/EyeTheia.*npm run build/);
});

test('a worker that never becomes ready reaches an actionable terminal failure',async t=>{
  const c=await camera(t,{workerReady:false});
  c.tick(1000000);assert.equal(c.gaze.diagnostics().reason,'worker_error');
});

test('a worker that never answers inference cannot leave the capture loop busy forever',async t=>{
  const c=await camera(t),post=c.gaze.worker.postMessage.bind(c.gaze.worker);
  c.gaze.worker.postMessage=m=>{if(m.type!=='frame')post(m);};
  c.tick(1000);assert.equal(c.gaze.busy,true);
  c.tick(1000000);assert.equal(c.gaze.diagnostics().reason,'worker_error');
  assert.equal(c.gaze.busy,false);assert.equal(c.gaze.sample().valid,false);
});

test('a degenerate personal fit fails calibration with a readable retry while the pretrained model stays ready',async t=>{
  const c=await camera(t);c.tick(1000);c.gaze.calibrate();
  for(let i=0;i<9;i++)c.gaze.worker.onmessage({data:pointReply(c)});
  const fit=c.messages.filter(m=>m.type==='fit').at(-1);let status='';c.gaze.status=m=>status=m;
  c.gaze.worker.onmessage({data:{type:'error',operation:'fit',calibrationId:fit.calibrationId,message:'Matrix is rank deficient'}});
  assert.equal(c.gaze.ready,true);assert.equal(c.gaze.phase,'idle');assert.equal(c.gaze.sample().calibrated,false);
  assert.equal(c.gaze.diagnostics().issue,'fit_failed');assert.match(status,/Calibration.*retry/);
  assert.doesNotThrow(()=>c.gaze.calibrate());
});

function geometryFrame(c,t,outside,extra={}){
  c.setTime(t);c.gaze.worker.onmessage({data:{type:'result',capturedAt:t,face:true,eyesOpen:true,gaze:[.4,.1],outside,calibrationId:c.gaze.calibrationId,...extra}});
}

test('confirmed head-away and closed-eye evidence survives capture without inventing gaze coordinates',async t=>{
  const c=await camera(t);
  for(const [index,reason] of ['head_away','eyes_closed'].entries()){
    geometryFrame(c,1100+index*100,true,{eyesOpen:false,gaze:null,attentionValid:true,attentionReason:reason});
    assert.equal(c.gaze.sample().valid,true);assert.equal(c.gaze.sample().on_screen,false);
    assert.equal(c.gaze.sample().x,null);assert.equal(c.gaze.sample().y,null);
    assert.equal(c.gaze.sample().eyes_open,false);
  }
  geometryFrame(c,1300,true,{face:false,eyesOpen:false,gaze:null,attentionValid:true,attentionReason:'head_away'});
  assert.equal(c.gaze.sample().valid,false);
  geometryFrame(c,1400,null,{eyesOpen:false,gaze:null,attentionValid:false,attentionReason:'eyes_closed'});
  assert.equal(c.gaze.sample().valid,false);
  geometryFrame(c,1500,true,{eyesOpen:false,gaze:[0,0]});
  assert.equal(c.gaze.sample().valid,false);
});
test('capture uses independent geometry evidence for screen membership and records a thirty-second event',async t=>{
  const c=await camera(t);geometryFrame(c,1000,true);assert.equal(c.gaze.sample().on_screen,false);
  for(let t=1100;t<=31000;t+=100)geometryFrame(c,t,true);
  assert.equal(c.gaze.diagnostics().offscreen?.count,1);
  assert.equal(c.gaze.diagnostics().offscreen.events[0].reason,'continuous_offscreen_30s');
  c.gaze.stop();assert.equal(c.gaze.diagnostics().offscreen.count,1);
  assert.equal(c.gaze.diagnostics().offscreen.state,'unknown');
});
test('wrong-generation geometry and uncalibrated diagnostic dots cannot supply off-screen evidence',async t=>{
  const c=await camera(t);
  for(let t=1000;t<=32000;t+=100)geometryFrame(c,t,true,{calibrationId:c.gaze.calibrationId-1});
  assert.equal(c.gaze.sample().on_screen,null);assert.equal(c.gaze.diagnostics().offscreen?.count,0);
  c.gaze.calibrated=false;
  for(let t=32100;t<=64000;t+=100)geometryFrame(c,t,true);
  assert.equal(c.gaze.sample().on_screen,null);assert.equal(c.gaze.diagnostics().offscreen.count,0);
});
test('camera interruption clears the off-screen candidate before a late reply can extend it',async t=>{
  const c=await camera(t);for(let t=1000;t<=21000;t+=100)geometryFrame(c,t,true);
  c.track.muted=true;c.trackEvent('mute');c.track.muted=false;
  assert.equal(c.gaze.diagnostics().offscreen?.away_ms,0);
  geometryFrame(c,21100,true,{capturedAt:21000});assert.equal(c.gaze.diagnostics().offscreen.away_ms,0);
});

test('a frame arriving after camera geometry changes cannot overwrite the restart instruction',async t=>{
  const c=await camera(t);c.tick(1000);let status='';c.gaze.status=m=>status=m;
  c.video.videoWidth=1280;c.video.videoHeight=720;
  geometryFrame(c,1100,true,{capturedAt:1000});
  assert.equal(c.gaze.diagnostics().reason,'camera_changed');assert.match(status,/dimensions.*restart/);
});

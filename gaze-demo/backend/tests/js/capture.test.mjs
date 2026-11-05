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

async function camera(t,{expression=false}={}){
  let now=1000,loop;const messages=[],trackEvents={};
  const track={readyState:'live',muted:false,addEventListener(kind,fn){trackEvents[kind]=fn;},stop(){this.readyState='ended';}};
  const stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
  const video={readyState:4,currentTime:1,presentedFrames:1,paused:false,ended:false,srcObject:null,play:async()=>{},getVideoPlaybackQuality(){return {totalVideoFrames:this.presentedFrames};}};
  const nodes={calibration:{hidden:true}};
  const globals={document:{createElement:()=>({getContext:()=>({drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(4)})})}),getElementById:id=>nodes[id]},
    navigator:{mediaDevices:{getUserMedia:async()=>stream}},location:{origin:'http://localhost:8000'},innerWidth:1000,innerHeight:800,
    Worker:class {
      postMessage(message){
        messages.push(message);
        if(message.type==='init')this.onmessage({data:{type:'ready'}});
        if(message.type==='frame')this.onmessage({data:{type:'result',capturedAt:message.timestamp,face:true,eyesOpen:true,gaze:[0,0]}});
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
  gaze=new GazeCapture(video,()=>{},{expression});await gaze.start();gaze.calibrated=true;gaze.size=[1000,800];
  return {gaze,video,track,messages,trackEvent(kind){trackEvents[kind]?.();},setTime(time){now=time;},tick(time){now=time;loop();}};
}

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

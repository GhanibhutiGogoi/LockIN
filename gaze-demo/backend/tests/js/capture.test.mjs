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

async function camera(t){
  let now=1000,loop;const messages=[];
  const track={readyState:'live',muted:false,stop(){this.readyState='ended';}};
  const stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
  const video={readyState:4,currentTime:1,paused:false,ended:false,srcObject:null,play:async()=>{}};
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
  gaze=new GazeCapture(video,()=>{});await gaze.start();gaze.calibrated=true;gaze.size=[1000,800];
  return {gaze,video,track,messages,tick(time){now=time;loop();}};
}

test('a frozen webcam frame expires instead of being stamped as new gaze',async t=>{
  const c=await camera(t);c.tick(1000);assert.equal(c.gaze.sample().valid,true);
  c.tick(3000);c.tick(6000);
  assert.equal(c.gaze.sample().valid,false);
  assert.equal(c.messages.filter(m=>m.type==='frame').length,1);
  c.video.currentTime=2;c.tick(6100);assert.equal(c.gaze.sample().valid,true);
});

for(const state of ['ended','muted','paused'])test(`gaze immediately becomes invalid when camera is ${state}`,async t=>{
  const c=await camera(t);c.tick(1000);assert.equal(c.gaze.sample().valid,true);
  if(state==='ended')c.track.readyState='ended';
  if(state==='muted')c.track.muted=true;
  if(state==='paused')c.video.paused=true;
  assert.equal(c.gaze.sample().valid,false);
  c.video.currentTime=2;c.tick(1100);assert.equal(c.gaze.sample().on_screen,null);
});

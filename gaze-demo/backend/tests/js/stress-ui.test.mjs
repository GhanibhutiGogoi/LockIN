import test from 'node:test';
import assert from 'node:assert/strict';
import {uiHarness,high,offer,flush} from './helpers/stress-ui.mjs';

test('new invalid input during a high-frame request prevents the old offer being shown',async()=>{
  const c=uiHarness(),sample=high();c.input(sample);const run=c.h.upload();await flush();
  c.setNow(100300);c.input({valid:false,values:null,expression:null,capturedAt:100300});
  c.replyFrame(c.requests[0],sample,{event:offer});await flush();c.resolveShown();await run;
  assert.equal(c.node('relief').hidden,true);
  assert.equal(c.shown().length,0);
});

test('an intermediate neutral followed by a newer high cannot authorize an old offer',async()=>{
  const c=uiHarness(),sample=high();c.input(sample);const run=c.h.upload();await flush();
  c.setNow(100300);c.input({...high(100200),expression:{...sample.expression,probabilities:[1,0,0,0,0,0,0,0]}});c.input(high(100300));
  c.replyFrame(c.requests[0],sample,{event:offer});await flush();c.resolveShown();await run;
  assert.equal(c.node('relief').hidden,true);
  assert.equal(c.shown().length,0);
});

test('unchanged fresh high evidence still shows the offered animation and feedback',async()=>{
  const c=uiHarness(),sample=high();c.input(sample);const run=c.h.upload();await flush();
  c.replyFrame(c.requests[0],sample,{event:offer});await flush();c.resolveShown();await run;
  assert.equal(c.node('relief').hidden,false);
  assert.equal(c.node('feedback').hidden,false);
  assert.equal(c.shown().length,1);
});

test('a high offer waits for newer high evidence to be processed instead of being lost',async()=>{
  const c=uiHarness(),sample=high();c.input(sample);let run=c.h.upload();await flush();
  c.setNow(100300);const newer=high(100300);c.input(newer);
  c.replyFrame(c.requests[0],sample,{event:offer});await flush();c.resolveShown();await run;
  assert.equal(c.node('relief').hidden,true);
  run=c.h.upload();await flush();c.replyFrame(c.requests.find(r=>!r.done&&r.path.endsWith('/frames')),newer);await flush();c.resolveShown();await run;
  assert.equal(c.node('relief').hidden,false);
  assert.equal(c.shown().length,1);
});

test('camera stop cancels an in-flight frame reply before it can restore live state',async()=>{
  const c=uiHarness(),sample=high();c.input(sample);const run=c.h.upload();await flush();
  c.setNow(100300);await c.node('camera-stop').onclick();
  c.replyFrame(c.requests[0],sample,{event:offer});await flush();c.resolveShown();await run;
  assert.equal(c.node('relief').hidden,true);
  assert.equal(c.shown().length,0);
  assert.equal(c.h.state().session.last_prediction.state,'unknown');
  assert.equal(c.h.state().lastValidAt,-Infinity);
});

test('camera stop while shown response is pending never resurrects the animation',async()=>{
  const c=uiHarness();const run=c.h.present(offer);await flush();
  await c.node('camera-stop').onclick();c.resolveShown();await run;
  assert.equal(c.h.gaze.cameraLive(),false);
  assert.equal(c.node('relief').hidden,true);
  assert.equal(c.node('feedback').hidden,true);
});

test('learning intervention during shown request stays suppressed after late reply',async()=>{
  const c=uiHarness();const run=c.h.present(offer);await flush();
  c.h.learningBus.onmessage({data:{user_id:'test-user',active:true}});
  c.resolveShown();await run;
  assert.equal(c.node('relief').hidden,true);
  assert.equal(c.node('feedback').hidden,true);
});

test('stop and restart cannot let an old shown reply enter the new camera run',async()=>{
  const c=uiHarness();const run=c.h.present(offer);await flush();
  await c.node('camera-stop').onclick();await c.node('camera-start').onclick();
  c.resolveShown();await run;
  assert.equal(c.h.gaze.cameraLive(),true);
  assert.equal(c.node('relief').hidden,true);
});

test('synthetic replay still shows animation without any camera evidence',async()=>{
  const c=uiHarness({mode:'replay'});c.h.gaze.stop();const run=c.h.present(offer);await flush();c.resolveShown();await run;
  assert.equal(c.node('relief').hidden,false);
});

test('a new invalid source while shown reply is pending prevents late display',async()=>{
  const c=uiHarness();const run=c.h.present(offer);await flush();
  c.setNow(100200);c.input({valid:false,values:null,expression:null,capturedAt:100200});
  c.resolveShown();await run;
  assert.equal(c.node('relief').hidden,true);
  assert.equal(c.node('feedback').hidden,true);
});

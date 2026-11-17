import test from 'node:test';
import assert from 'node:assert/strict';
import {CaptureLease, restorePlayback} from '../../static/lifecycle.js';

// Mutation caught: retaining permission results acquired after Stop leaks live tracks.
test('late screen permission result is immediately stopped after session end',async()=>{
  const lease=new CaptureLease();let resolve;let stopped=0;
  const stream={getTracks:()=>[{stop:()=>stopped++}]};
  const pending=lease.acquire(()=>new Promise(r=>resolve=r),()=>true);
  lease.stop();resolve(stream);
  assert.equal(await pending,null);assert.equal(stopped,1);assert.equal(lease.active,null);
});

test('duplicate sharing cannot orphan the first stream',async()=>{
  const lease=new CaptureLease();let stopped=0;const stream={getTracks:()=>[{stop:()=>stopped++}]};
  await lease.acquire(async()=>stream,()=>true);
  await assert.rejects(lease.acquire(async()=>stream,()=>true));
  lease.stop();assert.equal(stopped,1);
});

test('changing owner while screen picker is pending discards its stream',async()=>{
  const lease=new CaptureLease();let resolve;let current=true,stopped=0;
  const pending=lease.acquire(()=>new Promise(r=>resolve=r),()=>current);
  current=false;resolve({getTracks:()=>[{stop:()=>stopped++}]});
  assert.equal(await pending,null);assert.equal(stopped,1);
});

test('restored video resumes at confirmed position after metadata loads',()=>{
  const callbacks=new Map();const video={readyState:0,currentTime:0,addEventListener:(type,cb)=>callbacks.set(type,cb)};
  restorePlayback(video,{id:'e1',position_s:4.25,phase:'video'},()=>true);
  assert.equal(video.currentTime,0);video.readyState=1;callbacks.get('loadedmetadata')();
  assert.equal(video.currentTime,4.25);
});

test('stale playback restoration cannot seek the next episode',()=>{
  let callback;const video={readyState:0,currentTime:0,addEventListener:(_,cb)=>callback=cb};
  restorePlayback(video,{id:'old',position_s:5},()=>false);callback();assert.equal(video.currentTime,0);
});

test('replay recovery freezes while user inspects debug output',async()=>{
  const {timelineNow}=await import('../../static/lifecycle.js');
  assert.equal(timelineNow('replay','recovery',23000,100000,190000),23000);
  assert.equal(timelineNow('replay','video',9000,100000,105000),14000);
  assert.equal(timelineNow('live','study',0,100000,105000),5000);
});

test('recovery reload preserves quiz return timestamp for next replay sample',async()=>{
  const {restoredReplayTime}=await import('../../static/lifecycle.js');
  assert.equal(restoredReplayTime({last_t:9000},{last_media_t:22000,returned_at:23000}),23000);
});

test('switching user clears prior prompts memories and private learning fields',async()=>{
  const {resetUserInspection}=await import('../../static/lifecycle.js');
  const nodes=new Map();
  for(const id of ['session','phase','input','gate','episode','retrieved','prompt','summary','update','trace','bank','evaluation','answer'])nodes.set(id,{textContent:'private A',value:'private A'});
  nodes.set('video-section',{hidden:false});
  nodes.set('goal',{value:'private A goal',defaultValue:'example goal'});
  nodes.set('context',{value:'private A material',defaultValue:'example material'});
  const doc={getElementById:id=>nodes.get(id)};
  resetUserInspection(doc);
  for(const id of ['prompt','retrieved','bank','trace','summary'])assert.ok(!nodes.get(id).textContent.includes('private A'));
  assert.equal(nodes.get('goal').value,'example goal');assert.equal(nodes.get('context').value,'example material');
  assert.equal(nodes.get('video-section').hidden,true);assert.equal(nodes.get('answer').value,'');
});

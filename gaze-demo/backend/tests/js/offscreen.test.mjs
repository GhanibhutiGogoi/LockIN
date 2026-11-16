import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../../static/offscreen.js';

function monitor(){assert.equal(typeof api.OffscreenMonitor,'function');return new api.OffscreenMonitor();}
const sample=(t,outside=true,extra={})=>({t,valid:true,calibrated:true,outside,...extra});
function run(m,from,to,outside=true){let r;for(let t=from;t<=to;t+=100)r=m.observe(sample(t,outside),t);return r;}

test('exactly thirty seconds of fresh off-screen evidence emits once, never before',()=>{
  const m=monitor();run(m,0,29900);assert.equal(m.snapshot(29900).count,0);
  const r=m.observe(sample(30000),30000);assert.equal(r.state,'away');assert.equal(r.count,1);
  assert.equal(r.events[0].reason,'continuous_offscreen_30s');assert.equal(r.events[0].duration_ms,30000);
  run(m,30100,70000);assert.equal(m.snapshot(70000).count,1);
});
test('a screen return resets an unfinished count and rearms a fired event only after a stable return',()=>{
  const m=monitor();run(m,0,20000);m.observe(sample(20100,false),20100);
  assert.equal(m.snapshot(20100).away_ms,0);run(m,20200,50200);assert.equal(m.snapshot(50200).count,1);
  m.observe(sample(50300,false),50300);assert.equal(m.snapshot(50300).state,'recovering');
  run(m,50400,51300,false);assert.equal(m.snapshot(51300).state,'screen');
  run(m,51400,81400);assert.equal(m.snapshot(81400).count,2);
});
test('a brief blink pauses without counting the ambiguous interval',()=>{
  const m=monitor();run(m,0,15000);m.observe(sample(15100,null,{valid:false}),15100);
  m.observe(sample(15200,null,{valid:false}),15200);m.observe(sample(15300),15300);
  assert.equal(m.snapshot(15300).away_ms,15000);run(m,15400,30000);
  assert.equal(m.snapshot(30000).count,0);run(m,30100,30300);assert.equal(m.snapshot(30300).count,1);
});
test('long uncertainty and frozen capture clear unfinished time rather than triggering from wall time',()=>{
  const m=monitor();run(m,0,20000);assert.equal(m.snapshot(40000).state,'unknown');
  assert.equal(m.snapshot(40000).away_ms,0);assert.equal(m.snapshot(40000).count,0);
  run(m,40100,60000);m.observe(sample(60100,null,{valid:false}),60100);
  for(let t=60200;t<=62000;t+=100)m.observe(sample(t,null,{valid:false}),t);
  assert.equal(m.snapshot(62000).away_ms,0);run(m,62100,72100);assert.equal(m.snapshot(72100).count,0);
});
test('duplicates, delayed results, uncalibrated dots and future timestamps cannot manufacture a dwell',()=>{
  const m=monitor();m.observe(sample(0),0);
  for(let t=100;t<=30000;t+=100)m.observe(sample(0),t);
  assert.equal(m.snapshot(30000).count,0);
  run(m,30100,50000);m.observe(sample(90000),50000);assert.equal(m.snapshot(50000).away_ms,0);
  for(let t=50100;t<=90100;t+=100)m.observe(sample(t,true,{calibrated:false}),t);
  assert.equal(m.snapshot(90100).count,0);
});
test('unknown data after an event cannot rearm it or assert a recovery',()=>{
  const m=monitor();run(m,0,30000);m.invalidate();run(m,31000,62000);
  assert.equal(m.snapshot(62000).count,1);assert.equal(m.snapshot(62000).state,'away');
});

test('a non-triggering trial retains peak dwell and state transitions for human debugging',()=>{
  const m=monitor();run(m,0,12000);
  m.observe(sample(12100,null,{valid:false}),12100);m.observe(sample(13000,null,{valid:false}),13000);
  run(m,13100,14100,false);const r=m.snapshot(14100);
  assert.equal(r.count,0);assert.equal(r.max_away_ms,12000);
  assert.deepEqual(r.transitions.map(x=>x.state),['candidate','unknown','screen']);
});

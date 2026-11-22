import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, AttentionDetector } from './attention.ts';
import { RecoveryTracker } from './recovery.ts';
import type { Observation } from './types.ts';

const obs = (t: number, extra: Partial<Observation> = {}): Observation => ({ t, valid: true, onScreen: true, visible: true, screen: 'study', source: 'manual', ...extra });

test('unknown tracking and unknown task context do not become attention evidence', () => {
  assert.equal(classify(obs(0, { valid: false, onScreen: false })).kind, 'unknown');
  assert.equal(classify(obs(0, { visible: false })).kind, 'unknown');
  assert.equal(classify(obs(0, { screen: 'unknown' })).kind, 'unknown');
  assert.equal(classify(obs(0, { onScreen: false })).reason, 'look-away');
  assert.equal(classify(obs(0, { screen: 'entertainment' })).reason, 'entertainment');
});

test('sustained distraction triggers once and stale or reordered samples do not trigger', () => {
  const d = new AttentionDetector(2000);
  assert.equal(d.push(obs(0, { onScreen: false })).trigger, false);
  for (let t = 500; t < 2000; t += 500) assert.equal(d.push(obs(t, { onScreen: false })).trigger, false);
  assert.equal(d.push(obs(2000, { onScreen: false })).trigger, true);
  assert.equal(d.push(obs(2500, { onScreen: false })).trigger, false);
  assert.equal(d.push(obs(1000, { onScreen: false })).trigger, false);
  const gap = new AttentionDetector(2000);
  gap.push(obs(0, { onScreen: false }));
  assert.equal(gap.push(obs(10000, { onScreen: false })).trigger, false);
});

test('unknown observations break a pending trigger', () => {
  const d = new AttentionDetector(2000);
  d.push(obs(0, { onScreen: false })); d.push(obs(1000, { onScreen: false }));
  d.push(obs(1500, { valid: false }));
  assert.equal(d.push(obs(2000, { onScreen: false })).heldMs, 0);
});

test('loading is not watching and answering before video end is rejected', () => {
  const r = new RecoveryTracker();
  assert.throws(() => r.answer(1000, true));
  assert.equal(r.snapshot(5000).watchedMs, 0);
  r.play(5000); r.observe(obs(5000)); r.observe(obs(6000));
  r.pause(6500); r.observe(obs(7000)); r.play(9000); r.observe(obs(9000)); r.endVideo(10000);
  assert.equal(r.snapshot(10000).watchedMs, 2500);
  assert.equal(r.snapshot(10000).observationMs, 0);
});

test('recovery is measured after quiz return, with a sustained return and relapse', () => {
  const r = new RecoveryTracker({ windowMs: 10000, recoveryHoldMs: 2000, relapseHoldMs: 1000 });
  r.play(0); r.endVideo(1000); r.answer(2000, null);
  for (let t = 2000; t <= 6000; t += 500) r.observe(obs(t));
  for (let t = 6500; t <= 8000; t += 500) r.observe(obs(t, { screen: 'entertainment' }));
  for (let t = 8500; t <= 12000; t += 500) r.observe(obs(t));
  const s = r.finish(12000, 'complete');
  assert.equal(s.recoveredAfterMs, 2000);
  assert.equal(s.relapseAfterMs, 3500);
  assert.equal(s.observationMs, 10000);
  assert.equal(s.completed, true);
  assert.equal(s.quizCorrect, null);
  assert.equal(s.coverage, 1);
});

test('missing intervals are unknown; early termination is censored even if a return occurred', () => {
  const r = new RecoveryTracker({ windowMs: 10000, recoveryHoldMs: 1000 });
  r.play(0); r.endVideo(1000); r.answer(2000, true);
  r.observe(obs(2000)); r.observe(obs(2500)); r.observe(obs(3000));
  r.observe(obs(9000));
  const s = r.finish(9500, 'session-ended');
  assert.equal(s.completed, false);
  assert.equal(s.censoredReason, 'session-ended');
  assert.equal(s.validMs, 1500);
  assert.equal(s.unknownMs, 6000);
  assert.equal(s.onTaskShare, 1);
  assert.equal(s.coverage, .2);
});

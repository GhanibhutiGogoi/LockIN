import { test } from 'node:test';
import assert from 'node:assert/strict';
import { featuresFrom, fitEnvelope, outsideEvidence, attentionEvidence, ScreenEvidence, DwellRule } from './rules.ts';

test('a missing face or closed eyes cannot become a valid centre gaze', () => {
  assert.equal(featuresFrom({ landmarks: [], head: [0, 0, 0], eyesOpen: false }), null);
});

const sample = [0, 0, 0, 0, 0, 0];
const baseline = () => fitEnvelope(Array.from({ length: 30 }, () => [...sample]));

test('normal screen-edge variation is included in the calibrated envelope', () => {
  const e = fitEnvelope([...Array.from({ length: 30 }, () => [...sample]), ...Array.from({ length: 10 }, () => [0.3, -0.2, 0.15, 0.08, 0.15, 0.08])]);
  assert.equal(outsideEvidence([0.3, -0.2, 0.15, 0.08, 0.15, 0.08], e, 1, [.42, .4]), false);
});

test('slight head movement stays on screen while substantial head turns and eye-only departures remain detectable', () => {
  const e = baseline();
  assert.equal(outsideEvidence([0.12, 0, 0, 0, 0, 0], e, 1, [.1, .2]), false);
  assert.equal(outsideEvidence([0.6, 0, 0, 0, 0, 0], e, 1, [.1, .2]), true);
  assert.equal(outsideEvidence([0, -.4, 0, 0, 0, 0], e, 1, [.1, .2]), true);
  assert.equal(outsideEvidence([0.6, 0, 0, 0, 0, 0], e, 1, [.8, .2]), true);
  for (const sign of [-1, 1]) {
    assert.equal(outsideEvidence([0, 0, sign * .3, 0, sign * .3, 0], e, 1, [sign * .8, 0]), true);
    assert.equal(outsideEvidence([0, 0, 0, sign * .2, 0, sign * .2], e, 1, [0, sign * .8]), true);
  }
});

test('unilateral distortion and opposing eyes stay unknown while bilateral evidence outvotes the model', () => {
  const e = baseline();
  assert.equal(outsideEvidence([0, 0, .3, 0, 0, 0], e, 1, [.8, 0]), null);
  assert.equal(outsideEvidence([0, 0, .3, 0, -.3, 0], e, 1, [.8, 0]), null);
  assert.equal(outsideEvidence([0, 0, .3, 0, .3, 0], e, 1, [.1, .2]), true);
  assert.equal(outsideEvidence(sample, e, 1, [.8, 0]), null);
  assert.equal(outsideEvidence(sample, e, 1, [NaN, 0]), null);
  assert.equal(outsideEvidence(sample, e, 1, undefined), null);
});

test('bilateral departure only needs one shared axis and does not require a working gaze projection', () => {
  const e = baseline();
  assert.equal(outsideEvidence([0, 0, .3, .05, .3, 0], e, 1, [.1, .2]), true);
  assert.equal(outsideEvidence([0, 0, .3, 0, .3, 0], e, 1, undefined), true);
  assert.equal(outsideEvidence([.6, 0, .3, 0, 0, 0], e, 1, [.8, 0]), null);
});

test('a brief blink pauses confirmed evidence without counting unknown time or restarting confirmation', () => {
  const r = new ScreenEvidence();
  for (const t of [0, 200, 400]) r.update(t, true);
  assert.equal(r.update(600, true), true);
  assert.equal(r.update(800, null), null);
  assert.equal(r.update(1000, true), true);
  assert.equal(r.update(1200, false), false);
  assert.equal(r.update(1400, true), true);
  r.update(1600, true);
  assert.equal(r.update(1800, null), null);
  assert.equal(r.update(2000, true), true);
  assert.equal(r.update(2200, true), true);
  assert.equal(r.update(2400, true), true);
  for (const t of [2600, 2800, 3000, 3200, 3400, 3600]) r.update(t, null);
  assert.equal(r.update(3800, true), null);
});

test('normalised iris features tolerate face translation and scale but reject impossible iris positions', () => {
  const landmarks = Array.from({ length: 478 }, () => ({ x: .5, y: .5 }));
  for (const [iris, a, b, x] of [[468, 33, 133, .3], [473, 362, 263, .6]]) {
    landmarks[a] = { x, y: .4 }; landmarks[b] = { x: x + .1, y: .4 }; landmarks[iris] = { x: x + .05, y: .4 };
  }
  const base = featuresFrom({ landmarks, head: [0, 0, 1], eyesOpen: true })!;
  const moved = landmarks.map(p => ({ x: p.x * 1.2 - .1, y: p.y * 1.2 + .05 }));
  const changed = featuresFrom({ landmarks: moved, head: [0, 0, 1], eyesOpen: true })!;
  assert.ok(changed.every((v, i) => Math.abs(v - base[i]) < 1e-10));
  landmarks[468] = { x: .6, y: .4 };
  assert.equal(featuresFrom({ landmarks, head: [0, 0, 1], eyesOpen: true }), null);
});

test('screen evidence filters short disturbances and immediately reports a screen observation', () => {
  const r = new ScreenEvidence();
  assert.equal(r.update(0, false), false);
  assert.equal(r.update(200, true), null);
  assert.equal(r.update(400, true), null);
  assert.equal(r.update(600, false), false);
  for (const t of [800, 1000, 1200]) assert.equal(r.update(t, true), null);
  assert.equal(r.update(1400, true), true);
  assert.equal(r.update(1600, false), false);
});

test('confirmed departure survives brief screen peeks but resets after one second on screen', () => {
  const r = new ScreenEvidence();
  for (let t = 0; t <= 1000; t += 100) r.update(t, true);
  r.update(1100, false); r.update(1300, false);
  assert.equal(r.update(1400, true), true);
  for (let t = 1500; t <= 2500; t += 100) assert.equal(r.update(t, false), false);
  assert.equal(r.update(2600, true), null);
  for (let t = 2700; t < 3200; t += 100) assert.equal(r.update(t, true), null);
  assert.equal(r.update(3200, true), true);
});

test('downward or sideways head orientation remains evidence without usable eyes or gaze', () => {
  const base = { face: true, eyesOpen: false, features: null, eyeAspect: [.1, .3] };
  for (const head of [[0, -.5, Math.sqrt(.75)], [-.5, 0, Math.sqrt(.75)], [0, .5, Math.sqrt(.75)]]) {
    assert.equal(attentionEvidence({ ...base, head }, baseline()).reason, 'head_away');
    assert.equal(attentionEvidence({ ...base, head }, baseline()).outside, true);
  }
  for (const head of [[0, 0, 0], [NaN, 0, 1], [0, -.5], [0, -.5, 10]]) {
    assert.equal(attentionEvidence({ ...base, head }, baseline()).outside, null);
  }
  assert.equal(attentionEvidence({ ...base, face: false, head: [0, -.5, Math.sqrt(.75)] }, baseline()).outside, null);
});

test('bilateral closure requires 1.5 seconds while blinks and one-eye occlusion do not confirm away', () => {
  const base = { face: true, head: [0, 0, 1], eyesOpen: false, features: null };
  const closed = attentionEvidence({ ...base, eyeAspect: [.1, .15] }, baseline());
  assert.equal(closed.reason, 'eyes_closed');
  const r = new ScreenEvidence();
  for (let t = 0; t < 1500; t += 100) assert.equal(r.update(t, closed.outside, closed.confirmMs), null);
  assert.equal(r.update(1500, closed.outside, closed.confirmMs), true);
  r.reset();
  for (let t = 0; t <= 400; t += 100) r.update(t, true);
  for (let t = 500; t < 2000; t += 100) assert.equal(r.update(t, true, closed.confirmMs), null);
  assert.equal(r.update(2000, true, closed.confirmMs), true);
  r.reset();
  r.update(0, closed.outside, closed.confirmMs); r.update(100, closed.outside, closed.confirmMs);
  assert.equal(r.update(200, false), false);
  assert.equal(r.update(300, closed.outside, closed.confirmMs), null);
  for (const eyeAspect of [[.1, .3], [.3, .1], [NaN, .1]]) {
    const unclear = attentionEvidence({ ...base, eyeAspect }, baseline());
    assert.equal(unclear.outside, null);
    for (let t = 0; t <= 3000; t += 100) assert.equal(r.update(t, unclear.outside), null);
  }
  assert.equal(attentionEvidence({ ...base, face: false, eyeAspect: [.1, .1] }, baseline()).outside, null);
});

test('uncertainty, stale frames, duplicate timestamps and reset cannot accumulate screen evidence', () => {
  const r = new ScreenEvidence();
  r.update(0, true); r.update(400, true);
  assert.equal(r.update(600, null), null);
  assert.equal(r.update(800, true), null);
  assert.equal(r.update(2000, true), null);
  r.update(2200, true);
  assert.equal(r.update(2200, true), null);
  r.reset();
  assert.equal(r.update(2400, true), null);
  assert.equal(r.update(NaN, true), null);
});

test('a brief glance does not become an away decision', () => {
  const r = new DwellRule();
  r.update(0, false, 2);
  r.update(100, true, 2);
  assert.equal(r.update(600, true, 2).state, 'candidate');
  assert.equal(r.update(700, false, 2).state, 'recovering');
});

test('away requires continuous valid elapsed time', () => {
  const r = new DwellRule();
  r.update(0, true, 2);
  let result;
  for (let t = 100; t <= 2200; t += 100) result = r.update(t, true, 2);
  assert.equal(result?.state, 'away');
});

test('unknown frames and long gaps reset accumulated away evidence', () => {
  const r = new DwellRule();
  r.update(0, true, 2);
  for (let t = 100; t <= 1500; t += 100) r.update(t, true, 2);
  assert.equal(r.update(1600, null, 2).state, 'unknown');
  assert.equal(r.update(1700, true, 2).state, 'candidate');
  assert.equal(r.update(10000, true, 2).state, 'candidate');
});

test('the screen state also requires a short sustained return', () => {
  const r = new DwellRule();
  for (let t = 0; t <= 2200; t += 100) r.update(t, true, 2);
  assert.equal(r.update(2300, false, 2).state, 'recovering');
  for (let t = 2400; t <= 3300; t += 100) r.update(t, false, 2);
  assert.equal(r.update(3400, false, 2).state, 'screen');
});

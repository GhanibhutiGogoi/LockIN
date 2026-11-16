import { test } from 'node:test';
import assert from 'node:assert/strict';
import { featuresFrom, fitEnvelope, outsideEvidence, DwellRule } from './rules.ts';

test('a missing face or closed eyes cannot become a valid centre gaze', () => {
  assert.equal(featuresFrom({ landmarks: [], head: [0, 0, 0], eyesOpen: false }), null);
});

const sample = [0, 0, 0, 0, 0, 0];
const baseline = () => fitEnvelope(Array.from({ length: 30 }, () => [...sample]));

test('normal screen-edge variation is included in the calibrated envelope', () => {
  const e = fitEnvelope([...Array.from({ length: 30 }, () => [...sample]), ...Array.from({ length: 10 }, () => [0.3, -0.2, 0.15, 0.08, 0.15, 0.08])]);
  assert.equal(outsideEvidence([0.3, -0.2, 0.15, 0.08, 0.15, 0.08], e, 1), false);
});

test('head deviation and consistent deviation of both eyes provide evidence', () => {
  const e = baseline();
  assert.equal(outsideEvidence([0.6, 0, 0, 0, 0, 0], e, 1), true);
  assert.equal(outsideEvidence([0, 0, 0.3, 0, 0.3, 0], e, 1), true);
  assert.equal(outsideEvidence([0, 0, 0.3, 0, 0, 0], e, 1), false);
});

test('a brief glance does not become an away decision', () => {
  const r = new DwellRule();
  r.update(0, false, 2);
  r.update(100, true, 2);
  assert.equal(r.update(600, true, 2).state, 'candidate');
  assert.equal(r.update(700, false, 2).state, 'screen');
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

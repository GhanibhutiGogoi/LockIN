import { expect, it } from 'vitest';
import { ScreenIntervention } from './intervention';
import type { ScreenScene } from './types';

it('prepares before playback and only after continuous current evidence', () => {
  const gate = new ScreenIntervention();
  let result = gate.update('content', 0);
  for (let ms = 100; ms < 1000; ms += 100) {
    result = gate.update('content', ms);
    expect(result.prepare).toBe(false);
  }
  result = gate.update('content', 1000);
  expect(result).toMatchObject({ prepare: true, play: false });
  for (let ms = 1100; ms < 30_000; ms += 100) {
    result = gate.update('content', ms);
    expect(result.play).toBe(false);
  }
  result = gate.update('content', 30_000);
  expect(result.play).toBe(true);
  expect(gate.update(null, 30_100)).toMatchObject({ prepare: false, play: false });
  for (let ms = 30_200; ms <= 31_100; ms += 100) gate.update(null, ms);
  expect(gate.update('content', 31_200).durationMs).toBe(0);
});

it('does not count missing observations as distraction', () => {
  const gate = new ScreenIntervention();
  gate.update('gaze', 0);
  expect(gate.update('gaze', 30_000).play).toBe(false);
  expect(gate.update('content', 30_100).durationMs).toBe(100);
});

it('pauses during brief unknown evidence and plays once current risk returns', () => {
  const gate = new ScreenIntervention();
  for (let ms = 0; ms <= 31_000; ms += 100) gate.update('gaze', ms);
  expect(gate.update('unknown', 31_100)).toMatchObject({ play: false, recovered: false });
  expect(gate.update('unknown', 31_500).durationMs).toBe(31_000);
  expect(gate.update('gaze', 31_600).play).toBe(true);
});

it('requires fresh dwell after prolonged loss but does not report recovery', () => {
  const gate = new ScreenIntervention();
  for (let ms = 0; ms <= 31_000; ms += 100) gate.update('gaze', ms);
  for (let ms = 31_100; ms <= 38_000; ms += 100) expect(gate.update('unknown', ms).recovered).toBe(false);
  expect(gate.update('gaze', 38_100)).toMatchObject({ durationMs: 0, play: false });
});

const pendingScene = (id: number): ScreenScene => ({ id, timestamp: 0, observedUntil: 40_000,
  width: 100, height: 100, displaySurface: 'monitor', status: 'pending', label: 'checking' });

it('uses delayed classification only for gaze observations of that actual page', () => {
  const gate = new ScreenIntervention(), scene = pendingScene(1);
  for (let ms = 0; ms < 35_000; ms += 100) {
    expect(gate.update({ scene, goalRequired: true }, ms).play).toBe(false);
  }
  Object.assign(scene, { status: 'ready', label: 'off-topic' });
  expect(gate.update({ scene, goalRequired: true }, 35_000)).toMatchObject({ play: true, durationMs: 35_000 });
  // A newly opened, unclassified page is not the old off-topic page.
  expect(gate.update({ scene: pendingScene(2), goalRequired: true }, 35_100).play).toBe(false);
});

it('can join two confirmed off-topic pages without treating their OCR delay as missing gaze', () => {
  const gate = new ScreenIntervention(), first = pendingScene(1), second = pendingScene(2);
  Object.assign(first, { status: 'ready', label: 'off-topic' });
  for (let ms = 0; ms < 20_000; ms += 100) gate.update({ scene: first, goalRequired: true }, ms);
  for (let ms = 20_000; ms < 40_000; ms += 100) gate.update({ scene: second, goalRequired: true }, ms);
  Object.assign(second, { status: 'ready', label: 'off-topic' });
  expect(gate.update({ scene: second, goalRequired: true }, 40_000).play).toBe(true);
});

it('never backfills missing gaze, note-taking or a confirmed study recovery', () => {
  for (const boundary of ['unknown', null] as const) {
    const gate = new ScreenIntervention(), scene = pendingScene(1);
    for (let ms = 0; ms < 20_000; ms += 100) gate.update({ scene, goalRequired: true }, ms);
    for (let ms = 20_000; ms < 30_000; ms += 100) gate.update(boundary, ms);
    Object.assign(scene, { status: 'ready', label: 'off-topic' });
    expect(gate.update({ scene, goalRequired: true }, 30_000)).toMatchObject({ play: false, durationMs: 0 });
  }
});

it('does not trigger on related, uncertain or failed classifications after waiting', () => {
  for (const label of ['related', 'uncertain', 'unavailable'] as const) {
    const gate = new ScreenIntervention(), scene = pendingScene(1);
    for (let ms = 0; ms < 35_000; ms += 100) gate.update({ scene, goalRequired: true }, ms);
    Object.assign(scene, { status: 'ready', label });
    expect(gate.update({ scene, goalRequired: true }, 35_000).play).toBe(false);
  }
});

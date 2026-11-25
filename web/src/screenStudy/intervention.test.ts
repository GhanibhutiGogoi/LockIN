import { expect, it } from 'vitest';
import { ScreenIntervention } from './intervention';

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

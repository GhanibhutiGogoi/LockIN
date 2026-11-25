import { expect, it } from 'vitest';
import { ScreenTimeline } from './timeline';
import { ScreenIntervention } from './intervention';

it('triggers while continuously scrolling a novel faster than OCR/classification can finish', () => {
  const timeline = new ScreenTimeline(0, 'Outlier detection');
  const gate = new ScreenIntervention();
  const first = timeline.observe(0, true, 1600, 900, 'monitor');
  let current = first;
  let result;
  for (let ms = 0; ms <= 40_000; ms += 200) {
    current = timeline.observe(ms, ms % 800 === 0, 1600, 900, 'monitor', true);
    // The initial novel screenshot only finishes classification after many scrolls.
    if (ms === 32_000) Object.assign(first, { status: 'ready', label: 'off-topic', classifiedAt: ms });
    result = gate.update({ scene: current, goalRequired: true }, ms, 20_000, (s, t) => timeline.resolve(s, t));
    if (ms < 32_000) expect(result.play).toBe(false);
    else expect(result).toMatchObject({ play: true, risk: 'content' });
  }
  expect(result!.durationMs).toBe(40_000);
  expect(current.label).toBe('checking'); // Never falsify the screenshot's actual label.
  expect(timeline.resolve(current, 40_000).classificationSourceId).toBe(first.id);
});

it('does not carry a novel label to a different document or across capture interruptions', () => {
  const timeline = new ScreenTimeline(0, 'Outlier detection');
  const novel = timeline.observe(0, true, 100, 50, 'monitor');
  Object.assign(novel, { status: 'ready', label: 'off-topic', classifiedAt: 1000 });
  const switched = timeline.observe(1000, true, 100, 50, 'monitor', false);
  expect(timeline.resolve(switched, 1100).label).toBe('checking');
  timeline.breakScene(1200);
  const resumed = timeline.observe(1300, true, 100, 50, 'monitor', true);
  expect(resumed.documentId).not.toBe(novel.documentId);
  expect(timeline.resolve(resumed, 1400).label).toBe('checking');
});

it('stops reusing an old decision after 60 seconds and respects newer related/uncertain decisions', () => {
  for (const label of ['related', 'uncertain', 'unavailable'] as const) {
    const timeline = new ScreenTimeline(0, 'Outliers');
    const novel = timeline.observe(0, true, 100, 50, 'monitor');
    Object.assign(novel, { status: 'ready', label: 'off-topic', classifiedAt: 1000 });
    let current = novel;
    for (let ms = 1000; ms <= 63_000; ms += 1000) current = timeline.observe(ms, true, 100, 50, 'monitor', true);
    expect(timeline.resolve(current, 63_000).label).toBe('checking');
    Object.assign(current, { status: 'ready', label, classifiedAt: 63_100 });
    const next = timeline.observe(64_000, true, 100, 50, 'monitor', true);
    expect(timeline.resolve(next, 64_100).label).not.toBe('off-topic');
  }
});

it('still excludes missing gaze and ends distraction after returning to classified study text', () => {
  const timeline = new ScreenTimeline(0, 'Outliers'), gate = new ScreenIntervention();
  let scene = timeline.observe(0, true, 100, 50, 'monitor');
  Object.assign(scene, { status: 'ready', label: 'off-topic', classifiedAt: 1 });
  const resolve = (s: typeof scene, t: number) => timeline.resolve(s, t);
  for (let ms = 0; ms <= 20_000; ms += 200) {
    scene = timeline.observe(ms, ms % 800 === 0, 100, 50, 'monitor', true);
    gate.update({ scene, goalRequired: true }, ms, 20_000, resolve);
  }
  for (let ms = 20_200; ms <= 27_000; ms += 200) gate.update('unknown', ms, 20_000, resolve);
  expect(gate.update({ scene, goalRequired: true }, 27_200, 20_000, resolve)).toMatchObject({ play: false, durationMs: 0 });
  Object.assign(scene, { status: 'ready', label: 'related', classifiedAt: 27_300 });
  for (let ms = 27_400; ms <= 29_000; ms += 200) {
    expect(gate.update({ scene, goalRequired: true }, ms, 20_000, resolve).play).toBe(false);
  }
});

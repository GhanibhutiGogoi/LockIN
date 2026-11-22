import { describe, expect, it } from 'vitest';
import type { FocusSample } from '../contracts/types';
import { historicalFocus, ScreenTimeline } from './timeline';

const start = 1_700_000_000_000;
function sample(ms: number, state: 'screen' | 'away' | 'unknown' = 'screen'): FocusSample {
  return { t: start + ms, score: state === 'screen' ? 100 : 0, confidence: state === 'unknown' ? 0 : 1,
    gazeTracking: { state, awayMs: 0, thresholdMs: 30_000 } };
}
function gaze(timeline: ScreenTimeline, from = 0, to = 5000, state: 'screen' | 'away' | 'unknown' = 'screen') {
  for (let ms = from; ms < to; ms += 200) timeline.record(sample(ms, state), false, start + ms);
}
function scene(timeline: ScreenTimeline, from: number, to: number, label: 'related' | 'off-topic') {
  const scene = timeline.observe(start + from, true, 1600, 900, 'monitor');
  scene.observedUntil = start + to;
  Object.assign(scene, { status: 'ready', label, text: 'Example recognized text', completedAt: start + 15_000 });
  return scene;
}

describe('historical screen attention', () => {
  it('backfills original seconds after OCR arrives late', () => {
    const timeline = new ScreenTimeline(start, 'data mining');
    scene(timeline, 0, 5000, 'related'); gaze(timeline);
    const report = timeline.analyze(start + 5000);
    expect(report.windows[0]).toMatchObject({ focusedMs: 5000, unknownMs: 0 });
    expect(historicalFocus(report, start).map(s => s.t)).toEqual([0, 1, 2, 3, 4]);
  });
  it('never maps early gaze to the page visible at the end of a window', () => {
    const timeline = new ScreenTimeline(start, 'data mining');
    scene(timeline, 0, 3000, 'related'); scene(timeline, 3000, 5000, 'off-topic'); gaze(timeline);
    const report = timeline.analyze(start + 5000);
    expect(report.windows[0]).toMatchObject({ focusedMs: 3000, offTopicMs: 2000, sceneIds: [1, 2] });
    expect(historicalFocus(report, start).map(s => s.state)).toEqual(['focused', 'focused', 'focused', 'drifting', 'drifting']);
  });
  it('does not bridge camera gaps, skipped OCR or uncertain relevance', () => {
    const timeline = new ScreenTimeline(start, 'goal');
    const first = scene(timeline, 0, 5000, 'related'); first.label = 'uncertain';
    timeline.record(sample(0), false, start);
    const result = timeline.analyze(start + 5000);
    expect(result.windows[0].unknownMs).toBe(5000);
    expect(historicalFocus(result, start)).toEqual([]);
  });
  it('records away evidence without requiring OCR and excludes tracking loss', () => {
    const timeline = new ScreenTimeline(start, 'goal');
    gaze(timeline, 0, 3000, 'away'); gaze(timeline, 3000, 5000, 'unknown');
    expect(timeline.analyze(start + 5000).windows[0]).toMatchObject({ lookingAwayMs: 3000, unknownMs: 2000 });
  });
  it('excludes note taking and rescue time', () => {
    const timeline = new ScreenTimeline(start, 'goal');
    scene(timeline, 0, 1000, 'related');
    for (let ms = 0; ms < 1000; ms += 200) timeline.record(sample(ms, 'away'), true, start + ms);
    const report = timeline.analyze(start + 1000);
    expect(report.windows[0].excludedMs).toBe(1000);
    expect(historicalFocus(report, start)).toEqual([]);
  });
  it('does not reuse content after a capture gap or pause', () => {
    const timeline = new ScreenTimeline(start, 'goal');
    const first = timeline.observe(start, false, 1600, 900, 'monitor');
    expect(timeline.observe(start + 750, false, 1600, 900, 'monitor')).toBe(first);
    expect(timeline.live(start + 4000)).toBeUndefined();
    expect(timeline.observe(start + 4000, false, 1600, 900, 'monitor')).not.toBe(first);
    timeline.breakScene(); expect(timeline.live(start + 4000)).toBeUndefined();
  });
  it('excludes a camera-off pause without inventing missing gaze measurements', () => {
    const timeline = new ScreenTimeline(start, 'goal');
    scene(timeline, 0, 5000, 'related'); gaze(timeline);
    timeline.exclude(start + 1000, 'paused'); timeline.resume(start + 4000);
    const report = timeline.analyze(start + 5000);
    expect(report.windows[0]).toMatchObject({ focusedMs: 2000, excludedMs: 3000, unknownMs: 0 });
    expect(historicalFocus(report, start).map(s => s.t)).toEqual([0, 4]);
    const empty = new ScreenTimeline(start, 'goal');
    empty.exclude(start, 'intervention');
    expect(empty.analyze(start + 5000).windows[0]).toMatchObject({ excludedMs: 5000, unknownMs: 0 });
  });
  it('closes a recent page at the next capture instead of losing the capture interval', () => {
    const timeline = new ScreenTimeline(start, 'goal');
    const first = scene(timeline, 0, 750, 'related');
    scene(timeline, 1500, 3000, 'off-topic'); gaze(timeline, 0, 3000);
    expect(first.observedUntil).toBe(start + 1500);
    expect(timeline.analyze(start + 3000).summary).toMatchObject({ focusedMs: 1500, offTopicMs: 1500, unknownMs: 0 });
  });
  it('supports sparse but consistent fresh gaze, without extending across unknown or stale frames', () => {
    const timeline = new ScreenTimeline(start, 'goal');
    scene(timeline, 0, 8000, 'related');
    for (const ms of [0, 1000, 2000]) timeline.record(sample(ms), false, start + ms);
    timeline.record(sample(3000, 'unknown'), false, start + 3000);
    timeline.record(sample(7000), false, start + 7000);
    expect(timeline.analyze(start + 8000).summary).toMatchObject({ focusedMs: 2700, longestFocusMs: 2350, unknownMs: 5300 });
  });
});

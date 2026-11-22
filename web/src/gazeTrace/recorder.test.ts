import { describe, expect, it } from 'vitest';
import { GazeTraceRecorder } from './recorder';
import { buildTracePlot, traceIntervals } from './plot';
import { sameTraceGeometry } from './geometry';
import type { TraceObservation } from './types';

const observation: TraceObservation = {
  calibration: {
    id: 'cal-1', at: 900, model: 'blazegaze', validation: null,
    geometry: { width: 1920, height: 1080, screenWidth: 1920, screenHeight: 1080, windowX: 0, windowY: 0, pixelRatio: 1, fullscreen: true },
  },
  raw: { x: .2, y: .3 }, valid: true, reason: 'screen',
};

describe('gaze trace integrity', () => {
  it('records compatible window transitions and incompatible display changes with before/after evidence', () => {
    const recorder = new GazeTraceRecorder(1000);
    const calibration = { ...observation.calibration, coordinateSpace: 'screen' as const };
    const first = { ...observation, calibration, geometry: calibration.geometry };
    recorder.record(first, 1000, 1000);
    const resized = { ...first, geometry: { ...first.geometry, width: 1200, height: 700, fullscreen: false } };
    recorder.record(resized, 1200, 1200);
    recorder.record({ ...resized, geometry: { ...resized.geometry, pixelRatio: 1.5 }, valid: false, reason: 'geometry_changed' }, 1400, 1400);
    expect(recorder.trace.geometryEvents).toMatchObject([
      { t: 200, changed: ['width', 'height', 'fullscreen'], invalidates: false, before: { width: 1920 }, after: { width: 1200 } },
      { t: 400, changed: ['pixelRatio'], invalidates: true },
    ]);
    expect(recorder.trace.samples[1].segment).toBe(recorder.trace.samples[0].segment);
    expect(recorder.trace.samples[2].display).toBeNull();
  });
  it('retains timestamps and unbounded raw estimates, never plotting offscreen points at the edge', () => {
    const recorder = new GazeTraceRecorder(1000);
    recorder.record(observation, 1000, 1100);
    recorder.record({ ...observation, raw: { x: 1.4, y: -.2 } }, 1200, 1250);
    const [first, outside] = recorder.trace.samples;
    expect(first).toMatchObject({ t: 0, capturedAt: 1000, receivedAt: 1100, status: 'valid', raw: observation.raw, display: observation.raw });
    expect(outside).toMatchObject({ raw: { x: 1.4, y: -.2 }, status: 'outside', display: null });
  });

  it('drops duplicate, out-of-order and oversampled frames, but preserves brief tracking losses as breaks', () => {
    const recorder = new GazeTraceRecorder(1000);
    recorder.record(observation, 1000, 1000);
    recorder.record(observation, 1000, 1020);
    recorder.record(observation, 990, 1030);
    recorder.record({ ...observation, valid: false, reason: 'no_face' }, 1050, 1050);
    recorder.record(observation, 1100, 1100);
    expect(recorder.trace.samples).toHaveLength(2);
    expect(recorder.trace.samples[1].segment).not.toBe(recorder.trace.samples[0].segment);
    expect(buildTracePlot(recorder.trace.samples, false, 1000, 600).paths.join('')).not.toContain('L');
  });

  it('breaks over stalls, stale results, pauses and recalibration without smoothing across them', () => {
    const recorder = new GazeTraceRecorder(1000);
    const moved = { ...observation, raw: { x: .8, y: .7 } };
    recorder.record(observation, 1000, 1000);
    recorder.record(moved, 1100, 1100);
    expect(recorder.trace.samples[1].display!.x).toBeGreaterThan(.2);
    expect(recorder.trace.samples[1].display!.x).toBeLessThan(.8);
    recorder.record(moved, 2500, 2500);
    expect(recorder.trace.samples[2].display).toEqual(moved.raw);
    recorder.record(observation, 2600, 4000);
    recorder.record(moved, 4100, 4100);
    recorder.break();
    recorder.record(observation, 4200, 4200);
    recorder.record({ ...moved, calibration: { ...observation.calibration, id: 'cal-2' } }, 4300, 4300);
    expect(recorder.trace.samples[3]).toMatchObject({ status: 'stale', display: null });
    expect(new Set(recorder.trace.samples.slice(2).map(s => s.segment)).size).toBe(5);
    expect(recorder.trace.calibrations).toHaveLength(2);
    expect(traceIntervals(recorder.trace.samples)).toHaveLength(5);
  });

  it('bounds storage and reports truncation', () => {
    const recorder = new GazeTraceRecorder(0);
    for (let i = 0; i <= 72_000; i++) recorder.record(observation, i * 100, i * 100);
    expect(recorder.trace.samples.length).toBeLessThanOrEqual(72_000);
    expect(recorder.trace.samples.length + recorder.trace.droppedSamples).toBe(72_001);
    expect(recorder.trace.samples[0].t).toBeGreaterThan(0);
  });

  it('invalidates changed dimensions, scale, location and fullscreen state', () => {
    const geometry = observation.calibration.geometry;
    expect(sameTraceGeometry(geometry, { ...geometry })).toBe(true);
    for (const patch of [{ width: 1200 }, { screenWidth: 2560 }, { pixelRatio: 1.5 }, { windowX: 1920 }, { fullscreen: false }]) {
      expect(sameTraceGeometry(geometry, { ...geometry, ...patch })).toBe(false);
    }
  });
});

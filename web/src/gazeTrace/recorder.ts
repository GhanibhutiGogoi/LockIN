import type { GazeTrace, TraceObservation, TracePoint, TraceSample } from './types';
import { changedGeometry } from './geometry';

const SAMPLE_MS = 100;
const MAX_GAP_MS = 1200;
const MAX_SAMPLES = 72_000;
const finite = (p: TracePoint | null): p is TracePoint => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
const inside = (p: TracePoint) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;

/** Records real observations only; independent of OCR and attention scoring. */
export class GazeTraceRecorder {
  readonly trace: GazeTrace = {
    version: 2, coordinateSpace: 'calibration-normalized', geometryEvents: [], droppedGeometryEvents: 0,
    sampleHz: 1000 / SAMPLE_MS, maxGapMs: MAX_GAP_MS, smoothing: 'ema-150ms',
    calibrations: [], samples: [], droppedSamples: 0,
  };
  private lastCapture = -Infinity;
  private lastStored = -Infinity;
  private segment = 0;
  private previous: TraceSample | null = null;
  private geometry?: { calibrationId: string; value: TraceObservation['geometry'] };

  constructor(private readonly startedAt: number) {}

  break() {
    this.previous = null;
  }

  record(observation: TraceObservation | undefined, capturedAt: number, receivedAt: number) {
    if (!observation || !Number.isFinite(capturedAt) || capturedAt < this.startedAt || capturedAt <= this.lastCapture) return;
    this.lastCapture = capturedAt;
    const { calibration, valid, reason } = observation;
    const geometry = observation.geometry ?? calibration.geometry;
    const before = this.geometry?.calibrationId === calibration.id ? this.geometry.value ?? calibration.geometry : calibration.geometry;
    const changed = changedGeometry(before, geometry);
    if (changed.length) {
      this.trace.geometryEvents!.push({ t: capturedAt - this.startedAt, calibrationId: calibration.id,
        before, after: geometry, changed,
        invalidates: changedGeometry(calibration.geometry, geometry, calibration.coordinateSpace).length > 0 });
      if (this.trace.geometryEvents!.length > 1000) { this.trace.geometryEvents!.shift(); this.trace.droppedGeometryEvents!++; }
    }
    this.geometry = { calibrationId: calibration.id, value: geometry };
    const raw = finite(observation.raw) ? { ...observation.raw } : null;
    const age = receivedAt - capturedAt;
    const status: TraceSample['status'] = age < 0 || age >= MAX_GAP_MS ? 'stale'
      : !valid || !raw ? 'invalid' : !inside(raw) ? 'outside' : 'valid';
    // Even an invalid frame discarded by the rate limit must break the line.
    if (status !== 'valid') this.break();
    if (capturedAt - this.lastStored < SAMPLE_MS) return;
    this.lastStored = capturedAt;
    if (!this.trace.calibrations.some(c => c.id === calibration.id)) this.trace.calibrations.push(calibration);
    const previous = this.previous;
    const connected = previous && previous.calibrationId === calibration.id && capturedAt - previous.capturedAt < MAX_GAP_MS;
    if (!connected) this.segment++;
    let display: TracePoint | null = null;
    if (status === 'valid' && raw) {
      const alpha = connected ? 1 - Math.exp(-(capturedAt - previous.capturedAt) / 150) : 1;
      display = {
        x: raw.x * alpha + (previous?.display?.x ?? raw.x) * (1 - alpha),
        y: raw.y * alpha + (previous?.display?.y ?? raw.y) * (1 - alpha),
      };
    }
    const sample: TraceSample = {
      t: capturedAt - this.startedAt, capturedAt, receivedAt,
      calibrationId: calibration.id, segment: this.segment, raw, display, status,
      reason: status === 'stale' ? 'stale_frame' : status === 'outside' ? 'outside_viewport' : reason,
    };
    this.trace.samples.push(sample);
    this.previous = status === 'valid' ? sample : null;
    if (this.trace.samples.length > MAX_SAMPLES) {
      this.trace.samples.splice(0, 1000);
      this.trace.droppedSamples += 1000;
      const ids = new Set(this.trace.samples.map(s => s.calibrationId));
      this.trace.calibrations = this.trace.calibrations.filter(c => ids.has(c.id));
    }
  }
}

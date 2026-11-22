import type { CalibrationGeometry } from '../../../gaze-demo/backend/static/calibration-geometry.js';
export type TraceGeometry = CalibrationGeometry;

export interface TraceCalibration {
  coordinateSpace?: 'screen' | 'viewport';
  id: string;
  at: number;
  model: string;
  geometry: TraceGeometry;
  validation: { passed: boolean; meanErrorPx: number; maxErrorPx: number } | null;
}

export interface TracePoint { x: number; y: number }

/** Top-left calibration-area coordinates, normalised but not clamped. */
export interface TraceObservation {
  geometry?: TraceGeometry;
  calibration: TraceCalibration;
  raw: TracePoint | null;
  valid: boolean;
  reason: string;
}

export interface TraceSample {
  t: number;
  capturedAt: number;
  receivedAt: number;
  calibrationId: string;
  segment: number;
  raw: TracePoint | null;
  display: TracePoint | null;
  status: 'valid' | 'outside' | 'invalid' | 'stale';
  reason: string;
}

export interface TraceGeometryEvent {
  t: number;
  calibrationId: string;
  before: TraceGeometry;
  after: TraceGeometry;
  changed: (keyof TraceGeometry)[];
  invalidates: boolean;
}

export interface GazeTrace {
  version: 1 | 2;
  coordinateSpace: 'calibrated-viewport-normalized' | 'calibration-normalized';
  geometryEvents?: TraceGeometryEvent[];
  droppedGeometryEvents?: number;
  sampleHz: number;
  maxGapMs: number;
  smoothing: 'ema-150ms';
  calibrations: TraceCalibration[];
  samples: TraceSample[];
  droppedSamples: number;
}

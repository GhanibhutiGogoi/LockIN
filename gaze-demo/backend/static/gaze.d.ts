import type { CalibrationFitDiagnostics, CalibrationPointSummary } from '../../src/core/calibration-types';
import type { ATTENTION_TIMING } from './attention-policy.js';

export interface TrackerRuntimeDiagnostic {
  model: string;
  ruleVersion: string;
  timing: typeof ATTENTION_TIMING;
  capturedAt: number;
  reason: string;
  rawOutside: boolean | null;
  confirmedOutside: boolean | null;
  face: boolean;
  eyesOpen: boolean;
  eyeAspect: number[] | null;
  head: number[] | null;
  features: number[] | null;
  mappedGaze: number[] | null;
  phase: string;
  awayMs: number;
  returnMs: number;
  lastReset: { reason: string; captured_at_ms: number | null; away_ms: number } | null;
}

export interface GazeCalibrationTarget {
  x: number;
  y: number;
  index: number;
  total: number;
  validation: boolean;
  count: number;
  recheck?: boolean;
  awaitingStart?: boolean;
}

export interface GazeObservation {
  capturedAt: number;
  diagnostic?: TrackerRuntimeDiagnostic;
  sample: {
    valid: boolean;
    calibrated: boolean;
    on_screen: boolean | null;
    x: number | null;
    y: number | null;
    eyes_open?: boolean;
    reason?: string | null;
  };
  offscreen: {
    count: number;
    state: 'screen' | 'candidate' | 'away' | 'recovering' | 'unknown';
    away_ms: number;
    threshold_ms: number;
    return_ms?: number;
  };
}

export interface TrackerCalibrationDiagnostics {
  issue: string | null;
  frames: { usable: number; noFace: number; eyesUnavailable: number; noGaze: number };
  camera: [number, number] | null;
  method?: 'median-7-affine-v1';
  fit?: CalibrationFitDiagnostics | null;
  points?: (CalibrationPointSummary & {
    index: number;
    mode: 'calibration' | 'validation' | 'quick-check';
    target: number[];
    durationMs: number;
    errorNormalized: number | null;
    errorPx: number | null;
  })[];
  validation: {
    passed: boolean;
    meanErrorPx: number;
    maxErrorPx: number;
    maxNormalizedError: number;
    threshold: number;
    pointErrorsPx: number[];
  } | null;
}

export class GazeCapture {
  constructor(
    video: HTMLVideoElement,
    status: (message: string) => void,
    options?: {
      assetBase?: string;
      model?: 'blazegaze' | 'eyetheia';
      onObservation?: (observation: GazeObservation) => void;
      onCalibrationPoint?: (target: GazeCalibrationTarget | null) => void;
      manualStages?: boolean;
    },
  );
  readonly ready: boolean;
  readonly canRecheck: boolean;
  readonly suspended: boolean;
  readonly calibrated: boolean;
  readonly phase: 'idle' | 'points' | 'fitting' | 'validation' | 'awaiting-start';
  readonly calibrationIssue: string | null;
  start(stream?: MediaStream): Promise<void>;
  stop(): void;
  suspend(): boolean;
  resume(stream: MediaStream): Promise<boolean>;
  revalidate(): boolean;
  calibrate(): void;
  startCalibrationStage(): void;
  resetDiagnosticFrames(): void;
  calibrationDiagnostics(): TrackerCalibrationDiagnostics;
  cancel(): void;
}

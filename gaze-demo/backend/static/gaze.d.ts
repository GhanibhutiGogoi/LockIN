export interface GazeCalibrationTarget {
  x: number;
  y: number;
  index: number;
  total: number;
  validation: boolean;
  count: number;
  recheck?: boolean;
}

export interface GazeObservation {
  capturedAt: number;
  sample: {
    valid: boolean;
    calibrated: boolean;
    on_screen: boolean | null;
    x: number | null;
    y: number | null;
  };
  offscreen: {
    count: number;
    state: 'screen' | 'candidate' | 'away' | 'recovering' | 'unknown';
    away_ms: number;
    threshold_ms: number;
  };
}

export interface TrackerCalibrationDiagnostics {
  issue: string | null;
  frames: { usable: number; noFace: number; eyesUnavailable: number; noGaze: number };
  camera: [number, number] | null;
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
    },
  );
  readonly ready: boolean;
  readonly canRecheck: boolean;
  readonly suspended: boolean;
  readonly calibrated: boolean;
  readonly phase: 'idle' | 'points' | 'fitting' | 'validation';
  readonly calibrationIssue: string | null;
  start(stream?: MediaStream): Promise<void>;
  stop(): void;
  suspend(): boolean;
  resume(stream: MediaStream): Promise<boolean>;
  revalidate(): boolean;
  calibrate(): void;
  resetDiagnosticFrames(): void;
  calibrationDiagnostics(): TrackerCalibrationDiagnostics;
  cancel(): void;
}

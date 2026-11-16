import { GazeCapture, type GazeObservation, type TrackerCalibrationDiagnostics } from '../../../../gaze-demo/backend/static/gaze.js';
import type { AttentionProvider, AttentionStatus, CalibrationTarget } from '../../contracts/providers';
import type { FocusSample } from '../../contracts/types';

export class LocalGazeProvider implements AttentionProvider {
  readonly name: string;
  readonly usesOffscreenRule = true;
  constructor(readonly calibrationModel: 'blazegaze' | 'eyetheia' = 'blazegaze') {
    this.name = calibrationModel === 'eyetheia' ? 'EyeTheia + MediaPipe' : 'BlazeGaze + MediaPipe';
  }
  private capture: GazeCapture | null = null;
  private startupDiagnostics: TrackerCalibrationDiagnostics | null = null;
  private skipped = false;
  private reportedIssue: string | null = null;
  private lastOffscreenEvent = 0;
  private lifecycle = 0;
  private fallback?: CalibrationTarget['fallback'];
  private samples = new Set<(sample: FocusSample) => void>();
  private statuses = new Set<(status: AttentionStatus, detail?: string) => void>();
  private startup: { resolve: () => void; reject: (error: Error) => void } | null = null;
  private calibration: {
    show: (target: CalibrationTarget | null) => void;
    finish: (error?: Error) => void;
    retryFull: () => boolean;
  } | null = null;

  get needsCamera() {
    return !this.skipped;
  }

  get needsCalibration() {
    return !this.skipped && !this.capture?.calibrated;
  }

  prepareCalibration() {
    this.skipped = false;
    this.startupDiagnostics = null;
  }

  skipCalibration() {
    this.skipped = true;
  }

  async start(stream: MediaStream | null) {
    if (this.skipped) return;
    if (!stream) throw new Error('Allow camera access before starting gaze tracking.');
    const previous = this.capture;
    let fallback: CalibrationTarget['fallback'];
    if (previous?.suspended) {
      let resumed;
      try {
        resumed = await previous.resume(stream);
      } catch (error) {
        if (this.capture === previous) await this.stop();
        throw error;
      }
      if (this.capture !== previous) throw new Error('Gaze tracking stopped.');
      if (resumed) {
        this.lastOffscreenEvent = 0;
        this.emitStatus('running', 'Camera reopened for a quick calibration check.');
        return;
      }
      fallback = 'geometry';
    }

    const stopped = this.stop();
    const lifecycle = this.lifecycle;
    await stopped;
    if (lifecycle !== this.lifecycle) throw new Error('Gaze tracking stopped.');
    if (this.skipped) return;
    this.fallback = fallback;
    this.lastOffscreenEvent = 0;
    this.reportedIssue = null;

    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    const assetBase = new URL(import.meta.env.BASE_URL + 'tracker', location.href).href;
    const capture = new GazeCapture(video, (message) => this.onCaptureStatus(capture, message), {
      assetBase,
      model: this.calibrationModel,
      onObservation: (observation) => this.publish(observation),
      onCalibrationPoint: (target) => this.calibration?.show(
        target && !target.recheck && this.fallback ? { ...target, fallback: this.fallback } : target,
      ),
    });
    this.capture = capture;

    const ready = new Promise<void>((resolve, reject) => { this.startup = { resolve, reject }; });
    const timer = setTimeout(() => this.startup?.reject(new Error('Gaze model did not load. Check the local tracker assets.')), 45_000);
    this.emitStatus('starting');
    try {
      await Promise.all([capture.start(stream), ready]);
      if (this.capture !== capture) throw new Error('Gaze tracking stopped.');
      this.emitStatus('running', 'Local gaze model loaded. Calibrate to enable attention detection.');
    } catch (error) {
      if (this.capture === capture) {
        const diagnostic = capture.calibrationDiagnostics();
        this.startupDiagnostics = { ...diagnostic, issue: diagnostic.issue ?? 'startup_failed' };
        await this.stop();
        this.emitStatus('error', (error as Error).message);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  suspend() {
    if (!this.capture?.suspend()) return false;
    this.fallback = undefined;
    this.emitStatus('stopped');
    return true;
  }

  async stop() {
    this.lifecycle++;
    this.fallback = undefined;
    this.startup?.reject(new Error('Gaze tracking stopped.'));
    this.startup = null;
    this.calibration?.finish(new Error('Gaze tracking stopped.'));
    const capture = this.capture;
    this.capture = null;
    capture?.stop();
    if (capture) this.emitStatus('stopped');
  }

  onSample(cb: (sample: FocusSample) => void) {
    this.samples.add(cb);
    return () => this.samples.delete(cb);
  }

  onStatus(cb: (status: AttentionStatus, detail?: string) => void) {
    this.statuses.add(cb);
    return () => this.statuses.delete(cb);
  }

  async calibrate(show: (target: CalibrationTarget | null) => void, signal: AbortSignal) {
    signal.throwIfAborted();
    const capture = this.capture;
    if (!capture?.ready) throw new Error('Start the camera and wait for the gaze model to load.');
    if (this.calibration) throw new Error('Calibration is already running.');
    this.skipped = false;
    this.reportedIssue = null;
    capture.resetDiagnosticFrames();
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        finish(new Error('Calibration cancelled.'));
        capture.cancel();
      };
      const finish = (error?: Error) => {
        this.calibration = null;
        signal.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolve();
      };
      let quick = capture.canRecheck;
      const startFull = () => {
        quick = false;
        try { capture.calibrate(); }
        catch (error) { finish(error as Error); }
      };
      const retryFull = () => {
        if (!quick || !capture.ready) return false;
        this.fallback = 'verification';
        startFull();
        return true;
      };
      this.calibration = { show, finish, retryFull };
      signal.addEventListener('abort', abort, { once: true });
      try {
        if (!capture.revalidate()) startFull();
      } catch (error) {
        finish(error as Error);
      }
    });
  }

  calibrationDiagnostics() {
    return this.capture?.calibrationDiagnostics() ?? this.startupDiagnostics;
  }

  private onCaptureStatus(capture: GazeCapture, message: string) {
    if (this.capture !== capture) return;
    if (this.startup) {
      if (capture.ready) {
        this.startup.resolve();
        this.startup = null;
      } else if (capture.calibrationIssue) {
        this.startup.reject(new Error(message));
        this.startup = null;
      }
      return;
    }
    const calibration = this.calibration;
    if (calibration && capture.phase === 'idle') {
      if (capture.calibrated) {
        this.fallback = undefined;
        calibration.finish();
      } else if (!calibration.retryFull()) {
        calibration.finish(new Error(message));
      }
    }
    const issue = capture.calibrationIssue;
    if (issue !== this.reportedIssue && (issue === 'viewport_changed' || issue === 'camera_geometry_changed' || issue === 'worker_error')) {
      this.reportedIssue = issue;
      this.emitStatus('error', message);
    }
  }

  private emitStatus(status: AttentionStatus, detail?: string) {
    this.statuses.forEach((cb) => cb(status, detail));
  }

  private publish({ sample, offscreen, capturedAt }: GazeObservation) {
    const valid = sample.valid && sample.calibrated && sample.on_screen !== null;
    const offscreenLapse = valid && !sample.on_screen && offscreen.count > this.lastOffscreenEvent;
    this.lastOffscreenEvent = offscreen.count;
    const result: FocusSample = {
      t: Math.floor(performance.timeOrigin + capturedAt),
      score: valid && sample.on_screen ? 100 : 0,
      confidence: valid ? 1 : 0,
      offscreenLapse,
      gazeTracking: {
        state: offscreen.state,
        awayMs: offscreen.away_ms,
        thresholdMs: offscreen.threshold_ms,
      },
    };
    if (valid) {
      result.signals = { gaze: Number(sample.on_screen), eyesOpen: 1, facePresent: 1 };
      if (sample.on_screen && sample.x !== null && sample.y !== null) {
        const x = sample.x + 0.5;
        const y = sample.y + 0.5;
        if (x >= 0 && x <= 1 && y >= 0 && y <= 1) result.gazePoint = { x, y };
      }
    }
    this.samples.forEach((cb) => cb(result));
  }
}

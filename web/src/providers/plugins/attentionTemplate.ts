/**
 * Skeleton for an in-browser attention provider.
 *
 * It uses the camera stream the UI already opened (one camera, one indicator)
 * and emits FocusSample ~10 Hz. This template only checks average frame
 * brightness change as a stand-in "face present" signal — replace `analyse()`
 * with MediaPipe Face Landmarker + WebEyeTrack.
 *
 * Rules the UI relies on:
 *  - score is 0–100 from the camera only; the UI adds window focus itself
 *  - set confidence < 0.3 for frames you can't trust (glare, dark) — they are ignored
 *  - never upload or store frames
 */
import type { AttentionProvider, AttentionStatus, Unsubscribe } from '../../contracts/providers';
import type { CalibrationPoint, FocusSample } from '../../contracts/types';

export class CameraTemplateProvider implements AttentionProvider {
  readonly name = 'Camera template';
  readonly needsCamera = true;
  private video: HTMLVideoElement | null = null;
  private canvas = document.createElement('canvas');
  private timer: number | null = null;
  private subs = new Set<(s: FocusSample) => void>();
  private statusSubs = new Set<(s: AttentionStatus, d?: string) => void>();

  async start(stream: MediaStream | null) {
    if (!stream) throw new Error('Camera template needs the camera stream');
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = stream;
    await this.video.play();
    this.canvas.width = 32;
    this.canvas.height = 24;
    this.statusSubs.forEach((f) => f('running'));
    this.timer = window.setInterval(() => this.analyse(), 100);
  }

  async stop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (this.video) this.video.srcObject = null;
    this.statusSubs.forEach((f) => f('stopped'));
  }

  onSample(cb: (s: FocusSample) => void): Unsubscribe {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }
  onStatus(cb: (s: AttentionStatus, d?: string) => void): Unsubscribe {
    this.statusSubs.add(cb);
    return () => this.statusSubs.delete(cb);
  }

  async calibratePoint(_p: CalibrationPoint) {
    // TODO(gaze team): collect iris/head samples while the user looks at _p
    await new Promise((r) => setTimeout(r, 1000));
  }
  async finishCalibration() {
    // TODO(gaze team): fit the per-user screen range from the collected samples
  }

  private analyse() {
    const v = this.video;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!v || !ctx || v.readyState < 2) return;
    ctx.drawImage(v, 0, 0, 32, 24);
    const px = ctx.getImageData(0, 0, 32, 24).data;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2];
    const brightness = sum / (px.length / 4) / 765;
    const confidence = brightness < 0.08 ? 0.1 : 0.6; // too dark → don't trust
    const sample: FocusSample = { t: Date.now(), score: 80, confidence, signals: { facePresent: 1 } };
    this.subs.forEach((f) => f(sample));
  }
}

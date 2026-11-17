import { ATTENTION_TIMING } from '../backend/static/attention-policy.js';

export interface Landmark { x: number; y: number }
export interface Envelope { low: number[]; high: number[] }
export type RuleState = 'unknown' | 'screen' | 'candidate' | 'away' | 'recovering';

// Iris offsets use the eye width, not the eyelid opening, as the scale.
// This avoids unstable division when a user blinks or squints.
export function featuresFrom(input: { landmarks: Landmark[]; head: number[]; eyesOpen: boolean }): number[] | null {
  if (!input.eyesOpen || input.landmarks.length < 478 || input.head.length < 3) return null;
  const { landmarks: p, head } = input;
  function eye(iris: number, a: number, b: number): number[] | null {
    const dx = p[b].x - p[a].x, dy = p[b].y - p[a].y;
    const w2 = dx * dx + dy * dy;
    if (!Number.isFinite(w2) || w2 < 0.00001) return null;
    const x = p[iris].x - (p[a].x + p[b].x) / 2;
    const y = p[iris].y - (p[a].y + p[b].y) / 2;
    const offset = [(x * dx + y * dy) / w2, (-x * dy + y * dx) / w2];
    // Reject implausible iris positions instead of treating lost landmarks as gaze.
    return Math.abs(offset[0]) <= .65 && Math.abs(offset[1]) <= .5 ? offset : null;
  }
  const l = eye(468, 33, 133), r = eye(473, 362, 263);
  if (!l || !r) return null;
  const f = [head[0], head[1], ...l, ...r];
  return f.every(Number.isFinite) ? f : null;
}

export function quantile(values: number[], q: number): number {
  const a = [...values].sort((x, y) => x - y);
  const t = Math.max(0, Math.min(a.length - 1, (a.length - 1) * q));
  const i = Math.floor(t);
  return a[i] + (a[Math.min(i + 1, a.length - 1)] - a[i]) * (t - i);
}

export function fitEnvelope(samples: number[][]): Envelope {
  const good = samples.filter(s => s.length === 6 && s.every(Number.isFinite));
  if (good.length < 9) throw new Error('Not enough valid calibration samples. Please recalibrate.');
  return {
    low: sample.map((_, i) => quantile(good.map(s => s[i]), 0.02)),
    high: sample.map((_, i) => quantile(good.map(s => s[i]), 0.98)),
  };
}
const sample = [0, 0, 0, 0, 0, 0];

export function headOutside(head: number[], e: Envelope, tolerance = 1): boolean {
  return [0, 1].some(i => {
    const margin = Math.max(.25, (e.high[i] - e.low[i]) * .75) * tolerance;
    return head[i] < e.low[i] - margin || head[i] > e.high[i] + margin;
  });
}

export function attentionEvidence(input: {
  face: boolean; head: number[]; eyesOpen: boolean; eyeAspect?: number[];
  features: number[] | null; mappedGaze?: number[];
}, envelope: Envelope | null, tolerance = 1) {
  const decision = (outside: boolean | null, reason: string, confirmMs = ATTENTION_TIMING.awayConfirmMs) => ({ outside, reason, confirmMs });
  if (!input.face) return decision(null, 'no_face');
  if (!envelope) return decision(null, 'uncalibrated');
  const headValid = input.head.length === 3 && input.head.every(Number.isFinite) && Math.abs(Math.hypot(...input.head) - 1) < .1;
  // Reliable head orientation remains usable when downward gaze hides the eyes.
  if (headValid && headOutside(input.head, envelope, tolerance)) return decision(true, 'head_away');
  const bothClosed = input.eyeAspect?.length === 2 && input.eyeAspect.every(v => Number.isFinite(v) && v >= 0 && v < .2);
  if (bothClosed) return decision(true, 'eyes_closed', ATTENTION_TIMING.eyesClosedMs);
  if (!input.eyesOpen) return decision(null, 'eyes_unavailable');
  if (!input.features) return decision(null, 'invalid_eye_geometry');
  const outside = outsideEvidence(input.features, envelope, tolerance, input.mappedGaze);
  return decision(outside, outside === null ? 'conflicting_evidence' : outside ? 'gaze_away' : 'screen');
}

export function outsideEvidence(f: number[], e: Envelope, tolerance: number, mappedGaze: number[] | undefined): boolean | null {
  if (f.length !== 6 || !f.every(Number.isFinite)) return null;
  const floors = [0.08, 0.08, 0.06, 0.04, 0.06, 0.04];
  const outside = f.map((x, i) => {
    const margin = Math.max(floors[i], (e.high[i] - e.low[i]) * 0.25) * tolerance;
    return x < e.low[i] - margin ? -1 : x > e.high[i] + margin ? 1 : 0;
  });
  const opposingEyes = [2, 3].some(i => outside[i] * outside[i + 2] < 0);
  if (opposingEyes) return null;
  const bothEyes = [2, 3].some(i => outside[i] !== 0 && outside[i] === outside[i + 2]);
  const oneEye = outside.slice(2).some(Boolean) && !bothEyes;
  const gazeValid = mappedGaze?.length === 2 && mappedGaze.every(Number.isFinite);
  const gazeOutside = gazeValid && mappedGaze.some(v => Math.abs(v) > .55);
  const gazeInside = gazeValid && mappedGaze.every(v => Math.abs(v) <= .5);
  const strongHead = headOutside(f, e, tolerance);
  // Clear bilateral eye departure or a substantial head turn can outvote a biased gaze prediction.
  if (bothEyes || (strongHead && !oneEye)) return true;
  if (oneEye) return null;
  if (gazeOutside && (outside[0] !== 0 || outside[1] !== 0)) return true;
  if (gazeInside) return false;
  return null;
}

export class ScreenEvidence {
  private previous: number | null = null;
  private previousOutside: boolean | null = null;
  private unknownSince: number | null = null;
  private elapsed = 0;
  private frames = 0;
  private returnMs = 0;
  private confirmed = false;
  private pendingConfirmMs = ATTENTION_TIMING.awayConfirmMs;
  reset() { this.previous = null; this.previousOutside = null; this.unknownSince = null; this.elapsed = 0; this.frames = 0; this.returnMs = 0; this.confirmed = false; this.pendingConfirmMs = ATTENTION_TIMING.awayConfirmMs; }
  update(now: number, outside: boolean | null, confirmMs = ATTENTION_TIMING.awayConfirmMs): boolean | null {
    if (!Number.isFinite(now)) { this.reset(); return null; }
    if (this.previous !== null && (now <= this.previous || now - this.previous >= ATTENTION_TIMING.staleFrameMs)) this.reset();
    const gap = this.previous === null ? 0 : now - this.previous;
    if (outside === null) {
      this.unknownSince ??= now;
      if (now - this.unknownSince > ATTENTION_TIMING.unknownGraceMs) { this.elapsed = 0; this.frames = 0; this.confirmed = false; }
      this.returnMs = 0;
      this.previous = now; this.previousOutside = null;
      return null;
    }
    if (this.unknownSince !== null && now - this.unknownSince > ATTENTION_TIMING.unknownGraceMs) { this.elapsed = 0; this.frames = 0; this.confirmed = false; }
    this.unknownSince = null;
    if (outside && confirmMs !== this.pendingConfirmMs) {
      if (!this.confirmed) { this.elapsed = 0; this.frames = 0; this.previousOutside = null; }
      this.pendingConfirmMs = confirmMs;
    }
    if (outside && this.previousOutside === true) this.elapsed += gap;
    if (!outside && this.previousOutside === false) this.returnMs += gap;
    this.previous = now;
    this.previousOutside = outside;
    if (!outside) {
      if (!this.confirmed || this.returnMs >= ATTENTION_TIMING.screenReturnMs) { this.elapsed = 0; this.frames = 0; this.confirmed = false; }
      return false;
    }
    this.returnMs = 0;
    this.frames++;
    // Brief uncertainty pauses confirmation without adding unobserved time.
    if (this.elapsed >= confirmMs && this.frames >= 3) this.confirmed = true;
    return this.confirmed ? true : null;
  }
}

export class DwellRule {
  private previous: number | null = null;
  private awayMs = 0;
  private returnMs = 0;
  private confirmed = false;
  private previousEvidence: boolean | null = null;
  reset() { this.previous = null; this.previousEvidence = null; this.awayMs = 0; this.returnMs = 0; this.confirmed = false; }
  update(now: number, outside: boolean | null, seconds: number): { state: RuleState; awayMs: number; progress: number } {
    const dt = this.previous === null ? 0 : now - this.previous;
    this.previous = now;
    if (outside === null || dt < 0 || dt > 1000) {
      this.awayMs = 0; this.returnMs = 0; this.confirmed = false;
      this.previousEvidence = null;
      if (outside === null) return { state: 'unknown', awayMs: 0, progress: 0 };
    }
    const elapsed = dt >= 0 && dt <= 1000 && this.previousEvidence === outside ? dt : 0;
    this.previousEvidence = outside;
    if (outside) {
      this.awayMs += elapsed;
      this.returnMs = 0;
      if (this.awayMs >= seconds * 1000) this.confirmed = true;
      return { state: this.confirmed ? 'away' : 'candidate', awayMs: this.awayMs, progress: Math.min(1, this.awayMs / (seconds * 1000)) };
    }
    this.returnMs += elapsed;
    if (this.returnMs >= ATTENTION_TIMING.screenReturnMs) { this.confirmed = false; this.awayMs = 0; }
    return { state: this.awayMs > 0 ? 'recovering' : 'screen', awayMs: this.awayMs, progress: Math.min(1, this.awayMs / (seconds * 1000)) };
  }
}

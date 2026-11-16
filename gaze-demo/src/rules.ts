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
    return [(x * dx + y * dy) / w2, (-x * dy + y * dx) / w2];
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
  if (good.length < 9) throw new Error('有效校准样本不足，请重新校准');
  return {
    low: sample.map((_, i) => quantile(good.map(s => s[i]), 0.02)),
    high: sample.map((_, i) => quantile(good.map(s => s[i]), 0.98)),
  };
}
const sample = [0, 0, 0, 0, 0, 0];

export function outsideEvidence(f: number[], e: Envelope, tolerance: number): boolean {
  const floors = [0.08, 0.08, 0.06, 0.04, 0.06, 0.04];
  const outside = f.map((x, i) => {
    const margin = Math.max(floors[i], (e.high[i] - e.low[i]) * 0.25) * tolerance;
    return x < e.low[i] - margin || x > e.high[i] + margin;
  });
  // Either a clear head turn, or a consistent departure in both eyes.
  return outside[0] || outside[1] || ((outside[2] || outside[3]) && (outside[4] || outside[5]));
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
    this.awayMs = 0;
    this.returnMs += elapsed;
    if (this.returnMs >= 1000) this.confirmed = false;
    return { state: this.confirmed ? 'recovering' : 'screen', awayMs: 0, progress: 0 };
  }
}

import type { Evidence, Observation } from './types.ts';
export function classify(o: Observation): Evidence {
  if (!Number.isFinite(o.t) || !o.valid || !o.visible || o.onScreen === null) return { kind: 'unknown', reason: 'unknown' };
  if (!o.onScreen) return { kind: 'off-task', reason: 'look-away' };
  if (o.screen === 'entertainment') return { kind: 'off-task', reason: 'entertainment' };
  if (o.screen === 'study') return { kind: 'on-task', reason: 'study' };
  return { kind: 'unknown', reason: 'unknown' };
}
export class AttentionDetector {
  private holdMs: number;
  private last: Observation | null = null;
  private held = 0;
  private latched = false;
  private returnMs = 0;
  constructor(holdMs = 2000) { this.holdMs = Math.max(500, holdMs); }
  reset() { this.last = null; this.held = 0; this.latched = false; this.returnMs = 0; }
  push(o: Observation): Evidence & { trigger: boolean; heldMs: number } {
    const e = classify(o);
    if (!Number.isFinite(o.t) || (this.last && o.t <= this.last.t)) return { ...e, trigger: false, heldMs: this.held };
    const dt = this.last ? o.t - this.last.t : 0;
    const previous = this.last ? classify(this.last) : null;
    const contiguous = dt <= 1500 && dt >= 0;
    this.last = { ...o };
    if (e.kind === 'off-task') {
      this.held = contiguous && previous?.kind === 'off-task' ? this.held + dt : 0;
      this.returnMs = 0;
    } else {
      this.held = 0;
      this.returnMs = e.kind === 'on-task' && contiguous && previous?.kind === 'on-task' ? this.returnMs + dt : 0;
      if (this.returnMs >= 1000) this.latched = false;
    }
    const trigger = !this.latched && this.held >= this.holdMs;
    if (trigger) this.latched = true;
    return { ...e, trigger, heldMs: this.held };
  }
}

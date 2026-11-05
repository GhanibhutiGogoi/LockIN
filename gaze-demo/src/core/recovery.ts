import type { Observation, RecoverySummary } from './types.ts';
import { classify } from './attention.ts';
export class RecoveryTracker {
  phase: 'ready' | 'playing' | 'paused' | 'quiz' | 'observing' | 'finished' = 'ready';
  readonly windowMs: number;
  private recoveryHoldMs: number;
  private relapseHoldMs: number;
  returnedAt: number | null = null;
  private last: Observation | null = null;
  private clock: number | null = null;
  private watchedMs = 0;
  private watchValidMs = 0;
  private watchOnMs = 0;
  private validMs = 0;
  private onTaskMs = 0;
  private offTaskMs = 0;
  private recoveryStreak = 0;
  private relapseStreak = 0;
  private recoveredAt: number | null = null;
  private relapsedAt: number | null = null;
  private quizCorrect: boolean | null = null;
  private final: RecoverySummary | null = null;
  constructor(config: { windowMs?: number; recoveryHoldMs?: number; relapseHoldMs?: number } = {}) {
    this.windowMs = config.windowMs ?? 120000;
    this.recoveryHoldMs = config.recoveryHoldMs ?? 4000;
    this.relapseHoldMs = config.relapseHoldMs ?? 2000;
  }
  play(t: number) {
    if (this.phase !== 'ready' && this.phase !== 'paused') throw new Error('当前不能开始播放');
    this.phase = 'playing'; this.clock = t; this.last = null;
  }
  pause(t: number) {
    if (this.phase !== 'playing') return;
    this.advance(t); this.phase = 'paused'; this.last = null;
  }
  endVideo(t: number) {
    if (this.phase !== 'playing' && this.phase !== 'paused') throw new Error('视频尚未开始播放');
    this.advance(t); this.phase = 'quiz'; this.last = null;
  }
  answer(t: number, correct: boolean | null) {
    if (this.phase !== 'quiz') throw new Error('请先看完视频，再回答问题');
    this.phase = 'observing'; this.returnedAt = t; this.clock = t; this.last = null; this.quizCorrect = correct;
  }
  private advance(t: number) {
    if (!Number.isFinite(t) || this.clock === null || t <= this.clock) return;
    const end = this.returnedAt === null ? t : Math.min(t, this.returnedAt + this.windowMs);
    const dt = Math.max(0, end - this.clock);
    if (this.phase === 'playing') this.watchedMs += dt;
    const fresh = this.last && end - this.last.t <= 1500 && this.last.valid && this.last.visible && this.last.onScreen !== null;
    if (fresh && this.phase === 'playing') {
      this.watchValidMs += dt;
      if (this.last!.onScreen) this.watchOnMs += dt;
    }
    if (fresh && this.phase === 'observing') {
      const e = classify(this.last!);
      if (e.kind !== 'unknown') this.validMs += dt;
      if (e.kind === 'on-task') this.onTaskMs += dt;
      if (e.kind === 'off-task') this.offTaskMs += dt;
    }
    this.clock = end;
  }
  observe(o: Observation) {
    if (!Number.isFinite(o.t) || (this.clock !== null && o.t < this.clock) || this.phase === 'finished') return;
    const previous = this.last;
    const dt = previous ? o.t - previous.t : 0;
    const fresh = previous && dt > 0 && dt <= 1500;
    this.advance(o.t);
    if (this.phase === 'observing' && this.returnedAt !== null && o.t <= this.returnedAt + this.windowMs) {
      const e = classify(o), prev = previous ? classify(previous) : null;
      this.recoveryStreak = fresh && e.kind === 'on-task' && prev?.kind === 'on-task' ? this.recoveryStreak + dt : 0;
      if (this.recoveredAt === null && this.recoveryStreak >= this.recoveryHoldMs) this.recoveredAt = o.t - (this.recoveryStreak - this.recoveryHoldMs);
      this.relapseStreak = fresh && e.kind === 'off-task' && prev?.kind === 'off-task' ? this.relapseStreak + dt : 0;
      if (this.recoveredAt !== null && this.relapsedAt === null && this.relapseStreak >= this.relapseHoldMs) this.relapsedAt = o.t - (this.relapseStreak - this.relapseHoldMs);
    }
    this.last = { ...o };
  }
  snapshot(t: number): RecoverySummary {
    if (this.final) return { ...this.final };
    const observationMs = this.returnedAt === null ? 0 : Math.min(this.windowMs, Math.max(0, t - this.returnedAt));
    return {
      watchedMs: this.watchedMs, watchValidMs: this.watchValidMs,
      watchOnScreenShare: this.watchValidMs ? this.watchOnMs / this.watchValidMs : null,
      observationMs, validMs: this.validMs, onTaskMs: this.onTaskMs, offTaskMs: this.offTaskMs,
      unknownMs: Math.max(0, observationMs - this.validMs), coverage: observationMs ? this.validMs / observationMs : 0,
      onTaskShare: this.validMs ? this.onTaskMs / this.validMs : null,
      recoveredAfterMs: this.recoveredAt === null || this.returnedAt === null ? null : this.recoveredAt - this.returnedAt,
      relapseAfterMs: this.relapsedAt === null || this.recoveredAt === null ? null : this.relapsedAt - this.recoveredAt,
      completed: false, censoredReason: null, quizCorrect: this.quizCorrect,
    };
  }
  finish(t: number, reason: string): RecoverySummary {
    if (this.final) return { ...this.final };
    this.advance(t);
    const summary = this.snapshot(t);
    summary.completed = reason === 'complete' && summary.observationMs >= this.windowMs;
    summary.censoredReason = summary.completed ? null : reason === 'complete' ? 'insufficient-window' : reason;
    this.phase = 'finished'; this.final = summary;
    return { ...summary };
  }
}

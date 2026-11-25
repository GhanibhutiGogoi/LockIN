export type ScreenRisk = 'gaze' | 'content';
// Speculative preparation starts early; playback still requires 30 seconds of evidence.
export const PREPARE_AFTER_MS = 1000;
export const PLAY_AFTER_MS = 30_000;
const RECOVERY_MS = 1000;
const UNKNOWN_GRACE_MS = 5000;

/** Dwell starts with current evidence, never with a delayed screenshot timestamp. */
export class ScreenIntervention {
  private risk: ScreenRisk | null = null;
  private durationMs = 0;
  private previous?: number;
  private lastEvidence?: number;
  private recoveringSince?: number;
  private previousInput: ScreenRisk | 'unknown' | null = null;

  update(input: ScreenRisk | 'unknown' | null, now: number) {
    const elapsed = this.previous === undefined ? 0 : now - this.previous;
    if (elapsed > 1500 || (this.lastEvidence !== undefined && now - this.lastEvidence > UNKNOWN_GRACE_MS)) this.durationMs = 0;
    let recovered = false;
    if (input === null) {
      this.recoveringSince ??= now;
      recovered = now - this.recoveringSince >= RECOVERY_MS;
      if (recovered) { this.durationMs = 0; this.risk = null; }
    } else {
      this.recoveringSince = undefined;
      if (input !== 'unknown') {
        if (elapsed <= 1500 && (this.previousInput === 'gaze' || this.previousInput === 'content')) this.durationMs += elapsed;
        this.risk = input;
        this.lastEvidence = now;
      }
    }
    this.previous = now;
    this.previousInput = input;
    const current = input === 'gaze' || input === 'content';
    return { risk: this.risk, durationMs: this.durationMs, recovered,
      prepare: current && this.durationMs >= PREPARE_AFTER_MS,
      play: current && this.durationMs >= PLAY_AFTER_MS };
  }
}

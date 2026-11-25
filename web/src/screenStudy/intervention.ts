import type { ScreenScene } from './types';
import { DEFAULT_LOOKING_AWAY_SEC, MAX_LOOKING_AWAY_SEC } from '../lib/lookingAway';
export type ScreenRisk = 'gaze' | 'content';
type Evidence = ScreenRisk | 'unknown' | null;
type Observation = Evidence | { scene: ScreenScene; goalRequired: boolean };
// Prepare early; playback requires the user's configured duration of valid evidence.
export const PREPARE_AFTER_MS = 1000;
export const PLAY_AFTER_MS = DEFAULT_LOOKING_AWAY_SEC * 1000;
const HISTORY_MS = (MAX_LOOKING_AWAY_SEC + 30) * 1000;
const RECOVERY_MS = 1000;
const UNKNOWN_GRACE_MS = 5000;

/** Dwell uses actual gaze observations; a screenshot timestamp alone proves no dwell. */
export class ScreenIntervention {
  private history: { input: Observation; now: number }[] = [];

  update(input: Observation, now: number, thresholdMs = PLAY_AFTER_MS) {
    // Keep actual gaze/scene observations, not an assumed risk while OCR is pending.
    // Resolved scene labels can then explain earlier observations without counting
    // missing gaze, a different page, or the time spent watching a recap.
    this.history = this.history.filter(entry => entry.now > now - HISTORY_MS && entry.now <= now);
    this.history.push({ input, now });
    this.history = this.history.slice(-HISTORY_MS / 50);
    const dwell = new Dwell(thresholdMs);
    let result!: ReturnType<Dwell['update']>;
    for (const entry of this.history) {
      const observation = entry.input;
      let evidence: Evidence;
      if (observation !== null && typeof observation === 'object') {
        const { scene, goalRequired } = observation;
        evidence = scene.status !== 'ready' ? 'unknown'
          : !goalRequired || scene.label === 'related' ? null
          : scene.label === 'off-topic' ? 'content' : 'unknown';
      } else evidence = observation;
      result = dwell.update(evidence, entry.now);
    }
    return result;
  }
}

class Dwell {
  constructor(private thresholdMs: number) {}
  private risk: ScreenRisk | null = null;
  private durationMs = 0;
  private previous?: number;
  private lastEvidence?: number;
  private recoveringSince?: number;
  private previousInput: ScreenRisk | 'unknown' | null = null;

  update(input: Evidence, now: number) {
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
      play: current && this.durationMs >= this.thresholdMs };
  }
}

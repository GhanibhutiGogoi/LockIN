/**
 * Session score — "your attention span" — computed from the 1 Hz focus log.
 * Definitions follow "Adaptive engine → Session score" in the proposal.
 * The personal-AI team may compute its own; the UI uses this for the report
 * whenever the adaptive provider does not return one.
 */
import type { FocusLogEntry, RescueOutcome, SessionScore } from '../contracts/types';

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Lengths (seconds) of unbroken Focused stretches. */
export function focusedEpisodes(samples: FocusLogEntry[]): number[] {
  const out: number[] = [];
  let run = 0;
  for (const s of samples) {
    if (s.state === 'focused') run++;
    else if (s.state === 'paused' || s.state === 'break') {
      // pauses end a stretch but don't count against you
      if (run) out.push(run);
      run = 0;
    } else {
      if (run) out.push(run);
      run = 0;
    }
  }
  if (run) out.push(run);
  return out;
}

export function scoreSession(samples: FocusLogEntry[], rescues: RescueOutcome[]): SessionScore {
  const active = samples.filter((s) => s.state !== 'paused' && s.state !== 'break' && s.state !== 'idle');
  const focusedCount = active.filter((s) => s.state === 'focused').length;
  const activeMin = active.length / 60;

  let lapses = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].state === 'lapse' && samples[i - 1].state !== 'lapse') lapses++;
  }
  // lapses can be shorter than one log tick; rescues are the reliable count
  lapses = Math.max(lapses, rescues.length);

  const refocus = rescues.map((r) => r.timeToRefocusSec).filter((x): x is number => x !== null);
  const answers = rescues.flatMap((r) => r.quiz);

  return {
    sustainedEpisodeMedianSec: median(focusedEpisodes(samples)) ?? 0,
    onTaskShare: active.length ? focusedCount / active.length : 0,
    lapsesPer30Min: activeMin > 0 ? (lapses / activeMin) * 30 : 0,
    timeToRefocusMedianSec: median(refocus),
    quizAccuracy: answers.length ? answers.filter((a) => a.correct).length / answers.length : null,
    focusedMinutes: focusedCount / 60,
  };
}

/** Share of samples in [fromSec, toSec) spent focused — A_after in the reward. */
export function focusShare(samples: FocusLogEntry[], fromSec: number, toSec: number): number | null {
  const win = samples.filter((s) => s.t >= fromSec && s.t < toSec && s.state !== 'paused');
  if (!win.length) return null;
  return win.filter((s) => s.state === 'focused').length / win.length;
}

/** Slides ranked by how many lapses started on them. */
export function slidesThatLostYou(rescues: RescueOutcome[]): { slideIndex: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const r of rescues) {
    if (r.context.rescueInRow > 1) continue; // count lapses, not deeper clips
    counts.set(r.context.slideIndex, (counts.get(r.context.slideIndex) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([slideIndex, count]) => ({ slideIndex, count }))
    .sort((a, b) => b.count - a.count || a.slideIndex - b.slideIndex);
}

export function formatDuration(sec: number): string {
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r ? `${m}m ${r.toString().padStart(2, '0')}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${(m % 60).toString().padStart(2, '0')}m`;
}

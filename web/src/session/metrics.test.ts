import { describe, expect, it } from 'vitest';
import type { FocusLogEntry, FocusState } from '../contracts/types';
import { focusShare, focusedEpisodes, formatDuration, median, scoreSession } from './metrics';

function log(states: [FocusState, number][]): FocusLogEntry[] {
  const out: FocusLogEntry[] = [];
  let t = 0;
  for (const [state, n] of states) for (let i = 0; i < n; i++) out.push({ t: t++, score: state === 'focused' ? 80 : 30, state, slideIndex: 0 });
  return out;
}

describe('metrics', () => {
  it('median', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });

  it('splits focused episodes on any non-focused state', () => {
    const s = log([['focused', 100], ['drifting', 5], ['focused', 300], ['paused', 10], ['focused', 50]]);
    expect(focusedEpisodes(s)).toEqual([100, 300, 50]);
  });

  it('scores a session', () => {
    const s = log([['focused', 600], ['drifting', 8], ['lapse', 1], ['rescue', 30], ['recovering', 5], ['focused', 1200], ['paused', 120]]);
    const score = scoreSession(s, []);
    expect(score.sustainedEpisodeMedianSec).toBe(900);
    expect(score.focusedMinutes).toBe(30);
    expect(score.onTaskShare).toBeCloseTo(1800 / 1844, 3);
    expect(score.lapsesPer30Min).toBeCloseTo(30 / (1844 / 60), 3);
    expect(score.quizAccuracy).toBeNull();
  });

  it('focus share window', () => {
    const s = log([['focused', 30], ['drifting', 30]]);
    expect(focusShare(s, 0, 60)).toBe(0.5);
    expect(focusShare(s, 100, 160)).toBeNull();
  });

  it('formats durations', () => {
    expect(formatDuration(42)).toBe('42s');
    expect(formatDuration(400)).toBe('6m 40s');
    expect(formatDuration(3720)).toBe('1h 02m');
  });
});

import { median } from '../session/metrics';
import type { ScreenAnalysis, ScreenSummary } from './types';

/** Statistics use measured intervals; the one-second chart is only a display. */
export function summarizeScreenAnalysis(analysis: ScreenAnalysis,
  start = analysis.windows[0]?.timestamp ?? 0, end = analysis.windows.at(-1)?.endTimestamp ?? start): ScreenSummary {
  const totals = { focusedMs: 0, lookingAwayMs: 0, offTopicMs: 0, unknownMs: Math.max(0, end - start), excludedMs: 0 };
  const reasons = new Map<string, number>();
  const stretches: number[] = [];
  let from: number | undefined, until = 0;
  for (const original of analysis.measurements) {
    const timestamp = Math.max(start, original.timestamp);
    const durationMs = Math.min(end, original.timestamp + original.durationMs) - timestamp;
    if (durationMs <= 0) continue;
    const m = { ...original, timestamp, durationMs };
    if (m.evidence !== 'unknown') {
      const key = { focused: 'focusedMs', 'looking-away': 'lookingAwayMs', 'off-topic': 'offTopicMs', excluded: 'excludedMs' } as const;
      totals[key[m.evidence]] += durationMs;
      totals.unknownMs -= durationMs;
    }
    if (m.evidence === 'unknown') reasons.set(m.reason, (reasons.get(m.reason) ?? 0) + m.durationMs);
    if (from !== undefined && (m.evidence !== 'focused' || m.timestamp > until + 1)) {
      stretches.push(until - from); from = undefined;
    }
    if (m.evidence === 'focused') {
      from ??= m.timestamp;
      until = m.timestamp + m.durationMs;
    }
  }
  if (from !== undefined) stretches.push(until - from);
  const unobserved = Math.max(0, totals.unknownMs - [...reasons.values()].reduce((a, b) => a + b, 0));
  if (unobserved > 0) reasons.set('missing-gaze-samples', unobserved);
  return { ...totals, measuredMs: totals.focusedMs + totals.lookingAwayMs + totals.offTopicMs,
    longestFocusMs: stretches.reduce((a, b) => Math.max(a, b), 0), medianFocusMs: median(stretches) ?? 0,
    unknownReasons: [...reasons].map(([reason, durationMs]) => ({ reason, durationMs })).sort((a, b) => b.durationMs - a.durationMs) };
}

import type { ScreenAnalysis } from '../screenStudy/types';
import { formatDuration } from '../session/metrics';
import { summarizeScreenAnalysis } from '../screenStudy/summary';

const reasonLabel = (reason: string) => ({
  'gaze-unavailable': 'Tracking unavailable', 'gaze-recovering': 'Checking gaze return',
  'screen-unobserved': 'No matching screen observation', 'missing-gaze-samples': 'No gaze samples received',
  skipped: 'Screen analysis skipped', pending: 'Screen analysis unfinished', error: 'Screen analysis failed',
  'content-uncertain': 'Content relevance uncertain', 'content-unavailable': 'Content classification unavailable',
  'content-checking': 'Content classification unfinished', 'no-text': 'No readable screen text',
}[reason] ?? 'Other missing evidence');

export function ScreenAnalysisReport({ analysis, startedAt }: { analysis?: ScreenAnalysis; startedAt: number }) {
  if (!analysis) return null;
  const ready = analysis.scenes.filter(s => s.status === 'ready').length;
  const summary = analysis.summary ?? summarizeScreenAnalysis(analysis);
  const eligibleMs = summary.measuredMs + summary.unknownMs;
  const returnedAt = analysis.events.filter(e => e.type === 'returned-to-study').at(-1)?.timestamp;
  const afterRecap = returnedAt === undefined ? undefined : summarizeScreenAnalysis(analysis, returnedAt);
  return <section className="mt-10" aria-labelledby="screen-analysis-title">
    <h2 id="screen-analysis-title" className="text-[24px]">Screen and gaze alignment</h2>
    <p className="mt-3 text-graphite">{ready} of {analysis.scenes.length} screen moments readable. Delayed OCR is matched to the original gaze timestamps. Unknown time is not counted as distraction.</p>
    <p className="mt-2 text-sm text-graphite">Each row summarizes up to five seconds. Looking away means away from the display, not proof of mind wandering. The download includes OCR text, region coordinates and Unix millisecond timestamps.</p>
    <p className="mt-3 font-semibold">Measurement coverage: {eligibleMs ? Math.round(100 * summary.measuredMs / eligibleMs) : 0}% of study time outside pauses and recaps.</p>
    <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
      {([['Focused', summary.focusedMs], ['Looking away', summary.lookingAwayMs], ['Off-topic', summary.offTopicMs],
        ['Unknown', summary.unknownMs], ['Excluded', summary.excludedMs]] as const).map(([label, ms]) =>
        <div key={label}><dt className="text-sm text-graphite">{label}</dt><dd className="num">{(ms / 1000).toFixed(1)}s</dd></div>)}
    </dl>
    {afterRecap && <p className="mt-3">After your last recap: {(afterRecap.focusedMs / 1000).toFixed(1)}s measured focused,
      {' '}{(afterRecap.unknownMs / 1000).toFixed(1)}s unknown. Missing evidence is not classified as distraction.</p>}
    {summary.unknownReasons.length > 0 && <details className="mt-4">
      <summary className="cursor-pointer font-semibold">Why some time could not be measured</summary>
      <ul className="mt-2 space-y-1 text-sm">{summary.unknownReasons.map(item =>
        <li key={item.reason}>{reasonLabel(item.reason)}: {(item.durationMs / 1000).toFixed(1)}s</li>)}</ul>
    </details>}
    <details className="mt-4">
      <summary className="cursor-pointer font-semibold">Inspect time windows</summary>
      <div className="mt-3 max-h-96 overflow-auto">
        <table className="w-full text-left text-sm">
          <thead><tr>{['Time', 'Focused', 'Looking away', 'Off-topic', 'Unknown', 'Excluded'].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead>
          <tbody>{analysis.windows.map(w => <tr key={w.timestamp} className="border-t border-rule-strong">
            <td className="p-2">{formatDuration((w.timestamp - startedAt) / 1000)}</td>
            {[w.focusedMs, w.lookingAwayMs, w.offTopicMs, w.unknownMs, w.excludedMs].map((value, i) => <td key={i} className="p-2">{(value / 1000).toFixed(1)}s</td>)}
          </tr>)}</tbody>
        </table>
      </div>
    </details>
  </section>;
}

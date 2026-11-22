import { useEffect, type ReactNode } from 'react';
import type { Deck, MemoryDecision, MemoryStyle, RescueOutcome } from '../contracts/types';
import { memoryStyle } from '../providers/memory/adaptive';
import { focusedEpisodes, formatDuration, slidesThatLostYou } from '../session/metrics';
import { exportReport } from '../session/reportExport';
import { actions, useApp, type Report } from '../store';
import { FocusTimeline } from './FocusTimeline';
import { GazeTraceReport } from './GazeTraceReport';
import { ScreenAnalysisReport } from './ScreenAnalysisReport';
import { Icon } from './Icon';
import { IntegrationsButton } from './IntegrationsPanel';
import { SlideView } from './SlideView';

export function ReportScreen() {
  const report = useApp((s) => s.report);
  const decks = useApp((s) => s.decks);
  useEffect(() => {
    if (!report) actions.go('desk');
  }, [report]);
  if (!report) return null;
  const { deck, log, review, questions } = report;
  const screenStudy = deck.sourceType === 'screen';
  const canStudy = decks.some((d) => d.id === deck.id);
  const measured = log.screenAnalysis?.summary;
  if ((!log.samples.length && !measured?.measuredMs) || log.attentionSource === 'unavailable') return <ReadingReport report={report} canStudy={canStudy} />;
  const sc = review.score;
  const lost = slidesThatLostYou(log.rescues).slice(0, 4);
  const durationSec = log.activeSeconds ?? (log.endedAt - log.startedAt) / 1000;
  const longestStretch = measured ? measured.longestFocusMs / 1000 : focusedEpisodes(log.samples).reduce((longest, seconds) => Math.max(longest, seconds), 0);
  const measuredSeconds = measured ? measured.measuredMs / 1000 : log.samples.filter(s => !['paused', 'break', 'idle'].includes(s.state)).length;
  const lapses = log.rescues.filter((r) => r.context.rescueInRow === 1 && r.context.trigger !== 'manual').length;
  const answered = questions.filter((q) => q.chosen !== null);
  const correct = answered.filter((q) => q.chosen === q.answerIndex).length;
  const isSample = log.sessionId === 'sample';

  const studyAgain = (slide = 0) => {
    if (screenStudy) {
      actions.go('desk');
      return;
    }
    actions.openDeck(deck.id);
    actions.setSlide(slide);
    actions.go('study');
  };

  const slipped = lapses === 0 ? 'never' : lapses === 1 ? 'once' : lapses === 2 ? 'twice' : `${lapses} times`;

  return (
    <div className="min-h-full">
      <header className="mx-auto flex min-h-16 w-full max-w-[1360px] flex-wrap items-center gap-2 px-[max(20px,env(safe-area-inset-left))] py-3 pr-[max(12px,env(safe-area-inset-right))] lg:px-8 lg:pr-5">
        <button type="button" className="btn btn-ghost btn-sm -ml-2.5" onClick={() => actions.go('desk')}>
          <Icon name="arrow-left" size={18} /> Desk
        </button>
        <span className="flex-1" />
        <IntegrationsButton />
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => downloadReport(report)}>Download report</button>
        <button type="button" className="btn btn-primary btn-sm ml-1" onClick={() => studyAgain(0)} disabled={!screenStudy && !canStudy}>
          {screenStudy ? 'New screen session' : 'Study again'}
        </button>
      </header>

      <main className="mx-auto max-w-[1360px] px-[max(20px,env(safe-area-inset-left))] pr-[max(20px,env(safe-area-inset-right))] pb-24 lg:px-8">
        {/* the first view is exactly one screen: the answer at the top, the whole session along the bottom edge;
            the details start below the fold, so scrolling is the way into them */}
        <div className="flex min-h-[calc(100svh-64px)] flex-col pt-4 pb-8 lg:pt-6 lg:pb-10">
          <section className="grid items-end gap-x-6 gap-y-6 lg:grid-cols-12" aria-labelledby="report-title">
            <div className="min-w-0 lg:col-span-7">
              <h1 id="report-title" className="text-[17px] font-semibold text-graphite">
                {deck.title}
                <span className="num font-normal"> · {formatDuration(durationSec)}</span>
                {isSample && <span className="font-normal"> · example</span>}
                {log.attentionSource === 'simulated' && <span className="font-normal"> · simulated, not saved</span>}
              </h1>
              <p className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1">
                <span className="figure text-[clamp(64px,7.5vw,112px)] leading-[0.95]">{formatDuration(longestStretch)}</span>
                <span className="text-[20px] text-graphite">longest measured focus stretch</span>
              </p>
              <p className="mt-3 text-[14px] text-graphite">
                Median measured focus stretch: {formatDuration(sc.sustainedEpisodeMedianSec)}
                <Delta delta={sc.deltaVsBaseline ?? null} />
              </p>
            </div>
            <Memo memo={review.profileMemo} tips={review.tips} quick={durationSec < 120} className="hidden lg:block" />
          </section>

          <section className="mt-auto pt-10" aria-label="Focus across the session">
            <p className="text-[17px] text-graphite">
              <Fact>{Math.round(sc.onTaskShare * 100)}%</Fact> of measured {measured ? 'time' : 'samples'} focused
              <Dot />
              focus slipped <Fact>{slipped}</Fact>
              {sc.timeToRefocusMedianSec !== null && (
                <>
                  <Dot />
                  back in <Fact>{formatDuration(sc.timeToRefocusMedianSec)}</Fact>
                </>
              )}
            </p>
            <p className="mt-2 text-[13px] text-graphite">
              Measured {formatDuration(measuredSeconds)} of {formatDuration(durationSec)} active time. {measured
                ? 'Totals include short measured intervals. The chart shows seconds with at least 0.8s of evidence; gaps do not mean distraction.'
                : 'Chart gaps indicate missing measurements.'}
            </p>
            <div className="mt-4 h-[clamp(180px,38svh,420px)]">
              <FocusTimeline samples={log.samples} rescues={log.rescues} deck={deck} sessionStart={log.startedAt} sessionSeconds={(log.endedAt - log.startedAt) / 1000} />
            </div>
          </section>
        </div>

        {screenStudy && <ScreenAnalysisReport analysis={log.screenAnalysis} startedAt={log.startedAt} />}
        {screenStudy && <GazeTraceReport trace={log.gazeTrace} sessionId={log.sessionId} durationMs={log.endedAt - log.startedAt} />}
        {/* on a phone the memo would push the chart off the first screen, so it opens the details instead */}
        <Memo memo={review.profileMemo} tips={review.tips} quick={durationSec < 120} className="mt-4 lg:hidden" />

        <section className="mt-12 grid gap-x-6 gap-y-16 lg:mt-16 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-5">
            <h2 className="text-[22px]">{screenStudy ? 'Screen moments recapped' : 'Slides that lost you'}</h2>
            {lost.length ? (
              <ul className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-5">
                {lost.map(({ slideIndex, count }) => (
                  <li key={slideIndex} className="flex min-w-0 items-center gap-4">
                    <div className="pointer-events-none aspect-video w-[88px] flex-none sm:w-[112px] overflow-hidden rounded-[var(--r-paper)] bg-slide" data-ui aria-hidden>
                      <SlideView deck={deck} slide={deck.slides[slideIndex]} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[16px] font-semibold">{deck.slides[slideIndex]?.title}</p>
                      <p className="text-[15px] text-graphite">{count === 1 ? 'once' : `${count} times`}</p>
                    </div>
                    {!screenStudy && <button type="button" className="btn btn-quiet btn-sm" disabled={!canStudy} onClick={() => studyAgain(slideIndex)} aria-label={`Revisit slide ${slideIndex + 1}: ${deck.slides[slideIndex]?.title ?? ''}`}>
                      Revisit
                    </button>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-6 text-[17px] text-graphite">No automatic recaps were recorded in this session.</p>
            )}
          </div>

          <div className="min-w-0 lg:col-span-6 lg:col-start-7">
            <h2 className="text-[22px]">
              Questions{answered.length > 0 && <span className="num font-normal text-graphite"> · {correct} of {answered.length} right</span>}
            </h2>
            {questions.length ? (
              <ul className="mt-6 grid gap-6">
                {questions.map((q, i) => {
                  const right = q.chosen === q.answerIndex;
                  return (
                    <li key={i} className="flex items-start gap-3">
                      <span
                        className="mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full"
                        style={{ background: q.chosen === null ? 'var(--raised)' : right ? 'var(--ok-soft)' : 'var(--lapse-soft)', color: q.chosen === null ? 'var(--graphite)' : right ? 'var(--ok)' : 'var(--lapse)' }}
                        role="img"
                        aria-label={q.chosen === null ? 'Not answered' : right ? 'Right' : 'Wrong'}
                      >
                        <Icon name={q.chosen === null ? 'arrow-right' : right ? 'check' : 'x'} size={16} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[16px] font-semibold">{q.question}</p>
                        <p className="mt-1 text-[15px] text-graphite">
                          {q.options[q.answerIndex]}
                          {q.chosen !== null && !right && <> · you picked {q.options[q.chosen]}</>}
                          {q.chosen === null && <> · clip skipped</>}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-6 text-[17px] text-graphite">No quiz answers were recorded in this session.</p>
            )}
          </div>
        </section>
        <MemoryDecisions rescues={log.rescues} deck={deck} />
      </main>
    </div>
  );
}

const styleLabel: Record<MemoryStyle, string> = { plain: 'Direct', analogy: 'Analogy', humor: 'Humor' };

function selectionReason(decision: MemoryDecision) {
  if (decision.reason === 'unavailable') return 'The memory bank was unavailable. Used the default recap.';
  if (decision.reason === 'settings') return 'Your settings allow only this style.';
  if (decision.reason === 'rotation') return `Rotating styles until each has ${decision.minOutcomesPerStyle} usable outcomes.`;
  return 'This style had the strongest observed recovery after adjusting for sample size.';
}

function recoveryEvidence(rescue: RescueOutcome, decision: MemoryDecision) {
  if (rescue.skipped) return 'This recap was skipped.';
  if (rescue.clipSeconds <= 0) return 'No clip played.';
  const evidence = rescue.memoryEvidence;
  if (!evidence || decision.minRecoverySamples === undefined) return undefined;
  if (evidence.recoverySamples < decision.minRecoverySamples) {
    return `This recap was excluded · ${evidence.recoverySamples} of ${decision.minRecoverySamples} required recovery samples.`;
  }
  return `This recap had ${evidence.recoverySamples} usable recovery samples.`;
}

function MemoryDecisions({ rescues, deck }: { rescues: RescueOutcome[]; deck: Deck }) {
  const decisions = rescues.flatMap((rescue) => rescue.memoryDecision ? [{ rescue, decision: rescue.memoryDecision }] : []);
  if (!decisions.length) return null;
  return (
    <section className="mt-16 max-w-3xl" aria-labelledby="memory-decisions">
      <h2 id="memory-decisions" className="text-[22px]">Why each recap style was chosen</h2>
      <ol className="mt-5 divide-y divide-rule border-y border-rule">
        {decisions.map(({ rescue, decision }) => {
          const history = Object.entries(decision.eligibleByStyle)
            .map(([style, count]) => `${styleLabel[style as MemoryStyle]} ${count}`).join(' · ');
          const { skipped, noClip, insufficientRecovery } = decision.excluded;
          const exclusions = [
            skipped && `${skipped} skipped`,
            noClip && `${noClip} no clip played`,
            insufficientRecovery && `${insufficientRecovery} with too few recovery samples`,
          ].filter(Boolean).join(' · ');
          const actual = rescue.memoryEvidence && memoryStyle(rescue.memoryEvidence.variant);
          const evidence = recoveryEvidence(rescue, decision);
          return (
            <li key={rescue.rescueId} className="grid gap-1 py-4 text-[15px]">
              <p className="font-semibold">{deck.slides[rescue.context.slideIndex]?.title ?? `Slide ${rescue.context.slideIndex + 1}`} · {styleLabel[decision.style]}</p>
              <p>{selectionReason(decision)}</p>
              {actual && actual !== decision.style && <p>Recap delivered in {styleLabel[actual].toLowerCase()} style.</p>}
              {decision.reason !== 'unavailable' && (
                <>
                  <p className="text-graphite">{decision.evidenceCount} usable prior {decision.evidenceCount === 1 ? 'outcome' : 'outcomes'}{history && ` · ${history}`}</p>
                  {exclusions && <p className="text-graphite">Prior outcomes excluded · {exclusions}</p>}
                </>
              )}
              {evidence && <p className="text-graphite">{evidence}</p>}
              {!!decision.relatedMemories?.length && (
                <div className="mt-2 text-graphite">
                  <p className="font-semibold">Related memories from other decks</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {decision.relatedMemories.map((hit) => (
                      <li key={hit.rescueId}>
                        {hit.deckTitle} · {hit.slideTitle} · {styleLabel[hit.style]} · {Math.round(hit.focusedShare * 100)}% focused
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1">{decision.semanticStatus === 'confirmed'
                    ? 'The local relevance model confirmed these topic matches.'
                    : 'EmbeddingGemma 2 found these by topic.'} This deck’s style counts use its own history.</p>
                </div>
              )}
              {decision.semanticStatus === 'no_match' && <p className="text-graphite">No relevant memories from other decks.</p>}
              {decision.semanticStatus === 'unavailable' && <p className="text-graphite">Cross-deck search was unavailable.</p>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Delta({ delta }: { delta: number | null }) {
  if (delta === null) return null;
  const up = delta >= 0;
  return (
    <>
      {', '}
      <span className="num font-semibold" style={{ color: up ? 'var(--ok)' : 'var(--warn)' }}>
        {up ? '+' : '−'}
        {Math.abs(Math.round(delta * 100))}%
      </span>{' '}
      on your last five
    </>
  );
}

/** What LockIn learned, as one paragraph in one voice — no second tier of tips. */
function Memo({ memo, tips, quick, className = '' }: { memo?: string; tips?: string[]; quick: boolean; className?: string }) {
  const text = quick
    ? 'This was a short session. More measured study time is needed to describe a typical focused stretch.'
    : [memo ?? 'This report describes the attention measurements recorded during this session.', ...(tips ?? [])].join(' ');
  return (
    <p className={`max-w-[48ch] min-w-0 text-[18px] leading-[1.55] lg:col-span-5 lg:pb-2 ${className}`} aria-label="What works for you">
      {text}
    </p>
  );
}

const Fact = ({ children }: { children: ReactNode }) => <span className="num font-semibold whitespace-nowrap text-ink">{children}</span>;
const Dot = () => <span className="mx-2 text-pencil" aria-hidden>·</span>;

function downloadReport(report: Report) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(exportReport(report), null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `lockin-session-${report.log.sessionId}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ReadingReport({ report, canStudy }: { report: Report; canStudy: boolean }) {
  const { deck, log, questions } = report;
  const screenStudy = deck.sourceType === 'screen';
  const visited = log.visitedSlides ?? [...new Set(log.activity?.map((a) => a.slideIndex) ?? [])];
  const active = log.activeSeconds ?? (log.endedAt - log.startedAt) / 1000;
  const resume = (slide: number) => {
    if (screenStudy) { actions.go('desk'); return; }
    actions.openDeck(deck.id);
    actions.setSlide(slide);
    actions.go('study');
  };
  return <div className="min-h-full bg-paper">
    <header className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-5 py-5">
      <button type="button" className="btn btn-quiet btn-sm" onClick={() => actions.go('desk')}><Icon name="arrow-left" size={18} />Your library</button>
      <span className="flex-1" />
      <button type="button" className="btn btn-quiet btn-sm" onClick={() => downloadReport(report)}>Download report</button>
      <button type="button" className="btn btn-primary btn-sm" disabled={!screenStudy && !canStudy} onClick={() => resume(visited.at(-1) ?? 0)}>{screenStudy ? 'New screen session' : 'Study again'}</button>
    </header>
    <main className="mx-auto max-w-5xl px-5 py-10">
      <h1 className="text-[clamp(30px,4vw,48px)] leading-tight">Session complete</h1>
      <p className="mt-4 break-words text-[22px]">{deck.title}</p>
      <p className="mt-2 text-[16px] text-graphite">{new Date(log.endedAt).toLocaleString()} · {formatDuration(active)} studying{!screenStudy && ` · ${visited.length} of ${deck.slideCount} slides visited`}</p>
      <p className="mt-7 max-w-[65ch] text-[17px] leading-relaxed text-graphite">{screenStudy ? 'There was not enough aligned evidence for the focus curve. Inspect the screen and gaze windows below: missing gaze, unreadable content and uncertain relevance remain unknown. Delayed OCR is included when it can be matched to the original screen moment.' : 'No attention measurements were available for this session. This report records your study time and slides visited. Having the tab open does not establish that you were focused.'}</p>
      {screenStudy && <ScreenAnalysisReport analysis={log.screenAnalysis} startedAt={log.startedAt} />}
      {screenStudy && <GazeTraceReport trace={log.gazeTrace} sessionId={log.sessionId} durationMs={log.endedAt - log.startedAt} />}
      {!screenStudy && !canStudy && <p className="mt-4 text-[16px] text-graphite">The original deck is no longer in this browser. Upload it again to revisit the slides.</p>}
      {!screenStudy && <section className="mt-12" aria-labelledby="visited-title">
        <h2 id="visited-title" className="text-[23px]">Slides you visited</h2>
        {visited.length ? <ol className="mt-4 divide-y divide-rule">{visited.map((index) => <li key={index} className="flex items-center justify-between gap-4 py-4">
          <span className="min-w-0 break-words text-[17px]">{index + 1}. {deck.slides[index]?.title ?? 'Slide'}</span>
          <button type="button" className="btn btn-quiet btn-sm" disabled={!canStudy} onClick={() => resume(index)} aria-label={`Revisit slide ${index + 1}`}>Revisit</button>
        </li>)}</ol> : <p className="mt-4 text-graphite">The session ended before a slide visit was recorded.</p>}
      </section>}
      <section className="mt-10" aria-labelledby="reading-questions">
        <h2 id="reading-questions" className="text-[23px]">Questions</h2>
        {questions.length ? <ul className="mt-4 space-y-5">{questions.map((q, i) => <li key={i}>
          <p className="font-semibold">{q.question}</p>
          <p className="mt-1 text-graphite">{q.chosen === null ? 'Not answered' : q.chosen === q.answerIndex ? 'Correct' : 'Incorrect'} · Answer: {q.options[q.answerIndex]}</p>
        </li>)}</ul> : <p className="mt-4 text-[17px] text-graphite">No quiz answers were recorded.</p>}
      </section>
      <MemoryDecisions rescues={log.rescues} deck={deck} />
    </main>
  </div>;
}

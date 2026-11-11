import { useEffect, type ReactNode } from 'react';
import { formatDuration, slidesThatLostYou } from '../session/metrics';
import { actions, useApp } from '../store';
import { FocusTimeline } from './FocusTimeline';
import { Icon } from './Icon';
import { IntegrationsButton } from './IntegrationsPanel';
import { SlideView } from './SlideView';

export function ReportScreen() {
  const report = useApp((s) => s.report);
  useEffect(() => {
    if (!report) actions.go('desk');
  }, [report]);
  if (!report) return null;
  const { deck, log, review, questions } = report;
  const sc = review.score;
  const lost = slidesThatLostYou(log.rescues).slice(0, 4);
  const durationSec = (log.endedAt - log.startedAt) / 1000;
  const lapses = log.rescues.filter((r) => r.context.rescueInRow === 1).length;
  const answered = questions.filter((q) => q.chosen !== null);
  const correct = answered.filter((q) => q.chosen === q.answerIndex).length;
  const isSample = log.sessionId === 'sample';

  const studyAgain = (slide = 0) => {
    actions.openDeck(deck.id);
    actions.setSlide(slide);
    actions.go('study');
  };

  const slipped = lapses === 0 ? 'never' : lapses === 1 ? 'once' : lapses === 2 ? 'twice' : `${lapses} times`;

  return (
    <div className="min-h-full">
      <header className="mx-auto flex h-16 w-full max-w-[1360px] items-center gap-2 px-[max(20px,env(safe-area-inset-left))] pr-[max(12px,env(safe-area-inset-right))] lg:px-8 lg:pr-5">
        <button type="button" className="btn btn-ghost btn-sm -ml-2.5" onClick={() => actions.go('desk')}>
          <Icon name="arrow-left" size={18} /> Desk
        </button>
        <span className="flex-1" />
        <IntegrationsButton />
        <button type="button" className="btn btn-primary btn-sm ml-1" onClick={() => studyAgain(0)}>
          Study again
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
              </h1>
              {durationSec < 120 ? (
                <p className="mt-4 text-[clamp(36px,4.4vw,60px)] leading-[1.05] font-bold tracking-[-0.03em]">That was a quick one</p>
              ) : (
                <p className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1">
                  <span className="figure text-[clamp(64px,7.5vw,112px)] leading-[0.95]">{formatDuration(sc.sustainedEpisodeMedianSec)}</span>
                  <span className="text-[20px] text-graphite">
                    focus at a stretch
                    <Delta delta={sc.deltaVsBaseline ?? null} />
                  </span>
                </p>
              )}
            </div>
            <Memo memo={review.profileMemo} tips={review.tips} quick={durationSec < 120} className="hidden lg:block" />
          </section>

          <section className="mt-auto pt-10" aria-label="Focus across the session">
            <p className="text-[17px] text-graphite">
              <Fact>{Math.round(sc.onTaskShare * 100)}%</Fact> locked in
              <Dot />
              focus slipped <Fact>{slipped}</Fact>
              {sc.timeToRefocusMedianSec !== null && (
                <>
                  <Dot />
                  back in <Fact>{formatDuration(sc.timeToRefocusMedianSec)}</Fact>
                </>
              )}
            </p>
            <div className="mt-4 h-[clamp(180px,38svh,420px)]">
              <FocusTimeline samples={log.samples} rescues={log.rescues} deck={deck} sessionStart={log.startedAt} />
            </div>
          </section>
        </div>

        {/* on a phone the memo would push the chart off the first screen, so it opens the details instead */}
        <Memo memo={review.profileMemo} tips={review.tips} quick={durationSec < 120} className="mt-4 lg:hidden" />

        <section className="mt-12 grid gap-x-6 gap-y-16 lg:mt-16 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-5">
            <h2 className="text-[22px]">Slides that lost you</h2>
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
                    <button type="button" className="btn btn-quiet btn-sm" onClick={() => studyAgain(slideIndex)} aria-label={`Revisit slide ${slideIndex + 1}: ${deck.slides[slideIndex]?.title ?? ''}`}>
                      Revisit
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-6 text-[17px] text-graphite">None. Your focus held through every slide.</p>
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
              <p className="mt-6 text-[17px] text-graphite">No clips, so no questions.</p>
            )}
          </div>
        </section>
      </main>
    </div>
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
    ? 'Study for 10 minutes or more and this becomes your attention span.'
    : [memo ?? 'After a few sessions LockIn will know which clips bring you back fastest.', ...(tips ?? [])].join(' ');
  return (
    <p className={`max-w-[48ch] min-w-0 text-[18px] leading-[1.55] lg:col-span-5 lg:pb-2 ${className}`} aria-label="What works for you">
      {text}
    </p>
  );
}

const Fact = ({ children }: { children: ReactNode }) => <span className="num font-semibold whitespace-nowrap text-ink">{children}</span>;
const Dot = () => <span className="mx-2 text-pencil" aria-hidden>·</span>;

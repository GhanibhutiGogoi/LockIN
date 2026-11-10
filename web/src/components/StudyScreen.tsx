import { useEffect, useRef, useState } from 'react';
import { simulator } from '../providers/mock/attention';
import { registry } from '../providers/registry';
import { dismissBreak, endBreak, endSession, enterStudy, onSlideChange, takeBreak, togglePause } from '../session/engine';
import { actions, useApp, useDeck } from '../store';
import { CONSENT_VERSION, ConsentScreen } from './ConsentScreen';
import { FocusGauge } from './FocusGauge';
import { Icon } from './Icon';
import { IntegrationsButton } from './IntegrationsPanel';
import { Rescue } from './Rescue';
import { SlideView } from './SlideView';

export function StudyScreen() {
  const deck = useDeck();
  const slideIndex = useApp((s) => s.slideIndex);
  const state = useApp((s) => s.live.state);
  const rescue = useApp((s) => s.rescue);
  const breakCard = useApp((s) => s.breakCard);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<number | null>(null);
  const slide = deck.slides[slideIndex];
  const consented = useApp((s) => s.consent === CONSENT_VERSION);

  // After consent: the camera (only if the tracker needs it) and the session.
  // enterStudy is single-flight, and resumes a session paused for recalibration.
  useEffect(() => {
    if (consented) void enterStudy();
  }, [consented]);

  useEffect(() => {
    onSlideChange(slideIndex);
  }, [slideIndex]);

  // Calm chrome: fades after 4 s without the pointer while you're focused.
  useEffect(() => {
    const wake = () => {
      setIdle(false);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => setIdle(true), 4000);
    };
    wake();
    window.addEventListener('pointermove', wake);
    return () => {
      window.removeEventListener('pointermove', wake);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, []);

  // The toolbar works like a full-screen app's: it shows on arrival so you learn where it lives, then
  // leaves, and comes back only when you reach for it — pointer at the top edge, or a tap on touch screens.
  const [barAwake, setBarAwake] = useState(true);
  const barTimer = useRef<number | null>(null);
  useEffect(() => {
    let inTopEdge = false;
    const wakeBar = (staySec: number | null) => {
      setBarAwake(true);
      if (barTimer.current) clearTimeout(barTimer.current);
      if (staySec !== null) barTimer.current = window.setTimeout(() => setBarAwake(false), staySec * 1000);
    };
    wakeBar(2.5);
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      if (e.clientY < 88) {
        if (!inTopEdge) wakeBar(null); // stays as long as the pointer is up there
        inTopEdge = true;
      } else if (inTopEdge) {
        inTopEdge = false;
        wakeBar(1.2);
      }
    };
    const onTap = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' && !(e.target as HTMLElement).closest('button')) wakeBar(3);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onTap);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onTap);
      if (barTimer.current) clearTimeout(barTimer.current);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useApp.getState();
      // a break has its own buttons: P must not restart tracking under the countdown
      if (st.rescue || st.settingsOpen || st.breakCard || st.consent !== CONSENT_VERSION || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable]')) return;
      const k = e.key;
      if (k === 'ArrowRight' || k === 'PageDown' || (k === ' ' && !target.closest('button'))) {
        e.preventDefault();
        actions.setSlide(useApp.getState().slideIndex + 1);
      } else if (k === 'ArrowLeft' || k === 'PageUp') {
        e.preventDefault();
        actions.setSlide(useApp.getState().slideIndex - 1);
      } else if (k.toLowerCase() === 'p') void togglePause();
      else if (k.toLowerCase() === 'd' && registry.isMock('attention')) {
        simulator.set(simulator.profile === 'phone' ? 'reading' : 'phone');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const quiet = idle && state === 'focused' && !confirmEnd;
  // drifting doesn't call the toolbar: the edge glow is the only signal, so the slide stays clean
  const barHidden = !barAwake && !confirmEnd;

  if (!consented) return <ConsentScreen />;

  return (
    <div className="relative h-full overflow-hidden bg-desk" data-study>
      {/* the slide is the room: chrome floats at the edges and leaves when you read */}
      <main className="absolute inset-0 px-3 pt-16 pb-16 sm:px-6 md:px-20">
        {slide && <SlideView deck={deck} slide={slide} />}
      </main>
      {deck.pdfUrl && (
        // a PDF page keeps its own layout, so a phone held upright shows it small
        <p className="chrome pointer-events-none absolute inset-x-0 bottom-20 hidden text-center text-[14px] text-graphite max-md:portrait:block" data-quiet={quiet}>
          Turn your phone sideways for a bigger slide
        </p>
      )}

      <header className="absolute inset-x-0 top-0 z-20 flex h-16 items-center gap-1 pl-[max(12px,env(safe-area-inset-left))] pr-[max(12px,env(safe-area-inset-right))] sm:pl-5 sm:pr-4">
        <RecoveringLine />
        <span className="flex-1" />
        {/* while you read, all that's left is the camera light: a dot, like the one in a menu bar */}
        <CameraDot hidden={!barHidden} />
        {/* hidden = not clickable, so a click on the dot never lands on an invisible Finish; Tab still reveals it */}
        <div className={`chrome relative flex h-11 items-center gap-1 rounded-full bg-sheet py-1 pr-1 pl-4 shadow-[var(--shadow-float)] ${barHidden ? 'pointer-events-none' : ''}`} data-quiet={barHidden}>
          <FocusGauge compact />
          <Elapsed />
          <span className="mx-1.5 h-5 w-px bg-rule-strong" aria-hidden />
          <CameraButton />
          <IntegrationsButton className="icon-btn h-9 w-9" />
          <button type="button" className="icon-btn h-9 w-9" onClick={() => useApp.setState({ settingsOpen: true })} aria-label="Settings" title="Settings">
            <Icon name="settings" size={18} />
          </button>
          <div className="relative">
            <button type="button" className="btn btn-primary btn-sm ml-1" onClick={() => setConfirmEnd((v) => !v)} aria-expanded={confirmEnd}>
              Finish
            </button>
            {confirmEnd && <FinishPopover onCancel={() => setConfirmEnd(false)} />}
          </div>
        </div>
      </header>

      {/* after the header in the DOM, so Tab meets camera, settings and Finish first */}
      <SideNav dir="prev" disabled={slideIndex === 0} quiet={quiet} />
      <SideNav dir="next" disabled={slideIndex >= deck.slideCount - 1} quiet={quiet} />
      <DeckRail quiet={quiet} />

      <div className="drift-glow" data-on={state === 'drifting' || state === 'recovering'} aria-hidden />
      {state === 'paused' && !breakCard && <PausedVeil />}
      {breakCard && !rescue && <BreakCard reason={breakCard.reason} until={breakCard.until} />}
      <Rescue />
    </div>
  );
}

function FinishPopover({ onCancel }: { onCancel: () => void }) {
  const elapsed = useApp((s) => s.live.elapsed);
  const m = Math.floor(elapsed / 60);
  const sec = Math.floor(elapsed % 60);
  const [busy, setBusy] = useState(false);
  const finish = async () => {
    setBusy(true);
    try {
      await endSession();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rise absolute top-[calc(100%+8px)] right-0 z-40 w-72 rounded-2xl bg-sheet p-5 shadow-[var(--shadow-float)]" role="dialog" aria-label="End this session">
      <p className="text-[17px] font-semibold">
        End after <span className="num">{m}:{sec.toString().padStart(2, '0')}</span>?
      </p>
      <div className="mt-4 flex gap-2">
        <button type="button" className="btn btn-primary btn-sm flex-1" onClick={() => void finish()} disabled={busy} aria-busy={busy} autoFocus>
          {busy ? 'Making your report…' : 'See my report'}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel}>
          Keep going
        </button>
      </div>
    </div>
  );
}

function Elapsed() {
  const elapsed = useApp((s) => s.live.elapsed);
  const m = Math.floor(elapsed / 60);
  const s = Math.floor(elapsed % 60);
  return (
    <span className="num hidden text-[15px] text-graphite md:inline" aria-label={`Session time ${m} minutes`}>
      {m}:{s.toString().padStart(2, '0')}
    </span>
  );
}

function useCameraLabel() {
  const camera = useApp((s) => s.camera);
  const paused = useApp((s) => s.live.state === 'paused');
  const simulated = registry.isMock('attention');
  const label = paused
    ? camera === 'paused' ? 'Camera paused' : 'Tracking paused'
    : camera === 'on' ? (simulated ? 'Camera on · simulated focus' : 'Camera on · this laptop only') : simulated ? 'Simulated focus' : 'App switches only';
  const color = paused ? 'var(--pencil)' : camera === 'on' ? 'var(--lapse)' : 'var(--ok)';
  return { label: `${label}. ${paused ? 'Resume' : 'Pause'} (P)`, title: `${label} · P to ${paused ? 'resume' : 'pause'}`, color, paused };
}

/** The camera indicator, and also the off switch: the toolbar's version. */
function CameraButton() {
  const { label, title, color, paused } = useCameraLabel();
  return (
    <button type="button" onClick={() => void togglePause()} className="chip h-9 gap-2 px-3 text-ink transition-colors hover:bg-raised" aria-keyshortcuts="P" aria-label={label} title={title}>
      <span className="h-2 w-2 flex-none rounded-full" style={{ background: color }} aria-hidden />
      <Icon name={paused ? 'play' : 'pause'} size={16} />
    </button>
  );
}

/** What stays on screen while you read: one dot, still the off switch. Always visible (camera-indicator rule). */
function CameraDot({ hidden }: { hidden: boolean }) {
  const { label, title, color } = useCameraLabel();
  return (
    <button
      type="button"
      onClick={() => void togglePause()}
      className="chrome absolute top-1/2 right-[max(12px,env(safe-area-inset-right))] grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full transition-colors hover:bg-raised sm:right-5"
      data-quiet={hidden}
      tabIndex={hidden ? -1 : 0}
      aria-hidden={hidden}
      aria-keyshortcuts="P"
      aria-label={label}
      title={title}
    >
      <span className="h-2 w-2 rounded-full opacity-80" style={{ background: color }} />
    </button>
  );
}

function SideNav({ dir, disabled, quiet }: { dir: 'prev' | 'next'; disabled: boolean; quiet: boolean }) {
  const slideIndex = useApp((s) => s.slideIndex);
  return (
    <div className={`chrome absolute top-1/2 z-10 hidden -translate-y-1/2 md:block ${dir === 'prev' ? 'left-4' : 'right-4'}`} data-quiet={quiet}>
      <button
        type="button"
        className="icon-btn h-12 w-12"
        disabled={disabled}
        onClick={() => actions.setSlide(slideIndex + (dir === 'next' ? 1 : -1))}
        aria-label={dir === 'next' ? 'Next slide (→)' : 'Previous slide (←)'}
      >
        <Icon name={dir === 'next' ? 'chevron-right' : 'chevron-left'} size={24} />
      </button>
    </div>
  );
}

/** Deck progress with a mark wherever your focus dropped this session. */
function DeckRail({ quiet }: { quiet: boolean }) {
  const deck = useDeck();
  const slideIndex = useApp((s) => s.slideIndex);
  const lapses = useApp((s) => s.live.lapsesBySlide);
  return (
    <footer
      className="chrome absolute inset-x-0 bottom-0 z-20 flex h-16 items-center gap-4 pl-[max(12px,env(safe-area-inset-left))] pr-[max(12px,env(safe-area-inset-right))] pb-[env(safe-area-inset-bottom)] sm:pl-5 sm:pr-5"
      data-quiet={quiet}
    >
      <SimHint />
      <button type="button" className="icon-btn md:hidden" onClick={() => actions.setSlide(slideIndex - 1)} disabled={slideIndex === 0} aria-label="Previous slide">
        <Icon name="chevron-left" />
      </button>
      <div className="mx-auto flex w-full max-w-[560px] min-w-0 flex-1 items-end gap-1" role="navigation" aria-label="Slides">
        {deck.slides.map((s) => {
          const n = lapses[s.index] ?? 0;
          const here = s.index === slideIndex;
          return (
            <button
              key={s.index}
              type="button"
              onClick={() => actions.setSlide(s.index)}
              className="group relative flex h-8 min-w-0 flex-1 flex-col justify-end"
              aria-label={`Slide ${s.index + 1}: ${s.title}${n ? `, lost focus ${n}×` : ''}`}
              aria-current={here ? 'true' : undefined}
            >
              {n > 0 && (
                <span className="absolute top-1 left-1/2 flex -translate-x-1/2 gap-[2px]" aria-hidden>
                  {Array.from({ length: Math.min(n, 3) }).map((_, i) => (
                    <span key={i} className="h-[5px] w-[5px] rounded-full bg-lapse" />
                  ))}
                </span>
              )}
              <span
                className="block h-1 w-full rounded-full transition-colors group-hover:bg-pencil"
                style={{ background: here ? 'var(--ink)' : s.index < slideIndex ? 'var(--pencil)' : 'var(--rule-strong)' }}
              />
            </button>
          );
        })}
      </div>
      <span className="num w-14 flex-none text-right text-[14px] text-graphite lg:w-56">
        {slideIndex + 1} / {deck.slideCount}
      </span>
      <button type="button" className="icon-btn md:hidden" onClick={() => actions.setSlide(slideIndex + 1)} disabled={slideIndex >= deck.slideCount - 1} aria-label="Next slide">
        <Icon name="chevron-right" />
      </button>
    </footer>
  );
}

/** Coming back after a drift: a line that fills while your eyes stay on the slide. */
function RecoveringLine() {
  const state = useApp((s) => s.live.state);
  const progress = useApp((s) => s.live.recoverProgress);
  if (state !== 'recovering') return null;
  return (
    <div className="fade-in pointer-events-none absolute top-16 left-1/2 flex -translate-x-1/2 flex-col items-center justify-center gap-2 md:top-0 md:left-5 md:h-16 md:translate-x-0 md:items-start" role="status">
      <span className="text-[14px] font-semibold">Locking back in</span>
      <span className="block h-1 w-40 overflow-hidden rounded-full bg-rule-strong">
        <span className="block h-full rounded-full bg-ok transition-[width] duration-150" style={{ width: `${progress * 100}%` }} />
      </span>
    </div>
  );
}

function PausedVeil() {
  const camera = useApp((s) => s.camera);
  return (
    <div className="fade-in fixed inset-0 z-40 grid place-items-center bg-paper" role="dialog" aria-modal="true" aria-labelledby="paused-title">
      <div className="max-w-sm px-6 text-center">
        <h2 id="paused-title" className="text-[clamp(28px,3vw,40px)]">
          {camera === 'paused' ? 'Camera paused' : 'Paused'}
        </h2>
        <p className="mt-3 text-[17px] text-graphite">Nothing is measured, and the clock has stopped.</p>
        <button type="button" className="btn btn-primary btn-lg mt-8" onClick={() => void togglePause()} autoFocus>
          Resume <kbd>P</kbd>
        </button>
      </div>
    </div>
  );
}

function BreakCard({ reason, until }: { reason: 'repeated' | 'rescueCap'; until: number | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [until]);
  const left = until ? Math.max(0, until - now) : 0;
  const done = until !== null && left === 0;

  return (
    <div className="fade-in fixed inset-0 z-40 grid place-items-center bg-paper px-5" role="dialog" aria-modal="true" aria-labelledby="break-title">
      <div className="rise w-full max-w-lg text-center">
        {until === null ? (
          <>
            <h2 id="break-title" className="text-[clamp(28px,3vw,40px)]">
              {reason === 'repeated' ? 'Tired, not lazy' : 'Time for a real break'}
            </h2>
            <p className="mx-auto mt-3 max-w-[38ch] text-[17px] text-graphite">
              {reason === 'repeated'
                ? 'Two clips in a row. A five-minute walk beats a third one.'
                : 'Clips have taken over 15% of this session. A five-minute walk beats another one.'}
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-2">
              <button type="button" className="btn btn-primary btn-lg" onClick={() => void takeBreak(5)} autoFocus>
                Take 5 minutes
              </button>
              <button type="button" className="btn btn-quiet btn-lg" onClick={dismissBreak}>
                Keep studying
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id="break-title" className="sr-only">
              {done ? 'Break’s over' : 'On a break'}
            </h2>
            <p className="figure text-[clamp(72px,12vw,140px)] leading-none" aria-live="off">
              {Math.floor(left / 60000)}:{Math.floor((left % 60000) / 1000).toString().padStart(2, '0')}
            </p>
            <p className="mt-4 text-[17px] text-graphite">{done ? 'Ready when you are.' : 'Camera off. Stand up, get water, look far away.'}</p>
            <button type="button" className={`btn btn-lg mt-8 ${done ? 'btn-primary' : 'btn-quiet'}`} onClick={() => void endBreak()} autoFocus={done}>
              {done ? 'Back to the slides' : 'Back early'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Only when the focus simulator is on: tells teammates and demo viewers how to drive it. */
function SimHint() {
  const [, force] = useState(0);
  useEffect(() => simulator.subscribe(() => force((x) => x + 1)), []);
  if (!registry.isMock('attention')) return null;
  const away = simulator.profile === 'phone';
  return (
    <button
      type="button"
      onClick={() => simulator.set(away ? 'reading' : 'phone')}
      className="hidden flex-none items-center gap-2 rounded-full px-3 py-2 text-[14px] text-graphite transition-colors hover:bg-raised hover:text-ink md:flex lg:w-56"
      title="The gaze-tracking model isn't connected, so focus is simulated."
    >
      <Icon name={away ? 'eye-off' : 'eye'} size={18} />
      <span>
        <kbd>D</kbd> to look {away ? 'back' : 'away'}
      </span>
    </button>
  );
}

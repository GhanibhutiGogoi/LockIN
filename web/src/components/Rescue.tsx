import { useEffect, useMemo, useRef, useState } from 'react';
import type { CaptionWord, Deck, GameplayLoop, RescuePack } from '../contracts/types';
import { narrate, type Narration } from '../lib/narrator';
import { registry } from '../providers/registry';
import { answerQuiz, clipEnded, finishRescue, skipClip, toggleWrongFact } from '../session/engine';
import { useApp, useDeck, type RescueUI } from '../store';
import { Gameplay } from './Gameplay';
import { Icon } from './Icon';
import { SlideView } from './SlideView';

/**
 * Rescue mode: a 9:16 column that takes over the screen. Slide on top (~55 %),
 * gameplay underneath (~45 %), captions on the split line. One way out sits at
 * the bottom where the thumb is; sound and the flag stay small in the top corner.
 */
export function Rescue() {
  const rescue = useApp((s) => s.rescue);
  const deck = useDeck();
  const [loops, setLoops] = useState<GameplayLoop[]>([]);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    registry.media.listGameplayLoops().then(setLoops).catch(() => setLoops([]));
  }, []);

  useEffect(() => {
    if (!rescue) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && rescue.phase !== 'quiz') {
        e.preventDefault();
        skipClip();
      }
      if (e.key.toLowerCase() === 'm') setMuted((m) => !m);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rescue?.phase, rescue]);

  if (!rescue) return null;
  const slide = deck.slides[rescue.context.slideIndex] ?? deck.slides[0];
  const variant = rescue.choice?.variant;
  const loop = loops.find((l) => l.type === variant?.gameplayType) ?? loops[0];

  return (
    <div className="rescue-in fixed inset-0 z-50 overflow-hidden bg-rot-bg text-rot-ink" role="dialog" aria-modal="true" aria-label="Focus rescue">
      {/* the slide you left, blurred, so the takeover still feels anchored to it */}
      <div className="pointer-events-none absolute inset-[-40px] opacity-60" style={{ filter: 'blur(28px) brightness(0.4) saturate(1.2)' }} aria-hidden>
        <SlideView deck={deck} slide={slide} shadow={false} />
      </div>

      <div className="relative mx-auto flex h-full items-center justify-center gap-6 px-0 sm:px-4">
        <div
          className="relative h-full overflow-hidden bg-black sm:h-[calc(100%-32px)] sm:rounded-[22px]"
          style={{ aspectRatio: '9 / 16', maxWidth: '100%' }}
        >
          {rescue.phase === 'loading' && <Loading deck={deck} rescue={rescue} />}
          {rescue.phase === 'error' && <ErrorCard rescue={rescue} />}
          {(rescue.phase === 'playing' || rescue.phase === 'quiz') && rescue.pack && (
            <Player deck={deck} rescue={rescue} pack={rescue.pack} loop={loop} muted={muted} quiz={rescue.phase === 'quiz'} />
          )}

          {(rescue.phase === 'loading' || rescue.phase === 'playing') && (
            <>
              <Corner muted={muted} onMute={() => setMuted((m) => !m)} flag={rescue.phase === 'playing' ? !!rescue.flagged : null} />
              <BackButton />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Secondary controls, out of the clip's way under the progress line. */
function Corner({ muted, onMute, flag }: { muted: boolean; onMute: () => void; flag: boolean | null }) {
  const glass = 'grid h-10 w-10 place-items-center rounded-full transition-[background-color,color,transform] duration-150 active:scale-95';
  const off = 'bg-black/50 text-white hover:bg-black/75';
  return (
    <div className="absolute top-[18px] right-3 z-20 flex gap-2">
      {flag !== null && (
        <button
          type="button"
          className={`${glass} ${flag ? 'bg-white text-black hover:bg-white/85' : off}`}
          onClick={toggleWrongFact}
          aria-pressed={flag}
          aria-label={flag ? 'Flagged as a wrong fact. Press again to take it back' : 'Flag a wrong fact'}
          title={flag ? 'Flagged · press again to take it back' : 'Flag a wrong fact'}
        >
          <Icon name="flag" size={18} />
        </button>
      )}
      <button type="button" className={`${glass} ${off}`} onClick={onMute} aria-pressed={muted} aria-keyshortcuts="M" aria-label={muted ? 'Unmute (M)' : 'Mute (M)'} title={muted ? 'Unmute · M' : 'Mute · M'}>
        <Icon name={muted ? 'volume-off' : 'volume'} size={18} />
      </button>
    </div>
  );
}

/** The one way out: wide, white, where the thumb already is. */
function BackButton() {
  return (
    <div className="absolute inset-x-0 bottom-[max(20px,env(safe-area-inset-bottom))] z-20 flex justify-center px-4">
      <button
        type="button"
        className="flex h-12 items-center gap-2.5 rounded-full bg-white pr-2.5 pl-5 text-[16px] font-bold text-black shadow-[0_6px_24px_rgba(0,0,0,0.45)] transition-[background-color,transform] duration-150 hover:bg-[var(--highlight)] active:scale-[0.97]"
        onClick={skipClip}
        aria-keyshortcuts="Escape"
      >
        <Icon name="return" size={18} />
        I’m back
        <kbd className="text-black/60">Esc</kbd>
      </button>
    </div>
  );
}

/** The clip's progress, short-form style. The slide it came from is already on screen. */
function Header({ progress }: { progress: number }) {
  return (
    <div className="absolute inset-x-0 top-0 z-20 px-3 pt-3">
      <div className="h-[3px] overflow-hidden rounded-full bg-white/25">
        <div className="h-full rounded-full bg-white" style={{ width: `${Math.min(100, progress * 100)}%` }} />
      </div>
    </div>
  );
}

// ───────── playback ─────────

interface Chunk {
  from: number;
  to: number; // inclusive
}

/** 1–3 words per caption, breaking after punctuation. */
function chunkCaptions(words: CaptionWord[]): Chunk[] {
  const out: Chunk[] = [];
  let from = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i].word;
    const len = i - from + 1;
    const long = words.slice(from, i + 1).reduce((a, x) => a + x.word.length, 0) > 12;
    if (/[.!?,;:]$/.test(w) || len === 3 || (len >= 2 && long) || i === words.length - 1) {
      out.push({ from, to: i });
      from = i + 1;
    }
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, '');

function Player({ deck, rescue, pack, loop, muted, quiz }: { deck: Deck; rescue: RescueUI; pack: RescuePack; loop?: GameplayLoop; muted: boolean; quiz: boolean }) {
  const { captions, durationSec } = pack.media;
  const text = `${pack.script.hook} ${pack.script.script}`;
  const chunks = useMemo(() => chunkCaptions(captions), [captions]);
  const [wordIdx, setWordIdx] = useState(-1);
  const [progress, setProgress] = useState(0);
  const [term, setTerm] = useState<string | null>(null);
  const narration = useRef<Narration | null>(null);
  const termTimer = useRef<number | null>(null);

  // start narration once; quiz phase keeps the visuals but stops the clock
  useEffect(() => {
    if (quiz) return;
    const n = narrate(pack.media, text, pack.variant, muted);
    narration.current = n;
    let raf = 0;
    const loopFn = () => {
      const t = n.time();
      let idx = n.boundaryWord();
      if (idx < 0) {
        idx = -1;
        for (let i = 0; i < captions.length; i++) if (captions[i].start <= t) idx = i;
      }
      setWordIdx(idx);
      setProgress(Math.min(1, t / durationSec));
      raf = requestAnimationFrame(loopFn);
    };
    raf = requestAnimationFrame(loopFn);
    let cancelled = false;
    n.done.then(() => {
      if (!cancelled) clipEnded();
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      n.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack, quiz]);

  useEffect(() => narration.current?.setMuted(muted), [muted]);

  // cut to the key term when it is spoken
  useEffect(() => {
    if (wordIdx < 0) return;
    const w = norm(captions[wordIdx]?.word ?? '');
    const hit = pack.script.keyTerms.find((k) => norm(k.term.split(/\s+/)[0]) === w);
    if (hit) {
      setTerm(hit.term);
      if (termTimer.current) clearTimeout(termTimer.current);
      termTimer.current = window.setTimeout(() => setTerm(null), 2600);
    }
  }, [wordIdx, captions, pack.script.keyTerms]);

  const chunkIdx = chunks.findIndex((c) => wordIdx >= c.from && wordIdx <= c.to);
  const chunk = chunkIdx >= 0 ? chunks[chunkIdx] : null;
  const broll = term ? pack.media.broll.find((b) => norm(b.term) === norm(term)) : undefined;
  const slide = deck.slides[pack.slideIndex];

  return (
    <div className="absolute inset-0">
      {/* top: the slide, slowly pushing in */}
      <div className="absolute inset-x-0 top-0 h-[55%] overflow-hidden bg-[#111]">
        <div
          className="absolute inset-0 grid place-items-center p-3 pt-8"
          style={{
            // a slow push-in that never crops the slide's first letters
            transform: `scale(${quiz ? 1.02 : 1.02 + progress * 0.07})`,
            transformOrigin: '50% 45%',
            transition: 'transform 300ms linear',
            filter: quiz ? 'brightness(0.35)' : undefined,
          }}
        >
          <SlideView deck={deck} slide={slide} emphasis={term} shadow={false} />
        </div>
        {broll && !quiz ? (
          broll.kind === 'video' ? (
            <video key={broll.url} src={broll.url} className="fade-in absolute inset-0 h-full w-full object-cover" autoPlay muted playsInline />
          ) : (
            <img key={broll.url} src={broll.url} alt={broll.term} className="fade-in absolute inset-0 h-full w-full object-cover" />
          )
        ) : (
          term &&
          !quiz && (
            <div key={term} className="rise absolute top-[72px] left-4 max-w-[calc(100%-32px)] rounded-xl bg-black/85 px-4 py-3">
              <p className="rot-caption text-[clamp(26px,4.6vh,40px)]">
                <span className="now">{term}</span>
              </p>
            </div>
          )
        )}
      </div>

      {/* bottom: gameplay */}
      <div className="absolute inset-x-0 bottom-0 h-[45%] overflow-hidden">
        <Gameplay loop={loop} dim={quiz} />
      </div>

      {/* captions straddle the split */}
      {!quiz && chunk && (
        <div className="pointer-events-none absolute inset-x-0 top-[55%] z-10 -translate-y-1/2 px-6 text-center">
          <p key={chunkIdx} className="rot-caption rot-pop text-[clamp(28px,6.4vh,52px)]">
            {captions.slice(chunk.from, chunk.to + 1).map((w, i) => (
              <span key={i} className={chunk.from + i === wordIdx ? 'now' : undefined}>
                {w.word}{' '}
              </span>
            ))}
          </p>
        </div>
      )}

      <Header progress={quiz ? 1 : progress} />

      {quiz && <Quiz pack={pack} rescue={rescue} />}
    </div>
  );
}

// ───────── quiz ─────────

function Quiz({ pack, rescue }: { pack: RescuePack; rescue: RescueUI }) {
  const questions = pack.script.quiz.slice(0, Math.max(1, pack.variant.quizCount));
  const qi = Math.min(rescue.answers.length, questions.length - 1);
  const q = questions[qi];
  const answer = rescue.answers.find((a) => a.questionIndex === qi);
  const allDone = rescue.answers.length >= questions.length;
  const [countdown, setCountdown] = useState<number | null>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const group = useRef<HTMLDivElement>(null);

  // focus lands on the answer group, not on option 1, so nothing looks pre-chosen; Tab reaches the options
  useEffect(() => {
    group.current?.focus({ preventScroll: true });
  }, [qi]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!answer) {
        const n = Number(e.key);
        if (n >= 1 && n <= q.options.length) {
          e.preventDefault();
          answerQuiz(qi, n - 1);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [answer, q, qi]);

  // after the last answer, return automatically (cancelled by any interaction)
  useEffect(() => {
    if (!allDone) return;
    backRef.current?.focus({ preventScroll: true });
    setCountdown(4);
    const id = window.setInterval(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearInterval(id);
  }, [allDone]);
  useEffect(() => {
    if (countdown !== null && countdown <= 0) finishRescue();
  }, [countdown]);

  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-center px-5 pb-6 pt-16">
      <div className="fade-in absolute inset-0 bg-black/90" aria-hidden />
      {answer?.correct && <Confetti />}
      <div className="rise relative">
        {questions.length > 1 && (
          <p className="num text-[14px] font-semibold text-white/75">
            {qi + 1} of {questions.length}
          </p>
        )}
        <h2 className="mt-2 text-[clamp(22px,3.6vh,30px)] leading-[1.15] font-bold">
          {q.question}
        </h2>
        <div ref={group} tabIndex={-1} className="mt-5 grid gap-2 outline-none" role="group" aria-label={`Answers, press 1 to ${q.options.length}`}>
          {q.options.map((opt, i) => {
            const chosen = answer?.chosen === i;
            const isRight = i === q.answerIndex;
            const state = !answer ? 'idle' : isRight ? 'right' : chosen ? 'wrong' : 'muted';
            return (
              <button
                key={i}
                type="button"
                disabled={!!answer}
                onClick={() => answerQuiz(qi, i)}
                className="flex min-h-[52px] items-center gap-3 rounded-xl px-4 text-left text-[16px] font-semibold transition-[background-color,opacity,transform] duration-150 enabled:hover:translate-x-0.5 disabled:cursor-default"
                style={{
                  background: state === 'right' ? 'var(--highlight)' : state === 'wrong' ? '#3a1512' : state === 'muted' ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.94)',
                  color: state === 'right' || state === 'idle' ? '#111' : state === 'wrong' ? '#ffb4a8' : 'rgba(255,255,255,0.45)',
                  boxShadow: state === 'wrong' ? 'inset 0 0 0 2px #f06b56' : undefined,
                }}
                aria-keyshortcuts={String(i + 1)}
              >
                <span
                  className="grid h-7 w-7 flex-none place-items-center rounded-md text-[13px] font-semibold"
                  style={{ background: state === 'idle' ? '#111' : 'rgba(0,0,0,0.15)', color: state === 'idle' ? '#fff' : 'inherit' }}
                >
                  {state === 'right' ? <Icon name="check" size={16} /> : state === 'wrong' ? <Icon name="x" size={16} /> : i + 1}
                </span>
                <span className={state === 'wrong' ? 'line-through decoration-2' : undefined}>{opt}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-5 min-h-[88px]" aria-live="polite">
          {answer && (
            <div className="rise">
              <p className="rot-caption text-[clamp(34px,6vh,48px)]">{answer.correct ? <span className="now">W</span> : 'Nah'}</p>
              <p className="mt-2 text-[15px] leading-snug text-white/90">{answer.correct ? q.ifRight : q.ifWrong}</p>
            </div>
          )}
        </div>

        {allDone && (
          <button ref={backRef} type="button" className="btn mt-4 w-full bg-white text-black hover:bg-[var(--highlight)]" onClick={finishRescue}>
            Back to the slide
            {countdown !== null && countdown > 0 && <span className="num text-black/50">{countdown}</span>}
          </button>
        )}
      </div>
    </div>
  );
}

function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = c.getContext('2d')!;
    const w = (c.width = c.clientWidth);
    const h = (c.height = c.clientHeight);
    const colors = ['#eeea3f', '#ffffff', '#ff5a5f', '#00c2a8', '#3d7bff'];
    const ps = Array.from({ length: 90 }, () => ({
      x: w / 2 + (Math.random() - 0.5) * 40,
      y: h * 0.62,
      vx: (Math.random() - 0.5) * 9,
      vy: -6 - Math.random() * 9,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      c: colors[Math.floor(Math.random() * colors.length)],
    }));
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      ctx.clearRect(0, 0, w, h);
      for (const p of ps) {
        p.vy += 0.32;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        ctx.fillRect(-4, -2.5, 8, 5);
        ctx.restore();
      }
      if (now - t0 < 1600) raf = requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, w, h);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />;
}

// ───────── loading / error ─────────

function Loading({ deck, rescue }: { deck: Deck; rescue: RescueUI }) {
  const slide = deck.slides[rescue.context.slideIndex];
  return (
    <div className="absolute inset-0">
      <div className="absolute inset-x-0 top-0 h-[55%] overflow-hidden bg-[#111]">
        <div className="absolute inset-0 grid place-items-center p-3 pt-8 opacity-70">
          <SlideView deck={deck} slide={slide} shadow={false} />
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-[45%] bg-[#0f0f12]" />
      <div className="absolute inset-x-0 top-[55%] -translate-y-1/2 px-6 text-center">
        <p className="rot-caption text-[clamp(26px,5vh,40px)]">{rescue.depth === 2 ? 'Once more, shorter' : 'Hold up'}</p>
        <div className="mx-auto mt-5 h-1 w-32 overflow-hidden rounded-full bg-white/15">
          <div className="h-full w-1/3 rounded-full bg-white" style={{ animation: 'loadbar 1s ease-in-out infinite alternate' }} />
        </div>
      </div>
      <Header progress={0} />
      <style>{'@keyframes loadbar{from{transform:translateX(-10%)}to{transform:translateX(210%)}}'}</style>
    </div>
  );
}

function ErrorCard({ rescue }: { rescue: RescueUI }) {
  return (
    <div className="absolute inset-0 flex flex-col justify-center gap-4 px-6">
      <p className="rot-caption text-[34px]">No clip this time</p>
      <p className="text-[15px] leading-snug text-white/80">LockIn couldn’t make a clip for this slide, so here’s the plain version: look back at the slide and read the first line out loud.</p>
      <details className="text-[12px] text-white/50">
        <summary className="cursor-pointer">What went wrong</summary>
        <p className="mt-1 break-words">{rescue.error}</p>
      </details>
      <button type="button" className="btn bg-white text-black hover:bg-[var(--highlight)]" onClick={skipClip} autoFocus>
        Back to the slide
      </button>
    </div>
  );
}

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Deck } from '../contracts/types';
import { buildSampleReport } from '../lib/sampleReport';
import { registry } from '../providers/registry';
import { actions, useApp } from '../store';
import { Icon } from './Icon';
import { IntegrationsButton } from './IntegrationsPanel';
import { SlideView } from './SlideView';
import { Wordmark } from './Wordmark';

/*
 * The home of a demo: the name, one sentence on what LockIn does, and two ways
 * in (your own PDF, or the sample deck). Your decks follow once you have some.
 */


const MARGIN = 'px-5 lg:px-10';
const S4 = 'text-[clamp(22px,2.2vw,32px)] leading-[1.1] font-bold tracking-[-0.015em]';

export function DeskScreen() {
  const decks = useApp((s) => s.decks);
  const summaries = useApp((s) => s.deckSummaries);
  const [over, setOver] = useState(false);
  const files = useIngest();
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);

  const own = decks.filter((d) => d.sourceType !== 'demo');
  const sample = decks.find((d) => d.sourceType === 'demo');

  const pick = () => input.current?.click();
  function study(deck: Deck) {
    actions.openDeck(deck.id);
    actions.go('study');
  }
  const trySample = () => sample && study(sample);
  const sampleReport = () => {
    useApp.setState({ report: buildSampleReport() });
    actions.go('report');
  };

  return (
    <div
      ref={root}
      className="min-h-full"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (e.relatedTarget === null) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void files.ingest(e.dataTransfer.files[0], study);
      }}
    >
      <Hero onPick={pick} onSample={trySample} onReport={sampleReport} busy={!!files.busy} />
      {own.length > 0 && <YourDecks decks={own} meta={(d) => deckMeta(d, summaries[d.id])} onStudy={study} onPick={pick} />}

      <input
        ref={input}
        id="deck-file"
        type="file"
        accept=".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        className="sr-only"
        tabIndex={-1}
        aria-label="Open a PDF or PowerPoint"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          void files.ingest(f, study);
        }}
      />

      {over && !files.busy && (
        <div className="fade-in pointer-events-none fixed inset-0 z-50 grid place-items-center bg-[color-mix(in_srgb,var(--paper)_94%,transparent)] px-5" aria-hidden>
          <div className="text-center">
            <Icon name="upload" size={32} className="mx-auto text-graphite" />
            <p className="mt-5 text-[clamp(28px,4vw,48px)] leading-[1.05] font-bold tracking-[-0.02em]">Drop to start reading</p>
            <p className="mt-3 text-[17px] text-graphite">A PDF of your lecture slides</p>
          </div>
        </div>
      )}
      {files.busy && <Reading name={files.busy} />}
    </div>
  );
}

// ───────── hero: the name, at night ─────────

function Hero({ onPick, onSample, onReport, busy }: { onPick: () => void; onSample: () => void; onReport: () => void; busy: boolean }) {
  const quiet = 'text-[15px] font-semibold text-graphite transition-colors hover:text-ink';
  return (
    <section className="relative flex min-h-[100svh] flex-col overflow-hidden bg-paper text-ink" aria-labelledby="home-title">
      <nav className={`flex h-16 flex-none items-center gap-5 ${MARGIN}`} aria-label="LockIn">
        <Wordmark />
        <span className="flex-1" />
        <button type="button" className={`${quiet} max-sm:hidden`} onClick={onReport}>
          Example report
        </button>
        <span className="flex items-center gap-1">
          <IntegrationsButton />
          <button type="button" className="icon-btn" onClick={() => useApp.setState({ settingsOpen: true })} aria-label="Settings">
            <Icon name="settings" size={20} />
          </button>
        </span>
      </nav>

      <div className={`relative flex flex-1 flex-col ${MARGIN}`}>
        <div className="my-auto grid items-end gap-x-5 gap-y-10 py-10 lg:grid-cols-12">
          <h1 id="home-title" className="home-name lg:col-span-8" aria-label="LockIn">
            <span className="home-line" aria-hidden>
              <span>Lock</span>
            </span>
            <span className="home-line" aria-hidden>
              <span className="home-in" style={{ animationDelay: '110ms' }}>In</span>
            </span>
          </h1>

          {/* what it is, at statement size, in the space the short second line leaves */}
          <div className="home-after max-w-[30ch] pb-[0.6vw] lg:col-span-4 lg:max-w-none">
            <p className="text-[clamp(22px,1.9vw,30px)] leading-[1.25] font-semibold tracking-[-0.01em]">
              A study app for your lecture slides. When your eyes drift, the slide comes back as a 20-second clip.
            </p>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            <button type="button" className="btn btn-primary btn-lg" onClick={onPick} disabled={busy}>
              Open your slides
            </button>
            <button type="button" className="link text-[16px]" onClick={onSample}>
              Try the sample deck
            </button>
          </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ───────── your decks (only once you have opened some) ─────────

function YourDecks({ decks, meta, onStudy, onPick }: { decks: Deck[]; meta: (d: Deck) => string; onStudy: (d: Deck) => void; onPick: () => void }) {
  return (
    <section className={`bg-sheet py-24 lg:py-32 ${MARGIN}`} aria-labelledby="decks-title">
      <h2 id="decks-title" className={`reveal ${S4}`}>
        Your decks
      </h2>
      <ul className="mt-10 grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
        {decks.map((d, i) => (
          <li key={d.id} className="reveal" style={{ '--d': `${60 + i * 70}ms` } as CSSProperties}>
            <button type="button" className="group block w-full text-left" onClick={() => onStudy(d)}>
              <span className="block aspect-video overflow-hidden rounded-[var(--r-paper)] bg-slide transition-transform duration-300 ease-[var(--ease-out)] group-hover:-translate-y-1">
                <span className="pointer-events-none block h-full w-full" data-ui aria-hidden>
                  <SlideView deck={d} slide={d.slides[0]} />
                </span>
              </span>
              <span className="mt-3 block truncate text-[17px] font-semibold">{d.title}</span>
              <span className="block text-[15px] text-graphite">{meta(d)}</span>
            </button>
          </li>
        ))}
        <li className="reveal" style={{ '--d': `${60 + decks.length * 70}ms` } as CSSProperties}>
          <button type="button" className="group block w-full text-left" onClick={onPick}>
            <span className="grid aspect-video place-items-center rounded-[var(--r-paper)] bg-raised text-graphite transition-colors group-hover:text-ink">
              <Icon name="upload" size={24} />
            </span>
            <span className="mt-3 block text-[17px] font-semibold">Add slides</span>
            <span className="block text-[15px] text-graphite">A PDF</span>
          </button>
        </li>
      </ul>
    </section>
  );
}

// ───────── entrances: each part rises once as its section arrives ─────────

function useReveal(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el || !('IntersectionObserver' in window)) return;
    el.classList.add('reveal-on');
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    const watch = () => el.querySelectorAll('.reveal:not(.in)').forEach((n) => io.observe(n));
    watch();
    const mo = new MutationObserver(watch);
    mo.observe(el, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, [root]);
}


function deckMeta(deck: Deck, summary?: { lastStudied: number; lastSpanSec: number }) {
  const n = `${deck.slideCount} slides`;
  if (summary) return `${n} · studied ${relTime(summary.lastStudied)}`;
  if (deck.sourceType === 'demo') return `Sample deck · ${n}`;
  return n;
}


function useIngest() {
  const [busy, setBusy] = useState<string | null>(null);
  async function ingest(file: File | undefined, onDeck: (d: Deck) => void) {
    if (!file) return;
    setBusy(file.name);
    try {
      const deck = await registry.content.ingestDeck(file);
      actions.addDeck(deck);
      setBusy(null);
      onDeck(deck);
    } catch (err) {
      setBusy(null);
      actions.toast(ingestError(file, err as Error), 'error');
    }
  }
  return { busy, ingest };
}

const devTools = import.meta.env.DEV || import.meta.env.VITE_SHOW_INTEGRATIONS === 'true';

/** Turns parser and service errors into a sentence that says what to do next. */
function ingestError(file: File, err: Error) {
  const name = file.name.toLowerCase();
  const msg = err?.message ?? '';
  if (err?.name === 'PasswordException' || /password/i.test(msg)) return `${file.name} is password-protected. Save a copy without the password and open that.`;
  if (err?.name === 'InvalidPDFException' || /invalid pdf|pdf structure|missing pdf|unexpected server response/i.test(msg))
    return `${file.name} couldn’t be opened. It may be damaged or not really a PDF. Export it from the original app again.`;
  if (/\.pptx?$/.test(name) && !devTools) return 'PowerPoint isn’t supported yet. Export the deck as PDF and open that.';
  if (!/\.(pdf|pptx?)$/.test(name) && file.type !== 'application/pdf') return `${file.name} isn’t a slide deck. LockIn opens PDF slides.`;
  return msg || `${file.name} couldn’t be opened.`;
}

/** While a file is read: the desk steps back and says what it is doing. */
function Reading({ name }: { name: string }) {
  return (
    <div className="fade-in fixed inset-0 z-50 grid place-items-center bg-[color-mix(in_srgb,var(--paper)_94%,transparent)] px-5" role="status" aria-live="polite">
      <div className="w-full max-w-[min(560px,100%)] text-center">
        <p className="text-[clamp(28px,4vw,48px)] leading-[1.05] font-bold tracking-[-0.02em]">Reading your slides</p>
        <p className="mt-3 truncate text-[17px] text-graphite">{name}</p>
        <span className="mx-auto mt-8 block h-1 w-40 overflow-hidden rounded-full bg-raised" aria-hidden>
          <span className="block h-full w-1/3 rounded-full bg-ink" style={{ animation: 'deskload 1.1s var(--ease-out) infinite alternate' }} />
        </span>
      </div>
      <style>{'@keyframes deskload{from{transform:translateX(-20%)}to{transform:translateX(220%)}}'}</style>
    </div>
  );
}


function relTime(t: number) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(t).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
}

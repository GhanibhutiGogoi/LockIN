import { useRef, useState } from 'react';
import type { Deck } from '../contracts/types';
import { importError, importPdf, validateSlideFile } from '../lib/deckImport';
import { DEMO_MODE } from '../lib/features';
import { shareStudyScreen } from '../lib/screenShare';
import { registry, useIntegrationConfig } from '../providers/registry';
import { formatDuration } from '../session/metrics';
import { actions, useApp } from '../store';
import { Icon } from './Icon';
import { IntegrationsButton } from './IntegrationsPanel';
import { SlideView } from './SlideView';
import { Wordmark } from './Wordmark';

export function DeskScreen() {
  const integrations = useIntegrationConfig();
  const decks = useApp((s) => s.decks).filter((deck) => deck.sourceType !== 'screen');
  const reports = useApp((s) => s.reports);
  const ready = useApp((s) => s.libraryReady);
  const warning = useApp((s) => s.libraryWarning);
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const inFlight = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const powerPoint = integrations.content.mode === 'http' && integrations.content.deckImport !== false;
  const pick = () => input.current?.click();
  const study = (deck: Deck) => { actions.openDeck(deck.id); actions.go('study'); };

  async function ingest(files: FileList | null) {
    if (!files?.length || inFlight.current || !ready) return;
    if (files.length !== 1) { setError('Choose one deck at a time.'); return; }
    const file = files[0];
    inFlight.current = true;
    setError(null);
    setBusy(file.name);
    try {
      validateSlideFile(file, powerPoint);
      const pdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
      const deck = pdf ? await importPdf(file) : await registry.content.ingestDeck(file);
      await actions.saveDeck(deck, pdf ? file : undefined);
      study(deck);
    } catch (err) {
      setError(importError(err));
    } finally {
      setBusy(null);
      inFlight.current = false;
    }
  }

  async function remove(deck: Deck) {
    if (removing !== deck.id) { setRemoving(deck.id); return; }
    try { await actions.removeDeck(deck); setRemoving(null); }
    catch { setError('The saved deck could not be removed. Close other LockIn tabs and try again.'); }
  }

  return (
    <div className="min-h-full bg-paper text-ink"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
      onDrop={(e) => { e.preventDefault(); setOver(false); void ingest(e.dataTransfer.files); }}>
      <header className="flex h-16 items-center gap-3 px-5 lg:px-10">
        <Wordmark /><span className="flex-1" />
        <IntegrationsButton />
        <button type="button" className="icon-btn" onClick={() => useApp.setState({ settingsOpen: true })} aria-label="Settings"><Icon name="settings" size={20} /></button>
      </header>

      <main>
        <section className={`grid items-center gap-10 px-5 py-12 lg:grid-cols-12 lg:px-10 ${decks.length ? 'min-h-[55svh]' : 'min-h-[calc(100svh-64px)]'}`} aria-labelledby="home-title">
          <h1 id="home-title" className="home-name lg:col-span-8" aria-label="LockIn">
            <span className="home-line" aria-hidden><span>Lock</span></span>
            <span className="home-line" aria-hidden><span className="home-in">In</span></span>
          </h1>
          <div className="max-w-[38ch] lg:col-span-4">
            <p className="text-[clamp(22px,1.9vw,30px)] font-semibold leading-[1.25]">Your slides. Space to focus.</p>
            <p className="mt-4 text-[17px] leading-relaxed text-graphite">Open your lecture slides, pick up where you left off, and keep a record of each study session.</p>
            <button type="button" className="btn btn-primary btn-lg mt-7" onClick={pick} disabled={!!busy || !ready} aria-describedby="upload-help">
              <Icon name="upload" size={20} /> {ready ? 'Open your slides' : 'Opening your library…'}
            </button>
            <p id="upload-help" className="mt-3 text-[15px] text-graphite">{powerPoint ? 'PDF or PowerPoint' : 'PDF'} · up to 50 MB. Drop a file anywhere.</p>
            <p className="mt-2 text-[15px] text-graphite">PDFs are saved in this browser. {powerPoint ? 'PowerPoint files are sent to the slide service for conversion.' : 'In PowerPoint, use Export → PDF first.'}</p>
            {error && <p role="alert" className="mt-5 text-[16px] text-lapse">{error}</p>}
            {warning && <p role="status" className="mt-5 text-[15px] text-graphite">{warning}</p>}
            <p className="mt-5 text-[15px] text-graphite">
              {registry.canRecap() ? 'AI recaps are enabled. You can request one during study.' : 'AI recaps are not connected yet. Slide study works without them.'}
              {registry.config.attention.mode === 'off' && ' Gaze tracking is unavailable; no attention score will be estimated.'}
            </p>
            <form className="mt-7 grid gap-2 border-t border-rule pt-5" onSubmit={(e) => {
              e.preventDefault();
              void shareStudyScreen(false, goal);
            }}>
              <label htmlFor="screen-goal" className="text-[15px] font-semibold">What are you studying? <span className="font-normal text-graphite">(optional)</span></label>
              <input id="screen-goal" type="text" maxLength={300} value={goal} onChange={(e) => setGoal(e.target.value)}
                className="rounded-lg border border-rule bg-sheet px-3 py-2 text-[15px]" placeholder="e.g. Review reinforcement learning"
                aria-describedby="screen-goal-help" />
              <p id="screen-goal-help" className="text-[13px] text-graphite">Share your entire calibrated display to study across apps. Add a goal to detect unrelated content. Connect narration in Settings for video reminders.</p>
              <button type="submit" className="btn btn-quiet mt-1 justify-self-start" disabled={!!busy || !ready}>Share your screen</button>
            </form>
            {DEMO_MODE && <button type="button" className="btn btn-quiet mt-4" onClick={async () => {
              const { DEMO_DECK } = await import('../lib/demoDeck');
              actions.addDeck(DEMO_DECK); study(DEMO_DECK);
            }}>Open development sample</button>}
          </div>
        </section>

        {decks.length > 0 && <section className="bg-sheet px-5 py-12 lg:px-10" aria-labelledby="decks-title">
          <h2 id="decks-title" className="text-[28px]">Your decks</h2>
          <ul className="mt-7 grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
            {decks.map((deck) => <li key={deck.id} className="min-w-0">
              <button type="button" className="group block w-full text-left" onClick={() => study(deck)}>
                <span className="block aspect-video overflow-hidden rounded-[var(--r-paper)] bg-slide" aria-hidden><SlideView deck={deck} slide={deck.slides[0]} /></span>
                <span className="mt-3 block break-words text-[18px] font-semibold group-hover:underline">{deck.title}</span>
                <span className="text-[15px] text-graphite">{deck.slideCount} {deck.slideCount === 1 ? 'slide' : 'slides'} · Continue studying</span>
              </button>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => void remove(deck)} aria-label={`Remove ${deck.title}`}>
                  {removing === deck.id ? 'Confirm removal from this browser' : 'Remove'}
                </button>
                {removing === deck.id && <button type="button" className="btn btn-quiet btn-sm" onClick={() => setRemoving(null)}>Cancel</button>}
              </div>
            </li>)}
          </ul>
        </section>}

        {reports.length > 0 && <section className="px-5 py-12 lg:px-10" aria-labelledby="history-title">
          <h2 id="history-title" className="text-[28px]">Recent sessions</h2>
          <ul className="mt-5 divide-y divide-rule">
            {reports.slice(0, 20).map((report) => <li key={report.log.sessionId}>
              <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 py-5 text-left hover:text-graphite" onClick={() => actions.openReport(report)}>
                <span className="min-w-0 break-words text-[18px] font-semibold">{report.deck.title}</span>
                <span className="text-[15px] text-graphite">{new Date(report.log.endedAt).toLocaleDateString()} · {formatDuration(report.log.activeSeconds ?? (report.log.endedAt - report.log.startedAt) / 1000)} · View report</span>
              </button>
            </li>)}
          </ul>
        </section>}
      </main>

      <input ref={input} type="file" accept={powerPoint ? '.pdf,.pptx' : '.pdf,application/pdf'} className="sr-only" tabIndex={-1} aria-label="Open your slides"
        onChange={(e) => { void ingest(e.target.files); e.target.value = ''; }} />
      {(busy || over) && <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-paper/95 px-5" role="status" aria-live="polite">
        <div className="max-w-lg text-center">
          <Icon name="upload" size={32} className="mx-auto" />
          <p className="mt-5 text-[32px] font-semibold">{busy ? 'Reading your slides' : 'Drop your slides here'}</p>
          <p className="mt-3 break-words text-[17px] text-graphite">{busy ?? 'Choose one deck, up to 50 MB.'}</p>
        </div>
      </div>}
    </div>
  );
}

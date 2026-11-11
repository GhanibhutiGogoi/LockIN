import { useEffect, useState, useSyncExternalStore } from 'react';
import type { FocusSample, RescueContext, Variant } from '../contracts/types';
import { checkMedia, checkScript, ContractError } from '../contracts/validate';
import { DEMO_DECK } from '../lib/demoDeck';
import { devlog, type DevLogEntry } from '../lib/devlog';
import { buildSampleReport } from '../lib/sampleReport';
import { SIM_PROFILES, simulator } from '../providers/mock/attention';
import { attentionPluginLabel, registry, TEAM_INFO, type ServiceTeam } from '../providers/registry';
import { DEFAULT_VARIANT } from '../session/packs';
import { actions, useApp } from '../store';
import { Icon } from './Icon';

/**
 * Integrations panel — for the four teams plugging into the UI.
 * Toggle with the ` key. Switch each module between mock and the real service,
 * run a contract check, drive the focus simulator, and watch every call.
 */
/** Dev builds, or a build that opts in, carry the panel. */
export const SHOW_INTEGRATIONS = import.meta.env.DEV || import.meta.env.VITE_SHOW_INTEGRATIONS === 'true';

/** The panel's way in: one plug icon in each screen's top bar, beside Settings. */
export function IntegrationsButton({ className = 'icon-btn' }: { className?: string }) {
  if (!SHOW_INTEGRATIONS) return null;
  return (
    <button type="button" className={className} onClick={() => useApp.setState({ devOpen: !useApp.getState().devOpen })} aria-label="Integrations (`)" aria-keyshortcuts="`" title="Integrations · `">
      <Icon name="plug" size={18} />
    </button>
  );
}

export function IntegrationsPanel() {
  const open = useApp((s) => s.devOpen);
  const config = useSyncExternalStore(
    (f) => registry.subscribe(f),
    () => registry.config,
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '`' && !(e.target as HTMLElement).closest('input, textarea')) {
        e.preventDefault();
        useApp.setState({ devOpen: !useApp.getState().devOpen });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      {open && (
        <aside
          className="fixed top-0 right-0 z-[70] flex h-full w-[min(480px,100%)] flex-col border-l border-rule bg-sheet text-[13px] shadow-2xl"
          aria-label="Integrations"
          style={{ animation: 'sheet-in 200ms var(--ease-out)' }}
        >
          <div className="flex items-center gap-2 border-b border-rule px-4 py-3">
            <Icon name="plug" size={16} />
            <h2 className="flex-1 font-mono text-[14px] font-semibold tracking-normal" style={{ fontVariationSettings: 'normal' }}>
              Integrations
            </h2>
            <button type="button" className="btn btn-ghost btn-sm font-mono text-[12px]" onClick={() => registry.reset()}>
              Reset
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => useApp.setState({ devOpen: false })} aria-label="Close integrations">
              <Icon name="x" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <p className="border-b border-rule px-4 py-3 text-graphite">
              Each team’s module runs as a mock until you point it at your service. Contracts live in <code className="font-mono">src/contracts</code>; wire formats in <code className="font-mono">docs/INTEGRATION.md</code>.
            </p>
            {(Object.keys(TEAM_INFO) as ServiceTeam[]).map((t) => (
              <TeamCard key={t} team={t} mode={config[t].mode} url={config[t].url} />
            ))}
            {config.attention.mode === 'mock' && <Simulator />}
            <LiveState />
            <Shortcuts />
            <Log />
          </div>
        </aside>
      )}
    </>
  );
}

type Check = { state: 'idle' | 'running' | 'ok' | 'fail'; detail?: string[]; ms?: number };

function TeamCard({ team, mode, url }: { team: ServiceTeam; mode: string; url: string }) {
  const info = TEAM_INFO[team];
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const [draft, setDraft] = useState(url);
  useEffect(() => setDraft(url), [url]);
  const needsUrl = mode === 'http' || mode === 'ws';

  async function run() {
    setCheck({ state: 'running' });
    const t0 = performance.now();
    try {
      const notes = await contractCheck(team);
      setCheck({ state: 'ok', detail: notes, ms: Math.round(performance.now() - t0) });
    } catch (err) {
      const detail = err instanceof ContractError ? err.problems : [(err as Error).message];
      setCheck({ state: 'fail', detail, ms: Math.round(performance.now() - t0) });
    }
  }

  const dot = check.state === 'ok' ? 'var(--ok)' : check.state === 'fail' ? 'var(--lapse)' : mode === 'mock' ? 'var(--pencil)' : 'var(--warn)';
  return (
    <section className="border-b border-rule px-4 py-4">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 flex-none rounded-full" style={{ background: dot }} aria-hidden />
        <h3 className="text-[14px] font-semibold" style={{ fontFamily: 'var(--font-body)', fontVariationSettings: 'normal', letterSpacing: 0 }}>
          {info.title} <span className="font-normal text-pencil">{info.zh}</span>
        </h3>
        <span className="flex-1" />
        <label className="sr-only" htmlFor={`mode-${team}`}>
          Mode for {info.title}
        </label>
        <select id={`mode-${team}`} className="field h-8 min-h-0 w-auto max-w-[170px] py-0 font-mono text-[12px]" value={mode} onChange={(e) => registry.set(team, { mode: e.target.value })}>
          {info.modes.map((m) => (
            <option key={m} value={m}>
              {m === 'mock' ? (team === 'attention' ? 'simulator' : 'mock') : attentionPluginLabel(m) ?? m}
            </option>
          ))}
        </select>
      </div>
      <p className="mt-1 pl-4 text-pencil">{info.owns}</p>
      {needsUrl && (
        <form
          className="mt-2 flex gap-2 pl-4"
          onSubmit={(e) => {
            e.preventDefault();
            registry.set(team, { url: draft });
          }}
        >
          <label className="sr-only" htmlFor={`url-${team}`}>
            {info.title} URL
          </label>
          <input id={`url-${team}`} className="field h-8 min-h-0 flex-1 font-mono text-[12px]" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
          <button type="submit" className="btn btn-quiet btn-sm font-mono text-[12px]" disabled={draft === url}>
            Save
          </button>
        </form>
      )}
      <div className="mt-2 flex items-center gap-3 pl-4">
        <button type="button" className="btn btn-quiet btn-sm font-mono text-[12px]" onClick={() => void run()} disabled={check.state === 'running'}>
          {check.state === 'running' ? 'Checking…' : 'Run contract check'}
        </button>
        {check.state === 'ok' && <span className="text-ok">Passed · {check.ms} ms</span>}
        {check.state === 'fail' && <span className="text-lapse">Failed · {check.ms} ms</span>}
      </div>
      {check.detail && check.detail.length > 0 && (
        <ul className={`mt-2 ml-4 grid gap-1 rounded-lg p-3 font-mono text-[11.5px] leading-snug ${check.state === 'fail' ? 'bg-lapse-soft text-ink' : 'bg-paper text-graphite'}`}>
          {check.detail.map((d, i) => (
            <li key={i} className="break-words">
              {d}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const SAMPLE_VARIANT: Variant = { ...DEFAULT_VARIANT };
const SAMPLE_CONTEXT: RescueContext = {
  userId: 'contract-check',
  deckId: DEMO_DECK.id,
  slideIndex: 2,
  minutesIntoSession: 14,
  lapseDepth: 0.4,
  slideDifficulty: 0.45,
  trigger: 'gaze',
  rescueInRow: 1,
  rescuesSoFar: 0,
  recentVariantIds: [],
  hourOfDay: 21,
};

/** Calls each provider with a known input and validates the output. */
async function contractCheck(team: ServiceTeam): Promise<string[]> {
  if (team === 'attention') {
    const p = registry.attention;
    const got: FocusSample[] = [];
    const off = p.onSample((s) => got.push(s));
    try {
      await p.start(null);
      await new Promise((r) => setTimeout(r, 1500));
    } finally {
      off();
      await p.stop().catch(() => {});
    }
    if (got.length < 5) throw new ContractError('Gaze tracking', [`Only ${got.length} samples in 1.5 s; expected about 15 (10 Hz).`]);
    const scores = got.map((s) => s.score);
    return [`${got.length} samples in 1.5 s`, `score range ${Math.min(...scores).toFixed(0)}–${Math.max(...scores).toFixed(0)}`, `signals: ${Object.keys(got[0].signals ?? {}).join(', ') || 'none'}`];
  }
  if (team === 'content') {
    const s = await registry.content.getScript({ deck: DEMO_DECK, slide: DEMO_DECK.slides[2], variant: SAMPLE_VARIANT, depth: 1 });
    const problems = checkScript(s);
    if (problems.length) throw new ContractError('AI analysis', problems);
    return [`hook: “${s.hook.slice(0, 60)}”`, `${s.script.split(/\s+/).length} words, ${s.quiz.length} question(s), ${s.keyTerms.length} key term(s)`];
  }
  if (team === 'media') {
    const script = await new (await import('../providers/mock/content')).MockContentProvider().getScript({ deck: DEMO_DECK, slide: DEMO_DECK.slides[2], variant: SAMPLE_VARIANT, depth: 1 });
    const m = await registry.media.renderMedia({ deckId: DEMO_DECK.id, slideIndex: 2, script, variant: SAMPLE_VARIANT });
    const problems = checkMedia(m, `${script.hook} ${script.script}`);
    if (problems.length) throw new ContractError('Video', problems);
    const loops = await registry.media.listGameplayLoops();
    return [`${m.captions.length} caption words over ${m.durationSec.toFixed(1)} s`, m.audioUrl ? `audio: ${m.audioUrl}` : 'no audioUrl (browser voice fallback)', `${m.broll.length} b-roll clip(s), ${loops.length} gameplay loop(s)`];
  }
  const c = await registry.adaptive.chooseVariant(SAMPLE_CONTEXT);
  return [`picked ${c.variant.id}${c.isHoldout ? ' (holdout)' : ''}${c.isExplore ? ' (exploring)' : ''}`, `${c.variant.targetSeconds}s · ${c.variant.slangLevel} · ${c.variant.gameplayType}`];
}

function Simulator() {
  const [, force] = useState(0);
  useEffect(() => simulator.subscribe(() => force((x) => x + 1)), []);
  return (
    <section className="border-b border-rule px-4 py-4">
      <h3 className="label">Focus simulator</h3>
      <p className="mt-1 text-pencil">Stands in for the gaze model. In a session, D toggles looking away.</p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {SIM_PROFILES.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => simulator.set(p.id)}
            aria-pressed={simulator.profile === p.id && simulator.manual === null}
            className="rounded-lg border px-3 py-2 text-left transition-colors"
            style={{
              borderColor: simulator.profile === p.id && simulator.manual === null ? 'var(--ink)' : 'var(--rule)',
              background: simulator.profile === p.id && simulator.manual === null ? 'var(--paper)' : 'transparent',
            }}
          >
            <div className="font-semibold">{p.label}</div>
            <div className="text-[11px] text-pencil">{p.hint}</div>
          </button>
        ))}
      </div>
      <label htmlFor="sim-manual" className="mt-3 flex items-center gap-3">
        <span className="w-24 flex-none">Fixed score</span>
        <input id="sim-manual" type="range" min={0} max={100} value={simulator.manual ?? 80} onChange={(e) => simulator.setManual(Number(e.target.value))} />
        <span className="num w-8 text-right">{simulator.manual ?? '–'}</span>
      </label>
    </section>
  );
}

function LiveState() {
  const live = useApp((s) => s.live);
  const rescue = useApp((s) => s.rescue);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const cooldown = Math.max(0, Math.round((live.cooldownUntil - now) / 1000));
  const rows: [string, string][] = [
    ['state', live.state],
    ['camera score', live.score.toFixed(0)],
    ['effective score', live.effective.toFixed(0)],
    ['window active', String(live.windowActive)],
    ['cooldown', cooldown ? `${cooldown}s` : '–'],
    ['rescue', rescue ? `${rescue.phase} · depth ${rescue.depth} · ${rescue.choice?.variant.id ?? '…'}` : '–'],
  ];
  return (
    <section className="border-b border-rule px-4 py-4">
      <div className="flex items-center justify-between">
        <h3 className="label">Live session</h3>
        <button
          type="button"
          className="link font-mono text-[12px]"
          onClick={() => {
            useApp.setState({ report: buildSampleReport(), devOpen: false });
            actions.go('report');
          }}
        >
          Open example report
        </button>
      </div>
      <dl className="mt-2 grid grid-cols-[120px_1fr] gap-y-1 font-mono text-[12px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-pencil">{k}</dt>
            <dd className="m-0 truncate">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Shortcuts() {
  return (
    <section className="border-b border-rule px-4 py-4">
      <h3 className="label">Keys in a session</h3>
      <dl className="mt-2 grid grid-cols-[90px_1fr] gap-y-1 text-[12px]">
        {[
          ['← →', 'previous / next slide'],
          ['P', 'pause camera'],
          ['Esc', 'leave a clip'],
          ['1–4', 'answer'],
          ['D', 'simulate looking away'],
        ].map(([k, v]) => (
          <div key={k} className="contents">
            <dt>
              <kbd>{k}</kbd>
            </dt>
            <dd className="m-0 text-graphite">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const TEAM_COLOR: Record<string, string> = { attention: 'var(--pen)', content: 'var(--ok)', media: 'var(--warn)', adaptive: '#9b5de5', ui: 'var(--pencil)' };

function Log() {
  const entries = useSyncExternalStore(devlog.subscribe, devlog.get);
  const [filter, setFilter] = useState<string>('all');
  const shown = entries.filter((e) => filter === 'all' || e.team === filter).slice(-80).reverse();
  return (
    <section className="px-4 py-4">
      <div className="flex items-center gap-2">
        <h3 className="label flex-1">Calls</h3>
        <label className="sr-only" htmlFor="log-filter">
          Filter calls
        </label>
        <select id="log-filter" className="field h-7 min-h-0 w-auto py-0 font-mono text-[11px]" value={filter} onChange={(e) => setFilter(e.target.value)}>
          {['all', 'attention', 'content', 'media', 'adaptive', 'ui'].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <button type="button" className="link font-mono text-[11px]" onClick={() => devlog.clear()}>
          clear
        </button>
      </div>
      <ol className="mt-2 grid gap-1 font-mono text-[11.5px]">
        {shown.length === 0 && <li className="text-pencil">Nothing yet. Start a session or run a check.</li>}
        {shown.map((e) => (
          <LogRow key={e.id} e={e} />
        ))}
      </ol>
    </section>
  );
}

function LogRow({ e }: { e: DevLogEntry }) {
  const [open, setOpen] = useState(false);
  const time = new Date(e.at).toLocaleTimeString(undefined, { hour12: false });
  return (
    <li>
      <button type="button" className="flex w-full items-baseline gap-2 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="text-pencil">{time}</span>
        <span className="w-[62px] flex-none truncate" style={{ color: TEAM_COLOR[e.team] }}>
          {e.team}
        </span>
        <span className={`min-w-0 flex-1 truncate ${e.level === 'error' ? 'text-lapse' : ''}`}>{e.label}</span>
        {e.ms !== undefined && <span className="text-pencil">{e.ms}ms</span>}
      </button>
      {open && e.detail !== undefined && (
        <pre className="mt-1 mb-2 max-h-48 overflow-auto rounded bg-paper p-2 text-[11px] break-words whitespace-pre-wrap text-graphite">{typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail, null, 2)}</pre>
      )}
    </li>
  );
}

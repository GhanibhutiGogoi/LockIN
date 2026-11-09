/**
 * Session runtime: wires the attention provider, window focus, the pure state
 * machine, rescue orchestration and logging together. UI components call the
 * exported functions; they never touch providers directly.
 */
import type { FocusLogEntry, FocusSample, LapseTrigger, RescueContext, RescueOutcome, SessionConfig, SessionLog, Variant, VariantChoice } from '../contracts/types';
import { getStream, releaseCamera, requestCamera } from '../lib/camera';
import { devlog } from '../lib/devlog';
import { uid } from '../lib/storage';
import { registry } from '../providers/registry';
import { actions, currentDeck, emptyLive, useApp, type ReviewQuestion } from '../store';
import { DEFAULT_CONFIG, createMachine, dispatch, step, type Machine, type MachineAction, type MachineEvent } from './machine';
import { focusShare, scoreSession } from './metrics';
import { DEFAULT_VARIANT, getPack, prefetch, setWarmVariant } from './packs';

const TICK_MS = 100;
const SMOOTH_WINDOW_MS = 1000;
const REWARD_WINDOW_SEC = 60;

interface Runtime {
  sessionId: string;
  machine: Machine;
  cfg: SessionConfig;
  samples: { t: number; score: number; eyesOpen: number }[];
  log: FocusLogEntry[];
  outcomes: RescueOutcome[];
  pending: { outcome: RescueOutcome; returnedAtSec: number; lapseAt: number }[];
  recentVariants: string[];
  questions: ReviewQuestion[];
  profileMemo?: string;
  unsub: (() => void)[];
  timer: number | null;
  lastLogSec: number;
  titleBefore: string;
}

let rt: Runtime | null = null;

const sessionSec = (now = Date.now()) => (rt ? (now - rt.machine.sessionStart) / 1000 : 0);

// ───────────────────────── lifecycle ─────────────────────────

export async function startSession() {
  if (rt) await teardown();
  const s = useApp.getState();
  const now = Date.now();
  let cfg: SessionConfig = { ...DEFAULT_CONFIG };
  try {
    cfg = { ...cfg, ...(await registry.adaptive.getSessionConfig(s.userId, s.settings)) };
    // the user's own choice always wins over the model
    cfg.nudgeOnly = !!s.settings.nudgeOnly;
  } catch {
    actions.toast('Personal AI service is unreachable, using default timing.', 'error');
  }
  let profileMemo: string | undefined;
  try {
    profileMemo = await registry.adaptive.getProfileMemo(s.userId);
  } catch {
    /* optional */
  }

  rt = {
    sessionId: uid('s_'),
    machine: dispatch(createMachine(now), { type: 'start' }, now, cfg).m,
    cfg,
    samples: [],
    log: [],
    outcomes: [],
    pending: [],
    recentVariants: [],
    questions: [],
    profileMemo,
    unsub: [],
    timer: null,
    lastLogSec: -1,
    titleBefore: document.title,
  };
  useApp.setState({ live: { ...emptyLive(), state: 'focused', startedAt: now, score: 80, effective: 80 }, rescue: null, breakCard: null });

  await startAttention();
  rt.timer = window.setInterval(tick, TICK_MS);
  prefetch(currentDeck(), useApp.getState().slideIndex, profileMemo);
}

async function startAttention() {
  if (!rt) return;
  const provider = registry.attention;
  rt.unsub.push(provider.onSample(onSample));
  if (provider.onStatus) {
    rt.unsub.push(
      provider.onStatus((status, detail) => {
        devlog.push({ team: 'attention', level: status === 'error' ? 'error' : 'info', label: `status: ${status}`, detail });
      }),
    );
  }
  try {
    await provider.start(provider.needsCamera ? getStream() : null);
    devlog.push({ team: 'attention', level: 'ok', label: `started ${provider.name}` });
  } catch (err) {
    devlog.push({ team: 'attention', level: 'error', label: 'start failed', detail: (err as Error).message });
    actions.toast(`Focus tracking didn't start: ${(err as Error).message}. LockIn will only notice app switches.`, 'error');
  }
}

async function stopAttention() {
  if (!rt) return;
  rt.unsub.forEach((f) => f());
  rt.unsub = [];
  try {
    await registry.attention.stop();
  } catch {
    /* ignore */
  }
}

async function teardown() {
  if (!rt) return;
  if (rt.timer !== null) clearInterval(rt.timer);
  await stopAttention();
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  document.title = rt.titleBefore;
}

export async function endSession() {
  if (!rt) return;
  const r = rt;
  await teardown();
  const now = Date.now();
  // Flush outcomes whose 60 s window hasn't closed: use what we have.
  for (const p of r.pending) finalizeOutcome(p, true);
  r.pending = [];

  const deck = currentDeck();
  const log: SessionLog = {
    sessionId: r.sessionId,
    userId: useApp.getState().userId,
    deckId: deck.id,
    startedAt: r.machine.sessionStart,
    endedAt: now,
    samples: r.log,
    rescues: r.outcomes,
  };
  let review;
  try {
    review = await registry.adaptive.endSession(log);
  } catch {
    review = { score: scoreSession(log.samples, log.rescues) };
    actions.toast('Personal AI service is unreachable. The report uses local numbers only.', 'error');
  }
  rt = null;
  if (log.samples.length >= 30) actions.recordSession(deck, review.score.sustainedEpisodeMedianSec);
  useApp.setState({ report: { deck, log, review, questions: r.questions }, live: emptyLive(), rescue: null, breakCard: null });
  actions.go('report');
}

export const isRunning = () => rt !== null;

// ───────────────────────── input ─────────────────────────

function onSample(s: FocusSample) {
  if (!rt || s.confidence < 0.3) return;
  rt.samples.push({ t: Date.now(), score: s.score, eyesOpen: s.signals?.eyesOpen ?? 1 });
  const cutoff = Date.now() - 3000;
  while (rt.samples.length && rt.samples[0].t < cutoff) rt.samples.shift();
}

function smoothed(now: number): { score: number | null; eyesClosed: boolean } {
  if (!rt) return { score: null, eyesClosed: false };
  const win = rt.samples.filter((x) => x.t >= now - SMOOTH_WINDOW_MS);
  // No confident frames: hold the current state (only app switches count).
  if (!win.length) return { score: null, eyesClosed: false };
  const score = win.reduce((a, b) => a + b.score, 0) / win.length;
  const recent = win.filter((x) => x.t >= now - 400);
  const eyesClosed = recent.length > 0 && recent.every((x) => x.eyesOpen < 0.25);
  return { score, eyesClosed };
}

const windowActive = () => document.visibilityState === 'visible' && document.hasFocus();

// ───────────────────────── tick ─────────────────────────

function tick() {
  if (!rt) return;
  const now = Date.now();
  const s = useApp.getState();
  const noteTaking = s.live.noteTakingUntil !== null && now < s.live.noteTakingUntil;
  if (s.live.noteTakingUntil !== null && !noteTaking) useApp.setState({ live: { ...s.live, noteTakingUntil: null } });

  const { score, eyesClosed } = smoothed(now);
  const active = windowActive();
  const res = step(rt.machine, { now, score, windowActive: active, eyesClosed, noteTaking }, rt.cfg);
  rt.machine = res.m;
  res.events.forEach(handle);

  const m = rt.machine;
  const recoverProgress = m.state === 'recovering' && m.aboveSince !== null ? Math.min(1, (now - m.aboveSince) / 1000 / rt.cfg.recoverFocusedSec) : 0;

  // 1 Hz log — raw video never appears here, only derived numbers.
  const sec = Math.floor(sessionSec(now));
  if (sec !== rt.lastLogSec) {
    rt.lastLogSec = sec;
    rt.log.push({ t: sec, score: Math.round(m.effective), state: m.state, slideIndex: s.slideIndex });
    checkPending(sec);
  }

  const live = useApp.getState().live;
  useApp.setState({
    live: {
      ...live,
      state: m.state,
      score: score ?? live.score,
      effective: m.effective,
      windowActive: active,
      recoverProgress,
      cooldownUntil: m.cooldownUntil,
      elapsed: (now - m.sessionStart - m.pausedMs - (m.pausedAt ? now - m.pausedAt : 0)) / 1000,
    },
  });

  // Browser fallback for snap-back: the tab title calls you back.
  const away = !active && (m.state === 'lapse' || m.state === 'rescue');
  const want = away ? 'Come back to your slides · LockIn' : rt.titleBefore;
  if (document.title !== want) document.title = want;
}

function handle(e: MachineEvent) {
  if (!rt) return;
  switch (e.type) {
    case 'state':
      devlog.push({ team: 'ui', level: 'info', label: `${e.from} → ${e.to}` });
      break;
    case 'lapse':
      void startRescue(e.trigger, e.depth as 1 | 2, e.rescueInRow);
      break;
    case 'refocused': {
      const now = Date.now();
      for (const p of rt.pending) if (p.outcome.timeToRefocusSec === null) p.outcome.timeToRefocusSec = Math.round((now - p.lapseAt) / 100) / 10;
      break;
    }
    case 'suggestBreak':
      useApp.setState({ breakCard: { reason: e.reason, until: null }, rescue: null });
      break;
    case 'suppressed':
      break;
    case 'nudge':
      break;
  }
}

function act(a: MachineAction) {
  if (!rt) return;
  const r = dispatch(rt.machine, a, Date.now(), rt.cfg);
  rt.machine = r.m;
  r.events.forEach(handle);
  useApp.setState({ live: { ...useApp.getState().live, state: rt.machine.state } });
}

// ───────────────────────── rescue ─────────────────────────

function fallbackVariant(): Variant {
  const st = useApp.getState().settings;
  return { ...DEFAULT_VARIANT, slangLevel: st.slangLevel, id: `fallback·${st.slangLevel}` };
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback()), ms))]).catch(() => fallback());
}

async function startRescue(trigger: LapseTrigger, depth: 1 | 2, rescueInRow: number) {
  if (!rt) return;
  const s = useApp.getState();
  const deck = currentDeck();
  const slide = deck.slides[s.slideIndex];
  const now = Date.now();
  const context: RescueContext = {
    userId: s.userId,
    deckId: deck.id,
    slideIndex: s.slideIndex,
    minutesIntoSession: Math.round((s.live.elapsed / 60) * 10) / 10,
    lapseDepth: Math.max(0, Math.min(1, (rt.cfg.enterDrifting - rt.machine.effective) / rt.cfg.enterDrifting)),
    slideDifficulty: slide?.difficulty ?? 0.5,
    trigger,
    rescueInRow,
    rescuesSoFar: rt.outcomes.length,
    recentVariantIds: rt.recentVariants.slice(-5),
    hourOfDay: new Date().getHours(),
  };
  const id = uid('r_');
  useApp.setState({
    rescue: { id, phase: 'loading', trigger, depth, context, lapseAt: now, skipped: false, answers: [] },
    live: { ...s.live, lapsesBySlide: depth === 1 ? { ...s.live.lapsesBySlide, [s.slideIndex]: (s.live.lapsesBySlide[s.slideIndex] ?? 0) + 1 } : s.live.lapsesBySlide },
  });

  const choice: VariantChoice = await withTimeout<VariantChoice>(registry.adaptive.chooseVariant(context), 1500, () => ({ variant: fallbackVariant(), isHoldout: false }));
  let variant = choice.variant;
  if (!s.settings.roastsEnabled && variant.humourStyle === 'roasts') variant = { ...variant, humourStyle: 'memes' };
  rt?.recentVariants.push(variant.id);
  setWarmVariant(variant);

  if (choice.action === 'skip') {
    // Control arm: a plain reminder instead of a clip.
    act({ type: 'rescueStarted' });
    useApp.setState({ rescue: null });
    actions.toast('Eyes back on the slide.');
    const outcome = makeOutcome(id, context, variant.id, choice.isHoldout, now, now, 0, false, []);
    act({ type: 'rescueFinished', clipMs: 0 });
    rt?.pending.push({ outcome, returnedAtSec: sessionSec(), lapseAt: now });
    return;
  }

  try {
    const pack = await getPack(deck, s.slideIndex, variant, depth, rt?.profileMemo);
    if (useApp.getState().rescue?.id !== id) return; // user already left
    act({ type: 'rescueStarted' });
    useApp.setState({ rescue: { ...useApp.getState().rescue!, phase: 'playing', pack, choice: { ...choice, variant }, startedAt: Date.now() } });
  } catch (err) {
    if (useApp.getState().rescue?.id !== id) return;
    act({ type: 'rescueStarted' });
    useApp.setState({ rescue: { ...useApp.getState().rescue!, phase: 'error', choice: { ...choice, variant }, error: (err as Error).message, startedAt: Date.now() } });
  }
}

/** Narration finished. */
export function clipEnded() {
  const r = useApp.getState().rescue;
  if (!r || r.phase !== 'playing') return;
  const hasQuiz = (r.pack?.script.quiz.length ?? 0) > 0 && (r.choice?.variant.quizCount ?? 1) > 0;
  useApp.setState({ rescue: { ...r, clipEndedAt: Date.now(), phase: hasQuiz ? 'quiz' : r.phase } });
  if (!hasQuiz) finishRescue();
}

/** "I'm back" / Esc: leave the clip now, skip is logged. */
export function skipClip() {
  const r = useApp.getState().rescue;
  if (!r) return;
  if (r.phase === 'loading') {
    // nothing played yet — treat as an immediate return
    act({ type: 'rescueStarted' });
  }
  useApp.setState({ rescue: { ...r, skipped: r.phase === 'playing' || r.phase === 'loading', clipEndedAt: r.clipEndedAt ?? Date.now() } });
  finishRescue();
}

export function answerQuiz(questionIndex: number, chosen: number) {
  const r = useApp.getState().rescue;
  const q = r?.pack?.script.quiz[questionIndex];
  if (!r || !q || r.answers.some((a) => a.questionIndex === questionIndex)) return;
  useApp.setState({ rescue: { ...r, answers: [...r.answers, { questionIndex, chosen, correct: chosen === q.answerIndex }] } });
}

export function finishRescue() {
  const r = useApp.getState().rescue;
  if (!r || !rt) return;
  const now = Date.now();
  const started = r.startedAt ?? now;
  const clipMs = Math.max(0, (r.clipEndedAt ?? now) - started);
  const outcome = makeOutcome(r.id, r.context, r.choice?.variant.id ?? 'none', r.choice?.isHoldout ?? false, started, r.clipEndedAt ?? now, clipMs / 1000, r.skipped, r.answers);
  rt.pending.push({ outcome, returnedAtSec: sessionSec(now), lapseAt: r.lapseAt });
  r.pack?.script.quiz.slice(0, Math.max(1, r.pack.variant.quizCount)).forEach((q, i) => {
    rt!.questions.push({
      slideIndex: r.context.slideIndex,
      question: q.question,
      options: q.options,
      answerIndex: q.answerIndex,
      chosen: r.answers.find((a) => a.questionIndex === i)?.chosen ?? null,
    });
  });
  useApp.setState({ rescue: null });
  act({ type: 'rescueFinished', clipMs });
}

function makeOutcome(
  rescueId: string,
  context: RescueContext,
  variantId: string,
  isHoldout: boolean,
  startedAt: number,
  endedAt: number,
  clipSeconds: number,
  skipped: boolean,
  quiz: RescueOutcome['quiz'],
): RescueOutcome {
  return {
    rescueId,
    sessionId: rt?.sessionId ?? '',
    userId: useApp.getState().userId,
    context,
    variantId,
    isHoldout,
    startedAt,
    endedAt,
    clipSeconds: Math.round(clipSeconds * 10) / 10,
    skipped,
    quiz,
    timeToRefocusSec: null,
    attentionAfter: null,
  };
}

function checkPending(nowSec: number) {
  if (!rt) return;
  const due = rt.pending.filter((p) => nowSec - p.returnedAtSec >= REWARD_WINDOW_SEC);
  rt.pending = rt.pending.filter((p) => nowSec - p.returnedAtSec < REWARD_WINDOW_SEC);
  due.forEach((p) => finalizeOutcome(p, false));
}

function finalizeOutcome(p: Runtime['pending'][number], partial: boolean) {
  if (!rt) return;
  p.outcome.attentionAfter = focusShare(rt.log, p.returnedAtSec, p.returnedAtSec + REWARD_WINDOW_SEC);
  rt.outcomes.push(p.outcome);
  if (partial && p.outcome.attentionAfter === null) return;
  registry.adaptive.reportOutcome(p.outcome).catch(() => {});
}

// ───────────────────────── user controls ─────────────────────────

export async function togglePause() {
  if (!rt) return;
  const s = useApp.getState();
  if (rt.machine.state === 'paused') {
    if (s.camera === 'paused') {
      const status = await requestCamera();
      useApp.setState({ camera: status === 'on' ? 'on' : status });
    }
    await startAttention();
    act({ type: 'resume' });
  } else {
    if (s.rescue) skipClip();
    act({ type: 'pause' });
    await stopAttention();
    if (s.camera === 'on') {
      releaseCamera();
      useApp.setState({ camera: 'paused' });
    }
  }
}

export function toggleNoteTaking() {
  const s = useApp.getState();
  const on = s.live.noteTakingUntil !== null;
  const grace = (rt?.cfg.noteTakingGraceSec ?? 60) * 1000;
  useApp.setState({ live: { ...s.live, noteTakingUntil: on ? null : Date.now() + grace } });
}

export function takeBreak(minutes = 5) {
  useApp.setState({ breakCard: { reason: useApp.getState().breakCard?.reason ?? 'repeated', until: Date.now() + minutes * 60_000 } });
  act({ type: 'breakTaken' }); // resets the rescue streak and starts the cooldown
  act({ type: 'pause' });
}

export function endBreak() {
  if (rt?.machine.state === 'paused') act({ type: 'resume' });
  useApp.setState({ breakCard: null });
}

export function dismissBreak() {
  act({ type: 'breakDismissed' });
  useApp.setState({ breakCard: null });
}

export function onSlideChange(index: number) {
  if (!rt) return;
  prefetch(currentDeck(), index, rt.profileMemo);
}

/** The flag is a toggle: a second press on the same clip takes the report back. */
export function toggleWrongFact() {
  const r = useApp.getState().rescue;
  if (!r?.pack) return;
  const { deckId, slideIndex, variant } = r.pack;
  if (r.flagged) {
    registry.content.retractWrongFact?.(deckId, slideIndex, variant.id);
    actions.toast('Flag taken back.');
  } else {
    registry.content.reportWrongFact?.(deckId, slideIndex, variant.id);
    actions.toast('Flagged. This clip will be checked against the slide again.');
  }
  useApp.setState({ rescue: { ...r, flagged: !r.flagged } });
}

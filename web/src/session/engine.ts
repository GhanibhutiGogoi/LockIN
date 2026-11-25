/**
 * Session runtime: wires the attention provider, window focus, the pure state
 * machine, rescue orchestration and logging together. UI components call the
 * exported functions; they never touch providers directly.
 *
 * The engine also owns the camera and the attention provider's lifetime: the
 * camera opens only when the provider needs it, goes off whenever tracking
 * stops (pause, break, end of session), and a provider started for
 * calibration keeps running into the session.
 */
import type { AdaptiveProvider, AttentionProvider, MemorySource } from '../contracts/providers';
import type { Deck, FocusLogEntry, FocusSample, GazeTracking, LapseTrigger, MemoryDecision, MemoryTopic, RescueContext, RescueOutcome, RescuePack, SessionConfig, SessionLog, Variant, VariantChoice } from '../contracts/types';
import { notifyComeBack, playCue, primeCue, whenVisible, whenStudyActive } from '../lib/callback';
import { getStream, releaseCamera, requestCamera, type CameraStatus } from '../lib/camera';
import { plainText } from '../lib/demoDeck';
import { devlog } from '../lib/devlog';
import { beginScreenAnalysis, finishScreenAnalysis, getLiveScreenScene, getScreenDiagnostics, getScreenTimeline, getStudyScreenContext, hasStudyRecapContext, setScreenReading } from '../lib/screenShare';
import { historicalFocus } from '../screenStudy/timeline';
import { ScreenIntervention, type ScreenRisk } from '../screenStudy/intervention';
import { uid } from '../lib/storage';
import { lookingAwaySeconds } from '../lib/lookingAway';
import { GazeTraceRecorder } from '../gazeTrace/recorder';
import { memoryStyle } from '../providers/memory/adaptive';
import { registry } from '../providers/registry';
import { LocalAdaptiveProvider } from '../providers/local';
import { actions, currentDeck, emptyLive, useApp, type ReviewQuestion, type RescueUI, type RecoveryWait } from '../store';
import { DEFAULT_CONFIG, configForSensitivity, createMachine, dispatch, step, type Machine, type MachineAction, type MachineEvent } from './machine';
import { focusShare, scoreSession } from './metrics';
import { clearPacks, DEFAULT_VARIANT, getPack } from './packs';

const TICK_MS = 100;
const SMOOTH_WINDOW_MS = 1000;
const GAZE_FRESH_MS = 1200;
const REWARD_WINDOW_SEC = 60;

interface Pending {
  outcome: RescueOutcome;
  /** session seconds when the user was back on the slide */
  returnedAtSec: number;
  /** ms timestamp of the same moment; time to refocus counts from here */
  returnedAt: number;
}

interface Runtime {
  screenGate: ScreenIntervention;
  preparation?: ScreenPreparation;
  screenWait?: AbortController;
  activity: NonNullable<SessionLog['activity']>;
  visitedSlides: Set<number>;
  sessionId: string;
  machine: Machine;
  cfg: SessionConfig;
  samples: { t: number; score: number; eyesOpen: number }[];
  offscreenLapseAt: number | null;
  gazeTracking?: { t: number; value: GazeTracking };
  log: FocusLogEntry[];
  gazeDiagnostics: NonNullable<SessionLog['gazeDiagnostics']>;
  gazeTrace?: GazeTraceRecorder;
  latestDiagnostic?: { t: number; value: NonNullable<FocusSample['gazeDiagnostic']> };
  outcomes: RescueOutcome[];
  pending: Pending[];
  recentVariants: string[];
  questions: ReviewQuestion[];
  profileMemo?: string;
  adaptive: AdaptiveProvider;
  memorySource?: MemorySource;
  memorySamples: { t: number; focused: boolean }[];
  memoryWrites: Promise<void>[];
  unsub: (() => void)[];
  timer: number | null;
  lastLogSec: number;
  titleBefore: string;
}

interface ScreenPreparation {
  trigger: ScreenRisk;
  deck: Deck;
  slideIndex: number;
  context: RescueContext;
  choice?: VariantChoice;
  pack?: RescuePack;
  error?: string;
  memoryDecision?: MemoryDecision;
  memoryTopic?: MemoryTopic;
}

let rt: Runtime | null = null;
/** In-flight enterStudy(), so a double mount can't start two sessions. */
let entering: Promise<void> | null = null;
/** endSession() is running (its POST can take up to 60 s). */
let ending = false;

const sessionSec = (now = Date.now()) => (rt ? (now - rt.machine.sessionStart) / 1000 : 0);

// ───────────────────────── camera + provider ownership ─────────────────────────

let liveProvider: AttentionProvider | null = null;
let providerPaused = false;
let startingProvider: AttentionProvider | null = null;
let providerStarting: Promise<void> | null = null;
let cameraRequest: Promise<CameraStatus> | null = null;

/** Open the camera if, and only if, the active attention provider needs it. */
export async function ensureCamera(): Promise<CameraStatus> {
  const s = useApp.getState();
  if (!registry.attention.needsCamera) {
    if (s.camera === 'paused') useApp.setState({ camera: 'off' });
    return useApp.getState().camera;
  }
  if (s.camera === 'on' && getStream()) return 'on';
  if (cameraRequest) return cameraRequest;
  useApp.setState({ camera: 'asking' });
  const pending = requestCamera().then((status) => {
    if (cameraRequest !== pending) return 'off' as const;
    useApp.setState({ camera: status });
    return status;
  }).finally(() => { if (cameraRequest === pending) cameraRequest = null; });
  cameraRequest = pending;
  return pending;
}

/** Camera fully off (the hardware light goes out). */
function cameraOff(next: 'off' | 'paused') {
  cameraRequest = null;
  releaseCamera();
  const c = useApp.getState().camera;
  if (c === 'on' || c === 'asking' || (next === 'off' && c === 'paused')) useApp.setState({ camera: next });
}

/** Start the active attention provider unless it is already running. Single-flight. */
export function ensureAttention(): Promise<void> {
  const p = registry.attention;
  if (liveProvider === p && !providerPaused) return Promise.resolve();
  if (providerStarting) return providerStarting;
  const previous = liveProvider === p ? null : liveProvider;
  liveProvider = null;
  providerPaused = false;
  startingProvider = p;
  const operation = (async () => {
    if (previous) await previous.stop().catch(() => {});
    if (startingProvider !== p) throw new Error('Attention tracking stopped.');
    await p.start(p.needsCamera ? getStream() : null);
    if (startingProvider !== p) throw new Error('Attention tracking stopped.');
    liveProvider = p;
  })();
  providerStarting = operation.finally(() => {
    startingProvider = null;
    providerStarting = null;
  });
  return providerStarting;
}

export async function stopProvider() {
  const starting = startingProvider;
  startingProvider = null;
  const p = liveProvider;
  liveProvider = null;
  providerPaused = false;
  if (starting) await starting.stop().catch(() => {});
  if (providerStarting) await providerStarting.catch(() => {});
  if (p && p !== starting) await p.stop().catch(() => {});
}

/** Close the camera even if its permission request was still settling. */
export async function stopCalibrationCamera() {
  cameraOff('off');
  await stopProvider();
}

// ───────────────────────── lifecycle ─────────────────────────

/**
 * Study screen mounted: start a session, or pick the running one back up
 * (e.g. after recalibrating mid-session). Safe to call twice.
 */
export function enterStudy(): Promise<void> {
  if (entering) return entering;
  entering = (async () => {
    try {
      if (rt) {
        if (rt.machine.state === 'paused' && !useApp.getState().breakCard) await resume();
        return;
      }
      primeCue();
      const status = await ensureCamera();
      if (registry.attention.needsCamera && status !== 'on') actions.toast(currentDeck().sourceType === 'screen'
        ? 'Camera unavailable. You can still see the text LockIn reads.'
        : 'No camera, so LockIn will only notice when you switch apps.');
      await startSession();
    } finally {
      entering = null;
    }
  })();
  return entering;
}

async function startSession() {
  if (rt) await teardown();
  const s = useApp.getState();
  const now = Date.now();
  const screenStudy = currentDeck().sourceType === 'screen';
  const adaptive: AdaptiveProvider = screenStudy && registry.config?.adaptive.mode === 'http'
    ? new LocalAdaptiveProvider(() => !!registry.config?.media.voiceUrl)
    : registry.adaptive;
  const memorySource = adaptive.retrieveMemory
    ? registry.isMock('attention') ? 'replay' : registry.attention.usesOffscreenRule ? 'live' : undefined
    : undefined;
  let cfg: SessionConfig;
  try {
    cfg = { ...DEFAULT_CONFIG, ...(await adaptive.getSessionConfig(s.userId, s.settings)) };
  } catch {
    // no model: the user's own sensitivity and cooldown still apply
    cfg = { ...configForSensitivity(s.settings.sensitivity), cooldownSec: s.settings.cooldownSec ?? DEFAULT_CONFIG.cooldownSec };
    actions.toast('Personal AI service is unreachable, using your own settings.', 'error');
  }
  // the user's own choice always wins over the model
  cfg.nudgeOnly = !!s.settings.nudgeOnly || !registry.canRecap();
  cfg.driftToLapseSec = lookingAwaySeconds(s.settings.lookingAwaySec);
  registry.attention.setLookingAwayDuration?.(cfg.driftToLapseSec);

  let profileMemo: string | undefined;
  try {
    profileMemo = await adaptive.getProfileMemo(s.userId);
  } catch {
    /* optional */
  }

  rt = {
    screenGate: new ScreenIntervention(),
    sessionId: uid('s_'),
    machine: dispatch(createMachine(now), { type: 'start' }, now, cfg).m,
    cfg,
    samples: [],
    offscreenLapseAt: null,
    log: [],
    gazeDiagnostics: { samples: [], droppedSamples: 0 },
    gazeTrace: screenStudy ? new GazeTraceRecorder(now) : undefined,
    activity: [],
    visitedSlides: new Set(screenStudy ? [] : [s.slideIndex]),
    outcomes: [],
    pending: [],
    recentVariants: [],
    questions: [],
    profileMemo,
    adaptive,
    memorySource,
    memorySamples: [],
    memoryWrites: [],
    unsub: [],
    timer: null,
    lastLogSec: -1,
    titleBefore: document.title,
  };
  useApp.setState({ live: { ...emptyLive(), state: 'focused', startedAt: now, score: 80, effective: 80 }, rescue: null, breakCard: null });

  if (screenStudy) { beginScreenAnalysis(now); setScreenReading(true); }
  await startAttention();
  if (!rt) return;
  rt.timer = window.setInterval(tick, TICK_MS);
}

async function startAttention() {
  if (!rt) return;
  unsubscribe(); // never subscribe twice
  const provider = registry.attention;
  rt.unsub.push(provider.onSample(onSample));
  if (provider.onStatus) {
    rt.unsub.push(
      provider.onStatus((status, detail) => {
        devlog.push({ team: 'attention', level: status === 'error' ? 'error' : 'info', label: `status: ${status}`, detail });
        if (provider.usesOffscreenRule && status === 'error' && detail) {
          actions.setCalibrated(false);
          if (liveProvider === provider) actions.toast(detail, 'error');
        }
      }),
    );
  }
  try {
    await ensureAttention();
    devlog.push({ team: 'attention', level: 'ok', label: `started ${provider.name}` });
  } catch (err) {
    devlog.push({ team: 'attention', level: 'error', label: 'start failed', detail: (err as Error).message });
    actions.toast(currentDeck().sourceType === 'screen'
      ? 'Gaze tracking is unavailable. Screen text recognition can still run.'
      : `Focus tracking didn't start: ${(err as Error).message}. LockIn will only notice app switches.`, 'error');
  }
}

function unsubscribe() {
  if (!rt) return;
  rt.unsub.forEach((f) => f());
  rt.unsub = [];
}

async function stopAttention(retainCalibration = false) {
  if (rt) {
    rt.gazeTrace?.break();
    rt.samples = [];
    rt.offscreenLapseAt = null;
    rt.gazeTracking = undefined;
  }
  unsubscribe();
  if (retainCalibration && liveProvider === registry.attention && liveProvider.suspend?.()) {
    providerPaused = true;
    return;
  }
  await stopProvider();
}

registry.subscribe?.(() => {
  const provider = startingProvider ?? liveProvider;
  if (!provider?.usesOffscreenRule || provider === registry.attention) return;
  cameraOff('off');
  void stopAttention();
});

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    cameraOff('off');
    void stopAttention();
  });
}

async function teardown() {
  if (!rt) return;
  cancelScreenPreparation();
  clearPacks();
  rt.screenWait?.abort();
  if (rt.timer !== null) clearInterval(rt.timer);
  rt.timer = null;
  cameraOff('off');
  await stopAttention();
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  document.title = rt.titleBefore;
}

export async function endSession() {
  if (!rt || ending) return;
  ending = true;
  const endedAt = Date.now();
  setScreenReading(false);
  const r = rt;
  try {
    if (useApp.getState().rescue) leaveRescue();
    await teardown();
    if (currentDeck().sourceType === 'screen') {
      useApp.setState({ finishingReport: true });
      await finishScreenAnalysis();
      const analysis = getScreenTimeline()?.analyze(endedAt);
      if (analysis) r.log = historicalFocus(analysis, r.machine.sessionStart);
    }
    const now = endedAt;
    // Flush outcomes whose 60 s window hasn't closed: use what we have.
    for (const p of r.pending) finalizeOutcome(p, true);
    r.pending = [];

    const deck = currentDeck();
    const log: SessionLog = {
      attentionSource: registry.isMock('attention') ? 'simulated' : r.log.length ? 'gaze' : 'unavailable',
      activeSeconds: useApp.getState().live.elapsed,
      activity: r.activity,
      visitedSlides: [...r.visitedSlides],
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
      await Promise.all(r.memoryWrites);
      review = await r.adaptive.endSession(log);
    } catch {
      review = { score: scoreSession(log.samples, log.rescues) };
      actions.toast(r.adaptive.retrieveMemory
        ? 'The memory bank could not confirm this write. The report uses local scores.'
        : 'Personal AI service is unreachable. The report uses local numbers only.', 'error');
    }
    if (deck.sourceType !== 'screen' && log.samples.length >= 30 && log.attentionSource === 'gaze') actions.recordSession(deck, review.score.sustainedEpisodeMedianSec);
    // Runtime diagnostics stay in the local report, outside the adaptive-service payload.
    if (r.gazeDiagnostics.samples.length) log.gazeDiagnostics = r.gazeDiagnostics;
    if (r.gazeTrace) log.gazeTrace = r.gazeTrace.trace;
    if (deck.sourceType === 'screen') {
      log.screenDiagnostics = getScreenDiagnostics();
      log.screenAnalysis = getScreenTimeline()?.analyze(endedAt);
      review.score = scoreSession(log.samples, log.rescues);
      const measured = log.screenAnalysis?.summary;
      if (measured) {
        review.score.focusedMinutes = measured.focusedMs / 60_000;
        review.score.onTaskShare = measured.measuredMs ? measured.focusedMs / measured.measuredMs : 0;
        review.score.sustainedEpisodeMedianSec = measured.medianFocusMs / 1000;
        const lapses = log.rescues.filter(rescue => rescue.context.trigger !== 'manual').length;
        review.score.lapsesPer30Min = measured.measuredMs ? lapses * 1_800_000 / measured.measuredMs : 0;
        if (measured.measuredMs > 0) log.attentionSource = 'gaze';
      }
    }
    const report = { deck, log, review, questions: r.questions };
    if (log.attentionSource === 'simulated' || deck.sourceType === 'demo' || deck.sourceType === 'screen') useApp.setState({ report });
    else await actions.saveReport(report);
    useApp.setState({ live: emptyLive(), rescue: null, breakCard: null });
    actions.go('report');
  } finally {
    useApp.setState({ finishingReport: false });
    if (rt === r) rt = null;
    ending = false;
  }
}

export const isRunning = () => rt !== null;
export const isEnding = () => ending;

// ───────────────────────── input ─────────────────────────

function onSample(s: FocusSample) {
  if (!rt) return;
  const now = Date.now();
  if (rt.gazeTrace && !ending) {
    const state = useApp.getState();
    getScreenTimeline()?.record(s, ['paused', 'break', 'idle', 'lapse', 'rescue'].includes(rt.machine.state)
      || (state.live.noteTakingUntil ?? 0) > now, now);
  }
  if (!['paused', 'break', 'idle'].includes(rt.machine.state)) rt.gazeTrace?.record(s.gazeTrace, s.t, now);
  const fresh = Number.isFinite(s.t) && now - s.t >= 0 && now - s.t < GAZE_FRESH_MS;
  if (s.gazeTracking) {
    if (!fresh || (rt.gazeTracking && s.t <= rt.gazeTracking.t)) return;
    if (s.gazeDiagnostic) rt.latestDiagnostic = { t: s.t, value: s.gazeDiagnostic };
    rt.gazeTracking = { t: s.t, value: s.confidence < .3 ? { ...s.gazeTracking, state: 'unknown' } : s.gazeTracking };
    if (s.confidence < 0.3) {
      rt.samples = [];
      rt.offscreenLapseAt = null;
      return;
    }
  }
  if (s.confidence < 0.3) return;
  if (s.offscreenLapse && fresh) rt.offscreenLapseAt = s.t;
  rt.samples.push({ t: now, score: s.score, eyesOpen: s.signals?.eyesOpen ?? 1 });
  const cutoff = now - 3000;
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
  if (!rt || ending) return;
  const now = Date.now();
  const s = useApp.getState();
  const noteTaking = s.live.noteTakingUntil !== null && now < s.live.noteTakingUntil;
  if (s.live.noteTakingUntil !== null && !noteTaking) useApp.setState({ live: { ...s.live, noteTakingUntil: null } });

  const { score, eyesClosed } = smoothed(now);
  const screenStudy = currentDeck().sourceType === 'screen';
  const active = windowActive();
  const provider = liveProvider ?? registry.attention;
  const awaySeconds = lookingAwaySeconds(s.settings.lookingAwaySec);
  rt.cfg.driftToLapseSec = awaySeconds;
  provider.setLookingAwayDuration?.(awaySeconds);
  const offscreenLapse = rt.offscreenLapseAt !== null && now - rt.offscreenLapseAt >= 0 && now - rt.offscreenLapseAt < GAZE_FRESH_MS;
  rt.offscreenLapseAt = null;
  const hasContext = !screenStudy || hasStudyRecapContext(now);
  const screenControl = screenStudy ? updateScreenIntervention(now, noteTaking) : undefined;
  // For tab-only sessions, returning to the tab can reset the machine without creating a gaze sample.
  const controlScore = score ?? (registry.config?.attention.mode === 'off' ? rt.cfg.enterFocused : null);
  const res = step(rt.machine, {
    // Local gaze handles sustained closure through its validated non-focus dwell rule.
    now, score: screenStudy ? screenControl!.score : hasContext ? controlScore : null,
    windowActive: screenStudy || active, eyesClosed: provider.usesOffscreenRule ? false : eyesClosed, noteTaking,
    offscreenRule: screenStudy || provider.usesOffscreenRule, offscreenLapse: !screenStudy && hasContext && offscreenLapse,
    screenLapse: screenControl?.trigger,
  }, rt.cfg);
  rt.machine = res.m;
  res.events.forEach(handle);

  const m = rt.machine;
  const recoverProgress = m.state === 'recovering' && m.aboveSince !== null ? Math.min(1, (now - m.aboveSince) / 1000 / rt.cfg.recoverFocusedSec) : 0;

  const gaze = rt.gazeTracking;
  const gazeFresh = gaze && now >= gaze.t && now - gaze.t < GAZE_FRESH_MS;
  // 1 Hz log — raw video never appears here, only derived numbers.
  const sec = Math.floor(sessionSec(now));
  // Also retain the exact trigger tick, which may fall between 1 Hz samples.
  if (sec !== rt.lastLogSec || screenControl?.trigger) {
    const timeline = screenStudy ? getScreenTimeline() : undefined;
    if (timeline) {
      timeline.controlSamples.push({ timestamp: now, state: m.state, dwellMs: screenControl?.durationMs ?? 0,
        cooldownRemainingMs: Math.max(0, m.cooldownUntil - now), recoveryWait: screenControl?.recoveryWait,
        preparation: useApp.getState().live.recapPreparation, pageVisible: !document.hidden, windowActive: active,
        gazeAgeMs: gaze ? Math.max(0, now - gaze.t) : null });
      if (timeline.controlSamples.length > 7200) timeline.controlSamples.shift();
    }
  }
  if (sec !== rt.lastLogSec) {
    rt.lastLogSec = sec;
    // Waiting for usable screen context is not a measured focused sample.
    if (!screenStudy && score !== null && hasContext) rt.log.push({ t: sec, score: Math.round(m.effective), state: m.state, slideIndex: s.slideIndex });
    if (rt.latestDiagnostic && !['paused', 'break'].includes(m.state)) {
      const { t, value } = rt.latestDiagnostic;
      const diagnostic = now - t < GAZE_FRESH_MS ? value : { ...value, reason: 'stale_frame', rawOutside: null, confirmedOutside: null, eyeAspect: null, head: null, features: null, mappedGaze: null };
      rt.gazeDiagnostics.samples.push({ ...diagnostic, t: sec });
      if (rt.gazeDiagnostics.samples.length > 7200) { rt.gazeDiagnostics.samples.shift(); rt.gazeDiagnostics.droppedSamples++; }
    }
    rt.activity.push({ t: sec, slideIndex: s.slideIndex, windowActive: active, paused: m.state === 'paused' || m.state === 'break' });
    const eligibleState = m.state === 'focused' || m.state === 'drifting' || m.state === 'recovering';
    const validGaze = gazeFresh && gaze.value.state !== 'unknown' && score !== null;
    const usable = rt.memorySource === 'live' ? liveProvider === registry.attention && validGaze
      : rt.memorySource === 'replay' && registry.isMock('attention') && score !== null;
    if (eligibleState && usable && hasContext) rt.memorySamples.push({ t: sec, focused: m.state === 'focused' && (screenStudy || active) });
    checkPending(sec);
  }

  const live = useApp.getState().live;
  const gazeTracking = gaze && (gazeFresh
    ? gaze.value
    : { ...gaze.value, state: 'unknown' as const, awayMs: 0 });
  useApp.setState({
    live: {
      ...live,
      attentionAvailable: score !== null,
      state: m.state,
      gazeTracking,
      score: score ?? live.score,
      effective: m.effective,
      windowActive: screenStudy || active,
      recoverProgress,
      recoveryWait: screenControl?.recoveryWait,
      screenDwellMs: screenControl?.durationMs,
      cooldownUntil: m.cooldownUntil,
      elapsed: (now - m.sessionStart - m.pausedMs - (m.pausedAt ? now - m.pausedAt : 0)) / 1000,
    },
  });

  // Snap-back, part 1: the tab title calls you back (the cue and notification fire once, in startRescue).
  const away = (screenStudy ? document.hidden : !active) && (m.state === 'lapse' || m.state === 'rescue');
  const want = away ? (screenStudy ? 'Your screen recap · LockIn' : 'Come back to your slides · LockIn') : rt.titleBefore;
  if (document.title !== want) document.title = want;
}

function handle(e: MachineEvent) {
  if (!rt) return;
  switch (e.type) {
    case 'state':
      devlog.push({ team: 'ui', level: 'info', label: `${e.from} → ${e.to}` });
      break;
    case 'lapse':
      void startRescue(e.trigger, e.depth as 1 | 2, e.rescueInRow, e.trigger === 'gaze' && !!liveProvider?.usesOffscreenRule);
      break;
    case 'refocused': {
      // Time to refocus counts from the moment the user is back on the slide (clip and question over).
      const now = Date.now();
      if (smoothed(now).score === null) break;
      for (const p of rt.pending) if (p.outcome.timeToRefocusSec === null) p.outcome.timeToRefocusSec = Math.round((now - p.returnedAt) / 100) / 10;
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

const hasQuiz = (r: RescueUI) => (r.pack?.script.quiz.length ?? 0) > 0 && (r.pack?.variant.quizCount ?? 1) > 0;

function cancelScreenPreparation() {
  if (!rt?.preparation) return;
  getScreenTimeline()?.event('preparation-cancelled');
  rt.preparation = undefined;
  // Invalidate playback ownership. A same-topic cached render may finish for a later dwell.
  useApp.setState({ live: { ...useApp.getState().live, recapPreparation: undefined } });
}

function updateScreenIntervention(now: number, noteTaking: boolean): { score: number | null; trigger?: ScreenRisk; recoveryWait?: RecoveryWait; durationMs?: number } {
  if (!rt) return { score: null };
  const state = useApp.getState();
  if (state.rescue || ['lapse', 'rescue'].includes(rt.machine.state)) return { score: null };
  const gaze = rt.gazeTracking;
  const fresh = gaze && now >= gaze.t && now - gaze.t < GAZE_FRESH_MS;
  const scene = getLiveScreenScene(now);
  const active = !['paused', 'break', 'idle'].includes(rt.machine.state) && !noteTaking && state.screenReading !== 'stopped';
  const available = active && fresh && gaze.value.state !== 'unknown';
  const away = available && ['candidate', 'away'].includes(gaze.value.state);
  const unrelated = available && gaze.value.state === 'screen' && scene?.status === 'ready' && scene.label === 'off-topic';
  const recovered = available && gaze.value.state === 'screen' && hasStudyRecapContext(now);
  const risk = away ? 'gaze' : available && gaze.value.state === 'screen' && scene
    ? { scene, goalRequired: !!state.screenGoal } : recovered ? null : 'unknown';
  const gate = rt.screenGate.update(risk, now, lookingAwaySeconds(state.settings.lookingAwaySec) * 1000);
  if (rt.preparation && (gate.recovered || !active)) cancelScreenPreparation();
  if (gate.recovered && !rt.preparation && state.live.recapPreparation) {
    useApp.setState({ live: { ...useApp.getState().live, recapPreparation: undefined } });
  }
  const canPrepare = !rt.cfg.nudgeOnly && now >= rt.machine.cooldownUntil;
  if (gate.prepare && canPrepare && !rt.preparation) prepareScreenRescue(gate.risk!, now);
  const score = away || unrelated ? 0 : recovered ? 100 : null;
  const recoveryWait: RecoveryWait | undefined = noteTaking ? 'notes' : !available ? 'tracking'
    : state.screenReading === 'on-lockin' ? 'study-window' : gaze.value.state !== 'screen' ? 'look-at-screen'
    : unrelated ? 'off-topic' : !recovered ? 'reading' : undefined;
  return { score, recoveryWait, durationMs: gate.durationMs,
    trigger: gate.play && canPrepare && rt.preparation?.pack ? gate.risk! : undefined };
}

function prepareScreenRescue(trigger: ScreenRisk, now: number) {
  if (!rt) return;
  const source = getStudyScreenContext();
  if (!source) {
    useApp.setState({ live: { ...useApp.getState().live, recapPreparation: 'unavailable' } });
    return;
  }
  const owner = rt;
  const s = useApp.getState();
  const context: RescueContext = {
    userId: s.userId, deckId: source.deck.id, slideIndex: source.slideIndex,
    minutesIntoSession: Math.round(s.live.elapsed / 6) / 10, lapseDepth: 1,
    slideDifficulty: .5, trigger, rescueInRow: owner.machine.rescuesInRow + 1,
    rescuesSoFar: owner.outcomes.length, recentVariantIds: owner.recentVariants.slice(-5), hourOfDay: new Date(now).getHours(),
  };
  const preparation: ScreenPreparation = { ...source, trigger, context };
  owner.preparation = preparation;
  getScreenTimeline()?.event('preparation-started', trigger, now);
  useApp.setState({ live: { ...s.live, recapPreparation: 'preparing' } });
  void (async () => {
    try {
      let choice: VariantChoice;
      let memo = owner.profileMemo;
      if (owner.adaptive.retrieveMemory && owner.memorySource) {
        const slide = source.deck.slides[source.slideIndex];
        preparation.memoryTopic = { deckTitle: source.deck.title.slice(0, 200),
          slideTitle: slide.title.slice(0, 200), slideText: plainText(slide.text).slice(0, 360) };
        const pending = [...owner.outcomes, ...owner.pending.map(p => p.outcome)].flatMap(outcome => {
          const evidence = outcome.memoryEvidence;
          return evidence && evidence.source === owner.memorySource && outcome.context.deckId === source.deck.id
            ? [{ rescueId: outcome.rescueId, style: memoryStyle(evidence.variant) }] : [];
        });
        const result = await withTimeout(owner.adaptive.retrieveMemory(source.deck.id, owner.memorySource, s.settings,
          { topic: preparation.memoryTopic, pending: pending.slice(-500), allowAnalogy: false }), 2300, () => undefined);
        choice = result?.choice ?? { variant: fallbackVariant(), isHoldout: false };
        memo = result?.memo ?? memo;
        preparation.memoryDecision = result?.decision;
      } else choice = await withTimeout<VariantChoice>(owner.adaptive.chooseVariant(context), 1500,
        () => ({ variant: fallbackVariant(), isHoldout: false }));
      if (rt !== owner || owner.preparation !== preparation || ending) return;
      let variant = choice.variant;
      if (!s.settings.roastsEnabled && variant.humourStyle === 'roasts') variant = { ...variant, humourStyle: 'memes' };
      // Every screen recap includes a question before returning to study.
      variant = { ...variant, quizCount: Math.max(1, variant.quizCount) as 1 | 2 };
      preparation.choice = { ...choice, variant };
      const pack = await getPack(source.deck, source.slideIndex, variant, 1, memo);
      if (rt !== owner || owner.preparation !== preparation || ending) return;
      if (!pack.script.quiz.length) throw new Error('The video service returned no review question.');
      preparation.pack = pack;
      getScreenTimeline()?.event('preparation-ready', trigger);
      useApp.setState({ live: { ...useApp.getState().live, recapPreparation: 'ready' } });
    } catch (error) {
      if (rt !== owner || owner.preparation !== preparation || ending) return;
      preparation.error = error instanceof Error ? error.message : 'Video preparation failed.';
      getScreenTimeline()?.event('preparation-error', preparation.error);
      useApp.setState({ live: { ...useApp.getState().live, recapPreparation: 'unavailable' } });
      actions.toast(preparation.error, 'error');
    }
  })();
}

async function startScreenRescue() {
  if (!rt?.preparation?.pack) { act({ type: 'rescueFinished', clipMs: 0 }); return; }
  const owner = rt, preparation = rt.preparation;
  const { context, trigger, pack, choice } = preparation;
  const id = uid('r_');
  const controller = new AbortController();
  owner.screenWait?.abort(); owner.screenWait = controller;
  getScreenTimeline()?.exclude(Date.now(), 'intervention');
  useApp.setState({ rescue: { id, phase: 'loading', trigger, offscreen: trigger === 'gaze', depth: 1,
    context, choice, pack, memoryDecision: preparation.memoryDecision, memoryTopic: preparation.memoryTopic,
    lapseAt: Date.now(), skipped: false, answers: [] } });
  getScreenTimeline()?.event('playback-requested', trigger);
  let closeNote = () => {};
  if (document.hidden || !document.hasFocus()) {
    playCue(); closeNote = notifyComeBack(true);
  }
  const active = await whenStudyActive(controller.signal);
  closeNote();
  if (!active || rt !== owner || ending || useApp.getState().rescue?.id !== id) return;
  act({ type: 'rescueStarted' });
  const live = useApp.getState().live;
  useApp.setState({ rescue: { ...useApp.getState().rescue!, phase: 'playing', startedAt: Date.now() },
    live: { ...live, lapsesBySlide: { ...live.lapsesBySlide, [context.slideIndex]: (live.lapsesBySlide[context.slideIndex] ?? 0) + 1 } } });
  getScreenTimeline()?.event('playback-started', trigger);
}

async function startRescue(trigger: LapseTrigger, depth: 1 | 2, rescueInRow: number, offscreen: boolean) {
  if (!rt) return;
  if (currentDeck().sourceType === 'screen') {
    await startScreenRescue();
    return;
  }
  const owner = rt;
  const lapseAt = Date.now();
  const screenStudy = currentDeck().sourceType === 'screen';
  const screenSlideIndex = screenStudy ? useApp.getState().slideIndex : undefined;

  // Snap-back, part 2: a clip in a hidden tab plays to nobody, and would count
  // toward the rescue cap and A_after. Call the user back, and start the clip
  // when they are here to see it.
  if (document.hidden) {
    playCue();
    const closeNote = notifyComeBack(screenStudy);
    devlog.push({ team: 'ui', level: 'info', label: 'lapse in a hidden tab: rescue held until the tab is visible' });
    await whenVisible();
    closeNote();
    if (rt !== owner || rt.machine.state !== 'lapse') return;
  }

  const s = useApp.getState();
  if (screenStudy && s.screenReading === 'stopped') {
    act({ type: 'rescueFinished', clipMs: 0 });
    return;
  }
  const deck = currentDeck();
  const slideIndex = screenSlideIndex ?? s.slideIndex;
  const slide = deck.slides[slideIndex];
  if (screenStudy && !slide?.text) {
    act({ type: 'rescueFinished', clipMs: 0 });
    return;
  }
  const context: RescueContext = {
    userId: s.userId,
    deckId: deck.id,
    slideIndex,
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
    rescue: { id, phase: 'loading', trigger, offscreen, depth, context, lapseAt, skipped: false, answers: [] },
    live: { ...s.live, lapsesBySlide: trigger !== 'manual' && (depth === 1 || screenStudy)
      ? { ...s.live.lapsesBySlide, [slideIndex]: (s.live.lapsesBySlide[slideIndex] ?? 0) + 1 }
      : s.live.lapsesBySlide },
  });

  const fallback = () => ({ variant: fallbackVariant(), isHoldout: false });
  let choice: VariantChoice;
  let profileMemo = owner.profileMemo;
  let memoryDecision: MemoryDecision | undefined;
  let memoryTopic: MemoryTopic | undefined;
  if (owner.adaptive.retrieveMemory && owner.memorySource) {
    if (slide) {
      const excerpt = (value: string, limit: number) => Array.from(plainText(value).trim()).slice(0, limit).join('');
      memoryTopic = {
        deckTitle: excerpt(deck.title, 200) || 'Untitled deck',
        slideTitle: excerpt(slide.title, 200) || `Slide ${slide.index + 1}`,
        slideText: excerpt(slide.text, 360),
      };
    }
    const pending = [...owner.outcomes, ...owner.pending.map(({ outcome }) => outcome)].flatMap((outcome) => {
      const evidence = outcome.memoryEvidence;
      if (!evidence || evidence.source !== owner.memorySource || outcome.context.deckId !== deck.id) return [];
      return [{ rescueId: outcome.rescueId, style: memoryStyle(evidence.variant) }];
    }).slice(-500);
    const fallbackChoice = fallback();
    const memory = await withTimeout(
      owner.adaptive.retrieveMemory(deck.id, owner.memorySource, s.settings, {
        pending,
        topic: memoryTopic,
        allowAnalogy: deck.sourceType === 'demo' || (deck.sourceType !== 'screen' && !registry.isMock('content')),
      }), 2300,
      () => ({
        choice: fallbackChoice,
        memo: undefined,
        decision: {
          style: memoryStyle(fallbackChoice.variant), reason: 'unavailable' as const,
          evidenceCount: 0, eligibleByStyle: {},
          excluded: { skipped: 0, noClip: 0, insufficientRecovery: 0 }, minOutcomesPerStyle: 0,
        },
      }),
    );
    choice = memory.choice;
    profileMemo = memory.memo;
    memoryDecision = memory.decision;
    devlog.push({ team: 'adaptive', level: 'info', label: 'Memory bank evidence', detail: { count: memory.decision.evidenceCount, related: memory.decision.relatedMemories?.length ?? 0, reason: memory.decision.reason, source: owner.memorySource } });
  } else {
    choice = await withTimeout<VariantChoice>(owner.adaptive.chooseVariant(context), 1500, fallback);
  }
  // the user may have left (Esc) or the session ended while the choice was pending
  if (rt !== owner || useApp.getState().rescue?.id !== id) return;
  let variant = choice.variant;
  if (!s.settings.roastsEnabled && variant.humourStyle === 'roasts') variant = { ...variant, humourStyle: 'memes' };
  if (memoryDecision) useApp.setState({ rescue: { ...useApp.getState().rescue!, memoryDecision, memoryTopic } });
  rt.recentVariants.push(variant.id);

  if (choice.action === 'skip') {
    // Control arm: a plain reminder instead of a clip.
    act({ type: 'rescueStarted' });
    useApp.setState({ rescue: null });
    actions.toast(screenStudy ? 'Eyes back on your study material.' : 'Eyes back on the slide.');
    const now = Date.now();
    const outcome = makeOutcome(id, context, variant.id, choice.isHoldout, now, now, 0, false, []);
    act({ type: 'rescueFinished', clipMs: 0 });
    rt.pending.push({ outcome, returnedAtSec: sessionSec(now), returnedAt: now });
    return;
  }

  try {
    const pack = await getPack(deck, slideIndex, variant, depth, profileMemo);
    if (rt !== owner || useApp.getState().rescue?.id !== id) return; // user already left
    act({ type: 'rescueStarted' });
    useApp.setState({ rescue: { ...useApp.getState().rescue!, phase: 'playing', pack, choice: { ...choice, variant }, startedAt: Date.now() } });
  } catch (err) {
    if (rt !== owner || useApp.getState().rescue?.id !== id) return;
    act({ type: 'rescueStarted' });
    useApp.setState({ rescue: { ...useApp.getState().rescue!, phase: 'error', choice: { ...choice, variant }, error: (err as Error).message, startedAt: Date.now() } });
  }
}

/** A user-requested recap works independently of a gaze tracker. */
export function requestRecap() {
  if (!rt || ending || !registry.canRecap() || useApp.getState().rescue) return;
  const slide = currentDeck().slides[useApp.getState().slideIndex];
  if (!slide?.text.trim()) { actions.toast('This slide has no readable text. Use a PDF with selectable text for AI recaps.', 'error'); return; }
  act({ type: 'requestRescue' });
}

export function playbackFailed(message: string) {
  const rescue = useApp.getState().rescue;
  if (rescue) useApp.setState({ rescue: { ...rescue, phase: 'error', error: message } });
}

export function playbackBlocked() {
  const rescue = useApp.getState().rescue;
  if (rescue?.phase === 'playing') useApp.setState({ rescue: { ...rescue, awaitingPlayback: true, startedAt: undefined } });
}

export function playbackStarted() {
  getScreenTimeline()?.event('playback-confirmed');
  const rescue = useApp.getState().rescue;
  if (rescue?.phase === 'playing' && rescue.awaitingPlayback) {
    useApp.setState({ rescue: { ...rescue, awaitingPlayback: false, startedAt: Date.now() } });
  }
}

/** Narration finished. */
export function clipEnded() {
  const r = useApp.getState().rescue;
  if (!r || r.phase !== 'playing') return;
  if (rt?.gazeTrace) getScreenTimeline()?.event('quiz-started');
  if (hasQuiz(r)) useApp.setState({ rescue: { ...r, clipEndedAt: Date.now(), phase: 'quiz' } });
  else {
    useApp.setState({ rescue: { ...r, clipEndedAt: Date.now() } });
    finishRescue();
  }
}

/**
 * "I'm back" / Esc. During a clip this ends the clip and goes to the question:
 * the question is required to exit (the proposal's guard against drifting on
 * purpose), and the skip is still logged. Nothing has played while loading, and
 * an error card has no question, so those return straight away.
 */
export function skipClip() {
  const r = useApp.getState().rescue;
  if (!r || r.phase === 'quiz') return;
  if (r.phase === 'playing' && !r.awaitingPlayback && hasQuiz(r)) {
    useApp.setState({ rescue: { ...r, skipped: true, clipEndedAt: Date.now(), phase: 'quiz' } });
    return;
  }
  leaveRescue();
}

/** Close the rescue now, whatever phase it is in (pause, or nothing to ask). */
function leaveRescue() {
  const r = useApp.getState().rescue;
  if (!r) return;
  if (r.phase === 'loading') act({ type: 'rescueStarted' }); // nothing played yet — an immediate return
  useApp.setState({ rescue: { ...r, skipped: r.skipped || r.phase === 'playing' || r.phase === 'loading', clipEndedAt: r.clipEndedAt ?? Date.now() } });
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
  if (rt.gazeTrace) {
    getScreenTimeline()?.resume(Date.now());
    rt.screenWait?.abort();
    rt.preparation = undefined;
    rt.screenGate = new ScreenIntervention();
    getScreenTimeline()?.event('returned-to-study');
    useApp.setState({ live: { ...useApp.getState().live, recapPreparation: undefined } });
  }
  if (!r.pack || r.phase === 'error' || r.awaitingPlayback) {
    useApp.setState({ rescue: null });
    act({ type: 'rescueFinished', clipMs: 0 });
    return;
  }
  const now = Date.now();
  const started = r.startedAt ?? now;
  const clipMs = Math.max(0, (r.clipEndedAt ?? now) - started);
  const outcome = makeOutcome(r.id, r.context, r.choice?.variant.id ?? 'none', r.choice?.isHoldout ?? false, started, r.clipEndedAt ?? now, clipMs / 1000, r.skipped, r.answers);
  if (rt.memorySource) {
    outcome.memoryEvidence = { source: rt.memorySource, variant: r.pack.script.variant, topic: r.memoryTopic, recoverySamples: 0, focusedShare: null };
  }
  if (r.memoryDecision) outcome.memoryDecision = r.memoryDecision;
  rt.pending.push({ outcome, returnedAtSec: sessionSec(now), returnedAt: now });
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

function finalizeOutcome(p: Pending, partial: boolean) {
  if (!rt) return;
  p.outcome.attentionAfter = focusShare(rt.log, p.returnedAtSec, p.returnedAtSec + REWARD_WINDOW_SEC);
  const evidence = p.outcome.memoryEvidence;
  if (evidence) {
    const usable = rt.memorySamples.filter(({ t }) => t >= p.returnedAtSec && t < p.returnedAtSec + REWARD_WINDOW_SEC);
    evidence.recoverySamples = usable.length;
    evidence.focusedShare = usable.length ? usable.filter(({ focused }) => focused).length / usable.length : null;
  }
  rt.outcomes.push(p.outcome);
  if (partial && (rt.adaptive.retrieveMemory || p.outcome.attentionAfter === null)) return;
  const write = rt.adaptive.reportOutcome(p.outcome).catch(() => {});
  if (rt.adaptive.retrieveMemory) rt.memoryWrites.push(write);
}

// ───────────────────────── user controls ─────────────────────────

/** Pause: tracking stops and the camera goes fully off. */
async function pause(retainCalibration = true) {
  if (!rt) return;
  cancelScreenPreparation();
  rt.screenWait?.abort();
  if (rt.machine.state !== 'paused') {
    if (useApp.getState().rescue) leaveRescue();
    act({ type: 'pause' });
  } else if (retainCalibration) {
    return;
  }
  if (currentDeck().sourceType === 'screen') {
    getScreenTimeline()?.exclude(Date.now(), 'paused');
    setScreenReading(false);
  }
  const stopping = stopAttention(retainCalibration);
  cameraOff('paused');
  await stopping;
}

async function resume() {
  const session = rt;
  if (!session || ending || session.machine.state !== 'paused') return;
  if (registry.attention.needsCalibration) {
    actions.go('setup');
    return;
  }
  if (useApp.getState().camera === 'paused' || registry.attention.needsCamera) await ensureCamera();
  if (rt !== session || ending) return;
  await startAttention();
  if (rt === session && !ending) {
    if (currentDeck().sourceType === 'screen') {
      getScreenTimeline()?.resume(Date.now());
      setScreenReading(true);
    }
    act({ type: 'resume' });
  }
}

export async function togglePause() {
  // a break has its own controls, and a session that is ending can't be resumed
  if (!rt || ending || useApp.getState().breakCard) return;
  if (rt.machine.state === 'paused') await resume();
  else await pause();
}

/** Pause before leaving the study screen (recalibration); enterStudy() resumes it. */
export async function pauseSession() {
  if (!rt || ending) return;
  await pause(false);
}

export function toggleNoteTaking() {
  const s = useApp.getState();
  const on = s.live.noteTakingUntil !== null;
  const grace = (rt?.cfg.noteTakingGraceSec ?? 60) * 1000;
  useApp.setState({ live: { ...s.live, noteTakingUntil: on ? null : Date.now() + grace } });
}

/** A real break: tracking stops and the camera goes off, as the break card says. */
export async function takeBreak(minutes = 5) {
  if (!rt) return;
  useApp.setState({ breakCard: { reason: useApp.getState().breakCard?.reason ?? 'repeated', until: Date.now() + minutes * 60_000 } });
  act({ type: 'breakTaken' }); // resets the rescue streak and starts the cooldown
  await pause();
}

export async function endBreak() {
  useApp.setState({ breakCard: null });
  await resume();
}

export function dismissBreak() {
  act({ type: 'breakDismissed' });
  useApp.setState({ breakCard: null });
}

export function onSlideChange(index: number) {
  if (!rt) return;
  if (currentDeck().slides[index]) rt.visitedSlides.add(index);
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
    actions.toast(r.pack.media.videoUrl ? 'Flagged for review on this computer.' : 'Flagged. This clip will be checked against the slide again.');
  }
  useApp.setState({ rescue: { ...r, flagged: !r.flagged } });
}

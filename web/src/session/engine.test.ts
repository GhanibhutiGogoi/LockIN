/**
 * Engine lifecycle tests: camera, provider, break, end-of-session and rescue
 * flows from the review of PR #3. Runs in node with a minimal DOM stand-in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FocusSample } from '../contracts/types';
import { ATTENTION_TIMING, ATTENTION_RULE_VERSION } from '../../../gaze-demo/backend/static/attention-policy.js';

const h = vi.hoisted(() => {
  const listeners = new Map<string, Set<() => void>>();
  const doc = {
    title: 'LockIn',
    hidden: false,
    visibilityState: 'visible' as 'visible' | 'hidden',
    focused: true,
    hasFocus() {
      return this.focused;
    },
    addEventListener(t: string, f: () => void) {
      if (!listeners.has(t)) listeners.set(t, new Set());
      listeners.get(t)!.add(f);
    },
    removeEventListener(t: string, f: () => void) {
      listeners.get(t)?.delete(f);
    },
    fire(t: string) {
      [...(listeners.get(t) ?? [])].forEach((f) => f());
    },
  };
  return { doc, listeners };
});

vi.mock('../lib/camera', () => ({
  getStream: vi.fn(() => ({})),
  requestCamera: vi.fn(async () => 'on'),
  releaseCamera: vi.fn(),
}));

vi.mock('../providers/registry', () => {
  const quiz = [{ question: 'Q?', options: ['a', 'b'], answerIndex: 0, ifRight: 'yes', ifWrong: 'no' }];
  const registry = {
    attention: {
      name: 'fake',
      needsCamera: true,
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      onSample: vi.fn(() => () => {}),
    },
    content: {
      getScript: vi.fn(async () => ({ hook: 'Hook', script: 'one two three', keyTerms: [], quiz, plainSummary: 's' })),
    },
    media: {
      renderMedia: vi.fn(async () => ({ captions: [{ word: 'Hook', start: 0, end: 0.3 }], durationSec: 2, broll: [] })),
    },
    adaptive: {
      getSessionConfig: vi.fn(async () => ({})),
      chooseVariant: vi.fn(),
      reportOutcome: vi.fn(async () => {}),
      endSession: vi.fn(async () => ({ score: { sustainedEpisodeMedianSec: 10 } })),
      getProfileMemo: vi.fn(async () => undefined),
    },
    isMock: () => false,
    canRecap: vi.fn(() => true),
    subscribe: () => () => {},
  };
  return { registry };
});

type Engine = typeof import('./engine');
type Store = typeof import('../store');
let engine: Engine;
let store: Store;
let registry: (typeof import('../providers/registry'))['registry'];
let camera: typeof import('../lib/camera');

const flush = async (n = 5) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};
/** Advance fake time in small steps, letting promises settle in between. */
async function advance(ms: number) {
  for (let t = 0; t < ms; t += 100) {
    await vi.advanceTimersByTimeAsync(100);
  }
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  Object.assign(h.doc, { hidden: false, visibilityState: 'visible', focused: true, title: 'LockIn' });
  h.listeners.clear();
  (globalThis as unknown as { document: unknown }).document = h.doc;
  (globalThis as unknown as { window: unknown }).window = Object.assign(globalThis, { scrollTo: () => {}, addEventListener: () => {}, removeEventListener: () => {} });
  engine = await import('./engine');
  store = await import('../store');
  registry = (await import('../providers/registry')).registry;
  camera = await import('../lib/camera');
  vi.clearAllMocks();
  const { DEFAULT_VARIANT } = await import('../contracts/defaults');
  vi.mocked(registry.adaptive.chooseVariant).mockResolvedValue({ variant: DEFAULT_VARIANT, isHoldout: false });
  vi.mocked(registry.adaptive.getSessionConfig).mockResolvedValue({});
  vi.mocked(registry.canRecap).mockReturnValue(true);
  store.actions.addDeck({ id: 'uploaded-test', title: 'Uploaded lecture', sourceType: 'pdf', slideCount: 1, slides: [{ index: 0, title: 'Concept', text: 'A lecture slide with readable text.' }] });
  store.useApp.setState({ camera: 'off', settings: { ...store.useApp.getState().settings, nudgeOnly: false } });
});

afterEach(async () => {
  if (engine.isRunning()) await engine.endSession();
  Reflect.deleteProperty(registry.attention, 'usesOffscreenRule');
  Reflect.deleteProperty(registry.attention, 'suspend');
  Reflect.deleteProperty(registry.attention, 'needsCalibration');
  Reflect.deleteProperty(registry.adaptive, 'retrieveMemory');
  vi.useRealTimers();
});

/** Switch away from the window long enough for a window lapse (5 s by default). */
async function lapseByAppSwitch() {
  h.doc.focused = false;
  await advance(5600);
}

describe('session lifecycle', () => {
  it('keeps memory-based variant selection for screen preparation', async () => {
    const share = await import('../lib/screenShare');
    const { DEFAULT_VARIANT } = await import('../contracts/defaults');
    const retrieveMemory = vi.fn(async () => ({ choice: { variant: DEFAULT_VARIANT, isHoldout: false }, memo: 'Use plain explanations.' }));
    Object.assign(registry.adaptive, { retrieveMemory });
    Object.assign(registry.attention, { usesOffscreenRule: true });
    const deck = { id: 'screen-memory', title: 'Shared screen', sourceType: 'screen' as const,
      slides: [{ index: 0, title: 'Outliers', text: 'Outliers are unusual observations.' }], slideCount: 1 };
    store.actions.addDeck(deck); store.useApp.setState({ screenReading: 'ready' });
    await engine.enterStudy();
    vi.spyOn(share, 'getStudyScreenContext').mockReturnValue({ deck, slideIndex: 0 });
    const emit = vi.mocked(registry.attention.onSample).mock.calls.at(-1)![0];
    for (let i = 0; i < 25; i++) {
      emit({ t: Date.now(), score: 0, confidence: 1, gazeTracking: { state: 'away', awayMs: i * 200, thresholdMs: 30000 } });
      await advance(200);
    }
    expect(retrieveMemory).toHaveBeenCalledWith(deck.id, 'live', expect.anything(), expect.objectContaining({ topic: expect.objectContaining({ slideText: deck.slides[0].text }) }));
    expect(registry.content.getScript).toHaveBeenCalledWith(expect.objectContaining({ profileMemo: 'Use plain explanations.' }), expect.anything());
  });

  it('connects screen off-topic dwell to real providers, quiz, recovery and a timestamp-aligned report', async () => {
    const share = await import('../lib/screenShare');
    const deck = { id: 'screen-flow', title: 'Shared screen', sourceType: 'screen' as const,
      slides: [{ index: 0, title: 'Data mining', text: 'Outliers are unusual observations.' }], slideCount: 1 };
    store.actions.addDeck(deck);
    store.useApp.setState({ screenGoal: 'Data mining', screenReading: 'ready' });
    await engine.enterStudy();
    vi.spyOn(share, 'getStudyScreenContext').mockReturnValue({ deck, slideIndex: 0 });
    const timeline = share.getScreenTimeline()!;
    const scene = timeline.observe(Date.now(), true, 1600, 900, 'monitor');
    Object.assign(scene, { status: 'ready', label: 'off-topic', text: 'Sports highlights' });
    const emit = vi.mocked(registry.attention.onSample).mock.calls.at(-1)![0];
    for (let i = 0; i < 160; i++) {
      scene.observedUntil = Date.now();
      emit({ t: Date.now(), score: 100, confidence: 1, gazeTracking: { state: 'screen', awayMs: 0, thresholdMs: 30000 } });
      await advance(200);
      if (i === 25) {
        expect(registry.media.renderMedia).toHaveBeenCalledTimes(1);
        expect(store.useApp.getState().rescue).toBeNull();
      }
    }
    expect(store.useApp.getState().rescue).toMatchObject({ phase: 'playing', trigger: 'content' });
    expect(registry.content.getScript).toHaveBeenCalledWith(expect.objectContaining({ slide: deck.slides[0] }), expect.anything());
    engine.clipEnded();
    expect(store.useApp.getState().rescue?.phase).toBe('quiz');
    engine.answerQuiz(0, 0); engine.finishRescue();
    expect(store.useApp.getState().rescue).toBeNull();
    expect(store.useApp.getState().live.state).toBe('recovering');
    await engine.endSession();
    const report = store.useApp.getState().report!;
    expect(report.log.rescues[0].context.trigger).toBe('content');
    expect(report.log.rescues[0].quiz[0].correct).toBe(true);
    expect(report.log.screenAnalysis?.windows.some(w => w.offTopicMs > 0)).toBe(true);
    expect(report.log.screenAnalysis?.events.map(e => e.type)).toEqual(expect.arrayContaining(['preparation-started', 'playback-started', 'quiz-started', 'returned-to-study']));
  });

  it('cancels screen preparation on recovery and never treats missing gaze as an automatic rescue', async () => {
    const share = await import('../lib/screenShare');
    const deck = { id: 'screen-cancel', title: 'Shared screen', sourceType: 'screen' as const,
      slides: [{ index: 0, title: 'Topic', text: 'Study material.' }], slideCount: 1 };
    store.actions.addDeck(deck); store.useApp.setState({ screenReading: 'ready' });
    await engine.enterStudy();
    vi.spyOn(share, 'getStudyScreenContext').mockReturnValue({ deck, slideIndex: 0 });
    const emit = vi.mocked(registry.attention.onSample).mock.calls.at(-1)![0];
    for (let i = 0; i < 25; i++) {
      emit({ t: Date.now(), score: 0, confidence: 1, gazeTracking: { state: 'away', awayMs: i * 200, thresholdMs: 30000 } });
      await advance(200);
    }
    expect(store.useApp.getState().live.recapPreparation).toBe('ready');
    vi.spyOn(share, 'hasStudyRecapContext').mockReturnValue(true);
    for (let i = 0; i < 8; i++) {
      emit({ t: Date.now(), score: 100, confidence: 1, gazeTracking: { state: 'screen', awayMs: 0, thresholdMs: 30000 } });
      await advance(200);
    }
    expect(store.useApp.getState().live.recapPreparation).toBeUndefined();
    await advance(35_000);
    expect(store.useApp.getState().rescue).toBeNull();
  });

  it('recovers after reading confirmed study content and permits a later delayed off-topic recap', async () => {
    const share = await import('../lib/screenShare');
    const deck = { id: 'screen-return', title: 'Shared screen', sourceType: 'screen' as const,
      slides: [{ index: 0, title: 'Outliers', text: 'Outliers are unusual observations.' }], slideCount: 1 };
    store.actions.addDeck(deck);
    store.useApp.setState({ screenGoal: 'Data mining', screenReading: 'ready' });
    await engine.enterStudy();
    vi.spyOn(share, 'getStudyScreenContext').mockReturnValue({ deck, slideIndex: 0 });
    const timeline = share.getScreenTimeline()!;
    let scene = timeline.observe(Date.now(), true, 1600, 900, 'monitor');
    Object.assign(scene, { status: 'ready', label: 'related' });
    const emit = vi.mocked(registry.attention.onSample).mock.calls.at(-1)![0];
    async function observe(gaze: 'screen' | 'away', ms: number) {
      for (let i = 0; i < ms; i += 200) {
        scene.observedUntil = Date.now();
        emit({ t: Date.now(), score: gaze === 'screen' ? 100 : 0, confidence: 1,
          gazeTracking: { state: gaze, awayMs: gaze === 'away' ? i : 0, thresholdMs: 30000 } });
        await advance(200);
      }
    }
    await observe('away', 32_000);
    expect(store.useApp.getState().rescue?.phase).toBe('playing');
    engine.clipEnded(); engine.answerQuiz(0, 0); engine.finishRescue();
    timeline.breakScene(); store.useApp.setState({ screenReading: 'on-lockin' });
    await observe('screen', 6000);
    expect(store.useApp.getState().live).toMatchObject({ state: 'recovering', recoverProgress: 0, recoveryWait: 'study-window' });
    scene = timeline.observe(Date.now(), true, 1600, 900, 'monitor');
    Object.assign(scene, { status: 'ready', label: 'related' });
    store.useApp.setState({ screenReading: 'ready' });
    await observe('screen', 2000);
    expect(store.useApp.getState().live.recoverProgress).toBeGreaterThan(0);
    await observe('screen', 3000);
    expect(store.useApp.getState().live.state).toBe('focused');
    // Cooldown remains explicit and can expire normally; no permanent recovery lock.
    await observe('screen', 181_000);
    scene = timeline.observe(Date.now(), true, 1600, 900, 'monitor');
    await observe('screen', 35_000);
    expect(store.useApp.getState().rescue).toBeNull();
    Object.assign(scene, { status: 'ready', label: 'off-topic' });
    await observe('screen', 2000);
    expect(store.useApp.getState().rescue).toMatchObject({ phase: 'playing', trigger: 'content' });
    expect(timeline.controlSamples.some(sample => sample.cooldownRemainingMs > 0)).toBe(true);
    expect(timeline.controlSamples.some(sample => sample.dwellMs >= 30_000)).toBe(true);
  });

  it('plays delayed media after brief tracking loss while distraction continues', async () => {
    const share = await import('../lib/screenShare');
    const deck = { id: 'screen-delayed', title: 'Shared screen', sourceType: 'screen' as const,
      slides: [{ index: 0, title: 'Outliers', text: 'Outliers are unusual observations.' }], slideCount: 1 };
    store.actions.addDeck(deck); store.useApp.setState({ screenReading: 'ready' });
    await engine.enterStudy();
    vi.spyOn(share, 'getStudyScreenContext').mockReturnValue({ deck, slideIndex: 0 });
    const media = { captions: [], durationSec: 30, broll: [] };
    let resolveMedia!: (value: typeof media) => void;
    vi.mocked(registry.media.renderMedia).mockImplementationOnce(() => new Promise(resolve => { resolveMedia = resolve; }));
    const emit = vi.mocked(registry.attention.onSample).mock.calls.at(-1)![0];
    async function observe(state: 'away' | 'unknown', duration: number) {
      for (let ms = 0; ms < duration; ms += 200) {
        emit({ t: Date.now(), score: 0, confidence: state === 'unknown' ? 0 : 1,
          gazeTracking: { state, awayMs: 40000, thresholdMs: 30000 } });
        await advance(200);
      }
    }
    await observe('away', 35_000);
    await observe('unknown', 600);
    expect(store.useApp.getState().live.recapPreparation).toBe('preparing');
    resolveMedia(media); await flush();
    expect(store.useApp.getState().rescue).toBeNull();
    await observe('away', 600);
    expect(registry.media.renderMedia).toHaveBeenCalledTimes(1);
    expect(store.useApp.getState().rescue).toMatchObject({ phase: 'playing', trigger: 'gaze' });
    const events = share.getScreenTimeline()!.events.map(e => e.type);
    expect(events).toContain('preparation-ready');
    expect(events).not.toContain('preparation-cancelled');
  });

  it('reuses screen content across observation indices but not changed lessons', async () => {
    const { getPack } = await import('./packs');
    const { DEFAULT_VARIANT } = await import('../contracts/defaults');
    const deck = { id: 'screen-cache', title: 'Shared screen', sourceType: 'screen' as const, slideCount: 3,
      slides: ['Outliers are unusual observations.', 'Outliers  are unusual\nobservations.', 'Clustering groups similar observations.']
        .map((text, index) => ({ index, title: `Screen moment ${index}`, text })) };
    await Promise.all([getPack(deck, 0, DEFAULT_VARIANT, 1), getPack(deck, 1, DEFAULT_VARIANT, 1)]);
    expect(registry.content.getScript).toHaveBeenCalledTimes(1);
    expect(registry.media.renderMedia).toHaveBeenCalledTimes(1);
    await getPack(deck, 2, DEFAULT_VARIANT, 1);
    expect(registry.content.getScript).toHaveBeenCalledTimes(2);
  });

  it('does not log default focused samples while screen OCR has no usable context', async () => {
    store.actions.addDeck({ id: 'screen-test', title: 'Shared screen', sourceType: 'screen', slides: [], slideCount: 0 });
    await engine.enterStudy();
    const emit = vi.mocked(registry.attention.onSample).mock.calls.at(-1)![0];
    for (let i = 0; i < 20; i++) {
      emit({ t: Date.now(), score: 100, confidence: 1 });
      await advance(100);
    }
    await engine.endSession();
    const log = store.useApp.getState().report!.log;
    expect(log.samples).toEqual([]);
    expect(log.attentionSource).toBe('unavailable');
    expect(log.screenDiagnostics).toBeDefined();
  });
  it('records tab activity without inventing focus samples or generating recaps', async () => {
    vi.mocked(registry.canRecap).mockReturnValue(false);
    await engine.enterStudy();
    await advance(1100);
    await lapseByAppSwitch();
    h.doc.focused = true;
    await advance(5000);
    await engine.endSession();
    const log = store.useApp.getState().report!.log;
    expect(log.samples).toEqual([]);
    expect(log.attentionSource).toBe('unavailable');
    expect(log.activity?.some((a) => !a.windowActive)).toBe(true);
    expect(log.visitedSlides).toEqual([0]);
    expect(log.activeSeconds).toBeGreaterThan(10);
    expect(registry.media.renderMedia).not.toHaveBeenCalled();
    expect(registry.adaptive.chooseVariant).not.toHaveBeenCalled();
  });
  it('enterStudy twice starts one session and one provider', async () => {
    await Promise.all([engine.enterStudy(), engine.enterStudy()]);
    expect(registry.attention.start).toHaveBeenCalledTimes(1);
    expect(registry.attention.onSample).toHaveBeenCalledTimes(1);
    expect(store.useApp.getState().camera).toBe('on');
  });

  it('turns the camera off when the session ends', async () => {
    await engine.enterStudy();
    await engine.endSession();
    expect(camera.releaseCamera).toHaveBeenCalled();
    expect(store.useApp.getState().camera).toBe('off');
    expect(registry.attention.stop).toHaveBeenCalled();
  });

  it('runs endSession once on a double click, and ignores P while it is pending', async () => {
    await engine.enterStudy();
    let finish!: (v: { score: { sustainedEpisodeMedianSec: number } }) => void;
    vi.mocked(registry.adaptive.endSession).mockImplementationOnce(() => new Promise((r) => (finish = r)) as never);
    const a = engine.endSession();
    const b = engine.endSession();
    await flush();
    await engine.togglePause();
    expect(registry.adaptive.endSession).toHaveBeenCalledTimes(1);
    expect(registry.attention.start).toHaveBeenCalledTimes(1);
    finish({ score: { sustainedEpisodeMedianSec: 1 } });
    await Promise.all([a, b]);
    expect(engine.isRunning()).toBe(false);
  });

  it('a break stops tracking and the camera, and P does nothing during it', async () => {
    await engine.enterStudy();
    await engine.takeBreak(5);
    expect(registry.attention.stop).toHaveBeenCalledTimes(1);
    expect(camera.releaseCamera).toHaveBeenCalled();
    expect(store.useApp.getState().camera).toBe('paused');
    await engine.togglePause();
    expect(registry.attention.start).toHaveBeenCalledTimes(1);
    expect(store.useApp.getState().live.state).toBe('paused');
    await engine.endBreak();
    expect(store.useApp.getState().camera).toBe('on');
    expect(registry.attention.start).toHaveBeenCalledTimes(2);
    expect(store.useApp.getState().live.state).toBe('focused');
  });

  it('pausing for recalibration keeps the session, and coming back resumes it', async () => {
    await engine.enterStudy();
    await engine.pauseSession();
    expect(store.useApp.getState().live.state).toBe('paused');
    await engine.enterStudy();
    expect(engine.isRunning()).toBe(true);
    expect(store.useApp.getState().live.state).toBe('focused');
    expect(registry.adaptive.endSession).not.toHaveBeenCalled();
  });

  it('releases the camera on pause and reopens a retained provider for setup', async () => {
    const suspend = vi.fn(() => true);
    Object.assign(registry.attention, { suspend });
    await engine.enterStudy();
    await engine.togglePause();
    expect(suspend).toHaveBeenCalledOnce();
    expect(registry.attention.stop).not.toHaveBeenCalled();
    expect(camera.releaseCamera).toHaveBeenCalled();
    expect(store.useApp.getState().camera).toBe('paused');

    Object.assign(registry.attention, { needsCalibration: true });
    await Promise.all([engine.togglePause(), engine.togglePause()]);
    expect(store.useApp.getState().screen).toBe('setup');
    await engine.ensureCamera();
    await engine.ensureAttention();
    expect(registry.attention.start).toHaveBeenCalledTimes(2);
    expect(registry.attention.stop).not.toHaveBeenCalled();

    Object.assign(registry.attention, { needsCalibration: false });
    await engine.enterStudy();
    expect(store.useApp.getState().live.state).toBe('focused');
    await engine.endSession();
    expect(registry.attention.stop).toHaveBeenCalledOnce();
  });

  it('keeps nudge-only when the personal-AI service is down', async () => {
    vi.mocked(registry.adaptive.getSessionConfig).mockRejectedValueOnce(new Error('down'));
    store.useApp.setState({ settings: { ...store.useApp.getState().settings, nudgeOnly: true } });
    await engine.enterStudy();
    await lapseByAppSwitch();
    expect(store.useApp.getState().rescue).toBeNull();
    expect(registry.adaptive.chooseVariant).not.toHaveBeenCalled();
  });
});

describe('local gaze diagnostics', () => {
  it('exports a screen trajectory even with no OCR or combined focus samples, without uploading it', async () => {
    store.actions.addDeck({ id: 'screen-trace', title: 'Shared screen', sourceType: 'screen', slideCount: 1, slides: [{ index: 0, title: 'Shared screen', text: '' }] });
    let uploadedTrace: unknown = 'not called';
    vi.mocked(registry.adaptive.endSession).mockImplementationOnce(async log => {
      uploadedTrace = log.gazeTrace;
      return { score: { sustainedEpisodeMedianSec: 0 } } as never;
    });
    await engine.enterStudy();
    const emit = vi.mocked(registry.attention.onSample).mock.calls.at(-1)![0];
    const calibration = {
      id: 'test-calibration', at: Date.now(), model: 'blazegaze', validation: null,
      geometry: { width: 1920, height: 1080, screenWidth: 1920, screenHeight: 1080, windowX: 0, windowY: 0, pixelRatio: 1, fullscreen: true },
    };
    for (let i = 0; i < 20; i++) {
      emit({ t: Date.now(), confidence: 0, score: 0, gazeTrace: { calibration, raw: { x: i / 20, y: .5 }, valid: true, reason: 'screen' } });
      await advance(100);
    }
    await engine.endSession();
    const log = store.useApp.getState().report!.log;
    expect(log.samples).toEqual([]);
    expect(log.gazeTrace!.samples).toHaveLength(20);
    expect(log.gazeTrace!.samples.every(s => s.status === 'valid')).toBe(true);
    expect(uploadedTrace).toBeUndefined();
  });

  it('logs sustained eye closure as non-focus without invoking the legacy three-second drowsy rescue', async () => {
    Object.assign(registry.attention, { usesOffscreenRule: true });
    await engine.enterStudy();
    const emit = vi.mocked(registry.attention.onSample).mock.calls.at(-1)![0];
    for (let i = 0; i < 60; i++) {
      emit({ t: Date.now(), score: 0, confidence: 1, signals: { gaze: 0, eyesOpen: 0, facePresent: 1 }, gazeTracking: { state: 'candidate', awayMs: i * 100, thresholdMs: 30000, reason: 'eyes_closed' } });
      await advance(100);
    }
    expect(store.useApp.getState().live.state).toBe('drifting');
    expect(store.useApp.getState().rescue).toBeNull();
    await engine.endSession();
    expect(store.useApp.getState().report!.log.samples.slice(-3).every(s => s.score === 0)).toBe(true);
  });

  it('exports numeric runtime diagnostics including unknown frames without sending them to the adaptive service', async () => {
    Object.assign(registry.attention, { usesOffscreenRule: true });
    let uploadedDiagnostics: unknown = 'not called';
    vi.mocked(registry.adaptive.endSession).mockImplementationOnce(async log => {
      uploadedDiagnostics = log.gazeDiagnostics;
      return { score: { sustainedEpisodeMedianSec: 0 } } as never;
    });
    await engine.enterStudy();
    const emit = vi.mocked(registry.attention.onSample).mock.calls.at(-1)![0];
    emit({
      t: Date.now(), score: 0, confidence: 0,
      gazeTracking: { state: 'unknown', awayMs: 0, thresholdMs: 30000 },
      gazeDiagnostic: { model: 'blazegaze', ruleVersion: ATTENTION_RULE_VERSION, timing: ATTENTION_TIMING, capturedAt: 1000, reason: 'eyes_unavailable', rawOutside: null, confirmedOutside: null, face: true, eyesOpen: false, eyeAspect: [.1, .3], head: [0, 0, 1], features: null, mappedGaze: null, phase: 'idle', awayMs: 0, returnMs: 0, lastReset: null },
    });
    await advance(2500);
    await engine.endSession();
    const log = store.useApp.getState().report!.log;
    expect(log.samples).toEqual([]);
    expect(log.gazeDiagnostics!.samples.some(s => s.reason === 'eyes_unavailable')).toBe(true);
    expect(log.gazeDiagnostics!.samples.at(-1)?.reason).toBe('stale_frame');
    expect(uploadedDiagnostics).toBeUndefined();
  });

  it('shows only new source observations and clears stalled evidence', async () => {
    Object.assign(registry.attention, { usesOffscreenRule: true });
    await engine.enterStudy();
    const emit = vi.mocked(registry.attention.onSample).mock.calls.at(-1)![0];
    const t = Date.now();
    const sample: FocusSample = {
      t, score: 0, confidence: 1, gazeTracking: { state: 'candidate', awayMs: 11_900, thresholdMs: 30_000 },
    };
    emit(sample);
    await advance(100);
    expect(store.useApp.getState().live.gazeTracking).toEqual(sample.gazeTracking);
    emit({ ...sample, gazeTracking: { ...sample.gazeTracking!, awayMs: 29_900 } });
    await advance(100);
    expect(store.useApp.getState().live.gazeTracking?.awayMs).toBe(11_900);
    emit({ ...sample, t: Date.now(), confidence: 0, gazeTracking: { ...sample.gazeTracking!, state: 'unknown' } });
    await advance(100);
    expect(store.useApp.getState().live.gazeTracking).toMatchObject({ state: 'unknown', awayMs: 11_900 });
    await advance(1200);
    expect(store.useApp.getState().live.gazeTracking).toMatchObject({ state: 'unknown', awayMs: 0 });
  });

  it('records the qualified gaze reason on the actual rescue', async () => {
    Object.assign(registry.attention, { usesOffscreenRule: true });
    await engine.enterStudy();
    const emit = vi.mocked(registry.attention.onSample).mock.calls.at(-1)![0];
    emit({ t: Date.now(), score: 0, confidence: 1, offscreenLapse: true });
    await advance(200);
    expect(store.useApp.getState().rescue).toMatchObject({ trigger: 'gaze', offscreen: true });
  });
});

describe('rescue', () => {
  it('does not count waiting for manual playback as clip time', async () => {
    await engine.enterStudy();
    engine.requestRecap();
    await advance(300);
    engine.playbackBlocked();
    await advance(10_000);
    engine.playbackStarted();
    await advance(2000);
    engine.clipEnded();
    engine.answerQuiz(0, 0);
    engine.finishRescue();
    await engine.endSession();
    expect(store.useApp.getState().report?.log.rescues[0].clipSeconds).toBe(2);
  });

  it('leaving a blocked recap does not record a clip that never played', async () => {
    await engine.enterStudy();
    engine.requestRecap();
    await advance(300);
    engine.playbackBlocked();
    engine.skipClip();
    expect(store.useApp.getState().rescue).toBeNull();
    await engine.endSession();
    expect(store.useApp.getState().report?.log.rescues).toEqual([]);
  });

  it('runs a manually requested recap without labelling it an attention lapse', async () => {
    await engine.enterStudy();
    engine.requestRecap();
    await advance(300);
    expect(store.useApp.getState().rescue?.context.trigger).toBe('manual');
    expect(store.useApp.getState().rescue?.phase).toBe('playing');
    expect(registry.content.getScript).toHaveBeenCalledTimes(1);
    expect(registry.media.renderMedia).toHaveBeenCalledTimes(1);
    expect(store.useApp.getState().live.lapsesBySlide).toEqual({});
    engine.clipEnded();
    engine.answerQuiz(0, 0);
    engine.finishRescue();
    await advance(5000);
    await engine.endSession();
    expect(store.useApp.getState().report?.log.rescues[0].timeToRefocusSec).toBeNull();
  });
  it('skipping a clip goes to the question, marked as skipped', async () => {
    await engine.enterStudy();
    await lapseByAppSwitch();
    h.doc.focused = true;
    await advance(300);
    expect(store.useApp.getState().rescue?.phase).toBe('playing');
    engine.skipClip();
    const r = store.useApp.getState().rescue;
    expect(r?.phase).toBe('quiz');
    expect(r?.skipped).toBe(true);
  });

  it('holds the rescue while the tab is hidden and starts it on return', async () => {
    await engine.enterStudy();
    Object.assign(h.doc, { hidden: true, visibilityState: 'hidden', focused: false });
    await advance(8000);
    expect(store.useApp.getState().rescue).toBeNull();
    expect(registry.adaptive.chooseVariant).not.toHaveBeenCalled();
    expect(h.doc.title).toContain('Come back');
    Object.assign(h.doc, { hidden: false, visibilityState: 'visible', focused: true });
    h.doc.fire('visibilitychange');
    await advance(300);
    expect(store.useApp.getState().rescue?.phase).toBe('playing');
  });

  it('Esc while the choice is pending does not count an unplayed recap', async () => {
    let choose!: (c: unknown) => void;
    vi.mocked(registry.adaptive.chooseVariant).mockImplementationOnce(() => new Promise((r) => (choose = r)) as never);
    await engine.enterStudy();
    await lapseByAppSwitch();
    h.doc.focused = true;
    expect(store.useApp.getState().rescue?.phase).toBe('loading');
    engine.skipClip();
    const { DEFAULT_VARIANT } = await import('../contracts/defaults');
    choose({ variant: DEFAULT_VARIANT, isHoldout: false, action: 'skip' });
    await flush();
    await engine.endSession();
    expect(store.useApp.getState().report?.log.rescues).toHaveLength(0);
  });

  it('time to refocus counts from the return to the slide, not from the lapse', async () => {
    await engine.enterStudy();
    await lapseByAppSwitch();
    h.doc.focused = true;
    await advance(300);
    engine.skipClip();
    await advance(10_000); // a long time on the question
    engine.finishRescue();
    // feed focused samples so the machine refocuses (4 s above threshold)
    const onSample = vi.mocked(registry.attention.onSample).mock.calls.at(-1)![0] as (s: { t: number; score: number; confidence: number }) => void;
    for (let i = 0; i < 60; i++) {
      onSample({ t: Date.now(), score: 90, confidence: 1 });
      await advance(100);
    }
    await engine.endSession();
    const ttr = store.useApp.getState().report?.log.rescues[0].timeToRefocusSec;
    expect(ttr).not.toBeNull();
    expect(ttr!).toBeLessThan(8);
  });
});

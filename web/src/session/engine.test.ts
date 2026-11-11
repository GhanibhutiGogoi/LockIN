/**
 * Engine lifecycle tests: camera, provider, break, end-of-session and rescue
 * flows from the review of PR #3. Runs in node with a minimal DOM stand-in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  store.useApp.setState({ camera: 'off', settings: { ...store.useApp.getState().settings, nudgeOnly: false } });
});

afterEach(async () => {
  if (engine.isRunning()) await engine.endSession();
  vi.useRealTimers();
});

/** Switch away from the window long enough for a window lapse (5 s by default). */
async function lapseByAppSwitch() {
  h.doc.focused = false;
  await advance(5600);
}

describe('session lifecycle', () => {
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

  it('keeps nudge-only when the personal-AI service is down', async () => {
    vi.mocked(registry.adaptive.getSessionConfig).mockRejectedValueOnce(new Error('down'));
    store.useApp.setState({ settings: { ...store.useApp.getState().settings, nudgeOnly: true } });
    await engine.enterStudy();
    await lapseByAppSwitch();
    expect(store.useApp.getState().rescue).toBeNull();
    expect(registry.adaptive.chooseVariant).not.toHaveBeenCalled();
  });
});

describe('rescue', () => {
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

  it('control arm: Esc while the choice is pending logs one outcome, not two', async () => {
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
    expect(store.useApp.getState().report?.log.rescues).toHaveLength(1);
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

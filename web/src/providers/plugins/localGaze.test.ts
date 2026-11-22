import { afterEach, expect, it, vi } from 'vitest';
import { LocalGazeProvider } from './localGaze';
import type { GazeObservation } from '../../../../gaze-demo/backend/static/gaze.js';

const capture = vi.hoisted(() => ({
  stop: vi.fn(),
  resume: vi.fn(),
  observe: undefined as ((observation: GazeObservation) => void) | undefined,
}));

vi.mock('../../../../gaze-demo/backend/static/gaze.js', () => ({
  GazeCapture: class {
    readonly ready = true;
    readonly calibrated = true;
    suspended = false;

    constructor(_video: HTMLVideoElement, private readonly status: (message: string) => void, options: { onObservation: (observation: GazeObservation) => void }) { capture.observe = options.onObservation; }
    async start() { this.status('ready'); }
    suspend() { this.suspended = true; return true; }
    resume = capture.resume;
    stop = capture.stop;
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('publishes sustained closure as non-focus and only restores focus after a stable screen return', async () => {
  vi.stubGlobal('document', { createElement: () => ({}) });
  vi.stubGlobal('location', { href: 'http://127.0.0.1:5180/' });
  const gaze = new LocalGazeProvider();
  const receive = vi.fn(); gaze.onSample(receive);
  await gaze.start({} as MediaStream);
  const observation: GazeObservation = {
    capturedAt: 1000,
    sample: { valid: true, calibrated: true, on_screen: false, x: null, y: null, eyes_open: false, reason: 'eyes_closed' },
    offscreen: { count: 0, state: 'candidate', away_ms: 5000, threshold_ms: 30000 },
  };
  capture.observe!(observation);
  expect(receive.mock.lastCall![0]).toMatchObject({ score: 0, confidence: 1, signals: { eyesOpen: 0, gaze: 0 }, gazeTracking: { reason: 'eyes_closed' } });
  expect(receive.mock.lastCall![0].gazePoint).toBeUndefined();
  observation.sample = { ...observation.sample, eyes_open: true, on_screen: true, reason: 'screen', x: 0, y: 0 };
  observation.offscreen.state = 'recovering'; observation.offscreen.return_ms = 300;
  capture.observe!(observation);
  expect(receive.mock.lastCall![0]).toMatchObject({ score: 0, confidence: 1, gazeTracking: { awayMs: 5000, returnMs: 300 } });
  observation.offscreen.state = 'screen'; observation.offscreen.away_ms = 0;
  capture.observe!(observation);
  expect(receive.mock.lastCall![0]).toMatchObject({ score: 100, confidence: 1 });
  observation.sample.valid = false; observation.offscreen.state = 'unknown';
  capture.observe!(observation);
  expect(receive.mock.lastCall![0].confidence).toBe(0);
  await gaze.stop();
});

it('disposes a retained worker when camera playback rejects on resume', async () => {
  vi.stubGlobal('document', { createElement: () => ({}) });
  vi.stubGlobal('location', { href: 'http://127.0.0.1:5180/' });
  const stream = {} as MediaStream;
  const gaze = new LocalGazeProvider();
  await gaze.start(stream);
  expect(gaze.suspend()).toBe(true);
  capture.resume.mockRejectedValueOnce(new Error('camera playback failed'));

  await expect(gaze.start(stream)).rejects.toThrow('camera playback failed');
  expect(capture.stop).toHaveBeenCalledOnce();
  expect(gaze.needsCalibration).toBe(true);
});

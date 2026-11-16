import { afterEach, expect, it, vi } from 'vitest';
import { LocalGazeProvider } from './localGaze';

const capture = vi.hoisted(() => ({
  stop: vi.fn(),
  resume: vi.fn(),
}));

vi.mock('../../../../gaze-demo/backend/static/gaze.js', () => ({
  GazeCapture: class {
    readonly ready = true;
    readonly calibrated = true;
    suspended = false;

    constructor(_video: HTMLVideoElement, private readonly status: (message: string) => void) {}
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

import { afterEach, expect, it, vi } from 'vitest';
import { GazeCapture } from '../../../gaze-demo/backend/static/gaze.js';
import { changedGeometry, coversScreen, readCalibrationGeometry } from '../../../gaze-demo/backend/static/calibration-geometry.js';

function setup(space: 'screen' | 'viewport' = 'screen') {
  const window = { innerWidth: 1707, innerHeight: 1067, screenX: 7, screenY: 7, devicePixelRatio: 1.5,
    screen: { width: 1707, height: 1067, availLeft: 0, availTop: 0 } };
  const document = { fullscreenElement: {} as object | null };
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  const capture = Object.assign(Object.create(GazeCapture.prototype), {
    calibrationGeometry: readCalibrationGeometry(), calibrationSpace: space,
    calibrated: true, phase: 'idle', status: vi.fn(), cancel: vi.fn(),
  });
  return { window, document, capture };
}

afterEach(() => vi.unstubAllGlobals());

it('keeps the actual capture calibrated after leaving fullscreen, moving and resizing the browser', () => {
  const { window, document, capture } = setup();
  const anchor = capture.calibrationGeometry;
  window.innerWidth = 1200; window.innerHeight = 700; window.screenX = 100; window.screenY = 80;
  document.fullscreenElement = null;
  capture.checkViewport();
  expect(capture.calibrated).toBe(true);
  expect(capture.cancel).not.toHaveBeenCalled();
  expect(capture.calibrationGeometry).toBe(anchor);
  expect(changedGeometry(anchor, readCalibrationGeometry())).toContain('fullscreen');
});

it('still invalidates window-relative calibration and changes while collecting calibration points', () => {
  for (const space of ['screen', 'viewport'] as const) {
    const { window, capture } = setup(space);
    if (space === 'screen') capture.phase = 'validation';
    window.innerWidth = 1200;
    capture.checkViewport();
    expect(capture.calibrated).toBe(false);
    expect(capture.calibrationIssue).toBe('viewport_changed');
  }
});

it('invalidates changed display dimensions, scale and same-sized monitor origin', () => {
  for (const change of ['resolution', 'scale', 'origin']) {
    const { window, capture } = setup();
    if (change === 'resolution') window.screen.width = 1920;
    if (change === 'scale') window.devicePixelRatio = 1;
    if (change === 'origin') window.screen.availLeft = 1707;
    capture.checkViewport();
    expect(capture.calibrated).toBe(false);
  }
});

it('refuses quick validation dots in a different viewport and does not treat maximization as full-screen calibration', () => {
  const { window, capture } = setup();
  capture.canRecheck = true; capture.ready = true; capture.cameraLive = () => true;
  expect(coversScreen(readCalibrationGeometry())).toBe(true);
  window.innerHeight -= 100;
  expect(coversScreen(readCalibrationGeometry())).toBe(false);
  expect(capture.revalidate()).toBe(false);
});

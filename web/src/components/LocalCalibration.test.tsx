// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { AttentionProvider, CalibrationTarget } from '../contracts/providers';
import { LocalCalibration } from './LocalCalibration';
import { DriftGlow } from './DriftGlow';
import { emptyLive, useApp } from '../store';

vi.mock('../session/engine', () => ({ ensureCamera: async () => 'on', ensureAttention: async () => {}, stopCalibrationCamera: async () => {}, stopProvider: async () => {} }));
vi.mock('../lib/calibrationDiagnostics', () => ({ startCalibrationDiagnostic: () => ({ point() {}, finish: async () => 'queued' }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const host = document.createElement('div');
let root: ReturnType<typeof createRoot>;
afterEach(async () => { await act(async () => root?.unmount()); vi.useRealTimers(); vi.restoreAllMocks(); });

it('keeps separate start buttons and a static target while samples are collected', async () => {
  let show!: (target: CalibrationTarget | null) => void;
  const target: CalibrationTarget = { x: .08, y: .1, index: 1, total: 9, validation: false, count: 0, awaitingStart: true };
  const provider = {
    prepareCalibration() {},
    calibrate(callback: typeof show, signal: AbortSignal) {
      show = callback; show(target);
      return new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
    },
    startCalibrationStage: vi.fn(() => show({ ...target, awaitingStart: false })),
  } as unknown as AttentionProvider;
  root = createRoot(host);
  await act(async () => root.render(<LocalCalibration provider={provider} />));
  expect(host.textContent).toContain('Start calibration');
  expect(host.querySelector('[role="img"]')).toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('.btn-primary')!.click());
  expect(host.textContent).not.toContain('Start calibration');
  const dot = host.querySelector('[role="img"]');
  expect(dot).not.toBeNull();
  const appearance = dot!.outerHTML;
  for (const count of [1, 4, 7]) {
    await act(async () => show({ ...target, awaitingStart: false, count }));
    expect(host.querySelector('[role="img"]')?.outerHTML).toBe(appearance);
    expect(host.querySelector('[role="progressbar"]')).toBeNull();
  }
  await act(async () => show({ ...target, awaitingStart: false, index: 2, x: .5, count: 0 }));
  expect(host.querySelector<HTMLElement>('[role="img"]')?.style.left).toBe('50%');
  await act(async () => show({ ...target, validation: true, total: 3 }));
  expect(host.textContent).toContain('Start validation');
  expect(host.querySelector('[role="img"]')).toBeNull();
  expect(provider.startCalibrationStage).toHaveBeenCalledTimes(1);
  await act(async () => host.querySelector<HTMLButtonElement>('.btn-primary')!.click());
  expect(provider.startCalibrationStage).toHaveBeenCalledTimes(2);
});

it('removes gaze glow on the first screen return without changing recovery state', async () => {
  root = createRoot(host);
  const live = { ...emptyLive(), state: 'recovering' as const, gazeTracking: { state: 'away' as const, awayMs: 30000, thresholdMs: 30000 } };
  useApp.setState({ live });
  await act(async () => root.render(<DriftGlow />));
  expect(host.firstElementChild?.getAttribute('data-on')).toBe('true');
  for (const state of ['recovering', 'screen', 'unknown'] as const) {
    await act(async () => useApp.setState({ live: { ...live, gazeTracking: { ...live.gazeTracking, state } } }));
    expect(host.firstElementChild?.getAttribute('data-on')).toBe('false');
    expect(useApp.getState().live.state).toBe('recovering');
  }
});

// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { RecoveryStatus } from './RecoveryStatus';
import { emptyLive, useApp } from '../store';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const host = document.createElement('div');
let root: ReturnType<typeof createRoot>;
afterEach(async () => { await act(async () => root?.unmount()); });

it('explains why recovery is waiting and only shows progress while confirming study', async () => {
  root = createRoot(host);
  const live = { ...emptyLive(), state: 'recovering' as const };
  useApp.setState({ live: { ...live, recoveryWait: 'study-window' } });
  await act(async () => root.render(<RecoveryStatus />));
  expect(host.textContent).toContain('Open your shared study window');
  expect(host.querySelector('[role="progressbar"]')).toBeNull();
  await act(async () => useApp.setState({ live: { ...live, recoveryWait: 'tracking' } }));
  expect(host.textContent).toContain('Waiting for fresh gaze');
  await act(async () => useApp.setState({ live: { ...live, recoveryWait: 'off-topic' } }));
  expect(host.textContent).toContain('related to your study goal');
  await act(async () => useApp.setState({ live: { ...live, recoverProgress: .5 } }));
  expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('50');
  await act(async () => useApp.setState({ live: { ...live, state: 'focused' } }));
  expect(host.textContent).toBe('');
});

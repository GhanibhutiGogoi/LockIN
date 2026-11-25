// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { LookingAwaySetting } from './LookingAwaySetting';
import { actions, useApp } from '../store';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('validates user input, saves on Apply and restores the duration after reloading the store', async () => {
  localStorage.clear();
  actions.setSettings({ lookingAwaySec: 30 });
  const host = document.createElement('div');
  const root = createRoot(host);
  document.body.append(host);
  try {
    await act(async () => root.render(<LookingAwaySetting />));
    const input = host.querySelector('input')!;
    const button = host.querySelector('button')!;
    const enter = async (value: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    expect(input.value).toBe('30');
    for (const value of ['', '0', '301', '12.5']) {
      await enter(value);
      expect(button.disabled).toBe(true);
      expect(useApp.getState().settings.lookingAwaySec).toBe(30);
    }
    await enter('10');
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(host.textContent).toContain('Current duration: 10 seconds.');
    expect(JSON.parse(localStorage.getItem('lockin.settings')!).lookingAwaySec).toBe(10);
    vi.resetModules();
    const restored = await import('../store');
    expect(restored.useApp.getState().settings.lookingAwaySec).toBe(10);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    localStorage.clear();
  }
});

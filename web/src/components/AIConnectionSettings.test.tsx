// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AIConnectionSettings } from './AIConnectionSettings';
import { registry } from '../providers/registry';
import { savedAIConnection } from '../providers/connection';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  registry.reset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  registry.reset();
  vi.unstubAllGlobals();
});

async function submit(url: string) {
  const input = host.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, url);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
}

function backend(scripts: boolean) {
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
    const body = url.pathname.endsWith('healthz') ? { service: 'lockin-media', api_version: 1, mode: 'real', capabilities: { scripts } }
      : url.pathname.endsWith('readyz') ? { ready: true, mode: 'real' }
      : url.pathname.endsWith('voices') ? [{ id: 'hype' }, { id: 'chill' }] : [];
    return new Response(JSON.stringify(body));
  }));
}

it('connects both providers through one URL, persists the choice and disconnects', async () => {
  backend(true);
  await act(async () => root.render(<AIConnectionSettings />));
  await submit('https://gpu.example/media-api');
  expect(host.textContent).toContain('Connection saved');
  expect(host.textContent).toContain('No video clips published');
  expect(registry.canRecap()).toBe(true);
  expect(registry.config.media.url).toBe('https://gpu.example/media-api/');
  expect(registry.config.content.url).toBe(registry.config.media.url);
  expect(registry.config.content.deckImport).toBe(false);
  expect(savedAIConnection().media).toEqual(registry.config.media);
  await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Disconnect')!.click());
  expect(registry.canRecap()).toBe(false);
  expect(savedAIConnection().media?.mode).toBe('off');
});

it('keeps recaps unavailable if the media server has no script service', async () => {
  backend(false);
  await act(async () => root.render(<AIConnectionSettings />));
  await submit('http://127.0.0.1:8011');
  expect(host.textContent).toContain('still need the script service');
  expect(registry.config.media.mode).toBe('http');
  expect(registry.canRecap()).toBe(false);
});

it('leaves the existing connection intact when a replacement check fails', async () => {
  registry.setAI({ media: { mode: 'http', url: 'https://working.example/' }, content: { mode: 'http', url: 'https://working.example/', deckImport: false } });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ service: 'lockin-media', api_version: 1, mode: 'mock' }))));
  await act(async () => root.render(<AIConnectionSettings />));
  await submit('https://mock.example/');
  expect(host.querySelector('[role=alert]')?.textContent).toContain('mock mode');
  expect(registry.config.media.url).toBe('https://working.example/');
  expect(savedAIConnection().media?.url).toBe('https://working.example/');
});

/// <reference types="node" />
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { File as NodeFile } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { URL as NodeURL } from 'node:url';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { actions, useApp } from './store';
import { library } from './lib/library';
import { endSession, isRunning } from './session/engine';

// PDF rendering itself is checked in the browser. This test exercises the UI,
// actual ingestion orchestration, file storage and session engine together.
vi.mock('./lib/pdf', () => ({
  extractPages: vi.fn(async () => [
    { title: 'Uploaded first slide', text: 'The first slide has actual selectable text.' },
    { title: 'Uploaded second slide', text: 'The next slide also contains source material.' },
  ]),
  renderPage: vi.fn(async () => ({ width: 800, height: 450 })),
  cancelPageRender: vi.fn(),
  releasePdf: vi.fn(),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
vi.stubGlobal('crypto', webcrypto);
Object.defineProperty(URL, 'createObjectURL', { value: NodeURL.createObjectURL });
Object.defineProperty(URL, 'revokeObjectURL', { value: NodeURL.revokeObjectURL });
window.scrollTo = vi.fn();
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 800 });
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { get: () => 450 });
const host = document.createElement('div');
document.body.append(host);
const root = createRoot(host);

async function settle(check: () => boolean) {
  for (let i = 0; i < 60; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    if (check()) return;
  }
  throw new Error('UI did not reach the expected state: ' + host.textContent?.slice(-1000));
}
async function click(text: string) {
  const button = [...host.querySelectorAll('button')].find((el) => el.textContent?.trim() === text);
  expect(button, `Missing button: ${text}`).toBeDefined();
  await act(async () => button!.click());
}

afterEach(async () => {
  if (isRunning()) await act(async () => endSession());
  await act(async () => root.unmount());
});

it('uploads a real file object, studies, saves an honest report and restores the deck', async () => {
  await act(async () => root.render(<App />));
  await settle(() => useApp.getState().libraryReady);
  expect(host.textContent).not.toContain('Try the sample deck');
  expect(host.textContent).not.toContain('Example report');
  expect(host.textContent).toContain('AI recaps are not connected');

  const input = host.querySelector<HTMLInputElement>('input[type=file]')!;
  const file = new NodeFile(['%PDF-fixture for UI orchestration'], 'My real lecture.pdf', { type: 'application/pdf' });
  Object.defineProperty(input, 'files', { value: [file] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  await settle(() => useApp.getState().screen === 'study');
  await click('I agree, start studying');
  await settle(() => isRunning());
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Next slide (→)"]')!.click());
  expect(useApp.getState().slideIndex).toBe(1);
  await click('Finish');
  await click('See my report');
  await settle(() => useApp.getState().screen === 'report');
  expect(host.textContent).toContain('No attention measurements were available');
  expect(host.textContent).toContain('2 of 2 slides visited');
  expect(host.textContent).not.toContain('% locked in');
  expect((await library.reports()).length).toBe(1);
  await click('Your library');
  expect(host.textContent).toContain('Recent sessions');
  const [restored] = await library.decks();
  expect(restored.title).toBe('My real lecture');
  expect(await (await fetch(restored.pdfUrl!)).text()).toBe(await file.text());
  await act(async () => { useApp.setState({ decks: [restored] }); actions.openDeck(restored.id); actions.go('study'); });
  expect(useApp.getState().slideIndex).toBe(1);
  expect(host.querySelector('canvas[aria-label="Slide 2"]')).not.toBeNull();
  URL.revokeObjectURL(restored.pdfUrl!);
});

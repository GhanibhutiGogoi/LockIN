// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { StudyScreen } from './StudyScreen';
import { CONSENT_VERSION } from './ConsentScreen';
import { actions, useApp } from '../store';
import { registry } from '../providers/registry';
import { endSession, isRunning } from '../session/engine';

vi.mock('./SlideView', () => ({ SlideView: () => <div>Slide contents</div> }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('opening and paging a deck sends zero scripts; a recap sends only the requested slide', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  // Use the actual HTTP providers, pack cache and session engine.
  const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response('{}', { status: 503 }));
  const scriptRequests = () => fetcher.mock.calls.filter(([url]) => url.endsWith('/scripts'));
  vi.stubGlobal('fetch', fetcher);
  window.scrollTo = vi.fn();
  registry.setAI({ content: { mode: 'http', url: 'https://ai.example/' }, media: { mode: 'http', url: 'https://ai.example/' } });
  actions.addDeck({ id: 'private-pdf', title: 'Private PDF', sourceType: 'pdf', slideCount: 4,
    slides: Array.from({ length: 4 }, (_, index) => ({ index, title: `Page ${index + 1}`, text: `Private text for page ${index + 1}` })) });
  useApp.setState({ consent: CONSENT_VERSION });
  try {
    await act(async () => root.render(<StudyScreen />));
    expect(isRunning()).toBe(true);
    expect(scriptRequests()).toHaveLength(0);
    expect(fetcher.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
    for (let i = 0; i < 2; i++) {
      await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Next slide (→)"]')!.click());
    }
    expect(useApp.getState().slideIndex).toBe(2);
    expect(scriptRequests()).toHaveLength(0);
    expect(fetcher.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
    await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Recap slide')!.click());
    const requests = scriptRequests();
    expect(requests).toHaveLength(1);
    const sent = JSON.parse(requests[0][1].body as string);
    expect(sent.slide_index).toBe(2);
    expect(sent.slide.text).toBe('Private text for page 3');
  } finally {
    await act(async () => { if (isRunning()) await endSession(); root.unmount(); });
    registry.reset();
    vi.unstubAllGlobals();
    host.remove();
  }
});

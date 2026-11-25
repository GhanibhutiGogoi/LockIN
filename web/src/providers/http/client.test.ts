import { afterEach, expect, it, vi } from 'vitest';
import { call } from './client';
import { devlog } from '../../lib/devlog';

afterEach(() => vi.unstubAllGlobals());

it('aborts an in-flight HTTP request without putting cancellation state in its JSON', async () => {
  let transport!: AbortSignal;
  vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
    expect(JSON.parse(init.body as string)).toEqual({ slide_index: 0 });
    transport = init.signal as AbortSignal;
    return new Promise((_resolve, reject) => transport.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
  }));
  const controller = new AbortController();
  const request = call('https://api.example/', '/scripts', { body: { slideIndex: 0 }, signal: controller.signal });
  const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await rejected;
  expect(transport.aborted).toBe(true);
});

it('keeps cancellation wired while the response body is still downloading', async () => {
  let downloading!: () => void;
  const bodyStarted = new Promise<void>((resolve) => { downloading = resolve; });
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => ({
    ok: true, status: 200, headers: new Headers(),
    text: () => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      downloading();
    }),
  })));
  const controller = new AbortController();
  const request = call('https://api.example/', '/media', { signal: controller.signal });
  const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
  await bodyStarted;
  controller.abort();
  await rejected;
});

it('records server stage timings with a request identifier', async () => {
  devlog.clear();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { headers: {
    'Server-Timing': 'llm;dur=123,script_total;dur=140', 'X-Request-ID': 'trace-1',
  } })));
  await call('https://api.example/', '/scripts', { body: {} });
  expect(devlog.get().at(-1)).toMatchObject({ team: 'content', detail: {
    requestId: 'trace-1', timing: 'llm;dur=123,script_total;dur=140',
  } });
});

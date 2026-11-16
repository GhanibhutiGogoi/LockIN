import { afterEach, expect, it, vi } from 'vitest';
import { call } from './client';

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
    ok: true, status: 200,
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

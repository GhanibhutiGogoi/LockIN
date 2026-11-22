import { afterEach, expect, it, vi } from 'vitest';
import { ScreenProcessor } from './processor';
import { ScreenTimeline } from './timeline';

afterEach(() => vi.unstubAllGlobals());

it('retains delayed results on their scene, preserves OCR boxes and classifies against the goal', async () => {
  const fetcher = vi.fn(async (url: string, _init?: RequestInit) => new Response(JSON.stringify(url.endsWith('/status') ? { status: 'ready' }
    : url.endsWith('/text') ? { lines: ['Data mining'], blocks: [{ text: 'Data mining', confidence: .9, polygon: [[0, 0], [100, 0], [100, 50], [0, 50]] }], image: { width: 100, height: 50 } }
    : { label: 'related' })));
  vi.stubGlobal('fetch', fetcher);
  const timeline = new ScreenTimeline(1000, 'Data mining');
  const first = timeline.observe(1000, true, 100, 50, 'monitor');
  const processor = new ScreenProcessor(timeline, vi.fn());
  processor.enqueue(first, new Blob(['image']));
  timeline.observe(3000, true, 100, 50, 'monitor');
  await processor.finish();
  expect(first).toMatchObject({ timestamp: 1000, status: 'ready', label: 'related', blocks: [{ text: 'Data mining' }] });
  expect(timeline.current?.status).toBe('pending');
  expect(JSON.parse(fetcher.mock.calls[2][1]!.body as string)).toEqual({ goal: 'Data mining', text: 'Data mining' });
});

it('bounds pending screenshots and explicitly marks superseded scenes', async () => {
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/status')) { await wait; return new Response('{"status":"ready"}'); }
    return new Response('{"lines":["Study text"]}');
  }));
  const timeline = new ScreenTimeline(0, '');
  const processor = new ScreenProcessor(timeline, vi.fn());
  const scenes = [0, 1000, 2000, 3000, 4000, 5000, 6000].map(timestamp => {
    const scene = timeline.observe(timestamp, true, 100, 50, 'monitor');
    processor.enqueue(scene, new Blob(['image']));
    return scene;
  });
  expect(scenes.slice(1, 3).map(s => s.status)).toEqual(['skipped', 'skipped']);
  release(); await processor.finish();
  expect([scenes[0], ...scenes.slice(3)].every(s => s.status === 'ready')).toBe(true);
});

it('retains a longer study visit when transient screens fill the queue', async () => {
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/status')) { await wait; return new Response('{"status":"ready"}'); }
    return new Response('{"lines":["A retained study page"]}');
  }));
  const timeline = new ScreenTimeline(0, '');
  const processor = new ScreenProcessor(timeline, vi.fn());
  const scenes = [0, 1000, 2000, 12000, 13000, 14000, 15000].map(timestamp => {
    const current = timeline.observe(timestamp, true, 100, 50, 'monitor');
    if (timestamp === 2000) current.observedUntil = 11900;
    processor.enqueue(current, new Blob(['image']));
    return current;
  });
  expect(scenes[2].status).toBe('pending');
  release(); await processor.finish();
  expect(scenes[2].status).toBe('ready');
  expect(scenes.at(-1)!.status).toBe('ready');
});

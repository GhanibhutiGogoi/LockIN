import { afterEach, expect, it, vi } from 'vitest';
import { ScreenProcessor } from './processor';
import { ScreenTimeline } from './timeline';

afterEach(() => vi.unstubAllGlobals());

it('prioritizes the current page and defers historical work until the report', async () => {
  let releaseOcr!: () => void, releaseLabel!: () => void;
  const ocrWait = new Promise<void>(resolve => { releaseOcr = resolve; });
  const labelWait = new Promise<void>(resolve => { releaseLabel = resolve; });
  let ocrCount = 0, labelCount = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/status')) return new Response('{"status":"ready"}');
    if (url.endsWith('/text')) {
      if (++ocrCount === 1) await ocrWait;
      return new Response('{"lines":["Substantive learning content"]}');
    }
    if (++labelCount === 1) await labelWait;
    return new Response('{"label":"off-topic"}');
  }));
  const timeline = new ScreenTimeline(0, 'Data mining');
  const completed: number[] = [];
  const processor = new ScreenProcessor(timeline, scene => {
    if (scene.status === 'ready' && !completed.includes(scene.id)) completed.push(scene.id);
  });
  const first = timeline.observe(0, true, 100, 50, 'monitor'); processor.enqueue(first, new Blob());
  await vi.waitFor(() => expect(ocrCount).toBe(1));
  const old = timeline.observe(1000, true, 100, 50, 'monitor'); processor.enqueue(old, new Blob());
  const current = timeline.observe(2000, true, 100, 50, 'monitor'); processor.enqueue(current, new Blob());
  // The current page gets OCR; obsolete pages cannot consume the live workers.
  releaseOcr();
  await vi.waitFor(() => { expect(current.status).toBe('ready'); expect(ocrCount).toBe(2); });
  expect(completed).toEqual([first.id, current.id]);
  expect(old.status).toBe('pending');
  expect(labelCount).toBe(1);
  expect(first.label).toBe('checking');
  releaseLabel(); await processor.finish();
  expect(completed).toEqual([first.id, current.id, old.id]);
  expect([first, old, current].every(scene => scene.label === 'off-topic')).toBe(true);
  expect(current.classificationStartedAt).toBeDefined();
});

it('starts the next live page immediately while keeping obsolete OCR out of its way', async () => {
  const textRequests: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/status')) return new Response('{"status":"ready"}');
    if (url.endsWith('/text')) {
      textRequests.push(await (init!.body as Blob).text());
      return new Response('{"lines":["Substantive body text for classification"]}');
    }
    return new Response('{"label":"off-topic"}');
  }));
  const timeline = new ScreenTimeline(0, 'Data mining');
  const processor = new ScreenProcessor(timeline, vi.fn());
  Object.assign(timeline.observe(0, true, 100, 50, 'monitor'), { status: 'ready', label: 'related' });
  const old = timeline.observe(0, true, 100, 50, 'monitor');
  const current = timeline.observe(1000, true, 100, 50, 'monitor');
  processor.enqueue(old, new Blob(['old']));
  processor.enqueue(current, new Blob(['current']));
  await vi.waitFor(() => expect(current.label).toBe('off-topic'));
  expect(textRequests).toEqual(['current']);
  const next = timeline.observe(2000, true, 100, 50, 'monitor');
  processor.enqueue(next, new Blob(['next']));
  await vi.waitFor(() => expect(next.label).toBe('off-topic'));
  expect(textRequests).toEqual(['current', 'next']);
  // finish must also drain queues when both workers were idle at session end.
  await processor.finish();
  expect(textRequests).toEqual(['current', 'next', 'old']);
});

it('recovers a previously seen lesson when the current off-topic page has no recap source yet', async () => {
  const ocrOrder: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/status')) return new Response('{"status":"ready"}');
    if (url.endsWith('/text')) {
      const text = await (init!.body as Blob).text();
      ocrOrder.push(text);
      return new Response(JSON.stringify({ lines: [text] }));
    }
    const text = JSON.parse(init!.body as string).text;
    return new Response(JSON.stringify(text === 'lesson'
      ? { label: 'related', studyText: 'Outliers are unusual observations.' } : { label: 'off-topic' }));
  }));
  const timeline = new ScreenTimeline(0, 'Data mining');
  const processor = new ScreenProcessor(timeline, vi.fn());
  const lesson = timeline.observe(0, true, 100, 50, 'monitor');
  const email = timeline.observe(1000, true, 100, 50, 'monitor');
  processor.enqueue(lesson, new Blob(['lesson']));
  processor.enqueue(email, new Blob(['email']));
  await vi.waitFor(() => expect(lesson.label).toBe('related'));
  expect(email.label).toBe('off-topic');
  expect(ocrOrder).toEqual(['email', 'lesson']);
  expect(lesson.studyText).toContain('Outliers');
  await processor.finish();
});

it('retries failed relevance on the same scene without repeating successful OCR', async () => {
  let ocrCalls = 0, labelCalls = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/status')) return new Response('{"status":"ready"}');
    if (url.endsWith('/text')) {
      ocrCalls++;
      return new Response('{"lines":["A lecture about fluid flow control"]}');
    }
    return new Response(JSON.stringify({ label: ++labelCalls === 1 ? 'unavailable' : 'off-topic' }));
  }));
  const timeline = new ScreenTimeline(0, 'Data mining');
  const scene = timeline.observe(0, true, 100, 50, 'monitor');
  const processor = new ScreenProcessor(timeline, vi.fn());
  processor.enqueue(scene, new Blob());
  await vi.waitFor(() => expect(scene.label).toBe('unavailable'));
  processor.retryClassification(scene);
  processor.retryClassification(scene); // Duplicate ticks cannot enqueue another retry.
  await vi.waitFor(() => expect(scene.label).toBe('off-topic'));
  expect(ocrCalls).toBe(1);
  expect(labelCalls).toBe(2);
  expect(timeline.scenes).toEqual([scene]);
  await processor.finish();
});

it('retains delayed results on their scene, preserves OCR boxes and classifies against the goal', async () => {
  const fetcher = vi.fn(async (url: string, _init?: RequestInit) => new Response(JSON.stringify(url.endsWith('/status') ? { status: 'ready' }
    : url.endsWith('/text') ? { lines: ['Data mining'], blocks: [{ text: 'Data mining', confidence: .9, polygon: [[0, 0], [100, 0], [100, 50], [0, 50]] }], image: { width: 100, height: 50 } }
    : { label: 'related', contentFilter: { method: 'ocr-layout', excludedBlocks: 0 } })));
  vi.stubGlobal('fetch', fetcher);
  const timeline = new ScreenTimeline(1000, 'Data mining');
  const first = timeline.observe(1000, true, 100, 50, 'monitor');
  const processor = new ScreenProcessor(timeline, vi.fn());
  processor.enqueue(first, new Blob(['image']));
  timeline.observe(3000, true, 100, 50, 'monitor');
  await processor.finish();
  expect(first).toMatchObject({ timestamp: 1000, status: 'ready', label: 'related', blocks: [{ text: 'Data mining' }] });
  expect(timeline.current?.status).toBe('pending');
  expect(JSON.parse(fetcher.mock.calls[2][1]!.body as string)).toEqual({ goal: 'Data mining', text: 'Data mining',
    blocks: first.blocks, image: { width: 100, height: 50 } });
  expect(first.classification?.contentFilter).toEqual({ method: 'ocr-layout', excludedBlocks: 0 });
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

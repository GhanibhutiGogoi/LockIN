import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentProvider, MediaProvider } from '../contracts/providers';
import { DEFAULT_VARIANT } from '../contracts/defaults';
import type { Deck, RescueMedia, RescueScript } from '../contracts/types';
import { registry } from '../providers/registry';
import { clearPacks, getPack } from './packs';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const deck: Deck = { id: 'lecture', title: 'Lecture', sourceType: 'pdf', slideCount: 1, slides: [{ index: 0, title: 'First', text: 'Actual source text.' }] };
const script = (id: string): RescueScript => ({ variant: DEFAULT_VARIANT, hook: id, script: 'Explanation', keyTerms: [], quiz: [], plainSummary: 'Summary' });
const media = (id: string): RescueMedia => ({ audioUrl: `https://${id}.example/narration.mp3`, durationSec: 1, captions: [], broll: [] });
function providers(id: string) {
  return {
    content: { name: id, getScript: vi.fn(async () => script(id)) } as unknown as ContentProvider,
    media: { name: id, renderMedia: vi.fn(async () => media(id)) } as unknown as MediaProvider,
  };
}
let current: ReturnType<typeof providers>;
function switchTo(next: ReturnType<typeof providers>) {
  current = next;
  // Exercise the registry's real cache-invalidation subscription.
  registry.setAI({ media: { mode: 'http', url: `https://${next.media.name}.example/` }, content: { mode: 'http', url: `https://${next.content.name}.example/` } });
}
const request = () => getPack(deck, 0, DEFAULT_VARIANT, 1);

beforeEach(() => {
  clearPacks();
  current = providers('a');
  vi.spyOn(registry, 'content', 'get').mockImplementation(() => current.content);
  vi.spyOn(registry, 'media', 'get').mockImplementation(() => current.media);
});
afterEach(() => { clearPacks(); vi.restoreAllMocks(); registry.reset(); });

it('keys compiled recaps by gameplay, pacing and memory context', async () => {
  current.media = { ...current.media, compiled: true };
  const get = (variant = DEFAULT_VARIANT, memo = 'plain') => getPack(deck, 0, variant, 1, memo);

  await get();
  await get({ ...DEFAULT_VARIANT, gameplayType: 'parkour' });
  await get({ ...DEFAULT_VARIANT, pacing: 0.9 });
  await get(DEFAULT_VARIANT, 'analogy');
  await get();

  expect(current.content.getScript).toHaveBeenCalledTimes(4);
  expect(current.media.renderMedia).toHaveBeenCalledTimes(4);
});

describe('pending packs on connection changes', () => {
  it('does not send a late script from A to B or contaminate B’s cached pack', async () => {
    const a = current;
    const waiting = deferred<RescueScript>();
    vi.mocked(a.content.getScript).mockReturnValueOnce(waiting.promise);
    const stale = request();
    const rejected = expect(stale).rejects.toThrow('connection changed');
    const signal = vi.mocked(a.content.getScript).mock.calls[0][1]!.signal!;
    const b = providers('b');
    switchTo(b);
    expect(signal.aborted).toBe(true);
    const fresh = await request();
    waiting.resolve(script('a')); // deliberately ignores AbortSignal
    await rejected;
    expect(a.media.renderMedia).not.toHaveBeenCalled();
    expect(b.media.renderMedia).toHaveBeenCalledTimes(1);
    expect(vi.mocked(b.media.renderMedia).mock.calls[0][0].script.hook).toBe('b');
    expect(fresh.script.hook).toBe('b');
    expect(fresh.media.audioUrl).toBe(media('b').audioUrl);
    expect(await request()).toEqual(fresh);
    expect(b.content.getScript).toHaveBeenCalledTimes(1);
    expect(b.media.renderMedia).toHaveBeenCalledTimes(1);
  });

  it('rejects media completing after a switch, even when the old provider ignores cancellation', async () => {
    const a = current;
    const waiting = deferred<RescueMedia>();
    vi.mocked(a.media.renderMedia).mockReturnValueOnce(waiting.promise);
    const stale = request();
    const rejected = expect(stale).rejects.toThrow('connection changed');
    await Promise.resolve();
    expect(a.media.renderMedia).toHaveBeenCalledTimes(1);
    const signal = vi.mocked(a.media.renderMedia).mock.calls[0][1]!.signal!;
    const b = providers('b');
    switchTo(b);
    expect(signal.aborted).toBe(true);
    const fresh = await request();
    waiting.resolve(media('a'));
    await rejected;
    expect(await request()).toEqual(fresh);
    expect(fresh.media.audioUrl).toBe(media('b').audioUrl);
    expect(b.media.renderMedia).toHaveBeenCalledTimes(1);
  });

  it('a rejected old request cannot evict a new request with the same cache key', async () => {
    const a = deferred<RescueScript>();
    const b = deferred<RescueScript>();
    vi.mocked(current.content.getScript).mockReturnValueOnce(a.promise);
    const stale = request();
    const rejected = expect(stale).rejects.toThrow('old failure');
    const next = providers('b');
    vi.mocked(next.content.getScript).mockReturnValueOnce(b.promise);
    switchTo(next);
    const fresh = request();
    a.reject(new Error('old failure'));
    await rejected;
    const repeated = request();
    expect(next.content.getScript).toHaveBeenCalledTimes(1);
    b.resolve(script('b'));
    expect(await repeated).toEqual(await fresh);
    expect(next.media.renderMedia).toHaveBeenCalledTimes(1);
  });
});

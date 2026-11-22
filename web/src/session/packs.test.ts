import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VARIANT } from '../contracts/defaults';
import { clearPacks, getPack, mediaKey, scriptKey } from './packs';
import { registry } from '../providers/registry';
import { NoMediaProvider, LocalContentProvider } from '../providers/local';
import { DEMO_DECK } from '../lib/demoDeck';

afterEach(() => { vi.restoreAllMocks(); clearPacks(); });

it('invalidates compiled video for gameplay, pacing, and memory context changes', async () => {
  const content = new LocalContentProvider();
  const getScript = vi.spyOn(content, 'getScript').mockResolvedValue({} as never);
  const provider = Object.assign(new NoMediaProvider(), { compiled: true });
  const render = vi.spyOn(provider, 'renderMedia').mockResolvedValue({} as never);
  vi.spyOn(registry, 'content', 'get').mockReturnValue(content);
  vi.spyOn(registry, 'media', 'get').mockReturnValue(provider);
  await getPack(DEMO_DECK, 0, DEFAULT_VARIANT, 1, 'first');
  await getPack(DEMO_DECK, 0, DEFAULT_VARIANT, 1, 'first');
  expect(render).toHaveBeenCalledTimes(1);
  await getPack(DEMO_DECK, 0, { ...DEFAULT_VARIANT, gameplayType: 'marble' }, 1, 'first');
  await getPack(DEMO_DECK, 0, { ...DEFAULT_VARIANT, pacing: 0.9 }, 1, 'first');
  await getPack(DEMO_DECK, 0, DEFAULT_VARIANT, 1, 'second');
  expect(getScript).toHaveBeenCalledTimes(4);
  expect(render).toHaveBeenCalledTimes(4);
});

describe('pack cache keys', () => {
  it('keeps scripts and media keyed by the current memory context', () => {
    expect(scriptKey('d', 1, DEFAULT_VARIANT, 1, 'analogy')).not.toBe(scriptKey('d', 1, DEFAULT_VARIANT, 1, 'plain'));
    expect(mediaKey('d', 1, DEFAULT_VARIANT, 1, 'analogy')).not.toBe(mediaKey('d', 1, DEFAULT_VARIANT, 1, 'plain'));
  });
  it('a different voice or pacing gets its own media', () => {
    const a = mediaKey('d', 1, DEFAULT_VARIANT, 1);
    expect(mediaKey('d', 1, { ...DEFAULT_VARIANT, voiceId: 'chill' }, 1)).not.toBe(a);
    expect(mediaKey('d', 1, { ...DEFAULT_VARIANT, pacing: 0.9 }, 1)).not.toBe(a);
  });
  it('recap vs preview gets its own script', () => {
    expect(scriptKey('d', 1, { ...DEFAULT_VARIANT, recapOrPreview: 'preview' }, 1)).not.toBe(scriptKey('d', 1, DEFAULT_VARIANT, 1));
  });
  it('gameplay is composed live, so it shares the pack', () => {
    expect(mediaKey('d', 1, { ...DEFAULT_VARIANT, gameplayType: 'marble' }, 1)).toBe(mediaKey('d', 1, DEFAULT_VARIANT, 1));
  });
});

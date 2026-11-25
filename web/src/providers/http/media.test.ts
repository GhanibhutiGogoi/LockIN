import { afterEach, expect, it, vi } from 'vitest';
import { HttpMediaProvider } from './index';
import { DEFAULT_VARIANT } from '../../contracts/defaults';

afterEach(() => vi.unstubAllGlobals());
it('requests live narration and resolves all layer URLs for a connected studio', async () => {
  const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({
    audio_url: 'live/abc/voice.mp3', duration_sec: 2, provenance: { mode: 'real' },
    captions: [{ word: 'Hello', start: 0, end: 1 }, { word: 'World', start: 1, end: 2 }],
    broll: [], live: { gameplay: { id: 'g', url: 'library/assets/gameplay/g' },
      music: { id: 'm', url: 'library/assets/music/m' } },
  })));
  vi.stubGlobal('fetch', fetcher);
  const provider = new HttpMediaProvider('http://localhost:8013/', 'http://voice.example/');
  const media = await provider.renderMedia({ deckId: 'd', slideIndex: 0, variant: DEFAULT_VARIANT,
    script: { variant: DEFAULT_VARIANT, hook: 'Hello', script: 'World', plainSummary: 'Hello', keyTerms: [], quiz: [] } });
  expect(fetcher.mock.calls[0][0]).toBe('http://localhost:8013/media/live');
  expect(media.audioUrl).toBe('http://localhost:8013/live/abc/voice.mp3');
  expect(media.live?.gameplay.url).toBe('http://localhost:8013/library/assets/gameplay/g');
  expect(media.live?.music.url).toBe('http://localhost:8013/library/assets/music/m');
  expect(media.videoUrl).toBeUndefined();
});

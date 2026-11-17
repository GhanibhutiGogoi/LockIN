import { describe, expect, it } from 'vitest';
import { DEFAULT_VARIANT } from '../contracts/defaults';
import { mediaKey, scriptKey } from './packs';

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

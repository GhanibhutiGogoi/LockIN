import { describe, expect, it } from 'vitest';
import { DEFAULT_VARIANT } from './defaults';
import { checkChoice, checkMedia } from './validate';

describe('checkChoice', () => {
  it('rejects a variant without quiz_count', () => {
    const { quizCount: _, ...partial } = DEFAULT_VARIANT;
    expect(checkChoice({ variant: partial as never, isHoldout: false }).join()).toMatch(/quizCount/);
  });
  it('accepts a full variant', () => {
    expect(checkChoice({ variant: DEFAULT_VARIANT, isHoldout: false })).toEqual([]);
  });
});

describe('checkMedia', () => {
  const cap = (word: string, start: number) => ({ word, start, end: start + 0.2 });
  it('wants one caption per whitespace token of hook + script', () => {
    const m = { captions: [cap('POV:', 0), cap('you', 0.3)], durationSec: 1, broll: [] };
    expect(checkMedia(m, 'POV: you')).toEqual([]);
    expect(checkMedia(m, 'POV: you are').join()).toMatch(/3 whitespace tokens/);
  });
  it('checks b-roll timing fields', () => {
    const m = { captions: [cap('a', 0)], durationSec: 1, broll: [{ term: 't', url: '/x.mp4', kind: 'video' as const, at: -1 }] };
    expect(checkMedia(m).join()).toMatch(/at must be/);
  });
});

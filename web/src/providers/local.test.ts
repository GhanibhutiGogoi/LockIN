import { describe, expect, it } from 'vitest';
import { registry } from './registry';
import { checkDeck } from '../contracts/validate';

describe('normal app configuration', () => {
  it('starts without synthetic AI or gaze data', async () => {
    expect(registry.config.attention.mode).toBe('off');
    expect(registry.config.content.mode).toBe('local');
    expect(registry.canRecap()).toBe(false);
    expect(await registry.media.listGameplayLoops()).toEqual([]);
    await expect(registry.content.getScript({} as never)).rejects.toThrow('not connected');
    registry.set('attention', { mode: 'mock' });
    expect(registry.config.attention.mode).toBe('off');
  });
  it('rejects empty decks and mismatched page indexes from services', () => {
    expect(checkDeck({ id: 'd', title: 'D', slides: [], slideCount: 0 }).join()).toContain('non-empty array');
    expect(checkDeck({ id: 'd', title: 'D', slides: [{ index: 2, title: 'S', text: '' }], slideCount: 2 }).join()).toContain('match');
    expect(checkDeck({ id: 'd', title: 'D', slides: [{ index: 0, title: 'S', text: '' }], slideCount: 1 })).toEqual([]);
  });
});

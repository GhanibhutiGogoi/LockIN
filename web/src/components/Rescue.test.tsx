// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { DEFAULT_VARIANT } from '../contracts/defaults';
import type { RescuePack } from '../contracts/types';
import { actions, useApp } from '../store';
import { Rescue } from './Rescue';

vi.mock('./SlideView', () => ({ SlideView: () => <div>Slide contents</div> }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('retains an autoplay-blocked pack and plays the same Audio directly from the manual button', async () => {
  const instances: FakeAudio[] = [];
  let inClick = false;
  class FakeAudio {
    muted = false;
    currentTime = 0;
    preload = '';
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    attempts = 0;
    play = vi.fn(() => {
      if (++this.attempts === 1) return Promise.reject(new DOMException('Gesture needed', 'NotAllowedError'));
      expect(inClick).toBe(true); // play must happen before the event handler returns
      return Promise.resolve();
    });
    pause = vi.fn();
    constructor(public src: string) { instances.push(this); }
  }
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  actions.addDeck({ id: 'd', title: 'Lecture', sourceType: 'pdf', slideCount: 1, slides: [{ index: 0, title: 'Concept', text: 'Source text' }] });
  const pack: RescuePack = {
    deckId: 'd', slideIndex: 0, variant: DEFAULT_VARIANT,
    script: { variant: DEFAULT_VARIANT, hook: 'Hook', script: 'Explanation', keyTerms: [], plainSummary: 'Summary',
      quiz: [{ question: 'What did you learn?', options: ['A', 'B'], answerIndex: 0, ifRight: 'Correct', ifWrong: 'A is correct' }] },
    media: { audioUrl: 'https://api.example/assets/recap.mp3', durationSec: 2, captions: [{ word: 'Hook', start: 0, end: 1 }, { word: 'Explanation', start: 1, end: 2 }], broll: [] },
  };
  useApp.setState({ rescue: {
    id: 'r', phase: 'playing', trigger: 'manual', depth: 1, pack,
    context: { userId: 'u', deckId: 'd', slideIndex: 0, minutesIntoSession: 0, lapseDepth: 0, slideDifficulty: 0.5, trigger: 'manual', rescueInRow: 1, rescuesSoFar: 0, recentVariantIds: [], hourOfDay: 12 },
    lapseAt: Date.now(), startedAt: Date.now(), skipped: false, answers: [],
  } });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Rescue />));
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Play narration');
    expect(button).toBeDefined();
    expect(useApp.getState().rescue?.phase).toBe('playing');
    expect(useApp.getState().rescue?.awaitingPlayback).toBe(true);
    expect(useApp.getState().rescue?.startedAt).toBeUndefined();
    expect(useApp.getState().rescue?.pack).toBe(pack);
    expect(instances).toHaveLength(1);
    await act(async () => {
      inClick = true;
      button!.click();
      expect(instances[0].play).toHaveBeenCalledTimes(2);
      inClick = false;
    });
    expect(host.textContent).not.toContain('Play narration');
    expect(useApp.getState().rescue?.awaitingPlayback).toBe(false);
    expect(useApp.getState().rescue?.startedAt).toEqual(expect.any(Number));
    expect(useApp.getState().rescue?.pack).toBe(pack);
    expect(instances).toHaveLength(1);
    expect(fetcher).not.toHaveBeenCalled(); // no regeneration of the retained pack
    await act(async () => instances[0].onended?.());
    expect(useApp.getState().rescue?.phase).toBe('quiz');
    expect(host.textContent).toContain('What did you learn?');
  } finally {
    await act(async () => root.unmount());
    useApp.setState({ rescue: null });
    host.remove();
    vi.unstubAllGlobals();
  }
});

/**
 * Rescue-pack cache. Composes AI-analysis output (script) with video output
 * (media) into a RescuePack, and keeps the current slide and two ahead warm so
 * a rescue starts instantly (Gate 2: < 2 s).
 */
import type { Deck, RescuePack, Variant } from '../contracts/types';
import { registry } from '../providers/registry';

const cache = new Map<string, Promise<RescuePack>>();
const key = (deckId: string, slide: number, variantId: string, depth: number) => `${deckId}:${slide}:${variantId}:${depth}`;

export const DEFAULT_VARIANT: Variant = {
  id: '20s·memes·runner',
  targetSeconds: 20,
  slangLevel: 'unhinged',
  humourStyle: 'memes',
  voiceId: 'hype',
  pacing: 1.1,
  gameplayType: 'runner',
  recapOrPreview: 'recap',
  quizCount: 1,
};

/** The variant we prefetch with: the last one the personal model chose. */
let warmVariant: Variant = DEFAULT_VARIANT;
export function setWarmVariant(v: Variant) {
  warmVariant = v;
}

export function getPack(deck: Deck, slideIndex: number, variant: Variant, depth: 1 | 2, profileMemo?: string): Promise<RescuePack> {
  // Gameplay and voice are composed live, so they don't need their own cache entry.
  const scriptKey = key(deck.id, slideIndex, `${variant.targetSeconds}·${variant.slangLevel}·${variant.humourStyle}·${variant.quizCount}`, depth);
  let p = cache.get(scriptKey);
  if (!p) {
    const slide = deck.slides[slideIndex];
    p = (async () => {
      const script = await registry.content.getScript({ deck, slide, variant, profileMemo, depth });
      const media = await registry.media.renderMedia({ deckId: deck.id, slideIndex, script, variant });
      return { deckId: deck.id, slideIndex, variant, script, media };
    })();
    cache.set(scriptKey, p);
    p.catch(() => cache.delete(scriptKey));
  }
  return p.then((pack) => ({ ...pack, variant }));
}

export function prefetch(deck: Deck, slideIndex: number, profileMemo?: string) {
  registry.content.prewarm?.(deck.id, slideIndex);
  for (let i = slideIndex; i < Math.min(deck.slideCount, slideIndex + 3); i++) {
    getPack(deck, i, warmVariant, 1, profileMemo).catch(() => {});
  }
}

export function clearPacks() {
  cache.clear();
}

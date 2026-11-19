/**
 * Rescue-pack cache. Composes AI-analysis output (script) with video output
 * (media) into a RescuePack only when a recap is triggered. Opening a deck or
 * paging through it must not send slide text to AI services.
 *
 * Two levels, because the knobs land in different places:
 *  - the script depends on length, slang, humour, recap/preview and quiz count;
 *  - the media (audio + caption timings) also bakes in the voice and pacing.
 * Only the gameplay loop is composed live in the player, so it is the one knob
 * left out of both keys.
 */
import { DEFAULT_VARIANT } from '../contracts/defaults';
import type { Deck, RescueMedia, RescuePack, RescueScript, Variant } from '../contracts/types';
import { registry } from '../providers/registry';

export { DEFAULT_VARIANT };

function newCache() {
  return {
    controller: new AbortController(),
    scripts: new Map<string, Promise<RescueScript>>(),
    medias: new Map<string, Promise<RescueMedia>>(),
  };
}
let cache = newCache();

export const scriptKey = (deckId: string, slide: number, v: Variant, depth: number) =>
  [deckId, slide, depth, v.targetSeconds, v.slangLevel, v.humourStyle, v.recapOrPreview, v.quizCount].join(':');
export const mediaKey = (deckId: string, slide: number, v: Variant, depth: number) => [scriptKey(deckId, slide, v, depth), v.voiceId, v.pacing].join(':');

function cached<T>(map: Map<string, Promise<T>>, k: string, make: () => Promise<T>): Promise<T> {
  let p = map.get(k);
  if (!p) {
    p = make();
    map.set(k, p);
    p.catch(() => { if (map.get(k) === p) map.delete(k); });
  }
  return p;
}

export async function getPack(deck: Deck, slideIndex: number, variant: Variant, depth: 1 | 2, profileMemo?: string): Promise<RescuePack> {
  const slide = deck.slides[slideIndex];
  if (!slide?.text.trim()) throw new Error('This slide has no readable text. Use a PDF with selectable text for AI recaps.');
  // Bind both providers and cache maps before awaiting anything. An old
  // response can never select a replacement provider or populate its cache.
  const owner = cache;
  const content = registry.content;
  const mediaProvider = registry.media;
  const { signal } = owner.controller;
  const assertCurrent = () => {
    if (owner !== cache || signal.aborted) throw new Error('The AI connection changed. Request this recap again.');
  };
  const baseKey = scriptKey(deck.id, slideIndex, variant, depth);
  const sk = mediaProvider.compiled ? JSON.stringify([baseKey, variant.pacing, variant.gameplayType]) : baseKey;
  const script = await cached(owner.scripts, sk, () => content.getScript({ deck, slide, variant, profileMemo, depth }, { signal }));
  assertCurrent();
  const audioKey = mediaKey(deck.id, slideIndex, variant, depth);
  const key = mediaProvider.compiled ? JSON.stringify([audioKey, variant.gameplayType]) : audioKey;
  const media = await cached(owner.medias, key, () => mediaProvider.renderMedia({ deckId: deck.id, slideIndex, script, variant }, { signal }));
  assertCurrent();
  // every knob that shaped this pack is in its keys, so labelling it with `variant` is accurate
  return { deckId: deck.id, slideIndex, variant, script, media };
}

export function clearPacks() {
  const previous = cache;
  cache = newCache();
  previous.controller.abort();
}

// Service changes cannot reuse an earlier provider's script or audio.
registry.subscribe(clearPacks);

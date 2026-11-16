/**
 * Rescue-pack cache. Composes AI-analysis output (script) with video output
 * (media) into a RescuePack, and keeps the current slide and two ahead warm so
 * a rescue starts instantly (Gate 2: < 2 s).
 *
 * Two levels, because the knobs land in different places:
 *  - the script depends on length, slang, humour, recap/preview and quiz count;
 *  - the media (audio + caption timings) also bakes in the voice and pacing.
 * Only the gameplay loop is composed live in the player, so it is the one knob
 * left out of both keys.
 */
import { DEFAULT_VARIANT } from '../contracts/defaults';
import type { Deck, RescueMedia, RescuePack, RescueScript, Variant } from '../contracts/types';
import { MockContentProvider } from '../providers/mock/content';
import { MockMediaProvider } from '../providers/mock/media';
import { registry } from '../providers/registry';

export { DEFAULT_VARIANT };

const screenContent = new MockContentProvider();
export const screenRecapMedia = new MockMediaProvider();

const scripts = new Map<string, Promise<RescueScript>>();
const medias = new Map<string, Promise<RescueMedia>>();

export const scriptKey = (deckId: string, slide: number, v: Variant, depth: number, memo?: string) =>
  JSON.stringify([deckId, slide, depth, v.targetSeconds, v.slangLevel, v.humourStyle, v.recapOrPreview, v.quizCount, memo]);
export const mediaKey = (deckId: string, slide: number, v: Variant, depth: number, memo?: string) =>
  JSON.stringify([scriptKey(deckId, slide, v, depth, memo), v.voiceId, v.pacing]);

/** The variant we prefetch with: the last one the personal model chose. */
let warmVariant: Variant = DEFAULT_VARIANT;
export function setWarmVariant(v: Variant) {
  warmVariant = v;
}

function cached<T>(map: Map<string, Promise<T>>, k: string, make: () => Promise<T>): Promise<T> {
  let p = map.get(k);
  if (!p) {
    p = make();
    map.set(k, p);
    p.catch(() => map.delete(k));
  }
  return p;
}

export async function getPack(deck: Deck, slideIndex: number, variant: Variant, depth: 1 | 2, profileMemo?: string): Promise<RescuePack> {
  const slide = deck.slides[slideIndex];
  if (!slide?.text.trim()) throw new Error('This slide has no readable text.');
  if (deck.sourceType === 'screen') {
    const script = await screenContent.getScript({ deck, slide, variant, depth });
    const media = await screenRecapMedia.renderMedia({ script, variant });
    return { deckId: deck.id, slideIndex, variant, script, media };
  }
  const sk = scriptKey(deck.id, slideIndex, variant, depth, profileMemo);
  const script = await cached(scripts, sk, () => registry.content.getScript({ deck, slide, variant, profileMemo, depth }));
  const media = await cached(medias, mediaKey(deck.id, slideIndex, variant, depth, profileMemo), () => registry.media.renderMedia({ deckId: deck.id, slideIndex, script, variant }));
  // every knob that shaped this pack is in its keys, so labelling it with `variant` is accurate
  return { deckId: deck.id, slideIndex, variant, script, media };
}

export function prefetch(deck: Deck, slideIndex: number, profileMemo?: string) {
  if (deck.sourceType === 'screen' || !registry.canRecap()) return;
  registry.content.prewarm?.(deck.id, slideIndex);
  for (let i = slideIndex; i < Math.min(deck.slideCount, slideIndex + 3); i++) {
    getPack(deck, i, warmVariant, 1, profileMemo).catch(() => {});
  }
}

/** Warm the shorter second clip for this slide while the first one plays (a media cache miss can take 8–25 s). */
export function prefetchDeeper(deck: Deck, slideIndex: number, variant: Variant, profileMemo?: string) {
  if (deck.sourceType === 'screen') return;
  getPack(deck, slideIndex, variant, 2, profileMemo).catch(() => {});
}

export function clearPacks() {
  scripts.clear();
  medias.clear();
}

// Service changes cannot reuse an earlier provider's script or audio.
registry.subscribe(clearPacks);

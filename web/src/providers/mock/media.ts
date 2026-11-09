import type { MediaProvider } from '../../contracts/providers';
import type { CaptionWord, GameplayLoop, MusicBed, RescueMedia, RescueScript, Variant } from '../../contracts/types';

/**
 * Mock media: no audio file, so the player narrates with the browser's
 * speechSynthesis and these estimated word timings (≈2.5 words/s, as in the
 * proposal). Gameplay loops have no URL, so the player draws a procedural loop.
 */
export function estimateCaptions(text: string, pacing = 1): CaptionWord[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: CaptionWord[] = [];
  let t = 0.15;
  for (const w of words) {
    const syllables = Math.max(1, (w.toLowerCase().match(/[aeiouy]+/g) ?? []).length);
    const dur = (0.18 + syllables * 0.11) / pacing;
    out.push({ word: w, start: t, end: t + dur });
    t += dur;
    if (/[.!?]$/.test(w)) t += 0.32 / pacing;
    else if (/[,;:]$/.test(w)) t += 0.16 / pacing;
  }
  return out;
}

export class MockMediaProvider implements MediaProvider {
  readonly name = 'Mock (browser voice)';

  async renderMedia(args: { script: RescueScript; variant: Variant }): Promise<RescueMedia> {
    const text = `${args.script.hook} ${args.script.script}`;
    const captions = estimateCaptions(text, args.variant.pacing);
    return {
      captions,
      durationSec: (captions.at(-1)?.end ?? 1) + 0.5,
      broll: [],
    };
  }

  async listGameplayLoops(): Promise<GameplayLoop[]> {
    return [
      { id: 'proc-runner', type: 'runner', energy: 0.7 },
      { id: 'proc-parkour', type: 'parkour', energy: 0.9 },
      { id: 'proc-sand', type: 'kinetic-sand', energy: 0.3 },
      { id: 'proc-marble', type: 'marble', energy: 0.5 },
    ];
  }

  async listMusicBeds(): Promise<MusicBed[]> {
    return [];
  }

  async listVoices() {
    return [
      { id: 'hype', label: 'Hype narrator' },
      { id: 'chill', label: 'Chill narrator' },
    ];
  }
}

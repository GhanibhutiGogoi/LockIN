/**
 * Plays narration and reports the current time on the caption clock.
 * Uses media.audioUrl when the video team provides it; otherwise the browser's
 * speechSynthesis (the mock path), snapping to word-boundary events when the
 * voice supports them.
 */
import type { RescueMedia, Variant } from '../contracts/types';

export interface Narration {
  /** seconds on the caption clock */
  time(): number;
  /** index of the caption word being spoken, from boundary events (−1 if unknown) */
  boundaryWord(): number;
  stop(): void;
  setMuted(m: boolean): void;
  readonly done: Promise<void>;
}

export function narrate(media: RescueMedia, text: string, variant: Pick<Variant, 'pacing' | 'voiceId'>, muted: boolean): Narration {
  if (media.audioUrl) return audioNarration(media, muted);
  return speechNarration(media, text, variant, muted);
}

function audioNarration(media: RescueMedia, muted: boolean): Narration {
  const audio = new Audio(media.audioUrl);
  audio.muted = muted;
  let resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));
  audio.onended = () => resolve();
  audio.onerror = () => resolve();
  audio.play().catch(() => {
    // autoplay refused: fall back to the clock so captions still run
    const t0 = performance.now();
    (audio as unknown as { _t0: number })._t0 = t0;
    setTimeout(resolve, media.durationSec * 1000);
  });
  return {
    time: () => {
      const t0 = (audio as unknown as { _t0?: number })._t0;
      return t0 !== undefined ? (performance.now() - t0) / 1000 : audio.currentTime;
    },
    boundaryWord: () => -1,
    stop: () => {
      audio.pause();
      resolve();
    },
    setMuted: (m) => (audio.muted = m),
    done,
  };
}

function pickVoice(voiceId: string): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
  if (!voices.length) return undefined;
  const local = voices.filter((v) => v.localService);
  const pool = local.length ? local : voices;
  const pref = voiceId === 'chill' ? /(Samantha|Karen|Daniel|Google UK English Female|Aria)/i : /(Alex|Fred|Google US English|Guy|Jenny)/i;
  return pool.find((v) => pref.test(v.name)) ?? pool[0];
}

function speechNarration(media: RescueMedia, text: string, variant: Pick<Variant, 'pacing' | 'voiceId'>, muted: boolean): Narration {
  let resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));
  const called = performance.now();
  let t0 = called;
  let boundary = -1;
  let stopped = false;
  let speaking = false;
  const hasSpeech = typeof speechSynthesis !== 'undefined' && speechSynthesis.getVoices().length > 0;

  // char offset → caption word index
  const starts: number[] = [];
  {
    let i = 0;
    for (const w of media.captions) {
      const at = text.indexOf(w.word, i);
      starts.push(at < 0 ? i : at);
      i = at < 0 ? i : at + w.word.length;
    }
  }

  /** Finish no earlier than the caption clock, so captions never get cut off. */
  const finish = () => {
    if (stopped) return;
    const remaining = media.durationSec * 1000 - (performance.now() - t0);
    if (remaining > 300 && !speaking) setTimeout(() => !stopped && resolve(), remaining);
    else resolve();
  };

  if (hasSpeech) {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice(variant.voiceId);
    if (v) u.voice = v;
    u.rate = Math.min(1.6, 1.05 * variant.pacing);
    u.pitch = variant.voiceId === 'chill' ? 0.95 : 1.08;
    u.volume = muted ? 0 : 1;
    u.onstart = () => {
      t0 = performance.now();
      speaking = true;
    };
    u.onboundary = (e) => {
      if (e.name && e.name !== 'word') return;
      let idx = 0;
      while (idx + 1 < starts.length && starts[idx + 1] <= e.charIndex) idx++;
      boundary = idx;
    };
    u.onend = () => {
      speaking = false;
      // a real voice that finished speaking is done; an engine that bailed early is not
      if (boundary >= 0) resolve();
      else finish();
    };
    u.onerror = () => {
      speaking = false;
      finish();
    };
    speechSynthesis.speak(u);
    // Some engines never fire onstart/onend; don't hang the rescue.
    setTimeout(() => !stopped && resolve(), media.durationSec * 1000 * 2 + 4000);
  } else {
    setTimeout(() => !stopped && resolve(), media.durationSec * 1000);
  }

  return {
    time: () => (performance.now() - t0) / 1000,
    boundaryWord: () => boundary,
    stop: () => {
      stopped = true;
      if (hasSpeech) speechSynthesis.cancel();
      resolve();
    },
    setMuted: (m) => {
      if (!hasSpeech) return;
      if (m) speechSynthesis.pause();
      else speechSynthesis.resume();
    },
    done,
  };
}

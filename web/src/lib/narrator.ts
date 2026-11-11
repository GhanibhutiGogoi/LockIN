/**
 * Plays narration and reports the current time on the caption clock.
 * Uses media.audioUrl when the video team provides it, and falls back to the
 * browser's speechSynthesis (the mock path) when there is no file or it fails
 * to load, snapping to word-boundary events when the voice supports them.
 *
 * Mute never pauses anything: the caption clock keeps running, so a muted clip
 * ends on time and the next clip isn't affected.
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

type Voice = Pick<Variant, 'pacing' | 'voiceId'>;

export function narrate(media: RescueMedia, text: string, variant: Voice, muted: boolean): Narration {
  if (media.audioUrl) return audioNarration(media, text, variant, muted);
  return speechNarration(media, text, variant, muted);
}

function audioNarration(media: RescueMedia, text: string, variant: Voice, muted: boolean): Narration {
  const audio = new Audio(media.audioUrl);
  audio.preload = 'auto';
  audio.muted = muted;
  let resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));
  let isMuted = muted;
  let stopped = false;
  /** Set when the file can't be played: the browser voice takes over. */
  let fallback: Narration | null = null;
  /** Set when autoplay was refused: captions run on the clock, silently. */
  let clockStart: number | null = null;

  const toSpeech = () => {
    if (stopped || fallback || clockStart !== null) return;
    audio.onerror = audio.onended = null;
    audio.pause();
    fallback = speechNarration(media, text, variant, isMuted);
    void fallback.done.then(resolve);
  };
  audio.onended = () => resolve();
  audio.onerror = toSpeech;
  audio.play().catch((err: unknown) => {
    if (stopped || fallback) return;
    if ((err as DOMException)?.name === 'NotAllowedError') {
      clockStart = performance.now();
      setTimeout(() => !stopped && resolve(), media.durationSec * 1000);
    } else toSpeech();
  });

  return {
    time: () => (fallback ? fallback.time() : clockStart !== null ? (performance.now() - clockStart) / 1000 : audio.currentTime),
    boundaryWord: () => (fallback ? fallback.boundaryWord() : -1),
    stop: () => {
      stopped = true;
      fallback?.stop();
      audio.onerror = audio.onended = null;
      audio.pause();
      resolve();
    },
    setMuted: (m) => {
      isMuted = m;
      audio.muted = m;
      fallback?.setMuted(m);
    },
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

/** Char offset in `text` where each caption word starts. */
function wordStarts(media: RescueMedia, text: string): number[] {
  const starts: number[] = [];
  let i = 0;
  for (const w of media.captions) {
    const at = text.indexOf(w.word, i);
    starts.push(at < 0 ? i : at);
    i = at < 0 ? i : at + w.word.length;
  }
  return starts;
}

function speechNarration(media: RescueMedia, text: string, variant: Voice, muted: boolean): Narration {
  let resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));
  const hasSpeech = typeof speechSynthesis !== 'undefined' && speechSynthesis.getVoices().length > 0;
  const starts = wordStarts(media, text);
  let t0 = performance.now();
  let boundary = -1;
  let stopped = false;
  /** The utterance whose events count. Null while silent (muted, or no voice). */
  let current: SpeechSynthesisUtterance | null = null;
  let clockTimer: ReturnType<typeof setTimeout> | undefined;

  const time = () => (performance.now() - t0) / 1000;
  const end = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(clockTimer);
    resolve();
  };
  /** Finish when the caption clock runs out, so captions never get cut off. */
  const endOnClock = () => {
    clearTimeout(clockTimer);
    clockTimer = setTimeout(end, Math.max(0, media.durationSec * 1000 - (performance.now() - t0)));
  };

  /** Speak from caption word `fromWord` on; 0 is the start of the clip. */
  const speakFrom = (fromWord: number) => {
    const offset = starts[fromWord] ?? 0;
    const u = new SpeechSynthesisUtterance(text.slice(offset));
    const v = pickVoice(variant.voiceId);
    if (v) u.voice = v;
    u.rate = Math.min(1.6, 1.05 * variant.pacing);
    u.pitch = variant.voiceId === 'chill' ? 0.95 : 1.08;
    u.onstart = () => {
      if (u === current && fromWord === 0) t0 = performance.now();
    };
    u.onboundary = (e) => {
      if (u !== current || (e.name && e.name !== 'word')) return;
      const at = offset + e.charIndex;
      let idx = 0;
      while (idx + 1 < starts.length && starts[idx + 1] <= at) idx++;
      boundary = idx;
    };
    u.onend = () => {
      if (u !== current) return; // cancelled by mute
      // a real voice that finished speaking is done; an engine that bailed early is not
      if (boundary >= 0) end();
      else endOnClock();
    };
    u.onerror = () => {
      if (u === current) endOnClock();
    };
    current = u;
    clearTimeout(clockTimer);
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  };

  if (hasSpeech && !muted) speakFrom(0);
  else endOnClock();
  // Some engines never fire onstart/onend; don't hang the rescue.
  setTimeout(end, media.durationSec * 1000 * 2 + 4000);

  return {
    time,
    boundaryWord: () => (current ? boundary : -1),
    stop: () => {
      current = null;
      if (hasSpeech) speechSynthesis.cancel();
      end();
    },
    setMuted: (m) => {
      if (stopped || !hasSpeech) return;
      if (m && current) {
        current = null;
        boundary = -1;
        speechSynthesis.cancel();
        endOnClock();
      } else if (!m && !current) {
        // pick up from the word the captions are on
        let idx = 0;
        const t = time();
        for (let i = 0; i < media.captions.length; i++) if (media.captions[i].start <= t) idx = i;
        if (t < media.durationSec - 0.5) speakFrom(idx);
      }
    },
    done,
  };
}

import { devlog } from './devlog';
/**
 * Plays narration and reports the current time on the caption clock.
 * Uses model audio when provided. Demo speech is separate; real audio errors
 * never substitute a browser voice. Autoplay denial waits for a manual play.
 *
 * Mute never pauses anything: the caption clock keeps running, so a muted clip
 * ends on time and the next clip isn't affected.
 */
import type { RescueMedia, Variant } from '../contracts/types';
import { DEMO_MODE } from './features';

export interface Narration {
  error?(): string | null;
  /** Retry the same audio directly inside a user click, without awaiting first. */
  play?(): void;
  /** seconds on the caption clock */
  time(): number;
  /** index of the caption word being spoken, from boundary events (−1 if unknown) */
  boundaryWord(): number;
  stop(): void;
  setMuted(m: boolean): void;
  readonly done: Promise<void>;
}

type Voice = Pick<Variant, 'pacing' | 'voiceId'>;
export interface PlaybackOptions {
  localOnly?: boolean;
  onBlocked?(): void;
  onPlaying?(): void;
}

export function narrate(media: RescueMedia, text: string, variant: Voice, muted: boolean, events: PlaybackOptions = {}, player?: HTMLMediaElement): Narration {
  if (!events.localOnly && (player || media.audioUrl)) return audioNarration(media, text, variant, muted, events, player);
  return speechNarration(media, text, variant, muted, events.localOnly);
}

function audioNarration(media: RescueMedia, text: string, variant: Voice, muted: boolean, events: PlaybackOptions, player?: HTMLMediaElement): Narration {
  const audio = player ?? new Audio(media.audioUrl);
  audio.preload = 'auto';
  audio.muted = muted;
  let resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));
  let isMuted = muted;
  let stopped = false;
  /** Only the explicit demo mode may substitute browser speech. */
  let fallback: Narration | null = null;
  let starting = false;
  let error: string | null = null;

  const toSpeech = () => {
    if (stopped || fallback) return;
    audio.onerror = audio.onended = null;
    audio.pause();
    if (!DEMO_MODE) {
      stopped = true;
      error = 'The narration file could not be played. Check your connection and request the recap again.';
      resolve();
      return;
    }
    fallback = speechNarration(media, text, variant, isMuted);
    void fallback.done.then(resolve);
  };
  audio.onended = () => { stopped = true; resolve(); };
  audio.onerror = toSpeech;
  const rejected = (err: unknown) => {
    starting = false;
    if (stopped || fallback) return;
    if ((err as DOMException)?.name === 'NotAllowedError') {
      // Keep the pack, Audio element and completion promise alive. Only the
      // learner's next click retries play; blocked captions never advance.
      events.onBlocked?.();
    } else toSpeech();
  };
  const play = () => {
    if (stopped || fallback || starting) return;
    starting = true;
    const requestedAt = performance.now();
    try {
      // Deliberately synchronous: preserves the browser's user activation.
      audio.play().then(() => {
        starting = false;
        if (!stopped && !fallback) {
          devlog.push({ team: 'media', level: 'ok', label: 'Playback started', ms: Math.round(performance.now() - requestedAt) });
          events.onPlaying?.();
        }
      }, rejected);
    } catch (err) { rejected(err); }
  };
  play();

  return {
    error: () => error,
    play,
    time: () => (fallback ? fallback.time() : audio.currentTime),
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

function pickVoice(voiceId: string, localOnly: boolean, text: string): SpeechSynthesisVoice | undefined {
  const lang = localOnly && /\p{Script=Han}/u.test(text) ? 'zh' : 'en';
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith(lang) && (!localOnly || v.localService));
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

function speechNarration(media: RescueMedia, text: string, variant: Voice, muted: boolean, localOnly = false): Narration {
  let resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));
  const voice = typeof speechSynthesis === 'undefined' ? undefined : pickVoice(variant.voiceId, localOnly, text);
  const hasSpeech = typeof speechSynthesis !== 'undefined' && (localOnly ? !!voice : speechSynthesis.getVoices().length > 0);
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
    if (voice) {
      u.voice = voice;
      if (localOnly) u.lang = voice.lang;
    }
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

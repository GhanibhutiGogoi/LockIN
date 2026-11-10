import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { estimateCaptions } from '../providers/mock/media';
import { narrate } from './narrator';

class FakeUtterance {
  onstart?: () => void;
  onend?: () => void;
  onerror?: () => void;
  onboundary?: (e: { name: string; charIndex: number }) => void;
  voice?: unknown;
  rate = 1;
  pitch = 1;
  constructor(public text: string) {}
}

let spoken: FakeUtterance[];
beforeEach(() => {
  vi.useFakeTimers();
  spoken = [];
  const synth = {
    getVoices: () => [{ lang: 'en-US', name: 'Alex', localService: true }],
    speak: (u: FakeUtterance) => spoken.push(u),
    // like Chrome: cancelling ends the current utterance
    cancel: () => spoken.at(-1)?.onend?.(),
    pause: vi.fn(),
    resume: vi.fn(),
  };
  Object.assign(globalThis, { speechSynthesis: synth, SpeechSynthesisUtterance: FakeUtterance });
});
afterEach(() => vi.useRealTimers());

const text = 'Hook line. one two three four five six seven eight nine ten';
const media = () => {
  const captions = estimateCaptions(text);
  return { captions, durationSec: (captions.at(-1)?.end ?? 1) + 0.5, broll: [] };
};

describe('narrator mute', () => {
  it('muting mid-clip never pauses speech and ends on the caption clock', async () => {
    const m = media();
    const n = narrate(m, text, { voiceId: 'hype', pacing: 1 }, false);
    let done = false;
    void n.done.then(() => (done = true));
    spoken[0].onstart?.();
    await vi.advanceTimersByTimeAsync(500);
    n.setMuted(true);
    expect((globalThis as unknown as { speechSynthesis: { pause: () => void } }).speechSynthesis.pause).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toBe(false); // the cancel's onend doesn't end the clip early
    await vi.advanceTimersByTimeAsync(m.durationSec * 1000);
    expect(done).toBe(true);
  });

  it('a clip that starts muted speaks nothing and ends on time', async () => {
    const m = media();
    const n = narrate(m, text, { voiceId: 'hype', pacing: 1 }, true);
    let done = false;
    void n.done.then(() => (done = true));
    expect(spoken).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(m.durationSec * 1000 + 50);
    expect(done).toBe(true);
  });

  it('unmuting picks up from the current word', async () => {
    const m = media();
    const n = narrate(m, text, { voiceId: 'hype', pacing: 1 }, true);
    await vi.advanceTimersByTimeAsync(m.captions[4].start * 1000 + 10);
    n.setMuted(false);
    expect(spoken).toHaveLength(1);
    expect(spoken[0].text.startsWith(m.captions[4].word)).toBe(true);
  });
});

describe('audio narration', () => {
  it('falls back to the browser voice when the audio file fails', async () => {
    let audio!: { onerror: (() => void) | null };
    class FakeAudio {
      muted = false;
      currentTime = 0;
      preload = '';
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        audio = this;
      }
      play() {
        return Promise.resolve();
      }
      pause() {}
    }
    Object.assign(globalThis, { Audio: FakeAudio });
    narrate({ ...media(), audioUrl: '/missing.mp3' }, text, { voiceId: 'hype', pacing: 1 }, false);
    audio.onerror?.();
    expect(spoken).toHaveLength(1);
  });
});

// @vitest-environment jsdom
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
  it('pauses live layers when autoplay is blocked and stops them after narration ends', async () => {
    const master = document.createElement('audio');
    const game = document.createElement('video');
    const music = document.createElement('audio');
    vi.spyOn(master, 'play').mockRejectedValueOnce(new DOMException('Blocked', 'NotAllowedError')).mockResolvedValue();
    for (const layer of [master, game, music]) vi.spyOn(layer, 'pause').mockImplementation(() => {});
    vi.spyOn(game, 'play').mockResolvedValue();
    vi.spyOn(music, 'play').mockResolvedValue();
    const onBlocked = vi.fn();
    const n = narrate(media(), text, { voiceId: 'hype', pacing: 1 }, false,
      { layers: { game, music }, onBlocked }, master);
    await Promise.resolve();
    expect(onBlocked).toHaveBeenCalledOnce();
    expect(game.pause).toHaveBeenCalled();
    expect(music.pause).toHaveBeenCalled();
    n.play?.();
    await Promise.resolve();
    n.setMuted(true);
    expect(master.muted).toBe(true);
    expect(music.muted).toBe(true);
    master.dispatchEvent(new Event('ended'));
    await n.done;
    const calls = vi.mocked(game.play).mock.calls.length;
    master.dispatchEvent(new Event('playing'));
    expect(game.play).toHaveBeenCalledTimes(calls);
  });

  it('uses the compiled video clock and stops the supplied player', async () => {
    const player = document.createElement('video');
    const play = vi.spyOn(player, 'play').mockResolvedValue();
    const pause = vi.spyOn(player, 'pause').mockImplementation(() => {});
    const onPlaying = vi.fn();
    const n = narrate(media(), text, { voiceId: 'hype', pacing: 1 }, false, { onPlaying }, player);
    await Promise.resolve();
    expect(play).toHaveBeenCalledOnce();
    expect(onPlaying).toHaveBeenCalledOnce();
    player.currentTime = 4;
    expect(n.time()).toBe(4);
    n.setMuted(true);
    expect(player.muted).toBe(true);
    n.stop();
    await n.done;
    expect(pause).toHaveBeenCalledOnce();
    expect(spoken).toHaveLength(0);
  });

  it('keeps screen narration local even when a media player is supplied', () => {
    const player = document.createElement('video');
    const play = vi.spyOn(player, 'play').mockResolvedValue();
    const n = narrate({ ...media(), audioUrl: '/recap.mp3' }, text,
      { voiceId: 'hype', pacing: 1 }, false, { localOnly: true }, player);
    expect(play).not.toHaveBeenCalled();
    expect(spoken).toHaveLength(1);
    n.stop();
  });

  it('keeps blocked audio pending, allows another manual attempt, and cannot restart after stop', async () => {
    class BlockedAudio {
      muted = false;
      currentTime = 0;
      preload = '';
      onended = null;
      onerror = null;
      play = vi.fn(() => Promise.reject(new DOMException('Blocked', 'NotAllowedError')));
      pause = vi.fn();
      constructor() { audio = this; }
    }
    let audio!: BlockedAudio;
    Object.assign(globalThis, { Audio: BlockedAudio });
    const onBlocked = vi.fn();
    const n = narrate({ ...media(), audioUrl: '/recap.mp3' }, text, { voiceId: 'hype', pacing: 1 }, false, { onBlocked });
    let done = false;
    void n.done.then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(n.time()).toBe(0);
    expect(done).toBe(false);
    expect(n.error?.()).toBeNull();
    n.play?.();
    await vi.advanceTimersByTimeAsync(1);
    expect(onBlocked).toHaveBeenCalledTimes(2);
    expect(done).toBe(false);
    n.stop();
    await n.done;
    n.play?.();
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(spoken).toHaveLength(0);
  });

  it('reports a failed model audio file without substituting browser speech', async () => {
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
    const narration = narrate({ ...media(), audioUrl: '/missing.mp3' }, text, { voiceId: 'hype', pacing: 1 }, false);
    audio.onerror?.();
    await narration.done;
    expect(narration.error?.()).toContain('could not be played');
    expect(spoken).toHaveLength(0);
  });
});

import { expect, it, vi } from 'vitest';
import { liveLayers } from './liveLayers';

class Media extends EventTarget {
  currentTime = 0; duration = 10; muted = false; loop = false; volume = 1;
  play = vi.fn(async () => {}); pause = vi.fn();
}
const element = (m: Media) => m as unknown as HTMLMediaElement;

it('follows narration across buffering, seeking, mute and teardown', async () => {
  const master = new Media(), game = new Media(), music = new Media();
  const layers = liveLayers(element(master), element(game), element(music), false);
  expect(game.play).not.toHaveBeenCalled();
  layers.start();
  expect(game.muted).toBe(true);
  expect(music.volume).toBeLessThan(0.2);
  master.currentTime = 12;
  master.dispatchEvent(new Event('timeupdate'));
  expect(game.currentTime).toBe(2);
  expect(music.currentTime).toBe(2);
  master.dispatchEvent(new Event('waiting'));
  expect(game.pause).toHaveBeenCalled();
  master.dispatchEvent(new Event('playing'));
  expect(game.play).toHaveBeenCalledTimes(2);
  layers.setMuted(true); expect(music.muted).toBe(true);
  layers.stop();
  master.dispatchEvent(new Event('playing'));
  expect(game.play).toHaveBeenCalledTimes(2);
  await Promise.resolve();
  expect(game.pause).toHaveBeenCalled();
});

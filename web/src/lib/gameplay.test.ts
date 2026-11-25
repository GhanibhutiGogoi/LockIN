import { afterEach, expect, it, vi } from 'vitest';
import { pickGameplay } from './gameplay';

const loops = [
  { id: 'a', type: 'parkour', energy: 0.5, url: '/a.mp4' },
  { id: 'b', type: 'parkour', energy: 0.5, url: '/b.mp4' },
  { id: 'c', type: 'runner', energy: 0.5, url: '/c.mp4' },
];
afterEach(() => vi.restoreAllMocks());

it('randomizes auto across the playable library without repeating the last clip', () => {
  const random = vi.spyOn(Math, 'random').mockReturnValue(0);
  expect(pickGameplay(loops, 'auto')?.id).toBe('a');
  expect(pickGameplay(loops, 'auto', 'a')?.id).toBe('b');
  random.mockReturnValue(0.99);
  expect(pickGameplay(loops, 'auto', 'a')?.id).toBe('c');
});

it('respects a chosen category and permits repetition when only one asset is available', () => {
  expect(pickGameplay(loops, 'parkour', 'a')?.id).toBe('b');
  expect(pickGameplay(loops, 'runner', 'c')?.id).toBe('c');
  expect(pickGameplay([{ ...loops[0], url: undefined }], 'auto')).toBeUndefined();
  expect(pickGameplay([], 'auto')).toBeUndefined();
  expect(loops).toContain(pickGameplay(loops, 'missing'));
});

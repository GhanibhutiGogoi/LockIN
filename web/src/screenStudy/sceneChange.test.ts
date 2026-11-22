import { expect, it } from 'vitest';
import { sceneChanged } from './sceneChange';

function paint(image: Uint8ClampedArray, x: number, y: number, width: number, height: number) {
  for (let row = y; row < y + height; row++) for (let col = x; col < x + width; col++) {
    const index = (row * 256 + col) * 4;
    image[index] = image[index + 1] = image[index + 2] = 255;
  }
  return image;
}

it('ignores peripheral status text and small cursor changes', () => {
  const initial = new Uint8ClampedArray(256 * 144 * 4);
  expect(sceneChanged(initial, paint(initial.slice(), 0, 0, 150, 14))).toBe(false);
  expect(sceneChanged(initial, paint(initial.slice(), 100, 70, 4, 4))).toBe(false);
});

it('detects content changes and accumulated small changes against the original frame', () => {
  const initial = new Uint8ClampedArray(256 * 144 * 4);
  expect(sceneChanged(initial, paint(initial.slice(), 30, 60, 100, 5))).toBe(true);
  const first = paint(initial.slice(), 30, 60, 30, 4);
  const second = paint(first.slice(), 60, 60, 30, 4);
  expect(sceneChanged(initial, first)).toBe(false);
  expect(sceneChanged(first, second)).toBe(false);
  expect(sceneChanged(initial, second)).toBe(true);
});

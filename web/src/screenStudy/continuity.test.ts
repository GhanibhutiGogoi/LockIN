import { expect, it } from 'vitest';
import { sameReadingDocument } from './continuity';

const paint = (frame: Uint8ClampedArray, x: number, y: number, w: number, h: number, value = 255) => {
  for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) {
    const i = (row * 256 + col) * 4;
    frame[i] = frame[i + 1] = frame[i + 2] = value;
  }
  return frame;
};
function navigation() {
  const frame = new Uint8ClampedArray(256 * 144 * 4);
  for (let x = 5; x < 180; x += 5) paint(frame, x, 4, 2, 10);
  return frame;
}

it('links scrolling and complete page turns while navigation remains stable', () => {
  const first = paint(navigation(), 10, 30, 220, 80);
  const next = paint(navigation(), 20, 60, 210, 60);
  expect(sameReadingDocument(first, next)).toBe(true);
  expect(sameReadingDocument(first, paint(next.slice(), 200, 0, 55, 15))).toBe(true);
});

it('breaks continuity on navigation changes even if the body is unchanged', () => {
  const first = navigation();
  expect(sameReadingDocument(first, paint(first.slice(), 60, 5, 30, 8, 70))).toBe(false);
});

it('does not infer document identity from a blank header or a missing frame', () => {
  const blank = new Uint8ClampedArray(256 * 144 * 4);
  expect(sameReadingDocument(blank, blank)).toBe(false);
  expect(sameReadingDocument(undefined, navigation())).toBe(false);
});

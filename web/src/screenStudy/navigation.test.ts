import { expect, it } from 'vitest';
import { ReadingNavigation, navigationLayout } from './navigation';
import { ScreenTimeline } from './timeline';

function paint(pixels: Uint8ClampedArray, x: number, y: number, w: number, h: number, seed: number) {
  for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) {
    const n = ((row * 37 + col * 13 + seed * 17) % 29) * 8;
    const i = (row * 256 + col) * 4;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = n;
  }
  return pixels;
}
const block = (text: string, x: number, y: number, w: number, h: number) => ({ text, confidence: .95,
  polygon: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] as [number, number][] });

it('uses the actual address bar instead of moving news and recovery overlays, and repairs pending scroll groups', () => {
  const nav = new ReadingNavigation(), timeline = new ScreenTimeline(0, 'Outliers');
  const first = timeline.observe(0, true, 256, 144, 'monitor');
  first.blocks = [block('https://video.example/documentary', 20, 7, 90, 6),
    block('Changing browser news', 140, 7, 45, 6), block('Checking the shared page', 0, 0, 70, 4)];
  const pixels = paint(new Uint8ClampedArray(256 * 144 * 4), 20, 7, 90, 6, 1);
  nav.record(first, pixels);
  const next = timeline.observe(800, true, 256, 144, 'monitor');
  const scrolling = paint(paint(pixels.slice(), 140, 7, 45, 6, 3), 10, 35, 220, 90, 5);
  nav.record(next, scrolling);
  expect(next.documentId).not.toBe(first.documentId);
  nav.learn(first, timeline);
  expect(next.documentId).toBe(first.documentId);
  expect(nav.matches(scrolling)).toBe(true);
  expect(nav.matches(paint(scrolling.slice(), 20, 7, 90, 6, 9))).toBe(false);
  nav.clear();
  expect(nav.matches(scrolling)).toBeUndefined();
});

it('does not bridge an intervening different URL even if the reader returns to the old URL', () => {
  const nav = new ReadingNavigation(), timeline = new ScreenTimeline(0, 'Outliers');
  const first = timeline.observe(0, true, 256, 144, 'monitor');
  first.blocks = [block('https://video.example/one', 20, 7, 90, 6)];
  const pixels = paint(new Uint8ClampedArray(256 * 144 * 4), 20, 7, 90, 6, 1);
  nav.record(first, pixels);
  nav.record(timeline.observe(800, true, 256, 144, 'monitor'), paint(pixels.slice(), 20, 7, 90, 6, 9));
  const returned = timeline.observe(1600, true, 256, 144, 'monitor');
  nav.record(returned, pixels);
  nav.learn(first, timeline);
  expect(returned.documentId).not.toBe(first.documentId);
});

it('ignores detected WPS page counters and LockIn status text without ignoring the file tabs', () => {
  const nav = new ReadingNavigation(), timeline = new ScreenTimeline(0, 'Outliers');
  const first = timeline.observe(0, true, 256, 144, 'monitor');
  first.blocks = [block('Checking the shared page', 0, 1, 55, 4), block('19/82', 130, 11, 20, 4)];
  const pixels = paint(new Uint8ClampedArray(256 * 144 * 4), 65, 2, 60, 6, 1);
  nav.record(first, pixels); nav.learn(first, timeline);
  expect(nav.matches(paint(paint(pixels.slice(), 0, 1, 55, 4, 5), 130, 11, 20, 4, 8))).toBe(true);
  expect(nav.matches(paint(pixels.slice(), 65, 2, 60, 6, 9))).toBe(false);
  expect(navigationLayout({ ...first, blocks: [block('https://hovered-link.example', 20, 130, 90, 6)] })).toBeUndefined();
});

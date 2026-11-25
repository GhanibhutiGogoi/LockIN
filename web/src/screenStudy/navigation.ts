import type { ScreenScene } from './types';
import type { ScreenTimeline } from './timeline';

type Rect = { left: number; top: number; right: number; bottom: number };
type Layout = { address?: Rect; ignored: Rect[] };
const WIDTH = 256, HEIGHT = 144;
const dynamic = /^(?:checking the shared|looking (?:back|away)|look (?:back|at)|tracking|gaze tracking|return to|recovery|finish|studying|\d{1,2}:\d{2}|\d+\s*\/\s*\d+|\d+%)/i;

export function navigationLayout(scene: ScreenScene): Layout | undefined {
  const top = scene.blocks?.filter(b => Math.max(...b.polygon.map(p => p[1])) < scene.height * .22);
  if (!top?.length) return undefined;
  const rect = (polygon: [number, number][]): Rect => ({
    left: Math.max(0, Math.floor(Math.min(...polygon.map(p => p[0])) / scene.width * WIDTH) - 1),
    right: Math.min(WIDTH, Math.ceil(Math.max(...polygon.map(p => p[0])) / scene.width * WIDTH) + 1),
    top: Math.max(0, Math.floor(Math.min(...polygon.map(p => p[1])) / scene.height * HEIGHT) - 1),
    bottom: Math.min(HEIGHT, Math.ceil(Math.max(...polygon.map(p => p[1])) / scene.height * HEIGHT) + 1),
  });
  // Locate the address, not the search/news widget beside it or a hovered link
  // at the bottom. OCR spelling errors do not matter: compare the original pixels.
  const url = top.find(b => /https?[:：]?\s*\/{1,2}/i.test(b.text) && !/127\.0\.0\.1|localhost/i.test(b.text));
  return { address: url ? rect(url.polygon) : undefined,
    ignored: top.filter(b => dynamic.test(b.text.trim())).map(b => rect(b.polygon)) };
}

function difference(source: Uint8ClampedArray, target: Uint8ClampedArray, rect: Rect, dx = 0, dy = 0, ignored: Rect[] = []) {
  if (rect.left + dx < 0 || rect.right + dx > WIDTH || rect.top + dy < 0 || rect.bottom + dy > HEIGHT) return Infinity;
  let count = 0, changes = 0, edges = 0;
  for (let y = rect.top; y < rect.bottom; y++) for (let x = rect.left + 1; x < rect.right; x++) {
    if (ignored.some(r => x >= r.left && x < r.right && y >= r.top && y < r.bottom)) continue;
    const a = (y * WIDTH + x) * 4, b = ((y + dy) * WIDTH + x + dx) * 4;
    if (Math.abs(source[a] - target[b]) + Math.abs(source[a + 1] - target[b + 1]) + Math.abs(source[a + 2] - target[b + 2]) > 60) changes++;
    if (Math.abs(source[a] - source[a - 4]) + Math.abs(source[a + 1] - source[a - 3]) + Math.abs(source[a + 2] - source[a - 2]) > 60) edges++;
    count++;
  }
  return count > 30 && edges > count * .015 ? changes / count : Infinity;
}

function match(source: Uint8ClampedArray, target: Uint8ClampedArray, layout: Layout, offset = { x: 0, y: 0 }) {
  if (!layout.address) return difference(source, target, { left: 0, top: 0, right: 192, bottom: 17 }, 0, 0, layout.ignored) <= .006 ? offset : undefined;
  // Allow small window movements without confusing them with navigation.
  if (difference(source, target, layout.address, offset.x, offset.y) <= .015) return offset;
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const moved = { x: offset.x + dx, y: offset.y + dy };
    if (difference(source, target, layout.address, moved.x, moved.y) <= .015) return moved;
  }
  return undefined;
}

/** Small in-memory probes only; no screenshot pixels are exported or persisted. */
export class ReadingNavigation {
  private frames = new Map<number, { scene: ScreenScene; pixels: Uint8ClampedArray }>();
  private anchor?: { pixels: Uint8ClampedArray; layout: Layout; offset: { x: number; y: number } };
  clear() { this.frames.clear(); this.anchor = undefined; }
  matches(pixels: Uint8ClampedArray): boolean | undefined {
    if (!this.anchor) return undefined;
    const offset = match(this.anchor.pixels, pixels, this.anchor.layout, this.anchor.offset);
    if (!offset) { this.anchor = undefined; return false; }
    this.anchor.offset = offset;
    return true;
  }
  record(scene: ScreenScene, pixels: Uint8ClampedArray) {
    if (this.frames.has(scene.id)) return;
    this.frames.set(scene.id, { scene, pixels });
    if (this.frames.size > 72) this.frames.delete(this.frames.keys().next().value!);
  }
  learn(scene: ScreenScene, timeline: ScreenTimeline) {
    const source = this.frames.get(scene.id), layout = navigationLayout(scene);
    if (!source || !layout || !timeline.current) return;
    const frames = [...this.frames.values()].filter(f => f.scene.id >= scene.id && f.scene.id <= timeline.current!.id);
    let offset = { x: 0, y: 0 }, previous = scene;
    for (const frame of frames) {
      if (frame.scene.timestamp - previous.observedUntil > 2500) return;
      const next = match(source.pixels, frame.pixels, layout, offset);
      if (!next) return;
      offset = next;
      frame.scene.documentId = scene.documentId;
      previous = frame.scene;
    }
    if (previous === timeline.current) this.anchor = { pixels: source.pixels, layout, offset };
  }
}

/** A small, bounded warm buffer. No autoplay and no study text is sent. */
const buffers = new Map<string, HTMLMediaElement>();
export function preloadMedia(url: string | undefined, kind: 'audio' | 'video') {
  if (!url || typeof document === 'undefined' || buffers.has(url)) return;
  const element = document.createElement(kind);
  element.preload = 'auto';
  element.src = url;
  buffers.set(url, element);
  element.load();
  while (buffers.size > 6) {
    const [key, old] = buffers.entries().next().value!;
    old.pause(); old.removeAttribute('src'); old.load(); buffers.delete(key);
  }
}
export function takePreloadedAudio(url: string | undefined): HTMLMediaElement | undefined {
  if (!url) return;
  const element = buffers.get(url);
  if (!element || element.tagName !== 'AUDIO') return;
  buffers.delete(url);
  return element;
}
export function clearMediaPreloads() {
  for (const element of buffers.values()) {
    element.pause(); element.removeAttribute('src'); element.load();
  }
  buffers.clear();
}

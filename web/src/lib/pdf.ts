import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { textLines } from './pdfText';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const cache = new Map<string, Promise<PDFDocumentProxy>>();
/** PDF.js refuses two renders into one canvas at once; cancel the old one first. */
const running = new WeakMap<HTMLCanvasElement, RenderTask>();
const requests = new WeakMap<HTMLCanvasElement, number>();

export function cancelPageRender(canvas: HTMLCanvasElement) {
  requests.set(canvas, (requests.get(canvas) ?? 0) + 1);
  running.get(canvas)?.cancel();
}

export function loadPdf(url: string): Promise<PDFDocumentProxy> {
  let p = cache.get(url);
  if (!p) {
    p = pdfjs.getDocument({ url }).promise;
    cache.set(url, p);
    p.catch(() => cache.delete(url));
  }
  return p;
}

/** Release the document and its in-memory file when a deck is removed. */
export async function releasePdf(url: string) {
  const pending = cache.get(url);
  cache.delete(url);
  if (pending) await pending.then((doc) => doc.destroy()).catch(() => {});
  if (url.startsWith('blob:')) URL.revokeObjectURL(url);
}

/** Local PDF ingestion; no network upload or generated content. */
export async function extractPages(url: string): Promise<{ title: string; text: string }[]> {
  const doc = await loadPdf(url);
  if (!doc.numPages) throw new Error('This PDF contains no pages. Export the slides again.');
  if (doc.numPages > 500) throw new Error('This PDF has more than 500 pages. Split it into smaller decks.');
  const out: { title: string; text: string }[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const lines = textLines(content.items.filter((item) => 'str' in item));
    const title = lines[0]?.slice(0, 90) || `Page ${i}`;
    out.push({ title, text: lines.join('\n') });
  }
  return out;
}

/** Render one page into a canvas, fitted to a box (CSS px). Returns the drawn size. */
export async function renderPage(
  url: string,
  index: number,
  canvas: HTMLCanvasElement,
  box: { width: number; height: number },
): Promise<{ width: number; height: number }> {
  const request = (requests.get(canvas) ?? 0) + 1;
  requests.set(canvas, request);
  const checkCurrent = () => {
    if (requests.get(canvas) !== request) {
      const error = new Error('A newer page was requested.');
      error.name = 'RenderingCancelledException';
      throw error;
    }
  };
  const doc = await loadPdf(url);
  const page = await doc.getPage(index + 1);
  checkCurrent();
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(box.width / base.width, box.height / base.height);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const viewport = page.getViewport({ scale: scale * dpr });
  const width = Math.floor(viewport.width / dpr);
  const height = Math.floor(viewport.height / dpr);
  const prev = running.get(canvas);
  if (prev) {
    prev.cancel();
    await prev.promise.catch(() => {});
  }
  checkCurrent();
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { width, height };
  const task = page.render({ canvasContext: ctx, viewport });
  running.set(canvas, task);
  try {
    await task.promise;
  } finally {
    if (running.get(canvas) === task) running.delete(canvas);
  }
  return { width, height };
}

export async function pageAspect(url: string, index: number): Promise<number> {
  const doc = await loadPdf(url);
  const page = await doc.getPage(index + 1);
  const v = page.getViewport({ scale: 1 });
  return v.width / v.height;
}

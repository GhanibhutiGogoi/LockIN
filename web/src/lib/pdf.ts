import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const cache = new Map<string, Promise<PDFDocumentProxy>>();
/** PDF.js refuses two renders into one canvas at once; cancel the old one first. */
const running = new WeakMap<HTMLCanvasElement, RenderTask>();

export function loadPdf(url: string): Promise<PDFDocumentProxy> {
  let p = cache.get(url);
  if (!p) {
    p = pdfjs.getDocument({ url }).promise;
    cache.set(url, p);
  }
  return p;
}

/** Per-page text, used by the mock ingestion (the real one is Docling on the backend). */
export async function extractPages(url: string): Promise<{ title: string; text: string }[]> {
  const doc = await loadPdf(url);
  const out: { title: string; text: string }[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const lines: string[] = [];
    let current = '';
    let lastY: number | null = null;
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        if (current.trim()) lines.push(current.trim());
        current = '';
      }
      current += item.str;
      lastY = y;
    }
    if (current.trim()) lines.push(current.trim());
    const title = lines[0]?.slice(0, 90) || `Page ${i}`;
    out.push({ title, text: lines.slice(1).join('\n') });
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
  const doc = await loadPdf(url);
  const page = await doc.getPage(index + 1);
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

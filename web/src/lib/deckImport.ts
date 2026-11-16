import type { Deck } from '../contracts/types';

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export function validateSlideFile(file: File, allowPowerPoint = false): void {
  if (!file.size) throw new Error('This file is empty. Export your slides again and choose the new file.');
  if (file.size > MAX_FILE_BYTES) throw new Error('This deck is larger than 50 MB. Compress it or split it into smaller PDFs.');
  if (/\.pptx?$/i.test(file.name)) {
    if (!allowPowerPoint || /\.ppt$/i.test(file.name)) {
      throw new Error('Export your PowerPoint as a PDF, then open it here. PowerPoint conversion is not available on this installation.');
    }
    return;
  }
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    throw new Error('Choose a PDF of your slides. Other file types cannot be opened here.');
  }
}

export async function fileId(file: Blob): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return 'pdf-' + [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function importPdf(file: File): Promise<Deck> {
  validateSlideFile(file);
  const { extractPages, releasePdf } = await import('./pdf');
  const id = await fileId(file);
  const pdfUrl = URL.createObjectURL(file);
  try {
    const pages = await extractPages(pdfUrl);
    return {
      id,
      title: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '),
      sourceType: 'pdf',
      slideCount: pages.length,
      pdfUrl,
      slides: pages.map((page, index) => ({ index, title: page.title, text: page.text })),
    };
  } catch (err) {
    await releasePdf(pdfUrl);
    throw err;
  }
}

export function importError(err: unknown): string {
  const error = err instanceof Error ? err : new Error(String(err));
  if (error.name === 'PasswordException' || /password/i.test(error.message)) {
    return 'This PDF is password-protected. Save an unlocked copy and open that instead.';
  }
  if (/InvalidPDFException|MissingPDFException/.test(error.name) || /invalid pdf|pdf structure/i.test(error.message)) {
    return 'This PDF could not be read. Export it again from the original presentation and retry.';
  }
  return error.message || 'The slides could not be opened. Choose the file again to retry.';
}

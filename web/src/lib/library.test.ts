import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { library } from './library';
import { fileId, validateSlideFile } from './deckImport';
import { textLines } from './pdfText';
import type { Deck } from '../contracts/types';
import type { Report } from '../store';

const deck: Deck = { id: 'persist-test', title: 'Actual uploaded slides', sourceType: 'pdf', slideCount: 1, pdfUrl: 'blob:expired', slides: [{ index: 0, title: 'Topic', text: 'The actual slide content.' }] };
afterEach(async () => { await library.removeDeck(deck.id); await library.clearReports(); });

describe('saved library', () => {
  it('recreates a readable PDF URL from the saved bytes after a new load', async () => {
    const source = new Blob(['%PDF-1.4 fixture bytes'], { type: 'application/pdf' });
    await library.saveDeck(deck, source);
    const [loaded] = await library.decks();
    expect(loaded.title).toBe(deck.title);
    expect(loaded.pdfUrl).not.toBe('blob:expired');
    expect(await (await fetch(loaded.pdfUrl!)).text()).toBe(await source.text());
    URL.revokeObjectURL(loaded.pdfUrl!);
    await library.removeDeck(deck.id);
    expect(await library.decks()).toEqual([]);
  });
  it('keeps report records independently of temporary object URLs and deletes history', async () => {
    const report = { deck, log: { sessionId: 'actual-session', endedAt: 100 }, review: {}, questions: [] } as unknown as Report;
    await library.saveReport(report);
    const [saved] = await library.reports();
    expect(saved.log.sessionId).toBe('actual-session');
    expect(saved.deck.pdfUrl).toBeUndefined();
    await library.clearReports();
    expect(await library.reports()).toEqual([]);
  });
});

describe('upload validation', () => {
  it('rejects empty, oversized and unsupported files before parsing', () => {
    expect(() => validateSlideFile(new File([], 'empty.pdf'))).toThrow('empty');
    expect(() => validateSlideFile({ name: 'large.pdf', size: 51 * 1024 * 1024 } as File)).toThrow('50 MB');
    expect(() => validateSlideFile(new File(['x'], 'slides.pptx'))).toThrow('Export');
    expect(() => validateSlideFile(new File(['x'], 'photo.png'))).toThrow('PDF');
    expect(() => validateSlideFile(new File(['x'], 'slides.pptx'), true)).not.toThrow();
  });
  it('identifies a deck by bytes, not the filename or size', async () => {
    const first = new File(['one'], 'same.pdf');
    const changed = new File(['two'], 'same.pdf');
    expect(await fileId(first)).not.toBe(await fileId(changed));
    expect(await fileId(first)).toBe(await fileId(new File(['one'], 'renamed.pdf')));
  });
});

describe('PDF text', () => {
  it('preserves word gaps, split words, line breaks and non-Latin content', () => {
    const item = (str: string, x: number, y: number, width: number, hasEOL = false) => ({ str, transform: [10, 0, 0, 10, x, y], width, hasEOL });
    expect(textLines([
      item('Photo', 0, 80, 25), item('synthesis', 25, 80, 45), item('uses', 76, 80, 20),
      item('light.', 102, 80, 30, true), item('光合作用', 0, 60, 40),
    ])).toEqual(['Photosynthesis uses light.', '光合作用']);
  });
});

import type { Deck } from '../contracts/types';
import type { Report } from '../store';

interface SavedDeck { id: string; deck: Deck; file?: Blob; savedAt: number }
const DATABASE = 'lockin-library';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('decks', { keyPath: 'id' });
      request.result.createObjectStore('reports', { keyPath: 'log.sessionId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other LockIn tabs and try again.'));
  });
}

async function transaction<T>(store: 'decks' | 'reports', mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = run(tx.objectStore(store));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? request.error ?? new Error('Browser storage is unavailable.')); };
  });
}

function persistentDeck(deck: Deck): Deck {
  return { ...deck, pdfUrl: deck.pdfUrl?.startsWith('blob:') ? undefined : deck.pdfUrl };
}

export const library = {
  async saveDeck(deck: Deck, file?: Blob) {
    await transaction('decks', 'readwrite', (s) => s.put({ id: deck.id, deck: persistentDeck(deck), file, savedAt: Date.now() } satisfies SavedDeck));
  },
  async decks(): Promise<Deck[]> {
    const rows = await transaction<SavedDeck[]>('decks', 'readonly', (s) => s.getAll());
    return rows.sort((a, b) => b.savedAt - a.savedAt).map(({ deck, file }) => ({ ...deck, pdfUrl: file ? URL.createObjectURL(file) : deck.pdfUrl }));
  },
  async removeDeck(id: string) { await transaction('decks', 'readwrite', (s) => s.delete(id)); },
  async saveReport(report: Report) {
    await transaction('reports', 'readwrite', (s) => s.put({ ...report, deck: persistentDeck(report.deck) }));
  },
  async reports(): Promise<Report[]> {
    const rows = await transaction<Report[]>('reports', 'readonly', (s) => s.getAll());
    return rows.sort((a, b) => b.log.endedAt - a.log.endedAt);
  },
  async clearReports() { await transaction('reports', 'readwrite', (s) => s.clear()); },
};

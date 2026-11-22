import type { Report } from '../store';

/** Keep provider wire contracts stable; exported reports use one absolute timebase. */
export function exportReport(report: Report) {
  function convert(value: unknown, path: string[] = []): unknown {
    if (Array.isArray(value)) return value.map(item => convert(item, path));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (key === 't' && typeof item === 'number') {
        const scale = path.includes('gazeTrace') ? 1 : 1000;
        return ['timestamp', report.log.startedAt + item * scale];
      }
      return [key, convert(item, [...path, key])];
    }));
  }
  return { schemaVersion: 2, timestampUnit: 'unix-ms',
    ...(convert({ ...report, deck: { ...report.deck, pdfUrl: undefined } }) as object) };
}

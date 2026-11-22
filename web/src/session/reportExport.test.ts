import { expect, it } from 'vitest';
import type { Report } from '../store';
import { exportReport } from './reportExport';

it('exports every legacy t as an absolute millisecond timestamp without changing source data', () => {
  const report = { deck: { pdfUrl: 'blob:private' }, log: { startedAt: 100_000,
    samples: [{ t: 2 }], activity: [{ t: 3 }], gazeDiagnostics: { samples: [{ t: 4 }] },
    gazeTrace: { samples: [{ t: 250, capturedAt: 100_250 }], geometryEvents: [{ t: 600 }] },
    screenAnalysis: { windows: [{ timestamp: 100_000 }] } } } as unknown as Report;
  const exported = exportReport(report);
  const json = JSON.stringify(exported);
  expect(json).not.toMatch(/"t":/);
  expect(json).not.toContain('blob:private');
  const parsed = JSON.parse(json);
  expect(parsed.log.samples[0].timestamp).toBe(102_000);
  expect(parsed.log.gazeTrace.samples[0].timestamp).toBe(100_250);
  expect(parsed.log.gazeTrace.geometryEvents[0].timestamp).toBe(100_600);
  expect(parsed.log.screenAnalysis.windows[0].timestamp).toBe(100_000);
  expect(report.log.samples[0].t).toBe(2);
});

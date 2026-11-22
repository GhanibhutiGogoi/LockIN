// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { startCalibrationDiagnostic } from './calibrationDiagnostics';

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

it('keeps completed reports locally after upload and does not record a second outcome on cleanup', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ok:true})));
  const diagnostic = startCalibrationDiagnostic('blazegaze');
  const fields = { outcome:'failed', stage:'calibration', cameraStatus:'on', cameraError:null, tracker:null } as const;
  await diagnostic.finish(fields);
  await diagnostic.finish({...fields,outcome:'interrupted'});
  const reports = JSON.parse(localStorage.getItem('lockin.calibrationDiagnostics')!);
  expect(reports).toHaveLength(1);
  expect(reports[0]).toMatchObject({schemaVersion:2,outcome:'failed',model:'blazegaze'});
  expect(localStorage.getItem('lockin.pendingCalibrationDiagnostics')).toBeNull();
});

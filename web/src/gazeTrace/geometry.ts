import type { TraceGeometry } from './types';
import { readCalibrationGeometry, changedGeometry } from '../../../gaze-demo/backend/static/calibration-geometry.js';

export function readTraceGeometry(): TraceGeometry {
  return readCalibrationGeometry();
}

export function sameTraceGeometry(a: TraceGeometry, b: TraceGeometry): boolean {
  return (Object.keys(a) as (keyof TraceGeometry)[]).every(key => a[key] === b[key]);
}

export { changedGeometry };

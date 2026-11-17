import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCalibrationPoint, calibrationFitDiagnostics } from './calibration.ts';

test('diagnostics separate raw predictions, mapped positions and clipped validation output', () => {
  const summary = summarizeCalibrationPoint(Array.from({length:7}, (_, i) => ({
    rawGaze: i === 3 ? [100,-100] : [.2,.3],
    mappedGaze: [-2,3], unclippedGaze: [-1,2], normPog: [-.5,.5],
  })));
  assert.deepEqual(summary.rawMedian,[.2,.3]);
  assert.deepEqual(summary.rawMad,[0,0]);
  assert.deepEqual(summary.mappedMedian,[-2,3]);
  assert.deepEqual(summary.unclippedMedian,[-1,2]);
  assert.deepEqual(summary.predicted,[-.5,.5]);
  assert.equal(summary.clippedSamples,7);
  assert.ok(summary.rawRange[0]>99);
});

test('fit diagnostics expose collinear inputs and report residuals without changing acceptance thresholds', () => {
  const points = [[0,0],[1,1],[2,2],[3,3]];
  const report = calibrationFitDiagnostics(points,points,[[1,0,0],[0,1,0]]);
  assert.ok(report.inputConditionNumber === null || report.inputConditionNumber > 1e12);
  assert.ok(report.inputSingularValues[1] < 1e-12);
  assert.equal(report.rmse,0);
  assert.doesNotThrow(() => JSON.stringify(report));
});

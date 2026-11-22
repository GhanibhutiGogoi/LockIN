import { Matrix, SingularValueDecomposition } from 'ml-matrix';
import type { CalibrationFitDiagnostics, CalibrationPointSummary } from './calibration-types';

export type { CalibrationFitDiagnostics, CalibrationPointSummary } from './calibration-types';

export interface CalibrationSample {
  rawGaze: number[];
  mappedGaze: number[];
  unclippedGaze: number[];
  normPog: number[];
}

export function finitePair(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = (sorted.length - 1) / 2;
  return (sorted[Math.floor(middle)] + sorted[Math.ceil(middle)]) / 2;
}
const medianPair = (values: number[][]) => [0, 1].map(i => median(values.map(v => v[i])));

export function summarizeCalibrationPoint(samples: CalibrationSample[]): CalibrationPointSummary {
  const rawSamples = samples.map(s => [...s.rawGaze]);
  const rawMedian = medianPair(rawSamples);
  return {
    sampleCount: samples.length,
    rawSamples,
    rawMedian,
    rawMad: [0, 1].map(i => median(rawSamples.map(v => Math.abs(v[i] - rawMedian[i])))),
    rawRange: [0, 1].map(i => Math.max(...rawSamples.map(v => v[i])) - Math.min(...rawSamples.map(v => v[i]))),
    mappedMedian: medianPair(samples.map(s => s.mappedGaze)),
    unclippedMedian: medianPair(samples.map(s => s.unclippedGaze)),
    predicted: medianPair(samples.map(s => s.normPog)),
    clippedSamples: samples.filter(s => s.unclippedGaze.some(v => v < -.5 || v > .5)).length,
  };
}

export function calibrationFitDiagnostics(predictions: number[][], targets: number[][], matrix: number[][] | null = null): CalibrationFitDiagnostics {
  const mean = [0, 1].map(i => predictions.reduce((sum, p) => sum + p[i], 0) / predictions.length);
  const singularValues = new SingularValueDecomposition(new Matrix(predictions.map(p => p.map((v, i) => v - mean[i])))).diagonal;
  const condition = singularValues[0] / singularValues[1];
  const pointErrors = matrix ? predictions.map((p, i) => {
    const mapped = matrix.map(([a, b, c]) => a * p[0] + b * p[1] + c);
    return Math.hypot(mapped[0] - targets[i][0], mapped[1] - targets[i][1]);
  }) : [];
  return {
    method: 'median-7-affine-v1' as const,
    inputSingularValues: singularValues,
    inputConditionNumber: Number.isFinite(condition) ? condition : null,
    matrix,
    pointErrors,
    rmse: pointErrors.length ? Math.sqrt(pointErrors.reduce((sum, e) => sum + e * e, 0) / pointErrors.length) : null,
  };
}

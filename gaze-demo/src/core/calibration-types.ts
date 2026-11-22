export interface CalibrationPointSummary {
  sampleCount: number;
  rawSamples: number[][];
  rawMedian: number[];
  rawMad: number[];
  rawRange: number[];
  mappedMedian: number[];
  unclippedMedian: number[];
  predicted: number[];
  clippedSamples: number;
}

export interface CalibrationFitDiagnostics {
  method: 'median-7-affine-v1';
  inputSingularValues: number[];
  inputConditionNumber: number | null;
  matrix: number[][] | null;
  pointErrors: number[];
  rmse: number | null;
}

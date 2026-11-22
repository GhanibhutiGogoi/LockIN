import { expect, it } from 'vitest';
import type { ScreenAnalysis } from './types';
import { historicalFocus } from './timeline';
import { summarizeScreenAnalysis } from './summary';

it('counts subsecond focus and camera gaps independently of the one-second chart', () => {
  const analysis: ScreenAnalysis = { version: 1, timestampUnit: 'unix-ms', windowMs: 5000,
    scenes: [], events: [], droppedGazeSamples: 0, droppedScenes: 0,
    windows: [{ timestamp: 0, endTimestamp: 5000, focusedMs: 2300, unknownMs: 1700,
      excludedMs: 1000, lookingAwayMs: 0, offTopicMs: 0, sceneIds: [] }],
    measurements: [
      { timestamp: 0, durationMs: 1000, evidence: 'excluded', reason: 'intervention' },
      { timestamp: 1000, durationMs: 600, evidence: 'focused', reason: 'study' },
      { timestamp: 1600, durationMs: 400, evidence: 'unknown', reason: 'skipped' },
      { timestamp: 2100, durationMs: 1700, evidence: 'focused', reason: 'study' },
    ] };
  const summary = summarizeScreenAnalysis(analysis);
  expect(summary).toMatchObject({ focusedMs: 2300, longestFocusMs: 1700, medianFocusMs: 1150, unknownMs: 1700 });
  expect(summary.unknownReasons).toEqual([
    { reason: 'missing-gaze-samples', durationMs: 1300 }, { reason: 'skipped', durationMs: 400 },
  ]);
  expect(historicalFocus(analysis, 0)).toHaveLength(2);
  expect(summarizeScreenAnalysis(analysis, 2500)).toMatchObject({ focusedMs: 1300, unknownMs: 1200, excludedMs: 0 });
});

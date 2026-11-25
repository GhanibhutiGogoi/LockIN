import { expect, it } from 'vitest';
import { recordClassification, type ClassificationEntry } from './classificationHistory';
import type { ScreenScene } from './types';

const scene = (id: number, classifiedAt?: number, label: ScreenScene['label'] = 'related'): ScreenScene => ({
  id, timestamp: id * 1000, observedUntil: id * 1000 + 750, width: 1280, height: 720,
  displaySurface: 'monitor', status: 'ready', label, classifiedAt,
});

it('keeps only five completed results, ordered by completion rather than screenshot time', () => {
  let history: ClassificationEntry[] = [];
  for (let id = 1; id <= 7; id++) history = recordClassification(history, scene(id, id * 2000));
  expect(history.map(item => item.sceneId)).toEqual([7, 6, 5, 4, 3]);
  history = recordClassification(history, scene(1, 15000, 'off-topic'));
  expect(history[0]).toEqual({ sceneId: 1, at: 15000, label: 'off-topic' });
  history = recordClassification(history, scene(1, 16000, 'uncertain'));
  expect(history).toHaveLength(5);
  expect(history.filter(item => item.sceneId === 1)).toHaveLength(1);
  expect(history[0].label).toBe('uncertain');
});

it('ignores pending OCR, checking, inferred labels and failed classifications', () => {
  const history = recordClassification([], scene(1, 2000));
  for (const sample of [scene(2), scene(2, 3000, 'checking'), scene(2, 3000, 'unavailable'), scene(2, 3000, null)]) {
    expect(recordClassification(history, sample)).toBe(history);
  }
});

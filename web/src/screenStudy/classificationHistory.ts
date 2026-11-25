import type { ScreenScene } from './types';

export interface ClassificationEntry {
  sceneId: number;
  at: number;
  label: 'related' | 'off-topic' | 'uncertain';
}

export function recordClassification(history: ClassificationEntry[], scene: ScreenScene): ClassificationEntry[] {
  if (scene.classifiedAt === undefined || !['related', 'off-topic', 'uncertain'].includes(scene.label ?? '')) return history;
  const entry: ClassificationEntry = { sceneId: scene.id, at: scene.classifiedAt, label: scene.label as ClassificationEntry['label'] };
  return [entry, ...history.filter(item => item.sceneId !== scene.id)]
    .sort((a, b) => b.at - a.at || b.sceneId - a.sceneId).slice(0, 5);
}

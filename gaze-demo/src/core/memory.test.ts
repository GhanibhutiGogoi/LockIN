import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryForGoal, makeGenerationRequest, chooseVideo } from './memory.ts';
import type { EpisodeRecord, Profile, VideoAsset } from './types.ts';

const profile: Profile = { id: 'jiaqi', name: 'Jiaqi', createdAt: '2026-11-04T00:00:00Z', preferences: { style: 'plain', pace: 'normal', language: 'zh', maxSeconds: 40 } };
const video: VideoAsset = { id: 'v1', title: '平均值', style: 'plain', pace: 'normal', goal: '平均值', url: 'blob:local', durationSeconds: 12, source: 'local', quiz: { kind: 'choice', question: '2、4、6 的平均值？', options: ['3', '4', '6'], correctIndex: 1 } };
function episode(id: string, changes: Partial<EpisodeRecord> = {}): EpisodeRecord {
  return { id, sessionId: 's', profileId: 'jiaqi', goal: '平均值', studyContext: '分心前正在阅读：2、4、6 的平均值。', triggerAt: 1000, triggerReason: 'look-away', mode: 'automatic', createdAt: '2026-11-04T00:00:01Z', video: { ...video }, playbackAt: 2000, returnedAt: 15000, answer: 1, annotation: { falseAlarm: null, helped: null, note: '' }, summary: { watchedMs: 12000, watchValidMs: 11000, watchOnScreenShare: .9, observationMs: 120000, validMs: 100000, onTaskMs: 90000, offTaskMs: 10000, unknownMs: 20000, coverage: 5/6, onTaskShare: .9, recoveredAfterMs: 4000, relapseAfterMs: null, completed: true, censoredReason: null, quizCorrect: true }, ...changes };
}

test('memory excludes other users, other goals, manual trials, false alarms and incomplete results', () => {
  const good = episode('good');
  const records = [good, episode('other-user', { profileId: 'yingwen' }), episode('other-goal', { goal: '物理' }), episode('manual', { mode: 'manual' }), episode('false', { annotation: { falseAlarm: true, helped: null, note: '' } }), episode('censored', { summary: { ...good.summary!, completed: false, censoredReason: 'session-ended' } }), episode('low-coverage', { summary: { ...good.summary!, coverage: .2 } })];
  const m = memoryForGoal('jiaqi', '平均值', records);
  assert.equal(m.eligibleCount, 1);
  assert.equal(m.styles[0].count, 1);
  assert.equal(m.styles[0].meanOnTaskShare, .9);
  assert.match(m.memo, /不足/);
});

test('correcting a false alarm immediately removes its style evidence and duplicate IDs are not double-counted', () => {
  const old = episode('same');
  const corrected = episode('same', { annotation: { falseAlarm: true, helped: null, note: '误报' } });
  assert.equal(memoryForGoal('jiaqi', '平均值', [old, corrected]).eligibleCount, 0);
});

test('generation request carries personal preferences and last study context as plain serializable data', () => {
  const e = episode('e');
  const request = makeGenerationRequest(profile, e, memoryForGoal('jiaqi', '平均值', []));
  const copy = JSON.parse(JSON.stringify(request));
  assert.equal(copy.userId, 'jiaqi');
  assert.equal(copy.studyContext.text, '分心前正在阅读：2、4、6 的平均值。');
  assert.equal(copy.personalization.preferences.style, 'plain');
  assert.equal(copy.constraints.mustAnswerQuiz, true);
  assert.throws(() => makeGenerationRequest({ ...profile, id: 'yingwen' }, e, { eligibleCount: 0, styles: [], memo: '' }));
});

test('few observations do not override explicit preference; enough eligible observations can change the choice', () => {
  const analogy = { ...video, id: 'analogy', style: 'analogy' as const };
  const e = episode('e');
  const make = (n: number) => makeGenerationRequest(profile, e, memoryForGoal('jiaqi', '平均值', Array.from({ length: n }, (_, i) => episode(`a${i}`, { video: analogy, summary: { ...e.summary!, onTaskShare: 1 } }))));
  assert.equal(chooseVideo(make(1), [analogy, video]).id, 'v1');
  assert.equal(chooseVideo(make(3), [video, analogy]).id, 'analogy');
  assert.throws(() => chooseVideo(make(3), [{ ...video, goal: '其他任务' }]));
});

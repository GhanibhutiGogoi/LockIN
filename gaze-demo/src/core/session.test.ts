import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StudySession } from './session.ts';
import type { Observation, VideoAsset } from './types.ts';
const options = { id: 's1', profileId: 'u1', goal: '平均值', studyContext: '2、4、6 的平均值', startedAt: 0, epoch: Date.parse('2026-11-04T00:00:00Z') };
const obs = (t: number, onScreen = true): Observation => ({ t, valid: true, onScreen, visible: true, screen: 'study', source: 'manual' });
const asset: VideoAsset = { id: 'sample', title: '平均值', goal: '平均值', style: 'plain', pace: 'normal', durationSeconds: 12, url: '/sample.mp4', source: 'local', quiz: { kind: 'choice', question: '平均值？', options: ['3','4','6'], correctIndex: 1 } };

test('a sustained lapse requests one intervention and preserves the last study context', () => {
  const s = new StudySession(options);
  s.updateStudyContext('正在看的平均值例题', 'study');
  s.updateStudyContext('娱乐窗口里的内容', 'entertainment');
  for (let t = 0; t <= 4000; t += 500) s.observe(obs(t, false));
  assert.equal(s.episodes.length, 1);
  assert.equal(s.phase, 'preparing');
  assert.equal(s.active!.studyContext, '正在看的平均值例题');
  assert.equal(s.active!.mode, 'automatic');
  assert.equal(s.active!.playbackAt, null);
  assert.throws(() => s.requestIntervention(4500));
});

test('ready is not played; quiz blocks normal return and a wrong answer still completes the answer requirement', () => {
  const s = new StudySession(options);
  s.requestIntervention(1000); s.videoReady(asset);
  assert.equal(s.phase, 'preparing');
  assert.throws(() => s.answer(2000, 1));
  s.play(10000); s.endVideo(22000);
  assert.equal(s.phase, 'quiz');
  assert.throws(() => s.answer(23000, 99));
  assert.equal(s.answer(23000, 0), false);
  assert.equal(s.phase, 'observing');
  assert.equal(s.active!.playbackAt, 10000);
  assert.equal(s.active!.returnedAt, 23000);
});

test('observation window prevents repeat interventions and no-data windows do not invent recovery', () => {
  const s = new StudySession(options);
  s.requestIntervention(0); s.videoReady(asset); s.play(0); s.endVideo(12000); s.answer(13000, 1);
  for (let t = 13000; t <= 133000; t += 500) s.observe({ ...obs(t), valid: false });
  assert.equal(s.episodes.length, 1);
  assert.equal(s.phase, 'studying');
  assert.equal(s.episodes[0].summary!.completed, true);
  assert.equal(s.episodes[0].summary!.coverage, 0);
  assert.equal(s.episodes[0].summary!.recoveredAfterMs, null);
});

test('ending while playing censors the episode and is idempotent', () => {
  const s = new StudySession(options);
  s.requestIntervention(0); s.videoReady(asset); s.play(1000);
  s.observe(obs(1000)); s.observe(obs(1500));
  s.end(2000, 'camera-stopped'); s.end(2500, 'another-end');
  assert.equal(s.phase, 'ended');
  assert.equal(s.episodes.length, 1);
  assert.equal(s.episodes[0].summary!.censoredReason, 'camera-stopped');
  assert.equal(s.episodes[0].summary!.observationMs, 0);
  assert.equal(s.record.endReason, 'camera-stopped');
});

test('written recall answers remain unscored and blank answers cannot unlock return', () => {
  const s = new StudySession(options);
  s.requestIntervention(0); s.videoReady({ ...asset, quiz: { kind: 'recall', question: '概括刚才的内容' } });
  s.play(1000); s.endVideo(12000);
  assert.throws(() => s.answer(13000, '  '));
  assert.equal(s.answer(13000, '把总和除以数量'), null);
  assert.equal(s.active!.answer, '把总和除以数量');
});

test('continuous off-task behavior can trigger again after observation and cooldown', () => {
  const s = new StudySession(options);
  s.requestIntervention(0); s.videoReady(asset); s.play(0); s.endVideo(12000); s.answer(13000, 1);
  for (let t = 13000; t <= 153000; t += 500) s.observe(obs(t, false));
  assert.equal(s.episodes.length, 2);
  assert.equal(s.active!.mode, 'automatic');
});

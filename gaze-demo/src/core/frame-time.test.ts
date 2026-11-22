import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usableFrame } from './frame-time.ts';
import { StudySession } from './session.ts';

test('old, future, duplicate and out-of-order camera results are not fresh observations', () => {
  assert.equal(usableFrame(1000, 3000, 0), false);
  assert.equal(usableFrame(3100, 3000, 0), false);
  assert.equal(usableFrame(2000, 2100, 2000), false);
  assert.equal(usableFrame(1900, 2100, 2000), false);
  assert.equal(usableFrame(2000, 2100, 1900), true);
});

test('a UI timer does not discard a later-arriving fresh captured frame', () => {
  const s = new StudySession({ id: 's', profileId: 'u', goal: '平均值', studyContext: '', startedAt: 0, epoch: 0 });
  s.tick(1000);
  s.observe({ t: 950, valid: true, onScreen: true, visible: true, screen: 'study', source: 'manual' });
  assert.equal(s.record.samples.length, 1);
  assert.equal(s.record.samples[0].t, 950);
});

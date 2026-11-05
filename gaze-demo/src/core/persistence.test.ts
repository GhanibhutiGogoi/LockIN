import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProfileBank } from '../profile-bank.ts';
import type { EpisodeRecord, SessionRecord } from './types.ts';

class StorePort {
  es = new Map<string, EpisodeRecord>(); ss = new Map<string, SessionRecord>();
  fail = false;
  barrier = Promise.resolve();
  async episodes(id: string) { return structuredClone([...this.es.values()].filter(e => e.profileId === id)); }
  async sessions(id: string) { return structuredClone([...this.ss.values()].filter(e => e.profileId === id)); }
  async saveSession(s: SessionRecord) { await this.barrier; if (this.fail) throw new Error('quota'); this.ss.set(s.id, structuredClone(s)); }
  async saveEpisode(e: EpisodeRecord) { if (this.fail) throw new Error('quota'); this.es.set(e.id, structuredClone(e)); }
}
const session = { id: 's-a', profileId: 'a', goal: '平均值', studyContext: '例题', startedAt: '2026-11-04T00:00:00Z', endedAt: null, endReason: null, samples: [], traceTruncated: false, episodeIds: ['e-a'] } satisfies SessionRecord;
const episode = { id: 'e-a', sessionId: 's-a', profileId: 'a', goal: '平均值', studyContext: '例题', triggerAt: 0, triggerReason: 'manual', mode: 'manual', createdAt: '2026-11-04T00:00:00Z', video: null, playbackAt: null, returnedAt: null, answer: null, summary: null, annotation: { falseAlarm: null, helped: null, note: '' } } satisfies EpisodeRecord;

test('failed writes remain exportable after switching away and back', async () => {
  const port = new StorePort(), bank = new ProfileBank(port); port.fail = true;
  await assert.rejects(bank.saveBatch(session, [episode]));
  assert.equal((await bank.load('b')).episodes.length, 0);
  const restored = await bank.load('a');
  assert.equal(restored.episodes[0].id, 'e-a');
  assert.equal(restored.sessions[0].id, 's-a');
});

test('annotation corrections are serialized after pending older snapshots', async () => {
  const port = new StorePort(), bank = new ProfileBank(port);
  let release!: () => void;
  port.barrier = new Promise<void>(resolve => { release = resolve; });
  const old = bank.saveBatch(session, [episode]);
  const correction = bank.saveEpisode({ ...episode, annotation: { falseAlarm: true, helped: null, note: '误报' } });
  release(); await Promise.all([old, correction]);
  assert.equal(port.es.get('e-a')!.annotation.falseAlarm, true);
  assert.equal((await bank.load('a')).episodes[0].annotation.falseAlarm, true);
});

test('separate loads never return another user records', async () => {
  const port = new StorePort(), bank = new ProfileBank(port);
  await bank.saveBatch(session, [episode]);
  const [a, b] = await Promise.all([bank.load('a'), bank.load('b')]);
  assert.equal(a.profileId, 'a'); assert.equal(a.episodes.length, 1);
  assert.equal(b.profileId, 'b'); assert.equal(b.episodes.length, 0); assert.equal(b.sessions.length, 0);
});

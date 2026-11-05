import type { EpisodeRecord, SessionRecord } from './core/types.ts';
export interface RecordStore {
  episodes(id: string): Promise<EpisodeRecord[]>; sessions(id: string): Promise<SessionRecord[]>;
  saveEpisode(e: EpisodeRecord): Promise<void>; saveSession(s: SessionRecord): Promise<void>;
}
interface Bucket { episodes: Map<string, EpisodeRecord>; sessions: Map<string, SessionRecord> }
export class ProfileBank {
  private store: RecordStore;
  private buckets = new Map<string, Bucket>();
  private dirty = new Map<string, number>();
  private revision = 0;
  private pending: Promise<void> = Promise.resolve();
  constructor(store: RecordStore) { this.store = store; }
  private bucket(id: string) {
    if (!this.buckets.has(id)) this.buckets.set(id, { episodes: new Map(), sessions: new Map() });
    return this.buckets.get(id)!;
  }
  private key(table: 'episodes' | 'sessions', value: { profileId: string; id: string }) { return `${table}/${value.profileId}/${value.id}`; }
  private stage(table: 'episodes' | 'sessions', value: EpisodeRecord | SessionRecord) {
    const b = this.bucket(value.profileId);
    if (table === 'episodes') b.episodes.set(value.id, structuredClone(value as EpisodeRecord));
    else b.sessions.set(value.id, structuredClone(value as SessionRecord));
    const key = this.key(table, value), revision = ++this.revision;
    this.dirty.set(key, revision);
    return { key, revision };
  }
  private clean(staged: { key: string; revision: number }) { if (this.dirty.get(staged.key) === staged.revision) this.dirty.delete(staged.key); }
  private enqueue(action: () => Promise<void>) {
    const work = this.pending.then(action);
    this.pending = work.catch(() => {});
    return work;
  }
  saveBatch(record: SessionRecord, episodes: EpisodeRecord[]) {
    const s = structuredClone(record), es = structuredClone(episodes);
    if (es.some(e => e.profileId !== s.profileId || e.sessionId !== s.id)) return Promise.reject(new Error('会话与用户记录不匹配'));
    const stagedSession = this.stage('sessions', s), stagedEpisodes = es.map(e => this.stage('episodes', e));
    return this.enqueue(async () => {
      await this.store.saveSession(s); this.clean(stagedSession);
      for (let i = 0; i < es.length; i++) { await this.store.saveEpisode(es[i]); this.clean(stagedEpisodes[i]); }
    });
  }
  saveEpisode(episode: EpisodeRecord) {
    const e = structuredClone(episode), staged = this.stage('episodes', e);
    return this.enqueue(async () => { await this.store.saveEpisode(e); this.clean(staged); });
  }
  flush() { return this.pending; }
  async load(id: string) {
    await this.flush();
    const b = this.bucket(id);
    let error: string | null = null;
    try {
      const [es, ss] = await Promise.all([this.store.episodes(id), this.store.sessions(id)]);
      const episodes = new Map(es.filter(e => e.profileId === id).map(e => [e.id, e]));
      const sessions = new Map(ss.filter(s => s.profileId === id).map(s => [s.id, s]));
      b.episodes.forEach(e => { if (this.dirty.has(this.key('episodes', e)) || !episodes.has(e.id)) episodes.set(e.id, e); });
      b.sessions.forEach(s => { if (this.dirty.has(this.key('sessions', s)) || !sessions.has(s.id)) sessions.set(s.id, s); });
      b.episodes = episodes; b.sessions = sessions;
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
    return structuredClone({ profileId: id, episodes: [...b.episodes.values()], sessions: [...b.sessions.values()], error });
  }
}

import type { EpisodeRecord, Profile, SessionRecord } from './core/types.ts';

export class StudyStore {
  private db: Promise<IDBDatabase>;
  constructor(name = 'lockin-attention-v1') {
    this.db = new Promise((resolve, reject) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('profiles', { keyPath: 'id' });
        for (const table of ['sessions', 'episodes']) r.result.createObjectStore(table, { keyPath: 'id' }).createIndex('profileId', 'profileId');
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error ?? new Error('无法打开本地记忆库'));
      r.onblocked = () => reject(new Error('本地记忆库被其他标签页占用，请关闭旧页面后重试'));
    });
  }
  private async read<T>(table: string, profileId?: string): Promise<T[]> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(table, 'readonly');
      const store = tx.objectStore(table);
      const r = profileId ? store.index('profileId').getAll(profileId) : store.getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  private async put(table: string, value: unknown): Promise<void> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(table, 'readwrite');
      tx.objectStore(table).put(structuredClone(value));
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('保存失败；记录仍保留在当前页面，请先导出备份'));
      tx.onerror = () => reject(tx.error ?? new Error('本地存储不可用'));
    });
  }
  profiles() { return this.read<Profile>('profiles'); }
  episodes(profileId: string) { return this.read<EpisodeRecord>('episodes', profileId); }
  sessions(profileId: string) { return this.read<SessionRecord>('sessions', profileId); }
  saveProfile(value: Profile) { return this.put('profiles', value); }
  saveEpisode(value: EpisodeRecord) { return this.put('episodes', value); }
  saveSession(value: SessionRecord) { return this.put('sessions', value); }
  async close() { (await this.db).close(); }
}

/**
 * Integration log — every provider call, response, and contract problem lands
 * here so the Integrations panel can show teams what the UI saw.
 */
export type Team = 'attention' | 'content' | 'media' | 'adaptive' | 'ui';

export interface DevLogEntry {
  id: number;
  at: number;
  team: Team;
  level: 'info' | 'ok' | 'warn' | 'error';
  label: string;
  detail?: unknown;
  ms?: number;
}

const MAX = 300;
let entries: DevLogEntry[] = [];
let seq = 0;
const subs = new Set<() => void>();

export const devlog = {
  push(e: Omit<DevLogEntry, 'id' | 'at'>) {
    entries = [...entries.slice(-(MAX - 1)), { ...e, id: ++seq, at: Date.now() }];
    subs.forEach((f) => f());
  },
  get: () => entries,
  clear() {
    entries = [];
    subs.forEach((f) => f());
  },
  subscribe(f: () => void) {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
};

/** Wrap a provider call so its timing and failures are logged. */
export async function traced<T>(team: Team, label: string, fn: () => Promise<T>, detail?: unknown): Promise<T> {
  const t0 = performance.now();
  try {
    const out = await fn();
    devlog.push({ team, level: 'ok', label, ms: Math.round(performance.now() - t0), detail: detail ?? summarize(out) });
    return out;
  } catch (err) {
    devlog.push({ team, level: 'error', label, ms: Math.round(performance.now() - t0), detail: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

function summarize(v: unknown): unknown {
  try {
    const s = JSON.stringify(v);
    return s && s.length > 600 ? s.slice(0, 600) + '…' : v;
  } catch {
    return undefined;
  }
}

import { camelize, snakify } from '../../contracts/validate';

export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

/** Fetch JSON from a team's service. snake_case in, camelCase out. */
export async function call<T>(
  base: string,
  path: string,
  init: { method?: string; body?: unknown; form?: FormData; timeoutMs?: number; token?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const url = new URL(path.replace(/^\//, ''), base.endsWith('/') ? base : base + '/').toString();
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  init.signal?.addEventListener('abort', abort, { once: true });
  if (init.signal?.aborted) ctrl.abort();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 20_000);
  const method = init.method ?? (init.body !== undefined || init.form ? 'POST' : 'GET');
  try {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          ...(init.form ? {} : { 'Content-Type': 'application/json' }),
          ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
        },
        body: init.form ?? (init.body !== undefined ? JSON.stringify(snakify(init.body)) : undefined),
        signal: ctrl.signal,
      });
    } catch (err) {
      if (init.signal?.aborted) throw new DOMException('The request was cancelled.', 'AbortError');
      const reason = (err as Error).name === 'AbortError' ? 'timed out' : 'could not be reached (is it running, and does it allow CORS from this page?)';
      throw new ServiceError(`${url} ${reason}`);
    }
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 300); } catch { /* ignore */ }
      throw new ServiceError(`${method} ${url} returned ${res.status}${detail ? `: ${detail}` : ''}`, res.status);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? camelize<T>(JSON.parse(text)) : (undefined as T));
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', abort);
  }
}

/** Resolve a possibly-relative asset URL against the service base. */
export function resolveUrl(base: string, url: string | undefined): string | undefined {
  if (!url) return url;
  try {
    return new URL(url, base.endsWith('/') ? base : base + '/').toString();
  } catch {
    return url;
  }
}

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
  init: { method?: string; body?: unknown; form?: FormData; timeoutMs?: number } = {},
): Promise<T> {
  const url = new URL(path.replace(/^\//, ''), base.endsWith('/') ? base : base + '/').toString();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 20_000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? (init.body || init.form ? 'POST' : 'GET'),
      headers: init.form ? undefined : { 'Content-Type': 'application/json' },
      body: init.form ?? (init.body !== undefined ? JSON.stringify(snakify(init.body)) : undefined),
      signal: ctrl.signal,
    });
  } catch (err) {
    const reason = (err as Error).name === 'AbortError' ? 'timed out' : 'could not be reached (is it running, and does it allow CORS from this page?)';
    throw new ServiceError(`${url} ${reason}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    throw new ServiceError(`${init.method ?? 'GET'} ${url} returned ${res.status}${detail ? `: ${detail}` : ''}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? camelize<T>(JSON.parse(text)) : (undefined as T));
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

import type { ServiceConfig } from './registry';

export type AIConnection = { media: ServiceConfig; content: ServiceConfig };
const KEY = import.meta.env.MODE === 'demo' ? 'lockin.ai-connection.demo' : 'lockin.ai-connection.v1';

export function normalizeApiUrl(value: string, pageProtocol = globalThis.location?.protocol): string {
  let url: URL;
  try { url = new URL(value.trim()); }
  catch { throw new Error('Enter a full API address, starting with http:// or https://.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Use an HTTP or HTTPS base address without passwords, query parameters or a fragment.');
  }
  if (pageProtocol === 'https:' && url.protocol !== 'https:') {
    throw new Error('This page uses HTTPS. Use an HTTPS API address so your browser can connect.');
  }
  url.pathname = url.pathname.replace(/\/+$/, '') + '/';
  return url.toString();
}

/** Only these user-facing settings override production build defaults. */
export function savedAIConnection(): Partial<AIConnection> {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as AIConnection | null;
    if (!saved || !['off', 'http'].includes(saved.media?.mode) || !['local', 'http'].includes(saved.content?.mode)) return {};
    return {
      media: { mode: saved.media.mode, url: saved.media.mode === 'http' ? normalizeApiUrl(saved.media.url) : '',
        ...(saved.media.voiceUrl && saved.media.mode === 'http' ? { voiceUrl: normalizeApiUrl(saved.media.voiceUrl, 'http:') } : {}),
      },
      content: {
        mode: saved.content.mode,
        url: saved.content.mode === 'http' ? normalizeApiUrl(saved.content.url) : '',
        deckImport: saved.content.deckImport !== false,
      },
    };
  } catch { return {}; }
}

export function saveAIConnection(value: AIConnection): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(value)); return true; }
  catch { return false; }
}

export function clearAIConnection() {
  try { localStorage.removeItem(KEY); } catch { /* storage may be unavailable */ }
}

export interface ConnectionCheck {
  url: string;
  scripts: boolean;
  deckImport: boolean;
  videoCount: number;
}

/** No inference or slide data is sent by a connection check. */
export async function checkAIConnection(value: string, signal?: AbortSignal): Promise<ConnectionCheck> {
  const url = normalizeApiUrl(value);
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) ctrl.abort();
  const timeout = setTimeout(abort, 15_000);
  async function read(path: string) {
    const response = await fetch(new URL(path, url), { signal: ctrl.signal });
    if (response.status === 401 || response.status === 403) throw new Error('Access was denied. Sign in through your deployment’s gateway, then try again.');
    if (response.status === 503 && path === 'readyz') throw new Error('The API is reachable, but its voice model, aligner or reference voices are not ready. Finish server setup and try again.');
    if (!response.ok) throw new Error(`The API returned ${response.status}. Use its base address, without /healthz or /media at the end.`);
    try { return await response.json(); }
    catch { throw new Error('This address did not return API data. Check the API path and reverse-proxy settings.'); }
  }
  try {
    const health = await read('healthz');
    if (health?.service !== 'lockin-media' || health.api_version !== 1) throw new Error('This is not a supported LockIn API. Deploy the current media service and use its base address.');
    if (health.mode !== 'real') throw new Error('This server is in mock mode. Start it with real models before connecting it to the study app.');
    const ready = await read('readyz');
    if (ready?.ready !== true || ready.mode !== 'real') throw new Error('The models are not ready yet. Finish server setup and try again.');
    const [voices, loops] = await Promise.all([read('voices'), read('library/gameplay')]);
    if (!Array.isArray(voices) || !voices.some((v) => v?.id === 'hype') || !voices.some((v) => v?.id === 'chill') || !Array.isArray(loops)) {
      throw new Error('The API is missing the expected voices or video library. Check the server version.');
    }
    return { url, scripts: health.capabilities?.scripts === true, deckImport: health.capabilities?.deck_import === true, videoCount: loops.length };
  } catch (error) {
    if (ctrl.signal.aborted) throw new Error('The connection check timed out or was cancelled. Check the address and try again.');
    if (error instanceof TypeError) throw new Error('Could not reach the API. Check that it is running and allows this page’s address in LOCKIN_CORS_ORIGINS.');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

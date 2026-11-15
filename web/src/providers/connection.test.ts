// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkAIConnection, normalizeApiUrl, savedAIConnection, saveAIConnection } from './connection';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); localStorage.clear(); });

describe('runtime API connection', () => {
  it('normalizes prefixes and rejects unsafe or mixed-content addresses', () => {
    expect(normalizeApiUrl(' https://gpu.example/lockin/api ')).toBe('https://gpu.example/lockin/api/');
    expect(normalizeApiUrl('http://127.0.0.1:8011', 'http:')).toBe('http://127.0.0.1:8011/');
    for (const value of ['localhost:8011', 'file:///tmp/a', 'https://user:secret@host', 'https://host/?token=x', 'https://host/#x']) {
      expect(() => normalizeApiUrl(value)).toThrow();
    }
    expect(() => normalizeApiUrl('http://gpu.example', 'https:')).toThrow('HTTPS');
  });

  it('persists only production-safe media/content settings across reloads', () => {
    const settings = { media: { mode: 'http', url: 'https://host/media-api/' }, content: { mode: 'http', url: 'https://host/media-api/', deckImport: false } };
    expect(saveAIConnection(settings)).toBe(true);
    expect(savedAIConnection()).toEqual(settings);
    localStorage.setItem('lockin.ai-connection.v1', '{broken');
    expect(savedAIConnection()).toEqual({});
    saveAIConnection({ media: { mode: 'mock', url: '' }, content: { mode: 'mock', url: '' } });
    expect(savedAIConnection()).toEqual({});
  });

  it('checks a remote prefix without inference or sending slides', async () => {
    const fetcher = vi.fn(async (url: URL, init: RequestInit) => {
      expect(init.method).toBeUndefined();
      expect(init.body).toBeUndefined();
      const path = url.pathname;
      const body = path.endsWith('healthz') ? { service: 'lockin-media', api_version: 1, mode: 'real', capabilities: { scripts: true, deck_import: false } }
        : path.endsWith('readyz') ? { mode: 'real', ready: true }
        : path.endsWith('voices') ? [{ id: 'hype' }, { id: 'chill' }] : [];
      return new Response(JSON.stringify(body));
    });
    vi.stubGlobal('fetch', fetcher);
    expect(await checkAIConnection('https://gpu.example/api')).toEqual({ url: 'https://gpu.example/api/', scripts: true, deckImport: false, videoCount: 0 });
    expect(fetcher.mock.calls.every(([url]) => url.pathname.startsWith('/api/'))).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('does not connect a mock backend', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ service: 'lockin-media', api_version: 1, mode: 'mock' }))));
    await expect(checkAIConnection('http://127.0.0.1:8011')).rejects.toThrow('mock mode');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('restores saved user connections when the developer panel is disabled', async () => {
    saveAIConnection({ media: { mode: 'http', url: 'https://host/api/' }, content: { mode: 'http', url: 'https://host/api/', deckImport: false } });
    vi.stubEnv('DEV', false);
    vi.resetModules();
    const { registry } = await import('./registry');
    expect(registry.config.media.url).toBe('https://host/api/');
    expect(registry.config.content.deckImport).toBe(false);
    expect(registry.canRecap()).toBe(true);
  });

  it('explains not-ready, network, authentication and wrong-base failures', async () => {
    const health = { service: 'lockin-media', api_version: 1, mode: 'real' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(health))).mockResolvedValueOnce(new Response('{}', { status: 503 })));
    await expect(checkAIConnection('https://host')).rejects.toThrow('not ready');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(checkAIConnection('https://host')).rejects.toThrow('CORS');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));
    await expect(checkAIConnection('https://host')).rejects.toThrow('Access was denied');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>')));
    await expect(checkAIConnection('https://host')).rejects.toThrow('API data');
  });
});

/**
 * Provider registry — the one place that decides which implementation each
 * team's module uses. Defaults come from .env (VITE_*_PROVIDER / VITE_*_URL);
 * the Integrations panel can override them at runtime (saved in localStorage).
 */
import type { AdaptiveProvider, AttentionProvider, ContentProvider, MediaProvider } from '../contracts/providers';
import { traced, type Team } from '../lib/devlog';
import { load, save } from '../lib/storage';
import { LocalAdaptiveProvider, LocalContentProvider, NoAttentionProvider, NoMediaProvider } from './local';
import { HttpAdaptiveProvider, HttpContentProvider, HttpMediaProvider } from './http';
import { MemoryAdaptiveProvider } from './memory/adaptive';
import { MockAdaptiveProvider } from './mock/adaptive';
import { MockAttentionProvider } from './mock/attention';
import { MockContentProvider } from './mock/content';
import { MockMediaProvider } from './mock/media';
import { WsAttentionProvider } from './ws/attention';
import { useSyncExternalStore } from 'react';
import { clearAIConnection, savedAIConnection, saveAIConnection, type AIConnection } from './connection';

export type ServiceTeam = 'attention' | 'content' | 'media' | 'adaptive';

export interface ServiceConfig {
  /** 'mock' | 'http' | 'ws' | an in-browser plugin id */
  mode: string;
  url: string;
  /** False for a scripts-only gateway; PDFs still import in the browser. */
  deckImport?: boolean;
  /** Local studio receives this voice API address per render. */
  voiceUrl?: string;
}
export type IntegrationConfig = Record<ServiceTeam, ServiceConfig>;

export const TEAM_INFO: Record<ServiceTeam, { title: string; owns: string; modes: string[] }> = {
  attention: { title: 'Gaze tracking', owns: 'Webcam → focus score 0–100, ~10 Hz', modes: ['off', 'ws', ...((import.meta.env.MODE === 'demo') ? ['mock'] : [])] },
  content: { title: 'AI analysis', owns: 'Deck parsing, script + quiz, fact-check', modes: ['local', 'http', ...((import.meta.env.MODE === 'demo') ? ['mock'] : [])] },
  media: { title: 'Video', owns: 'Voice, word timings, b-roll, gameplay library', modes: ['off', 'http', ...((import.meta.env.MODE === 'demo') ? ['mock'] : [])] },
  adaptive: { title: 'Personal AI', owns: 'Variant picker, rewards, session review, profile memo', modes: ['local', 'http', 'memory', ...((import.meta.env.MODE === 'demo') ? ['mock'] : [])] },
};

const env = import.meta.env;
const DEFAULTS: IntegrationConfig = {
  attention: { mode: env.VITE_ATTENTION_PROVIDER ?? 'off', url: env.VITE_ATTENTION_WS_URL ?? 'ws://localhost:8765' },
  content: { mode: env.VITE_CONTENT_PROVIDER ?? 'local', url: env.VITE_CONTENT_URL ?? 'http://localhost:8010' },
  media: { mode: env.VITE_MEDIA_PROVIDER ?? 'off', url: env.VITE_MEDIA_URL ?? 'http://localhost:8011' },
  adaptive: { mode: env.VITE_ADAPTIVE_PROVIDER ?? 'local', url: env.VITE_ADAPTIVE_URL ?? 'http://localhost:8012' },
};
// Versioned keys prevent old simulator settings leaking into a real session.
const KEY = (import.meta.env.MODE === 'demo') ? 'lockin.integrations.demo' : 'lockin.integrations.v2';
function sanitize(config: IntegrationConfig): IntegrationConfig {
  const clean = { ...config };
  for (const team of Object.keys(clean) as ServiceTeam[]) {
    if (!(import.meta.env.MODE === 'demo') && clean[team].mode === 'mock') {
      clean[team] = { ...clean[team], mode: team === 'attention' || team === 'media' ? 'off' : 'local' };
    }
  }
  return clean;
}

// ───────── in-browser attention plugins (for the gaze team) ─────────
const attentionPlugins = new Map<string, { label: string; create: () => AttentionProvider }>();

/**
 * Register an in-browser attention provider (e.g. MediaPipe in a Web Worker).
 * Call this from src/providers/plugins/index.ts; it then appears as a mode in
 * the Integrations panel.
 */
export function registerAttentionPlugin(id: string, label: string, create: () => AttentionProvider) {
  attentionPlugins.set(id, { label, create });
  TEAM_INFO.attention.modes = ['off', 'ws', ...attentionPlugins.keys(), ...((import.meta.env.MODE === 'demo') ? ['mock'] : [])];
}
export function attentionPluginLabel(id: string) {
  return attentionPlugins.get(id)?.label;
}

/** Log every async method call on a provider. */
function withTrace<T extends object>(team: Team, p: T): T {
  return new Proxy(p, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (typeof v !== 'function' || prop === 'constructor') return v;
      return (...args: unknown[]) => {
        const out = v.apply(target, args);
        if (out instanceof Promise) return traced(team, String(prop), () => out);
        return out;
      };
    },
  });
}

class Registry {
  config: IntegrationConfig = sanitize({ ...DEFAULTS, ...(import.meta.env.DEV ? load<Partial<IntegrationConfig>>(KEY, {}) : {}), ...savedAIConnection() });
  private cache: Partial<Record<ServiceTeam, unknown>> = {};
  private subs = new Set<() => void>();

  set(team: ServiceTeam, patch: Partial<ServiceConfig>) {
    this.config = sanitize({ ...this.config, [team]: { ...this.config[team], ...patch } });
    delete this.cache[team];
    save(KEY, this.config);
    this.subs.forEach((f) => f());
  }
  reset() {
    clearAIConnection();
    this.config = sanitize({ ...DEFAULTS });
    this.cache = {};
    save(KEY, {});
    this.subs.forEach((f) => f());
  }
  setAI(connection: AIConnection): boolean {
    this.config = sanitize({ ...this.config, ...connection });
    delete this.cache.content;
    delete this.cache.media;
    const persisted = saveAIConnection(connection);
    this.subs.forEach((f) => f());
    return persisted;
  }
  subscribe(f: () => void) {
    this.subs.add(f);
    return () => {
      this.subs.delete(f);
    };
  }
  isMock(team: ServiceTeam) {
    return this.config[team].mode === 'mock';
  }
  canRecap() {
    return ['http', ...((import.meta.env.MODE === 'demo') ? ['mock'] : [])].includes(this.config.content.mode)
      && ['http', ...((import.meta.env.MODE === 'demo') ? ['mock'] : [])].includes(this.config.media.mode);
  }

  clearMemoryHistory() {
    return new MemoryAdaptiveProvider().clearMemory();
  }

  get attention(): AttentionProvider {
    const c = this.config.attention;
    return (this.cache.attention ??= (() => {
      if (c.mode === 'ws') return new WsAttentionProvider(c.url);
      const plugin = attentionPlugins.get(c.mode);
      if (plugin) return plugin.create();
      return c.mode === 'mock' && (import.meta.env.MODE === 'demo') ? new MockAttentionProvider() : new NoAttentionProvider();
    })()) as AttentionProvider;
  }
  get content(): ContentProvider {
    const c = this.config.content;
    return (this.cache.content ??= withTrace('content', c.mode === 'http' ? new HttpContentProvider(c.url) : c.mode === 'mock' && (import.meta.env.MODE === 'demo') ? new MockContentProvider() : new LocalContentProvider())) as ContentProvider;
  }
  get media(): MediaProvider {
    const c = this.config.media;
    return (this.cache.media ??= withTrace('media', c.mode === 'http' ? new HttpMediaProvider(c.url, c.voiceUrl) : c.mode === 'mock' && (import.meta.env.MODE === 'demo') ? new MockMediaProvider() : new NoMediaProvider())) as MediaProvider;
  }
  get adaptive(): AdaptiveProvider {
    const c = this.config.adaptive;
    return (this.cache.adaptive ??= withTrace('adaptive', c.mode === 'http' ? new HttpAdaptiveProvider(c.url)
      : c.mode === 'memory' ? new MemoryAdaptiveProvider()
      : c.mode === 'mock' && (import.meta.env.MODE === 'demo') ? new MockAdaptiveProvider()
      : new LocalAdaptiveProvider(() => this.media.compiled === true))) as AdaptiveProvider;
  }
}

export const registry = new Registry();

export function useIntegrationConfig() {
  return useSyncExternalStore((fn) => registry.subscribe(fn), () => registry.config);
}

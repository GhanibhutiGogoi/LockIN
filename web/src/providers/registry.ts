/**
 * Provider registry — the one place that decides which implementation each
 * team's module uses. Defaults come from .env (VITE_*_PROVIDER / VITE_*_URL);
 * the Integrations panel can override them at runtime (saved in localStorage).
 */
import type { AdaptiveProvider, AttentionProvider, ContentProvider, MediaProvider } from '../contracts/providers';
import { traced, type Team } from '../lib/devlog';
import { load, save } from '../lib/storage';
import { HttpAdaptiveProvider, HttpContentProvider, HttpMediaProvider } from './http';
import { MockAdaptiveProvider } from './mock/adaptive';
import { MockAttentionProvider } from './mock/attention';
import { MockContentProvider } from './mock/content';
import { MockMediaProvider } from './mock/media';
import { WsAttentionProvider } from './ws/attention';

export type ServiceTeam = 'attention' | 'content' | 'media' | 'adaptive';

export interface ServiceConfig {
  /** 'mock' | 'http' | 'ws' | an in-browser plugin id */
  mode: string;
  url: string;
}
export type IntegrationConfig = Record<ServiceTeam, ServiceConfig>;

export const TEAM_INFO: Record<ServiceTeam, { title: string; zh: string; owns: string; modes: string[] }> = {
  attention: { title: 'Gaze tracking', zh: '視線追蹤', owns: 'Webcam → focus score 0–100, ~10 Hz', modes: ['mock', 'ws'] },
  content: { title: 'AI analysis', zh: 'AI 分析', owns: 'Deck parsing, script + quiz, fact-check', modes: ['mock', 'http'] },
  media: { title: 'Video', zh: '做影片', owns: 'Voice, word timings, b-roll, gameplay library', modes: ['mock', 'http'] },
  adaptive: { title: 'Personal AI', zh: '個人化 AI', owns: 'Variant picker, rewards, session review, profile memo', modes: ['mock', 'http'] },
};

const env = import.meta.env;
const DEFAULTS: IntegrationConfig = {
  attention: { mode: env.VITE_ATTENTION_PROVIDER ?? 'mock', url: env.VITE_ATTENTION_WS_URL ?? 'ws://localhost:8765' },
  content: { mode: env.VITE_CONTENT_PROVIDER ?? 'mock', url: env.VITE_CONTENT_URL ?? 'http://localhost:8000' },
  media: { mode: env.VITE_MEDIA_PROVIDER ?? 'mock', url: env.VITE_MEDIA_URL ?? 'http://localhost:8001' },
  adaptive: { mode: env.VITE_ADAPTIVE_PROVIDER ?? 'mock', url: env.VITE_ADAPTIVE_URL ?? 'http://localhost:8002' },
};
const KEY = 'lockin.integrations';

// ───────── in-browser attention plugins (for the gaze team) ─────────
const attentionPlugins = new Map<string, { label: string; create: () => AttentionProvider }>();

/**
 * Register an in-browser attention provider (e.g. MediaPipe in a Web Worker).
 * Call this from src/providers/plugins/index.ts; it then appears as a mode in
 * the Integrations panel.
 */
export function registerAttentionPlugin(id: string, label: string, create: () => AttentionProvider) {
  attentionPlugins.set(id, { label, create });
  TEAM_INFO.attention.modes = ['mock', 'ws', ...attentionPlugins.keys()];
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
  config: IntegrationConfig = { ...DEFAULTS, ...load<Partial<IntegrationConfig>>(KEY, {}) };
  private cache: Partial<Record<ServiceTeam, unknown>> = {};
  private subs = new Set<() => void>();

  set(team: ServiceTeam, patch: Partial<ServiceConfig>) {
    this.config = { ...this.config, [team]: { ...this.config[team], ...patch } };
    delete this.cache[team];
    save(KEY, this.config);
    this.subs.forEach((f) => f());
  }
  reset() {
    this.config = { ...DEFAULTS };
    this.cache = {};
    save(KEY, {});
    this.subs.forEach((f) => f());
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

  get attention(): AttentionProvider {
    const c = this.config.attention;
    return (this.cache.attention ??= (() => {
      if (c.mode === 'ws') return new WsAttentionProvider(c.url);
      const plugin = attentionPlugins.get(c.mode);
      if (plugin) return plugin.create();
      return new MockAttentionProvider();
    })()) as AttentionProvider;
  }
  get content(): ContentProvider {
    const c = this.config.content;
    return (this.cache.content ??= withTrace('content', c.mode === 'http' ? new HttpContentProvider(c.url) : new MockContentProvider())) as ContentProvider;
  }
  get media(): MediaProvider {
    const c = this.config.media;
    return (this.cache.media ??= withTrace('media', c.mode === 'http' ? new HttpMediaProvider(c.url) : new MockMediaProvider())) as MediaProvider;
  }
  get adaptive(): AdaptiveProvider {
    const c = this.config.adaptive;
    return (this.cache.adaptive ??= withTrace('adaptive', c.mode === 'http' ? new HttpAdaptiveProvider(c.url) : new MockAdaptiveProvider())) as AdaptiveProvider;
  }
}

export const registry = new Registry();

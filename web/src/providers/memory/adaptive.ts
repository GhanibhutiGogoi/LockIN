import { DEFAULT_VARIANT } from '../../contracts/defaults';
import type { AdaptiveProvider, MemorySource } from '../../contracts/providers';
import type { MemoryDecision, MemoryStyle, MemoryTopic, RescueContext, RescueOutcome, SessionLog, UserSettings, Variant, VariantChoice } from '../../contracts/types';
import { load, save } from '../../lib/storage';
import { configForSensitivity } from '../../session/machine';
import { scoreSession } from '../../session/metrics';
import { call } from '../http/client';

const TOKEN_KEY = 'lockin.memoryBankIdentity';
const STYLES = { plain: 'plain', analogies: 'analogy', memes: 'humor', roasts: 'humor' } as const;

type Retrieval = Omit<MemoryDecision, 'reason'> & {
  reason: Exclude<MemoryDecision['reason'], 'unavailable'>;
  memo: string | null;
};

export function memoryStyle(variant: Pick<Variant, 'slangLevel' | 'humourStyle'>): MemoryStyle {
  if (variant.slangLevel === 'plain' && variant.humourStyle !== 'analogies') return 'plain';
  return STYLES[variant.humourStyle];
}

function allowedStyles(settings: UserSettings, allowAnalogy = true): MemoryStyle[] {
  if (settings.slangLevel === 'plain') return ['plain'];
  return allowAnalogy ? ['plain', 'analogy', 'humor'] : ['plain', 'humor'];
}

export class MemoryAdaptiveProvider implements AdaptiveProvider {
  readonly name = 'Local memory bank';
  private token = load<string | null>(TOKEN_KEY, null);
  private identity?: Promise<string>;
  private styles?: MemoryStyle[];

  private get base() {
    return new URL('/v1/web-memory/', location.origin).href;
  }

  private async authenticate() {
    if (this.token) return this.token;
    this.identity ??= call<{ token: string }>(this.base, '/identity', { method: 'POST', timeoutMs: 900 })
      .then(({ token }) => {
        this.token = token;
        save(TOKEN_KEY, token);
        return token;
      }).finally(() => { this.identity = undefined; });
    return this.identity;
  }

  private async request<T>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}) {
    const token = await this.authenticate();
    return call<T>(this.base, path, { ...init, token, timeoutMs: init.timeoutMs ?? 900 });
  }

  async getSessionConfig(_userId: string, settings: UserSettings) {
    this.styles = allowedStyles(settings);
    return { ...configForSensitivity(settings.sensitivity), cooldownSec: settings.cooldownSec };
  }

  async chooseVariant(_context: RescueContext): Promise<VariantChoice> {
    return { variant: DEFAULT_VARIANT, isHoldout: false };
  }

  async getProfileMemo() {
    return undefined;
  }

  async retrieveMemory(deckId: string, source: MemorySource, settings: UserSettings, options: { pending?: { rescueId: string; style: MemoryStyle }[]; allowAnalogy?: boolean; topic?: MemoryTopic } = {}) {
    const styles = allowedStyles(settings, options.allowAnalogy);
    this.styles = styles;
    const { memo, ...decision } = await this.request<Retrieval>('/retrieve', {
      body: { deckId, source, allowedStyles: styles, pending: options.pending, topic: options.topic },
      timeoutMs: 2100,
    });
    if (!decision.style || !decision.reason || !decision.excluded) throw new Error('Memory bank response is missing the selection details.');
    const variant = {
      ...DEFAULT_VARIANT,
      id: `20s·memory·${decision.style}`,
      slangLevel: decision.style === 'plain' ? 'plain' as const : settings.slangLevel,
      humourStyle: decision.style === 'analogy' ? 'analogies' as const : 'memes' as const,
      voiceId: decision.style === 'plain' || settings.slangLevel === 'plain' ? 'chill' : DEFAULT_VARIANT.voiceId,
    };
    return { choice: { variant, isHoldout: false }, memo: memo ?? undefined, decision };
  }

  async reportOutcome(outcome: RescueOutcome) {
    const body = this.outcome(outcome);
    if (body) await this.request('/outcomes', { body });
  }

  async endSession(log: SessionLog) {
    const score = scoreSession(log.samples, log.rescues);
    const outcomes = log.rescues.flatMap((rescue) => {
      const outcome = this.outcome(rescue);
      return outcome ? [outcome] : [];
    });
    if (!outcomes.length) return { score };
    await this.request('/sessions', { body: { sessionId: log.sessionId, outcomes }, timeoutMs: 2500 });
    const { deckId, source } = outcomes[0];
    const { memo } = await this.request<Retrieval>('/retrieve', {
      body: { deckId, source, allowedStyles: this.styles },
    }).catch(() => ({ memo: null }));
    return { score, profileMemo: memo ?? undefined };
  }

  async clearMemory() {
    if (!this.token && !this.identity) return;
    await this.request('/history', { method: 'DELETE', timeoutMs: 2500 });
  }

  private outcome(rescue: RescueOutcome) {
    const evidence = rescue.memoryEvidence;
    if (!evidence) return undefined;
    return {
      rescueId: rescue.rescueId,
      sessionId: rescue.sessionId,
      deckId: rescue.context.deckId,
      trigger: rescue.context.trigger,
      style: memoryStyle(evidence.variant),
      clipSeconds: rescue.clipSeconds,
      skipped: rescue.skipped,
      answerCount: rescue.quiz.length,
      correctCount: rescue.quiz.filter((answer) => answer.correct).length,
      source: evidence.source,
      topic: evidence.topic,
      recoverySamples: evidence.recoverySamples,
      focusedShare: evidence.focusedShare,
    };
  }
}

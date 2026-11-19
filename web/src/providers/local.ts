import type { AdaptiveProvider, AttentionProvider, ContentProvider, MediaProvider } from '../contracts/providers';
import type { FocusSample, SessionLog, UserSettings } from '../contracts/types';
import { DEFAULT_VARIANT } from '../contracts/defaults';
import { importPdf } from '../lib/deckImport';
import { configForSensitivity } from '../session/machine';
import { scoreSession } from '../session/metrics';

export class NoAttentionProvider implements AttentionProvider {
  readonly name = 'Tab activity only';
  readonly needsCamera = false;
  async start() {}
  async stop() {}
  onSample(_cb: (s: FocusSample) => void) { return () => {}; }
}

export class LocalContentProvider implements ContentProvider {
  readonly name = 'PDF reader';
  ingestDeck = importPdf;
  async getScript(): Promise<never> { throw new Error('AI recaps are not connected on this installation. You can keep studying your slides.'); }
}

export class NoMediaProvider implements MediaProvider {
  readonly name = 'Narration unavailable';
  async renderMedia(): Promise<never> { throw new Error('Narration is not connected. You can keep studying your slides.'); }
  async listGameplayLoops() { return []; }
  async listMusicBeds() { return []; }
  async listVoices() { return []; }
}

/** Deterministic user settings and measured statistics; no simulated learning. */
export class LocalAdaptiveProvider implements AdaptiveProvider {
  readonly name = 'Your settings';
  private settings?: UserSettings;
  constructor(private readonly compiled = () => false) {}
  async getSessionConfig(_userId: string, settings: UserSettings) {
    this.settings = settings;
    return { ...configForSensitivity(settings.sensitivity), cooldownSec: settings.cooldownSec ?? 180 };
  }
  async chooseVariant() {
    const format = this.compiled() ? { targetSeconds: 30 as const, gameplayType: 'auto', id: '30s·memes·auto' } : {};
    return { variant: { ...DEFAULT_VARIANT, ...format, slangLevel: this.settings?.slangLevel ?? 'plain' }, isHoldout: false };
  }
  async reportOutcome() {}
  async endSession(log: SessionLog) { return { score: scoreSession(log.samples, log.rescues) }; }
  async getProfileMemo() { return undefined; }
}

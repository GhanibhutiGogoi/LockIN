/**
 * HTTP adapters. Each team runs a service at its own base URL and implements
 * the endpoints listed in docs/INTEGRATION.md. Responses are validated against
 * the contracts; problems surface in the Integrations panel.
 */
import type { AdaptiveProvider, ContentProvider, MediaProvider } from '../../contracts/providers';
import type {
  Deck,
  GameplayLoop,
  MusicBed,
  RescueContext,
  RescueMedia,
  RescueOutcome,
  RescueScript,
  SessionConfig,
  SessionLog,
  SessionReview,
  Slide,
  UserSettings,
  Variant,
  VariantChoice,
} from '../../contracts/types';
import { DEFAULT_VARIANT } from '../../contracts/defaults';
import { assertContract, checkChoice, checkDeck, checkMedia, checkReview, checkScript } from '../../contracts/validate';
import { call, resolveUrl } from './client';

// ───────── AI 分析 ─────────
export class HttpContentProvider implements ContentProvider {
  readonly name: string;
  constructor(private base: string) {
    this.name = `HTTP · ${base}`;
  }
  async ingestDeck(file: File): Promise<Deck> {
    const form = new FormData();
    form.append('file', file);
    const deck = await call<Deck>(this.base, '/decks', { form, timeoutMs: 120_000 });
    deck.pdfUrl = resolveUrl(this.base, deck.pdfUrl);
    deck.slides?.forEach((s) => (s.imageUrl = resolveUrl(this.base, s.imageUrl)));
    deck.slideCount ??= deck.slides?.length ?? 0;
    return assertContract('AI analysis · POST /decks', deck, checkDeck);
  }
  async getScript(args: { deck: Deck; slide: Slide; variant: Variant; profileMemo?: string; depth: 1 | 2 }): Promise<RescueScript> {
    const script = await call<RescueScript>(this.base, '/scripts', {
      body: {
        deckId: args.deck.id,
        slideIndex: args.slide.index,
        // send the slide too, so a stateless service can work without ingesting
        slide: args.slide,
        deckTitle: args.deck.title,
        neighbourTitles: [args.deck.slides[args.slide.index - 1]?.title, args.deck.slides[args.slide.index + 1]?.title].filter(Boolean),
        variant: args.variant,
        profileMemo: args.profileMemo,
        depth: args.depth,
      },
    });
    return assertContract('AI analysis · POST /scripts', script, checkScript);
  }
  prewarm(deckId: string, slideIndex: number) {
    call(this.base, `/decks/${encodeURIComponent(deckId)}/prewarm`, { body: { slideIndex } }).catch(() => {});
  }
  reportWrongFact(deckId: string, slideIndex: number, variantId: string, note?: string) {
    call(this.base, '/feedback/wrong-fact', { body: { deckId, slideIndex, variantId, note } }).catch(() => {});
  }
  retractWrongFact(deckId: string, slideIndex: number, variantId: string) {
    call(this.base, '/feedback/wrong-fact', { body: { deckId, slideIndex, variantId, retracted: true } }).catch(() => {});
  }
}

// ───────── 做影片 ─────────
export class HttpMediaProvider implements MediaProvider {
  readonly name: string;
  constructor(private base: string) {
    this.name = `HTTP · ${base}`;
  }
  async renderMedia(args: { deckId: string; slideIndex: number; script: RescueScript; variant: Variant }): Promise<RescueMedia> {
    const media = await call<RescueMedia>(this.base, '/media', { body: args, timeoutMs: 60_000 });
    media.audioUrl = resolveUrl(this.base, media.audioUrl);
    media.broll = (media.broll ?? []).map((b) => ({ ...b, url: resolveUrl(this.base, b.url)! }));
    return assertContract('Video · POST /media', media, (m) => checkMedia(m, `${args.script.hook} ${args.script.script}`));
  }
  async listGameplayLoops(): Promise<GameplayLoop[]> {
    const loops = await call<GameplayLoop[]>(this.base, '/library/gameplay');
    return loops.map((l) => ({ ...l, url: resolveUrl(this.base, l.url) }));
  }
  async listMusicBeds(): Promise<MusicBed[]> {
    const beds = await call<MusicBed[]>(this.base, '/library/music');
    return beds.map((b) => ({ ...b, url: resolveUrl(this.base, b.url)! }));
  }
  async listVoices() {
    return call<{ id: string; label: string }[]>(this.base, '/voices');
  }
}

// ───────── 個人化 AI ─────────
export class HttpAdaptiveProvider implements AdaptiveProvider {
  readonly name: string;
  constructor(private base: string) {
    this.name = `HTTP · ${base}`;
  }
  getSessionConfig(userId: string, settings: UserSettings) {
    return call<Partial<SessionConfig>>(this.base, '/config', { body: { userId, settings } });
  }
  async chooseVariant(ctx: RescueContext): Promise<VariantChoice> {
    const c = await call<VariantChoice>(this.base, '/choose', { body: { context: ctx }, timeoutMs: 1500 });
    // a partial variant keeps the defaults for the knobs it leaves out
    if (c?.variant && typeof c.variant === 'object') c.variant = { ...DEFAULT_VARIANT, ...c.variant };
    return assertContract('Personal AI · POST /choose', c, checkChoice);
  }
  reportOutcome(o: RescueOutcome) {
    return call<void>(this.base, '/outcomes', { body: o });
  }
  async endSession(log: SessionLog): Promise<SessionReview> {
    const r = await call<SessionReview>(this.base, '/sessions', { body: log, timeoutMs: 60_000 });
    return assertContract('Personal AI · POST /sessions', r, checkReview);
  }
  async getProfileMemo(userId: string) {
    const r = await call<{ memo?: string }>(this.base, `/profile/${encodeURIComponent(userId)}`);
    return r?.memo;
  }
}

/**
 * LockIn — the four integration points.
 *
 * Each team implements ONE interface below. The UI only ever talks to these
 * interfaces, so a team can swap mock → real without touching UI code.
 *
 *   視線追蹤 (gaze tracking)        → AttentionProvider   (runs in the browser, or streams via WebSocket)
 *   AI 分析  (slide → script/quiz)   → ContentProvider     (HTTP)
 *   做影片   (voice/captions/b-roll) → MediaProvider       (HTTP)
 *   個人化 AI (bandit / profile)      → AdaptiveProvider    (HTTP)
 *
 * See docs/INTEGRATION.md for wire formats and how to plug in.
 */
import type {
  CalibrationPoint,
  Deck,
  FocusSample,
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
} from './types';

export type Unsubscribe = () => void;

// ───────────────────────── 視線追蹤 ─────────────────────────

export type AttentionStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface AttentionProvider {
  readonly name: string;
  /**
   * Start tracking. The UI hands over the camera stream it already opened
   * (so there is exactly one camera indicator). Providers that use their own
   * capture (e.g. a native process over WebSocket) may ignore it.
   */
  start(stream: MediaStream | null): Promise<void>;
  stop(): Promise<void>;
  /** Emit ~10 Hz. The UI smooths, applies window focus, and runs the state machine. */
  onSample(cb: (s: FocusSample) => void): Unsubscribe;
  onStatus?(cb: (status: AttentionStatus, detail?: string) => void): Unsubscribe;
  /** Calibration: the UI shows a dot at `point`, then awaits this promise before moving on. */
  calibratePoint?(point: CalibrationPoint): Promise<void>;
  /** Called after the 20 s normal-reading baseline. */
  finishCalibration?(): Promise<void>;
  /** "Were you focused just now?" probe answer — use it to tune per-user detection. */
  reportProbe?(t: number, userSaysFocused: boolean): void;
  /** True if the provider needs a camera stream from the UI. */
  readonly needsCamera: boolean;
}

// ───────────────────────── AI 分析 ─────────────────────────

export interface ContentProvider {
  readonly name: string;
  /** Parse a PDF/PPTX into slides (Docling etc.). */
  ingestDeck(file: File): Promise<Deck>;
  /**
   * Write (and fact-check) the brain-rot script + quiz for one slide.
   * Should be cache-backed: the UI calls this for the current slide and two ahead.
   */
  getScript(args: {
    deck: Deck;
    slide: Slide;
    variant: Variant;
    profileMemo?: string;
    /** "deeper" = the second clip on the same slide */
    depth: 1 | 2;
  }): Promise<RescueScript>;
  /** Optional hint: user is now on this slide; start generating ahead. */
  prewarm?(deckId: string, slideIndex: number): void;
  /** User pressed "that's wrong" on a clip. */
  reportWrongFact?(deckId: string, slideIndex: number, variantId: string, note?: string): void;
  /** User pressed it again on the same clip: take the report back. */
  retractWrongFact?(deckId: string, slideIndex: number, variantId: string): void;
}

// ───────────────────────── 做影片 ─────────────────────────

export interface MediaProvider {
  readonly name: string;
  /** TTS + forced-aligned captions + key-term b-roll for a script. */
  renderMedia(args: {
    deckId: string;
    slideIndex: number;
    script: RescueScript;
    variant: Variant;
  }): Promise<RescueMedia>;
  listGameplayLoops(): Promise<GameplayLoop[]>;
  listMusicBeds(): Promise<MusicBed[]>;
  /** Voices the bandit may choose from. */
  listVoices(): Promise<{ id: string; label: string }[]>;
}

// ───────────────────────── 個人化 AI ─────────────────────────

export interface AdaptiveProvider {
  readonly name: string;
  /** Per-user thresholds (trigger delay, nudge-first, cooldown…). */
  getSessionConfig(userId: string, settings: UserSettings): Promise<Partial<SessionConfig>>;
  /** Linear Thompson sampling (or whatever) — pick the style for this rescue. */
  chooseVariant(ctx: RescueContext): Promise<VariantChoice>;
  /** Sent once A_after is known (~60 s after returning). Compute and store the reward. */
  reportOutcome(outcome: RescueOutcome): Promise<void>;
  /** Session ended — score it, update profile memo, return what to show in the report. */
  endSession(log: SessionLog): Promise<SessionReview>;
  /** Current "what works for you" memo; fed into the script prompt. */
  getProfileMemo(userId: string): Promise<string | undefined>;
}

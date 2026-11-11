/**
 * LockIn — shared data types.
 *
 * This file is the single source of truth for every shape that crosses a team
 * boundary. Field names mirror the data model in the proposal (camelCase here,
 * snake_case on the wire is accepted by the HTTP adapters — see docs/INTEGRATION.md).
 *
 * Change rule: add optional fields freely; renaming/removing a field needs all
 * four teams to agree, because it breaks someone's adapter.
 */

// ───────────────────────── Deck & slides (AI 分析 owns ingestion) ─────────────────────────

export type SourceType = 'pdf' | 'pptx' | 'demo';

export interface Slide {
  /** 0-based slide index. */
  index: number;
  title: string;
  /** Plain body text extracted from the slide. */
  text: string;
  /** Speaker notes, if any. */
  notes?: string;
  /** Rendered image of the slide (PNG/JPEG URL or data URL). Optional: the UI can render PDFs itself. */
  imageUrl?: string;
  /** 0–1, how hard the slide is. Used as a bandit context feature. */
  difficulty?: number;
}

export interface Deck {
  id: string;
  title: string;
  sourceType: SourceType;
  slideCount: number;
  slides: Slide[];
  /**
   * URL of a PDF the UI can render with PDF.js (for PPTX the backend converts it).
   * If absent, the UI renders `slide.imageUrl`, or falls back to a text slide.
   */
  pdfUrl?: string;
}

// ───────────────────────── Variants (個人化 AI picks, AI 分析 + 影片 produce) ─────────────────────────

export type SlangLevel = 'plain' | 'mild' | 'unhinged';
export type HumourStyle = 'memes' | 'analogies' | 'roasts';
export type ClipSeconds = 20 | 40 | 60;

/** One combination of the "knobs" from the proposal. */
export interface Variant {
  id: string;
  targetSeconds: ClipSeconds;
  slangLevel: SlangLevel;
  humourStyle: HumourStyle;
  /** Narrator voice id from the media team's voice library. */
  voiceId: string;
  /** Speaking-speed multiplier, 1 = normal. */
  pacing: number;
  /** Gameplay loop category, e.g. "parkour", "runner", "kinetic-sand", "marble". */
  gameplayType: string;
  recapOrPreview: 'recap' | 'preview';
  /** Number of quiz questions to show (0–2). */
  quizCount: 0 | 1 | 2;
}

// ───────────────────────── Script (AI 分析 output) ─────────────────────────

export interface QuizQuestion {
  question: string;
  options: string[];
  answerIndex: number;
  ifRight: string;
  ifWrong: string;
}

export interface KeyTerm {
  term: string;
  brollPrompt: string;
}

/** Matches the "Output schema" JSON in the proposal. */
export interface RescueScript {
  variant: Pick<Variant, 'targetSeconds' | 'slangLevel' | 'humourStyle'>;
  hook: string;
  script: string;
  keyTerms: KeyTerm[];
  quiz: QuizQuestion[];
  /** Two sentences, no slang — used in the session report. */
  plainSummary: string;
  /** True if the fact-check pass rewrote anything. */
  factChecked?: boolean;
  /** True if the slide was flagged sensitive and plain mode was forced. */
  sensitive?: boolean;
}

// ───────────────────────── Media (影片 output) ─────────────────────────

export interface CaptionWord {
  word: string;
  /** Seconds from start of narration. */
  start: number;
  end: number;
}

export interface BrollClip {
  term: string;
  /** Video (mp4/webm) or image URL. */
  url: string;
  kind: 'video' | 'image';
  /**
   * When in the narration (seconds from t = 0 of the audio) to cut to it. If
   * omitted, the UI cuts to it when the caption word matching `term` is spoken.
   */
  at?: number;
  /** How long to show it, in seconds. Default 2.6. Only used together with `at`. */
  duration?: number;
}

export interface RescueMedia {
  /**
   * Narration audio URL. If absent, the UI falls back to the browser's
   * speechSynthesis using `captions` timing (that's what the mock does).
   */
  audioUrl?: string;
  captions: CaptionWord[];
  durationSec: number;
  broll: BrollClip[];
}

export interface GameplayLoop {
  id: string;
  type: string;
  /** 0–1 */
  energy: number;
  /** Portrait mp4/webm. If absent, the UI draws a procedural placeholder. */
  url?: string;
}

export interface MusicBed {
  id: string;
  tempo: number;
  energy: number;
  url: string;
}

/** What the rescue player actually plays. Composed live, never pre-rendered. */
export interface RescuePack {
  deckId: string;
  slideIndex: number;
  variant: Variant;
  script: RescueScript;
  media: RescueMedia;
  modelVersions?: Record<string, string>;
}

// ───────────────────────── Attention (視線追蹤 output) ─────────────────────────

/** Each signal normalised to 0–1. All optional: send what you have. */
export interface FocusSignals {
  /** g — gaze on screen */
  gaze?: number;
  /** h — head facing screen */
  head?: number;
  /** e — eyes open */
  eyesOpen?: number;
  /** f — face present */
  facePresent?: number;
}

export interface FocusSample {
  /** ms since epoch (Date.now()) */
  t: number;
  /** 0–100 focus score from the camera only. Window focus is added by the UI. */
  score: number;
  signals?: FocusSignals;
  /** 0–1. Frames below ~0.3 (glare, dim light) are ignored, not scored as drift. */
  confidence: number;
  /** Optional on-screen gaze point in viewport-normalised coords 0–1. */
  gazePoint?: { x: number; y: number };
}

export interface CalibrationPoint {
  /** Viewport-normalised 0–1. */
  x: number;
  y: number;
}

// ───────────────────────── Session (UI owns; 個人化 AI consumes) ─────────────────────────

export type FocusState =
  | 'idle'
  | 'focused'
  | 'drifting'
  | 'lapse'
  | 'rescue'
  | 'recovering'
  | 'break'
  | 'paused';

export type LapseTrigger = 'gaze' | 'window' | 'drowsy';

/** Thresholds the state machine uses. 個人化 AI may return per-user overrides. */
export interface SessionConfig {
  enterFocused: number; // 65
  enterDrifting: number; // 45
  driftToLapseSec: number; // 8
  driftToFocusedSec: number; // 2
  windowInactiveLapseSec: number; // 5
  eyesClosedLapseSec: number; // 3
  recoverFocusedSec: number; // 4
  recoverTimeoutSec: number; // how long to wait in Recovering before a deeper clip
  maxRescuesInRow: number; // 2
  cooldownSec: number; // 180
  maxRescueShare: number; // 0.15 of session time
  noteTakingGraceSec: number; // 60
  /** Soft nudge (glow) only, never full rescue. */
  nudgeOnly: boolean;
}

/** Context features handed to the bandit when picking a variant. */
export interface RescueContext {
  userId: string;
  deckId: string;
  slideIndex: number;
  minutesIntoSession: number;
  /** How far the score dropped below the drift threshold (0–1). */
  lapseDepth: number;
  slideDifficulty: number;
  trigger: LapseTrigger;
  /** 1 for the first clip, 2 for the "deeper" second one. */
  rescueInRow: number;
  rescuesSoFar: number;
  recentVariantIds: string[];
  hourOfDay: number;
}

export interface VariantChoice {
  variant: Variant;
  /** True when this rescue is in the 5 % random holdout. */
  isHoldout: boolean;
  /** True when the bandit is exploring rather than exploiting. */
  isExplore?: boolean;
  /** Return 'skip' to run the "no clip, short break" control arm. */
  action?: 'clip' | 'skip';
}

/** Everything the reward function needs. Logged ~60 s after the user returns. */
export interface RescueOutcome {
  rescueId: string;
  sessionId: string;
  userId: string;
  context: RescueContext;
  variantId: string;
  isHoldout: boolean;
  startedAt: number;
  endedAt: number;
  /** Seconds of clip actually played. */
  clipSeconds: number;
  skipped: boolean;
  /** Per question: chosen index, correct? */
  quiz: { questionIndex: number; chosen: number; correct: boolean }[];
  /**
   * Seconds from returning to the slide (clip and question over) to Focused
   * again; null if the user never refocused. The clip itself is not counted.
   */
  timeToRefocusSec: number | null;
  /** Share of the 60 s after returning to the slide spent Focused (A_after). */
  attentionAfter: number | null;
}

export interface FocusLogEntry {
  /** seconds since session start */
  t: number;
  score: number;
  state: FocusState;
  slideIndex: number;
}

export interface SessionLog {
  sessionId: string;
  userId: string;
  deckId: string;
  startedAt: number;
  endedAt: number;
  /** 1 Hz focus trace. Raw video never appears anywhere. */
  samples: FocusLogEntry[];
  rescues: RescueOutcome[];
}

export interface SessionScore {
  sustainedEpisodeMedianSec: number;
  onTaskShare: number;
  lapsesPer30Min: number;
  timeToRefocusMedianSec: number | null;
  quizAccuracy: number | null;
  focusedMinutes: number;
  /** Relative change vs the user's rolling 5-session baseline, if known. */
  deltaVsBaseline?: number | null;
}

export interface SessionReview {
  score: SessionScore;
  /** Short "what works for this learner" note (Opus). */
  profileMemo?: string;
  /** Free-form suggestions to show the user. */
  tips?: string[];
}

export interface UserSettings {
  userId: string;
  slangLevel: SlangLevel;
  /** 0–1: higher = triggers sooner. */
  sensitivity: number;
  roastsEnabled: boolean;
  backgroundStyle: string;
  cooldownSec: number;
  /** Only the soft edge glow, never a full takeover. */
  nudgeOnly?: boolean;
}

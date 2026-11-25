import type { ActivityLabel } from '../lib/screenActivity';

export interface TextBlock {
  text: string;
  confidence: number;
  polygon: [number, number][];
}

export interface ScreenScene {
  id: number;
  timestamp: number;
  observedUntil: number;
  width: number;
  height: number;
  displaySurface: string;
  status: 'pending' | 'ready' | 'no-text' | 'error' | 'skipped';
  label: ActivityLabel | 'checking' | null;
  completedAt?: number;
  processingStartedAt?: number;
  ocrDurationMs?: number;
  classifiedAt?: number;
  classificationStartedAt?: number;
  text?: string;
  studyText?: string;
  classification?: { reason?: string; rawDecision?: string | null; evidence?: { id: number; text: string }[] };
  blocks?: TextBlock[];
  slideIndex?: number;
  message?: string;
}

export type AttentionEvidence = 'focused' | 'looking-away' | 'off-topic' | 'unknown' | 'excluded';

export interface ScreenMeasurement {
  timestamp: number;
  durationMs: number;
  sceneId?: number;
  evidence: AttentionEvidence;
  reason: string;
  textRegion?: 'overlap' | 'outside' | 'unmapped';
}

export interface AttentionWindow {
  timestamp: number;
  endTimestamp: number;
  focusedMs: number;
  lookingAwayMs: number;
  offTopicMs: number;
  unknownMs: number;
  excludedMs: number;
  sceneIds: number[];
}

export interface ScreenAnalysis {
  version: 1;
  windowMs: number;
  timestampUnit: 'unix-ms';
  scenes: ScreenScene[];
  measurements: ScreenMeasurement[];
  windows: AttentionWindow[];
  droppedGazeSamples: number;
  droppedScenes: number;
  events: { timestamp: number; type: string; sceneId?: number; detail?: string }[];
  controlSamples?: { timestamp: number; state: string; dwellMs: number; cooldownRemainingMs: number;
    recoveryWait?: string; preparation?: string; pageVisible: boolean; windowActive: boolean; gazeAgeMs: number | null }[];
  summary?: ScreenSummary;
}

export interface ScreenSummary {
  focusedMs: number;
  lookingAwayMs: number;
  offTopicMs: number;
  unknownMs: number;
  excludedMs: number;
  measuredMs: number;
  longestFocusMs: number;
  medianFocusMs: number;
  unknownReasons: { reason: string; durationMs: number }[];
}

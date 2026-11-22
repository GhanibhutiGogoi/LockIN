export type ScreenKind = 'study' | 'entertainment' | 'unknown';
export type Style = 'plain' | 'analogy' | 'humor';
export type Pace = 'slow' | 'normal' | 'fast';
export interface Observation {
  t: number; valid: boolean; onScreen: boolean | null; visible: boolean;
  screen: ScreenKind; source: 'manual' | 'model';
  gaze?: number[]; features?: number[];
}
export interface Evidence { kind: 'on-task' | 'off-task' | 'unknown'; reason: 'study' | 'look-away' | 'entertainment' | 'unknown' }
export interface Preferences { style: Style; pace: Pace; language: 'zh' | 'en'; maxSeconds: number }
export interface Profile { id: string; name: string; preferences: Preferences; createdAt: string }
export type Quiz = { kind: 'choice'; question: string; options: string[]; correctIndex: number } | { kind: 'recall'; question: string };
export interface VideoAsset { id: string; title: string; style: Style; pace: Pace; goal: string; url: string; durationSeconds: number; quiz: Quiz; source: 'local' }
export interface RecoverySummary {
  watchedMs: number; watchValidMs: number; watchOnScreenShare: number | null;
  observationMs: number; validMs: number; onTaskMs: number; offTaskMs: number; unknownMs: number;
  coverage: number; onTaskShare: number | null; recoveredAfterMs: number | null; relapseAfterMs: number | null;
  completed: boolean; censoredReason: string | null; quizCorrect: boolean | null;
}
export interface EpisodeRecord {
  id: string; sessionId: string; profileId: string; goal: string; studyContext: string;
  triggerAt: number; triggerReason: 'look-away' | 'entertainment' | 'manual'; mode: 'automatic' | 'manual';
  createdAt: string; video: Omit<VideoAsset, 'url'> | null;
  playbackAt: number | null; returnedAt: number | null; answer: string | number | null;
  summary: RecoverySummary | null;
  annotation: { falseAlarm: boolean | null; helped: -1 | 0 | 1 | null; note: string };
}
export interface SessionRecord {
  id: string; profileId: string; goal: string; studyContext: string;
  startedAt: string; startedAtT?: number; endedAt: string | null; endReason: string | null;
  samples: Observation[]; traceTruncated: boolean; episodeIds: string[];
}
export interface StyleEvidence { style: Style; count: number; meanOnTaskShare: number; meanRecoveryMs: number | null }
export interface MemoryView { eligibleCount: number; styles: StyleEvidence[]; memo: string }
export interface GenerationRequest {
  schemaVersion: 1; requestId: string; userId: string; goal: string;
  studyContext: { text: string; source: 'user'; capturedAt: string };
  trigger: { reason: EpisodeRecord['triggerReason']; mode: EpisodeRecord['mode']; detectedAt: string };
  personalization: { preferences: Preferences; evidence: StyleEvidence[]; memo: string };
  constraints: { mustAnswerQuiz: true }; mode: 'local-video';
}
export interface VideoProvider { prepare(request: GenerationRequest): Promise<VideoAsset> }

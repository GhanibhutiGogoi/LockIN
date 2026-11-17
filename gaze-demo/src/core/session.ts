import { AttentionDetector, classify } from './attention.ts';
import { RecoveryTracker } from './recovery.ts';
import type { EpisodeRecord, Observation, ScreenKind, SessionRecord, VideoAsset } from './types.ts';

export class StudySession {
  phase: 'studying' | 'preparing' | 'video' | 'quiz' | 'observing' | 'ended' = 'studying';
  readonly episodes: EpisodeRecord[] = [];
  readonly record: SessionRecord;
  private detector: AttentionDetector;
  private tracker: RecoveryTracker | null = null;
  private activeId: string | null = null;
  private startT: number;
  private epoch: number;
  private lastT: number;
  private lastObservationT = -Infinity;
  private cooldownUntil = 0;
  private lastSample = -Infinity;
  private windowMs: number;
  private lastContext: string;
  detection = { ...classify({ t: 0, valid: false, visible: false, onScreen: null, screen: 'unknown', source: 'manual' }), heldMs: 0, trigger: false };
  constructor(options: { id: string; profileId: string; goal: string; studyContext: string; startedAt: number; epoch: number; triggerHoldMs?: number; windowMs?: number }) {
    if (!options.goal.trim()) throw new Error('请先输入本次学习目标');
    this.startT = options.startedAt; this.lastT = options.startedAt; this.epoch = options.epoch;
    this.windowMs = options.windowMs ?? 120000;
    this.detector = new AttentionDetector(options.triggerHoldMs);
    this.lastContext = options.studyContext.trim() || options.goal.trim();
    this.record = { id: options.id, profileId: options.profileId, goal: options.goal.trim(), studyContext: this.lastContext, startedAt: new Date(options.epoch).toISOString(), startedAtT: options.startedAt, endedAt: null, endReason: null, samples: [], traceTruncated: false, episodeIds: [] };
  }
  private iso(t: number) { return new Date(this.epoch + t - this.startT).toISOString(); }
  get active() { return this.episodes.find(e => e.id === this.activeId) ?? null; }
  get cooldownRemainingMs() { return Math.max(0, this.cooldownUntil - this.lastT); }
  updateStudyContext(text: string, screen: ScreenKind) { if (screen === 'study' && text.trim() && this.phase === 'studying') this.lastContext = text.trim(); }
  observe(o: Observation) {
    if (this.phase === 'ended' || !Number.isFinite(o.t) || o.t < this.startT || o.t <= this.lastObservationT) return;
    this.lastObservationT = o.t;
    this.lastT = Math.max(this.lastT, o.t);
    if (o.t - this.lastSample >= 1000) {
      if (this.record.samples.length < 20000) this.record.samples.push({ ...o, gaze: o.gaze ? [...o.gaze] : undefined, features: o.features ? [...o.features] : undefined });
      else this.record.traceTruncated = true;
      this.lastSample = o.t;
    }
    if (this.phase === 'studying' && o.t >= this.cooldownUntil) this.detection = this.detector.push(o);
    else { this.detector.reset(); this.detection = { ...classify(o), trigger: false, heldMs: 0 }; }
    this.tracker?.observe(o);
    this.tick(o.t);
    if (this.phase === 'studying' && o.t >= this.cooldownUntil && this.detection.trigger && (this.detection.reason === 'look-away' || this.detection.reason === 'entertainment')) this.requestIntervention(o.t, this.detection.reason);
  }
  tick(t: number) {
    if (this.phase === 'ended' || !Number.isFinite(t) || t < this.lastT) return;
    this.lastT = t;
    if (this.phase === 'observing' && this.active?.returnedAt !== null && this.active?.returnedAt !== undefined && t >= this.active.returnedAt + this.windowMs) this.closeActive(this.active.returnedAt + this.windowMs, 'complete');
  }
  requestIntervention(t: number, reason: EpisodeRecord['triggerReason'] = 'manual') {
    if (this.phase !== 'studying') throw new Error('当前干预尚未结束，请先完成本次流程');
    const e: EpisodeRecord = {
      id: `${this.record.id}:episode:${this.episodes.length + 1}`, sessionId: this.record.id, profileId: this.record.profileId,
      goal: this.record.goal, studyContext: this.lastContext, triggerAt: t, triggerReason: reason, mode: reason === 'manual' ? 'manual' : 'automatic',
      createdAt: this.iso(t), video: null, playbackAt: null, returnedAt: null, answer: null, summary: null,
      annotation: { falseAlarm: null, helped: null, note: '' },
    };
    this.episodes.push(e); this.record.episodeIds.push(e.id); this.activeId = e.id;
    this.tracker = new RecoveryTracker({ windowMs: this.windowMs }); this.phase = 'preparing';
    return e;
  }
  videoReady(asset: VideoAsset) {
    if (this.phase !== 'preparing' || !this.active) throw new Error('没有待处理的视频请求');
    const q = asset.quiz;
    if (!q.question.trim() || (q.kind === 'choice' && (q.options.length < 2 || !Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= q.options.length))) throw new Error('视频问题格式无效');
    const { url: _url, ...metadata } = asset; this.active.video = structuredClone(metadata);
  }
  play(t: number) {
    if (!this.active?.video || !this.tracker || (this.phase !== 'preparing' && this.phase !== 'video')) throw new Error('视频尚未准备好');
    if (this.tracker.phase === 'playing') return;
    this.tracker.play(t); this.phase = 'video'; if (this.active.playbackAt === null) this.active.playbackAt = t;
  }
  pause(t: number) { this.tracker?.pause(t); }
  endVideo(t: number) { if (this.phase !== 'video' || !this.tracker) throw new Error('视频尚未开始播放'); this.tracker.endVideo(t); this.phase = 'quiz'; }
  answer(t: number, answer: string | number): boolean | null {
    if (this.phase !== 'quiz' || !this.active?.video || !this.tracker) throw new Error('请先看完视频再答题');
    const q = this.active.video.quiz; let correct: boolean | null = null;
    if (q.kind === 'choice') {
      if (typeof answer !== 'number' || !Number.isInteger(answer) || answer < 0 || answer >= q.options.length) throw new Error('请选择一个答案');
      correct = answer === q.correctIndex;
    } else if (typeof answer !== 'string' || !answer.trim()) throw new Error('请写下一个回忆要点后返回学习');
    this.active.answer = typeof answer === 'string' ? answer.trim().slice(0, 2000) : answer;
    this.active.returnedAt = t; this.tracker.answer(t, correct); this.phase = 'observing'; return correct;
  }
  currentSummary(t: number) { return this.tracker?.snapshot(t) ?? null; }
  failIntervention(t: number, reason: string) { if (this.active) this.closeActive(t, reason); }
  private closeActive(t: number, reason: string) {
    if (!this.active || !this.tracker) return;
    this.active.summary = this.tracker.finish(t, reason); this.activeId = null; this.tracker = null;
    this.phase = 'studying'; this.cooldownUntil = t + 15000; this.detector.reset();
  }
  end(t: number, reason: string) {
    if (this.phase === 'ended') return;
    if (this.active) this.closeActive(t, reason);
    this.phase = 'ended'; this.record.endedAt = this.iso(t); this.record.endReason = reason;
  }
}

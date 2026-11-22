import type { FocusLogEntry, FocusSample } from '../contracts/types';
import type { ScreenAnalysis, ScreenMeasurement, ScreenScene } from './types';
import { summarizeScreenAnalysis } from './summary';

export const SCENE_GAP_MS = 2500;
const GAZE_GAP_MS = 1200;
const GAZE_SUPPORT_MS = 350;
const MAX_GAZE = 72_000;
const MAX_SCENES = 2000;

interface Observation { sample: FocusSample; excluded: boolean }

/** Timestamped evidence is resolved after OCR, never shifted to response time. */
export class ScreenTimeline {
  scenes: ScreenScene[] = [];
  events: ScreenAnalysis['events'] = [];
  private gaze: Observation[] = [];
  private serial = 0;
  private droppedGazeSamples = 0;
  private droppedScenes = 0;
  private exclusions: { timestamp: number; endTimestamp?: number; reason: string }[] = [];
  current?: ScreenScene;

  constructor(readonly startedAt: number, readonly goal: string) {}

  observe(timestamp: number, changed: boolean, width: number, height: number, displaySurface: string) {
    let scene = this.current;
    if (!scene || changed || timestamp - scene.observedUntil > SCENE_GAP_MS) {
      // Hold a recently observed page until the next capture establishes a change.
      if (scene && timestamp - scene.observedUntil <= SCENE_GAP_MS) scene.observedUntil = timestamp;
      scene = { id: ++this.serial, timestamp, observedUntil: timestamp, width, height, displaySurface,
        status: 'pending', label: this.goal ? 'checking' : null };
      this.scenes.push(scene);
      this.current = scene;
      if (this.scenes.length > MAX_SCENES) { this.scenes.shift(); this.droppedScenes++; }
    }
    scene.observedUntil = timestamp;
    return scene;
  }

  breakScene(timestamp = Date.now()) {
    if (this.current && timestamp >= this.current.observedUntil && timestamp - this.current.observedUntil <= SCENE_GAP_MS) {
      this.current.observedUntil = timestamp;
    }
    this.current = undefined;
  }

  exclude(timestamp: number, reason: string) {
    if (this.exclusions.length && this.exclusions.at(-1)!.endTimestamp === undefined) return;
    this.exclusions.push({ timestamp, reason });
  }

  resume(timestamp: number) {
    const last = this.exclusions.at(-1);
    if (last && last.endTimestamp === undefined) last.endTimestamp = timestamp;
  }

  event(type: string, detail?: string, timestamp = Date.now()) {
    this.events.push({ timestamp, type, sceneId: this.current?.id, detail });
    if (this.events.length > 3000) this.events.shift();
  }

  record(sample: FocusSample, excluded: boolean, receivedAt: number) {
    const previous = this.gaze.at(-1)?.sample;
    if (!Number.isFinite(sample.t) || sample.t < this.startedAt || sample.t > receivedAt
      || receivedAt - sample.t >= GAZE_GAP_MS || (previous && sample.t <= previous.t)) return;
    this.gaze.push({ sample, excluded });
    if (this.gaze.length > MAX_GAZE) { this.gaze.splice(0, 1000); this.droppedGazeSamples += 1000; }
  }

  /** Only continuously observed, unchanged content can refresh a slow OCR result. */
  live(now: number) {
    const scene = this.current;
    return scene && now - scene.observedUntil <= SCENE_GAP_MS ? scene : undefined;
  }

  analyze(endedAt: number): ScreenAnalysis {
    let measurements: ScreenMeasurement[] = [];
    let sceneIndex = 0;
    for (let i = 0; i < this.gaze.length; i++) {
      const { sample, excluded } = this.gaze[i];
      const next = this.gaze[i + 1];
      const supported = next && next.sample.t - sample.t < GAZE_GAP_MS
        && sample.confidence >= .3 && next.sample.confidence >= .3
        && !!sample.gazeTracking && sample.gazeTracking.state === next.sample.gazeTracking?.state
        && excluded === next.excluded;
      const end = Math.min(endedAt, next?.sample.t ?? sample.t + GAZE_SUPPORT_MS,
        supported ? next!.sample.t : sample.t + GAZE_SUPPORT_MS);
      let timestamp = sample.t;
      while (timestamp < end) {
        while (sceneIndex < this.scenes.length && this.scenes[sceneIndex].observedUntil <= timestamp) sceneIndex++;
        const candidate = this.scenes[sceneIndex];
        const scene = candidate && candidate.timestamp <= timestamp ? candidate : undefined;
        const until = Math.min(end, scene?.observedUntil ?? candidate?.timestamp ?? end);
        if (until <= timestamp) break;
        measurements.push({ timestamp, durationMs: until - timestamp, sceneId: scene?.id,
          ...evaluate(sample, excluded, scene, !!this.goal) });
        timestamp = until;
      }
    }
    // Pauses and interventions remain excluded even when no camera frames arrive.
    for (const interval of this.exclusions) {
      const from = Math.max(this.startedAt, interval.timestamp);
      const to = Math.min(endedAt, interval.endTimestamp ?? endedAt);
      if (to <= from) continue;
      measurements = measurements.flatMap(m => {
        const end = m.timestamp + m.durationMs;
        if (end <= from || m.timestamp >= to) return [m];
        const pieces: ScreenMeasurement[] = [];
        if (m.timestamp < from) pieces.push({ ...m, durationMs: from - m.timestamp });
        if (end > to) pieces.push({ ...m, timestamp: to, durationMs: end - to });
        return pieces;
      });
      measurements.push({ timestamp: from, durationMs: to - from, evidence: 'excluded', reason: interval.reason });
    }
    measurements.sort((a, b) => a.timestamp - b.timestamp);
    const windows: ScreenAnalysis['windows'] = [];
    for (let timestamp = this.startedAt; timestamp < endedAt; timestamp += 5000) {
      const endTimestamp = Math.min(timestamp + 5000, endedAt);
      windows.push({ timestamp, endTimestamp, focusedMs: 0, lookingAwayMs: 0, offTopicMs: 0,
        unknownMs: endTimestamp - timestamp, excludedMs: 0, sceneIds: [] });
    }
    for (const measurement of measurements) {
      const end = measurement.timestamp + measurement.durationMs;
      for (let timestamp = measurement.timestamp; timestamp < end;) {
        const window = windows[Math.floor((timestamp - this.startedAt) / 5000)];
        if (!window) break;
        const duration = Math.min(window.endTimestamp, end) - timestamp;
        const key = { focused: 'focusedMs', 'looking-away': 'lookingAwayMs', 'off-topic': 'offTopicMs', excluded: 'excludedMs', unknown: 'unknownMs' } as const;
        if (measurement.evidence !== 'unknown') { window.unknownMs -= duration; window[key[measurement.evidence]] += duration; }
        if (measurement.sceneId && !window.sceneIds.includes(measurement.sceneId)) window.sceneIds.push(measurement.sceneId);
        timestamp += duration;
      }
    }
    const analysis: ScreenAnalysis = { version: 1, windowMs: 5000, timestampUnit: 'unix-ms', scenes: this.scenes.map(s => ({ ...s })),
      measurements, windows, events: [...this.events], droppedGazeSamples: this.droppedGazeSamples, droppedScenes: this.droppedScenes };
    analysis.summary = summarizeScreenAnalysis(analysis);
    return analysis;
  }
}

function evaluate(sample: FocusSample, excluded: boolean, scene: ScreenScene | undefined, goal: boolean): Pick<ScreenMeasurement, 'evidence' | 'reason' | 'textRegion'> {
  if (excluded) return { evidence: 'excluded', reason: 'paused-rescue-or-notes' };
  const gaze = sample.gazeTracking;
  if (sample.confidence < .3 || !gaze || gaze.state === 'unknown') return { evidence: 'unknown', reason: 'gaze-unavailable' };
  if (gaze.state === 'away' || gaze.state === 'candidate') {
    return { evidence: 'looking-away', reason: gaze.reason ?? 'outside-screen' };
  }
  if (gaze.state !== 'screen') return { evidence: 'unknown', reason: 'gaze-recovering' };
  if (!scene || scene.status !== 'ready') return { evidence: 'unknown', reason: scene?.status ?? 'screen-unobserved' };
  const textRegion = region(sample, scene);
  if (goal && scene.label === 'off-topic') return { evidence: 'off-topic', reason: 'unrelated-content', textRegion };
  if (goal && scene.label !== 'related') return { evidence: 'unknown', reason: `content-${scene.label}`, textRegion };
  return { evidence: 'focused', reason: 'screen-gaze-and-study-context', textRegion };
}

/** OCR overlap is a diagnostic, not proof of attention: figures and whitespace matter. */
function region(sample: FocusSample, scene: ScreenScene): ScreenMeasurement['textRegion'] {
  const trace = sample.gazeTrace;
  if (!trace?.valid || !trace.raw || trace.calibration.coordinateSpace !== 'screen'
    || scene.displaySurface !== 'monitor' || !scene.blocks?.length) return 'unmapped';
  const { geometry, validation } = trace.calibration;
  // Aspect ratio is a necessary check; the user must share the calibrated display.
  if (Math.abs(scene.width / scene.height - geometry.screenWidth / geometry.screenHeight) > .05) return 'unmapped';
  const x = trace.raw.x * scene.width, y = trace.raw.y * scene.height;
  const margin = Math.max(40, validation?.meanErrorPx ?? 100) * scene.width / geometry.screenWidth;
  return scene.blocks.some(block => {
    const xs = block.polygon.map(p => p[0]), ys = block.polygon.map(p => p[1]);
    return x >= Math.min(...xs) - margin && x <= Math.max(...xs) + margin
      && y >= Math.min(...ys) - margin && y <= Math.max(...ys) + margin;
  }) ? 'overlap' : 'outside';
}

/** Preserve the existing 1 Hz report contract; require 800 ms of measured evidence. */
export function historicalFocus(analysis: ScreenAnalysis, startedAt: number): FocusLogEntry[] {
  const buckets = new Map<number, { focused: number; away: number; offTopic: number; sceneId?: number }>();
  for (const m of analysis.measurements) {
    if (!['focused', 'looking-away', 'off-topic'].includes(m.evidence)) continue;
    const end = m.timestamp + m.durationMs;
    for (let timestamp = m.timestamp; timestamp < end;) {
      const sec = Math.floor((timestamp - startedAt) / 1000);
      const duration = Math.min(end, startedAt + (sec + 1) * 1000) - timestamp;
      const bucket = buckets.get(sec) ?? { focused: 0, away: 0, offTopic: 0 };
      const key = m.evidence === 'focused' ? 'focused' : m.evidence === 'looking-away' ? 'away' : 'offTopic';
      bucket[key] += duration;
      bucket.sceneId = m.sceneId;
      buckets.set(sec, bucket);
      timestamp += duration;
    }
  }
  return [...buckets].filter(([, b]) => b.focused + b.away + b.offTopic >= 800).map(([t, b]) => ({
    t, score: Math.round(100 * b.focused / (b.focused + b.away + b.offTopic)),
    state: b.focused >= 800 && b.away + b.offTopic < 200 ? 'focused' : 'drifting',
    slideIndex: analysis.scenes.find(s => s.id === b.sceneId)?.slideIndex ?? 0,
  }));
}

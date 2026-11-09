import type { AttentionProvider, AttentionStatus, Unsubscribe } from '../../contracts/providers';
import type { CalibrationPoint, FocusSample, FocusSignals } from '../../contracts/types';

/**
 * Focus simulator. Stands in for the gaze-tracking team's provider so the UI
 * can be built and demoed without a camera model. Driven from the
 * Integrations panel (or the D key in a study session).
 */
export type SimProfile = 'locked-in' | 'reading' | 'drifting' | 'phone' | 'eyes-closed' | 'no-face' | 'autopilot';

export const SIM_PROFILES: { id: SimProfile; label: string; hint: string }[] = [
  { id: 'locked-in', label: 'Locked in', hint: 'score ~88' },
  { id: 'reading', label: 'Reading', hint: 'score ~72, small dips' },
  { id: 'drifting', label: 'Zoning out', hint: 'score ~42' },
  { id: 'phone', label: 'On phone', hint: 'head down, gaze off' },
  { id: 'eyes-closed', label: 'Eyes closed', hint: 'drowsy' },
  { id: 'no-face', label: 'Walked away', hint: 'no face' },
  { id: 'autopilot', label: 'Autopilot', hint: 'lapses every ~45 s' },
];

const TARGET: Record<Exclude<SimProfile, 'autopilot'>, Required<FocusSignals>> = {
  'locked-in': { gaze: 0.95, head: 0.95, eyesOpen: 1, facePresent: 1 },
  reading: { gaze: 0.82, head: 0.9, eyesOpen: 1, facePresent: 1 },
  drifting: { gaze: 0.1, head: 0.25, eyesOpen: 0.8, facePresent: 1 },
  phone: { gaze: 0.02, head: 0.1, eyesOpen: 1, facePresent: 1 },
  'eyes-closed': { gaze: 0.5, head: 0.9, eyesOpen: 0, facePresent: 1 },
  'no-face': { gaze: 0, head: 0, eyesOpen: 0, facePresent: 0 },
};

type Listener = () => void;

class Simulator {
  profile: SimProfile = 'locked-in';
  /** Manual override 0–100, or null. */
  manual: number | null = null;
  private listeners = new Set<Listener>();
  set(profile: SimProfile) {
    this.profile = profile;
    this.manual = null;
    this.listeners.forEach((l) => l());
  }
  setManual(v: number | null) {
    this.manual = v;
    this.listeners.forEach((l) => l());
  }
  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }
}
export const simulator = new Simulator();

const jitter = (v: number, amt: number) => Math.min(1, Math.max(0, v + (Math.random() - 0.5) * amt));

/** Proposal formula with the window term left out (the UI applies window focus). */
export function scoreFromSignals(s: Required<FocusSignals>): number {
  if (s.facePresent < 0.5) return 0;
  // weights renormalised from 0.35 g + 0.20 h + 0.15 e + 0.15 f over the camera terms
  return Math.round((100 * (0.35 * s.gaze + 0.2 * s.head + 0.15 * s.eyesOpen + 0.15 * s.facePresent)) / 0.85);
}

export class MockAttentionProvider implements AttentionProvider {
  readonly name = 'Simulator';
  readonly needsCamera = false;
  private timer: number | null = null;
  private sampleSubs = new Set<(s: FocusSample) => void>();
  private statusSubs = new Set<(s: AttentionStatus, d?: string) => void>();
  private t0 = 0;
  private current: Required<FocusSignals> = { ...TARGET['locked-in'] };

  async start() {
    this.t0 = Date.now();
    this.emitStatus('running');
    this.timer = window.setInterval(() => this.tick(), 100);
  }
  async stop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.emitStatus('stopped');
  }
  onSample(cb: (s: FocusSample) => void): Unsubscribe {
    this.sampleSubs.add(cb);
    return () => this.sampleSubs.delete(cb);
  }
  onStatus(cb: (s: AttentionStatus, d?: string) => void): Unsubscribe {
    this.statusSubs.add(cb);
    return () => this.statusSubs.delete(cb);
  }
  async calibratePoint(_p: CalibrationPoint) {
    await new Promise((r) => setTimeout(r, 900));
  }
  async finishCalibration() {}
  reportProbe() {}

  private emitStatus(s: AttentionStatus, d?: string) {
    this.statusSubs.forEach((f) => f(s, d));
  }

  private target(): Required<FocusSignals> {
    let p = simulator.profile;
    if (p === 'autopilot') {
      const t = ((Date.now() - this.t0) / 1000) % 46;
      p = t < 34 ? 'reading' : 'phone';
    }
    return TARGET[p];
  }

  private tick() {
    const tgt = this.target();
    // ease toward target so transitions look like a real person, not a switch
    const k = 0.35;
    this.current = {
      gaze: this.current.gaze + (tgt.gaze - this.current.gaze) * k,
      head: this.current.head + (tgt.head - this.current.head) * k,
      eyesOpen: tgt.eyesOpen === 0 ? 0 : this.current.eyesOpen + (tgt.eyesOpen - this.current.eyesOpen) * k,
      facePresent: tgt.facePresent,
    };
    // occasional blink
    const blink = Math.random() < 0.03;
    const signals = {
      gaze: jitter(this.current.gaze, 0.12),
      head: jitter(this.current.head, 0.06),
      eyesOpen: blink ? 0 : jitter(this.current.eyesOpen, 0.04),
      facePresent: this.current.facePresent,
    };
    const score = simulator.manual ?? scoreFromSignals(signals);
    const sample: FocusSample = {
      t: Date.now(),
      score,
      signals,
      confidence: signals.facePresent ? 0.9 : 0.95,
      gazePoint: { x: 0.5 + (1 - signals.gaze) * 0.4 * Math.sin(Date.now() / 900), y: 0.45 + (1 - signals.head) * 0.5 },
    };
    this.sampleSubs.forEach((f) => f(sample));
  }
}

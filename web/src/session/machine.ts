/**
 * Session state machine — pure, no timers, no DOM. Easy to unit-test.
 *
 * States and thresholds follow "Attention engine → States and thresholds" in the
 * proposal. The engine (engine.ts) feeds it ~10 inputs per second and UI actions.
 */
import type { FocusState, LapseTrigger, SessionConfig } from '../contracts/types';

export const DEFAULT_CONFIG: SessionConfig = {
  enterFocused: 65,
  enterDrifting: 45,
  driftToLapseSec: 8,
  driftToFocusedSec: 2,
  windowInactiveLapseSec: 5,
  eyesClosedLapseSec: 3,
  recoverFocusedSec: 4,
  recoverTimeoutSec: 12,
  maxRescuesInRow: 2,
  cooldownSec: 180,
  maxRescueShare: 0.15,
  noteTakingGraceSec: 60,
  nudgeOnly: false,
};

/** Rescue cap only applies once the session is long enough for a share to mean something. */
const RESCUE_CAP_MIN_SESSION_MS = 5 * 60_000;

export interface MachineInput {
  now: number;
  /** Smoothed camera score 0–100, or null when there is no confident frame (ignored). */
  score: number | null;
  windowActive: boolean;
  eyesClosed: boolean;
  /** Note-taking grace is active: looking down does not count as drift. */
  noteTaking: boolean;
}

export interface Machine {
  state: FocusState;
  /** When the current state was entered (ms). */
  since: number;
  sessionStart: number;
  /** Continuous time with effective score ≥ enterFocused. */
  aboveSince: number | null;
  windowInactiveSince: number | null;
  eyesClosedSince: number | null;
  cooldownUntil: number;
  rescuesInRow: number;
  rescueMsTotal: number;
  pausedMs: number;
  pausedAt: number | null;
  /** State to return to after unpausing. */
  resumeTo: FocusState;
  lastTrigger: LapseTrigger | null;
  /** Latest effective score (after window focus is applied). */
  effective: number;
}

export type MachineEvent =
  | { type: 'state'; from: FocusState; to: FocusState }
  | { type: 'nudge' }
  | { type: 'lapse'; trigger: LapseTrigger; rescueInRow: number; depth: number }
  | { type: 'refocused'; afterMs: number }
  | { type: 'suggestBreak'; reason: 'repeated' | 'rescueCap' }
  | { type: 'suppressed'; reason: 'cooldown' | 'nudgeOnly' };

export type MachineAction =
  | { type: 'start' }
  | { type: 'rescueStarted' }
  | { type: 'rescueFinished'; clipMs: number }
  | { type: 'breakTaken' }
  | { type: 'breakDismissed' }
  | { type: 'pause' }
  | { type: 'resume' };

export function createMachine(now: number): Machine {
  return {
    state: 'idle',
    since: now,
    sessionStart: now,
    aboveSince: null,
    windowInactiveSince: null,
    eyesClosedSince: null,
    cooldownUntil: 0,
    rescuesInRow: 0,
    rescueMsTotal: 0,
    pausedMs: 0,
    pausedAt: null,
    resumeTo: 'focused',
    lastTrigger: null,
    effective: 100,
  };
}

function go(m: Machine, to: FocusState, now: number, events: MachineEvent[]): Machine {
  if (m.state === to) return m;
  events.push({ type: 'state', from: m.state, to });
  return { ...m, state: to, since: now };
}

const sec = (ms: number) => ms / 1000;

/** Active (non-paused) session time in ms. */
export function activeMs(m: Machine, now: number): number {
  const paused = m.pausedMs + (m.pausedAt !== null ? now - m.pausedAt : 0);
  return Math.max(0, now - m.sessionStart - paused);
}

function lapseOrSuppress(
  m: Machine,
  now: number,
  cfg: SessionConfig,
  trigger: LapseTrigger,
  events: MachineEvent[],
): Machine {
  if (cfg.nudgeOnly) {
    events.push({ type: 'suppressed', reason: 'nudgeOnly' });
    return go(m, 'drifting', now, events);
  }
  if (now < m.cooldownUntil && m.state !== 'recovering') {
    events.push({ type: 'suppressed', reason: 'cooldown' });
    return go(m, 'drifting', now, events);
  }
  const active = activeMs(m, now);
  if (active >= RESCUE_CAP_MIN_SESSION_MS && m.rescueMsTotal / active >= cfg.maxRescueShare) {
    events.push({ type: 'suggestBreak', reason: 'rescueCap' });
    return go({ ...m, lastTrigger: trigger }, 'break', now, events);
  }
  const rescueInRow = m.rescuesInRow + 1;
  const next = go({ ...m, rescuesInRow: rescueInRow, lastTrigger: trigger }, 'lapse', now, events);
  events.push({ type: 'lapse', trigger, rescueInRow, depth: Math.min(rescueInRow, 2) });
  return next;
}

/** Advance the machine with one input frame. */
export function step(
  m0: Machine,
  input: MachineInput,
  cfg: SessionConfig = DEFAULT_CONFIG,
): { m: Machine; events: MachineEvent[] } {
  const events: MachineEvent[] = [];
  const { now } = input;
  let m = m0;

  if (m.state === 'idle' || m.state === 'paused' || m.state === 'break') return { m, events };

  // Window and eye timers run in every active state.
  const windowInactiveSince = input.windowActive ? null : (m.windowInactiveSince ?? now);
  const eyesClosedSince = input.eyesClosed && !input.noteTaking ? (m.eyesClosedSince ?? now) : null;

  // Effective score. Window inactive → 0. Note-taking → camera can't cause drift.
  let effective: number | null;
  if (!input.windowActive) effective = 0;
  else if (input.noteTaking) effective = Math.max(input.score ?? cfg.enterFocused, cfg.enterFocused);
  else effective = input.score;

  // Low-confidence frame with window active: hold everything as-is.
  if (effective === null) {
    return { m: { ...m, windowInactiveSince, eyesClosedSince }, events };
  }

  const aboveSince = effective >= cfg.enterFocused ? (m.aboveSince ?? now) : null;
  m = { ...m, windowInactiveSince, eyesClosedSince, aboveSince, effective };

  const windowLapse = windowInactiveSince !== null && sec(now - windowInactiveSince) >= cfg.windowInactiveLapseSec;
  const drowsyLapse = eyesClosedSince !== null && sec(now - eyesClosedSince) >= cfg.eyesClosedLapseSec;

  switch (m.state) {
    case 'focused': {
      if (windowLapse) return { m: lapseOrSuppress(m, now, cfg, 'window', events), events };
      if (drowsyLapse) return { m: lapseOrSuppress(m, now, cfg, 'drowsy', events), events };
      if (effective < cfg.enterDrifting) {
        m = go(m, 'drifting', now, events);
        events.push({ type: 'nudge' });
      }
      return { m, events };
    }
    case 'drifting': {
      if (aboveSince !== null && sec(now - aboveSince) >= cfg.driftToFocusedSec) {
        return { m: go(m, 'focused', now, events), events };
      }
      if (windowLapse) return { m: lapseOrSuppress(m, now, cfg, 'window', events), events };
      if (drowsyLapse) return { m: lapseOrSuppress(m, now, cfg, 'drowsy', events), events };
      if (sec(now - m.since) >= cfg.driftToLapseSec && effective < cfg.enterDrifting) {
        // A suppressed lapse re-enters drifting with a fresh timer, so the glow keeps
        // pulsing but we don't spam suppression events every frame.
        const next = lapseOrSuppress(m, now, cfg, 'gaze', events);
        if (next.state === 'drifting') return { m: { ...next, since: now }, events };
        return { m: next, events };
      }
      return { m, events };
    }
    case 'lapse':
    case 'rescue':
      // Waiting on the UI (rescueStarted / rescueFinished).
      return { m, events };
    case 'recovering': {
      if (aboveSince !== null && sec(now - aboveSince) >= cfg.recoverFocusedSec) {
        const afterMs = now - m.since;
        m = go(
          { ...m, rescuesInRow: 0, cooldownUntil: now + cfg.cooldownSec * 1000 },
          'focused',
          now,
          events,
        );
        events.push({ type: 'refocused', afterMs });
        return { m, events };
      }
      if (sec(now - m.since) >= cfg.recoverTimeoutSec) {
        if (m.rescuesInRow >= cfg.maxRescuesInRow) {
          events.push({ type: 'suggestBreak', reason: 'repeated' });
          return { m: go(m, 'break', now, events), events };
        }
        return { m: lapseOrSuppress(m, now, cfg, m.lastTrigger ?? 'gaze', events), events };
      }
      return { m, events };
    }
    default:
      return { m, events };
  }
}

/** Apply a UI action. */
export function dispatch(
  m: Machine,
  action: MachineAction,
  now: number,
  cfg: SessionConfig = DEFAULT_CONFIG,
): { m: Machine; events: MachineEvent[] } {
  const events: MachineEvent[] = [];
  switch (action.type) {
    case 'start':
      return { m: go({ ...createMachine(now), state: 'idle' }, 'focused', now, events), events };
    case 'rescueStarted':
      if (m.state !== 'lapse') return { m, events };
      return { m: go(m, 'rescue', now, events), events };
    case 'rescueFinished':
      if (m.state !== 'rescue' && m.state !== 'lapse') return { m, events };
      return {
        m: go({ ...m, rescueMsTotal: m.rescueMsTotal + action.clipMs, aboveSince: null }, 'recovering', now, events),
        events,
      };
    case 'breakTaken':
    case 'breakDismissed':
      if (m.state !== 'break') return { m, events };
      return {
        m: go(
          { ...m, rescuesInRow: 0, cooldownUntil: now + cfg.cooldownSec * 1000, aboveSince: null, windowInactiveSince: null, eyesClosedSince: null },
          'focused',
          now,
          events,
        ),
        events,
      };
    case 'pause':
      if (m.state === 'paused' || m.state === 'idle') return { m, events };
      return { m: go({ ...m, pausedAt: now, resumeTo: m.state === 'rescue' || m.state === 'lapse' ? 'recovering' : 'focused' }, 'paused', now, events), events };
    case 'resume': {
      if (m.state !== 'paused') return { m, events };
      const pausedMs = m.pausedMs + (m.pausedAt !== null ? now - m.pausedAt : 0);
      return {
        m: go(
          { ...m, pausedMs, pausedAt: null, aboveSince: null, windowInactiveSince: null, eyesClosedSince: null },
          m.resumeTo,
          now,
          events,
        ),
        events,
      };
    }
  }
}

/** Map the user-facing sensitivity slider (0 patient … 1 quick) to thresholds. */
export function configForSensitivity(sensitivity: number, base: SessionConfig = DEFAULT_CONFIG): SessionConfig {
  const s = Math.min(1, Math.max(0, sensitivity));
  const lerp = (a: number, b: number) => a + (b - a) * s;
  return {
    ...base,
    // 0.5 reproduces the proposal defaults: 8 s drift, 5 s window, 45 threshold.
    driftToLapseSec: Math.round(lerp(12, 4)),
    windowInactiveLapseSec: Math.round(lerp(8, 2)),
    enterDrifting: Math.round(lerp(40, 50)),
  };
}

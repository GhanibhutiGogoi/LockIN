import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, configForSensitivity, createMachine, dispatch, step, type Machine, type MachineEvent, type MachineInput } from './machine';

const cfg = DEFAULT_CONFIG;

function run(m: Machine, from: number, to: number, input: Omit<MachineInput, 'now'>, hz = 10) {
  const events: MachineEvent[] = [];
  for (let t = from; t <= to; t += 1000 / hz) {
    const r = step(m, { ...input, now: t }, cfg);
    m = r.m;
    events.push(...r.events);
  }
  return { m, events };
}

const focused = { score: 85, windowActive: true, eyesClosed: false, noteTaking: false };
const away = { score: 20, windowActive: true, eyesClosed: false, noteTaking: false };

function started(now = 0) {
  return dispatch(createMachine(now), { type: 'start' }, now).m;
}

describe('session state machine', () => {
  it('stays focused while the score is high', () => {
    const { m, events } = run(started(), 0, 30_000, focused);
    expect(m.state).toBe('focused');
    expect(events.filter((e) => e.type === 'lapse')).toHaveLength(0);
  });

  it('nudges on drift, then lapses after 8 s', () => {
    let { m, events } = run(started(), 0, 1000, away);
    expect(m.state).toBe('drifting');
    expect(events.some((e) => e.type === 'nudge')).toBe(true);
    ({ m, events } = run(m, 1100, 7900, away));
    expect(m.state).toBe('drifting');
    ({ m, events } = run(m, 8000, 9500, away));
    expect(m.state).toBe('lapse');
    expect(events.find((e) => e.type === 'lapse')).toMatchObject({ trigger: 'gaze', rescueInRow: 1 });
  });

  it('returns to focused after 2 s above 65 while drifting', () => {
    let { m } = run(started(), 0, 2000, away);
    ({ m } = run(m, 2100, 3900, focused));
    expect(m.state).toBe('drifting');
    ({ m } = run(m, 4000, 4400, focused));
    expect(m.state).toBe('focused');
  });

  it('holds state in the 45–65 hysteresis band', () => {
    let { m } = run(started(), 0, 1000, away);
    ({ m } = run(m, 1100, 20_000, { ...focused, score: 55 }));
    expect(m.state).toBe('drifting');
  });

  it('lapses after 5 s with the window inactive', () => {
    const { m, events } = run(started(), 0, 6000, { ...focused, windowActive: false });
    expect(m.state).toBe('lapse');
    expect(events.find((e) => e.type === 'lapse')).toMatchObject({ trigger: 'window' });
  });

  it('lapses after 3 s of closed eyes', () => {
    const { m, events } = run(started(), 0, 3500, { ...focused, eyesClosed: true });
    expect(m.state).toBe('lapse');
    expect(events.find((e) => e.type === 'lapse')).toMatchObject({ trigger: 'drowsy' });
  });

  it('ignores low-confidence frames', () => {
    const { m } = run(started(), 0, 30_000, { ...focused, score: null });
    expect(m.state).toBe('focused');
  });

  it('note-taking mode stops gaze from counting as drift', () => {
    const { m } = run(started(), 0, 30_000, { ...away, noteTaking: true });
    expect(m.state).toBe('focused');
  });

  it('full rescue loop: lapse → rescue → recovering → focused with cooldown', () => {
    let { m } = run(started(), 0, 9500, away);
    expect(m.state).toBe('lapse');
    m = dispatch(m, { type: 'rescueStarted' }, 9600).m;
    expect(m.state).toBe('rescue');
    m = dispatch(m, { type: 'rescueFinished', clipMs: 30_000 }, 40_000).m;
    expect(m.state).toBe('recovering');
    const r = run(m, 40_100, 45_000, focused);
    expect(r.m.state).toBe('focused');
    expect(r.events.some((e) => e.type === 'refocused')).toBe(true);
    expect(r.m.cooldownUntil).toBeGreaterThan(45_000);
    expect(r.m.rescuesInRow).toBe(0);
  });

  it('suppresses a new rescue during cooldown but keeps the glow', () => {
    let { m } = run(started(), 0, 9500, away);
    m = dispatch(m, { type: 'rescueStarted' }, 9600).m;
    m = dispatch(m, { type: 'rescueFinished', clipMs: 30_000 }, 40_000).m;
    ({ m } = run(m, 40_100, 45_000, focused));
    const r = run(m, 45_100, 70_000, away);
    expect(r.m.state).toBe('drifting');
    expect(r.events.some((e) => e.type === 'lapse')).toBe(false);
    expect(r.events.some((e) => e.type === 'suppressed')).toBe(true);
  });

  it('gives a deeper second clip, then suggests a break', () => {
    let { m } = run(started(), 0, 9500, away);
    m = dispatch(m, { type: 'rescueStarted' }, 9600).m;
    m = dispatch(m, { type: 'rescueFinished', clipMs: 20_000 }, 30_000).m;
    let r = run(m, 30_100, 43_000, away);
    expect(r.m.state).toBe('lapse');
    expect(r.events.find((e) => e.type === 'lapse')).toMatchObject({ rescueInRow: 2, depth: 2 });
    m = dispatch(r.m, { type: 'rescueStarted' }, 43_100).m;
    m = dispatch(m, { type: 'rescueFinished', clipMs: 20_000 }, 63_000).m;
    r = run(m, 63_100, 76_000, away);
    expect(r.m.state).toBe('break');
    expect(r.events.find((e) => e.type === 'suggestBreak')).toMatchObject({ reason: 'repeated' });
    m = dispatch(r.m, { type: 'breakDismissed' }, 80_000).m;
    expect(m.state).toBe('focused');
  });

  it('nudge-only mode never starts a rescue', () => {
    const { m, events } = run(started(), 0, 30_000, away);
    void m;
    const nudgeOnly = { ...cfg, nudgeOnly: true };
    let mm = started();
    const evs: MachineEvent[] = [];
    for (let t = 0; t < 30_000; t += 100) {
      const r = step(mm, { ...away, now: t }, nudgeOnly);
      mm = r.m;
      evs.push(...r.events);
    }
    expect(events.some((e) => e.type === 'lapse')).toBe(true);
    expect(evs.some((e) => e.type === 'lapse')).toBe(false);
    expect(mm.state).toBe('drifting');
  });

  it('pause freezes the session and resume returns to focused', () => {
    let m = started();
    m = dispatch(m, { type: 'pause' }, 1000).m;
    const r = run(m, 1100, 60_000, away);
    expect(r.m.state).toBe('paused');
    m = dispatch(r.m, { type: 'resume' }, 61_000).m;
    expect(m.state).toBe('focused');
    expect(m.pausedMs).toBe(60_000);
  });

  it('sensitivity 0.5 reproduces the proposal defaults', () => {
    const c = configForSensitivity(0.5);
    expect(c.driftToLapseSec).toBe(8);
    expect(c.windowInactiveLapseSec).toBe(5);
    expect(c.enterDrifting).toBe(45);
  });
});

import { describe, expect, it } from 'vitest';
import { advanceActivityReminder, emptyActivityReminder } from './screenActivity';

describe('screen activity reminders', () => {
  it('requires two consecutive off-topic observations and alerts only once for the visit', () => {
    const first = advanceActivityReminder(emptyActivityReminder(), 'off-topic', 1000, 60_000);
    expect(first.notify).toBe(false);
    const second = advanceActivityReminder(first.state, 'off-topic', 6000, 60_000);
    expect(second.notify).toBe(true);
    expect(advanceActivityReminder(second.state, 'off-topic', 11000, 60_000).notify).toBe(false);
  });

  it('resets the evidence on related, uncertain, unavailable or widely separated samples', () => {
    const { state } = advanceActivityReminder(emptyActivityReminder(), 'off-topic', 1000, 60_000);
    for (const label of ['related', 'uncertain', 'unavailable'] as const) {
      const interrupted = advanceActivityReminder(state, label, 6000, 60_000);
      expect(interrupted.notify).toBe(false);
      expect(advanceActivityReminder(interrupted.state, 'off-topic', 11000, 60_000).notify).toBe(false);
    }
    expect(advanceActivityReminder(state, 'off-topic', 25_000, 60_000).notify).toBe(false);
  });

  it('keeps cooldown across visits', () => {
    let { state } = advanceActivityReminder(emptyActivityReminder(), 'off-topic', 1000, 60_000);
    ({ state } = advanceActivityReminder(state, 'off-topic', 6000, 60_000));
    ({ state } = advanceActivityReminder(state, 'related', 11000, 60_000));
    ({ state } = advanceActivityReminder(state, 'off-topic', 16000, 60_000));
    expect(advanceActivityReminder(state, 'off-topic', 21000, 60_000).notify).toBe(false);
  });
});

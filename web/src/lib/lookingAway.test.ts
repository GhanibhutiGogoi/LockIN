import { expect, it } from 'vitest';
import { lookingAwaySeconds } from './lookingAway';

it('defaults legacy or invalid settings to 30 seconds', () => {
  for (const value of [undefined, null, '', '10', 0, -1, 4, 301, 10.5, NaN, Infinity]) {
    expect(lookingAwaySeconds(value)).toBe(30);
  }
});

it('preserves valid whole-second durations', () => {
  for (const value of [5, 10, 30, 60, 300]) expect(lookingAwaySeconds(value)).toBe(value);
});

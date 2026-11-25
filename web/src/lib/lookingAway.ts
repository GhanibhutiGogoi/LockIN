export const DEFAULT_LOOKING_AWAY_SEC = 30;
export const MIN_LOOKING_AWAY_SEC = 5;
export const MAX_LOOKING_AWAY_SEC = 300;

export function lookingAwaySeconds(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value)
    && value >= MIN_LOOKING_AWAY_SEC && value <= MAX_LOOKING_AWAY_SEC
    ? value : DEFAULT_LOOKING_AWAY_SEC;
}

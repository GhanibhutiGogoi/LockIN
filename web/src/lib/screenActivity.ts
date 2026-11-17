export type ActivityLabel = 'related' | 'off-topic' | 'uncertain' | 'unavailable';
export const CLASSIFY_EVERY_MS = 5000;

interface ReminderState {
  previousOffTopicAt: number | null;
  reminded: boolean;
  lastReminderAt: number | null;
}

export const emptyActivityReminder = (): ReminderState => ({
  previousOffTopicAt: null, reminded: false, lastReminderAt: null,
});

export function advanceActivityReminder(
  state: ReminderState, label: ActivityLabel, seenAt: number, cooldownMs: number,
): { state: ReminderState; notify: boolean } {
  if (label !== 'off-topic') {
    return { state: { ...state, previousOffTopicAt: null, reminded: false }, notify: false };
  }
  const gap = state.previousOffTopicAt === null ? Infinity : seenAt - state.previousOffTopicAt;
  const consecutive = gap >= CLASSIFY_EVERY_MS && gap <= 2.5 * CLASSIFY_EVERY_MS;
  const cooldownOver = state.lastReminderAt === null || seenAt - state.lastReminderAt >= cooldownMs;
  const notify = consecutive && cooldownOver && !state.reminded;
  return {
    state: {
      previousOffTopicAt: seenAt,
      reminded: state.reminded || notify,
      lastReminderAt: notify ? seenAt : state.lastReminderAt,
    },
    notify,
  };
}

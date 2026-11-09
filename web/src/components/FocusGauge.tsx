import type { FocusState } from '../contracts/types';
import { useApp } from '../store';

const LABEL: Record<FocusState, string> = {
  idle: 'Ready',
  focused: 'Locked in',
  drifting: 'Drifting',
  lapse: 'Lost you',
  rescue: 'Rescue',
  recovering: 'Coming back',
  break: 'Break',
  paused: 'Paused',
};

function stateColor(state: FocusState): string {
  switch (state) {
    case 'focused':
      return 'var(--ok)';
    case 'drifting':
    case 'recovering':
      return 'var(--warn)';
    case 'lapse':
    case 'rescue':
      return 'var(--lapse)';
    default:
      return 'var(--pencil)';
  }
}

/** Five ticks, filled by score — readable at a glance, never a number to stare at. `compact` drops the word. */
export function FocusGauge({ compact = false }: { compact?: boolean }) {
  const state = useApp((s) => s.live.state);
  const effective = useApp((s) => s.live.effective);
  const filled = state === 'paused' || state === 'break' ? 0 : Math.max(1, Math.ceil(effective / 20));
  const color = stateColor(state);
  return (
    <div className="flex items-center gap-2.5" role="status" aria-live="polite" aria-label={`Focus: ${LABEL[state]}`} title={compact ? LABEL[state] : undefined}>
      <div className="flex items-end gap-[3px]" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="w-[4px] rounded-[1px] transition-[background-color,height] duration-300"
            style={{ height: 7 + i * 3, background: i < filled ? color : 'var(--rule-strong)' }}
          />
        ))}
      </div>
      {!compact && (
        <span className="hidden text-[15px] font-semibold whitespace-nowrap sm:inline" style={{ color: state === 'focused' ? 'var(--graphite)' : color }}>
          {LABEL[state]}
        </span>
      )}
    </div>
  );
}

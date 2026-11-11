import { useApp } from '../store';
import { Icon } from './Icon';

/**
 * One floating line. Info is ink (inverted in dark); an error is the same
 * surface with a red mark and a close button, so it can be read and dismissed
 * instead of only timing out.
 */
export function Toast() {
  const toast = useApp((s) => s.toast);
  // during a clip, "I'm back" owns the bottom edge, so the line sits above it
  const lifted = useApp((s) => s.rescue !== null);
  const error = toast?.tone === 'error';
  return (
    <div
      className={`pointer-events-none fixed inset-x-0 z-[80] flex justify-center px-4 ${lifted ? 'bottom-[max(112px,calc(env(safe-area-inset-bottom)+112px))]' : 'bottom-[max(72px,calc(env(safe-area-inset-bottom)+72px))]'}`}
      aria-live="polite"
    >
      {toast && (
        <div
          key={toast.id}
          className="rise pointer-events-auto flex max-w-md items-start gap-3 rounded-2xl bg-ink py-3 pr-2 pl-5 text-[15px] leading-snug text-paper shadow-[var(--shadow-float)]"
          style={error ? undefined : { paddingRight: 20 }}
          role={error ? 'alert' : 'status'}
        >
          {error && <span className="mt-[7px] h-2 w-2 flex-none rounded-full bg-lapse" aria-hidden />}
          <p className="min-w-0 flex-1 py-px">{toast.text}</p>
          {error && (
            <button
              type="button"
              className="-my-1 grid h-8 w-8 flex-none place-items-center rounded-full text-paper/70 transition-colors hover:bg-paper/15 hover:text-paper"
              onClick={() => useApp.setState({ toast: null })}
              aria-label="Dismiss"
            >
              <Icon name="x" size={16} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

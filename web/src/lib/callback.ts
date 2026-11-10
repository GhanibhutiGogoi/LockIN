/**
 * Calling the user back to a hidden tab: a short sound cue, a system
 * notification when the user allowed them, and the tab title (set by the engine).
 * This is LockIn's snap-back on the web.
 */
let ctx: AudioContext | null = null;

/** Browsers only allow sound after a user gesture; unlock the cue on the first one. */
export function primeCue() {
  if (typeof window === 'undefined' || ctx) return;
  const unlock = () => {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC && !ctx) ctx = new AC();
      void ctx?.resume();
    } catch {
      /* no audio */
    }
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
}

/** Two soft rising tones, about half a second. */
export function playCue() {
  if (!ctx) return;
  try {
    void ctx.resume();
    const t = ctx.currentTime + 0.02;
    [660, 880].forEach((f, i) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.18, t + i * 0.18 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.3);
      o.connect(g).connect(ctx!.destination);
      o.start(t + i * 0.18);
      o.stop(t + i * 0.18 + 0.32);
    });
  } catch {
    /* ignore */
  }
}

export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window;

/** Ask once, from a click (browsers ignore it otherwise). */
export async function askNotificationPermission() {
  if (!notificationsSupported() || Notification.permission !== 'default') return;
  try {
    await Notification.requestPermission();
  } catch {
    /* ignore */
  }
}

/** Shows a notification if allowed. Returns a function that closes it. */
export function notifyComeBack(): () => void {
  if (!notificationsSupported() || Notification.permission !== 'granted') return () => {};
  try {
    const n = new Notification('Come back to your slides', { body: 'LockIn has a short recap of the slide you left.', tag: 'lockin-callback', silent: true });
    n.onclick = () => {
      window.focus();
      n.close();
    };
    return () => n.close();
  } catch {
    return () => {};
  }
}

/** Resolves the next time the tab is visible. */
export function whenVisible(): Promise<void> {
  if (!document.hidden) return Promise.resolve();
  return new Promise((resolve) => {
    const on = () => {
      if (document.hidden) return;
      document.removeEventListener('visibilitychange', on);
      resolve();
    };
    document.addEventListener('visibilitychange', on);
  });
}

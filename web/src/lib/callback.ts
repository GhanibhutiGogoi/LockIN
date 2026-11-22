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
  if (globalThis.navigator?.userActivation?.isActive) {
    unlock();
    return;
  }
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
export function notifyComeBack(screenStudy = false): () => void {
  if (!notificationsSupported() || Notification.permission !== 'granted') return () => {};
  try {
    const n = new Notification(screenStudy ? 'Your screen recap is ready' : 'Come back to your slides', {
      body: screenStudy ? 'Return to LockIn to see the recap.' : 'LockIn has a short recap of the slide you left.',
      tag: 'lockin-callback',
      silent: true,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
    return () => n.close();
  } catch {
    return () => {};
  }
}

/** Shows only a generic reminder. The shared page and goal stay out of notifications. */
export function notifyOffTopic() {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  try {
    const notification = new Notification('Back to your study goal?', {
      body: 'The shared page may be unrelated to this session.',
      tag: 'lockin-screen-activity',
      silent: true,
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    window.setTimeout(() => notification.close(), 8000);
  } catch {
    // The in-app reminder remains available.
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

/** External apps do not necessarily hide the browser tab. Wait for actual focus. */
export function whenStudyActive(signal: AbortSignal): Promise<boolean> {
  return new Promise(resolve => {
    const check = () => {
      if (!signal.aborted && (document.hidden || !document.hasFocus())) return;
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
      signal.removeEventListener('abort', check);
      resolve(!signal.aborted);
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    signal.addEventListener('abort', check, { once: true });
    check();
  });
}

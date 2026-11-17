import { actions, useApp } from '../store';
import { notifyOffTopic, playCue, primeCue } from './callback';
import { advanceActivityReminder, CLASSIFY_EVERY_MS, emptyActivityReminder, type ActivityLabel } from './screenActivity';
import { uid } from './storage';

const SAMPLE_MS = 2000;
const FRESH_MS = 8000;

interface Capture {
  deckId: string;
  track: MediaStreamTrack;
  events: AbortController;
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  timer?: number;
  request?: AbortController;
  classification?: AbortController;
  nextClassificationAt: number;
  reminder: ReturnType<typeof emptyActivityReminder>;
}

let capture: Capture | undefined;
let reading = false;
let choosing = false;

export async function shareStudyScreen(reuseSession = false, goal = '') {
  if (choosing || capture) return;
  if (!navigator.mediaDevices?.getDisplayMedia) {
    actions.toast('Screen sharing requires a supported desktop browser on localhost.', 'error');
    return;
  }

  choosing = true;
  primeCue();
  const previous = useApp.getState();
  let stream: MediaStream | undefined;
  try {
    const options = {
      video: { frameRate: { ideal: 3, max: 5 } },
      audio: false,
      selfBrowserSurface: 'exclude',
    } as DisplayMediaStreamOptions & { selfBrowserSurface: 'exclude' };
    stream = await navigator.mediaDevices.getDisplayMedia(options);
    const track = stream.getVideoTracks()[0];
    if (!track || track.readyState !== 'live') throw new Error('Screen stream unavailable');

    const current = useApp.getState();
    if (current.screen !== previous.screen || current.deckId !== previous.deckId) {
      stream.getTracks().forEach((item) => item.stop());
      return;
    }

    const deckId = reuseSession ? current.deckId : uid('screen_');
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    const lease: Capture = {
      deckId, track, video, events: new AbortController(), canvas: document.createElement('canvas'),
      nextClassificationAt: 0, reminder: emptyActivityReminder(),
    };
    track.enabled = reading;
    if (!reuseSession) {
      useApp.setState({ screenGoal: goal.trim().slice(0, 300), screenActivity: null });
      actions.addDeck({ id: deckId, sourceType: 'screen', title: 'Shared screen', slides: [], slideCount: 0 });
      actions.go('study');
    }
    capture = lease;
    track.addEventListener('ended', stopScreenShare, { signal: lease.events.signal, once: true });
    track.addEventListener('mute', () => {
      if (!reading) return;
      cancelSample(lease);
      useApp.setState({ screenReading: 'reading', screenSeenAt: null, screenActivity: null });
      schedule(lease);
    }, { signal: lease.events.signal });
    useApp.setState({ screenReading: reading ? 'reading' : 'waiting', screenSeenAt: null });
    if (reading) schedule(lease, 0);
  } catch (error) {
    stream?.getTracks().forEach((item) => item.stop());
    if (!(error instanceof DOMException && error.name === 'NotAllowedError')) {
      actions.toast('Screen sharing could not start. Try selecting a window or tab again.', 'error');
    }
  } finally {
    choosing = false;
  }
}

function cancelSample(lease: Capture) {
  if (lease.timer !== undefined) window.clearTimeout(lease.timer);
  lease.timer = undefined;
  lease.request?.abort();
  lease.request = undefined;
  resetClassification(lease);
}

function resetClassification(lease: Capture) {
  lease.classification?.abort();
  lease.classification = undefined;
  lease.nextClassificationAt = 0;
  lease.reminder = { ...lease.reminder, previousOffTopicAt: null, reminded: false };
}

export function stopScreenShare() {
  const lease = capture;
  if (!lease) return;
  capture = undefined;
  cancelSample(lease);
  lease.events.abort();
  lease.track.stop();
  lease.video.srcObject = null;
  useApp.setState({ screenReading: 'stopped', screenSeenAt: null, screenActivity: null });
}

export function setScreenReading(enabled: boolean) {
  reading = enabled;
  if (!capture) return;
  cancelSample(capture);
  capture.track.enabled = enabled;
  if (!enabled) capture.video.pause();
  useApp.setState({ screenReading: enabled ? 'reading' : 'paused', screenSeenAt: null, screenActivity: null });
  if (enabled) schedule(capture, 0);
}

export function hasRecentScreenText(now = Date.now()) {
  const { screenSeenAt, screenReading } = useApp.getState();
  return screenReading === 'ready' && screenSeenAt !== null
    && now >= screenSeenAt && now - screenSeenAt <= FRESH_MS;
}

/** A classified session only recaps screen text that the model found relevant. */
export function hasStudyRecapContext(now: number) {
  const { screenGoal, screenActivity } = useApp.getState();
  return hasRecentScreenText(now) && (!screenGoal || screenActivity === 'related');
}

function schedule(lease: Capture, delay = SAMPLE_MS) {
  if (!reading || capture !== lease) return;
  lease.timer = window.setTimeout(() => void sample(lease), delay);
}

function showsLockIn(lease: Capture) {
  const surface = lease.track.getSettings().displaySurface;
  return (surface === 'monitor' || surface === 'window') && document.hasFocus();
}

async function sample(lease: Capture) {
  if (capture !== lease || !reading) return;
  lease.timer = undefined;
  const request = new AbortController();
  lease.request = request;
  const { video, canvas, track, deckId } = lease;

  try {
    if (track.readyState !== 'live') {
      stopScreenShare();
      return;
    }
    if (track.muted || showsLockIn(lease)) {
      resetClassification(lease);
      useApp.setState(track.muted
        ? { screenReading: 'reading', screenSeenAt: null, screenActivity: null }
        : { screenReading: 'on-lockin', screenSeenAt: null });
      return;
    }
    if (video.paused) await video.play();
    if (request.signal.aborted) return;
    const { videoWidth: width, videoHeight: height } = video;
    if (!width || !height) return;
    const scale = Math.min(1, 1920 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Screen canvas unavailable');
    const seenAt = Date.now();
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const frame = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
    canvas.width = canvas.height = 1;
    if (!frame || request.signal.aborted || showsLockIn(lease)) return;
    const response = await fetch('/v1/web-screen/text', {
      method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: frame,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(6500)]),
    });
    if (!response.ok) throw new Error('Screen text recognition failed');
    const { lines } = await response.json() as { lines: string[] };
    if (request.signal.aborted || showsLockIn(lease)) return;
    actions.acceptScreenText(deckId, lines, seenAt);
    const state = useApp.getState();
    if (state.screenReading !== 'ready') resetClassification(lease);
    else if (state.screenGoal) void classify(lease, state.deckId, state.slideIndex, state.screenGoal, seenAt);
  } catch {
    if (!request.signal.aborted) {
      resetClassification(lease);
      useApp.setState({ screenReading: 'error', screenSeenAt: null, screenActivity: null });
    }
  } finally {
    if (lease.request === request) {
      lease.request = undefined;
      // Keep OCR responsive and take the next classification frame near its deadline.
      const untilClassification = lease.nextClassificationAt - Date.now();
      schedule(lease, untilClassification > 0 ? Math.min(SAMPLE_MS, untilClassification) : SAMPLE_MS);
    }
  }
}

async function classify(lease: Capture, deckId: string, slideIndex: number, goal: string, seenAt: number) {
  if (lease.classification || seenAt < lease.nextClassificationAt || lease.deckId !== deckId) return;
  const text = useApp.getState().decks.find((deck) => deck.id === deckId)?.slides[slideIndex]?.text;
  if (!text) return;

  const request = new AbortController();
  lease.classification = request;
  lease.nextClassificationAt = seenAt + CLASSIFY_EVERY_MS;
  let label: ActivityLabel = 'unavailable';
  try {
    const response = await fetch('/v1/web-screen/activity', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal, text }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(4500)]),
    });
    if (response.ok) {
      const result: { label?: unknown } = await response.json();
      if (result.label === 'related' || result.label === 'off-topic' || result.label === 'uncertain') label = result.label;
    }
  } catch {
    // A failed inference breaks the reminder streak.
  } finally {
    if (lease.classification === request) lease.classification = undefined;
  }
  if (request.signal.aborted || capture !== lease) return;

  const current = useApp.getState();
  if (current.slideIndex !== slideIndex || !hasRecentScreenText() || showsLockIn(lease)) {
    lease.reminder = advanceActivityReminder(lease.reminder, 'uncertain', seenAt, 0).state;
    return;
  }

  useApp.setState({ screenActivity: label });
  const { state, notify } = advanceActivityReminder(
    lease.reminder, label, seenAt, Math.max(60_000, (current.settings.cooldownSec ?? 60) * 1000),
  );
  lease.reminder = state;
  if (notify && !current.rescue && !current.breakCard && (current.live.noteTakingUntil ?? 0) <= Date.now()) {
    actions.toast('This page may be unrelated to your study goal.');
    playCue();
    if (!document.hasFocus()) notifyOffTopic();
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', stopScreenShare);
  useApp.subscribe((state, previous) => {
    if (capture && (state.deckId !== capture.deckId || state.screen === 'desk' || state.screen === 'report')) {
      reading = false;
      stopScreenShare();
    }
    if (state.screen === 'desk' && previous.screen !== 'desk' && previous.decks.some((deck) => deck.sourceType === 'screen')) {
      actions.discardScreenDecks();
    }
  });
}

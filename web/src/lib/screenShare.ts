import { actions, useApp } from '../store';
import { primeCue } from './callback';
import { uid } from './storage';
import type { Deck, ScreenDiagnostic } from '../contracts/types';
import { ScreenTimeline, SCENE_GAP_MS } from '../screenStudy/timeline';
import { ScreenProcessor } from '../screenStudy/processor';
import { sceneChanged } from '../screenStudy/sceneChange';
import { sameReadingDocument } from '../screenStudy/continuity';
import { ReadingNavigation } from '../screenStudy/navigation';
import { recordClassification } from '../screenStudy/classificationHistory';
import type { ScreenScene } from '../screenStudy/types';

const SAMPLE_MS = 750;
const REFRESH_MS = 120_000;

interface Capture {
  deckId: string;
  track: MediaStreamTrack;
  events: AbortController;
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  probe: HTMLCanvasElement;
  signature?: Uint8ClampedArray;
  navigationSignature?: Uint8ClampedArray;
  navigation: ReadingNavigation;
  frame?: Promise<Blob | null>;
  timer?: number;
}

let capture: Capture | undefined;
let reading = false;
let choosing = false;
let diagnostics: ScreenDiagnostic[] = [];
let droppedSamples = 0;
let timeline: ScreenTimeline | undefined;
let processor: ScreenProcessor | undefined;
let studyContext: { deck: Deck; slideIndex: number } | undefined;
let contextTimestamp = 0;

function recordScreen(value: Omit<ScreenDiagnostic, 'at'>) {
  diagnostics.push({ at: Date.now(), ...value });
  if (diagnostics.length > 2000) { diagnostics.shift(); droppedSamples++; }
}

export const getScreenDiagnostics = () => ({ samples: [...diagnostics], droppedSamples });
export const getScreenTimeline = () => timeline;
export const getStudyScreenContext = () => studyContext;
export const getLiveScreenScene = (now = Date.now()) => reading ? timeline?.live(now) : undefined;
export const resolveScreenScene = (scene: ScreenScene, timestamp: number) => timeline?.resolve(scene, timestamp) ?? scene;

export function beginScreenAnalysis(startedAt: number) {
  processor?.cancel();
  useApp.setState({ screenClassifications: [] });
  timeline = new ScreenTimeline(startedAt, useApp.getState().screenGoal);
  const owner = timeline;
  processor = new ScreenProcessor(owner, scene => { if (timeline === owner) publish(scene); });
  studyContext = undefined;
  contextTimestamp = 0;
  if (capture) { capture.signature = undefined; capture.navigation.clear(); }
}

/** Stop acquisition immediately, then let bounded historical work finish. */
export async function finishScreenAnalysis() {
  const pendingFrame = capture?.frame;
  stopScreenShare();
  await pendingFrame;
  await processor?.finish();
}

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
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 3, max: 5 } }, audio: false,
      selfBrowserSurface: 'exclude',
    } as DisplayMediaStreamOptions & { selfBrowserSurface: 'exclude' });
    const track = stream.getVideoTracks()[0];
    if (!track || track.readyState !== 'live') throw new Error('Screen stream unavailable');
    const current = useApp.getState();
    if (current.screen !== previous.screen || current.deckId !== previous.deckId) {
      stream.getTracks().forEach(item => item.stop());
      return;
    }
    const deckId = reuseSession ? current.deckId : uid('screen_');
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    const lease: Capture = { deckId, track, video, events: new AbortController(), navigation: new ReadingNavigation(),
      canvas: document.createElement('canvas'), probe: document.createElement('canvas') };
    lease.probe.width = 256;
    lease.probe.height = 144;
    track.enabled = reading;
    if (!reuseSession) {
      processor?.cancel(); processor = undefined; timeline = undefined; studyContext = undefined;
      diagnostics = []; droppedSamples = 0;
      useApp.setState({ screenOcr: null, screenGoal: goal.trim().slice(0, 300), screenActivity: null, screenClassifications: [] });
      actions.addDeck({ id: deckId, sourceType: 'screen', title: 'Shared screen', slides: [], slideCount: 0 });
      actions.go('study');
    }
    capture = lease;
    const settings = track.getSettings();
    recordScreen({ status: 'selected', message: settings.displaySurface ?? 'unknown',
      displaySurface: settings.displaySurface, width: settings.width, height: settings.height });
    if (settings.displaySurface && settings.displaySurface !== 'monitor') actions.toast('Share the entire calibrated display to follow study across WPS and browser tabs.');
    track.addEventListener('ended', stopScreenShare, { signal: lease.events.signal, once: true });
    track.addEventListener('mute', () => {
      timeline?.breakScene(); lease.signature = undefined; lease.navigation.clear();
      useApp.setState({ screenReading: 'reading', screenSeenAt: null, screenActivity: null });
    }, { signal: lease.events.signal });
    useApp.setState({ screenReading: reading ? 'reading' : 'waiting', screenSeenAt: null });
    if (reading) schedule(lease, 0);
  } catch (error) {
    stream?.getTracks().forEach(item => item.stop());
    if (!(error instanceof DOMException && error.name === 'NotAllowedError')) actions.toast('Screen sharing could not start. Try selecting your display again.', 'error');
  } finally { choosing = false; }
}

export function stopScreenShare() {
  const lease = capture;
  if (!lease) return;
  capture = undefined;
  recordScreen({ status: 'stopped' });
  if (lease.timer !== undefined) clearTimeout(lease.timer);
  timeline?.breakScene();
  lease.events.abort();
  lease.track.stop();
  lease.video.srcObject = null;
  useApp.setState({ screenReading: 'stopped', screenSeenAt: null, screenActivity: null });
}

export function setScreenReading(enabled: boolean) {
  reading = enabled;
  if (!capture) return;
  recordScreen({ status: enabled ? 'reading' : 'paused' });
  if (capture.timer !== undefined) clearTimeout(capture.timer);
  timeline?.breakScene(); capture.signature = undefined; capture.navigation.clear();
  capture.track.enabled = enabled;
  if (!enabled) capture.video.pause();
  useApp.setState({ screenReading: enabled ? 'reading' : 'paused', screenSeenAt: null, screenActivity: null });
  if (enabled) schedule(capture, 0);
}

export function hasRecentScreenText(now = Date.now()) { return getLiveScreenScene(now)?.status === 'ready'; }

export function hasStudyRecapContext(now: number) {
  const raw = getLiveScreenScene(now);
  const scene = raw ? resolveScreenScene(raw, now) : undefined;
  return scene?.status === 'ready' && (!timeline?.goal || scene.label === 'related');
}

function schedule(lease: Capture, delay = SAMPLE_MS) {
  if (reading && capture === lease) lease.timer = window.setTimeout(() => void sample(lease), delay);
}

function showsLockIn(lease: Capture) {
  const surface = lease.track.getSettings().displaySurface;
  return (surface === 'monitor' || surface === 'window') && document.hasFocus();
}

function publish(scene: ScreenScene) {
  recordScreen({ status: scene.status, capturedAt: scene.timestamp,
    durationMs: scene.ocrDurationMs,
    lineCount: scene.blocks?.length ?? scene.text?.split('\n').length ?? 0,
    width: scene.width, height: scene.height, message: scene.message ?? scene.label ?? undefined });
  const lease = capture;
  if (lease && timeline && scene.blocks) lease.navigation.learn(scene, timeline);
  // Preserve historical text even when inference finishes after the learner switched pages.
  const state = useApp.getState();
  const history = recordClassification(state.screenClassifications, scene);
  if (history !== state.screenClassifications) useApp.setState({ screenClassifications: history });
  const deck = state.decks.find(d => d.id === state.deckId && d.sourceType === 'screen');
  if (scene.status === 'ready' && scene.slideIndex === undefined && deck) {
    scene.slideIndex = deck.slides.length;
    const slides = [...deck.slides, { index: scene.slideIndex, title: `Screen moment ${scene.id}`, text: scene.text! }];
    useApp.setState({ decks: state.decks.map(d => d === deck ? { ...d, slides, slideCount: slides.length } : d) });
  }
  if (scene.status === 'ready' && scene.slideIndex !== undefined && scene.timestamp >= contextTimestamp
    && (!timeline?.goal || (scene.label === 'related' && !!scene.studyText?.trim()))) {
    const saved = useApp.getState().decks.find(d => d.id === state.deckId)!;
    const slides = saved.slides.map((slide, index) => index === scene.slideIndex
      ? { ...slide, text: scene.studyText ?? scene.text! } : slide);
    studyContext = { deck: { ...saved, slides }, slideIndex: scene.slideIndex };
    contextTimestamp = scene.timestamp;
  }
  if (!lease || !reading || timeline?.current !== scene || Date.now() - scene.observedUntil > SCENE_GAP_MS || showsLockIn(lease)) return;
  useApp.setState({ screenOcr: { status: scene.status, message: scene.message ??
    (scene.status === 'ready' ? 'Screen text extracted. Matching it with your gaze.' : 'Reading the current screen.') } });
  if (scene.status === 'ready') {
    useApp.setState({ slideIndex: scene.slideIndex ?? state.slideIndex, screenReading: 'ready',
      screenSeenAt: scene.observedUntil, screenActivity: scene.label });
  } else useApp.setState({ screenReading: scene.status === 'pending' ? 'reading' : scene.status === 'no-text' ? 'no-text' : 'error', screenSeenAt: null });
}

async function sample(lease: Capture) {
  if (capture !== lease || !reading || !timeline || !processor) return;
  const owner = timeline;
  try {
    if (lease.track.readyState !== 'live') { stopScreenShare(); return; }
    if (showsLockIn(lease) || useApp.getState().rescue || useApp.getState().breakCard || lease.track.muted) {
      owner.breakScene(); lease.signature = undefined; lease.navigation.clear();
      useApp.setState({ screenReading: 'on-lockin', screenSeenAt: null, screenActivity: null });
      return;
    }
    if (lease.video.paused) await lease.video.play();
    if (!reading || capture !== lease || timeline !== owner) return;
    const width = lease.video.videoWidth, height = lease.video.videoHeight;
    if (!width || !height) return;
    const probe = lease.probe.getContext('2d', { willReadFrequently: true })!;
    probe.drawImage(lease.video, 0, 0, 256, 144);
    const signature = probe.getImageData(0, 0, 256, 144).data;
    const now = Date.now(), previous = owner.current;
    const retry = (previous?.status === 'error' || previous?.label === 'unavailable')
      && now - (previous.classifiedAt ?? previous.completedAt ?? now) >= 5000;
    const anchored = lease.navigation.matches(signature);
    const sameDocument = !!previous && (anchored ?? sameReadingDocument(lease.navigationSignature, signature));
    // Navigation changes matter even when the body happens to look identical.
    const navigationChanged = !!previous && (anchored === false
      || (anchored === undefined && sameReadingDocument(lease.navigationSignature, lease.navigationSignature ?? signature) && !sameDocument));
    const changed = sceneChanged(lease.signature, signature) || navigationChanged
      || (!!previous && now - previous.timestamp >= REFRESH_MS);
    const scale = Math.min(1, 1600 / Math.max(width, height));
    const scene = owner.observe(now, changed, Math.round(width * scale), Math.round(height * scale), lease.track.getSettings().displaySurface ?? 'unknown', sameDocument);
    lease.navigation.record(scene, signature);
    if (!previous || scene.documentId !== previous.documentId) lease.navigationSignature = signature;
    if (scene === previous && !retry) {
      const evidence = owner.resolve(scene, now);
      if (evidence.status === 'ready') useApp.setState({ screenSeenAt: scene.observedUntil, screenReading: 'ready', screenActivity: evidence.label });
      return;
    }
    // A service retry is not a page change. Retain the scene so a successful
    // result can resolve actual gaze observations made while it was unavailable.
    if (scene === previous) {
      if (scene.status === 'ready') {
        // The image is unchanged and OCR succeeded: retry only the failed model.
        processor.retryClassification(scene);
        useApp.setState({ screenActivity: scene.label });
        return;
      }
      scene.status = 'pending'; scene.label = owner.goal ? 'checking' : null;
      scene.message = undefined; scene.classifiedAt = undefined; scene.completedAt = undefined;
    }
    // Compare against the scene's original frame so gradual scrolling still accumulates.
    if (changed) lease.signature = signature;
    useApp.setState({ screenReading: 'reading', screenSeenAt: null, screenActivity: null });
    lease.canvas.width = scene.width; lease.canvas.height = scene.height;
    lease.canvas.getContext('2d')!.drawImage(lease.video, 0, 0, scene.width, scene.height);
    lease.frame = new Promise<Blob | null>(resolve => lease.canvas.toBlob(resolve, 'image/jpeg', .85));
    const frame = await lease.frame;
    lease.frame = undefined;
    lease.canvas.width = lease.canvas.height = 1;
    if (frame && owner === timeline) processor.enqueue(scene, frame);
    else { scene.status = 'error'; scene.message = 'Screen capture unavailable.'; }
  } catch (error) {
    recordScreen({ status: 'error', message: error instanceof Error ? error.message : 'Screen capture failed.' });
    owner.breakScene();
    useApp.setState({ screenReading: 'error', screenSeenAt: null });
  } finally { schedule(lease); }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { stopScreenShare(); processor?.cancel(); });
  useApp.subscribe((state, previous) => {
    if (capture && (state.deckId !== capture.deckId || state.screen === 'desk' || state.screen === 'report')) { reading = false; stopScreenShare(); }
    if (state.screen === 'desk' && previous.screen !== 'desk' && previous.decks.some(d => d.sourceType === 'screen')) actions.discardScreenDecks();
  });
}

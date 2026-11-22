import { create } from 'zustand';
import type { Deck, FocusState, GazeTracking, LapseTrigger, MemoryDecision, MemoryTopic, RescueContext, RescuePack, SessionLog, SessionReview, UserSettings, VariantChoice } from './contracts/types';
import type { ActivityLabel } from './lib/screenActivity';
import type { CameraStatus } from './lib/camera';
import { library } from './lib/library';
import { load, save, uid } from './lib/storage';

export type Screen = 'desk' | 'setup' | 'study' | 'report';
export type ScreenReading = 'idle' | 'waiting' | 'reading' | 'ready' | 'no-text' | 'on-lockin' | 'paused' | 'stopped' | 'error';
export type Theme = 'system' | 'light' | 'dark';

export interface Live {
  recapPreparation?: 'preparing' | 'ready' | 'unavailable';
  attentionAvailable: boolean;
  state: FocusState;
  /** smoothed camera score, 0–100 */
  score: number;
  /** after window focus */
  effective: number;
  windowActive: boolean;
  gazeTracking?: GazeTracking;
  /** 0–1 progress toward "refocused" while recovering */
  recoverProgress: number;
  cooldownUntil: number;
  noteTakingUntil: number | null;
  startedAt: number;
  /** seconds of active session time */
  elapsed: number;
  lapsesBySlide: Record<number, number>;
}

export interface RescueUI {
  id: string;
  phase: 'loading' | 'playing' | 'quiz' | 'error';
  trigger: LapseTrigger;
  offscreen?: boolean;
  depth: 1 | 2;
  context: RescueContext;
  choice?: VariantChoice;
  memoryDecision?: MemoryDecision;
  memoryTopic?: MemoryTopic;
  pack?: RescuePack;
  error?: string;
  lapseAt: number;
  startedAt?: number;
  /** A generated pack is waiting for the learner to allow audio playback. */
  awaitingPlayback?: boolean;
  clipEndedAt?: number;
  skipped: boolean;
  answers: { questionIndex: number; chosen: number; correct: boolean }[];
  /** "Wrong fact" was reported for this clip (and not taken back). */
  flagged?: boolean;
}

export interface ReviewQuestion {
  slideIndex: number;
  question: string;
  options: string[];
  answerIndex: number;
  chosen: number | null;
}

export interface Report {
  deck: Deck;
  log: SessionLog;
  review: SessionReview;
  /** Every rescue question, for the end-of-session review pack. */
  questions: ReviewQuestion[];
}

export interface DeckSummary {
  deckId: string;
  title: string;
  slideCount: number;
  lastStudied: number;
  lastSpanSec: number;
}

interface AppState {
  finishingReport: boolean;
  userId: string;
  screen: Screen;
  theme: Theme;
  settings: UserSettings;
  decks: Deck[];
  libraryReady: boolean;
  libraryWarning: string | null;
  reports: Report[];
  deckSummaries: Record<string, DeckSummary>;
  spanHistory: { at: number; sec: number }[];
  deckId: string;
  slideIndex: number;
  screenReading: ScreenReading;
  screenOcr: { status: string; message: string; engine?: string } | null;
  screenSeenAt: number | null;
  screenGoal: string;
  screenActivity: ActivityLabel | 'checking' | null;
  camera: CameraStatus;
  calibrated: boolean;
  /** Version of the consent screen the user agreed to, or null. */
  consent: string | null;
  live: Live;
  rescue: RescueUI | null;
  breakCard: { reason: 'repeated' | 'rescueCap'; until: number | null } | null;
  report: Report | null;
  settingsOpen: boolean;
  devOpen: boolean;
  toast: { id: number; text: string; tone?: 'info' | 'error' } | null;
}

const userId = load('lockin.userId', '') || uid('u_');
save('lockin.userId', userId);

export const DEFAULT_SETTINGS: UserSettings = {
  userId,
  slangLevel: 'unhinged',
  sensitivity: 0.5,
  roastsEnabled: true,
  backgroundStyle: 'auto',
  cooldownSec: 180,
};

export const emptyLive = (): Live => ({
  attentionAvailable: false,
  state: 'idle',
  score: 0,
  effective: 0,
  windowActive: true,
  recoverProgress: 0,
  cooldownUntil: 0,
  noteTakingUntil: null,
  startedAt: 0,
  elapsed: 0,
  lapsesBySlide: {},
});

export const useApp = create<AppState>(() => ({
  finishingReport: false,
  userId,
  screen: 'desk',
  theme: load<Theme>('lockin.theme', 'system'),
  settings: { ...DEFAULT_SETTINGS, ...load<Partial<UserSettings>>('lockin.settings', {}), userId },
  decks: [],
  libraryReady: false,
  libraryWarning: null,
  reports: [],
  deckSummaries: load('lockin.deckSummaries', {}),
  spanHistory: load('lockin.spanHistory', []),
  deckId: '',
  slideIndex: 0,
  screenReading: 'idle',
  screenOcr: null,
  screenSeenAt: null,
  screenGoal: '',
  screenActivity: null,
  camera: 'off',
  calibrated: load('lockin.calibrated', false),
  consent: load<string | null>('lockin.consent', null),
  live: emptyLive(),
  rescue: null,
  breakCard: null,
  report: null,
  settingsOpen: false,
  devOpen: false,
  toast: null,
}));

let loadingLibrary: Promise<void> | undefined;
export const actions = {
  loadLibrary() {
    return loadingLibrary ??= (async () => {
      const [decks, reports] = await Promise.allSettled([library.decks(), library.reports()]);
      useApp.setState({
        decks: decks.status === 'fulfilled' ? decks.value : [],
        reports: reports.status === 'fulfilled' ? reports.value : [],
        libraryReady: true,
        libraryWarning: decks.status === 'rejected' || reports.status === 'rejected'
          ? 'Browser storage is unavailable. New slides may only stay open for this visit.' : null,
      });
    })();
  },
  async saveDeck(deck: Deck, file?: Blob) {
    try { await library.saveDeck(deck, file); }
    catch {
      useApp.setState({ libraryWarning: 'This deck could not be saved in your browser. Keep this tab open, or free browser storage and upload it again.' });
      actions.toast('Slides opened for this visit only. Browser storage could not save this deck.', 'error');
    }
    actions.addDeck(deck);
  },
  async removeDeck(deck: Deck) {
    await library.removeDeck(deck.id);
    useApp.setState((s) => ({ decks: s.decks.filter((d) => d.id !== deck.id) }));
    if (deck.pdfUrl?.startsWith('blob:')) {
      const { releasePdf } = await import('./lib/pdf');
      await releasePdf(deck.pdfUrl);
    }
  },
  async saveReport(report: Report) {
    useApp.setState((s) => ({ report, reports: [report, ...s.reports.filter((r) => r.log.sessionId !== report.log.sessionId)] }));
    try { await library.saveReport(report); }
    catch { actions.toast('This report could not be saved. Download it before closing this tab.', 'error'); }
  },
  openReport(report: Report) {
    const deck = useApp.getState().decks.find((d) => d.id === report.deck.id) ?? report.deck;
    useApp.setState({ report: { ...report, deck } });
    actions.go('report');
  },
  go(screen: Screen) {
    useApp.setState({ screen });
    window.scrollTo(0, 0);
  },
  setSettings(patch: Partial<UserSettings>) {
    const settings = { ...useApp.getState().settings, ...patch };
    useApp.setState({ settings });
    save('lockin.settings', settings);
  },
  setTheme(theme: Theme) {
    useApp.setState({ theme });
    save('lockin.theme', theme);
    applyTheme(theme);
  },
  setCalibrated(v: boolean) {
    useApp.setState({ calibrated: v });
    save('lockin.calibrated', v);
  },
  setConsent(version: string | null) {
    useApp.setState({ consent: version });
    save('lockin.consent', version);
  },
  addDeck(deck: Deck) {
    const decks = [deck, ...useApp.getState().decks.filter((d) => d.id !== deck.id)];
    useApp.setState({ decks, deckId: deck.id, slideIndex: 0 });
  },
  acceptScreenText(deckId: string, lines: string[], seenAt: number) {
    const s = useApp.getState();
    const deck = s.decks.find((item) => item.id === deckId);
    if (s.deckId !== deckId || deck?.sourceType !== 'screen') return;
    const text = lines.map((line) => line.trim()).filter(Boolean).join('\n').slice(0, 2400);
    if (!text) {
      useApp.setState({ screenReading: 'no-text', screenSeenAt: null, screenActivity: s.screenGoal ? 'uncertain' : null });
      return;
    }
    if (deck.slides.at(-1)?.text === text) {
      useApp.setState({ screenReading: 'ready', screenSeenAt: seenAt });
      return;
    }
    const index = deck.slides.length;
    const latest = deck.slides.at(-1);
    // Keep full text only for the current view and moments used by a recap.
    const keepPrevious = s.live.state === 'lapse' || (latest && s.live.lapsesBySlide[latest.index]);
    const slides = latest && !keepPrevious
      ? [...deck.slides.slice(0, -1), { ...latest, text: '' }]
      : [...deck.slides];
    slides.push({ index, title: `Screen moment ${index + 1}`, text });
    useApp.setState({
      decks: s.decks.map((item) => item === deck ? { ...deck, slides, slideCount: slides.length } : item),
      slideIndex: index, screenReading: 'ready', screenSeenAt: seenAt,
      screenActivity: s.screenGoal ? 'checking' : null,
    });
  },
  discardScreenDecks() {
    const s = useApp.getState();
    useApp.setState({
      decks: s.decks.filter((deck) => deck.sourceType !== 'screen'),
      deckId: s.decks.find((deck) => deck.id === s.deckId)?.sourceType === 'screen' ? '' : s.deckId,
      slideIndex: 0, report: null, screenReading: 'idle', screenSeenAt: null, screenGoal: '', screenActivity: null,
    });
  },
  openDeck(deckId: string) {
    const deck = useApp.getState().decks.find((d) => d.id === deckId);
    if (!deck) return;
    const positions = load<Record<string, number>>('lockin.positions', {});
    useApp.setState({ deckId, slideIndex: Math.max(0, Math.min(deck.slideCount - 1, positions[deckId] ?? 0)) });
  },
  setSlide(i: number) {
    const s = useApp.getState();
    const deck = s.decks.find((d) => d.id === s.deckId);
    if (!deck) return;
    useApp.setState({ slideIndex: Math.max(0, Math.min(deck.slideCount - 1, i)) });
    save('lockin.positions', { ...load('lockin.positions', {}), [deck.id]: useApp.getState().slideIndex });
  },
  toast(text: string, tone: 'info' | 'error' = 'info') {
    const id = Date.now();
    useApp.setState({ toast: { id, text, tone } });
    setTimeout(() => {
      if (useApp.getState().toast?.id === id) useApp.setState({ toast: null });
    }, tone === 'error' ? 6000 : 3200);
  },
  recordSession(deck: Deck, spanSec: number) {
    const s = useApp.getState();
    const deckSummaries = {
      ...s.deckSummaries,
      [deck.id]: { deckId: deck.id, title: deck.title, slideCount: deck.slideCount, lastStudied: Date.now(), lastSpanSec: spanSec },
    };
    const spanHistory = [...s.spanHistory, { at: Date.now(), sec: spanSec }].slice(-20);
    useApp.setState({ deckSummaries, spanHistory });
    save('lockin.deckSummaries', deckSummaries);
    save('lockin.spanHistory', spanHistory);
  },
  async clearHistory() {
    await library.clearReports();
    useApp.setState({ deckSummaries: {}, spanHistory: [], reports: [], report: null });
    save('lockin.deckSummaries', {});
    save('lockin.spanHistory', []);
    try {
      localStorage.removeItem('lockin.mockAdaptive');
    } catch {
      /* ignore */
    }
  },
};

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export const currentDeck = () => {
  const s = useApp.getState();
  const deck = s.decks.find((d) => d.id === s.deckId);
  if (!deck) throw new Error('Open a deck before starting a study session.');
  return deck;
};
export const useDeck = () => useApp((s) => s.decks.find((d) => d.id === s.deckId)!);

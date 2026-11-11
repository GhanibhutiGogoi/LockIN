import { create } from 'zustand';
import type { Deck, FocusState, LapseTrigger, RescueContext, RescuePack, SessionLog, SessionReview, UserSettings, VariantChoice } from './contracts/types';
import type { CameraStatus } from './lib/camera';
import { DEMO_DECK } from './lib/demoDeck';
import { load, save, uid } from './lib/storage';

export type Screen = 'desk' | 'setup' | 'study' | 'report';
export type Theme = 'system' | 'light' | 'dark';

export interface Live {
  state: FocusState;
  /** smoothed camera score, 0–100 */
  score: number;
  /** after window focus */
  effective: number;
  windowActive: boolean;
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
  depth: 1 | 2;
  context: RescueContext;
  choice?: VariantChoice;
  pack?: RescuePack;
  error?: string;
  lapseAt: number;
  startedAt?: number;
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
  userId: string;
  screen: Screen;
  theme: Theme;
  settings: UserSettings;
  decks: Deck[];
  deckSummaries: Record<string, DeckSummary>;
  spanHistory: { at: number; sec: number }[];
  deckId: string;
  slideIndex: number;
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
  userId,
  screen: 'desk',
  theme: load<Theme>('lockin.theme', 'system'),
  settings: { ...DEFAULT_SETTINGS, ...load<Partial<UserSettings>>('lockin.settings', {}), userId },
  decks: [DEMO_DECK],
  deckSummaries: load('lockin.deckSummaries', {}),
  spanHistory: load('lockin.spanHistory', []),
  deckId: DEMO_DECK.id,
  slideIndex: 0,
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

export const actions = {
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
  openDeck(deckId: string) {
    useApp.setState({ deckId, slideIndex: 0 });
  },
  setSlide(i: number) {
    const s = useApp.getState();
    const deck = s.decks.find((d) => d.id === s.deckId);
    if (!deck) return;
    useApp.setState({ slideIndex: Math.max(0, Math.min(deck.slideCount - 1, i)) });
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
  clearHistory() {
    useApp.setState({ deckSummaries: {}, spanHistory: [] });
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
  return s.decks.find((d) => d.id === s.deckId) ?? DEMO_DECK;
};
export const useDeck = () => useApp((s) => s.decks.find((d) => d.id === s.deckId) ?? DEMO_DECK);

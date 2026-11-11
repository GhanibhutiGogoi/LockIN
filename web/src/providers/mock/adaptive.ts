import type { AdaptiveProvider } from '../../contracts/providers';
import type {
  ClipSeconds,
  HumourStyle,
  RescueContext,
  RescueOutcome,
  SessionConfig,
  SessionLog,
  SessionReview,
  SessionScore,
  UserSettings,
  Variant,
  VariantChoice,
} from '../../contracts/types';
import { configForSensitivity } from '../../session/machine';
import { formatDuration, scoreSession } from '../../session/metrics';
import { load, save } from '../../lib/storage';

/**
 * Mock personal-AI. Beta-Bernoulli Thompson sampling over a small arm set,
 * restricted to the user's chosen slang level, with a 5 % random holdout.
 * The real team replaces this with linear TS + hierarchical priors.
 */
const LENGTHS: ClipSeconds[] = [20, 40];
const HUMOUR: HumourStyle[] = ['memes', 'analogies', 'roasts'];
const GAMEPLAY = ['runner', 'parkour', 'kinetic-sand', 'marble'];

interface Arm {
  a: number;
  b: number;
}
interface Store {
  arms: Record<string, Arm>;
  history: { at: number; score: SessionScore }[];
  memo?: string;
  settings?: UserSettings;
}
const KEY = 'lockin.mockAdaptive';

function beta(a: number, b: number): number {
  // Jöhnk-free approximation: mean + scaled noise is enough for a mock
  const mean = a / (a + b);
  const sd = Math.sqrt((a * b) / ((a + b) ** 2 * (a + b + 1)));
  return mean + sd * (Math.random() * 2 - 1) * 1.7;
}

export function armId(v: Pick<Variant, 'targetSeconds' | 'humourStyle' | 'gameplayType'>) {
  return `${v.targetSeconds}s·${v.humourStyle}·${v.gameplayType}`;
}

export class MockAdaptiveProvider implements AdaptiveProvider {
  readonly name = 'Mock (Thompson sampling)';
  private store: Store = load<Store>(KEY, { arms: {}, history: [] });

  private persist() {
    save(KEY, this.store);
  }

  async getSessionConfig(_userId: string, settings: UserSettings): Promise<Partial<SessionConfig>> {
    this.store.settings = settings;
    const c = configForSensitivity(settings.sensitivity);
    return { ...c, cooldownSec: settings.cooldownSec };
  }

  async chooseVariant(ctx: RescueContext): Promise<VariantChoice> {
    const slang = this.store.settings?.slangLevel ?? 'unhinged';
    const roasts = this.store.settings?.roastsEnabled ?? true;
    const humours = roasts ? HUMOUR : HUMOUR.filter((h) => h !== 'roasts');
    const candidates: Variant[] = [];
    for (const targetSeconds of LENGTHS)
      for (const humourStyle of humours)
        for (const gameplayType of GAMEPLAY)
          candidates.push({
            id: '',
            targetSeconds,
            slangLevel: slang,
            humourStyle,
            gameplayType,
            voiceId: slang === 'plain' ? 'chill' : 'hype',
            pacing: slang === 'unhinged' ? 1.1 : 1,
            recapOrPreview: 'recap',
            quizCount: 1,
          });
    candidates.forEach((v) => (v.id = armId(v)));

    const isHoldout = Math.random() < 0.05;
    let pick: Variant;
    let isExplore = false;
    if (isHoldout) {
      pick = candidates[Math.floor(Math.random() * candidates.length)];
    } else {
      let best = -Infinity;
      pick = candidates[0];
      for (const v of candidates) {
        const arm = this.store.arms[v.id] ?? { a: 1, b: 1 };
        // deeper clip prefers the shorter length: the user already saw one
        const bias = ctx.rescueInRow > 1 && v.targetSeconds === 20 ? 0.15 : 0;
        const s = beta(arm.a, arm.b) + bias;
        if (s > best) {
          best = s;
          pick = v;
        }
      }
      const arm = this.store.arms[pick.id];
      isExplore = !arm || arm.a + arm.b < 4;
    }
    return { variant: pick, isHoldout, isExplore, action: 'clip' };
  }

  async reportOutcome(o: RescueOutcome): Promise<void> {
    const q = o.quiz.length ? o.quiz.filter((x) => x.correct).length / o.quiz.length : 0;
    const baseline = 0.6;
    const r = (o.attentionAfter ?? 0) - baseline + 0.5 * q - 0.1 * (o.clipSeconds / 60);
    const arm = this.store.arms[o.variantId] ?? { a: 1, b: 1 };
    if (r > 0) arm.a += 1;
    else arm.b += 1;
    this.store.arms[o.variantId] = arm;
    this.persist();
  }

  async endSession(log: SessionLog): Promise<SessionReview> {
    const score = scoreSession(log.samples, log.rescues);
    const prev = this.store.history.slice(-5);
    const base = prev.length ? prev.reduce((s, h) => s + h.score.sustainedEpisodeMedianSec, 0) / prev.length : null;
    score.deltaVsBaseline = base && base > 0 ? (score.sustainedEpisodeMedianSec - base) / base : null;
    if (log.samples.length > 60) this.store.history.push({ at: log.endedAt, score });

    const memo = this.writeMemo(log, score);
    this.store.memo = memo;
    this.persist();
    return { score, profileMemo: memo, tips: this.tips(log, score) };
  }

  async getProfileMemo(): Promise<string | undefined> {
    return this.store.memo;
  }

  private writeMemo(log: SessionLog, score: SessionScore): string {
    const parts: string[] = [];
    const byLen = new Map<number, number[]>();
    for (const r of log.rescues) {
      const len = Number(r.variantId.split('s·')[0]);
      if (r.timeToRefocusSec !== null) byLen.set(len, [...(byLen.get(len) ?? []), r.timeToRefocusSec]);
    }
    const lens = [...byLen.entries()].map(([l, xs]) => [l, xs.reduce((a, b) => a + b, 0) / xs.length] as const).sort((a, b) => a[1] - b[1]);
    if (lens.length > 1) parts.push(`${lens[0][0]}-second clips brought you back faster than ${lens.at(-1)![0]}-second ones.`);
    const first = log.rescues[0];
    if (first) parts.push(`Your first lapse came ${formatDuration(first.context.minutesIntoSession * 60)} in.`);
    if (score.quizAccuracy !== null) parts.push(score.quizAccuracy >= 0.6 ? 'You answer rescue questions well, so the clips are landing.' : 'Quiz answers were shaky; plainer explanations may land better.');
    return parts.join(' ') || 'Not enough data yet. A few more sessions and LockIn will know what brings you back.';
  }

  private tips(log: SessionLog, score: SessionScore): string[] {
    const tips: string[] = [];
    const first = log.rescues[0];
    if (first && first.context.minutesIntoSession > 3) tips.push(`Next time, LockIn can offer a 15-second recap at minute ${Math.max(1, Math.round(first.context.minutesIntoSession - 2))}, just before you usually fade.`);
    if (score.lapsesPer30Min > 4) tips.push('Lapses were frequent. Shorter sessions with a break every 25 minutes may suit you better.');
    return tips;
  }
}

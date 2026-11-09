/**
 * A realistic 38-minute session on the sample deck, for previewing the report
 * without studying for 38 minutes. Clearly marked as an example in the UI.
 */
import type { FocusLogEntry, FocusState, RescueOutcome } from '../contracts/types';
import { scoreSession } from '../session/metrics';
import type { Report } from '../store';
import { DEMO_DECK } from './demoDeck';
import { DEMO_SCRIPTS } from '../providers/mock/demoScripts';

export function buildSampleReport(): Report {
  const startedAt = Date.now() - 38 * 60_000;
  const samples: FocusLogEntry[] = [];
  const rescues: RescueOutcome[] = [];
  // [durationSec, state, slide]
  const plan: [number, FocusState, number][] = [
    [300, 'focused', 0],
    [220, 'focused', 1],
    [9, 'drifting', 1],
    [260, 'focused', 2],
    [10, 'drifting', 2],
    [1, 'lapse', 2],
    [24, 'rescue', 2],
    [5, 'recovering', 2],
    [410, 'focused', 3],
    [120, 'paused', 3],
    [330, 'focused', 4],
    [9, 'drifting', 4],
    [1, 'lapse', 4],
    [22, 'rescue', 4],
    [13, 'recovering', 4],
    [1, 'lapse', 4],
    [18, 'rescue', 4],
    [6, 'recovering', 4],
    [350, 'focused', 5],
    [8, 'drifting', 5],
    [1, 'lapse', 5],
    [21, 'rescue', 5],
    [4, 'recovering', 5],
    [200, 'focused', 6],
    [130, 'focused', 7],
  ];
  let t = 0;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let rescueInRow = 0;
  for (const [dur, state, slideIndex] of plan) {
    if (state === 'lapse') {
      rescueInRow = samples.at(-1)?.state === 'recovering' ? rescueInRow + 1 : 1;
      const q = DEMO_SCRIPTS[slideIndex].quiz[0];
      const correct = slideIndex !== 4 || rescueInRow === 2;
      rescues.push({
        rescueId: `sample-${rescues.length}`,
        sessionId: 'sample',
        userId: 'sample',
        context: {
          userId: 'sample',
          deckId: DEMO_DECK.id,
          slideIndex,
          minutesIntoSession: Math.round((t / 60) * 10) / 10,
          lapseDepth: 0.4,
          slideDifficulty: DEMO_DECK.slides[slideIndex].difficulty ?? 0.5,
          trigger: 'gaze',
          rescueInRow,
          rescuesSoFar: rescues.length,
          recentVariantIds: [],
          hourOfDay: 21,
        },
        variantId: rescueInRow === 2 ? '20s·analogies·marble' : slideIndex === 2 ? '40s·memes·runner' : '20s·memes·runner',
        isHoldout: false,
        startedAt: startedAt + t * 1000,
        endedAt: startedAt + (t + 22) * 1000,
        clipSeconds: 22,
        skipped: false,
        quiz: [{ questionIndex: 0, chosen: correct ? q.answerIndex : (q.answerIndex + 1) % q.options.length, correct }],
        timeToRefocusSec: 26 + Math.round(rnd() * 12),
        attentionAfter: 0.7 + rnd() * 0.25,
      });
    }
    for (let i = 0; i < dur; i++, t++) {
      let score: number;
      if (state === 'focused') score = 70 + rnd() * 25 - (i > dur - 40 ? (i - (dur - 40)) * 0.6 : 0);
      else if (state === 'drifting') score = 30 + rnd() * 14;
      else if (state === 'recovering') score = 50 + (i / dur) * 25;
      else if (state === 'paused') score = 0;
      else score = 20 + rnd() * 15;
      samples.push({ t, score: Math.round(score), state, slideIndex });
    }
  }
  const score = scoreSession(samples, rescues);
  score.deltaVsBaseline = 0.18;
  return {
    deck: DEMO_DECK,
    log: { sessionId: 'sample', userId: 'sample', deckId: DEMO_DECK.id, startedAt, endedAt: startedAt + t * 1000, samples, rescues },
    review: {
      score,
      profileMemo:
        '20-second clips brought you back about 9 seconds faster than 40-second ones. Analogies landed better than memes on the harder slides. Your first lapse usually comes around minute 13.',
      tips: ['Next time, LockIn can offer a 15-second recap at minute 11, just before you usually fade.'],
    },
    questions: rescues.map((r) => {
      const q = DEMO_SCRIPTS[r.context.slideIndex].quiz[0];
      return { slideIndex: r.context.slideIndex, question: q.question, options: q.options, answerIndex: q.answerIndex, chosen: r.quiz[0].chosen };
    }),
  };
}

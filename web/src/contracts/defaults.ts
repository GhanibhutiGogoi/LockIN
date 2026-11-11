import type { Variant } from './types';

/**
 * The variant used when the personal-AI service is unreachable, and the base
 * that a partial variant from `POST /choose` is merged onto.
 */
export const DEFAULT_VARIANT: Variant = {
  id: '20s·memes·runner',
  targetSeconds: 20,
  slangLevel: 'unhinged',
  humourStyle: 'memes',
  voiceId: 'hype',
  pacing: 1.1,
  gameplayType: 'runner',
  recapOrPreview: 'recap',
  quizCount: 1,
};

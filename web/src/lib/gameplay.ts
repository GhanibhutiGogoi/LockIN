import type { GameplayLoop } from '../contracts/types';

/** Pick once per playback; narration and caption caches remain unchanged. */
export function pickGameplay(loops: GameplayLoop[], type: string, previousId?: string): GameplayLoop | undefined {
  const playable = loops.filter(loop => loop.url);
  const matches = type === 'auto' ? playable : playable.filter(loop => loop.type === type);
  const pool = matches.length ? matches : playable;
  const alternatives = pool.filter(loop => loop.id !== previousId);
  const choices = alternatives.length ? alternatives : pool;
  return choices[Math.floor(Math.random() * choices.length)];
}

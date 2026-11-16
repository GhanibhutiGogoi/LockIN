import { expect, it, vi } from 'vitest';
import { DEFAULT_VARIANT } from '../../contracts/defaults';
import { DEMO_DECK } from '../../lib/demoDeck';
import { MockContentProvider } from './content';

vi.mock('../../lib/pdf', () => ({ extractPages: vi.fn() }));

it('produces different narration for the analogy and humor variants at the same slang level', async () => {
  const provider = new MockContentProvider();
  const args = { deck: DEMO_DECK, slide: DEMO_DECK.slides[0], depth: 1 as const };
  const humor = await provider.getScript({ ...args, variant: DEFAULT_VARIANT });
  const analogy = await provider.getScript({ ...args, variant: { ...DEFAULT_VARIANT, humourStyle: 'analogies' } });
  expect(analogy.script).not.toBe(humor.script);
  expect(analogy.quiz).toEqual(humor.quiz);
});

import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Deck, FocusLogEntry } from '../contracts/types';
import { FocusTimeline, timelineSegments } from './FocusTimeline';

const sample = (t: number): FocusLogEntry => ({ t, score: 100, state: 'focused', slideIndex: 0 });

it('renders separate paths for separated observations instead of implying continuous focus', () => {
  const samples = [0, 1, 60, 61, 120].map(sample);
  expect(timelineSegments(samples).map(s => s.map(p => p.t))).toEqual([[0, 1], [60, 61], [120]]);
  const html = renderToStaticMarkup(<FocusTimeline samples={samples} rescues={[]} deck={{ slides: [] } as unknown as Deck} sessionStart={0} sessionSeconds={158} />);
  expect(html.match(/stroke="var\(--pen\)"/g)).toHaveLength(3);
  expect(html).toContain('Focus score over 2:38');
  expect(html).toContain('<circle');
});

it('preserves gaps and endpoints when downsampling long sessions', () => {
  const samples = [...Array.from({ length: 450 }, (_, i) => sample(i)), ...Array.from({ length: 450 }, (_, i) => sample(i + 800))];
  const segments = timelineSegments(samples);
  expect(segments).toHaveLength(2);
  expect(segments.map(s => [s[0].t, s.at(-1)!.t])).toEqual([[0, 449], [800, 1249]]);
  expect(segments.flat().length).toBeLessThan(400);
});

import type { ContentProvider } from '../../contracts/providers';
import type { Deck, QuizQuestion, RescueScript, SlangLevel, Slide, Variant } from '../../contracts/types';
import { DEMO_DECK, keyTermsOf, plainText } from '../../lib/demoDeck';
import { extractPages } from '../../lib/pdf';
import { DEMO_SCRIPTS } from './demoScripts';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const STOP = new Set(
  'the a an and or of to in on for with by is are was were be this that these those it its as at from into than then each per not no can will'.split(' '),
);

/** Template generator for uploaded decks. Deliberately simple: the real thing is an LLM. */
function templateScript(deck: Deck, slide: Slide, variant: Variant, depth: 1 | 2): RescueScript {
  const text = plainText(slide.text);
  const lines = text.split('\n').map((l) => l.replace(/^[-•·▪*]\s*/, '').trim()).filter(Boolean);
  const words = Math.round(variant.targetSeconds * 2.5 * variant.pacing);
  const lvl = variant.slangLevel;

  const hook: Record<SlangLevel, string> = {
    unhinged: `POV: you zoned out and “${slide.title}” is about to be on the exam.`,
    mild: `Quick one: ${slide.title}, the short version.`,
    plain: `${slide.title}, in brief.`,
  };
  const lead: Record<SlangLevel, string[]> = {
    unhinged: ['Okay so, key bit:', 'Next up:', 'Lowkey important:', 'No cap:', 'And this one’s exam bait:'],
    mild: ['Key bit:', 'Next:', 'Also:', 'Worth remembering:', 'And:'],
    plain: ['First:', 'Next:', 'Also:', 'Note:', 'Finally:'],
  };
  const outro: Record<SlangLevel, string> = {
    unhinged: 'That’s the slide. Back to it, bestie.',
    mild: 'That’s it. Back to the slide.',
    plain: 'Back to the slide.',
  };

  const picked = depth === 2 ? lines.slice(Math.max(0, lines.length - 3)) : lines;
  const sentences: string[] = [];
  let count = 0;
  picked.forEach((l, i) => {
    const s = `${lead[lvl][i % lead[lvl].length]} ${l.replace(/[.;:]$/, '')}.`;
    const n = s.split(/\s+/).length;
    if (count + n > words && sentences.length) return;
    sentences.push(s);
    count += n;
  });
  if (!sentences.length) sentences.push(`This slide is about ${slide.title}.`);
  sentences.push(outro[lvl]);

  const terms = keyTermsOf(slide.text);
  const candidates = terms.length
    ? terms
    : (text.match(/[A-Za-z][A-Za-z-]{4,}/g) ?? []).filter((w) => !STOP.has(w.toLowerCase())).sort((a, b) => b.length - a.length).slice(0, 2);
  const keyTerms = candidates.slice(0, 2).map((term) => ({ term, brollPrompt: `${term}, bold cartoon, neon colours, portrait` }));

  return {
    variant: { targetSeconds: variant.targetSeconds, slangLevel: lvl, humourStyle: variant.humourStyle },
    hook: hook[lvl],
    script: sentences.join(' '),
    keyTerms,
    quiz: variant.quizCount ? [clozeQuestion(deck, slide, lvl)].filter((q): q is QuizQuestion => !!q) : [],
    plainSummary: lines.slice(0, 2).join(' ') || slide.title,
    factChecked: true,
  };
}

function clozeQuestion(deck: Deck, slide: Slide, lvl: SlangLevel): QuizQuestion | null {
  const text = plainText(slide.text);
  const sentence = text.split(/\n|(?<=\.)\s/).find((s) => s.split(/\s+/).length >= 5) ?? text;
  const words = (sentence.match(/[A-Za-z][A-Za-z-]{4,}/g) ?? []).filter((w) => !STOP.has(w.toLowerCase()));
  if (!words.length) return null;
  const answer = words.sort((a, b) => b.length - a.length)[0];
  const pool = deck.slides
    .filter((s) => s.index !== slide.index)
    .flatMap((s) => plainText(s.title + ' ' + s.text).match(/[A-Za-z][A-Za-z-]{4,}/g) ?? [])
    .filter((w) => !STOP.has(w.toLowerCase()) && w.toLowerCase() !== answer.toLowerCase());
  const distractors = [...new Set(pool)].sort(() => Math.random() - 0.5).slice(0, 3);
  while (distractors.length < 3) distractors.push(['Mitochondria', 'Entropy', 'Osmosis', 'Catalyst'][distractors.length]);
  const options = [...distractors];
  const answerIndex = Math.floor(Math.random() * 4);
  options.splice(answerIndex, 0, answer);
  return {
    question: `Fill the gap: “${sentence.replace(answer, '_____').slice(0, 140)}”`,
    options,
    answerIndex,
    ifRight: lvl === 'plain' ? 'Correct.' : 'W. You were listening.',
    ifWrong: lvl === 'plain' ? `The answer is “${answer}”.` : `Not quite, chief. It’s “${answer}”.`,
  };
}

function demoScript(slide: Slide, variant: Variant, depth: 1 | 2): RescueScript {
  const d = DEMO_SCRIPTS[slide.index];
  const lvl = variant.slangLevel;
  const outro = lvl === 'unhinged' ? ' Back to the slide, bestie.' : lvl === 'mild' ? ' Back to the slide.' : '';
  return {
    variant: { targetSeconds: variant.targetSeconds, slangLevel: lvl, humourStyle: variant.humourStyle },
    hook: depth === 2 ? (lvl === 'plain' ? 'Once more, slower.' : 'Okay, one more time. Slower.') : d.hook[lvl],
    script: (depth === 2 ? d.deeper[lvl] : d.body[lvl]) + outro,
    keyTerms: d.keyTerms.map((term) => ({ term, brollPrompt: `${term}, bold cartoon, neon colours, portrait` })),
    quiz: d.quiz.slice(0, variant.quizCount),
    plainSummary: d.summary,
    factChecked: true,
  };
}

export class MockContentProvider implements ContentProvider {
  readonly name = 'Mock (templates)';

  async ingestDeck(file: File): Promise<Deck> {
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.pptx') || lower.endsWith('.ppt')) {
      throw new Error(
        'PowerPoint files need the AI analysis service to convert them. Export the deck as PDF, or connect the service in Integrations.',
      );
    }
    if (!lower.endsWith('.pdf') && file.type !== 'application/pdf') {
      throw new Error('LockIn reads PDF and PowerPoint files. This file is neither.');
    }
    const url = URL.createObjectURL(file);
    const pages = await extractPages(url);
    const title = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
    return {
      id: `local-${file.name}-${file.size}`,
      title,
      sourceType: 'pdf',
      slideCount: pages.length,
      pdfUrl: url,
      slides: pages.map((p, index) => ({
        index,
        title: p.title,
        text: p.text,
        difficulty: Math.min(1, p.text.split(/\s+/).length / 120),
      })),
    };
  }

  async getScript(args: { deck: Deck; slide: Slide; variant: Variant; depth: 1 | 2 }): Promise<RescueScript> {
    await wait(250 + Math.random() * 350);
    if (args.deck.id === DEMO_DECK.id && DEMO_SCRIPTS[args.slide.index]) {
      return demoScript(args.slide, args.variant, args.depth);
    }
    return templateScript(args.deck, args.slide, args.variant, args.depth);
  }

  prewarm() {}
  reportWrongFact() {}
  retractWrongFact() {}
}

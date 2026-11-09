/**
 * Runtime contract checks. Every HTTP / WebSocket adapter runs payloads through
 * these, and the Integrations panel shows the problems — so when a team's
 * service sends something the UI can't use, they see exactly which field.
 */
import type { Deck, FocusSample, RescueMedia, RescueScript, SessionReview, VariantChoice } from './types';

export type Problems = string[];

/** snake_case → camelCase, recursively. Lets Python services send their natural shape. */
export function camelize<T = unknown>(v: unknown): T {
  if (Array.isArray(v)) return v.map((x) => camelize(x)) as T;
  if (v && typeof v === 'object' && v.constructor === Object) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      out[k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())] = camelize(val);
    }
    return out as T;
  }
  return v as T;
}

/** camelCase → snake_case, recursively. Used for request bodies. */
export function snakify(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(snakify);
  if (v && typeof v === 'object' && v.constructor === Object) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())] = snakify(val);
    return out;
  }
  return v;
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === 'string';

function need(p: Problems, cond: boolean, msg: string) {
  if (!cond) p.push(msg);
}

export function checkDeck(d: Partial<Deck>): Problems {
  const p: Problems = [];
  need(p, isStr(d.id), 'deck.id must be a string');
  need(p, isStr(d.title), 'deck.title must be a string');
  need(p, Array.isArray(d.slides), 'deck.slides must be an array');
  (d.slides ?? []).forEach((s, i) => {
    need(p, isNum(s.index), `slides[${i}].index must be a number`);
    need(p, isStr(s.title), `slides[${i}].title must be a string`);
    need(p, isStr(s.text), `slides[${i}].text must be a string`);
  });
  return p;
}

export function checkScript(s: Partial<RescueScript>): Problems {
  const p: Problems = [];
  need(p, isStr(s.hook), 'script.hook must be a string');
  need(p, isStr(s.script) && s.script.length > 0, 'script.script must be a non-empty string');
  need(p, Array.isArray(s.keyTerms), 'script.keyTerms (key_terms) must be an array');
  need(p, Array.isArray(s.quiz), 'script.quiz must be an array');
  (s.quiz ?? []).forEach((q, i) => {
    need(p, isStr(q.question), `quiz[${i}].question must be a string`);
    need(p, Array.isArray(q.options) && q.options.length >= 2, `quiz[${i}].options needs ≥ 2 strings`);
    need(p, isNum(q.answerIndex) && q.answerIndex >= 0 && q.answerIndex < (q.options?.length ?? 0), `quiz[${i}].answerIndex (answer_index) out of range`);
    need(p, isStr(q.ifRight) && isStr(q.ifWrong), `quiz[${i}].ifRight / ifWrong must be strings`);
  });
  need(p, isStr(s.plainSummary), 'script.plainSummary (plain_summary) must be a string');
  return p;
}

export function checkMedia(m: Partial<RescueMedia>): Problems {
  const p: Problems = [];
  need(p, Array.isArray(m.captions) && m.captions.length > 0, 'media.captions must be a non-empty array');
  need(p, isNum(m.durationSec) && m.durationSec > 0, 'media.durationSec (duration_sec) must be > 0');
  (m.captions ?? []).slice(0, 400).forEach((c, i) => {
    if (!(isStr(c.word) && isNum(c.start) && isNum(c.end) && c.end >= c.start)) p.push(`captions[${i}] needs word, start ≤ end (seconds)`);
  });
  for (let i = 1; i < (m.captions?.length ?? 0); i++) {
    if (m.captions![i].start < m.captions![i - 1].start) {
      p.push(`captions are not sorted by start (index ${i})`);
      break;
    }
  }
  if (m.audioUrl !== undefined) need(p, isStr(m.audioUrl), 'media.audioUrl must be a string URL');
  need(p, Array.isArray(m.broll ?? []), 'media.broll must be an array');
  return p;
}

export function checkSample(s: Partial<FocusSample>): Problems {
  const p: Problems = [];
  need(p, isNum(s.t), 'sample.t must be ms since epoch');
  need(p, isNum(s.score) && s.score >= 0 && s.score <= 100, 'sample.score must be 0–100');
  need(p, isNum(s.confidence) && s.confidence >= 0 && s.confidence <= 1, 'sample.confidence must be 0–1');
  return p;
}

export function checkChoice(c: Partial<VariantChoice>): Problems {
  const p: Problems = [];
  need(p, !!c.variant && isStr(c.variant.id), 'choice.variant.id must be a string');
  need(p, typeof c.isHoldout === 'boolean', 'choice.isHoldout (is_holdout) must be a boolean');
  return p;
}

export function checkReview(r: Partial<SessionReview>): Problems {
  const p: Problems = [];
  need(p, !!r.score && isNum(r.score.sustainedEpisodeMedianSec), 'review.score.sustainedEpisodeMedianSec is required');
  return p;
}

export class ContractError extends Error {
  constructor(
    public readonly source: string,
    public readonly problems: Problems,
  ) {
    super(`${source} sent data the UI can't use:\n• ${problems.join('\n• ')}`);
  }
}

export function assertContract<T>(source: string, value: T, check: (v: T) => Problems): T {
  const problems = check(value);
  if (problems.length) throw new ContractError(source, problems);
  return value;
}

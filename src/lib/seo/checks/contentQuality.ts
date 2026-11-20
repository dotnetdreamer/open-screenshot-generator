// Copied from github.com/dotnetdreamer/claude-seo osg/checks/contentQuality.ts at da732e65be7f.
// Change it there and run npm run sync:seo-checks. Edits here are lost on the next sync.

// Signs of filler and machine-made copy (scripts/content_quality.py): the
// low-rating triggers of Google's Quality Rater Guidelines (September 2025),
// scored the same way. Advisory only: it never says "an AI wrote this".
//
// The AI-pattern phrases come from the Wikipedia "AI Cleanup" project's
// catalogue of LLM-typical phrasing (CC BY-SA 4.0), as the script cites.

import { PY_DIGIT, PY_SPACE, PY_WORD, pyClass, pyLower, pyMatchesAfterNonWord, pyRound, pyRoundInt, pyStrip, WORD_CHAR } from './py';

export const FILLER_PHRASES = [
  "it's important to note that",
  "in this article, we'll explore",
  'in this article we will explore',
  "in today's fast-paced world",
  "in today's digital age",
  "in today's competitive landscape",
  'needless to say',
  'at the end of the day',
  'when it comes to',
  'when all is said and done',
  'in the realm of',
  'in the world of',
  'the bottom line is',
  'without further ado',
  'first and foremost',
  'last but not least',
  "for what it's worth",
  'it goes without saying',
  'as we all know',
  'the truth is that',
  'the fact of the matter is',
  'more often than not',
  "let's dive in",
  "let's dive into",
  "let's take a closer look",
  "let's take a deeper look",
] as const;

export const AI_PATTERNS = [
  'delve into',
  'delve deeper into',
  'in the ever-evolving',
  'ever-evolving landscape',
  'ever-changing landscape',
  'in the dynamic landscape',
  'navigating the',
  'navigate the complexities',
  'tapestry of',
  'rich tapestry',
  'intricate tapestry',
  'embark on a journey',
  'embarking on this',
  'a testament to',
  'a beacon of',
  'the cornerstone of',
  'a cornerstone of',
  'at the heart of',
  'at its core',
  'in essence,',
  'in conclusion,',
  'ultimately,',
  'moreover,',
  'furthermore,',
  "however, it's worth noting",
  "it's worth noting that",
  'by leveraging',
  'leverage the power of',
  'leveraging the power of',
  'harness the power of',
  'unlock the potential',
  'unlock the full potential',
  'the realm of possibilities',
  'open up a world of',
  'a world of possibilities',
  'elevate your',
  'transform your',
  'revolutionize the way',
  'game-changer',
  'game-changing',
  'cutting-edge',
  'state-of-the-art',
  'in summary,',
  'to summarize,',
  'to put it simply,',
  'in a nutshell,',
] as const;

// East Asian blocks the word rule never claims; the kana and CJK branches of
// the token rule take them instead. From U+20000 up every letter is a CJK
// ideograph, so the script's scan stops there and so does this class.
const EAST_ASIAN = '\\u1100-\\u11ff\\u2e80-\\u33ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\ua960-\\ua97f\\uac00-\\ud7ff\\uf900-\\ufaff\\uff66-\\uffdc\\u{16fe0}-\\u{18d8f}\\u{1aff0}-\\u{1b2ff}\\u{20000}-\\u{10ffff}';
const NOT_EAST_ASIAN = `(?![${EAST_ASIAN}])`;
// Letters and marks by Python's unicodedata (py.ts), not the browser's Unicode version.
const LETTER = pyClass('L');
const MARK = `(?:${pyClass('Mn')}|${pyClass('Mc')})`;
const TOKEN = new RegExp(
  `${NOT_EAST_ASIAN}${LETTER}(?:${NOT_EAST_ASIAN}(?:${LETTER}|${MARK}|['\\-\\u200c\\u200d]))*` +
    '|[\\uac00-\\ud7a3]+' +
    '|[\\u3041-\\u3096\\u30a1-\\u30fa\\u30fc]' +
    '|[\\u3400-\\u4dbf\\u4e00-\\u9fff]',
  'gu',
);
const W = WORD_CHAR;
// _NUMBER_RE and _ENTITY_RE, \b...\b. Each starts with one of Python's \w, so
// the \b before it is no \w just before (countAfterNonWord). The \b after it
// depends on what the match ends with: after a \w, no \w next; after "%",
// a \w next. The order Python tries them in is kept: "%", st, nd, rd, th, none.
const NUMBER = new RegExp(`${PY_DIGIT}+(?:[.,]${PY_DIGIT}+)?(?:%(?=${W})|(?:st|nd|rd|th)(?!${W})|(?!${W}))`, 'gu');
const ENTITY = new RegExp(`[A-Z][a-z]+(?:${PY_SPACE}+[A-Z][a-z]+)+(?!${W})`, 'gu');
/** Python's [^\W\d_]: a word character that isn't a digit or "_". */
const PY_ALPHA = `(?:(?!${PY_DIGIT}|_)${PY_WORD})`;
const CJK_CHAR = /[\uac00-\ud7a3\u3041-\u3096\u30a1-\u30fa\u30fc\u3400-\u4dbf\u4e00-\u9fff]/gu;
const LATIN_CHAR = /[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f\u1e00-\u1eff]/gu;
const ALPHA_CHAR = new RegExp(PY_ALPHA, 'gu');
const UNSEGMENTED_CHAR = new RegExp(`(?=[\\u0e00-\\u0eff\\u1000-\\u109f\\u1780-\\u17ff\\ua9e0-\\ua9ff\\uaa60-\\uaa7f])${PY_ALPHA}`, 'gu');

function tokenise(text: string): string[] {
  return text.normalize('NFC').match(TOKEN) ?? [];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const phraseCache = new Map<string, RegExp>();
/** For the parity tests (regexes.test.ts): _NUMBER_RE.findall and _ENTITY_RE.findall. */
export function numberAndEntityMatches(text: string): [string[], string[]] {
  return [Array.from(pyMatchesAfterNonWord(NUMBER, text), (match) => match[0]), Array.from(pyMatchesAfterNonWord(ENTITY, text), (match) => match[0])];
}

/** _phrase_hits. Exported for the parity tests (regexes.test.ts). */
export function phraseHits(text: string, patterns: readonly string[]): string[] {
  const lowered = pyLower(text);
  return patterns.filter((pattern) => {
    let regex = phraseCache.get(pattern);
    if (!regex) {
      // The script's phrase with no \w before it and none after: the start is looked at in code (py.ts, pyMatchesAfterNonWord).
      regex = new RegExp(`${escapeRegExp(pattern)}(?!${W})`, 'gu');
      phraseCache.set(pattern, regex);
    }
    return !pyMatchesAfterNonWord(regex, lowered).next().done;
  });
}

function repetition(tokens: string[]): number {
  if (tokens.length < 4) return 0;
  const counts = new Map<string, number>();
  for (let i = 0; i < tokens.length - 1; i++) {
    const bigram = `${tokens[i]} ${tokens[i + 1]}`;
    counts.set(bigram, (counts.get(bigram) ?? 0) + 1);
  }
  let repeated = 0;
  for (const count of counts.values()) if (count > 1) repeated++;
  return repeated / Math.max(1, counts.size);
}

function count(text: string, regex: RegExp): number {
  return text.match(regex)?.length ?? 0;
}

/** len(re.findall(...)) for a pattern that starts with \b before a \w (pyMatchesAfterNonWord). */
function countAfterNonWord(text: string, regex: RegExp): number {
  let found = 0;
  for (const _ of pyMatchesAfterNonWord(regex, text)) found++;
  return found;
}

function detectScript(text: string): 'cjk' | 'unsegmented' | 'non_latin_alphabetic' | null {
  const cjk = count(text, CJK_CHAR);
  const latin = count(text, LATIN_CHAR);
  if (cjk && cjk >= latin) return 'cjk';
  const other = count(text, ALPHA_CHAR) - cjk - latin;
  if (other > 0 && other >= latin) {
    return count(text, UNSEGMENTED_CHAR) * 2 >= other ? 'unsegmented' : 'non_latin_alphabetic';
  }
  return null;
}

export interface ContentQuality {
  filler_score: number;
  ai_pattern_score: number;
  information_density: number;
  repetition_score: number;
  overall_quality: number;
  flags: string[];
  matches: { filler: string[]; ai_patterns: string[] };
  tokens: number;
  unique_tokens: number;
  coverage?: { script: string; entity_density: 'not_computed'; phrase_lists: 'english_only'; tokenisation?: 'low_confidence' };
}

export type ContentFlag = 'filler' | 'ai-patterns' | 'low-density' | 'repetitive' | 'thin-content' | 'empty-input';

/** Score a block of text against the Quality Rater Guidelines heuristics. */
export function analyseText(text: string): ContentQuality {
  if (!text || !pyStrip(text)) {
    return {
      filler_score: 0,
      ai_pattern_score: 0,
      information_density: 0,
      repetition_score: 0,
      overall_quality: 0,
      flags: ['empty-input'],
      matches: { filler: [], ai_patterns: [] },
      tokens: 0,
      unique_tokens: 0,
    };
  }
  const tokens = tokenise(text).map((token) => pyLower(token));
  const n = tokens.length;
  const unique = new Set(tokens).size;
  const filler = phraseHits(text, FILLER_PHRASES);
  const ai = phraseHits(text, AI_PATTERNS);
  const entities = countAfterNonWord(text, ENTITY);
  const numbers = countAfterNonWord(text, NUMBER);
  const densityPer100 = ((entities + numbers) * 100) / Math.max(1, n);
  const density = Math.min(1, densityPer100 / 10);
  const repetitionScore = pyRoundInt(repetition(tokens) * 100);
  const scale = Math.max(1, n / 1000);
  const fillerScore = Math.min(100, pyRoundInt((filler.length / scale) * 25));
  const aiScore = Math.min(100, pyRoundInt((ai.length / scale) * 15));
  const flags: string[] = [];
  if (fillerScore >= 50) flags.push('filler');
  if (aiScore >= 40) flags.push('ai-patterns');
  if (density < 0.2) flags.push('low-density');
  if (repetitionScore >= 30) flags.push('repetitive');
  if (n < 300) flags.push('thin-content');
  const overall =
    (100 - fillerScore) * 0.25 +
    (100 - aiScore) * 0.25 +
    density * 100 * 0.25 +
    (100 - repetitionScore) * 0.15 +
    Math.min(100, n / 10) * 0.1;
  const result: ContentQuality = {
    filler_score: fillerScore,
    ai_pattern_score: aiScore,
    information_density: pyRound(density, 3),
    repetition_score: repetitionScore,
    overall_quality: pyRoundInt(overall),
    flags,
    matches: { filler, ai_patterns: ai },
    tokens: n,
    unique_tokens: unique,
  };
  const script = detectScript(text);
  if (script) {
    result.coverage = { script, entity_density: 'not_computed', phrase_lists: 'english_only' };
    if (script === 'unsegmented') result.coverage.tokenisation = 'low_confidence';
  }
  return result;
}

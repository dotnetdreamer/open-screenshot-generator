// The checks scripts/plain-language.ts runs on every plain version before it
// keeps it, apart from the AI's own reading. Pure, so tests/unit can hold
// them to their word.
//
// In code: every date of the original, and every amount with a unit (a
// percentage, money, a time span, a count of people, a million), has to be in
// the plain version with the same unit: "48 hours" is not kept by "48 years",
// "4%" is kept by "4 percent", "EUR 100" by "€100" or "100 euros". Numbers
// without a unit (an age, a version, a threshold) are left to the AI's check.
//
// The AI's verdict on an entry has to be a list of sentences, empty when the
// meaning holds. Anything else (null, objects, a missing entry) is no answer,
// and no answer is never an approval.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH = MONTHS.join('|');

/** The dates of a text, as "12 September 2027", or "September 2027" with no day. */
export function datesOf(text: string): string[] {
  const out = new Set<string>();
  for (const match of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) out.add(`${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}`);
  for (const match of text.matchAll(new RegExp(`\\b(\\d{1,2}) (${MONTH}),? (\\d{4})\\b`, 'g'))) out.add(`${Number(match[1])} ${match[2]} ${match[3]}`);
  for (const match of text.matchAll(new RegExp(`\\b(${MONTH}) (\\d{1,2}),? (\\d{4})\\b`, 'g'))) out.add(`${Number(match[2])} ${match[1]} ${match[3]}`);
  for (const match of text.matchAll(new RegExp(`(?<!\\d )\\b(${MONTH}) (\\d{4})\\b`, 'g'))) out.add(`${match[1]} ${match[2]}`);
  return [...out];
}

/** Each unit, by the words that write it. */
const UNITS: Record<string, string[]> = {
  percent: ['%', 'percent', 'per cent'],
  day: ['days', 'day'],
  hour: ['hours', 'hour'],
  week: ['weeks', 'week'],
  month: ['months', 'month'],
  year: ['years', 'year'],
  minute: ['minutes', 'minute'],
  second: ['seconds', 'second'],
  thousand: ['thousand'],
  million: ['million'],
  billion: ['billion'],
  employee: ['employees', 'employee'],
  user: ['users', 'user'],
  people: ['people'],
  euro: ['euros', 'euro', 'EUR', '€'],
  dollar: ['dollars', 'dollar', 'USD', 'US$', '$'],
  pound: ['pounds', 'pound', 'GBP', '£'],
};
/** The units also written before the number: "EUR 100", "€100", "$4.99". */
const BEFORE = ['euro', 'dollar', 'pound'];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordsOf = (unit: string) => UNITS[unit].map(escape).join('|');
const ALL_AFTER = Object.keys(UNITS).map(wordsOf).join('|');
const ALL_BEFORE = BEFORE.map(wordsOf).join('|');
const NUMBER = '\\d+(?:[.,]\\d+)*';
/** Neither a letter nor a digit next to it, so "4%" and "48-hour" count and "48 hoursx" does not. */
const END = '(?![\\p{L}\\p{N}])';

function unitOf(word: string): string {
  const lower = word.toLowerCase();
  return Object.keys(UNITS).find((unit) => UNITS[unit].some((each) => each.toLowerCase() === lower))!;
}

/** "50,000" and "50 000" are 50000; "4.5" stays. */
function plainNumber(number: string): string {
  return number.replace(/[,\s](?=\d{3}(?!\d))/g, '');
}

export interface Amount {
  number: string;
  unit: string;
}

/** Every amount with a unit in a text: "48 hours", "4%", "17.5 million", "EUR 100", "€100". */
export function amountsOf(text: string): Amount[] {
  const out = new Map<string, Amount>();
  const add = (number: string, word: string) => {
    const amount = { number: plainNumber(number), unit: unitOf(word) };
    out.set(`${amount.number} ${amount.unit}`, amount);
  };
  for (const match of text.matchAll(new RegExp(`(?<![\\d.,])(${NUMBER})(?:\\s|-)?(${ALL_AFTER})${END}`, 'giu'))) {
    // "16-year-olds" is an age, not 16 years.
    if (/^[-\s]?olds?\b/i.test(text.slice((match.index ?? 0) + match[0].length))) continue;
    add(match[1], match[2]);
  }
  for (const match of text.matchAll(new RegExp(`(${ALL_BEFORE})\\s?(${NUMBER})(?![\\d])`, 'giu'))) add(match[2], match[1]);
  return [...out.values()];
}

/** The amount is in the text, with the same unit, written either way round for money. */
export function hasAmount(text: string, amount: Amount): boolean {
  const flat = text.replace(/(\d)[,\s](?=\d{3}(?!\d))/g, '$1');
  const number = escape(amount.number);
  const after = new RegExp(`(?<![\\d.,])${number}(?:\\s|-)?(?:${wordsOf(amount.unit)})${END}`, 'iu');
  if (after.test(flat)) return true;
  return BEFORE.includes(amount.unit) && new RegExp(`(?:${wordsOf(amount.unit)})\\s?${number}(?![\\d.,]?\\d)`, 'iu').test(flat);
}

/** The dates and amounts of the original the plain version does not have. */
export function lostFacts(original: string, plain: string): string[] {
  const out: string[] = [];
  const plainDates = datesOf(plain);
  for (const date of datesOf(original)) {
    // "September 2027" is kept by "12 September 2027" too.
    if (!plainDates.some((kept) => kept === date || kept.endsWith(` ${date}`))) out.push(`the date ${date} is missing`);
  }
  for (const amount of amountsOf(original)) {
    if (!hasAmount(plain, amount)) out.push(`the amount ${amount.number} ${amount.unit} is missing or has another unit`);
  }
  return out;
}

/**
 * The AI's verdict on one entry: the problems it names, an empty list when
 * the meaning holds, or null when the answer is not a list of sentences.
 */
export function readVerdict(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((item) => typeof item === 'string' && item.trim().length > 0)) return null;
  return value.map((item: string) => item.trim());
}

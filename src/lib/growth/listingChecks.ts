// Checks on the store listing that need no AI: limits, wasted keyword
// characters, words indexed twice, text copied into a language untranslated,
// and a language whose shoppers see another language's screenshots. A Google
// Play page has no keywords, subtitle or promotional text, so it gets the
// checks that apply there (checkPlayText), including the words Google's rules
// keep out of a title.
//
// Apple indexes the name, the subtitle and the keyword field together, and
// combines single words across them, so a word that appears in two of them is
// paid for twice and found once. That is the main source of the fixes here,
// and why the keyword fixer drops words the name and subtitle already carry.
//
// Languages written without spaces (Japanese, Chinese, Korean in part, Thai)
// are only checked comma by comma: splitting them into words needs a
// dictionary, and a wrong split would "fix" a keyword into nonsense.

import {
  LISTING_FIELD_LABELS,
  LISTING_LIMITS,
  type ListingChange,
  type ListingField,
  type ListingIssue,
  type ListingLocale,
  type ListingSnapshot,
} from './types';
import { listingFieldLabel, listingFieldsFor, listingLimit } from './listingFields';
import { storeOf } from './stores';
import { listingLanguageName } from './territories';

const NO_SPACES = /^(ja|zh|th|ko)/i;

/** Words so common that sharing them between fields is not a waste worth reporting. */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'the', 'of', 'for', 'to', 'in', 'on', 'with', 'your', 'you', 'my', 'by', 'at', 'or', 'is', 'it',
  '&', '+', '-', 'de', 'la', 'le', 'les', 'el', 'los', 'las', 'und', 'der', 'die', 'das', 'et', 'y', 'e', 'di', 'da',
]);

/** Release notes that tell people nothing. */
const GENERIC_NOTES = /^(bug fixes( and (performance )?improvements)?|performance improvements|minor (bug )?fixes|improvements|various fixes)\.?$/i;

export function splitKeywords(field: string): string[] {
  return field
    .split(/[,，、]/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

export function wordsOf(text: string, locale: string): string[] {
  if (NO_SPACES.test(locale)) return [];
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 2 && !STOPWORDS.has(word));
}

/** "photos" and "photo" are one search term to the store; a rough English-first fold. */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('es') && /(ss|sh|ch|x|z)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** Characters a field uses as Apple counts them (code points, so an emoji is one). */
export function fieldLength(value: string): number {
  return Array.from(value).length;
}

export interface KeywordCleanup {
  /** The keyword field rewritten, comma separated with no spaces. */
  keywords: string;
  removedDuplicates: string[];
  removedIndexed: string[];
  /** Characters the rewrite frees. */
  saved: number;
}

/**
 * The keyword field with nothing in it that the store already has: no spaces
 * after commas, no repeated keyword, and no keyword whose words all appear in
 * the name or subtitle. A multi-word keyword keeps the words that are new.
 */
export function cleanKeywords(listing: Pick<ListingLocale, 'keywords' | 'name' | 'subtitle' | 'locale'>): KeywordCleanup {
  const spaced = NO_SPACES.test(listing.locale);
  const indexed = new Set(
    wordsOf(`${listing.name} ${listing.subtitle}`, listing.locale).map(stem)
  );
  const seen = new Set<string>();
  const kept: string[] = [];
  const removedDuplicates: string[] = [];
  const removedIndexed: string[] = [];

  for (const keyword of splitKeywords(listing.keywords)) {
    const folded = keyword.toLowerCase();
    if (seen.has(folded)) {
      removedDuplicates.push(keyword);
      continue;
    }
    // Seen before any other verdict, so a keyword that is both repeated and
    // already in the name is reported as both.
    seen.add(folded);
    if (!spaced) {
      const words = keyword.split(/\s+/).filter(Boolean);
      const fresh = words.filter((word) => {
        const key = stem(word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''));
        return !key || !indexed.has(key) || STOPWORDS.has(word.toLowerCase());
      });
      // A phrase left holding only "the" or "for" says nothing on its own.
      if (fresh.every((word) => STOPWORDS.has(word.toLowerCase()))) {
        removedIndexed.push(keyword);
        continue;
      }
      const rewritten = fresh.join(' ');
      const rewrittenKey = rewritten.toLowerCase();
      // A shortened phrase that now matches a keyword already kept is a repeat.
      if (rewrittenKey !== folded && seen.has(rewrittenKey)) {
        removedDuplicates.push(keyword);
        continue;
      }
      if (fresh.length < words.length) removedIndexed.push(words.filter((word) => !fresh.includes(word)).join(' '));
      seen.add(rewrittenKey);
      kept.push(rewritten);
      continue;
    }
    kept.push(keyword);
  }

  const keywords = kept.join(',');
  return {
    keywords,
    removedDuplicates,
    removedIndexed,
    saved: Math.max(0, fieldLength(listing.keywords) - fieldLength(keywords)),
  };
}

function issue(
  locale: string,
  field: ListingField | undefined,
  code: string,
  severity: ListingIssue['severity'],
  title: string,
  detail: string,
  fix?: ListingChange
): ListingIssue {
  return { id: `${locale}:${field ?? 'listing'}:${code}`, locale, field, severity, title, detail, fix };
}

function change(locale: ListingLocale, field: ListingField, after: string, reason: string): ListingChange {
  return { locale: locale.locale, field, before: locale[field], after, reason };
}

function checkLimits(locale: ListingLocale, out: ListingIssue[], appId = ''): void {
  const play = storeOf(appId) === 'playstore';
  for (const field of listingFieldsFor(play ? 'playstore' : 'appstore')) {
    const limit = listingLimit(play ? 'playstore' : 'appstore', field);
    const length = fieldLength(locale[field]);
    if (length > limit) {
      out.push(
        issue(
          locale.locale,
          field,
          'too-long',
          'problem',
          `${listingFieldLabel(play ? 'playstore' : 'appstore', field)} is ${length - limit} character${length - limit === 1 ? '' : 's'} too long`,
          `The limit is ${limit} characters. ${play ? 'Play Console' : 'App Store Connect'} will not accept longer text.`
        )
      );
    }
  }
}

/**
 * Words Google Play's metadata rules keep out of a title: ranks, prices and
 * promotions. Matched as whole words, in English only, where the rule is
 * clearest; "#1" is matched on its own. "New" and "top" are left out, since
 * they start brand names ("New York", "Top Eleven") as often as they sell.
 */
const PLAY_TITLE_WORDS = /(^|[^\p{L}\p{N}])(best|free|sale|discount|cheap)(?![\p{L}\p{N}])/iu;
const EMOJI = /\p{Extended_Pictographic}/u;

/** The checks that apply to a Google Play page: title, short description and full description. */
function checkPlayText(locale: ListingLocale, out: ListingIssue[]): void {
  const title = locale.name.trim();
  if (!title) {
    out.push(issue(locale.locale, 'name', 'empty', 'problem', 'The title is empty', 'Every language of your store page needs a title.'));
  } else {
    const word = PLAY_TITLE_WORDS.exec(title)?.[2];
    const flagged = word ? `"${word}"` : title.includes('#1') ? '"#1"' : EMOJI.test(title) ? 'an emoji' : null;
    if (flagged) {
      out.push(
        issue(
          locale.locale,
          'name',
          'play-title-rules',
          'warning',
          `Google Play may reject the title because of ${flagged}`,
          "Google Play's rules do not allow emoji, or words like best, #1 or free, in the title. Put words like best or free in the description instead."
        )
      );
    }
  }
  const short = locale.subtitle.trim();
  if (!short) {
    out.push(
      issue(
        locale.locale,
        'subtitle',
        'empty',
        'problem',
        'No short description',
        'The short description shows on your store page under the title. Every language needs one. Use up to 80 characters to make people want your app.'
      )
    );
  } else {
    const free = 80 - fieldLength(short);
    if (free >= 20) {
      out.push(issue(locale.locale, 'subtitle', 'room', 'tip', `${free} characters left in the short description`, 'Add a word or two about what your app does best.'));
    }
  }
  const description = locale.description.trim();
  if (!description) {
    out.push(issue(locale.locale, 'description', 'empty', 'problem', 'The full description is empty', 'Every language of your store page needs a full description.'));
  } else if (fieldLength(description) < 300) {
    out.push(
      issue(
        locale.locale,
        'description',
        'short',
        'warning',
        'The full description is short',
        'Google Play search reads the full description. Add a few lines on what your app does, in the words people search for.'
      )
    );
  }
}

function checkName(locale: ListingLocale, out: ListingIssue[]): void {
  if (!locale.name.trim()) {
    out.push(issue(locale.locale, 'name', 'empty', 'problem', 'The name is empty', 'Every language needs a name before you can submit your app for review.'));
  }
}

function checkSubtitle(locale: ListingLocale, out: ListingIssue[]): void {
  const subtitle = locale.subtitle.trim();
  if (!subtitle) {
    out.push(
      issue(
        locale.locale,
        'subtitle',
        'empty',
        'warning',
        'No subtitle',
        'The subtitle shows under the name in search results and helps people find your app. Use up to 30 characters to make people want your app.'
      )
    );
    return;
  }
  const nameWords = new Set(wordsOf(locale.name, locale.locale).map(stem));
  const repeated = wordsOf(subtitle, locale.locale).filter((word) => nameWords.has(stem(word)));
  if (repeated.length > 0) {
    out.push(
      issue(
        locale.locale,
        'subtitle',
        'repeats-name',
        'warning',
        `The subtitle repeats ${quoteList(unique(repeated))} from the name`,
        'The App Store already searches the name, so a repeated word wastes space. Use the subtitle for words the name does not have.'
      )
    );
  }
  const free = LISTING_LIMITS.subtitle - fieldLength(subtitle);
  if (free >= 10) {
    out.push(
      issue(
        locale.locale,
        'subtitle',
        'room',
        'tip',
        `${free} characters left in the subtitle`,
        'Add another word people search for.'
      )
    );
  }
}

function checkKeywords(locale: ListingLocale, out: ListingIssue[]): void {
  const keywords = locale.keywords;
  if (!keywords.trim()) {
    out.push(
      issue(
        locale.locale,
        'keywords',
        'empty',
        'problem',
        'No keywords',
        'Apart from the name, keywords are the main way people find your app in search. Add up to 100 characters of search words, separated by commas.'
      )
    );
    return;
  }

  const spaces = (keywords.match(/,\s+|\s+,/g) ?? []).reduce((sum, hit) => sum + hit.length - 1, 0);
  const cleanup = cleanKeywords(locale);

  if (spaces > 0) {
    const fixed = splitKeywords(keywords).join(',');
    out.push(
      issue(
        locale.locale,
        'keywords',
        'spaces',
        'warning',
        `Spaces after commas waste ${spaces} character${spaces === 1 ? '' : 's'}`,
        'The App Store splits keywords at the commas, so you do not need the spaces.',
        change(locale, 'keywords', fixed, 'Removed the spaces after commas')
      )
    );
  }
  if (cleanup.removedDuplicates.length > 0) {
    const repeated = unique(cleanup.removedDuplicates);
    out.push(
      issue(
        locale.locale,
        'keywords',
        'duplicates',
        'warning',
        `${quoteList(repeated)} ${repeated.length === 1 ? 'appears' : 'appear'} twice in the keywords`,
        'Adding a keyword twice does not help. The App Store counts each keyword only once.',
        change(locale, 'keywords', cleanup.keywords, 'Removed repeated keywords')
      )
    );
  }
  if (cleanup.removedIndexed.length > 0) {
    const indexed = unique(cleanup.removedIndexed);
    out.push(
      issue(
        locale.locale,
        'keywords',
        'indexed',
        'warning',
        `${quoteList(indexed)} ${indexed.length === 1 ? 'is' : 'are'} already in the name or subtitle`,
        'The App Store searches the name, subtitle and keywords together. Use the keywords for new words.',
        change(locale, 'keywords', cleanup.keywords, 'Removed words already in the name or subtitle')
      )
    );
  }

  if (!NO_SPACES.test(locale.locale)) {
    const stems = new Map<string, string[]>();
    for (const keyword of splitKeywords(keywords)) {
      for (const word of keyword.toLowerCase().split(/\s+/)) {
        const key = stem(word);
        if (!key || STOPWORDS.has(word)) continue;
        const list = stems.get(key) ?? [];
        if (!list.includes(word)) list.push(word);
        stems.set(key, list);
      }
    }
    const forms = Array.from(stems.values()).filter((list) => list.length > 1);
    if (forms.length > 0) {
      out.push(
        issue(
          locale.locale,
          'keywords',
          'plurals',
          'tip',
          `${forms.map((list) => list.join(' and ')).join(', ')} are the same in search`,
          'For most words, the App Store matches both the singular and the plural, so one form is enough.'
        )
      );
    }
  }

  const used = fieldLength(cleanup.keywords);
  const free = LISTING_LIMITS.keywords - used;
  if (free >= 10) {
    out.push(
      issue(
        locale.locale,
        'keywords',
        'room',
        'tip',
        `${free} characters left in the keywords${cleanup.saved > 0 ? ' after the fixes above' : ''}`,
        'Add more words people search for.'
      )
    );
  }
}

function checkCopy(locale: ListingLocale, out: ListingIssue[], editable: boolean): void {
  const description = locale.description.trim();
  if (!description) {
    out.push(issue(locale.locale, 'description', 'empty', 'problem', 'The description is empty', 'Every language needs a description before you can submit your app for review.'));
  } else if (fieldLength(description) < 300) {
    out.push(
      issue(
        locale.locale,
        'description',
        'short',
        'warning',
        'The description is short',
        'People who open the full description are deciding whether to get your app. Add a few lines on what your app does and why people should choose your app.'
      )
    );
  }
  const firstLine = description.split(/\n/)[0] ?? '';
  if (fieldLength(firstLine) > 170) {
    out.push(
      issue(
        locale.locale,
        'description',
        'long-opening',
        'tip',
        'The first line is cut off on the store page',
        'Only the first lines show before "more", and few people tap "more". Start with a short sentence to make people want your app.'
      )
    );
  }
  if (!locale.promotionalText.trim()) {
    out.push(
      issue(
        locale.locale,
        'promotionalText',
        'empty',
        'tip',
        'No promotional text',
        'Promotional text shows above the description, and you can change the text without a new version. Write about a launch, a sale or a holiday.'
      )
    );
  }
  if (editable) {
    const notes = locale.whatsNew.trim();
    if (notes && GENERIC_NOTES.test(notes)) {
      out.push(
        issue(
          locale.locale,
          'whatsNew',
          'generic',
          'tip',
          "What's new says nothing specific",
          'People read "What\'s new" to decide if the update is worth getting. Name one change people will notice.'
        )
      );
    }
  }
}

function checkTranslation(locale: ListingLocale, primary: ListingLocale, out: ListingIssue[], appId = ''): void {
  const copied = (['name', 'subtitle', 'description'] as ListingField[]).filter((field) => {
    const value = locale[field].trim();
    return value.length > 12 && value === primary[field].trim();
  });
  if (copied.length > 0 && !sameLanguage(locale.locale, primary.locale)) {
    out.push(
      issue(
        locale.locale,
        copied[0],
        'untranslated',
        'warning',
        `The ${listingLanguageName(locale.locale)} store page uses the ${listingLanguageName(primary.locale)} ${andList(
          copied.map((field) => (appId ? listingFieldLabel(appId, field) : LISTING_FIELD_LABELS[field]).toLowerCase())
        )}`,
        `People who read ${listingLanguageName(locale.locale)} may not understand the ${listingLanguageName(primary.locale)} text. Searches in ${listingLanguageName(locale.locale)} will not match the ${listingLanguageName(primary.locale)} words.`
      )
    );
  }
}

function checkScreenshots(locale: ListingLocale, primary: ListingLocale, out: ListingIssue[], appId = ''): void {
  if (!locale.screenshotCounts || !primary.screenshotCounts) return;
  const play = storeOf(appId) === 'playstore';
  const own = Object.values(locale.screenshotCounts).reduce((sum, count) => sum + count, 0);
  const primaryCount = Object.values(primary.screenshotCounts).reduce((sum, count) => sum + count, 0);
  if (locale.locale !== primary.locale && own === 0 && primaryCount > 0 && !sameLanguage(locale.locale, primary.locale)) {
    out.push(
      issue(
        locale.locale,
        undefined,
        'screenshots-borrowed',
        'warning',
        `Your ${listingLanguageName(locale.locale)} store page shows the ${listingLanguageName(primary.locale)} screenshots`,
        `Screenshots in people's own language get more downloads. The editor can translate your screenshots into ${listingLanguageName(locale.locale)}.`
      )
    );
    return;
  }
  const largest = Math.max(0, ...Object.values(locale.screenshotCounts));
  if (own > 0 && largest < (play ? 4 : 3)) {
    out.push(
      issue(
        locale.locale,
        undefined,
        'few-screenshots',
        'tip',
        `Only ${largest} screenshot${largest === 1 ? '' : 's'} in ${listingLanguageName(locale.locale)}`,
        play
          ? 'Google Play shows up to 8 phone screenshots. Add at least 4 to show people more of your app.'
          : 'Search results show the first three screenshots, and the store page shows up to ten. Add at least three screenshots to give people a reason to tap.'
      )
    );
  }
}

function sameLanguage(a: string, b: string): boolean {
  return a.split('-')[0].toLowerCase() === b.split('-')[0].toLowerCase() && !a.startsWith('zh');
}

function andList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function unique(list: string[]): string[] {
  return Array.from(new Set(list.map((item) => item.trim()).filter(Boolean)));
}

function quoteList(items: string[]): string {
  const quoted = items.slice(0, 3).map((item) => `"${item}"`);
  const more = items.length > 3 ? ` and ${items.length - 3} more` : '';
  if (quoted.length <= 1) return `${quoted[0] ?? ''}${more}`;
  return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}${more}`;
}

const SEVERITY_ORDER: Record<ListingIssue['severity'], number> = { problem: 0, warning: 1, tip: 2 };

/** Every check on every language of the listing, problems first. */
export function checkListing(listing: ListingSnapshot): ListingIssue[] {
  const out: ListingIssue[] = [];
  const primary = listing.locales.find((locale) => locale.locale === listing.primaryLocale) ?? listing.locales[0];
  const play = storeOf(listing.appId) === 'playstore';
  for (const locale of listing.locales) {
    checkLimits(locale, out, listing.appId);
    if (play) {
      checkPlayText(locale, out);
    } else {
      checkName(locale, out);
      checkSubtitle(locale, out);
      checkKeywords(locale, out);
      checkCopy(locale, out, listing.editable);
    }
    if (primary && locale !== primary) {
      checkTranslation(locale, primary, out, listing.appId);
      checkScreenshots(locale, primary, out, listing.appId);
    } else if (primary) {
      checkScreenshots(locale, primary, out, listing.appId);
    }
  }
  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/** A listing score out of 100, for the overview: problems cost the most, tips the least. */
export function listingScore(issues: ListingIssue[], localeCount: number): number {
  const cost = issues.reduce(
    (sum, entry) => sum + (entry.severity === 'problem' ? 12 : entry.severity === 'warning' ? 5 : 1.5),
    0
  );
  const perLocale = cost / Math.max(1, Math.sqrt(localeCount));
  return Math.max(0, Math.min(100, Math.round(100 - perLocale)));
}

/**
 * Fold several proposed changes to the same field into one: the last one
 * wins, but its `before` stays the value the listing has now, so the diff the
 * user approves shows the whole edit.
 */
export function collapseChanges(changes: ListingChange[]): ListingChange[] {
  const byKey = new Map<string, ListingChange>();
  for (const entry of changes) {
    const key = `${entry.locale}:${entry.field}`;
    const earlier = byKey.get(key);
    byKey.set(key, earlier ? { ...entry, before: earlier.before } : entry);
  }
  return Array.from(byKey.values()).filter((entry) => entry.after !== entry.before);
}

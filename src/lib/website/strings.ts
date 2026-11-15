// The site's text by where it comes from, and the lookup that gives each piece
// of it in a language. Kept apart from translate.ts so the pages (render.ts)
// can be drawn without the translation engines.
//
// Two kinds of text, with two sources: what the developer or the AI wrote
// (`content`, in the language `draft.content.lang` says), and the fixed words
// and the privacy policy, which are English (`template`). A translation is
// stored under the fingerprint of the text it translates, so an edited
// sentence shows in the base language until it is translated again, and never
// in a translation of what it used to say.

import { hash32 } from '@/lib/i18n/hash';
import { chromeStrings } from './content';
import { buildPolicy, paragraphs, policyStrings } from './privacy';
import type { SiteDraft } from './types';

/** Translations by language, then by the fingerprint of the source text. */
export type TranslationBook = Record<string, Record<string, string>>;

/** English and English need nothing done; every other pair does, pt-BR and pt-PT too. */
export function sameLanguage(a: string, b: string): boolean {
  if (a === b) return true;
  return a.startsWith('en') && b.startsWith('en');
}

function unique(texts: string[]): string[] {
  return [...new Set(texts.map((text) => text.trim()).filter(Boolean))];
}

/** Every piece of text the site shows, by where it comes from. */
export function siteTexts(draft: SiteDraft): { content: string[]; template: string[] } {
  const content = draft.content;
  const written = [
    content.headline,
    content.subhead,
    ...content.features.flatMap((feature) => [feature.title, feature.body]),
    content.galleryTitle,
    content.ctaTitle,
    content.ctaBody,
    ...paragraphs(content.supportIntro),
    content.contactNote,
    ...content.faqs.flatMap((faq) => [faq.question, ...paragraphs(faq.answer)]),
    ...paragraphs(content.privacyExtra),
    content.description,
    draft.facts.tagline,
  ];
  const extra = new Set(paragraphs(content.privacyExtra));
  const policy = policyStrings(buildPolicy({ facts: draft.facts, privacy: draft.privacy, extra: content.privacyExtra })).filter((text) => !extra.has(text));
  return { content: unique(written), template: unique([...Object.values(chromeStrings(draft.facts)), ...policy]) };
}

/** A function that gives `text` in `locale`: its translation, or the text itself while it has none. */
export function translator(draft: SiteDraft, locale: string, known: TranslationBook = {}): (text: string, template?: boolean) => string {
  const stored = draft.translations[locale] ?? {};
  const fromProject = known[locale] ?? {};
  return (text: string, template = false) => {
    const source = template ? 'en-US' : draft.content.lang;
    if (!text || sameLanguage(source, locale)) return text;
    const key = hash32(text.trim());
    return stored[key] ?? fromProject[key] ?? text;
  };
}

/** The text one language still lacks, as source strings with their source language. */
export function missingFor(draft: SiteDraft, locale: string, known: TranslationBook = {}): { content: string[]; template: string[] } {
  const texts = siteTexts(draft);
  const stored = draft.translations[locale] ?? {};
  const fromProject = known[locale] ?? {};
  const has = (text: string) => !!stored[hash32(text)] || !!fromProject[hash32(text)];
  return {
    content: sameLanguage(draft.content.lang, locale) ? [] : texts.content.filter((text) => !has(text)),
    template: sameLanguage('en-US', locale) ? [] : texts.template.filter((text) => !has(text)),
  };
}

/** How many pieces of text each language still lacks. */
export function missingCounts(draft: SiteDraft, known: TranslationBook = {}): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const locale of draft.languages) {
    const missing = missingFor(draft, locale, known);
    counts[locale] = missing.content.length + missing.template.length;
  }
  return counts;
}

/** The translations still used, so an edited site does not carry old ones forever. */
export function prunedTranslations(draft: SiteDraft): TranslationBook {
  const texts = siteTexts(draft);
  const keys = new Set([...texts.content, ...texts.template].map((text) => hash32(text)));
  const out: TranslationBook = {};
  for (const locale of draft.languages) {
    const entries = Object.entries(draft.translations[locale] ?? {}).filter(([key]) => keys.has(key));
    if (entries.length > 0) out[locale] = Object.fromEntries(entries);
  }
  return out;
}

const KEEP = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\bhttps?:\/\/[^\s)]+/gi;

/** A translation that dropped an email or web address of its source is turned down: the address matters more than the wording. */
export function keepsAddresses(source: string, translation: string): boolean {
  return (source.match(KEEP) ?? []).every((address) => translation.includes(address));
}

/**
 * A fingerprint of everything that decides what the site's files say, to tell
 * whether the site changed since it was published. The order translations
 * were added in does not count.
 */
export function siteFingerprint(draft: SiteDraft): string {
  const translations = Object.keys(draft.translations)
    .sort()
    .map((locale) => [locale, Object.entries(draft.translations[locale]).sort(([a], [b]) => a.localeCompare(b))]);
  // The ids of features and questions say nothing about the pages.
  const content = {
    ...draft.content,
    features: draft.content.features.map(({ title, body, shot }) => [title, body, shot]),
    faqs: draft.content.faqs.map(({ question, answer }) => [question, answer]),
  };
  return hash32(JSON.stringify([draft.facts, draft.theme, content, draft.privacy, draft.baseLocale, draft.languages, draft.options, translations]));
}

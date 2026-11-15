// The site in every language. The text goes through the same translation as
// the artboards (resolveEngines and runTranslation in src/lib/i18n): the
// Claude Code or Codex the user is signed in to, the AI panel's provider, or
// for a user with none of those, the app's own translator.
//
// The project has translated some of the text already: the captions on its
// screenshots. A feature or headline that is a screenshot's caption takes the
// project's own words in each language (`projectTranslations`), before any AI.

import { hash32 } from '@/lib/i18n/hash';
import { getProjectLocales, getBaseLocale } from '@/lib/i18n/localization';
import { getLocaleDef } from '@/lib/i18n/locales';
import { projectArtboards } from '@/lib/i18n/project';
import { resolveEngines, type ChunkLanguage, type TranslateEngine } from '@/lib/i18n/engines';
import { runTranslation, type TranslationJob } from '@/lib/i18n/translateRun';
import type { ArtboardState } from '@/types/artboard';
import { captionOf, siteBoards } from './content';
import { keepsAddresses, missingFor, type TranslationBook } from './strings';
import type { SiteDraft } from './types';

export type { TranslationBook } from './strings';

/**
 * The captions of the project's screenshots in each of its languages, keyed
 * by the fingerprint of the base language's caption, for every language of
 * the site the project has.
 */
export function projectTranslations(artboards: ArtboardState[], languages: string[]): TranslationBook {
  const base = getBaseLocale(artboards);
  const own = new Set(getProjectLocales(artboards).map((entry) => entry.code));
  const baseCaptions = siteBoards(artboards).map(captionOf);
  const book: TranslationBook = {};
  for (const locale of languages) {
    if (locale === base || !own.has(locale)) continue;
    const boards = siteBoards(projectArtboards(artboards, locale));
    const entries: Record<string, string> = {};
    boards.forEach((board, index) => {
      const source = baseCaptions[index];
      if (!source) return;
      const caption = captionOf(board);
      if (source.title && caption.title && caption.title !== source.title) entries[hash32(source.title)] = caption.title;
      if (source.body && caption.body && caption.body !== source.body) entries[hash32(source.body)] = caption.body;
    });
    if (Object.keys(entries).length > 0) book[locale] = entries;
  }
  return book;
}

function chunkLanguage(code: string): ChunkLanguage {
  const def = getLocaleDef(code);
  return { model: def ? `${def.name} (${def.nativeName}, ${def.code})` : code, machine: def?.translateCode };
}

const GUIDANCE = [
  "These are the texts of a mobile app's website: its home page, its support page and its privacy policy.",
  'Keep app names, company names, service names (such as Firebase or AdMob), email addresses and web addresses exactly as they are.',
  'Translate the privacy policy faithfully: keep every promise and every limit as written, and add or leave out nothing.',
  'Write as a native speaker would, in the same friendly, plain tone.',
].join(' ');

export interface SiteTranslationResult {
  translations: TranslationBook;
  /** Languages with text still missing after the run. */
  incomplete: string[];
  engine?: TranslateEngine;
  error?: string;
}

/**
 * Translate what each language lacks. Resolves with the draft's translations
 * plus every new one, also when some came back and some did not.
 */
export async function translateSite(
  draft: SiteDraft,
  options: {
    locales?: string[];
    known?: TranslationBook;
    signal?: AbortSignal;
    onProgress?: (done: number, total: number, engine: TranslateEngine) => void;
  } = {}
): Promise<SiteTranslationResult> {
  const known = options.known ?? {};
  const locales = (options.locales ?? draft.languages).filter((locale) => draft.languages.includes(locale));
  const jobs: TranslationJob[] = [];
  for (const locale of locales) {
    const missing = missingFor(draft, locale, known);
    const target = chunkLanguage(locale);
    if (missing.content.length > 0) {
      // No source language: the developer's text can mix the English a site
      // starts with and their own language, so each engine works it out.
      jobs.push({ key: `${locale}|content`, items: missing.content.map((text) => ({ id: hash32(text), text })), target });
    }
    if (missing.template.length > 0) {
      jobs.push({ key: `${locale}|template`, items: missing.template.map((text) => ({ id: hash32(text), text })), target, source: chunkLanguage('en-US') });
    }
  }
  const translations: TranslationBook = Object.fromEntries(Object.entries(draft.translations).map(([locale, entries]) => [locale, { ...entries }]));
  if (jobs.length === 0) return { translations, incomplete: [] };

  const engines = await resolveEngines();
  if (engines.length === 0) {
    return { translations, incomplete: locales.filter((locale) => jobs.some((job) => job.key.startsWith(`${locale}|`))), error: 'Set up an AI to translate the site' };
  }
  const outcomes = await runTranslation(jobs, {
    engines,
    guidance: GUIDANCE,
    signal: options.signal,
    onProgress: (progress) => options.onProgress?.(progress.done, progress.total, progress.engine),
  });

  let engine: TranslateEngine | undefined;
  let error: string | undefined;
  const incomplete = new Set<string>();
  outcomes.forEach((outcome, index) => {
    const job = jobs[index];
    const locale = job.key.split('|')[0];
    const book = (translations[locale] ??= {});
    for (const item of job.items) {
      const value = outcome.translations.get(item.id)?.trim();
      if (value && keepsAddresses(item.text, value)) book[item.id] = value;
      else incomplete.add(locale);
    }
    engine ??= outcome.engine;
    error ??= outcome.error;
  });
  return { translations, incomplete: [...incomplete], engine, error };
}

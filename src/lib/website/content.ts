// The words of the site: what the screenshots say, the text a site starts
// with before any AI has written, the fixed words of the pages (menus,
// buttons, headings) and the check every change from the AI goes through.
//
// A site starts complete without an AI. The headline and the features come
// from the screenshots' own captions, which the developer already wrote for
// the store, and the support page from plain sentences picked by the privacy
// answers. The AI rewrites that when one is set up; without one the site is
// still one the developer can publish.

import { suggestedAppName } from '@/lib/creative/layouts';
import { projectBoards } from '@/lib/growth/projectShots';
import { DEFAULT_BASE_LOCALE } from '@/lib/i18n/locales';
import type { ArtboardState, TextElementProps } from '@/types/artboard';
import { cleanPrivacy, defaultPrivacy, isDataUse } from './privacy';
import type { PrivacyAnswers, SiteContent, SiteDraft, SiteFacts, SiteFaq, SiteFeature, SiteTheme } from './types';

/** How many features the home page shows. */
export const MAX_FEATURES = 6;
export const MAX_FAQS = 12;

/** The longest each field may be, in characters. Anything longer from the AI is turned down. */
export const LIMITS = {
  headline: 90,
  subhead: 240,
  featureTitle: 80,
  featureBody: 320,
  galleryTitle: 60,
  ctaTitle: 80,
  ctaBody: 200,
  supportIntro: 400,
  contactNote: 240,
  question: 160,
  answer: 900,
  privacyExtra: 2000,
  description: 200,
  tagline: 140,
  appName: 60,
  developer: 100,
  location: 100,
} as const;

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// --- the screenshots -----------------------------------------------------------------

/**
 * The artboards the site shows: the phone screenshots, in the project's order,
 * or the tablet ones when the project has no phone ones. Blank artboards and
 * App Store header art are left out.
 */
export function siteBoards(artboards: ArtboardState[]): ArtboardState[] {
  const phones = projectBoards(artboards, 'iphone').boards;
  return phones.length > 0 ? phones : projectBoards(artboards, 'ipad').boards;
}

export interface Caption {
  title: string;
  body: string;
}

function textOf(element: TextElementProps): string {
  return (element.content ?? '').replace(/\s+/g, ' ').trim();
}

/** Top to bottom, then left to right, the way the caption is read. */
function readingOrder(a: TextElementProps, b: TextElementProps): number {
  return Math.abs(a.position.y - b.position.y) > 8 ? a.position.y - b.position.y : a.position.x - b.position.x;
}

/** A badge such as "SMART FINANCE": a few words in capitals only. */
function isLabel(text: string): boolean {
  return !/\p{Ll}/u.test(text) && text.split(/\s+/).length <= 4;
}

/**
 * What a screenshot says: its headline and the line under it. A headline is
 * often set as two or three layers of the same size ("A finance app you'll" in
 * one, "actually use" in the next), so every layer near the biggest size is
 * part of it, read top to bottom. Text without a letter in it (a "100,000+"
 * badge, a row of stars) is decoration and left out. The line under it is
 * the next size down, leaving out badges in capitals and the small print of a
 * pretend app screen drawn on the artboard ("Grocery store", "Wine").
 */
export function captionOf(board: ArtboardState): Caption {
  const texts = board.elements
    .filter((element): element is TextElementProps => element.type === 'text' && /\p{L}/u.test(textOf(element as TextElementProps)))
    .sort((a, b) => b.fontSize - a.fontSize);
  if (texts.length === 0) return { title: '', body: '' };
  const biggest = texts[0].fontSize;
  const title = texts.filter((text) => text.fontSize >= biggest * 0.8).sort(readingOrder).slice(0, 3);
  // The line under a headline sits next to it. Across the 101 templates the
  // real ones are within a tenth of the artboard's height of the headline,
  // and nearly every text further off is the app's screen drawn on the
  // artboard, a quote or a press badge.
  const near = board.size.height * 0.12;
  const top = Math.min(...title.map((text) => text.position.y));
  const bottom = Math.max(...title.map((text) => text.position.y + text.size.height));
  const rest = texts.filter(
    (text) =>
      text.fontSize < biggest * 0.8 &&
      text.fontSize >= biggest * 0.3 &&
      !isLabel(textOf(text)) &&
      text.position.y + text.size.height >= top - near &&
      text.position.y <= bottom + near
  );
  const body = rest.length ? rest.filter((text) => text.fontSize >= rest[0].fontSize * 0.9).sort(readingOrder).slice(0, 2) : [];
  return { title: title.map(textOf).join(' '), body: body.map(textOf).join(' ') };
}

// --- a new site ----------------------------------------------------------------------

export function emptyFacts(): SiteFacts {
  return { appName: '', tagline: '', developer: '', supportEmail: '', appStoreUrl: '', playStoreUrl: '', location: '', icon: '' };
}

export function factsFromProject(projectName: string): SiteFacts {
  return { ...emptyFacts(), appName: suggestedAppName(projectName) };
}

function storesLine(facts: SiteFacts): string {
  const apple = !!facts.appStoreUrl.trim();
  const google = !!facts.playStoreUrl.trim();
  if (apple && google) return 'On the App Store and Google Play.';
  if (apple) return 'On the App Store.';
  if (google) return 'On Google Play.';
  return '';
}

/** Support questions that fit what the app does, in English, with the facts filled in. */
export function defaultFaqs(facts: SiteFacts, privacy: PrivacyAnswers): SiteFaq[] {
  const app = facts.appName.trim() || 'the app';
  const email = facts.supportEmail.trim();
  const writeTo = email ? `email us at ${email}` : 'email us';
  const faqs: Array<Omit<SiteFaq, 'id'>> = [];
  if (privacy.uses.includes('purchases')) {
    faqs.push({
      question: "I bought something. Why can't I see it?",
      answer: `Purchases belong to the Apple ID or Google account you used to buy them. Make sure you're signed in to that account on this device. If it's still missing, ${writeTo}.`,
    });
    faqs.push({
      question: 'How do I cancel a subscription?',
      answer: 'Apple and Google manage subscriptions. On an iPhone, open Settings, tap your name, then Subscriptions. On Android, open Google Play, tap your profile picture, then Payments and subscriptions.',
    });
  }
  if (privacy.uses.includes('account')) {
    faqs.push({
      question: 'How do I delete my account?',
      answer: `${email ? `Email us at ${email}` : 'Email us'} from the address you signed up with, and we'll delete your account and the data that goes with it.`,
    });
  }
  faqs.push(
    privacy.uses.length === 0
      ? { question: `Does ${app} collect my data?`, answer: `No. ${app} doesn't collect any personal data. The privacy policy explains it in full.` }
      : { question: `What data does ${app} collect?`, answer: 'Only what the app needs to work. The privacy policy lists all of it.' }
  );
  faqs.push({
    question: 'I found a bug. What should I do?',
    answer: `Please ${writeTo}. Tell us what you did, what happened and which device you use. A screenshot helps a lot.`,
  });
  return faqs.map((faq) => ({ ...faq, id: newId('q') }));
}

export function defaultContent(input: { facts: SiteFacts; captions: Caption[]; privacy: PrivacyAnswers; baseLocale: string }): SiteContent {
  const app = input.facts.appName.trim() || 'Our app';
  const first = input.captions.find((caption) => caption.title);
  const features: SiteFeature[] = input.captions
    .map((caption, index) => ({ caption, index }))
    .filter(({ caption }) => caption.title)
    .slice(0, 4)
    .map(({ caption, index }) => ({ id: newId('f'), title: caption.title, body: caption.body, shot: index }));
  return {
    // The sentences below are English, so a site in another language
    // translates them into its own language as well, captions included.
    lang: input.baseLocale.startsWith('en') ? input.baseLocale : DEFAULT_BASE_LOCALE,
    headline: first?.title || input.facts.tagline.trim() || app,
    subhead: input.facts.tagline.trim() && first?.title ? input.facts.tagline.trim() : first?.body || '',
    features,
    galleryTitle: 'A closer look',
    ctaTitle: `Get ${app}`,
    ctaBody: storesLine(input.facts),
    supportIntro: `Have a question about ${app}, or is something not working? We're here to help.`,
    contactNote: "Tell us which device you use and what happened, and we'll get back to you.",
    faqs: defaultFaqs(input.facts, input.privacy),
    privacyExtra: '',
    description: input.facts.tagline.trim() || first?.title || app,
  };
}

export function newDraft(input: {
  projectId: string;
  facts: SiteFacts;
  theme: SiteTheme;
  captions: Caption[];
  baseLocale: string;
  languages: string[];
  privacy?: PrivacyAnswers;
  now?: number;
}): SiteDraft {
  const now = input.now ?? Date.now();
  const privacy = input.privacy ?? defaultPrivacy(new Date(now));
  const languages = [input.baseLocale, ...input.languages.filter((code) => code !== input.baseLocale)];
  return {
    version: 1,
    projectId: input.projectId,
    createdAt: now,
    updatedAt: now,
    facts: input.facts,
    theme: input.theme,
    content: defaultContent({ facts: input.facts, captions: input.captions, privacy, baseLocale: input.baseLocale }),
    privacy,
    baseLocale: input.baseLocale,
    languages,
    translations: {},
    options: { credit: true, screenshots: true },
  };
}

// --- the fixed words of the pages ------------------------------------------------------

/**
 * The words every page has around the developer's text, in English with the
 * app's name filled in. Translated with the rest; see translate.ts.
 */
export function chromeStrings(facts: SiteFacts) {
  const app = facts.appName.trim() || 'This app';
  return {
    home: 'Home',
    support: 'Support',
    privacy: 'Privacy policy',
    skip: 'Skip to content',
    language: 'Language',
    menu: 'Pages',
    appStore: 'Download on the App Store',
    googlePlay: 'Get it on Google Play',
    supportTitle: `${app} support`,
    contact: 'Contact us',
    emailUs: 'Email us',
    faq: 'Questions people ask',
    privacyFor: `How ${app} handles your data`,
    updated: 'Last updated',
    contents: 'On this page',
    notFound: "This page isn't here",
    notFoundBody: 'The address may be wrong, or the page has moved.',
    backHome: 'Go to the home page',
    madeWith: 'Made with',
    screenshot: `${app} screenshot`,
  };
}

export type ChromeStrings = ReturnType<typeof chromeStrings>;

// --- checking what the AI sends --------------------------------------------------------

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_PATTERN = /\bhttps?:\/\/[^\s)]+/gi;

/** Text as one clean line or paragraph: no Markdown marks, no spaced dashes, single spaces. */
export function cleanText(value: string, multiline = false): string {
  let text = value
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\s+[–—]\s+/g, ', ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
  text = multiline
    ? text
        .split(/\n\s*\n/)
        .map((part) => part.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join('\n\n')
    : text.replace(/\s+/g, ' ');
  return text.trim();
}

/**
 * Whether the AI's text may go on the site: within its limit, and naming no
 * email address but the support one and no web address but the store links.
 * A model asked for a support page can make up a support@ address, and a
 * wrong address on a support page is worse than none.
 */
export function acceptableText(text: string, limit: number, facts: SiteFacts): boolean {
  if (Array.from(text).length > limit) return false;
  const allowedEmail = facts.supportEmail.trim().toLowerCase();
  for (const match of text.match(EMAIL) ?? []) {
    if (match.toLowerCase() !== allowedEmail) return false;
  }
  const allowedUrls = [facts.appStoreUrl, facts.playStoreUrl].map((url) => url.trim()).filter(Boolean);
  for (const match of text.match(URL_PATTERN) ?? []) {
    if (!allowedUrls.some((url) => match.startsWith(url))) return false;
  }
  return true;
}

function stringOf(value: unknown, limit: number, facts: SiteFacts, multiline = false): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = cleanText(value, multiline);
  if (!acceptableText(text, limit, facts)) return undefined;
  return text;
}

export interface ChangeReport {
  /** The draft with the changes in it. */
  draft: SiteDraft;
  /** The fields that changed, in plain words, for the chat. */
  changed: string[];
  /** Fields the AI sent that were turned down. */
  refused: string[];
}

const FIELD_WORDS: Record<string, string> = {
  headline: 'headline',
  subhead: 'line under the headline',
  features: 'features',
  galleryTitle: 'screenshots heading',
  ctaTitle: 'closing heading',
  ctaBody: 'closing line',
  supportIntro: 'support page opening',
  contactNote: 'contact note',
  faqs: 'questions and answers',
  privacyExtra: 'privacy policy note',
  description: 'search description',
  tagline: 'one line about the app',
  appName: 'app name',
  developer: 'developer name',
  supportEmail: 'support email',
  location: 'location',
  colors: 'colours',
  privacy: 'privacy answers',
};

const HEX = /^#[0-9a-f]{6}$/i;
const EMAIL_ONLY = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

/**
 * Put the AI's changes into the draft, field by field. Each field is checked
 * on its own, so one too long or naming a made up address leaves that field
 * as it was and the rest still lands. `shots` is how many screenshots the site
 * has, so a feature cannot point at one that is not there.
 */
export function applyChanges(draft: SiteDraft, raw: unknown, shots: number): ChangeReport {
  const changes = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const changed: string[] = [];
  const refused: string[] = [];
  let facts = { ...draft.facts };
  const content: SiteContent = { ...draft.content };
  let theme = { ...draft.theme };
  let privacy = draft.privacy;
  const note = (key: string, ok: boolean) => (ok ? changed : refused).push(FIELD_WORDS[key] ?? key);

  // Facts first, so a new support email is the one the text is checked against.
  if ('supportEmail' in changes) {
    const email = typeof changes.supportEmail === 'string' ? changes.supportEmail.trim() : '';
    if (EMAIL_ONLY.test(email)) {
      if (email !== facts.supportEmail) {
        facts.supportEmail = email;
        note('supportEmail', true);
      }
    } else note('supportEmail', false);
  }
  for (const key of ['appName', 'tagline', 'developer', 'location'] as const) {
    if (!(key in changes)) continue;
    const value = stringOf(changes[key], LIMITS[key], facts);
    if (value === undefined || (key === 'appName' && !value)) note(key, false);
    else if (value !== facts[key]) {
      facts = { ...facts, [key]: value };
      note(key, true);
    }
  }

  const single = ['headline', 'subhead', 'galleryTitle', 'ctaTitle', 'ctaBody', 'supportIntro', 'contactNote', 'description'] as const;
  for (const key of single) {
    if (!(key in changes)) continue;
    const value = stringOf(changes[key], LIMITS[key], facts, key === 'supportIntro');
    if (value === undefined || (key === 'headline' && !value)) note(key, false);
    else if (value !== content[key]) {
      content[key] = value;
      note(key, true);
    }
  }
  if ('privacyExtra' in changes) {
    const value = stringOf(changes.privacyExtra, LIMITS.privacyExtra, facts, true);
    if (value === undefined) note('privacyExtra', false);
    else if (value !== content.privacyExtra) {
      content.privacyExtra = value;
      note('privacyExtra', true);
    }
  }

  if ('features' in changes) {
    const list = Array.isArray(changes.features) ? changes.features : null;
    const features: SiteFeature[] = [];
    for (const item of list ?? []) {
      const entry = item as { title?: unknown; body?: unknown; shot?: unknown };
      const title = stringOf(entry.title, LIMITS.featureTitle, facts);
      const body = stringOf(entry.body ?? '', LIMITS.featureBody, facts);
      if (!title || body === undefined) continue;
      // The AI counts screenshots from 1, as the prompt lists them.
      const number = typeof entry.shot === 'number' ? Math.round(entry.shot) : Number(entry.shot);
      const shot = Number.isFinite(number) && number >= 1 && number <= shots ? number - 1 : -1;
      features.push({ id: newId('f'), title, body, shot });
      if (features.length >= MAX_FEATURES) break;
    }
    if (!list || (list.length > 0 && features.length === 0)) note('features', false);
    else {
      content.features = features;
      note('features', true);
    }
  }

  if ('faqs' in changes) {
    const list = Array.isArray(changes.faqs) ? changes.faqs : null;
    const faqs: SiteFaq[] = [];
    for (const item of list ?? []) {
      const entry = item as { question?: unknown; answer?: unknown };
      const question = stringOf(entry.question, LIMITS.question, facts);
      const answer = stringOf(entry.answer, LIMITS.answer, facts, true);
      if (!question || !answer) continue;
      faqs.push({ id: newId('q'), question, answer });
      if (faqs.length >= MAX_FAQS) break;
    }
    if (!list || (list.length > 0 && faqs.length === 0)) note('faqs', false);
    else {
      content.faqs = faqs;
      note('faqs', true);
    }
  }

  if ('colors' in changes && changes.colors && typeof changes.colors === 'object') {
    const colors = changes.colors as Record<string, unknown>;
    const next = { ...theme };
    let ok = true;
    for (const key of ['brand', 'brand2', 'accent'] as const) {
      if (!(key in colors)) continue;
      const value = typeof colors[key] === 'string' ? (colors[key] as string).trim() : '';
      if (HEX.test(value)) next[key] = value.toLowerCase();
      else ok = false;
    }
    if (ok && (next.brand !== theme.brand || next.brand2 !== theme.brand2 || next.accent !== theme.accent)) {
      theme = { ...next, source: 'custom' };
      note('colors', true);
    } else if (!ok) note('colors', false);
  }

  if ('privacy' in changes && changes.privacy && typeof changes.privacy === 'object') {
    const answer = changes.privacy as Record<string, unknown>;
    const next: PrivacyAnswers = { ...privacy, services: { ...privacy.services } };
    let ok = true;
    if ('uses' in answer) {
      if (Array.isArray(answer.uses) && answer.uses.every(isDataUse)) next.uses = answer.uses as PrivacyAnswers['uses'];
      else ok = false;
    }
    if ('services' in answer && answer.services && typeof answer.services === 'object') {
      for (const [use, value] of Object.entries(answer.services as Record<string, unknown>)) {
        if (!isDataUse(use) || typeof value !== 'string' || Array.from(value).length > 200) ok = false;
        else next.services[use] = cleanText(value);
      }
    }
    if ('personalizedAds' in answer) next.personalizedAds = answer.personalizedAds === true;
    if ('children' in answer) next.children = answer.children === true;
    if (ok) {
      const cleaned = cleanPrivacy({ ...next, answered: true });
      if (JSON.stringify(cleaned) !== JSON.stringify(privacy)) {
        privacy = cleaned;
        note('privacy', true);
      }
    } else note('privacy', false);
  }

  return { draft: { ...draft, facts, content, theme, privacy }, changed, refused };
}

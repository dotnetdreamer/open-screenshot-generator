// The website the Website view makes for the user's app: a home page, a
// support page and a privacy policy, in every language the site has, published
// to the developer's own GitHub Pages. Apple and Google both ask every app for
// a support address and a privacy policy address; these pages are those.
//
// A site belongs to a project, because its screenshots, colours and languages
// come from that project. What is stored (store.ts) is everything below; the
// screenshots are not stored, they are taken from the project again whenever
// the site is shown or published, so the site never shows an old design.
//
// Not to be confused with the folder `website/` at the top of this repository,
// which is Open Screenshot Generator's own site.

export type SitePage = 'home' | 'support' | 'privacy';

export const SITE_PAGES: SitePage[] = ['home', 'support', 'privacy'];

/** What the site says about the app and the people who make it. */
export interface SiteFacts {
  appName: string;
  /** One line about the app, under its name. */
  tagline: string;
  /** The person or company behind the app, as the privacy policy names them. */
  developer: string;
  supportEmail: string;
  /** https://apps.apple.com/app/id..., or empty. */
  appStoreUrl: string;
  /** https://play.google.com/store/apps/details?id=..., or empty. */
  playStoreUrl: string;
  /** Where the developer is based, for the privacy policy's contact line. May be empty. */
  location: string;
  /** The app icon as a PNG data URL of at most 512 pixels, or empty. */
  icon: string;
}

export interface SiteTheme {
  /** Where the colours came from. Anything but `custom` follows its source when that changes. */
  source: 'screenshots' | 'icon' | 'custom' | 'default';
  /** The main colour, and the one the hero's gradient runs to. */
  brand: string;
  brand2: string;
  /** Links and highlights. */
  accent: string;
  /** A family from the app's font list for the headings, '' for the system face. */
  headingFont: string;
  headingWeight: number;
}

export interface SiteFeature {
  id: string;
  title: string;
  body: string;
  /** The screenshot that shows it, by its place among the site's screenshots. -1 for none. */
  shot: number;
}

export interface SiteFaq {
  id: string;
  question: string;
  answer: string;
}

/**
 * The words on the pages that the developer or the AI wrote. The rest of the
 * text (the privacy policy, the menus and buttons) is made from the facts and
 * the privacy answers, in English, and translated like this.
 */
export interface SiteContent {
  /** The language this text is written in, a store locale such as en-US. */
  lang: string;
  headline: string;
  subhead: string;
  features: SiteFeature[];
  galleryTitle: string;
  ctaTitle: string;
  ctaBody: string;
  supportIntro: string;
  /** Under the support email, such as how soon people hear back. */
  contactNote: string;
  faqs: SiteFaq[];
  /** The developer's own words, added to the privacy policy. */
  privacyExtra: string;
  /** For search engines and link previews. */
  description: string;
}

/** What an app can collect, as the privacy questions ask about it. */
export type DataUse =
  | 'account'
  | 'analytics'
  | 'crashes'
  | 'ads'
  | 'purchases'
  | 'location'
  | 'media'
  | 'contacts'
  | 'health'
  | 'content'
  | 'sync'
  | 'notifications';

export interface PrivacyAnswers {
  /** The developer has gone through the questions at least once. */
  answered: boolean;
  /** What the app collects. Empty means nothing. */
  uses: DataUse[];
  /** The services behind each use, in the developer's words: "Firebase Analytics". */
  services: Partial<Record<DataUse, string>>;
  /** The ads are chosen from what people do (only with `ads`). */
  personalizedAds: boolean;
  /** The app is made for children under 13. */
  children: boolean;
  /** The day the policy takes effect, YYYY-MM-DD. */
  updated: string;
}

export interface SiteOptions {
  /** A small "Made with Open Screenshot Generator" line in the footer. */
  credit: boolean;
  /** The screenshots on the home page. */
  screenshots: boolean;
}

/** Where the site went the last time it was published. */
export interface PublishRecord {
  owner: string;
  repo: string;
  branch: string;
  /** The site's address, ending in a slash. */
  url: string;
  at: number;
  /** A random id written into osg-site.json, which tells when GitHub serves this version. */
  build: string;
  /** siteFingerprint of what went out, to tell whether the site changed since. */
  fingerprint: string;
  /** GitHub served this version already, rather than still building it. */
  live: boolean;
}

export interface SiteDraft {
  version: 1;
  projectId: string;
  createdAt: number;
  updatedAt: number;
  facts: SiteFacts;
  theme: SiteTheme;
  content: SiteContent;
  privacy: PrivacyAnswers;
  /** The language of the pages at the site's root. */
  baseLocale: string;
  /** Every language of the site, the base one first. */
  languages: string[];
  /**
   * Translations by language, then by the fingerprint of the English or base
   * text they translate (hash32). Keyed by the text rather than by a field,
   * so an edit leaves the old translation unused instead of wrong, and the
   * same sentence on two pages is translated once.
   */
  translations: Record<string, Record<string, string>>;
  options: SiteOptions;
  /** Which AI wrote the text last, for the line under the editor. */
  writtenBy?: string;
  publish?: PublishRecord;
}

/** One screenshot as the site shows it, in one language. */
export interface SiteShot {
  boardId: string;
  /** What the screenshot says, for the alt text and the features. */
  caption: string;
  width: number;
  height: number;
  /** JPEG bytes. */
  bytes: Uint8Array;
  /** An address the editor can show it from while the view is open. */
  url: string;
  /** The first characters of the bytes' SHA-1, which names the file on the site. */
  hash: string;
}

/** One file of the finished site. */
export interface SiteFile {
  /** Relative to the site's root, no leading slash: "de-de/support/index.html". */
  path: string;
  text?: string;
  bytes?: Uint8Array;
}

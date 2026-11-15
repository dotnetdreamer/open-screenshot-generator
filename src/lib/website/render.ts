// The site as files: one page per page and language, one stylesheet, the
// screenshots, the icon, and what GitHub Pages and search engines read.
//
// The same functions draw the live preview, with the files addressed from
// memory, so what the developer sees is what goes out. Pure: nothing here
// touches the page or the network, and the unit tests read the HTML it writes.
//
// The pages need no script to work. The one script there is closes the
// language menu on a click outside it and offers a visitor whose browser asks
// for another of the site's languages a link to it. It sends nothing anywhere,
// which is what the privacy policy's "This website" section says.
//
// Addresses between pages are relative, because a project site lives under
// /<repository>/ on github.io and the same files have to work there, in a
// downloaded copy and in the preview. The base language sits at the root, and
// every other language in a folder of its own named by its code.

import { cssFontFamily } from '@/services/fontService';
import { getLocaleDef } from '@/lib/i18n/locales';
import { chromeStrings, type ChromeStrings } from './content';
import { buildPolicy, paragraphs, type PolicySection } from './privacy';
import { paletteOf } from './theme';
import { translator, type TranslationBook } from './strings';
import type { SiteDraft, SiteFile, SitePage, SiteShot } from './types';

/** Written into every published site, and read back to tell a repository the app made from somebody else's. */
export const SITE_MARKER = 'osg-site.json';
export const GENERATOR = 'Open Screenshot Generator';
export const GENERATOR_URL = 'https://openscrgen.app';

// --- addresses ------------------------------------------------------------------------

export function localeSlug(locale: string): string {
  return locale.toLowerCase().replace(/[^a-z0-9-]/g, '');
}

/** The folder of a page: '' for the base language's home page, 'de-de/support/' for German support. */
export function pageDir(draft: Pick<SiteDraft, 'baseLocale'>, locale: string, page: SitePage): string {
  const parts: string[] = [];
  if (locale !== draft.baseLocale) parts.push(localeSlug(locale));
  if (page !== 'home') parts.push(page);
  return parts.length ? `${parts.join('/')}/` : '';
}

export function pageFile(draft: Pick<SiteDraft, 'baseLocale'>, locale: string, page: SitePage): string {
  return `${pageDir(draft, locale, page)}index.html`;
}

/** How `to` (a path from the site's root) is reached from a page in folder `fromDir`, by the shortest way. */
export function relativeHref(fromDir: string, to: string): string {
  const from = fromDir.split('/').filter(Boolean);
  const target = to.split('/');
  let shared = 0;
  while (shared < from.length && shared < target.length - 1 && from[shared] === target[shared]) shared += 1;
  const href = `${'../'.repeat(from.length - shared)}${target.slice(shared).join('/')}`;
  return href || './';
}

/** The page's full address once the site is published. */
export function pageUrl(siteUrl: string, draft: Pick<SiteDraft, 'baseLocale'>, locale: string, page: SitePage): string {
  return `${siteUrl.replace(/\/?$/, '/')}${pageDir(draft, locale, page)}`;
}

// --- text -------------------------------------------------------------------------------

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const e = escapeHtml;

/** A store link the page may point at: https only. */
function safeUrl(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function appStoreId(url: string): string | null {
  return /\/id(\d{6,})/.exec(url)?.[1] ?? null;
}

const ICONS = {
  globe:
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.9 5.6 3.9 9s-1.3 6.4-3.9 9c-2.6-2.6-3.9-5.6-3.9-9S9.4 5.6 12 3z"/></svg>',
  phone:
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6.5" y="2.5" width="11" height="19" rx="2.6"/><path d="M10.5 18.5h3"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M7 4.6v14.8a1 1 0 0 0 1.5.86l12.3-7.4a1 1 0 0 0 0-1.72L8.5 3.74A1 1 0 0 0 7 4.6z"/></svg>',
  mail:
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/></svg>',
};

// --- the stylesheet ---------------------------------------------------------------------

/**
 * A font family as it may go into the stylesheet. The name can be a font the
 * user imported, and the preview puts the stylesheet in a <style> element, so
 * nothing that could end a CSS string or the element goes through.
 */
export function safeFamily(family: string): string {
  return family.replace(/[<>"'\\;{}]/g, '').trim();
}

const BODY_FONT =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Apple Color Emoji", "Segoe UI Emoji", sans-serif';

/** The stylesheet every page shares, with the site's colours and heading face in it. */
export function renderStylesheet(draft: SiteDraft, options: { faceCss?: string } = {}): string {
  const p = paletteOf(draft.theme);
  const family = safeFamily(draft.theme.headingFont);
  const head = family ? `${cssFontFamily(family)}, ${BODY_FONT}` : BODY_FONT;
  const weight = Math.max(100, Math.min(900, draft.theme.headingWeight || 700));
  const dark = `--paper:#0b0d12;--ink:#eef1f6;--muted:#a3acba;--line:rgba(255,255,255,.1);--chip:rgba(255,255,255,.08);--card:#12161e;--card-solid:#151a23;--glass:rgba(11,13,18,.74);--tint:${p.tintDark};--link:${p.linkDark}`;
  return `${options.faceCss ?? ''}
:root{--brand:${p.brand};--brand-2:${p.brand2};--on-brand:${p.onBrand};--btn-bg:${p.brandIsDark ? '#ffffff' : '#0d1117'};--btn-ink:${p.brandIsDark ? '#0d1117' : '#ffffff'};--paper:#ffffff;--ink:#0d1117;--muted:#57606a;--line:rgba(13,17,23,.09);--chip:rgba(13,17,23,.06);--card:#f6f7f9;--card-solid:#ffffff;--glass:rgba(255,255,255,.8);--tint:${p.tintLight};--link:${p.linkLight};--font-body:${BODY_FONT};--font-head:${head};--head-weight:${weight};color-scheme:light dark}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){${dark}}}
:root[data-theme=dark]{${dark}}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%;scroll-behavior:smooth}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
body{margin:0;background:var(--paper);color:var(--ink);font:400 1.0625rem/1.65 var(--font-body);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;overflow-wrap:break-word}
img{max-width:100%;height:auto;display:block}
a{color:var(--link);text-underline-offset:.18em}
:focus-visible{outline:3px solid var(--link);outline-offset:3px;border-radius:8px}
h1,h2,h3{font-family:var(--font-head);font-weight:var(--head-weight);line-height:1.08;letter-spacing:-.02em;margin:0;text-wrap:balance;overflow-wrap:break-word;-webkit-hyphens:auto;hyphens:auto}
p{margin:0}
.wrap{width:min(1180px,100% - 3rem);margin-inline:auto}
.lead{font-size:clamp(1.12rem,.95rem + .7vw,1.38rem);line-height:1.55;text-wrap:pretty}
.skip{position:absolute;inset-inline-start:1rem;top:-4rem;z-index:60;background:var(--ink);color:var(--paper);padding:.6rem 1rem;border-radius:12px;text-decoration:none}
.skip:focus{top:1rem}
.top{position:sticky;top:0;z-index:40;background:var(--glass);-webkit-backdrop-filter:saturate(1.6) blur(14px);backdrop-filter:saturate(1.6) blur(14px);border-bottom:1px solid var(--line)}
.top .wrap{display:flex;align-items:center;gap:.5rem;min-height:64px}
.brand{display:inline-flex;align-items:center;gap:.65rem;color:inherit;text-decoration:none;font-weight:650;font-size:1.02rem;margin-inline-end:auto;min-width:0}
.brand span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.brand img{width:32px;height:32px;border-radius:22.5%;box-shadow:0 1px 3px rgba(0,0,0,.2);flex:none}
.links{display:flex;align-items:center;gap:.15rem}
.links a,.lang summary{color:inherit;text-decoration:none;padding:.5rem .8rem;border-radius:999px;font-size:.95rem;font-weight:560;opacity:.8;white-space:nowrap}
.links a:hover,.links a[aria-current=page],.lang[open] summary,.lang summary:hover{opacity:1;background:var(--chip)}
.lang{position:relative}
.lang summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:.4rem}
.lang summary::-webkit-details-marker{display:none}
.lang summary svg{width:18px;height:18px}
.lang ul{position:absolute;inset-inline-end:0;top:calc(100% + .45rem);min-width:13rem;max-height:min(70vh,26rem);overflow:auto;margin:0;padding:.4rem;list-style:none;background:var(--card-solid);color:var(--ink);border:1px solid var(--line);border-radius:16px;box-shadow:0 24px 48px -18px rgba(0,0,0,.38)}
.lang li a{display:block;padding:.55rem .8rem;border-radius:10px;color:inherit;text-decoration:none}
.lang li a:hover{background:var(--chip)}
.lang li a[aria-current=true]{font-weight:650}
@media (max-width:720px){.top{position:relative}.top .wrap{flex-wrap:wrap;column-gap:.25rem;row-gap:0;min-height:0;padding-block:.45rem .3rem}.top .brand{flex:1 1 0;min-height:44px}.top .lang{order:2}.top .links{order:3;flex:1 1 100%;flex-wrap:wrap;gap:0;margin-inline:-.6rem}.links a,.lang summary{padding:.45rem .6rem;font-size:.9rem;max-width:100%;overflow:hidden;text-overflow:ellipsis}}
.hero{position:relative;overflow:hidden;isolation:isolate;color:var(--on-brand);background:linear-gradient(135deg,var(--brand) 0%,var(--brand-2) 100%)}
.hero::before{content:"";position:absolute;z-index:-1;top:-25%;inset-inline-end:-12%;width:min(62vw,820px);aspect-ratio:1;background:radial-gradient(closest-side,rgba(255,255,255,.3),transparent)}
.hero::after{content:"";position:absolute;z-index:-1;bottom:-35%;inset-inline-start:-14%;width:min(54vw,700px);aspect-ratio:1;background:radial-gradient(closest-side,rgba(0,0,0,.2),transparent)}
.hero .wrap{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:clamp(2rem,5vw,5rem);align-items:center;padding-block:clamp(3.5rem,8vw,7.5rem) clamp(3rem,6vw,5.5rem)}
.hero.bare .wrap{grid-template-columns:minmax(0,1fr);text-align:center}
.hero.bare .lead{margin-inline:auto}
.hero.bare .stores,.hero.bare .eyebrow{justify-content:center}
.eyebrow{display:flex;align-items:center;gap:.8rem;font-weight:650;font-size:1.05rem;margin-bottom:1.5rem}
.eyebrow img{width:60px;height:60px;border-radius:22.5%;box-shadow:0 14px 30px -12px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.2)}
.hero h1{font-size:clamp(2.5rem,1.35rem + 4.2vw,4.8rem)}
.hero .lead{margin-top:1.3rem;max-width:34ch;opacity:.93}
.stores{display:flex;flex-wrap:wrap;gap:.75rem;margin-top:2.2rem}
.store{display:inline-flex;align-items:center;gap:.6rem;padding:.85rem 1.35rem;border-radius:999px;font-weight:650;font-size:1rem;line-height:1.2;text-decoration:none;transition:transform .2s ease,box-shadow .2s ease}
.store svg{width:20px;height:20px;flex:none}
.store.solid{background:var(--btn-bg);color:var(--btn-ink);box-shadow:0 12px 26px -12px rgba(0,0,0,.55)}
.store.ghost{background:transparent;color:inherit;box-shadow:inset 0 0 0 1.5px currentColor}
.store:hover{transform:translateY(-2px)}
.fan{position:relative;height:clamp(380px,46vw,620px)}
.fan img{position:absolute;top:50%;left:50%;height:88%;width:auto;max-width:none;border-radius:clamp(16px,2vw,28px);box-shadow:0 40px 80px -30px rgba(0,0,0,.6),0 18px 36px -18px rgba(0,0,0,.35)}
.fan .c{transform:translate(-50%,-50%);z-index:3}
.fan .l{transform:translate(-106%,-47%) rotate(-7deg) scale(.84);z-index:2}
.fan .r{transform:translate(6%,-47%) rotate(7deg) scale(.84);z-index:1}
.fan.wide img{height:66%}
.fan.wide .l{transform:translate(-92%,-44%) rotate(-6deg) scale(.8)}
.fan.wide .r{transform:translate(-8%,-44%) rotate(6deg) scale(.8)}
@media (max-width:900px){.hero .wrap{grid-template-columns:minmax(0,1fr);text-align:center}.hero .lead{margin-inline:auto}.stores,.eyebrow{justify-content:center}.fan{height:clamp(330px,92vw,520px)}}
.features{padding-block:clamp(2.5rem,6vw,5rem)}
.feature{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:center;gap:clamp(2rem,6vw,6rem);padding-block:clamp(2rem,5vw,4rem)}
.feature:nth-child(even) .shot{order:2}
.feature.plain{grid-template-columns:minmax(0,1fr);max-width:44rem;margin-inline:auto;text-align:center}
.feature.plain p{margin-inline:auto}
.feature .shot{display:flex;justify-content:center;align-items:center;padding:clamp(1.5rem,4vw,3rem);border-radius:clamp(24px,3vw,36px);background:var(--tint)}
.feature .shot img{max-height:min(620px,72vh);width:auto;border-radius:clamp(14px,1.8vw,24px);box-shadow:0 30px 60px -28px rgba(0,0,0,.5)}
.num{display:block;font:700 .8rem/1 var(--font-body);letter-spacing:.16em;color:var(--link);margin-bottom:1rem}
.feature h2{font-size:clamp(1.9rem,1.2rem + 2.2vw,3rem)}
.feature p{margin-top:1.1rem;font-size:1.13rem;color:var(--muted);max-width:36ch}
@media (max-width:820px){.feature{grid-template-columns:minmax(0,1fr);text-align:center}.feature:nth-child(even) .shot{order:0}.feature p{margin-inline:auto}}
.gallery{padding-block:clamp(2rem,5vw,4.5rem)}
.gallery h2{font-size:clamp(1.7rem,1.1rem + 1.8vw,2.6rem);margin-bottom:1.6rem}
.strip{display:flex;gap:1.25rem;overflow-x:auto;scroll-snap-type:x mandatory;padding:.5rem max(1.5rem,calc((100% - 1180px) / 2)) 2rem;scrollbar-width:thin;overscroll-behavior-x:contain}
.strip img{height:clamp(340px,42vw,520px);width:auto;max-width:none;flex:none;scroll-snap-align:center;border-radius:clamp(14px,1.8vw,22px);box-shadow:0 24px 48px -26px rgba(0,0,0,.5)}
.cta{padding-block:clamp(1.5rem,4vw,3rem) clamp(3rem,7vw,6rem)}
.cta .box{position:relative;overflow:hidden;isolation:isolate;border-radius:clamp(24px,3vw,40px);padding:clamp(2.5rem,6vw,5rem) clamp(1.5rem,5vw,4rem);text-align:center;color:var(--on-brand);background:linear-gradient(135deg,var(--brand),var(--brand-2))}
.cta .box::before{content:"";position:absolute;z-index:-1;top:-60%;left:50%;width:min(90vw,900px);aspect-ratio:1;transform:translateX(-50%);background:radial-gradient(closest-side,rgba(255,255,255,.24),transparent)}
.cta .icon{width:76px;height:76px;margin:0 auto 1.4rem;border-radius:22.5%;box-shadow:0 16px 34px -14px rgba(0,0,0,.55)}
.cta h2{font-size:clamp(2rem,1.2rem + 2.6vw,3.4rem)}
.cta p{margin:1rem auto 0;max-width:40ch;opacity:.92;font-size:1.15rem}
.cta .stores{justify-content:center}
.head{background:linear-gradient(180deg,var(--tint),transparent);padding-block:clamp(3rem,7vw,5.5rem) clamp(1.5rem,4vw,3rem)}
.head .icon{width:64px;height:64px;border-radius:22.5%;margin-bottom:1.6rem;box-shadow:0 12px 28px -14px rgba(0,0,0,.45)}
.head h1{font-size:clamp(2.2rem,1.3rem + 3vw,3.6rem)}
.head .lead{margin-top:1rem;color:var(--muted);max-width:54ch}
.head .lead+.lead{margin-top:.8rem}
.date{display:inline-flex;align-items:center;gap:.5rem;margin-top:1.2rem;padding:.35rem .85rem;border-radius:999px;background:var(--chip);font-size:.9rem;color:var(--muted)}
.support{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:clamp(1.5rem,4vw,3rem);align-items:start;padding-block:1rem clamp(3rem,7vw,6rem)}
.card{background:var(--card);border:1px solid var(--line);border-radius:24px;padding:clamp(1.5rem,3vw,2.2rem)}
.contact{position:sticky;top:88px}
.contact h2{font-size:1.55rem}
.contact p{margin-top:.75rem;color:var(--muted)}
.button{display:flex;align-items:center;justify-content:center;gap:.55rem;margin-top:1.4rem;padding:.95rem 1.4rem;border-radius:999px;background:linear-gradient(135deg,var(--brand),var(--brand-2));color:var(--on-brand);font-weight:650;text-decoration:none;box-shadow:0 14px 28px -16px var(--brand)}
.button svg{width:19px;height:19px}
.mail{display:block;margin-top:.9rem;font-size:.95rem;overflow-wrap:anywhere;text-align:center;color:var(--muted)}
.faq h2{font-size:clamp(1.6rem,1.1rem + 1.4vw,2.2rem);margin-bottom:1rem}
.faq details{border-bottom:1px solid var(--line)}
.faq summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1.2rem .25rem;font-weight:620;font-size:1.1rem}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"";flex:none;width:10px;height:10px;border-inline-end:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(45deg);transition:transform .2s ease;opacity:.55;margin-inline-end:.3rem}
.faq details[open] summary::after{transform:rotate(225deg)}
.faq .answer{padding:0 .25rem 1.35rem;color:var(--muted)}
.faq .answer p+p{margin-top:.8rem}
@media (max-width:860px){.support{grid-template-columns:minmax(0,1fr)}.contact{position:static}}
.doc{display:grid;grid-template-columns:minmax(0,15rem) minmax(0,1fr);gap:clamp(2rem,5vw,4.5rem);align-items:start;padding-block:1rem clamp(3rem,7vw,6rem)}
.toc{position:sticky;top:88px;font-size:.93rem}
.toc p{font-weight:650;margin-bottom:.6rem}
.toc ol{list-style:none;margin:0;padding:0;border-inline-start:2px solid var(--line)}
.toc a{display:block;padding:.32rem .9rem;margin-inline-start:-2px;border-inline-start:2px solid transparent;color:var(--muted);text-decoration:none}
.toc a:hover{color:var(--ink);border-color:var(--link)}
.prose{max-width:70ch}
.prose section{scroll-margin-top:88px}
.prose section+section{margin-top:2.4rem}
.prose h2{font-size:clamp(1.35rem,1.1rem + .6vw,1.7rem);margin-bottom:.8rem}
.prose p+p,.prose p+ul,.prose ul+p,.prose p+.more,.prose ul+.more{margin-top:.9rem}
.prose ul{padding-inline-start:1.25rem;margin:0}
.prose li+li{margin-top:.35rem}
.prose li::marker{color:var(--link)}
.more{display:inline-block}
@media (max-width:900px){.doc{grid-template-columns:minmax(0,1fr)}.toc{position:static}}
.foot{border-top:1px solid var(--line);padding-block:2.5rem 3rem;color:var(--muted);font-size:.95rem}
.foot .wrap{display:flex;flex-wrap:wrap;gap:1rem 2rem;align-items:center}
.foot .brand{color:var(--ink);margin-inline-end:0}
.foot nav{display:flex;flex-wrap:wrap;gap:.3rem 1.3rem;margin-inline-start:auto}
.foot nav a{color:inherit;text-decoration:none}
.foot nav a:hover{color:var(--ink);text-decoration:underline}
.fine{flex-basis:100%;display:flex;flex-wrap:wrap;gap:.4rem 1.5rem;font-size:.875rem}
.fine a{color:inherit}
.suggest{position:fixed;inset-inline-end:1rem;bottom:1rem;z-index:45;display:none;align-items:center;gap:.25rem;padding:.35rem .35rem .35rem .95rem;border-radius:999px;background:var(--ink);color:var(--paper);box-shadow:0 18px 40px -16px rgba(0,0,0,.55);font-size:.95rem}
.suggest.show{display:inline-flex}
.suggest a{color:inherit;font-weight:650;text-decoration:none;display:inline-flex;align-items:center;gap:.45rem}
.suggest a svg{width:17px;height:17px}
.suggest button{border:0;background:transparent;color:inherit;width:2rem;height:2rem;border-radius:999px;cursor:pointer;font-size:1.2rem;line-height:1}
.missing{min-height:60vh;display:grid;place-items:center;text-align:center;padding:4rem 1.5rem}
.missing h1{font-size:clamp(2rem,1.3rem + 2.4vw,3rem)}
.missing p{margin-top:1rem;color:var(--muted)}
.missing .button{display:inline-flex;width:auto}
@media (prefers-reduced-motion:no-preference){
.hero .copy>*{animation:rise .7s cubic-bezier(.2,.7,.2,1) both}
.hero .copy>:nth-child(2){animation-delay:.05s}
.hero .copy>:nth-child(3){animation-delay:.1s}
.hero .copy>:nth-child(4){animation-delay:.15s}
.fan img{animation:lift .9s cubic-bezier(.2,.7,.2,1) both}
.fan .l{animation-delay:.12s}
.fan .r{animation-delay:.2s}
}
@keyframes rise{from{opacity:0;translate:0 14px}to{opacity:1;translate:0 0}}
@keyframes lift{from{opacity:0;translate:0 28px}to{opacity:1;translate:0 0}}
@media print{.top,.foot,.toc,.skip,.suggest{display:none}.doc{display:block}body{background:#fff;color:#000}.head{background:none}}
`;
}

// --- the pages ----------------------------------------------------------------------------

/** A screenshot as a page shows it: where its file is and what it says. */
export interface ShotRef {
  path: string;
  width: number;
  height: number;
  caption: string;
}

export interface PageOptions {
  /** The site's address once published, for canonical links, other languages and link previews. */
  siteUrl?: string;
  /** How a page addresses a file of the site. Relative paths on the published site; memory in the preview. */
  asset?: (path: string, fromDir: string) => string;
  /** The stylesheet itself, for the preview; the published pages link assets/site.css. */
  inlineCss?: string;
  /** Extra tags for the head, such as the preview's Google Fonts link. */
  headExtra?: string;
  /** Translations the project already has, from projectTranslations. */
  known?: TranslationBook;
  /** Links carry data-osg-page and data-osg-locale, which the preview listens for. */
  preview?: boolean;
  /** The year in the footer. */
  year?: number;
}

interface PageContext {
  draft: SiteDraft;
  page: SitePage;
  locale: string;
  dir: string;
  t: (text: string, template?: boolean) => string;
  c: ChromeStrings;
  options: PageOptions;
  asset: (path: string) => string;
  link: (page: SitePage, locale?: string, hash?: string) => string;
  icon: string | null;
}

function chromeIn(t: PageContext['t'], chrome: ChromeStrings): ChromeStrings {
  const out = {} as Record<keyof ChromeStrings, string>;
  for (const [key, value] of Object.entries(chrome) as Array<[keyof ChromeStrings, string]>) out[key] = t(value, true);
  return out as ChromeStrings;
}

function context(draft: SiteDraft, page: SitePage, locale: string, options: PageOptions): PageContext {
  const t = translator(draft, locale, options.known);
  const dir = pageDir(draft, locale, page);
  const asset = (path: string) => (options.asset ? options.asset(path, dir) : relativeHref(dir, path));
  const link = (target: SitePage, targetLocale = locale, hash = '') => {
    const href = `${relativeHref(dir, pageDir(draft, targetLocale, target))}${hash}`;
    return options.preview ? `href="${e(href)}" data-osg-page="${target}" data-osg-locale="${e(targetLocale)}"` : `href="${e(href)}"`;
  };
  return {
    draft,
    page,
    locale,
    dir,
    t,
    c: chromeIn(t, chromeStrings(draft.facts)),
    options,
    asset,
    link,
    icon: draft.facts.icon ? asset('assets/icon.png') : null,
  };
}

function languageName(locale: string): string {
  return getLocaleDef(locale)?.nativeName ?? locale;
}

function htmlLang(locale: string): string {
  // The store locale is already a BCP 47 tag, apart from Norwegian's "no".
  return locale === 'no' ? 'nb' : locale;
}

function storeButtons(ctx: PageContext, variant: 'hero' | 'cta'): string {
  const apple = safeUrl(ctx.draft.facts.appStoreUrl);
  const google = safeUrl(ctx.draft.facts.playStoreUrl);
  if (!apple && !google) return '';
  const buttons: string[] = [];
  if (apple) buttons.push(`<a class="store solid" href="${e(apple)}">${ICONS.phone}<span>${e(ctx.c.appStore)}</span></a>`);
  if (google) buttons.push(`<a class="store ${apple ? 'ghost' : 'solid'}" href="${e(google)}">${ICONS.play}<span>${e(ctx.c.googlePlay)}</span></a>`);
  return `<div class="stores" data-part="${variant}-stores">${buttons.join('')}</div>`;
}

function header(ctx: PageContext): string {
  const app = e(ctx.draft.facts.appName || ctx.c.home);
  const languages = ctx.draft.languages;
  const menu =
    languages.length > 1
      ? `<details class="lang"><summary aria-label="${e(ctx.c.language)}">${ICONS.globe}<span>${e(languageName(ctx.locale))}</span></summary><ul>${languages
          .map(
            (code) =>
              `<li><a ${ctx.link(ctx.page, code)} hreflang="${e(htmlLang(code))}" lang="${e(htmlLang(code))}" data-lang="${e(code)}"${code === ctx.locale ? ' aria-current="true"' : ''}>${e(languageName(code))}</a></li>`
          )
          .join('')}</ul></details>`
      : '';
  const current = (page: SitePage) => (ctx.page === page ? ' aria-current="page"' : '');
  return `<a class="skip" href="#main">${e(ctx.c.skip)}</a>
<header class="top"><div class="wrap">
<a class="brand${ctx.icon ? ' iconic' : ''}" ${ctx.link('home')}>${ctx.icon ? `<img src="${e(ctx.icon)}" alt="" width="32" height="32">` : ''}<span>${app}</span></a>
<nav class="links" aria-label="${e(ctx.c.menu)}"><a ${ctx.link('support')}${current('support')}>${e(ctx.c.support)}</a><a ${ctx.link('privacy')}${current('privacy')}>${e(ctx.c.privacy)}</a></nav>
${menu}
</div></header>`;
}

function footer(ctx: PageContext): string {
  const year = ctx.options.year ?? new Date().getFullYear();
  const owner = ctx.draft.facts.developer.trim() || ctx.draft.facts.appName.trim();
  const credit = ctx.draft.options.credit ? `<span>${e(ctx.c.madeWith)} <a href="${GENERATOR_URL}">${GENERATOR}</a></span>` : '';
  return `<footer class="foot"><div class="wrap">
<a class="brand" ${ctx.link('home')}>${ctx.icon ? `<img src="${e(ctx.icon)}" alt="" width="32" height="32">` : ''}<span>${e(ctx.draft.facts.appName || ctx.c.home)}</span></a>
<nav aria-label="${e(ctx.c.menu)}"><a ${ctx.link('home')}>${e(ctx.c.home)}</a><a ${ctx.link('support')}>${e(ctx.c.support)}</a><a ${ctx.link('privacy')}>${e(ctx.c.privacy)}</a></nav>
<div class="fine">${owner ? `<span>&copy; ${year} ${e(owner)}</span>` : ''}${credit}</div>
</div></footer>`;
}

/** The one script: the language menu closes on a click outside it, and a visitor gets a link to their own language. */
const SCRIPT = `<script>(function(){var d=document;d.addEventListener('click',function(e){d.querySelectorAll('details.lang[open]').forEach(function(x){if(!x.contains(e.target))x.removeAttribute('open')})});try{if(sessionStorage.getItem('osg-lang-dismissed'))return}catch(e){}var here=(d.documentElement.getAttribute('data-locale')||'').toLowerCase(),links=[].slice.call(d.querySelectorAll('.lang a[data-lang]')),want=(navigator.languages||[navigator.language||'']).map(function(x){return String(x).toLowerCase()});if(!links.length)return;function pick(){for(var i=0;i<want.length;i++){var w=want[i];if(!w)continue;var exact=links.filter(function(a){return a.getAttribute('data-lang').toLowerCase()===w})[0];if(exact)return exact;var p=w.split('-')[0],same=links.filter(function(a){return a.getAttribute('data-lang').toLowerCase().split('-')[0]===p})[0];if(same)return same}return null}var best=pick();if(!best||best.getAttribute('data-lang').toLowerCase()===here)return;if(here.split('-')[0]===best.getAttribute('data-lang').toLowerCase().split('-')[0])return;var s=d.getElementById('osg-suggest');if(!s)return;var a=s.querySelector('a');a.setAttribute('href',best.getAttribute('href'));a.setAttribute('lang',best.getAttribute('lang'));a.querySelector('span').textContent=best.textContent;s.classList.add('show');s.querySelector('button').addEventListener('click',function(){s.classList.remove('show');try{sessionStorage.setItem('osg-lang-dismissed','1')}catch(e){}})})();</script>`;

function suggestion(ctx: PageContext): string {
  if (ctx.draft.languages.length < 2) return '';
  return `<div class="suggest" id="osg-suggest" role="status"><a href="./">${ICONS.globe}<span></span></a><button type="button" aria-label="Close">&times;</button></div>`;
}

function shell(ctx: PageContext, input: { title: string; description: string; body: string; ogImage?: string | null }): string {
  const { draft, locale, page, options } = ctx;
  const def = getLocaleDef(locale);
  const css = options.inlineCss !== undefined ? `<style>${options.inlineCss}</style>` : `<link rel="stylesheet" href="${e(ctx.asset('assets/site.css'))}">`;
  const site = options.siteUrl?.replace(/\/?$/, '/');
  const alternates = site
    ? [
        `<link rel="canonical" href="${e(pageUrl(site, draft, locale, page))}">`,
        ...(draft.languages.length > 1
          ? [
              ...draft.languages.map((code) => `<link rel="alternate" hreflang="${e(htmlLang(code))}" href="${e(pageUrl(site, draft, code, page))}">`),
              `<link rel="alternate" hreflang="x-default" href="${e(pageUrl(site, draft, draft.baseLocale, page))}">`,
            ]
          : []),
      ].join('\n')
    : '';
  const ogImage = input.ogImage && site ? `${site}${input.ogImage}` : null;
  const appleId = appStoreId(draft.facts.appStoreUrl);
  const p = paletteOf(draft.theme);
  const meta = [
    `<meta name="description" content="${e(input.description)}">`,
    `<meta name="theme-color" content="${p.themeColor}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${e(input.title)}">`,
    `<meta property="og:description" content="${e(input.description)}">`,
    site ? `<meta property="og:url" content="${e(pageUrl(site, draft, locale, page))}">` : '',
    ogImage ? `<meta property="og:image" content="${e(ogImage)}">` : '',
    `<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">`,
    appleId && page === 'home' ? `<meta name="apple-itunes-app" content="app-id=${appleId}">` : '',
    ctx.icon ? `<link rel="icon" href="${e(ctx.icon)}" type="image/png"><link rel="apple-touch-icon" href="${e(ctx.icon)}">` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return `<!doctype html>
<html lang="${e(htmlLang(locale))}" dir="${def?.rtl ? 'rtl' : 'ltr'}" data-locale="${e(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(input.title)}</title>
${meta}
${alternates}
${options.headExtra ?? ''}
${css}
</head>
<body class="page-${page}">
${header(ctx)}
<main id="main">
${input.body}
</main>
${footer(ctx)}
${suggestion(ctx)}
${options.preview ? '' : SCRIPT}
</body>
</html>
`;
}

function shotImg(ctx: PageContext, shot: ShotRef, className = '', eager = false): string {
  const alt = shot.caption || ctx.c.screenshot;
  return `<img${className ? ` class="${className}"` : ''} src="${e(ctx.asset(shot.path))}" width="${shot.width}" height="${shot.height}" alt="${e(alt)}"${eager ? '' : ' loading="lazy"'} decoding="async">`;
}

function homePage(ctx: PageContext, shots: ShotRef[]): string {
  const { draft, t } = ctx;
  const content = draft.content;
  const show = draft.options.screenshots ? shots : [];
  const app = draft.facts.appName.trim();
  const wide = show.length > 0 && show[0].width / Math.max(1, show[0].height) > 0.62;
  const fan =
    show.length > 0
      ? `<div class="fan${wide ? ' wide' : ''}" aria-hidden="true">${[
          show[1] ? shotImg(ctx, show[1], 'l', true) : '',
          shotImg(ctx, show[0], 'c', true),
          show[2] ? shotImg(ctx, show[2], 'r', true) : '',
        ].join('')}</div>`
      : '';
  const hero = `<section class="hero${fan ? '' : ' bare'}"><div class="wrap">
<div class="copy">
${app || ctx.icon ? `<p class="eyebrow">${ctx.icon ? `<img src="${e(ctx.icon)}" alt="" width="60" height="60">` : ''}${app ? `<span>${e(app)}</span>` : ''}</p>` : ''}
<h1>${e(t(content.headline))}</h1>
${content.subhead ? `<p class="lead">${e(t(content.subhead))}</p>` : ''}
${storeButtons(ctx, 'hero')}
</div>
${fan}
</div></section>`;

  const features = content.features
    .map((feature, index) => {
      const shot = feature.shot >= 0 ? show[feature.shot] : undefined;
      const number = String(index + 1).padStart(2, '0');
      return `<article class="feature${shot ? '' : ' plain'}">
${shot ? `<div class="shot">${shotImg(ctx, shot)}</div>` : ''}
<div><span class="num">${number}</span><h2>${e(t(feature.title))}</h2>${feature.body ? `<p>${e(t(feature.body))}</p>` : ''}</div>
</article>`;
    })
    .join('\n');

  const gallery =
    show.length >= 2
      ? `<section class="gallery" aria-labelledby="gallery-title"><div class="wrap"><h2 id="gallery-title">${e(t(content.galleryTitle))}</h2></div><div class="strip" tabindex="0">${show.map((shot) => shotImg(ctx, shot)).join('')}</div></section>`
      : '';
  const stores = storeButtons(ctx, 'cta');
  const cta =
    content.ctaTitle || stores
      ? `<section class="cta"><div class="wrap"><div class="box">${ctx.icon ? `<img class="icon" src="${e(ctx.icon)}" alt="" width="76" height="76">` : ''}<h2>${e(t(content.ctaTitle))}</h2>${content.ctaBody ? `<p>${e(t(content.ctaBody))}</p>` : ''}${stores}</div></div></section>`
      : '';
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'MobileApplication',
    name: app || undefined,
    description: t(content.description) || undefined,
    operatingSystem: [draft.facts.appStoreUrl ? 'iOS' : '', draft.facts.playStoreUrl ? 'Android' : ''].filter(Boolean).join(', ') || undefined,
    author: draft.facts.developer.trim() ? { '@type': 'Organization', name: draft.facts.developer.trim() } : undefined,
    sameAs: [safeUrl(draft.facts.appStoreUrl), safeUrl(draft.facts.playStoreUrl)].filter(Boolean),
  }).replace(/</g, '\\u003c');
  const body = `${hero}
${features ? `<section class="features"><div class="wrap">${features}</div></section>` : ''}
${gallery}
${cta}
<script type="application/ld+json">${jsonLd}</script>`;
  const title = app ? (content.headline && content.headline !== app ? `${app}: ${t(content.headline)}` : app) : t(content.headline);
  return shell(ctx, { title, description: t(content.description) || t(content.headline), body, ogImage: show[0]?.path ?? null });
}

function supportPage(ctx: PageContext): string {
  const { draft, t, c } = ctx;
  const content = draft.content;
  const email = draft.facts.supportEmail.trim();
  const subject = encodeURIComponent(`${draft.facts.appName.trim() || c.support}: ${c.support}`);
  const contact = email
    ? `<aside class="card contact" aria-labelledby="contact-title"><h2 id="contact-title">${e(c.contact)}</h2>${content.contactNote ? `<p>${e(t(content.contactNote))}</p>` : ''}<a class="button" href="mailto:${e(email)}?subject=${subject}">${ICONS.mail}<span>${e(c.emailUs)}</span></a><span class="mail">${e(email)}</span></aside>`
    : '';
  const faqs = content.faqs
    .map(
      (faq) =>
        `<details><summary>${e(t(faq.question))}</summary><div class="answer">${paragraphs(faq.answer)
          .map((part) => `<p>${e(t(part))}</p>`)
          .join('')}</div></details>`
    )
    .join('\n');
  const body = `<section class="head"><div class="wrap">${ctx.icon ? `<img class="icon" src="${e(ctx.icon)}" alt="" width="64" height="64">` : ''}<h1>${e(c.supportTitle)}</h1>${paragraphs(content.supportIntro)
    .map((part) => `<p class="lead">${e(t(part))}</p>`)
    .join('')}</div></section>
<div class="wrap support">
<section class="faq" aria-labelledby="faq-title">${faqs ? `<h2 id="faq-title">${e(c.faq)}</h2>${faqs}` : ''}</section>
${contact}
</div>`;
  return shell(ctx, { title: c.supportTitle, description: t(paragraphs(content.supportIntro)[0] ?? '') || c.supportTitle, body });
}

function formatDate(day: string, locale: string): string {
  const [year, month, date] = day.split('-').map(Number);
  if (!year || !month || !date) return day;
  try {
    return new Intl.DateTimeFormat(htmlLang(locale), { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(Date.UTC(year, month - 1, date));
  } catch {
    return day;
  }
}

function policyHtml(ctx: PageContext, sections: PolicySection[], extra: Set<string>): string {
  const t = (text: string) => ctx.t(text, !extra.has(text));
  return sections
    .map((section) => {
      const blocks = section.blocks
        .map((block) => {
          if (block.kind === 'p') return `<p>${e(t(block.text))}</p>`;
          if (block.kind === 'ul') return `<ul>${block.items.map((item) => `<li>${e(t(item))}</li>`).join('')}</ul>`;
          return `<p class="more"><a href="${e(block.href)}">${e(t(block.text))}</a></p>`;
        })
        .join('');
      return `<section id="${e(section.id)}" aria-labelledby="${e(section.id)}-title"><h2 id="${e(section.id)}-title">${e(ctx.t(section.heading, true))}</h2>${blocks}</section>`;
    })
    .join('\n');
}

function privacyPage(ctx: PageContext): string {
  const { draft, c } = ctx;
  const sections = buildPolicy({ facts: draft.facts, privacy: draft.privacy, extra: draft.content.privacyExtra });
  const extra = new Set(paragraphs(draft.content.privacyExtra));
  const toc = `<nav class="toc" aria-labelledby="toc-title"><p id="toc-title">${e(c.contents)}</p><ol>${sections
    .map((section) => `<li><a href="#${e(section.id)}">${e(ctx.t(section.heading, true))}</a></li>`)
    .join('')}</ol></nav>`;
  const body = `<section class="head"><div class="wrap">${ctx.icon ? `<img class="icon" src="${e(ctx.icon)}" alt="" width="64" height="64">` : ''}<h1>${e(c.privacy)}</h1><p class="lead">${e(c.privacyFor)}</p><p class="date">${e(c.updated)}: <time datetime="${e(draft.privacy.updated)}">${e(formatDate(draft.privacy.updated, ctx.locale))}</time></p></div></section>
<div class="wrap doc">
${toc}
<article class="prose">${policyHtml(ctx, sections, extra)}</article>
</div>`;
  const app = draft.facts.appName.trim();
  return shell(ctx, { title: app ? `${c.privacy}: ${app}` : c.privacy, description: c.privacyFor, body });
}

/** One page of the site in one language, as HTML. `shots` are that language's screenshots. */
export function renderPage(draft: SiteDraft, page: SitePage, locale: string, shots: ShotRef[], options: PageOptions = {}): string {
  const ctx = context(draft, page, locale, options);
  if (page === 'home') return homePage(ctx, shots);
  if (page === 'support') return supportPage(ctx);
  return privacyPage(ctx);
}

function notFoundPage(draft: SiteDraft, options: PageOptions): string {
  // GitHub Pages serves 404.html for any address, at any depth, so its
  // addresses are absolute when the site's address is known.
  const site = options.siteUrl?.replace(/\/?$/, '/');
  const ctx = context(draft, 'home', draft.baseLocale, {
    ...options,
    asset: site ? (path) => `${site}${path}` : options.asset,
  });
  const body = `<section class="missing"><div><h1>${e(ctx.c.notFound)}</h1><p>${e(ctx.c.notFoundBody)}</p><a class="button" href="${e(site ?? './')}">${e(ctx.c.backHome)}</a></div></section>`;
  return shell({ ...ctx, link: (target, targetLocale = ctx.locale) => `href="${e(site ? `${site}${pageDir(draft, targetLocale, target)}` : relativeHref('', pageDir(draft, targetLocale, target)))}"` }, {
    title: ctx.c.notFound,
    description: ctx.c.notFoundBody,
    body,
  });
}

// --- the whole site ---------------------------------------------------------------------------

export interface SiteBuild {
  /** Every site language's screenshots. A language without its own uses the base language's. */
  shots: Record<string, SiteShot[]>;
  siteUrl?: string;
  /** The heading face as a file of the site, with its format for @font-face. */
  face?: { file: string; bytes: Uint8Array; format: string } | null;
  known?: TranslationBook;
  /** Identifies this publish in osg-site.json. */
  build: string;
  now?: number;
}

function iconBytes(dataUrl: string): Uint8Array | null {
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function shotPath(shot: Pick<SiteShot, 'hash'>): string {
  return `assets/shots/${shot.hash}.jpg`;
}

export function faceCss(family: string, file: string, format: string, weight: number): string {
  return `@font-face{font-family:"${safeFamily(family)}";src:url(${file}) format("${format.replace(/[^a-z0-9-]/gi, '')}");font-weight:${Math.round(weight)};font-style:normal;font-display:swap}`;
}

/** Every file of the published site. */
export function renderSiteFiles(draft: SiteDraft, build: SiteBuild): SiteFile[] {
  const files: SiteFile[] = [];
  const added = new Set<string>();
  const add = (file: SiteFile) => {
    if (added.has(file.path)) return;
    added.add(file.path);
    files.push(file);
  };
  const year = new Date(build.now ?? Date.now()).getFullYear();
  const options: PageOptions = { siteUrl: build.siteUrl, known: build.known, year };
  const base = build.shots[draft.baseLocale] ?? [];
  for (const locale of draft.languages) {
    const shots = (build.shots[locale]?.length ? build.shots[locale] : base).map((shot) => {
      add({ path: shotPath(shot), bytes: shot.bytes });
      return { path: shotPath(shot), width: shot.width, height: shot.height, caption: shot.caption };
    });
    for (const page of ['home', 'support', 'privacy'] as SitePage[]) {
      add({ path: pageFile(draft, locale, page), text: renderPage(draft, page, locale, shots, options) });
    }
  }
  const face = build.face
    ? faceCss(draft.theme.headingFont, `fonts/${build.face.file}`, build.face.format, draft.theme.headingWeight || 700)
    : '';
  add({ path: 'assets/site.css', text: renderStylesheet(draft, { faceCss: face }) });
  if (build.face) add({ path: `assets/fonts/${build.face.file}`, bytes: build.face.bytes });
  const icon = iconBytes(draft.facts.icon);
  if (icon) add({ path: 'assets/icon.png', bytes: icon });
  add({ path: '404.html', text: notFoundPage(draft, options) });
  // Without it GitHub runs the pages through Jekyll, which reads {{ in the
  // developer's text as a template tag.
  add({ path: '.nojekyll', text: 'Serve these files as they are.\n' });
  const site = build.siteUrl?.replace(/\/?$/, '/');
  add({ path: 'robots.txt', text: `User-agent: *\nAllow: /\n${site ? `Sitemap: ${site}sitemap.xml\n` : ''}` });
  if (site) {
    const urls = draft.languages.flatMap((locale) => (['home', 'support', 'privacy'] as SitePage[]).map((page) => pageUrl(site, draft, locale, page)));
    add({
      path: 'sitemap.xml',
      text: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `  <url><loc>${e(url)}</loc></url>`).join('\n')}\n</urlset>\n`,
    });
  }
  add({
    path: SITE_MARKER,
    text: `${JSON.stringify({ generator: GENERATOR, build: build.build, languages: draft.languages, at: new Date(build.now ?? Date.now()).toISOString() }, null, 2)}\n`,
  });
  const app = draft.facts.appName.trim() || 'this app';
  add({
    path: 'README.md',
    text: `# ${app}\n\nThe website of ${app}: a home page, a support page and a privacy policy${draft.languages.length > 1 ? `, in ${draft.languages.length} languages` : ''}.\n\nMade with [${GENERATOR}](${GENERATOR_URL}), which publishes it here with GitHub Pages. Changes made in this repository are replaced the next time the site is published from the app, so make them in the app.\n`,
  });
  return files;
}

// Copied from github.com/dotnetdreamer/claude-seo osg/checks/pageChecks.ts at da732e65be7f.
// Change it there and run npm run sync:seo-checks. Edits here are lost on the next sync.

// The 47 on-page checks of scripts/page_checks.py, written again for
// TypeScript. The ids, thresholds, severities and messages are the script's,
// and osg/tests/parity.test.ts runs both on the same pages, so a change to
// the script upstream shows up here as a failing test. Every finding is
// something the HTML says; nothing is guessed by a model.

import {
  attr,
  childElements,
  closest,
  find,
  findAll,
  findBy,
  hasAncestor,
  hasAttr,
  parseHtml,
  rawText,
  textOf,
  without,
  type HtmlElement,
} from './html';
import { canonicalizeUrl, joinUrl, schemeAndHost, urlMatchKey } from './url';
import { pythonJsonError } from './pyJson';
import { PY_DIGIT, PY_END, PY_SPACE, PY_SPACE_CHARS, PY_WORD, pyIgnoreCase, pySearchAfterNonWord, pyClass, pyIsAlnum, pyIsAlpha, pyLower, pyLstrip, pyRound, pyRstrip, pySorted, pySplit, pyStrip } from './py';

// --- Thresholds (page_checks.py, "Thresholds: one table") ------------------

export const TITLE_MIN_CHARS = 30;
export const TITLE_MAX_CHARS = 60;
export const META_DESCRIPTION_MIN_CHARS = 120;
export const META_DESCRIPTION_MAX_CHARS = 160;
export const URL_MAX_CHARS = 100;
export const HTML_MAX_BYTES = 2_000_000;
export const THIN_CONTENT_MIN_WORDS = 200;
export const DOM_MAX_DEPTH = 32;
export const DOM_MAX_CHILDREN = 60;
export const TITLE_RELEVANCE_MIN = 0.3;
export const DESCRIPTION_RELEVANCE_MIN = 0.2;
export const RELEVANCE_MIN_WORDS = 50;
export const UNSPACED_SCRIPT_RATIO = 0.3;
export const EVIDENCE_MAX_CHARS = 200;

export const THRESHOLDS = {
  title_min_chars: TITLE_MIN_CHARS,
  title_max_chars: TITLE_MAX_CHARS,
  meta_description_min_chars: META_DESCRIPTION_MIN_CHARS,
  meta_description_max_chars: META_DESCRIPTION_MAX_CHARS,
  url_max_chars: URL_MAX_CHARS,
  html_max_bytes: HTML_MAX_BYTES,
  thin_content_min_words: THIN_CONTENT_MIN_WORDS,
  dom_max_depth: DOM_MAX_DEPTH,
  dom_max_children: DOM_MAX_CHILDREN,
  title_relevance_min: TITLE_RELEVANCE_MIN,
  description_relevance_min: DESCRIPTION_RELEVANCE_MIN,
  relevance_min_words: RELEVANCE_MIN_WORDS,
  evidence_max_chars: EVIDENCE_MAX_CHARS,
} as const;

// --- Severity --------------------------------------------------------------

export const SEVERITY_ORDER = ['Critical', 'High', 'Medium', 'Low'] as const;
export type Severity = (typeof SEVERITY_ORDER)[number];

type Tone = 'attention' | 'review';
const SEVERITY_BY_TONE: Record<Tone, Severity> = { attention: 'High', review: 'Medium' };
const SEVERITY_OVERRIDES: Partial<Record<PageCheckId, Severity>> = {
  noindex: 'Critical',
  'noindex-header': 'Critical',
  'canonical-points-elsewhere': 'High',
  'multiple-h1': 'Low',
  'heading-level-skip': 'Low',
  'og-url-differs-from-canonical': 'Low',
  'missing-og-image': 'Low',
  'missing-doctype': 'Low',
  'deprecated-html-tags': 'Low',
  'generic-anchor-text': 'Low',
  'links-to-http': 'Low',
  'url-too-long': 'Low',
  'url-uppercase': 'Low',
  'url-underscores': 'Low',
  'url-non-ascii': 'Low',
  'url-double-slash': 'Low',
  'deep-dom': 'Low',
  'wide-dom-node': 'Low',
};

const HEURISTIC = 'This is a display heuristic, not a published search engine limit.';

export const PAGE_CHECKS = {
  'missing-title': ['attention', 'The page has no title tag. Search engines then build the result title from other text, such as the main heading.'],
  'title-too-long': ['review', `The title is longer than ${TITLE_MAX_CHARS} characters and may be truncated in results. ${HEURISTIC}`],
  'title-too-short': ['review', `The title is shorter than ${TITLE_MIN_CHARS} characters. A very short title rarely describes the page well enough to earn a click. This is a heuristic, not a search engine rule.`],
  'missing-meta-description': ['review', 'The page has no meta description. Search engines write their own snippet when none is given.'],
  'meta-description-too-long': ['review', `The meta description is longer than ${META_DESCRIPTION_MAX_CHARS} characters and may be truncated in results. ${HEURISTIC}`],
  'duplicate-meta-tags': ['review', 'The same title, meta tag or canonical appears more than once, so it is unclear which one search engines and social platforms read.'],
  'missing-h1': ['review', 'No H1 heading was found on the page.'],
  'multiple-h1': ['review', 'The page has more than one H1. Google says there is no ideal number of headings, so this does not affect Search on its own. Check that the most prominent heading names the page.'],
  'heading-level-skip': ['review', 'Heading levels skip inside the main content, for example from H2 to H4. Google Search does not mind heading order, but screen reader users move through a page by heading level.'],
  'missing-canonical': ['review', 'The page has no canonical link. Search engines then choose the preferred URL themselves.'],
  'canonical-points-elsewhere': ['review', 'The canonical names a different URL, so this page asks search engines to index that URL instead. Confirm this is intended.'],
  'og-url-differs-from-canonical': ['review', 'og:url differs from the canonical, so social shares may point at a different URL than search engines use.'],
  noindex: ['review', 'A robots meta tag asks search engines not to index this page. Confirm this is intended.'],
  'noindex-header': ['review', 'The X-Robots-Tag response header asks search engines not to index this page. Confirm this is intended.'],
  nofollow: ['review', 'The page asks search engines not to follow any of its links. Confirm this is intended.'],
  'meta-refresh-redirect': ['review', 'The page redirects with a meta refresh. Google follows it, but a server side 301 or 308 redirect is the more reliable choice.'],
  'hreflang-missing-self': ['review', 'The page has hreflang links but none of them points to the page itself. Hreflang sets should include a self reference.'],
  'missing-doctype': ['review', 'The document does not start with <!doctype html>, so browsers fall back to quirks mode.'],
  'missing-charset': ['review', 'No character encoding is declared for the document.'],
  'charset-mismatch': ['review', 'The Content-Type response header and the meta tag declare different character encodings.'],
  'missing-lang': ['review', 'The html element does not declare the page language with a lang attribute.'],
  'missing-viewport': ['review', 'The page has no viewport meta tag, so phones render it zoomed out.'],
  'uses-frames': ['attention', 'The page uses frames. Content inside frames is hard for search engines to attribute to this URL.'],
  'deprecated-html-tags': ['review', 'The page uses HTML tags that are obsolete, such as <center> or <font>.'],
  'placeholder-text': ['attention', 'Placeholder text such as lorem ipsum was found in the visible content.'],
  'images-missing-alt': ['review', 'Some images have no alt attribute. Screen readers and image search rely on alt text. An empty alt is correct for decorative images.'],
  'images-missing-dimensions': ['review', 'Some images have no width and height attributes, which lets the layout shift while they load.'],
  'first-image-lazy-loaded': ['review', 'The first image in the main content is lazy loaded. It is often the largest paint, and lazy loading delays it.'],
  'links-without-text': ['review', 'Some links have no accessible text: no link text, no label and no image alt text.'],
  'generic-anchor-text': ['review', 'Some links in the content use generic text such as "click here", which says nothing about where they lead.'],
  'links-to-http': ['review', 'This HTTPS page links to plain http:// addresses.'],
  'mixed-content': ['attention', 'This HTTPS page loads resources over plain HTTP. Browsers block or warn about these.'],
  'url-too-long': ['review', `The URL is longer than ${URL_MAX_CHARS} characters. Long URLs are harder to share and may be truncated in results. This is a heuristic, not a search engine limit.`],
  'url-has-parameters': ['review', 'The URL has query parameters other than tracking parameters. Parameters can create duplicate versions of the same page.'],
  'url-uppercase': ['review', 'The URL path has uppercase letters. URLs are case sensitive, so mixed case invites duplicates and broken links.'],
  'url-underscores': ['review', 'The URL path uses underscores. Hyphens are the usual word separator in URLs.'],
  'url-non-ascii': ['review', "The URL has unencoded non-ASCII characters. Words in the audience's language are fine in URLs; links should use the percent encoded form so the address survives copying."],
  'url-double-slash': ['review', 'The URL path has a double slash, which often creates accidental duplicate URLs.'],
  'html-over-2mb': ['attention', 'The HTML is larger than 2 MB. Googlebot reads only the first 2 MB of an HTML file, measured before compression, so content after that point is not considered for indexing.'],
  'deep-dom': ['review', `The DOM is nested more than ${DOM_MAX_DEPTH} levels deep, which slows rendering (Lighthouse guidance).`],
  'wide-dom-node': ['review', `One element has more than ${DOM_MAX_CHILDREN} direct children, which is slow to lay out (Lighthouse guidance).`],
  'missing-open-graph': ['review', 'The page has neither og:title nor og:image, so shared links show no title or preview image.'],
  'missing-og-image': ['review', 'The page has no og:image, so shared links show no preview image.'],
  'invalid-jsonld': ['review', 'A JSON-LD block is not valid JSON, so search engines cannot read any of it and the page loses the rich result that block was meant to support.'],
  'title-not-reflected-in-content': ['review', 'Most significant words of the title do not appear in the visible page text.'],
  'description-not-reflected-in-content': ['review', 'Most significant words of the meta description do not appear in the visible page text.'],
  'thin-content': ['review', `The page has fewer than ${THIN_CONTENT_MIN_WORDS} words of visible body text. Google has no minimum word count, so this is not a ranking rule. Check that the page fully answers what a visitor came for.`],
} as const satisfies Record<string, readonly [Tone, string]>;

export type PageCheckId = keyof typeof PAGE_CHECKS;
export const PAGE_CHECK_IDS = Object.keys(PAGE_CHECKS) as PageCheckId[];

export function severityFor(id: PageCheckId): Severity {
  return SEVERITY_OVERRIDES[id] ?? SEVERITY_BY_TONE[PAGE_CHECKS[id][0]];
}

// --- Vocabulary ------------------------------------------------------------

const STOPWORDS = new Set(
  `a about above after again against all also am an and any are as at be because been before being below between both
but by can could did do does doing down during each few for from further get got had has have having he her here hers
herself him himself his how i if in into is it its itself just let me more most my myself no nor not now of off on once
only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves
then there these they this those through to too under until up us very was we were what when where which while who whom
why will with would you your yours yourself yourselves new one two use using used like make made way may might must
need via per yet etc www http https com`.split(/\s+/),
);

const DEPRECATED_TAGS = ['acronym', 'applet', 'basefont', 'big', 'blink', 'center', 'dir', 'font', 'frame', 'frameset',
  'isindex', 'marquee', 'nobr', 'noframes', 'spacer', 'strike', 'tt'];
const GENERIC_ANCHORS = new Set(['click here', 'read more', 'learn more', 'here', 'more', 'link', 'this page',
  'details', 'view', 'website', 'continue', 'go']);
const GENERIC_ANCHOR_MAX_CHARS = 200;
const CHROME_TAGS = ['nav', 'header', 'footer', 'aside'];
const CHROME_ROLES = ['navigation', 'banner', 'contentinfo', 'complementary', 'menubar'];
const CHROME_MARKERS = ['navbar', 'topbar', 'top-bar', 'site-header', 'site-footer', 'main-nav', 'footer-nav',
  'mega-menu', 'breadcrumb', 'cookie-banner', 'sidebar-nav'];
const LAZY_SRC_ATTRS = ['data-perfmatters-src', 'data-ewww-src', 'data-src', 'data-lazy-src', 'data-original', 'data-full-url'];
const MIXED_CONTENT_TAGS = ['img', 'script', 'iframe', 'source', 'video', 'audio', 'embed'];
const SKIPPED_LINK_SCHEMES = ['#', 'javascript:', 'data:', 'mailto:', 'tel:', 'sms:'];
const ROBOTS_META_NAMES = ['robots', 'googlebot'];
const ROBOTS_VALUED_DIRECTIVES = ['max-snippet', 'max-image-preview', 'max-video-preview', 'unavailable_after'];
const ROBOTS_GENERAL_AGENTS = ['', 'googlebot'];
const ROBOTS_OTHER_AGENTS_MAX = 10;
const UTF8_ALIASES: Record<string, string> = { utf8: 'utf-8', 'utf-8': 'utf-8', 'unicode-1-1-utf-8': 'utf-8' };

// Python's \blorem ipsum\b|... with re.I. Each phrase starts and ends with
// one of Python's \w, so the \b before it is no \w just before
// (pySearchAfterNonWord) and the \b after it is no \w next (py.ts).
const PLACEHOLDER = new RegExp(`(?:${['lorem ipsum', 'dolor sit amet', 'consectetur adipiscing'].map(pyIgnoreCase).join('|')})(?!${PY_WORD})`, 'gu');
// Python's [^\W\d_][\w'-]*: a word character that isn't a digit or "_", then word characters, ' and -.
const WORD = new RegExp(`(?:(?!${PY_DIGIT}|_)${PY_WORD})${pyClass('alnum', "_'\\-")}*`, 'gu');
const TRACKING_PARAM = new RegExp(`^(${pyIgnoreCase('utm_')}|${pyIgnoreCase('fbclid')}${PY_END}|${pyIgnoreCase('gclid')}${PY_END}|${pyIgnoreCase('msclkid')}${PY_END}|${pyIgnoreCase('mc_')})`, 'u');
const SPACES = new RegExp(`${PY_SPACE}+`, 'g');
const CHARSET = new RegExp(`${pyIgnoreCase('charset')}${PY_SPACE}*=${PY_SPACE}*['"]?([^;,'"${PY_SPACE_CHARS}]+)`, 'u');
const LD_JSON = new RegExp(pyIgnoreCase('ld+json'), 'u');
const LEADING_COMMENTS = new RegExp(`^(?:<!--[^]*?-->${PY_SPACE}*)+`);
const CRAWLER_NAME = /^[a-z][a-z0-9_.-]*$/;
const CONTROL = /[\x00-\x1f\x7f-\x9f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g;
const UNSPACED_SCRIPT = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u0e00-\u0eff\u1000-\u109f\u1780-\u17ff]/g;
const UNSPACED_LANGS = ['zh', 'ja', 'th', 'lo', 'km', 'my'];

// --- Small helpers ---------------------------------------------------------

/** Length in characters as Python counts them (code points), not UTF-16 units. */
/** For the parity tests (regexes.test.ts): _PLACEHOLDER_RE.search's span, in code points. */
export function placeholderSpan(text: string): [number, number] | null {
  const match = pySearchAfterNonWord(PLACEHOLDER, text);
  if (!match) return null;
  const start = charLength(text.slice(0, match.index));
  return [start, start + charLength(match[0])];
}

export function charLength(text: string): number {
  let count = 0;
  for (const _ of text) count++;
  return count;
}

function chars(text: string): string[] {
  return Array.from(text);
}

/** One line of untrusted text: control characters out, cut to `limit` characters. */
export function trimEvidence(value: unknown, limit: number = EVIDENCE_MAX_CHARS): string {
  const text = pyStrip(String(value).replace(CONTROL, ' ').replace(SPACES, ' '));
  const list = chars(text);
  return list.length <= limit ? text : `${pyRstrip(list.slice(0, limit - 3).join(''))}...`;
}

function sample(values: readonly string[], each = 60): string {
  const shown = values.slice(0, 5).map((value) => trimEvidence(value, each)).join(', ');
  return shown + (values.length > 5 ? ` (+${values.length - 5} more)` : '');
}

function isGenericAnchor(anchor: string): boolean {
  const list = chars(anchor);
  if (list.length > GENERIC_ANCHOR_MAX_CHARS) return false;
  let start = 0;
  let end = list.length;
  while (start < end && !pyIsAlnum(list[start])) start++;
  while (end > start && !pyIsAlnum(list[end - 1])) end--;
  return GENERIC_ANCHORS.has(pyLower(list.slice(start, end).join('')));
}

export function tokenize(text: string): string[] {
  const normal = (text || '').replace(/\u2019/g, "'").replace(/\u2018/g, "'");
  const out: string[] = [];
  for (const match of normal.matchAll(WORD)) {
    if (pyStrip(match[0], "'-")) out.push(pyStrip(pyLower(match[0]), "'-"));
  }
  return out;
}

export function significantTerms(text: string): string[] {
  return tokenize(text).filter((term) => charLength(term) >= 3 && !STOPWORDS.has(term));
}

/** Whether a count of words split on spaces means anything for this text. */
export function wordsMeasurable(text: string, lang = ''): boolean {
  if (UNSPACED_LANGS.includes(pyLower(lang || '').split('-')[0])) return false;
  let letters = 0;
  for (const ch of text) if (pyIsAlpha(ch)) letters++;
  if (!letters) return true;
  const unspaced = text.match(UNSPACED_SCRIPT)?.length ?? 0;
  return unspaced / letters < UNSPACED_SCRIPT_RATIO;
}

function normCharset(value: string): string {
  const lower = pyLower(pyStrip(value || ''));
  return UTF8_ALIASES[lower] ?? lower;
}

function charsetOf(contentType: string): string {
  const match = CHARSET.exec(contentType || '');
  return match ? normCharset(match[1]) : '';
}

function partition(text: string, separator: string): [string, string, string] {
  const index = text.indexOf(separator);
  if (index < 0) return [pyStrip(text), '', ''];
  return [pyStrip(text.slice(0, index)), separator, pyStrip(text.slice(index + separator.length))];
}

/** (user agent, directive) pairs of one robots meta or X-Robots-Tag value. */
export function robotsRules(value: string): Array<[string, string]> {
  const rules: Array<[string, string]> = [];
  let agent = '';
  for (const part of pyLower(value || '').split(',')) {
    let [name, sep, rest] = partition(part, ':');
    if (sep && !ROBOTS_VALUED_DIRECTIVES.includes(name) && CRAWLER_NAME.test(name)) {
      agent = name;
      [name, sep, rest] = partition(rest, ':');
    }
    void rest;
    if (!sep) for (const word of pySplit(name)) rules.push([agent, word]);
  }
  return rules;
}

function robotsDirectives(value: string): Set<string> {
  return new Set(robotsRules(value).filter(([agent]) => ROBOTS_GENERAL_AGENTS.includes(agent)).map(([, directive]) => directive));
}

function rels(el: HtmlElement): string[] {
  return pySplit(pyLower(attr(el, 'rel')));
}

function isHttpUrl(url: string): boolean {
  const { scheme, host } = schemeAndHost(url);
  return (scheme === 'http' || scheme === 'https') && Boolean(host);
}

function documentBase(doc: HtmlElement, pageUrl: string): string {
  for (const base of findAll(doc, 'base')) {
    if (!hasAttr(base, 'href')) continue;
    const href = attr(base, 'href');
    const resolved = joinUrl(pageUrl, href);
    return href && isHttpUrl(resolved) ? resolved : pageUrl;
  }
  return pageUrl;
}

function isDecorative(img: HtmlElement): boolean {
  let node: HtmlElement | null = img;
  while (node) {
    if (pyLower(attr(node, 'aria-hidden')) === 'true') return true;
    const role = pyLower(attr(node, 'role'));
    if (role === 'presentation' || role === 'none') return true;
    node = node.parent;
  }
  return false;
}

function inChromeZone(el: HtmlElement): boolean {
  let node = el.parent;
  while (node) {
    if (CHROME_TAGS.includes(node.name) || CHROME_ROLES.includes(pyLower(attr(node, 'role')))) return true;
    const marker = pyLower(`${attr(node, 'class')} ${attr(node, 'id')}`);
    if (CHROME_MARKERS.some((token) => marker.includes(token))) return true;
    node = node.parent;
  }
  return false;
}

function imageSrc(img: HtmlElement): string {
  for (const name of [...LAZY_SRC_ATTRS, 'src']) {
    const value = attr(img, name);
    if (value && !value.startsWith('data:')) return value;
  }
  for (const name of ['data-srcset', 'srcset']) {
    for (const candidate of attr(img, name).split(',')) {
      const url = pyStrip(candidate).split(' ')[0];
      if (url && !url.startsWith('data:') && !url.startsWith('blob:')) return url;
    }
  }
  return '';
}

/** Body text without scripts, styles and site chrome (nav, footer, a site header). */
export function visibleText(doc: HtmlElement): string {
  const dropped = new Set(['head', 'script', 'style', 'noscript', 'nav', 'footer']);
  const kept = without(doc, (el) => dropped.has(el.name) || (el.name === 'header' && closest(el, ['article', 'main']) === null));
  return textOf(kept);
}

interface DomStats {
  nodes: number;
  max_depth: number;
  max_children: number;
  widest_element: string;
}

function domStats(doc: HtmlElement): DomStats {
  const root = find(doc, 'html') ?? doc;
  let nodes = 0;
  let maxDepth = 0;
  let maxChildren = 0;
  let widest = '';
  const stack: Array<[HtmlElement, number]> = [[root, 1]];
  while (stack.length) {
    const [el, depth] = stack.pop() as [HtmlElement, number];
    nodes++;
    maxDepth = Math.max(maxDepth, depth);
    const kids = childElements(el);
    if (kids.length > maxChildren) {
      maxChildren = kids.length;
      widest = el.name === '#document' ? '[document]' : el.name;
    }
    for (const kid of kids) stack.push([kid, depth + 1]);
  }
  return { nodes, max_depth: maxDepth, max_children: maxChildren, widest_element: widest };
}

function headingSkips(doc: HtmlElement): { h1: string[]; contentSkips: number; templateSkips: number } {
  const h1: string[] = [];
  let contentSkips = 0;
  let templateSkips = 0;
  const mainRoot = find(doc, 'main') ?? findBy(doc, (el) => el.attrs.role === 'main') ?? find(doc, 'article');
  let prevLevel: number | null = null;
  let prevTemplateLevel: number | null = null;
  for (const h of findAll(doc, ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])) {
    if (pyLower(attr(h, 'aria-hidden')) === 'true') continue;
    const text = textOf(h);
    if (!text) continue;
    const level = Number(h.name[1]);
    const inTemplate = closest(h, CHROME_TAGS) !== null;
    const inMain = mainRoot !== null && hasAncestor(h, mainRoot);
    if (mainRoot !== null && !inMain) {
      if (prevTemplateLevel !== null && level > prevTemplateLevel + 1) templateSkips++;
      prevTemplateLevel = level;
    } else {
      if (prevLevel !== null && level > prevLevel + 1) {
        if (inTemplate) templateSkips++;
        else contentSkips++;
      }
      prevLevel = level;
    }
    if (level === 1) h1.push(text);
  }
  return { h1, contentSkips, templateSkips };
}

function relevance(source: string, bodyTerms: Set<string>): [number | null, string[]] {
  const terms = new Set(significantTerms(source));
  if (!terms.size) return [null, []];
  const found = [...terms].filter((term) => bodyTerms.has(term)).length;
  const missing = pySorted([...terms].filter((term) => !bodyTerms.has(term)));
  return [pyRound(found / terms.size, 2), missing];
}

/** Python's "{:.0%}" for a share between 0 and 1. */
function percent(value: number): string {
  const scaled = value * 100;
  const floor = Math.floor(scaled);
  const fraction = scaled - floor;
  const rounded = fraction === 0.5 ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(scaled);
  return `${rounded}%`;
}

/** The parts of an address as Python's urlparse gives them, without normalising anything. */
function splitUrl(url: string): { path: string; query: string } {
  const match = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*([^?#]*)(?:\?([^#]*))?/.exec(url);
  if (!match) return { path: '', query: '' };
  const path = (match[1] ?? '').split(';')[0];
  return { path, query: match[2] ?? '' };
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

// --- The checks ------------------------------------------------------------

export interface PageFinding {
  id: PageCheckId;
  severity: Severity;
  message: string;
  evidence: string;
  count?: number;
}

export interface NotChecked {
  id: PageCheckId;
  reason: string;
}

export interface PageFacts {
  title: string;
  title_length: number;
  title_count: number;
  meta_description: string;
  meta_description_length: number;
  h1: string[];
  h1_count: number;
  heading_level_skips: number;
  template_heading_level_skips: number;
  canonical: string | null;
  canonical_status: 'missing' | 'self' | 'other';
  canonical_note: string | null;
  meta_robots: string | null;
  x_robots_tag: string | null;
  x_robots_other_agents: string[];
  hreflang_count: number;
  lang: string | null;
  has_doctype: boolean;
  meta_charset: string | null;
  header_charset: string | null;
  has_viewport: boolean;
  images: { total: number; missing_alt: number; empty_alt: number; missing_dimensions: number; first_image_lazy: boolean };
  links: { total: number; without_text: number; generic_anchor: number; http_on_https: number };
  mixed_content: number;
  url: { length: number; query_params: string[] };
  html_bytes: number;
  dom: DomStats;
  open_graph: Record<string, string>;
  jsonld_blocks: number;
  jsonld_invalid: number;
  word_count: number | null;
  words_measured: boolean;
  title_relevance: number | null;
  description_relevance: number | null;
}

export interface PageCheckResult {
  url: string;
  headersAvailable: boolean;
  facts: PageFacts;
  findings: PageFinding[];
  notChecked: NotChecked[];
  summary: Record<Severity, number> & { total: number; checksRun: number };
  /** Links on the page that point to http(s) addresses, resolved: what a site check follows. */
  links: string[];
}

export type HeaderMap = Record<string, string | readonly string[]>;

/**
 * Run every check on one document. `headers` is the answer's header map, or
 * null when they are not known (a file): the checks that need them are then
 * listed in `notChecked`. `htmlBytes` is the size as served; it defaults to
 * the UTF-8 size of `html`.
 */
export function runPageChecks(html: string, pageUrl: string, headers: HeaderMap | null = null, htmlBytes?: number): PageCheckResult {
  const headersAvailable = headers !== null;
  const hdrs: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    hdrs[pyLower(key)] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  const doc = parseHtml(html);
  const baseUrl = documentBase(doc, pageUrl);
  const isHttps = pyLower(pageUrl).startsWith('https://');
  const bytes = htmlBytes ?? utf8Length(html);

  const findings: PageFinding[] = [];
  const notChecked: NotChecked[] = [];
  const add = (id: PageCheckId, evidence: unknown, count?: number): void => {
    const item: PageFinding = { id, severity: severityFor(id), message: PAGE_CHECKS[id][1], evidence: trimEvidence(evidence) };
    if (count !== undefined) item.count = count;
    findings.push(item);
  };
  const skip = (id: PageCheckId, reason: string): void => {
    notChecked.push({ id, reason });
  };

  const htmlTag = find(doc, 'html');
  const lang = attr(htmlTag, 'lang');
  const visible = visibleText(doc);
  const wordCount = pySplit(visible).length;
  const measurable = wordsMeasurable(visible, lang);
  const unspaced = 'the page is written in a script without spaces between words, so words are not counted';

  // Title and meta description
  const titleTags = findAll(doc, 'title').filter((el) => closest(el, 'svg') === null);
  const title = titleTags.length ? textOf(titleTags[0]) : '';
  if (!title) {
    add('missing-title', titleTags.length ? 'the <title> element is empty' : 'no <title> element');
  } else {
    const length = charLength(title);
    if (length > TITLE_MAX_CHARS) add('title-too-long', `${length} characters: ${title}`);
    if (length < TITLE_MIN_CHARS) {
      if (wordsMeasurable(title, lang)) add('title-too-short', `${length} characters: ${title}`);
      else skip('title-too-short', unspaced);
    }
  }

  const metaTags: Array<[string, string, string]> = [];
  for (const meta of findAll(doc, 'meta')) {
    const content = attr(meta, 'content');
    if (content) metaTags.push([pyLower(attr(meta, 'name')), pyLower(attr(meta, 'property')), content]);
  }
  const description = metaTags.find(([name]) => name === 'description')?.[2] ?? '';
  if (!description) add('missing-meta-description', 'no <meta name="description"> with content');
  else if (charLength(description) > META_DESCRIPTION_MAX_CHARS) add('meta-description-too-long', `${charLength(description)} characters: ${description}`);

  const canonicalLinks = findAll(doc, 'link').filter((link) => rels(link).includes('canonical'));
  const duplicates: string[] = [];
  if (titleTags.length > 1) duplicates.push(`title x${titleTags.length}`);
  const groups: Array<[readonly string[], 0 | 1]> = [
    [['description', 'robots', 'viewport', 'title'], 0],
    [['og:title', 'og:description', 'og:url', 'og:image'], 1],
  ];
  for (const [wanted, index] of groups) {
    for (const key of wanted) {
      const n = metaTags.filter((tag) => tag[index] === key).length;
      if (n > 1) duplicates.push(`meta ${key} x${n}`);
    }
  }
  if (canonicalLinks.length > 1) duplicates.push(`canonical x${canonicalLinks.length}`);
  if (duplicates.length) add('duplicate-meta-tags', duplicates.join(', '), duplicates.length);

  // Headings
  const { h1, contentSkips, templateSkips } = headingSkips(doc);
  if (!h1.length) add('missing-h1', 'no H1 element with text');
  else if (h1.length > 1) add('multiple-h1', `${h1.length} H1 headings: ${sample(h1)}`, h1.length);
  if (contentSkips) add('heading-level-skip', `${contentSkips} skipped heading level(s) in the main content`, contentSkips);

  // Canonical, og:url
  const selfKey = urlMatchKey(pageUrl);
  let canonical = '';
  for (const link of canonicalLinks) {
    const href = attr(link, 'href');
    if (!href) continue;
    const joined = joinUrl(baseUrl, href);
    if (joined) {
      canonical = joined;
      break;
    }
  }
  let canonicalStatus: PageFacts['canonical_status'];
  let canonicalNote: string | null = null;
  if (!canonical) {
    canonicalStatus = 'missing';
    add('missing-canonical', 'no <link rel="canonical"> with an href');
  } else if (urlMatchKey(canonical) === selfKey) {
    canonicalStatus = 'self';
    if (canonical !== pageUrl && canonical.replace(/\/+$/, '') === pageUrl.replace(/\/+$/, '')) {
      canonicalNote = 'differs from the page URL only by a trailing slash, treated as self-referencing';
    }
  } else {
    canonicalStatus = 'other';
    add('canonical-points-elsewhere', `canonical ${trimEvidence(canonical, 60)} vs page ${trimEvidence(pageUrl, 60)} (a trailing slash difference alone is tolerated)`);
  }

  const og: Record<string, string> = {};
  for (const [name, prop, content] of metaTags) {
    const key = prop || name;
    if (key.startsWith('og:') && !(key in og)) og[key] = content;
  }
  const ogUrl = og['og:url'] ? joinUrl(baseUrl, og['og:url']) : '';
  if (ogUrl && canonical && urlMatchKey(ogUrl) !== urlMatchKey(canonical)) {
    add('og-url-differs-from-canonical', `og:url ${trimEvidence(ogUrl, 60)} vs canonical ${trimEvidence(canonical, 60)} (a trailing slash difference alone is tolerated)`);
  }

  // Robots, meta refresh, hreflang
  const robotsMetas = metaTags.filter(([name]) => ROBOTS_META_NAMES.includes(name)).map(([name, , content]) => [name, content] as const);
  const metaDirectives = new Set<string>();
  for (const [, content] of robotsMetas) for (const directive of robotsDirectives(content)) metaDirectives.add(directive);
  const metaRobots = robotsMetas.map(([name, content]) => `${name}: ${content}`).join('; ');
  const xRobotsValues: string[] = [];
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (pyLower(key) !== 'x-robots-tag') continue;
    if (Array.isArray(value)) xRobotsValues.push(...value.map(String));
    else xRobotsValues.push(String(value));
  }
  const xRobots = pyStrip(xRobotsValues.join(', '));
  const headerRules = xRobotsValues.flatMap((value) => robotsRules(value));
  const headerDirectives = new Set(headerRules.filter(([agent]) => ROBOTS_GENERAL_AGENTS.includes(agent)).map(([, directive]) => directive));
  const otherAgentRules = [...new Set(headerRules.filter(([agent]) => !ROBOTS_GENERAL_AGENTS.includes(agent)).map(([agent, directive]) => `${agent}: ${directive}`))];
  const hits = (set: Set<string>, ...words: string[]): boolean => words.some((word) => set.has(word));
  if (hits(metaDirectives, 'noindex', 'none')) add('noindex', `meta ${metaRobots}`);
  if (hits(headerDirectives, 'noindex', 'none')) add('noindex-header', `X-Robots-Tag: ${xRobots}`);
  else if (!headersAvailable) skip('noindex-header', 'no response headers were supplied');
  const nofollowSources: string[] = [];
  if (hits(metaDirectives, 'nofollow', 'none')) nofollowSources.push(`meta ${metaRobots}`);
  if (hits(headerDirectives, 'nofollow', 'none')) nofollowSources.push(`X-Robots-Tag: ${xRobots}`);
  if (nofollowSources.length) add('nofollow', nofollowSources.join('; '));

  const refresh = findAll(doc, 'meta').find((meta) => pyLower(attr(meta, 'http-equiv')) === 'refresh');
  const metaRefresh = refresh ? attr(refresh, 'content') : '';
  if (metaRefresh && pyLower(metaRefresh).includes('url=')) add('meta-refresh-redirect', `content="${metaRefresh}"`);

  const hreflang = findAll(doc, 'link')
    .filter((link) => rels(link).includes('alternate') && attr(link, 'hreflang') && attr(link, 'href'))
    .map((link) => [attr(link, 'hreflang'), joinUrl(baseUrl, attr(link, 'href'))] as const);
  if (hreflang.length && !hreflang.some(([, url]) => urlMatchKey(url) === selfKey)) {
    add('hreflang-missing-self', `${hreflang.length} hreflang link(s) (${sample(hreflang.map(([code]) => code), 12)}), none points to ${trimEvidence(pageUrl, 80)}`);
  }

  // Document basics
  // html.lstrip().lstrip("\ufeff").lstrip(), then the comments before anything else.
  const headText = pyLstrip(pyLstrip(pyLstrip(html), '\u{feff}')).replace(LEADING_COMMENTS, '');
  const hasDoctype = pyLower(chars(headText).slice(0, 15).join('')).startsWith('<!doctype html');
  if (!hasDoctype) add('missing-doctype', headText ? `document starts with: ${chars(headText).slice(0, 40).join('')}` : 'empty document');
  let metaCharset = '';
  for (const meta of findAll(doc, 'meta')) {
    if (attr(meta, 'charset')) {
      metaCharset = normCharset(attr(meta, 'charset'));
      break;
    }
    if (pyLower(attr(meta, 'http-equiv')) === 'content-type') {
      metaCharset = charsetOf(attr(meta, 'content'));
      if (metaCharset) break;
    }
  }
  const headerCharset = charsetOf(hdrs['content-type'] ?? '');
  if (!metaCharset && !headerCharset) {
    add('missing-charset', headersAvailable
      ? 'no meta charset and no charset in the Content-Type header'
      : 'no meta charset; response headers were not supplied, so the Content-Type header was not checked');
  }
  if (metaCharset && headerCharset && metaCharset !== headerCharset) add('charset-mismatch', `meta charset ${metaCharset}, Content-Type header charset ${headerCharset}`);
  else if (!headersAvailable) skip('charset-mismatch', 'no response headers were supplied');
  if (!lang) add('missing-lang', '<html> has no lang attribute');
  const hasViewport = findAll(doc, 'meta').some((meta) => pyLower(attr(meta, 'name')) === 'viewport');
  if (!hasViewport) add('missing-viewport', 'no <meta name="viewport">');
  const frames = findAll(doc, ['frameset', 'frame']);
  if (frames.length) add('uses-frames', `${frames.length} <frameset> or <frame> element(s)`, frames.length);
  const deprecated = pySorted(new Set(findAll(doc, DEPRECATED_TAGS).map((el) => el.name)));
  if (deprecated.length) add('deprecated-html-tags', deprecated.map((name) => `<${name}>`).join(', '), deprecated.length);
  const placeholder = pySearchAfterNonWord(PLACEHOLDER, visible);
  if (placeholder) {
    const startCp = charLength(visible.slice(0, placeholder.index));
    const endCp = startCp + charLength(placeholder[0]);
    add('placeholder-text', chars(visible).slice(Math.max(0, startCp - 40), endCp + 60).join(''));
  }

  // Images
  let imagesTotal = 0;
  let imagesEmptyAlt = 0;
  const missingAlt: string[] = [];
  const missingDimensions: string[] = [];
  for (const img of findAll(doc, 'img')) {
    if (pyLower(attr(img, 'aria-hidden')) === 'true') continue;
    const src = imageSrc(img);
    if (!src) continue;
    imagesTotal++;
    if (!hasAttr(img, 'alt')) {
      if (!isDecorative(img)) missingAlt.push(src);
    } else if (!attr(img, 'alt') && !isDecorative(img)) {
      imagesEmptyAlt++;
    }
    if (!attr(img, 'width') || !attr(img, 'height')) missingDimensions.push(src);
  }
  if (missingAlt.length) add('images-missing-alt', `${missingAlt.length} of ${imagesTotal} images: ${sample(missingAlt)}`, missingAlt.length);
  if (missingDimensions.length) add('images-missing-dimensions', `${missingDimensions.length} of ${imagesTotal} images: ${sample(missingDimensions)}`, missingDimensions.length);
  const scope = find(doc, 'main') ?? find(doc, 'body') ?? doc;
  const firstImg = find(scope, 'img');
  const firstImageLazy = firstImg !== null && pyLower(attr(firstImg, 'loading')) === 'lazy';
  if (firstImg && firstImageLazy) add('first-image-lazy-loaded', `loading="lazy" on ${imageSrc(firstImg) || 'the first <img>'}`);

  // Links
  let linksTotal = 0;
  const linksWithoutText: string[] = [];
  const genericAnchors: string[] = [];
  const insecureLinks: string[] = [];
  const followed: string[] = [];
  for (const a of findAll(doc, 'a').filter((el) => hasAttr(el, 'href'))) {
    const href = attr(a, 'href');
    const anchor = textOf(a);
    const named = Boolean(anchor || attr(a, 'aria-label') || attr(a, 'aria-labelledby') || attr(a, 'title')
      || findAll(a, 'img').some((img) => attr(img, 'alt'))
      || findAll(a, 'svg').some((svg) => find(svg, 'title') !== null));
    if (!named) linksWithoutText.push(href || '(empty href)');
    if (!href || SKIPPED_LINK_SCHEMES.some((scheme) => pyLower(href).startsWith(scheme))) continue;
    const full = joinUrl(baseUrl, href);
    if (!full) continue;
    const { scheme, host } = schemeAndHost(full);
    if ((scheme !== 'http' && scheme !== 'https') || !host) continue;
    linksTotal++;
    followed.push(full);
    if (isHttps && scheme === 'http') insecureLinks.push(full);
    if (isGenericAnchor(anchor) && !inChromeZone(a)) genericAnchors.push(`"${anchor}" to ${full}`);
  }
  if (linksWithoutText.length) add('links-without-text', `${linksWithoutText.length} link(s): ${sample(linksWithoutText)}`, linksWithoutText.length);
  if (genericAnchors.length) add('generic-anchor-text', `${genericAnchors.length} link(s): ${sample(genericAnchors)}`, genericAnchors.length);
  if (insecureLinks.length) add('links-to-http', `${insecureLinks.length} link(s): ${sample(insecureLinks)}`, insecureLinks.length);

  const mixed: string[] = [];
  if (isHttps) {
    for (const el of findAll(doc, MIXED_CONTENT_TAGS)) if (pyLower(attr(el, 'src')).startsWith('http://')) mixed.push(attr(el, 'src'));
    for (const link of findAll(doc, 'link').filter((el) => hasAttr(el, 'href'))) {
      const linkRels = rels(link);
      if ((linkRels.includes('stylesheet') || linkRels.includes('preload')) && pyLower(attr(link, 'href')).startsWith('http://')) mixed.push(attr(link, 'href'));
    }
  }
  if (mixed.length) add('mixed-content', `${mixed.length} resource(s): ${sample(mixed)}`, mixed.length);

  // URL hygiene
  const split = splitUrl(pageUrl);
  const path = split.path || '/';
  const params = split.query.split('&').filter(Boolean).map((pair) => pair.split('=', 1)[0]);
  const contentParams = params.filter((param) => !TRACKING_PARAM.test(param));
  if (charLength(pageUrl) > URL_MAX_CHARS) add('url-too-long', `${charLength(pageUrl)} characters: ${pageUrl}`);
  if (contentParams.length) add('url-has-parameters', `parameters: ${sample(contentParams, 30)} (tracking parameters are ignored)`, contentParams.length);
  const unescapedPath = path.replace(/%[0-9A-Fa-f]{2}/g, '');
  if (unescapedPath !== pyLower(unescapedPath)) add('url-uppercase', `path ${path}`);
  if (path.includes('_')) add('url-underscores', `path ${path}`);
  if ([...pageUrl].some((ch) => (ch.codePointAt(0) ?? 0) > 127)) add('url-non-ascii', pageUrl);
  if (path.includes('//')) add('url-double-slash', `path ${path}`);

  // Size
  if (bytes > HTML_MAX_BYTES) add('html-over-2mb', `${bytes} bytes of HTML`);
  const dom = domStats(doc);
  if (dom.max_depth > DOM_MAX_DEPTH) add('deep-dom', `${dom.max_depth} levels deep`);
  if (dom.max_children > DOM_MAX_CHILDREN) add('wide-dom-node', `<${dom.widest_element}> has ${dom.max_children} direct children`);

  // Social
  if (!og['og:title'] && !og['og:image']) add('missing-open-graph', 'no og:title and no og:image');
  else if (!og['og:image']) add('missing-og-image', 'og:title is present, og:image is not');

  // JSON-LD
  let jsonldBlocks = 0;
  const jsonldErrors: string[] = [];
  for (const script of findAll(doc, 'script').filter((el) => LD_JSON.test(el.attrs.type ?? ''))) {
    const raw = rawText(script);
    // Python's strip(): a block of only U+FEFF is still a block, and json.loads says why it fails.
    if (!raw || !pyStrip(raw)) continue;
    jsonldBlocks++;
    // Python's json.loads, which reads NaN and words its errors its own way (pyJson.ts).
    const problem = pythonJsonError(raw);
    if (problem !== null) jsonldErrors.push(`block ${jsonldBlocks}: ${problem}`);
  }
  if (jsonldErrors.length) add('invalid-jsonld', `${jsonldErrors.length} of ${jsonldBlocks} JSON-LD block(s): ${jsonldErrors.join('; ')}`, jsonldErrors.length);

  // Content
  const bodyTerms = new Set(significantTerms(visible));
  const [titleRelevance, titleMissing] = relevance(title, bodyTerms);
  const [descriptionRelevance, descriptionMissing] = relevance(description, bodyTerms);
  if (!measurable) {
    for (const id of ['thin-content', 'title-not-reflected-in-content', 'description-not-reflected-in-content'] as const) skip(id, unspaced);
  } else {
    if (wordCount < THIN_CONTENT_MIN_WORDS) add('thin-content', `${wordCount} words of visible body text`);
    if (wordCount >= RELEVANCE_MIN_WORDS) {
      if (titleRelevance !== null && titleRelevance < TITLE_RELEVANCE_MIN) {
        add('title-not-reflected-in-content', `${percent(titleRelevance)} of title terms found in the body; missing: ${titleMissing.join(', ')}`);
      }
      if (descriptionRelevance !== null && descriptionRelevance < DESCRIPTION_RELEVANCE_MIN) {
        add('description-not-reflected-in-content', `${percent(descriptionRelevance)} of description terms found in the body; missing: ${descriptionMissing.join(', ')}`);
      }
    }
  }

  const openGraph: Record<string, string> = {};
  for (const [key, value] of Object.entries(og).slice(0, 20)) openGraph[trimEvidence(key, 40)] = trimEvidence(value);
  const facts: PageFacts = {
    title: trimEvidence(title),
    title_length: charLength(title),
    title_count: titleTags.length,
    meta_description: trimEvidence(description),
    meta_description_length: charLength(description),
    h1: h1.slice(0, 10).map((text) => trimEvidence(text, 120)),
    h1_count: h1.length,
    heading_level_skips: contentSkips,
    template_heading_level_skips: templateSkips,
    canonical: trimEvidence(canonical) || null,
    canonical_status: canonicalStatus,
    canonical_note: canonicalNote,
    meta_robots: trimEvidence(metaRobots) || null,
    x_robots_tag: trimEvidence(xRobots) || null,
    x_robots_other_agents: otherAgentRules.slice(0, ROBOTS_OTHER_AGENTS_MAX).map((rule) => trimEvidence(rule, 100)),
    hreflang_count: hreflang.length,
    lang: trimEvidence(lang, 35) || null,
    has_doctype: hasDoctype,
    meta_charset: trimEvidence(metaCharset, 40) || null,
    header_charset: trimEvidence(headerCharset, 40) || null,
    has_viewport: hasViewport,
    images: { total: imagesTotal, missing_alt: missingAlt.length, empty_alt: imagesEmptyAlt, missing_dimensions: missingDimensions.length, first_image_lazy: firstImageLazy },
    links: { total: linksTotal, without_text: linksWithoutText.length, generic_anchor: genericAnchors.length, http_on_https: insecureLinks.length },
    mixed_content: mixed.length,
    url: { length: charLength(pageUrl), query_params: params.slice(0, 20).map((param) => trimEvidence(param, 40)) },
    html_bytes: bytes,
    dom,
    open_graph: openGraph,
    jsonld_blocks: jsonldBlocks,
    jsonld_invalid: jsonldErrors.length,
    word_count: measurable ? wordCount : null,
    words_measured: measurable,
    title_relevance: measurable ? titleRelevance : null,
    description_relevance: measurable ? descriptionRelevance : null,
  };
  findings.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  const summary = { Critical: 0, High: 0, Medium: 0, Low: 0, total: findings.length, checksRun: PAGE_CHECK_IDS.length - notChecked.length };
  for (const finding of findings) summary[finding.severity]++;
  return { url: pageUrl, headersAvailable, facts, findings, notChecked, summary, links: followed };
}

/** The comparison form of a page address, exported for the site crawl. */
export { canonicalizeUrl, urlMatchKey };

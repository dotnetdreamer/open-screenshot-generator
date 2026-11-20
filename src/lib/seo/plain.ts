// Every finding the SEO view can show, in everyday words: what's wrong, why
// it matters and what to do. The checks' own messages are written for SEO
// people; these are for someone who makes app screenshots. The checks'
// wording stays one click away ("Details"), and the AI gets both.

import { severityFor, type PageCheckId, type Severity } from './checks';
import type { CheckArea } from './types';

export interface PlainFinding {
  area: CheckArea;
  title: string;
  why: string;
  fix: string;
}

/** The page checks, by their id in checks/pageChecks.ts. */
const PAGE: Record<PageCheckId, PlainFinding> = {
  'missing-title': {
    area: 'onpage',
    title: 'This page has no title',
    why: "Google shows a page's title as the big blue link. Without one, Google makes one up from other words on the page.",
    fix: 'Add a title that names your app and what it does, like "Pebble Notes: notes that sync".',
  },
  'title-too-long': {
    area: 'onpage',
    title: "The title is long, so Google may cut it off",
    why: 'Google shows about 60 characters of a title. The rest turns into "..." in search results.',
    fix: "Keep the title under 60 characters, with your app's name and the most important words first.",
  },
  'title-too-short': {
    area: 'onpage',
    title: 'The title is very short',
    why: "A title under 30 characters rarely says enough to make someone click it.",
    fix: 'Add what the app does next to its name, like "Pebble Notes: quick notes that sync".',
  },
  'missing-meta-description': {
    area: 'onpage',
    title: 'This page has no description for Google',
    why: "Google shows a short description under the title. Without one, Google picks words from the page, and they may not sell your app.",
    fix: "Write one or two sentences, 120 to 160 characters, that say what the app does and who it's for.",
  },
  'meta-description-too-long': {
    area: 'onpage',
    title: "The description is long, so Google may cut it off",
    why: 'Google shows about 160 characters of a description.',
    fix: 'Keep the description under 160 characters, with the most important words first.',
  },
  'duplicate-meta-tags': {
    area: 'onpage',
    title: "Some of the page's settings appear twice",
    why: 'The page has the same title, description or canonical link more than once, so Google and chat apps may read the wrong one.',
    fix: 'Keep one of each. Details shows which ones are doubled.',
  },
  'missing-h1': {
    area: 'onpage',
    title: 'This page has no main heading',
    why: 'A main heading (H1) tells visitors and Google what the page is about.',
    fix: 'Add one heading at the top that names the page or your app.',
  },
  'multiple-h1': {
    area: 'onpage',
    title: 'This page has more than one main heading',
    why: "Google doesn't mind, but the first big heading should still say what the page is about.",
    fix: 'Check that the first main heading names the page.',
  },
  'heading-level-skip': {
    area: 'onpage',
    title: 'Headings skip a level',
    why: "People who use screen readers move through a page by its headings, and a jump from H2 to H4 is harder to follow. Google doesn't mind.",
    fix: 'Use heading levels in order: H1, then H2, then H3.',
  },
  'missing-canonical': {
    area: 'technical',
    title: "This page doesn't name its main address",
    why: 'A canonical link tells Google which address to show when one page can be opened in more than one way.',
    fix: "Add a canonical link to the page's own address.",
  },
  'canonical-points-elsewhere': {
    area: 'technical',
    title: 'This page asks Google to show a different page',
    why: 'The canonical link points to another address, so Google may leave this page out of search results.',
    fix: "If that's a mistake, point the canonical link at this page's own address.",
  },
  'og-url-differs-from-canonical': {
    area: 'onpage',
    title: 'Shared links point to another address',
    why: 'When someone shares this page in a chat app, the link uses a different address than Google does.',
    fix: "Make og:url the same as the page's canonical address.",
  },
  noindex: {
    area: 'technical',
    title: 'This page tells Google to leave it out',
    why: "A robots tag on the page asks search engines not to show it, so people can't find it on Google.",
    fix: 'Remove the noindex tag, unless you want this page hidden.',
  },
  'noindex-header': {
    area: 'technical',
    title: 'The server tells Google to leave this page out',
    why: 'The web server sends an X-Robots-Tag header that hides the page from search results.',
    fix: 'Ask whoever runs the server to remove the noindex header.',
  },
  nofollow: {
    area: 'technical',
    title: "Google is asked not to follow this page's links",
    why: "Search engines won't use this page's links to find your other pages.",
    fix: "Remove nofollow from the page's robots tag, unless you meant it.",
  },
  'meta-refresh-redirect': {
    area: 'technical',
    title: 'This page sends visitors on after a delay',
    why: 'The page jumps to another address with a timer. Google follows it, but a server redirect is more reliable.',
    fix: 'Use a permanent (301) redirect on the server instead.',
  },
  'hreflang-missing-self': {
    area: 'technical',
    title: 'The language links leave out this page',
    why: "A page in several languages should list every language, this one included, so Google shows each person the right one.",
    fix: 'Add this page to its own list of language links.',
  },
  'missing-doctype': {
    area: 'technical',
    title: "The page's code is missing its first line",
    why: "Without <!doctype html> at the top, browsers draw the page in an old mode and the layout can come out wrong.",
    fix: 'Add <!doctype html> as the very first line of the page.',
  },
  'missing-charset': {
    area: 'technical',
    title: "The page doesn't say how its text is stored",
    why: 'Browsers may show letters like é or ü as odd symbols.',
    fix: 'Add <meta charset="utf-8"> near the top of the page.',
  },
  'charset-mismatch': {
    area: 'technical',
    title: 'The page and the server disagree about the text',
    why: 'They name different text encodings, so browsers may show some letters as odd symbols.',
    fix: 'Use UTF-8 in the page and in the server settings.',
  },
  'missing-lang': {
    area: 'technical',
    title: "The page doesn't say its language",
    why: 'Google and screen readers use it to read the page right and to show it to the right people.',
    fix: 'Add the language to the page, like <html lang="en">.',
  },
  'missing-viewport': {
    area: 'technical',
    title: "The page isn't set up for phones",
    why: 'Without a viewport tag, phones show the page zoomed out with tiny text, and Google judges pages by how they work on a phone.',
    fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
  },
  'uses-frames': {
    area: 'technical',
    title: 'The page shows other pages in frames',
    why: "Google can't tell which address the words inside a frame belong to.",
    fix: 'Put the content on the page itself.',
  },
  'deprecated-html-tags': {
    area: 'technical',
    title: 'The page uses old HTML tags',
    why: 'Tags like <center> and <font> still show, but they are out of date and make the page harder to keep up.',
    fix: 'Replace them with CSS.',
  },
  'placeholder-text': {
    area: 'content',
    title: 'The page still has placeholder text',
    why: 'Lorem ipsum on a live page looks unfinished to visitors and to Google.',
    fix: 'Replace the placeholder with real words about your app.',
  },
  'images-missing-alt': {
    area: 'images',
    title: 'Some pictures have no description',
    why: 'Screen readers read the description out loud, and Google Images uses it to understand the picture.',
    fix: 'Describe each picture in a few words, like "The note list with three pinned notes".',
  },
  'images-missing-dimensions': {
    area: 'images',
    title: 'Some pictures have no size set',
    why: "The page jumps around while the pictures load, which annoys people and lowers Google's speed score.",
    fix: 'Set a width and a height on each picture.',
  },
  'first-image-lazy-loaded': {
    area: 'images',
    title: 'The first picture loads late',
    why: 'The first picture is often the biggest thing on screen, so loading it late makes the page feel slow.',
    fix: 'Remove loading="lazy" from the first picture.',
  },
  'links-without-text': {
    area: 'onpage',
    title: 'Some links have no words',
    why: "Screen readers and Google can't tell where a link with no words goes.",
    fix: 'Give each link a few words, or a label when the link is an icon.',
  },
  'generic-anchor-text': {
    area: 'onpage',
    title: 'Some links say "click here"',
    why: "Words like \"click here\" or \"read more\" don't say where the link goes.",
    fix: 'Use words that name the page, like "Read the support page".',
  },
  'links-to-http': {
    area: 'technical',
    title: 'Some links use old http:// addresses',
    why: 'Browsers may warn people before they open an insecure page.',
    fix: 'Change the links to https:// where the other site has it.',
  },
  'mixed-content': {
    area: 'technical',
    title: 'This secure page loads files over http://',
    why: "Browsers block or warn about insecure files on a secure page, so parts of the page may not show.",
    fix: 'Load every picture, script and style over https://.',
  },
  'url-too-long': {
    area: 'technical',
    title: 'The page address is long',
    why: 'Long addresses are harder to share and may be cut off in search results.',
    fix: 'Use a short address with a few plain words.',
  },
  'url-has-parameters': {
    area: 'technical',
    title: 'The page address has extra settings in it',
    why: 'An address with ?settings can make several copies of one page for Google.',
    fix: 'Use one clean address for the page, with a canonical link to it.',
  },
  'url-uppercase': {
    area: 'technical',
    title: 'The page address has capital letters',
    why: 'Addresses are case sensitive, so /Notes and /notes can count as two pages.',
    fix: 'Use small letters in addresses.',
  },
  'url-underscores': {
    area: 'technical',
    title: 'The page address uses underscores',
    why: 'Hyphens are the usual way to split the words of an address.',
    fix: 'Use hyphens, like /quick-notes instead of /quick_notes.',
  },
  'url-non-ascii': {
    area: 'technical',
    title: 'The page address has special letters',
    why: "Words in your own language are fine, but some apps break the address when people copy it.",
    fix: 'Make links to the page use the encoded form of the address.',
  },
  'url-double-slash': {
    area: 'technical',
    title: 'The page address has a double slash',
    why: 'An address like /notes//today often makes an extra copy of a page by mistake.',
    fix: 'Fix the address and the links that point to it.',
  },
  'html-over-2mb': {
    area: 'technical',
    title: "The page's code is very big",
    why: "Google reads only the first 2 MB of a page's code and ignores the rest.",
    fix: 'Move big code and data out of the page, or split it into several pages.',
  },
  'deep-dom': {
    area: 'technical',
    title: "The page's code is nested very deep",
    why: 'Deeply nested code takes browsers longer to draw.',
    fix: "Simplify the page's structure.",
  },
  'wide-dom-node': {
    area: 'technical',
    title: 'One part of the page holds a lot of items',
    why: 'More than 60 items side by side are slow for browsers to lay out.',
    fix: 'Split long lists into smaller groups or pages.',
  },
  'missing-open-graph': {
    area: 'onpage',
    title: 'Shared links show no title or picture',
    why: 'When someone shares the page in WhatsApp, Messages or X, the link shows up as plain text.',
    fix: "Add og:title and og:image tags with your app's name and a picture.",
  },
  'missing-og-image': {
    area: 'onpage',
    title: 'Shared links show no picture',
    why: 'Links with a picture get noticed more in chat and social apps.',
    fix: "Add an og:image tag with a screenshot or your app's icon.",
  },
  'invalid-jsonld': {
    area: 'schema',
    title: "Google can't read the app's details on this page",
    why: 'The structured data (JSON-LD) has a mistake in it, so Google ignores all of it.',
    fix: "Fix the mistake or remove the block. Google's Rich Results Test shows where it is.",
  },
  'title-not-reflected-in-content': {
    area: 'onpage',
    title: "The title's words aren't on the page",
    why: 'Google trusts a title more when the page talks about the same things.',
    fix: "Use the title's words in the page's text, or change the title to match the page.",
  },
  'description-not-reflected-in-content': {
    area: 'onpage',
    title: "The description's words aren't on the page",
    why: "Google may ignore a description that doesn't match the page and write its own.",
    fix: 'Make the description say what the page says.',
  },
  'thin-content': {
    area: 'content',
    title: 'This page has few words',
    why: "Google has no minimum, but a page with fewer than 200 words often doesn't answer what people came for.",
    fix: "Add what people want to know: what the app does, who it's for and what it costs.",
  },
};

/** Checks of the whole site that this app adds around the page checks. */
export const SITE_CHECKS = {
  'page-broken': { severity: 'High', area: 'technical', title: "This page doesn't open", why: 'Visitors and Google get an error instead of the page.', fix: 'Fix the page, or remove the links that point to it.' },
  'redirect-chain': { severity: 'Medium', area: 'technical', title: 'This page bounces through several addresses', why: 'Each extra hop slows the page down, and Google may stop following after a few.', fix: 'Link straight to the final address.' },
  'blocked-for-google': { severity: 'Critical', area: 'technical', title: "robots.txt keeps Google away from this page", why: "The site's robots.txt file tells Google not to read this page, so it won't show in search results.", fix: 'Allow the page in robots.txt, unless you want it hidden.' },
  'duplicate-title': { severity: 'Medium', area: 'onpage', title: 'Several pages have the same title', why: 'Google may show the wrong page, or leave some of them out.', fix: 'Give each page its own title.' },
  'duplicate-description': { severity: 'Medium', area: 'onpage', title: 'Several pages have the same description', why: 'Google may write its own descriptions when pages share one.', fix: 'Give each page its own description.' },
  'no-sitemap': { severity: 'Low', area: 'technical', title: 'The site has no sitemap', why: 'A sitemap lists your pages, so Google finds every one of them.', fix: 'Add a sitemap.xml file and name it in robots.txt.' },
  'sitemap-unreadable': { severity: 'Medium', area: 'technical', title: "The sitemap can't be read", why: "This check couldn't read it as a sitemap, and Google may not be able to either, so it may not help Google find your pages.", fix: "Fix the file Details names so it's a valid sitemap, then check again." },
  'no-robots-txt': { severity: 'Low', area: 'technical', title: 'The site has no robots.txt file', why: "That's allowed, and it leaves everything open to search engines. A robots.txt file can also tell Google where the sitemap is.", fix: 'Add a robots.txt file that names your sitemap.' },
  'robots-in-folder': { severity: 'Low', area: 'technical', title: "robots.txt is in your site's folder, where Google doesn't look", why: "Google reads robots.txt only at the root of the address, like name.github.io/robots.txt. A GitHub Pages project site can't put one there, so Google treats everything as open, which is fine.", fix: 'Nothing to do unless you need robots.txt rules. Send your sitemap to Google in Search Console instead, or use your own domain.' },
  'robots-server-error': { severity: 'Critical', area: 'technical', title: 'robots.txt answers with an error', why: 'When robots.txt gives a server error, Google treats the whole site as closed.', fix: 'Fix the server error for /robots.txt.' },
  'not-https': { severity: 'High', area: 'technical', title: "The site doesn't use https://", why: 'Browsers mark http:// sites as not secure, and Google prefers https://.', fix: 'Turn on HTTPS for the site. GitHub Pages has a switch for it in the repository settings.' },
  'ai-search-blocked': { severity: 'High', area: 'ai', title: "Some AI search tools can't read your site", why: "The site's robots.txt blocks crawlers that AI search tools use, so those tools can't show your site in their answers.", fix: "Allow those crawlers in robots.txt, unless you don't want to be in AI answers." },
  'no-llms-txt': { severity: 'Low', area: 'ai', title: 'The site has no llms.txt file', why: "llms.txt is a short guide to your site for AI tools. It's a proposal, not a rule, and Google doesn't use it.", fix: 'Ask AI to write one, then put it at the root of your site.' },
  'llms-txt-invalid': { severity: 'Medium', area: 'ai', title: "The site's llms.txt file has mistakes", why: "Lighthouse checks llms.txt and counts this one as failed.", fix: 'Fix the mistakes Details lists, or ask AI to write a new one.' },
  'not-server-rendered': { severity: 'High', area: 'ai', title: 'The home page is empty until JavaScript runs', why: "Many AI tools and some search engines don't run JavaScript, so they see a blank page.", fix: "Show the page's words in its HTML, without waiting for JavaScript." },
  'thin-without-javascript': { severity: 'Medium', area: 'ai', title: 'Little of the home page shows without JavaScript', why: "AI tools that don't run JavaScript see fewer than 150 words.", fix: "Put the main words in the page's HTML." },
  'templated-metadata': { severity: 'Medium', area: 'onpage', title: 'Titles and descriptions look machine-made', why: "Several descriptions repeat their page's title and end with the same sales line. Google treats copy made in bulk as low quality.", fix: 'Write each description by hand, or ask AI to rewrite them one at a time.' },
  'copy-filler': { severity: 'Medium', area: 'content', title: 'The words have a lot of filler', why: 'Phrases like "at the end of the day" or "when it comes to" take up space and say nothing.', fix: 'Cut the filler and say what the app does.' },
  'copy-ai-phrasing': { severity: 'Medium', area: 'content', title: 'The words sound machine-written', why: 'Phrases like "unlock the full potential" or "game-changer" are common in AI copy, and Google rates copy made in bulk with AI as low quality.', fix: 'Rewrite it in your own words, with real details about the app.' },
  'copy-repetitive': { severity: 'Low', area: 'content', title: 'The same phrases come up again and again', why: 'Repeating a phrase to rank for it reads badly, and Google notices.', fix: 'Say each thing once, in plain words.' },
  'copy-low-density': { severity: 'Low', area: 'content', title: 'The words have few facts', why: 'Pages with numbers, names and real details are more useful to people and to Google.', fix: "Add facts: the price, the devices, the languages, what's new." },
  'no-structured-data': { severity: 'Low', area: 'schema', title: "The home page has no app details for Google", why: "Structured data (JSON-LD) tells Google your app's name, price and devices.", fix: 'Add a MobileApplication block to the home page.' },
  'app-details-incomplete': { severity: 'Low', area: 'schema', title: "The app details for Google have no price or category", why: "Google shows an app result only with a price (0 for a free app) and a rating or a review, and it uses the app's category too.", fix: "Add offers with a price and an applicationCategory to the MobileApplication block. Add a rating only from your app's real ratings." },
} as const satisfies Record<string, PlainFinding & { severity: Severity }>;

export type SiteCheckId = keyof typeof SITE_CHECKS;

export function isPageCheckId(id: string): id is PageCheckId {
  return Object.prototype.hasOwnProperty.call(PAGE, id);
}

export function isSiteCheckId(id: string): id is SiteCheckId {
  return Object.prototype.hasOwnProperty.call(SITE_CHECKS, id);
}

/** The words for a finding. An id this app doesn't know (a newer copy of the checks) gets plain fallback words. */
export function plainFinding(id: string): PlainFinding {
  if (isPageCheckId(id)) return PAGE[id];
  if (isSiteCheckId(id)) return SITE_CHECKS[id];
  return { area: 'technical', title: 'Something on the page needs a look', why: 'Details has what the check found.', fix: 'Ask AI what this means for your site.' };
}

export function severityOf(id: string): Severity {
  if (isPageCheckId(id)) return severityFor(id);
  if (isSiteCheckId(id)) return SITE_CHECKS[id].severity;
  return 'Medium';
}

/** What each severity asks of the user, for badges and group headings. */
export const SEVERITY_WORDS: Record<Severity, string> = {
  Critical: 'Fix now',
  High: 'Important',
  Medium: 'Worth fixing',
  Low: 'Nice to have',
};

export const AREA_WORDS: Record<CheckArea, { title: string; hint: string }> = {
  technical: { title: 'Basics', hint: 'Whether Google can open, read and trust each page' },
  content: { title: 'Words', hint: 'Whether the pages say enough, in words a person wrote' },
  onpage: { title: 'Titles and links', hint: 'What people see in Google and in shared links' },
  schema: { title: 'App details', hint: "The facts about your app that Google reads from the page's code" },
  speed: { title: 'Speed', hint: "How fast the page loads on a phone, from Google's PageSpeed" },
  ai: { title: 'AI search', hint: 'Whether ChatGPT, Claude, Perplexity and Google AI can read the site' },
  images: { title: 'Pictures', hint: 'Descriptions and sizes of the pictures' },
};

/** The order areas show in. */
export const AREAS: CheckArea[] = ['technical', 'onpage', 'content', 'images', 'schema', 'ai', 'speed'];

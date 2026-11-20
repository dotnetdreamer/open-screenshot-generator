// The site check against thousands of made-up websites. Every address a
// check could ask for gets an answer chosen at random: the file, a 404, a
// 410, a refusal, a server error, a rate limit, a page served in a file's
// place, a request a browser can't read, a timeout, or a redirect inside the
// site, out of it or to another host. The check runs on each as the desktop
// app and as a browser, and what it says is held against the made-up site
// itself, not against how run.ts works:
//
// - "no sitemap", "no robots.txt" and "no llms.txt" only when every place the
//   file could be answered for sure;
// - no page is counted that isn't the site's own, or counted twice;
// - every address a browser couldn't read is listed as unread, and nothing else;
// - and the other way: a sitemap that is plainly there is found, and a site
//   with nothing anywhere gets its "no sitemap".
//
// Each sitemap is made from a model (the pages it lists, an index of
// sitemaps, a broken file, or a web page in its place) and served in one of
// the forms claude-seo reads: a default namespace, a prefix, none, upper
// case, CDATA, comments, gzip, a text file, an RSS or Atom feed. What the
// check says is held against the model, never against a reading of the file.
//
//   WORLDS=5000 node scripts/test-unit.mjs seoCrawl

import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { checkLiveSite } from '@/lib/seo/run';
import { urlMatchKey } from '@/lib/seo/checks';
import type { Transport } from '@/lib/seo/fetch';
import type { SiteRun } from '@/lib/seo/types';

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = Math.imul(state ^ (state >>> 15), 1 | state);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** What a sitemap is, whatever form it's served in. */
type SitemapModel = { form: 'urlset' | 'index' | 'broken' | 'page'; locs: string[] };
type Answer = { status: number; body: string | Uint8Array; type: string; model?: SitemapModel };
type Route = Answer | { redirect: string } | { blocked: true } | { timeout: true };

interface World {
  site: string;
  origin: string;
  folder: string;
  route(url: string): Route;
}

/** A made-up website: its shape, and an answer for every address, the same each time it's asked. */
function makeWorld(seed: number, browser: boolean): World {
  const random = seeded(seed);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)];
  const shape = pick([
    { host: 'pebble.example', path: '/' },
    { host: 'www.pebble.example', path: '/' },
    { host: 'name.github.io', path: '/pebble/' },
    { host: 'pebble.example', path: '/app/' },
  ] as const);
  const origin = `https://${shape.host}`;
  const folder = `${origin}${shape.path}`;
  const apex = shape.host.startsWith('www.') ? `https://${shape.host.slice(4)}` : null;
  // The site's pages, a sibling site's on the same host, and another host's.
  const pagesOf = (base: string) => [base, `${base}a/`, `${base}b/`, `${base}c/`, `${base}a`, `${base}index.html`];
  const pagePool = [...pagesOf(folder), ...(apex ? pagesOf(`${apex}/`) : []), `${origin}/other/x/`, `${origin}/other/y/`, 'https://elsewhere.example/p/'];
  const sitemapPool = [
    `${folder}sitemap.xml`,
    `${origin}/sitemap.xml`,
    `${folder}sitemap-1.xml`,
    `${folder}sitemap-2.xml`,
    `${origin}/sitemaps/main.xml`,
    `${origin}/other/sitemap.xml`,
    'https://elsewhere.example/sitemap.xml',
  ];
  const routes = new Map<string, Route>();
  // The www form of a site a browser can't follow, with the bare domain readable: half the www sites.
  const wwwBlocked = apex !== null && browser && random() < 0.5;

  const make = (url: string): Route => {
    const r = seeded(seed ^ hash(url));
    const choose = <T,>(list: readonly T[]) => list[Math.floor(r() * list.length)];
    const path = new URL(url).pathname;
    const kind = path.endsWith('/robots.txt') ? 'robots' : path.endsWith('/llms.txt') ? 'llms' : /sitemap[^/]*\.xml$/.test(path) || path.endsWith('/main.xml') ? 'sitemap' : 'page';
    if (url === folder) return wwwBlocked ? { blocked: true } : { status: 200, body: page(r, choose), type: 'text/html' };
    if (apex && url === `${apex}/`) return { status: 200, body: page(r, choose), type: 'text/html' };
    const roll = r();
    if (roll < 0.12) return { status: 404, body: 'Not found', type: 'text/html' };
    if (roll < 0.16) return { status: 410, body: 'Gone', type: 'text/html' };
    if (roll < 0.2) return { status: choose([401, 403]), body: 'No', type: 'text/html' };
    if (roll < 0.25) return { status: choose([500, 502, 503]), body: 'Error', type: 'text/html' };
    if (roll < 0.27) return { status: 429, body: 'Slow down', type: 'text/html' };
    if (roll < 0.33) return { status: 200, body: '<!doctype html><html><body>Page not found</body></html>', type: 'text/html', ...(kind === 'sitemap' ? { model: { form: 'page' as const, locs: [] } } : {}) };
    if (roll < 0.43) return { blocked: true };
    if (roll < 0.46) return { timeout: true };
    if (roll < 0.56) {
      // A redirect: inside the site, out of its folder, or to another host.
      const pool = kind === 'sitemap' ? sitemapPool : kind === 'page' ? pagePool : [`${folder}${kind}.txt`, `${origin}/${kind}.txt`, `https://elsewhere.example/${kind}.txt`];
      const target = choose(pool);
      if (target !== url) return { redirect: target };
    }
    if (kind === 'robots') {
      const lines = ['User-agent: *', choose(['Disallow:', 'Disallow: /private/', 'Allow: /'])];
      const named = Math.floor(r() * 6);
      for (let i = 0; i < named; i++) lines.push(`Sitemap: ${choose(sitemapPool)}`);
      return { status: 200, body: `${lines.join('\n')}\n`, type: 'text/plain' };
    }
    if (kind === 'llms') return { status: 200, body: '# Pebble\n\n> Notes for your phone.\n\n## Pages\n\n- [Home](https://pebble.example/): the app\n', type: 'text/plain' };
    if (kind === 'sitemap') {
      const roll2 = r();
      if (roll2 < 0.1) return { ...broken(r, choose), model: { form: 'broken', locs: [] } };
      if (roll2 < 0.35) {
        const children = Array.from({ length: 1 + Math.floor(r() * 5) }, () => choose(sitemapPool)).filter((child) => child !== url);
        return { status: 200, ...serialise({ form: 'index', locs: children }, r, choose), model: { form: 'index', locs: children } };
      }
      const locs = Array.from({ length: Math.floor(r() * 6) }, () => choose(pagePool));
      return { status: 200, ...serialise({ form: 'urlset', locs }, r, choose), model: { form: 'urlset', locs } };
    }
    return { status: 200, body: page(r, choose), type: 'text/html' };
  };
  /** A sitemap's model, served in one of the forms claude-seo reads. */
  const serialise = (model: SitemapModel, r: () => number, choose: <T>(list: readonly T[]) => T): { body: string | Uint8Array; type: string } => {
    const SM = 'http://www.sitemaps.org/schemas/sitemap/0.9';
    const esc = (loc: string) => loc.replace(/&/g, '&amp;');
    const index = model.form === 'index';
    const styles = index ? ['default', 'prefix', 'none', 'gzip'] : ['default', 'prefix', 'none', 'upper', 'cdata', 'comments', 'gzip', ...(model.locs.length ? ['text'] : []), 'rss', 'atom'];
    const style = choose(styles);
    const [root, entry] = index ? ['sitemapindex', 'sitemap'] : ['urlset', 'url'];
    const xml = (p: string, decl: string, loc: (l: string) => string) => `<?xml version="1.0" encoding="UTF-8"?><${p}${root}${decl}>${model.locs.map((l) => `<${p}${entry}><${p}loc>${loc(l)}</${p}loc></${p}${entry}>`).join('\n')}</${p}${root}>`;
    if (style === 'prefix') return { body: xml('sm:', ` xmlns:sm="${SM}"`, esc), type: 'application/xml' };
    if (style === 'none') return { body: xml('', '', esc), type: choose(['application/xml', 'text/xml']) };
    if (style === 'upper') return { body: `<URLSET>${model.locs.map((l) => `<URL><LOC>${esc(l)}</LOC></URL>`).join('')}</URLSET>`, type: 'application/xml' };
    if (style === 'cdata') return { body: xml('', ` xmlns="${SM}"`, (l) => `<![CDATA[${l}]]>`), type: 'application/xml' };
    if (style === 'comments') return { body: `<!-- made by a plugin -->\n${xml('', ` xmlns="${SM}"`, esc).replace('<?xml version="1.0" encoding="UTF-8"?>', '')}\n<!-- end -->`, type: 'application/xml' };
    if (style === 'gzip') return { body: new Uint8Array(zlib.gzipSync(xml('', ` xmlns="${SM}"`, esc))), type: choose(['application/gzip', 'application/x-gzip', 'application/octet-stream']) };
    if (style === 'text') return { body: `${model.locs.join(choose(['\n', '\r\n']))}\n`, type: 'text/plain' };
    if (style === 'rss') return { body: `<rss version="2.0"><channel><title>Pebble</title>${model.locs.map((l) => `<item><title>t</title><link>${esc(l)}</link></item>`).join('')}</channel></rss>`, type: 'application/rss+xml' };
    if (style === 'atom') return { body: `<feed xmlns="http://www.w3.org/2005/Atom"><title>Pebble</title>${model.locs.map((l) => `<entry><link href="${esc(l)}"/><updated>2026-01-01</updated></entry>`).join('')}</feed>`, type: 'application/atom+xml' };
    return { body: xml('', ` xmlns="${SM}"`, esc), type: 'application/xml' };
  };
  /** A sitemap claude-seo can't read: broken XML, an undeclared prefix, JSON, nothing, a broken gzip. */
  const broken = (r: () => number, choose: <T>(list: readonly T[]) => T): Answer => {
    const loc = choose(pagePool);
    return choose([
      { status: 200, body: `<urlset><url><loc>${loc}</loc></url>`, type: 'application/xml' },
      { status: 200, body: `<sm:urlset><sm:url><sm:loc>${loc}</sm:loc></sm:url></sm:urlset>`, type: 'application/xml' },
      { status: 200, body: `{"urls": ["${loc}"]}`, type: 'application/json' },
      { status: 200, body: '', type: 'application/xml' },
      { status: 200, body: `<urlset><url><loc>${loc}&nbsp;</loc></url></urlset>`, type: 'text/xml' },
      { status: 200, body: new Uint8Array(zlib.gzipSync(`<urlset><url><loc>${loc}</loc></url></urlset>`)).subarray(0, 20), type: 'application/gzip' },
    ] as Answer[]);
  };
  const page = (r: () => number, choose: <T>(list: readonly T[]) => T) => {
    const links = Array.from({ length: Math.floor(r() * 6) }, () => choose(pagePool));
    const title = choose(['Pebble', 'Pebble notes', 'Pebble support', 'Pebble privacy']);
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><meta name="description" content="Notes for your phone, kept in sync."></head><body><h1>${title}</h1>${links.map((link) => `<a href="${link}">${link}</a>`).join(' ')}<p>Pebble keeps your notes.</p></body></html>`;
  };
  return {
    site: folder,
    origin,
    folder,
    route(url) {
      if (!routes.has(url)) routes.set(url, make(url));
      return routes.get(url)!;
    },
  };
}

/** Where an address ends, as the made-up site answers it: an answer, or nothing known. */
function resolve(world: World, url: string): (Answer & { finalUrl: string }) | null {
  let current = url;
  for (let hop = 0; hop <= 5; hop++) {
    const route = world.route(current);
    if ('blocked' in route || 'timeout' in route) return null;
    if ('redirect' in route) {
      current = new URL(route.redirect, current).href;
      continue;
    }
    return { ...route, finalUrl: current };
  }
  return null;
}

function transportFor(world: World, browser: boolean): Transport & { asked: string[]; blocked: Set<string> } {
  const asked: string[] = [];
  const blocked = new Set<string>();
  const respond = (answer: Answer | { status: number; location: string }, url: string, redirected: boolean): Response => {
    const body = 'body' in answer ? answer.body : '';
    const headers = new Headers('location' in answer ? { location: answer.location } : { 'content-type': answer.type });
    const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
    return { status: answer.status, headers, url, redirected, arrayBuffer: async () => bytes.slice().buffer } as unknown as Response;
  };
  return {
    asked,
    blocked,
    manualRedirects: !browser,
    async send(url) {
      asked.push(url);
      let current = url;
      for (let hop = 0; hop < 20; hop++) {
        const route = world.route(current);
        if ('timeout' in route) throw new DOMException('The operation was aborted', 'AbortError');
        if ('blocked' in route) {
          blocked.add(url);
          throw new TypeError('Failed to fetch');
        }
        if ('redirect' in route) {
          const next = new URL(route.redirect, current).href;
          // The desktop app takes one hop at a time; a browser follows them all and says where it ended.
          if (!browser) return respond({ status: 301, location: next }, current, false);
          current = next;
          continue;
        }
        return respond(route, current, current !== url);
      }
      // A redirect loop: a browser fails it like any request it can't finish.
      blocked.add(url);
      throw new TypeError('Failed to fetch');
    },
  };
}

const inFolder = (url: string, folder: string) => {
  try {
    const page = new URL(url);
    const base = new URL(folder);
    return page.host === base.host && page.pathname.startsWith(base.pathname);
  } catch {
    return false;
  }
};

/**
 * What the made-up site says about a sitemap address, from its model: no
 * sitemap of the site there, one there, a file that can't be read as one
 * (or a web page where robots.txt or an index points), or nothing known.
 */
function sitemapAt(world: World, url: string, folder: string, pointedAt: boolean, inIndex = false): 'none' | 'ours' | 'unknown' | 'unreadable' {
  const answer = resolve(world, url);
  if (!answer) return 'unknown';
  if (answer.status === 404 || answer.status === 410) return 'none';
  if (answer.status < 200 || answer.status >= 300) return 'unknown';
  // An address that ends at a page has no sitemap model: it's a web page.
  const model = answer.model ?? { form: 'page' as const, locs: [] };
  if (model.form === 'page') return pointedAt ? 'unreadable' : 'none';
  if (model.form === 'broken') return 'unreadable';
  if (model.form === 'index') {
    // Google reads no index inside an index.
    if (inIndex) return 'none';
    const children = model.locs.map((child) => sitemapAt(world, child, folder, true, true));
    // A child not read may be the site's sitemap: unknown before broken, as for the places themselves.
    return children.includes('ours') ? 'ours' : children.includes('unknown') ? 'unknown' : children.includes('unreadable') ? 'unreadable' : 'none';
  }
  return model.locs.some((loc) => inFolder(loc, folder)) ? 'ours' : 'none';
}

function checkClaims(world: World, run: SiteRun, transport: ReturnType<typeof transportFor>, browser: boolean): string[] {
  const wrong: string[] = [];
  const folder = run.root;
  const origin = new URL(folder).origin;
  const ids = new Set(run.findings.map((finding) => finding.id));
  const robots = resolve(world, `${origin}/robots.txt`);
  const robotsGone = robots !== null && (robots.status === 404 || robots.status === 410);
  const robotsBody = robots ? String(robots.body) : '';
  const robotsFile = robots !== null && robots.status >= 200 && robots.status < 300 && !/^\s*</.test(robotsBody);
  const robotsSoft = robots !== null && robots.status >= 200 && robots.status < 300 && !robotsFile;
  const named = robotsFile ? [...robotsBody.matchAll(/^Sitemap: (\S+)$/gm)].map((match) => match[1]) : [];

  // The sitemap: "none" needs robots.txt known and every place answered for sure, none of them a file that can't be read.
  const placeUrls = [...named, `${folder}sitemap.xml`, `${origin}/sitemap.xml`];
  const places = placeUrls.map((url) => sitemapAt(world, url, folder, named.includes(url)));
  const known = (robotsGone || robotsFile || robotsSoft) && !places.includes('unknown');
  if (ids.has('no-sitemap') && (!known || places.includes('ours') || places.includes('unreadable'))) wrong.push(`"no sitemap" without every place answered for sure (${places.join(', ')}, robots ${robots?.status ?? 'unread'})`);
  if (ids.has('no-sitemap') && run.sitemap.url) wrong.push('"no sitemap" with a sitemap found');
  // "Can't be read" only where a file in a sitemap's place is one, and none of the site's was found.
  if (ids.has('sitemap-unreadable') && (!known || !places.includes('unreadable') || places.includes('ours'))) wrong.push(`"the sitemap can't be read" without every place answered, one of them unreadable and none the site's (${places.join(', ')})`);
  if (ids.has('sitemap-unreadable') && run.sitemap.url) wrong.push('"the sitemap can\'t be read" with a sitemap found');
  if (ids.has('sitemap-unreadable') && ids.has('no-sitemap')) wrong.push('both "no sitemap" and "the sitemap can\'t be read"');
  // The other way: the folder's own sitemap.xml, read where it is, is found in any form, or said to be broken.
  const plain = resolve(world, `${folder}sitemap.xml`);
  const direct = plain && plain.finalUrl === `${folder}sitemap.xml` && plain.status === 200 ? plain.model : undefined;
  if (direct?.form === 'urlset' && direct.locs.some((loc) => inFolder(loc, folder)) && !run.sitemap.url) {
    wrong.push("a sitemap in the site's folder, listing its pages, wasn't found");
  }
  const wholeIndexes = placeUrls.map((url) => resolve(world, url)).every((answer) => answer?.model?.form !== 'index' || new Set(answer.model.locs).size <= 3);
  if (direct?.form === 'broken' && known && named.length <= 3 && wholeIndexes && !places.includes('ours') && !ids.has('sitemap-unreadable')) {
    wrong.push("a broken sitemap.xml in the site's folder wasn't said to be broken");
  }
  // And the other way, where nothing stands in the way of knowing.
  const fewEnough = named.length <= 3;
  if (known && fewEnough && !places.includes('ours') && !places.includes('unreadable') && !ids.has('no-sitemap')) {
    // An index read in part may hide the site's pages: only an index with three children or fewer is read whole.
    const indexes = placeUrls.map((url) => resolve(world, url)).filter((answer) => answer?.model?.form === 'index');
    const whole = indexes.every((answer) => new Set(answer!.model!.locs).size <= 3);
    if (whole) wrong.push(`no "no sitemap" for a site where every place answered there's none (${places.join(', ')})`);
  }

  // robots.txt.
  if (ids.has('no-robots-txt') || ids.has('robots-in-folder')) {
    if (!robotsGone) wrong.push(`a robots.txt finding with robots.txt answering ${robots?.status ?? 'nothing readable'}`);
    if (folder !== `${origin}/`) {
      const inside = resolve(world, `${folder}robots.txt`);
      const insideFile = inside !== null && inside.status >= 200 && inside.status < 300 && !/^\s*</.test(String(inside.body));
      const insideKnown = inside !== null && (insideFile || inside.status === 404 || inside.status === 410 || (inside.status >= 200 && inside.status < 300));
      if (!insideKnown) wrong.push("a robots.txt finding while the folder's robots.txt couldn't be read");
      if (ids.has('robots-in-folder') && !insideFile) wrong.push('"robots.txt is in your folder" without one there');
      if (ids.has('no-robots-txt') && insideFile) wrong.push('"no robots.txt" with one in the folder');
    }
  }

  // llms.txt: missing only when the root and the folder both said so.
  if (ids.has('no-llms-txt')) {
    const states = [`${origin}/llms.txt`, ...(folder !== `${origin}/` ? [`${folder}llms.txt`] : [])].map((url) => resolve(world, url));
    if (!states.every((answer) => answer !== null && (answer.status === 404 || answer.status === 410))) {
      wrong.push(`"no llms.txt" with ${states.map((answer) => answer?.status ?? 'unread').join(' and ')}`);
    }
  }

  // Pages: only the site's own, each once, each as the made-up site answers it.
  const keys = new Set<string>();
  for (const page of run.pages) {
    const key = urlMatchKey(page.finalUrl);
    if (keys.has(key)) wrong.push(`${page.finalUrl} counted twice`);
    keys.add(key);
    if (!page.checks) continue;
    if (!inFolder(page.finalUrl, folder)) wrong.push(`another site's page read as this one's: ${page.finalUrl}`);
    const answer = resolve(world, page.url);
    if (!answer || answer.finalUrl !== page.finalUrl || answer.status >= 400) wrong.push(`${page.url} read, though it answers ${answer ? `${answer.status} at ${answer.finalUrl}` : 'nothing readable'}`);
  }
  for (const finding of run.findings) {
    for (const where of finding.pages) {
      if (where.url && !inFolder(where.url, folder)) wrong.push(`${finding.id} on another site's page ${where.url}`);
    }
  }

  // Unread: in a browser, exactly the addresses it couldn't read.
  const unread = new Set(run.unread ?? []);
  if (!browser && unread.size) wrong.push('the desktop app listed unread addresses');
  if (browser) {
    for (const url of unread) if (!transport.blocked.has(url)) wrong.push(`${url} listed as unread, though it was read`);
    for (const url of transport.blocked) {
      if (!unread.has(url) && url !== world.site) wrong.push(`${url} couldn't be read and isn't listed`);
    }
  }
  if (run.score.overall < 0 || run.score.overall > 100) wrong.push(`score ${run.score.overall}`);
  return wrong;
}

test('the site check, on made-up websites: nothing it says goes beyond what the site answered', async () => {
  const WORLDS = Number(process.env.WORLDS ?? 1500);
  const problems: string[] = [];
  const stats: Record<string, number> = {};
  let checked = 0;
  // CRAWL_WORLD=<seed> runs that one world and shows what each sitemap place answered.
  const only = process.env.CRAWL_WORLD ? Number(process.env.CRAWL_WORLD) - 5000 : null;
  for (let n = only ?? 0; n < (only === null ? WORLDS : only + 1); n++) {
    for (const browser of [true, false]) {
      const world = makeWorld(5000 + n, browser);
      const transport = transportFor(world, browser);
      let run: SiteRun;
      try {
        run = await checkLiveSite({ id: 'url:w', url: world.site, name: 'Pebble', source: 'address', addedAt: 0 }, { transport, pauseMs: 0 });
      } catch (error) {
        problems.push(`world ${5000 + n} (${browser ? 'browser' : 'desktop'}): the check failed: ${(error as Error).message}`);
        continue;
      }
      checked += 1;
      if (only !== null) {
        const origin = new URL(run.root).origin;
        const robots = resolve(world, `${origin}/robots.txt`);
        console.log(browser ? 'browser' : 'desktop', 'robots', robots?.status, JSON.stringify(robots?.body).slice(0, 300));
        for (const url of [`${run.root}sitemap.xml`, `${origin}/sitemap.xml`, ...[...String(robots?.body ?? '').matchAll(/^Sitemap: (\S+)$/gm)].map((m) => m[1])]) {
          const answer = resolve(world, url);
          console.log(' ', url, '->', answer?.finalUrl, answer?.status, answer?.type, JSON.stringify(answer?.model), JSON.stringify(typeof answer?.body === 'string' ? answer.body.slice(0, 400) : `${answer?.body?.length} bytes`));
          for (const child of answer?.model?.form === 'index' ? answer.model.locs : []) {
            const inner = resolve(world, child);
            console.log('    child', child, '->', inner?.finalUrl, inner?.status, inner?.type, JSON.stringify(inner?.model), JSON.stringify(typeof inner?.body === 'string' ? inner.body.slice(0, 300) : `${inner?.body?.length} bytes`));
          }
        }
        console.log('  run.sitemap', JSON.stringify(run.sitemap));
      }
      const count = (key: string) => void (stats[key] = (stats[key] ?? 0) + 1);
      count(`pages read ${Math.min(run.pages.filter((page) => page.checks).length, 5)}+`);
      count(run.sitemap.url ? 'sitemap found' : run.sitemap.unreadable ? 'sitemap unreadable' : run.sitemap.unknown ? 'sitemap unknown' : 'sitemap none');
      for (const id of ['no-sitemap', 'sitemap-unreadable', 'no-robots-txt', 'robots-in-folder', 'no-llms-txt', 'llms-txt-invalid', 'page-broken', 'duplicate-title', 'robots-server-error']) if (run.findings.some((finding) => finding.id === id)) count(id);
      if (run.unread?.length) count('some unread');
      if (run.note) count('www note');
      if (run.pages.some((page) => page.problem?.startsWith('Redirects out'))) count('a page left the site');
      for (const problem of checkClaims(world, run, transport, browser)) problems.push(`world ${5000 + n} (${browser ? 'browser' : 'desktop'}, ${world.site}): ${problem}`);
    }
  }
  if (process.env.CRAWL_STATS) console.log(JSON.stringify(stats, null, 1));
  const unique = [...new Set(problems.map((problem) => problem.replace(/^world \d+ /, '')))];
  assert.equal(problems.length, 0, `${problems.length} wrong claims in ${checked} checks. The first:\n${problems.slice(0, 12).join('\n')}\n(${unique.length} kinds)`);
  assert.ok(checked >= WORLDS * 2 * 0.95, `only ${checked} checks ran`);
});

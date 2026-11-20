import { createHash } from 'node:crypto';
import { expect, type Locator, type Page, type Route } from '@playwright/test';
import type { TauriHttpRule } from '../fixtures/tauri-runtime';

// What the SEO specs share: a made-up site answered the way each platform
// reads sites (page.route in a browser, with the header GitHub Pages sends;
// the Tauri HTTP plugin's stand-in in the desktop app), a fake of the user's
// claude-seo fork, and the way into the SEO view.

export const SEO_VIEW = "SEO: get your app's website found on Google and in AI answers";
export const COMMIT = 'c0ffee'.padEnd(40, '0');
export const SITE = 'https://pebble.example';

/** abs_claude_detect for a Claude Code signed in on a Max plan. */
export const CLAUDE_READY = {
  found: true,
  path: '/Users/e2e/.local/bin/claude',
  version: '2.1.285 (Claude Code)',
  loggedIn: true,
  authMethod: 'claude.ai',
  subscriptionType: 'max',
};

export interface Page200 {
  status: number;
  type: string;
  body: string;
  location?: string;
}

/** A home page for `site`, with a link to its support page. */
export function homeFor(site: string, title = 'Pebble Notes: quick notes that sync'): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><link rel="canonical" href="${site}/"><meta property="og:title" content="Pebble"><meta property="og:image" content="${site}/og.png"></head><body><h1>${title}</h1><p>Quick notes that sync.</p><a href="/support/">Support</a></body></html>`;
}

export const HOME = homeFor(SITE);
export const SUPPORT = HOME.replace('Pebble Notes: quick notes that sync', 'Pebble Notes support and answers').replace(`${SITE}/"`, `${SITE}/support/"`);

export function sitePages(overrides: Record<string, Page200> = {}, site = SITE): Record<string, Page200> {
  const home = site === SITE ? HOME : homeFor(site, `${new URL(site).hostname} home`);
  const support = site === SITE ? SUPPORT : homeFor(site, `${new URL(site).hostname} support`);
  return {
    '/': { status: 200, type: 'text/html; charset=utf-8', body: home },
    '/support/': { status: 200, type: 'text/html; charset=utf-8', body: support },
    '/robots.txt': { status: 200, type: 'text/plain', body: `User-agent: OAI-SearchBot\nDisallow: /\n\nUser-agent: *\nAllow: /\nSitemap: ${site}/sitemap.xml\n` },
    '/sitemap.xml': { status: 200, type: 'application/xml', body: `<urlset><url><loc>${site}/</loc></url><url><loc>${site}/support/</loc></url></urlset>` },
    ...overrides,
  };
}

export const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escape = escapeRegExp;

/**
 * The made-up sites, answered the way each platform reads sites. In the
 * desktop app every request goes through one list of rules, so `rules` (a
 * Google API, PageSpeed) go in with the sites' own.
 */
export async function serveSites(page: Page, isDesktop: boolean, sites: Record<string, Record<string, Page200>>, rules: TauriHttpRule[] = []): Promise<void> {
  if (isDesktop) {
    const all: TauriHttpRule[] = [...rules];
    for (const [origin, pages] of Object.entries(sites)) {
      for (const [path, answer] of Object.entries(pages)) {
        all.push({
          match: `^GET ${escape(origin)}${escape(path)}$`,
          status: answer.status,
          headers: { 'content-type': answer.type, ...(answer.location ? { location: answer.location } : {}) },
          body: answer.body,
        });
      }
      all.push({ match: `^GET ${escape(origin)}/`, status: 404, headers: { 'content-type': 'text/html' }, body: 'Not found' });
    }
    await page.evaluate((next) => {
      (window as unknown as { __E2E_TAURI__: { config: { http: unknown[] } } }).__E2E_TAURI__.config.http = next;
    }, all);
    return;
  }
  for (const [origin, pages] of Object.entries(sites)) {
    await page.route(new RegExp(`^${escape(origin)}/`), (route: Route) => {
      const path = new URL(route.request().url()).pathname;
      const answer = pages[path];
      if (!answer) return route.fulfill({ status: 404, contentType: 'text/html', headers: { 'access-control-allow-origin': '*' }, body: 'Not found' });
      return route.fulfill({ status: answer.status, contentType: answer.type, headers: { 'access-control-allow-origin': '*' }, body: answer.body });
    });
  }
}

export async function serveSite(page: Page, isDesktop: boolean, pages: Record<string, Page200>): Promise<void> {
  await serveSites(page, isDesktop, { [SITE]: pages });
}

const blobSha = (text: string) => createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex');

/** The user's claude-seo fork, with two of the files the app reads. Returns every request made to it. */
export async function serveFork(page: Page): Promise<string[]> {
  const files: Record<string, string> = {
    'skills/seo/references/quality-gates.md': '# Quality gates\nTitles 30 to 60 characters.\n',
    'data/google-updates.json': JSON.stringify({ updates: [{ date: '2026-11-01', name: 'November 2026 core update', kind: 'core', source: 'https://developers.google.com/search/updates' }] }),
  };
  const requests: string[] = [];
  const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'ETag' };
  await page.route(/^https:\/\/(api\.github\.com|raw\.githubusercontent\.com|cdn\.jsdelivr\.net)\//, (route) => {
    const url = route.request().url();
    if (!url.includes('dotnetdreamer/claude-seo')) return route.fallback();
    requests.push(url);
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': 'if-none-match, accept' } });
    if (url.endsWith('/commits/main')) return route.fulfill({ status: 200, headers: { ...cors, etag: `"${COMMIT}"` }, body: COMMIT });
    if (url.includes(`/git/trees/${COMMIT}`)) {
      const tree = Object.entries(files).map(([path, text]) => ({ path, mode: '100644', type: 'blob', sha: blobSha(text), size: text.length }));
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ sha: COMMIT, tree }) });
    }
    const path = Object.keys(files).find((candidate) => url.endsWith(`/${COMMIT}/${candidate}`));
    if (path) return route.fulfill({ status: 200, headers: cors, body: files[path] });
    return route.fulfill({ status: 404, headers: cors, body: 'Not found' });
  });
  return requests;
}

export async function openSeo(page: Page, app: { dismissStartDialog(): Promise<void> }): Promise<Locator> {
  await app.dismissStartDialog();
  return showSeo(page);
}

/** The SEO view, from the activity bar, with no start dialog in the way. */
export async function showSeo(page: Page): Promise<Locator> {
  await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: SEO_VIEW, exact: true }).click();
  const view = page.getByTestId('seo-view');
  // A cold dev server compiles the view's code on its first open, which can take longer than an expect's 15 seconds.
  await expect(view).toBeVisible({ timeout: 60_000 });
  return view;
}

export function section(view: Locator, name: string): Locator {
  return view.getByRole('navigation', { name: 'SEO sections' }).getByRole('button', { name, exact: true });
}

export async function checkSite(view: Locator, address = 'pebble.example'): Promise<void> {
  await view.getByLabel("Your website's address").fill(address);
  await view.getByRole('button', { name: 'Check my site' }).click();
}

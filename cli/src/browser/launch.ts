/**
 * Starting a browser and keeping it usable for long renders.
 *
 * Three hard-won behaviours are encoded here, all of them from driving this
 * exact app headlessly:
 *
 *   1. Edge 150 broke `puppeteer.launch`: the process it starts hands off to a
 *      child and exits 0, so puppeteer reports "Failed to launch the browser
 *      process: Code: 0". We spawn it ourselves with a debug port and connect.
 *      Kept as a fallback rather than the only path, so it keeps working if
 *      Edge fixes it.
 *   2. Headless Chrome and Edge defer image loads and throttle backgrounded
 *      pages. Both stall the in-app html-to-image export, which is the whole
 *      render path, so the lazy-loading and throttling features are switched
 *      off explicitly.
 *   3. The editor asks Google Fonts for a stylesheet at boot and then for woff2
 *      files. Those responses are cached to disk here so a warm machine renders
 *      with no network at all, and a locale that needs Noto Nastaliq Urdu does
 *      not silently fall back to a face with none of the glyphs.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import type { Browser, Page, HTTPRequest } from 'puppeteer-core';
import { findBrowser, browserHint, type FoundBrowser } from './find.js';
import { fontCacheDir, ensureDir } from '../paths.js';
import { OsgError, EXIT } from '../errors.js';
import { debug, warn } from '../log.js';

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

export interface LaunchOptions {
  headed?: boolean;
  browser?: string;
  width?: number;
  height?: number;
  deviceScaleFactor?: number;
  downloadDir?: string;
  /** Refuse any request that is not to the local origin or the font cache. */
  offline?: boolean;
  /** Extra origins the page is allowed to reach (the assets host, an AI API). */
  allowHosts?: string[];
}

export interface LaunchedBrowser {
  browser: Browser;
  page: Page;
  found: FoundBrowser;
  /** True when the browser process was spawned by us rather than by puppeteer. */
  spawned: boolean;
  close(): Promise<void>;
}

function baseArgs(options: LaunchOptions): string[] {
  const args = [
    '--disable-features=LazyImageLoading,AutomaticLazyImageLoading,LazyFrameLoading,Translate',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--disable-ipc-flooding-protection',
    '--hide-scrollbars',
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    `--window-size=${options.width ?? 1720},${options.height ?? 1400}`,
  ];
  if (options.deviceScaleFactor && options.deviceScaleFactor !== 1) {
    args.push(`--force-device-scale-factor=${options.deviceScaleFactor}`);
  }
  // Containers: Chrome refuses to start as root without --no-sandbox, and the
  // default 64 MB /dev/shm crashes the renderer part way through a big export.
  // Both are the normal state of a CI runner, so detect rather than document.
  const inContainer =
    process.platform === 'linux' &&
    (process.getuid?.() === 0 || fs.existsSync('/.dockerenv') || !!process.env.CI);
  if (inContainer) {
    args.push('--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage');
  }
  return args;
}

/** A digest-named file per URL, so the cache survives a query string change. */
function fontCacheFile(url: string): string {
  const digest = crypto.createHash('sha256').update(url).digest('hex');
  return path.join(fontCacheDir(), `${digest.slice(0, 2)}`, digest);
}

interface CachedResponse {
  status: number;
  contentType: string;
  bodyBase64: string;
}

async function installFontCache(page: Page, options: LaunchOptions): Promise<void> {
  await page.setRequestInterception(true);
  page.on('request', (request: HTTPRequest) => {
    void (async () => {
      const url = request.url();
      let host = '';
      try {
        host = new URL(url).host;
      } catch {
        // Not a URL we can reason about; let it through.
      }

      if (!FONT_HOSTS.includes(host)) {
        if (options.offline && host && !host.startsWith('127.0.0.1') && !host.startsWith('localhost')) {
          const allowed = options.allowHosts?.some((h) => host === h || host.endsWith(`.${h}`));
          if (!allowed) {
            debug(`offline: blocked ${url}`);
            await request.abort('failed').catch(() => {});
            return;
          }
        }
        await request.continue().catch(() => {});
        return;
      }

      const file = fontCacheFile(url);
      if (fs.existsSync(file)) {
        try {
          const cached = JSON.parse(fs.readFileSync(file, 'utf8')) as CachedResponse;
          await request.respond({
            status: cached.status,
            contentType: cached.contentType,
            body: Buffer.from(cached.bodyBase64, 'base64'),
            headers: { 'Access-Control-Allow-Origin': '*' },
          });
          return;
        } catch {
          // Corrupt entry: fall through and refetch.
        }
      }

      if (options.offline) {
        debug(`offline: font miss ${url}`);
        await request.abort('failed').catch(() => {});
        return;
      }

      try {
        // Google serves a different stylesheet per user agent. Forward the
        // page's own, so what we cache is what this browser would have got.
        const response = await fetch(url, {
          headers: { 'User-Agent': await page.browser().userAgent() },
        });
        const body = Buffer.from(await response.arrayBuffer());
        const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
        ensureDir(path.dirname(file));
        const payload: CachedResponse = {
          status: response.status,
          contentType,
          bodyBase64: body.toString('base64'),
        };
        fs.writeFileSync(file, JSON.stringify(payload));
        await request.respond({
          status: response.status,
          contentType,
          body,
          headers: { 'Access-Control-Allow-Origin': '*' },
        });
      } catch (error) {
        debug(`font fetch failed ${url}: ${(error as Error).message}`);
        await request.continue().catch(() => {});
      }
    })();
  });
}

export async function launchBrowser(options: LaunchOptions = {}): Promise<LaunchedBrowser> {
  const found = findBrowser({ explicit: options.browser });
  if (!found) {
    throw new OsgError('No Chrome, Edge or Chromium found.', {
      code: EXIT.usage,
      fix: browserHint(),
    });
  }

  const puppeteer = await import('puppeteer-core');
  const args = baseArgs(options);
  const defaultViewport = {
    width: options.width ?? 1720,
    height: options.height ?? 1400,
    deviceScaleFactor: options.deviceScaleFactor ?? 1,
  };

  let browser: Browser;
  let spawned = false;
  try {
    browser = await puppeteer.launch({
      executablePath: found.executablePath,
      headless: !options.headed,
      args,
      defaultViewport,
      protocolTimeout: 300_000,
    });
  } catch (launchError) {
    debug(`launch failed, falling back to spawn+connect: ${(launchError as Error).message}`);
    const port = 9200 + (process.pid % 500);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'osg-browser-'));
    const child = spawn(
      found.executablePath,
      [
        ...(options.headed ? [] : ['--headless=new']),
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profile}`,
        ...args,
        'about:blank',
      ],
      { detached: true, stdio: 'ignore' }
    );
    child.unref();
    spawned = true;
    const browserURL = `http://127.0.0.1:${port}`;
    let connected: Browser | null = null;
    for (let attempt = 0; attempt < 60 && !connected; attempt++) {
      try {
        connected = await puppeteer.connect({ browserURL, defaultViewport, protocolTimeout: 300_000 });
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (!connected) {
      throw new OsgError(`${found.executablePath} did not expose a debug port on ${port}.`, {
        code: EXIT.driver,
        fix: `Original launch error: ${(launchError as Error).message}. Try --browser <path> with a different build.`,
      });
    }
    browser = connected;
  }

  const pages = await browser.pages();
  const page = pages[0] ?? (await browser.newPage());
  await page.setViewport(defaultViewport);
  page.setDefaultTimeout(120_000);
  page.on('pageerror', (error) => debug(`[pageerror] ${String(error).slice(0, 400)}`));
  page.on('console', (message) => {
    if (message.type() === 'error') debug(`[console] ${message.text().slice(0, 400)}`);
  });

  await installFontCache(page, options);

  if (options.downloadDir) {
    ensureDir(options.downloadDir);
    const cdp = await page.createCDPSession();
    // The app saves files through an anchor download off the desktop app, which
    // is exactly what this catches and turns into bytes on disk.
    await cdp.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: options.downloadDir,
      eventsEnabled: true,
    });
  }

  return {
    browser,
    page,
    found,
    spawned,
    async close() {
      try {
        if (spawned) {
          // We started the process, so closing the connection would leave it
          // running. Close every page first so the app can flush IndexedDB.
          for (const open of await browser.pages()) await open.close().catch(() => {});
          await browser.close().catch(() => {});
        } else {
          await browser.close();
        }
      } catch (error) {
        warn(`browser did not close cleanly: ${(error as Error).message}`);
      }
    },
  };
}

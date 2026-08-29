/**
 * Browser discovery.
 *
 * Order matters, and not for the reason you would guess. Branded Chrome and
 * Edge are preferred over Chromium and over Chrome for Testing because only
 * the branded builds ship the proprietary codecs: `VideoEncoder` with an
 * `avc1.*` config is unsupported on a plain Chromium build, which would leave
 * `osg video` broken on the very browser a naive `--install-browser` would
 * fetch. PNG export, the 49 tools and the AI agent work everywhere; MP4 does
 * not, and `osg doctor` says so per browser rather than assuming.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { debug } from '../log.js';
import { browserCacheDir } from '../paths.js';

export type BrowserFlavor = 'chrome' | 'edge' | 'chromium' | 'chrome-for-testing' | 'brave' | 'unknown';

export interface FoundBrowser {
  executablePath: string;
  flavor: BrowserFlavor;
  /** Branded builds carry H.264, open builds usually do not. Probed for real in doctor. */
  likelyHasH264: boolean;
}

function existing(candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Unreadable path, keep looking.
    }
  }
  return null;
}

function flavorOf(executablePath: string): BrowserFlavor {
  const p = executablePath.toLowerCase();
  if (p.includes('chrome-headless-shell') || p.includes('chrome for testing') || p.includes('chrome-for-testing')) {
    return 'chrome-for-testing';
  }
  if (p.includes('msedge') || p.includes('microsoft edge')) return 'edge';
  if (p.includes('brave')) return 'brave';
  if (p.includes('chromium')) return 'chromium';
  if (p.includes('chrome')) return 'chrome';
  return 'unknown';
}

const BRANDED: BrowserFlavor[] = ['chrome', 'edge', 'brave'];

function describe(executablePath: string): FoundBrowser {
  const flavor = flavorOf(executablePath);
  return { executablePath, flavor, likelyHasH264: BRANDED.includes(flavor) };
}

function windowsCandidates(): string[] {
  const roots = [
    process.env['PROGRAMFILES'] ?? 'C:\\Program Files',
    process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)',
    process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'),
  ];
  const relative = [
    'Google\\Chrome\\Application\\chrome.exe',
    'Microsoft\\Edge\\Application\\msedge.exe',
    'BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    'Chromium\\Application\\chrome.exe',
  ];
  return roots.flatMap((root) => relative.map((rel) => path.join(root, rel)));
}

function macCandidates(): string[] {
  const home = os.homedir();
  const apps = [
    'Google Chrome.app/Contents/MacOS/Google Chrome',
    'Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    'Brave Browser.app/Contents/MacOS/Brave Browser',
    'Chromium.app/Contents/MacOS/Chromium',
  ];
  return apps.flatMap((app) => [path.join('/Applications', app), path.join(home, 'Applications', app)]);
}

function linuxCandidates(): string[] {
  return [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/opt/google/chrome/chrome',
    '/usr/bin/microsoft-edge-stable',
    '/usr/bin/microsoft-edge',
    '/usr/bin/brave-browser',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/lib/chromium/chromium',
  ];
}

/** Browsers this CLI downloaded itself, under its own cache. */
function installedCandidates(): string[] {
  const root = browserCacheDir();
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 5) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (/^(chrome|chrome\.exe|Google Chrome|chromium|chrome-headless-shell(\.exe)?)$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(root, 0);
  return out;
}

export interface FindOptions {
  /** An explicit --browser or config value always wins, and errors if wrong. */
  explicit?: string;
}

export function findBrowser(options: FindOptions = {}): FoundBrowser | null {
  const explicit = options.explicit?.trim() || process.env.OSG_BROWSER?.trim();
  if (explicit) {
    if (!fs.existsSync(explicit)) return null;
    debug(`browser: explicit ${explicit}`);
    return describe(explicit);
  }

  const env = existing([
    process.env.CHROME_PATH ?? '',
    process.env.PUPPETEER_EXECUTABLE_PATH ?? '',
  ]);
  if (env) {
    debug(`browser: env ${env}`);
    return describe(env);
  }

  const platformCandidates =
    process.platform === 'win32'
      ? windowsCandidates()
      : process.platform === 'darwin'
        ? macCandidates()
        : linuxCandidates();

  // Branded first, on purpose: see the module comment about H.264.
  const branded = existing(platformCandidates);
  if (branded) {
    debug(`browser: system ${branded}`);
    return describe(branded);
  }

  const downloaded = existing(installedCandidates());
  if (downloaded) {
    debug(`browser: downloaded ${downloaded}`);
    return describe(downloaded);
  }

  return null;
}

export function browserHint(): string {
  if (process.platform === 'win32') return 'Install Chrome or Edge, or run `osg doctor --install-browser`.';
  if (process.platform === 'darwin') return 'Install Google Chrome, or run `osg doctor --install-browser`.';
  return 'Install Chrome (apt install google-chrome-stable) or run `osg doctor --install-browser`. On a plain Chromium build MP4 export is unavailable.';
}

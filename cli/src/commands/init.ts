/**
 * `osg init`: put a config in the repo and get out of the way.
 *
 * The config is the point of the command, not the directory. Every value the
 * CLI would otherwise infer is written out explicitly, so the file doubles as
 * documentation of what this project's store assets are: somebody reading it
 * in six months, human or agent, learns the template, the formats, the locales
 * and the design decisions without running anything.
 *
 * It never overwrites. A config that already exists is somebody's decisions,
 * and quietly replacing it with defaults would be the worst thing this command
 * could do.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { CommandContext } from '../context.js';
import { flagString } from '../args.js';
import { DEFAULTS } from '../config.js';
import { EXIT } from '../errors.js';
import { info, step, ok, warn, emit, bold, dim, cyan } from '../log.js';

/** Directories people already keep app screenshots in, most specific first. */
const SCREENSHOT_CANDIDATES = [
  'osg/screenshots',
  'screenshots',
  'fastlane/screenshots',
  'assets/screenshots',
  'docs/screenshots',
];

interface Detected {
  name: string;
  nameSource: string | null;
  store: 'appstore' | 'play';
  storeSource: string | null;
  screenshots: string;
  screenshotsExists: boolean;
  /** A template id, or 'auto' to rank the bundled set on every run. */
  template: string;
}

export async function run(ctx: CommandContext): Promise<number> {
  const root = ctx.root;
  const osgDir = path.join(root, 'osg');
  const configFile = path.join(osgDir, 'osg.config.ts');
  const localIgnore = path.join(osgDir, '.gitignore');
  const repoIgnore = path.join(root, '.gitignore');

  const detected = detect(root, {
    name: flagString(ctx.args.flags, 'name'),
    template: flagString(ctx.args.flags, 'template'),
  });
  const created: string[] = [];
  const skipped: string[] = [];

  if (fs.existsSync(configFile)) {
    warn(`${rel(root, configFile)} already exists, nothing was written`);
    info('');
    info('Edit these, then re-run the pipeline:');
    info(`  ${bold('template')}    pin a template id from ${cyan('osg templates')}, or 'auto' to rank on every run`);
    info(`  ${bold('formats')}     the store sizes to render`);
    info(`  ${bold('locales')}     the languages the listing ships in`);
    info(`  ${bold('design')}      background, fonts, colours and the device frame`);
    skipped.push(configFile);
    if (ctx.json) {
      emit({
        ok: true,
        reason: 'config already exists',
        created: [],
        skipped: skipped.map((f) => rel(root, f)),
        configFile: rel(root, configFile),
      });
    }
    return EXIT.ok;
  }

  if (ctx.loaded.file) {
    // A config elsewhere still loads, so writing osg/osg.config.ts would give
    // this repo two of them and the resolution order would pick the new one.
    warn(`a config is already in use at ${rel(root, ctx.loaded.file)}`);
    info('Delete or rename it first, or keep editing it instead of running init');
    if (ctx.json) {
      emit({
        ok: true,
        reason: 'another config is already in use',
        created: [],
        skipped: [rel(root, ctx.loaded.file)],
        configFile: rel(root, ctx.loaded.file),
      });
    }
    return EXIT.ok;
  }

  fs.mkdirSync(osgDir, { recursive: true });
  fs.writeFileSync(configFile, configTemplate(detected), 'utf8');
  created.push(configFile);
  step(`wrote ${rel(root, configFile)}`);

  if (!fs.existsSync(localIgnore)) {
    fs.writeFileSync(localIgnore, LOCAL_IGNORE, 'utf8');
    created.push(localIgnore);
    step(`wrote ${rel(root, localIgnore)}`);
  } else if (!ignoreCovers(fs.readFileSync(localIgnore, 'utf8'), ['out', 'out/', '/out', '/out/'])) {
    fs.appendFileSync(localIgnore, `${trailing(fs.readFileSync(localIgnore, 'utf8'))}${LOCAL_IGNORE}`, 'utf8');
    step(`appended out/ to ${rel(root, localIgnore)}`);
  } else {
    skipped.push(localIgnore);
  }

  let touchedRepoIgnore = false;
  if (fs.existsSync(repoIgnore)) {
    const body = fs.readFileSync(repoIgnore, 'utf8');
    if (ignoreCovers(body, ['osg/out', 'osg/out/', '/osg/out', '/osg/out/', 'osg', 'osg/', '/osg', '/osg/'])) {
      skipped.push(repoIgnore);
    } else {
      fs.appendFileSync(repoIgnore, `${trailing(body)}# Open Screenshot Generator rendered output\nosg/out/\n`, 'utf8');
      touchedRepoIgnore = true;
      step(`appended osg/out/ to ${rel(root, repoIgnore)}`);
    }
  }

  info('');
  ok(`app name ${bold(detected.name)}${detected.nameSource ? dim(` from ${detected.nameSource}`) : dim(' (guessed, edit it)')}`);
  ok(`store ${bold(detected.store)}${detected.storeSource ? dim(` from ${detected.storeSource}`) : ''}`);
  ok(`template ${bold(detected.template)}${detected.template === 'auto' ? dim(' (ranked on every run)') : ''}`);
  if (detected.screenshotsExists) {
    ok(`screenshots ${bold(detected.screenshots)}`);
  } else {
    warn(`no screenshots directory found, the config points at ${detected.screenshots}`);
    info(dim('     Put your app screenshots there, named 01-, 02-, 03- so the order is the board order.'));
  }

  info('');
  info(bold('Next:'));
  info(`  ${cyan('osg doctor')}    check this machine can render, and whether it can encode MP4`);
  info(`  ${cyan('osg fill')}      rank the 101 templates against your screenshots and build a project`);
  info(`  ${cyan('osg render')}    write the store PNGs into ${rel(root, ctx.outDir)}`);

  if (ctx.json) {
    emit({
      ok: true,
      created: created.map((f) => rel(root, f)),
      skipped: skipped.map((f) => rel(root, f)),
      repoGitignoreUpdated: touchedRepoIgnore,
      configFile: rel(root, configFile),
      detected: {
        name: detected.name,
        nameSource: detected.nameSource,
        store: detected.store,
        template: detected.template,
        screenshots: detected.screenshots,
        screenshotsExists: detected.screenshotsExists,
      },
      next: ['osg doctor', 'osg fill', 'osg render'],
    });
  }

  return EXIT.ok;
}

// ---------------------------------------------------------------------------

const LOCAL_IGNORE = `# Rendered output. Everything here can be rebuilt from osg.config.ts
# and the committed project file, so none of it belongs in git.
out/
`;

function configTemplate(detected: Detected): string {
  return `/**
 * Open Screenshot Generator config.
 *
 * This file is the source of truth for how this app's store assets look. A
 * flag on one run is a try, an edit in here is a decision, so anything worth
 * keeping belongs in this file and gets committed next to the code it sells.
 *
 * Every field is optional and every value below is what the CLI would infer on
 * its own, so deleting a line changes nothing. Commented fields are the ones
 * with no inferred value: uncomment one and it overrides the template.
 *
 * The type comes from the package. If your editor cannot resolve it, run
 * npm i -D open-screenshot-generator. The import is erased before the file is
 * loaded, so the config works either way.
 */
import type { OsgConfig } from 'open-screenshot-generator';

const config: OsgConfig = {
  // Used in output filenames, in osg.manifest.json, and by the AI agent as the
  // name of the app it is writing copy for.
  name: ${quote(detected.name)},

  // The committed project file. Every command reads and writes this one file,
  // so reviewing a design change is reading a diff.
  project: ${quote(DEFAULTS.project)},

  // Where rendered PNGs, MP4s and the manifest land. Ignored by git.
  out: ${quote(DEFAULTS.out)},

  // Your app's own screenshots, the images that go inside the device frames.
  // They are used in filename order, so name them 01-, 02-, 03-.
  screenshots: ${quote(detected.screenshots)},

  // 'auto' ranks the 101 bundled templates against your screenshots and picks
  // one. Pin an id from "osg templates" to stop it changing between runs.
  template: ${quote(detected.template)},

  // Store size presets to render. Run "osg render --help" for the full list.
  formats: [${DEFAULTS.formats.map(quote).join(', ')}],

  // The languages the listing ships in. Uncomment once "osg localize --add"
  // has actually put them in the project: a project with no languages renders
  // whatever is on the canvas, which is what you want until then.
  // locales: ['en-US', 'de-DE', 'ja'],
  // baseLocale: 'en-US',

  // Decides which store's rules "osg verify" enforces, and what "osg upload"
  // talks to. 'appstore' or 'play'.
  store: ${quote(detected.store)},

  // Applied on top of whatever the template already says. Every field here is
  // a deliberate override, which is why none of them are set by default.
  design: {
    // background: '#0B1020',
    // background: 'linear-gradient(135deg, #6366F1, #22D3EE)',
    // headlineFont: 'Inter',
    // headlineColor: '#FFFFFF',
    // subheadColor: '#B4B9C9',
    // device: 'iphone-17-pro-max',
    // layout: 'alternating',
  },

  video: {
    // 'store-raw' is the screen recording alone, which is what Apple prefers.
    // 'store-text' adds the board's headlines. 'styled' animates the whole
    // board, which reads better on social than it does in the store.
    mode: 'store-raw',
    fps: 30,
    // Seconds. Apple accepts 15 to 30.
    duration: 20,
    // A screen recording on disk, served to the page during the run.
    // recording: 'osg/recording.mp4',
  },

  ai: {
    // Only "osg design" reads this. Everything else is model free.
    // provider: 'anthropic',
    // model: 'claude-sonnet-4-5',
    // baseUrl: 'https://api.openai.com/v1',

    // Never put a key in this file. Name the variable that holds it.
    apiKeyEnv: 'OSG_API_KEY',
  },

  // Where the artwork the templates paint is hydrated from, cached per machine
  // after the first run.
  // assetsBaseUrl: ${quote(DEFAULTS.assetsBaseUrl)},

  // Drive a running editor instead of the bundled one, for example a local
  // "npm run dev" while you are working on the app itself.
  // editorUrl: 'http://localhost:9002',

  // An explicit browser. Chrome and Edge can encode MP4, open Chromium builds
  // cannot, so name one here if the CLI picks the wrong build.
  // browser: '/path/to/chrome',
};

export default config;
`;
}

/**
 * Detection reads files, it never executes them. app.config.js can import the
 * whole toolchain and read the environment, and running somebody's build
 * config to learn a display string is not a trade worth making, so that one is
 * matched with a regex and left alone.
 */
function detect(root: string, overrides: { name?: string; template?: string }): Detected {
  const name = overrides.name ? { value: overrides.name, source: '--name' } : detectName(root);
  const store = detectStore(root);
  const screenshots = SCREENSHOT_CANDIDATES.find((candidate) => isDirectory(path.join(root, candidate)));

  return {
    name: name?.value ?? titleize(path.basename(root)),
    nameSource: name?.source ?? null,
    store: store.value,
    storeSource: store.source,
    screenshots: screenshots ?? 'screenshots',
    screenshotsExists: !!screenshots,
    template: overrides.template ?? 'auto',
  };
}

function detectName(root: string): { value: string; source: string } | null {
  // app.json first: on an Expo or bare React Native project it holds the name
  // a user sees, where package.json holds the name npm sees.
  const appJson = readJson(path.join(root, 'app.json')) as
    | { name?: string; displayName?: string; expo?: { name?: string } }
    | null;
  const fromAppJson = appJson?.expo?.name || appJson?.displayName || appJson?.name;
  if (fromAppJson) return { value: String(fromAppJson), source: 'app.json' };

  for (const file of ['app.config.ts', 'app.config.js', 'app.config.mjs']) {
    const body = readText(path.join(root, file));
    const match = body && /\bname\s*:\s*['"`]([^'"`]+)['"`]/.exec(body);
    if (match) return { value: match[1], source: file };
  }

  const plist = findInfoPlist(root);
  if (plist) {
    const body = readText(plist.file) ?? '';
    for (const key of ['CFBundleDisplayName', 'CFBundleName']) {
      const match = new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`).exec(body);
      // Xcode writes $(PRODUCT_NAME) into these more often than a real string.
      if (match && !match[1].includes('$(')) return { value: match[1].trim(), source: plist.label };
    }
  }

  const pkg = readJson(path.join(root, 'package.json')) as { name?: string; displayName?: string } | null;
  if (pkg?.displayName) return { value: String(pkg.displayName), source: 'package.json' };
  if (pkg?.name) return { value: titleize(String(pkg.name)), source: 'package.json' };

  return null;
}

function detectStore(root: string): { value: 'appstore' | 'play'; source: string | null } {
  const hasAndroid = isDirectory(path.join(root, 'android'));
  const hasIos = isDirectory(path.join(root, 'ios'));
  if (hasAndroid && !hasIos) return { value: 'play', source: 'android/' };
  if (hasIos) return { value: 'appstore', source: 'ios/' };
  if (fs.existsSync(path.join(root, 'build.gradle')) || fs.existsSync(path.join(root, 'settings.gradle'))) {
    return { value: 'play', source: 'gradle' };
  }
  return { value: 'appstore', source: null };
}

/** ios/<Target>/Info.plist, the only place a plain Xcode project keeps it. */
function findInfoPlist(root: string): { file: string; label: string } | null {
  const iosDir = path.join(root, 'ios');
  if (!isDirectory(iosDir)) return null;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(iosDir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.endsWith('.xcodeproj') || entry.name.endsWith('.xcworkspace')) continue;
    const file = path.join(iosDir, entry.name, 'Info.plist');
    if (fs.existsSync(file)) return { file, label: `ios/${entry.name}/Info.plist` };
  }
  return null;
}

/** true when a gitignore body already ignores one of these paths. */
function ignoreCovers(body: string, patterns: string[]): boolean {
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  return patterns.some((pattern) => lines.includes(pattern));
}

/** Whatever it takes to start a new block at the end of an existing file. */
function trailing(body: string): string {
  if (body.length === 0) return '';
  return body.endsWith('\n\n') ? '' : body.endsWith('\n') ? '\n' : '\n\n';
}

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function readJson(file: string): unknown {
  const body = readText(file);
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** my-cool-app and @acme/my-cool-app both become My Cool App. */
function titleize(value: string): string {
  const bare = value.replace(/^@[^/]+\//, '').replace(/[._-]+/g, ' ').trim();
  if (!bare) return 'My App';
  return bare
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function rel(root: string, file: string): string {
  const relative = path.relative(root, file);
  return relative && !relative.startsWith('..') ? relative.split(path.sep).join('/') : file;
}

/**
 * osg fill: screenshots in, a finished project out, with no model and no
 * browser.
 *
 * This is the cheap path, and it is the one most people should run first. The
 * catalog's 101 designs already have screenshot-shaped holes in them, so
 * choosing one and pouring an upload set into it is a deterministic transform
 * over JSON. The app does exactly this in its quickstart flow, and the modules
 * it does it with are DOM free on purpose (rule 33 in .agents/AGENTS.md), so
 * this command imports them rather than growing a second ranker:
 *
 *   buildTemplateIndex / buildIntakeProfile / rankTemplates   which template
 *   fillTemplate / suggestedFormat / applyFormat              what it becomes
 *
 * What node cannot do is decode pixels, so two of the ranking signals arrive
 * from flags instead of from the images: `--dark` and `--accent`. Everything
 * else (how many frames a template has, which device it is built around, what
 * the user typed) is read from the files and the catalog, which is why this
 * still lands on a sensible design with no arguments at all.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ArtboardState, DeviceType, Project } from '@/types/artboard';
import { APP_STORE_FORMAT_IDS, DEVICE_FORMAT_PRESETS, type DeviceFormatPreset } from '@/lib/deviceRegistry';
import { TEMPLATE_CATEGORIES } from '@/lib/templateCategories';
import { detectDevice } from '@/lib/intake/screenshotAnalysis';
import {
  buildIntakeProfile,
  buildTemplateIndex,
  indexTemplate,
  rankTemplates,
  type TemplateScore,
} from '@/lib/intake/templateIndex';
import {
  applyFormat,
  deviceLabel,
  fillTemplate,
  suggestedFormat,
  type PlaceableShot,
  type UnusedBoardPolicy,
} from '@/lib/intake/autoFill';
import { flagBool, flagNumber, flagString } from '../args.js';
import { DEFAULTS } from '../config.js';
import type { CommandContext } from '../context.js';
import { hydrate, loadManifest } from '../editor/assets.js';
import { manifestPath, resolveEditor } from '../editor/resolve.js';
import { EXIT, driverError, usageError } from '../errors.js';
import { bold, debug, dim, emit, humanBytes, info, ok, step, warn } from '../log.js';

/**
 * The two formats whose size can be read out of the header with no decoder. A
 * store screenshot is a PNG or a JPEG; anything else is a job for `osg new`,
 * which hands the file to the browser and gets a real decode.
 */
const READABLE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

interface Shot {
  file: string;
  width: number;
  height: number;
  device: DeviceType;
  dataUrl: string;
}

type Store = 'appstore' | 'play';

interface ShotSet {
  shots: Shot[];
  /** Set when the folder was written by `osg import`. */
  store: Store | null;
  appName: string | null;
}

/** IHDR is always the first chunk, so the size sits at a fixed offset. */
function pngSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24) return null;
  if (buffer.readUInt32BE(0) !== 0x89504e47 || buffer.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * Walk the JPEG segment chain to the frame header.
 *
 * The size is not at a fixed offset: a phone capture carries EXIF and often a
 * thumbnail ahead of it. Markers 0xC0 to 0xCF are frame headers EXCEPT C4, C8
 * and CC, which are Huffman tables, a reserved marker and arithmetic coding
 * conditioning, and reading a size out of one of those returns nonsense.
 */
function jpegSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer.readUInt16BE(0) !== 0xffd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = buffer[offset + 1];
    // Padding and the standalone markers carry no length word of their own.
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += marker === 0xff ? 1 : 2;
      continue;
    }
    // Start of scan: everything past here is entropy coded image data.
    if (marker === 0xda || marker === 0xd9) return null;
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

function readShots(target: string): ShotSet {
  const stat = fs.existsSync(target) ? fs.statSync(target) : null;
  if (!stat) {
    throw usageError(
      `No screenshots at ${target}`,
      'Point --screenshots at a folder of PNG or JPEG captures, or run `osg import <your app>` to pull the ones already on your store listing.'
    );
  }

  // A folder written by `osg import` carries a sidecar naming the app, the
  // store it came from and the icon that came with it. The icon is not a
  // screenshot: left in the set it would take a device frame and pull the
  // device vote toward a square, and the store it came from is better evidence
  // of what this project targets than an aspect ratio guess.
  const listing = stat.isFile() ? null : readListing(path.join(path.resolve(target), 'listing.json'));

  const files = stat.isFile()
    ? [path.resolve(target)]
    : fs
        .readdirSync(target)
        .filter((name) => READABLE_EXTENSIONS.has(path.extname(name).toLowerCase()) && name !== listing?.icon)
        .sort(collator.compare)
        .map((name) => path.join(path.resolve(target), name));
  if (files.length === 0) {
    throw usageError(
      `No PNG or JPEG images in ${target}`,
      'This command reads image sizes out of the file header itself, so it takes PNG and JPEG. For any other format use `osg new`, which decodes in the browser.'
    );
  }

  const shots = files.map((file) => {
    const bytes = fs.readFileSync(file);
    // Sniffed, not taken from the extension. Exporting a PNG and naming it .jpg
    // is common enough that trusting the name would reject real screenshots,
    // and it would also put the wrong media type in the data URL.
    const png = pngSize(bytes);
    const size = png ?? jpegSize(bytes);
    if (!size || !(size.width > 0) || !(size.height > 0)) {
      throw usageError(
        `Could not read the size of ${path.basename(file)}`,
        'It may be truncated, or it may not be a PNG or a JPEG at all. Re-save it, or use `osg new`, which decodes in the browser.'
      );
    }
    return {
      file,
      width: size.width,
      height: size.height,
      device: detectDevice(size.width, size.height).device,
      // The bytes go in whole. Node has no canvas, so there is no downscale to
      // apply here, and the app externalizes an inline data URL into its media
      // table the moment this project is opened (src/lib/externalizeInlineMedia.ts).
      dataUrl: `data:${png ? 'image/png' : 'image/jpeg'};base64,${bytes.toString('base64')}`,
    };
  });

  return { shots, store: listing?.store ?? null, appName: listing?.name ?? null };
}

function readListing(file: string): { icon: string | null; store: Store | null; name: string | null } | null {
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { icon?: unknown; source?: unknown; name?: unknown };
    return {
      icon: typeof parsed.icon === 'string' ? parsed.icon : null,
      store: parsed.source === 'appstore' || parsed.source === 'play' ? parsed.source : null,
      name: typeof parsed.name === 'string' ? parsed.name : null,
    };
  } catch {
    // A hand-edited sidecar is not worth failing a run over. It only ever
    // supplies hints, and every one of them has a flag that overrides it.
    return null;
  }
}

async function mapPooled<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        out[index] = await work(items[index]);
      }
    })
  );
  return out;
}

/**
 * The 101 templates, as Projects, without a browser.
 *
 * The derivation of the id, the name and the description mirrors
 * src/services/projectService.ts exactly, because the id printed by this
 * command is the id `osg new --template` and the editor's own gallery use, and
 * two spellings of it would be a bug people only find at the worst moment. The
 * files ship inside the package; the fetch is the path for a checkout that has
 * no bundle and for `--editor-url`.
 */
function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/** A contributor runs this inside the repo, where public/ is the real catalog. */
function findCheckoutTemplates(from: string): string | null {
  let dir = path.resolve(from);
  for (let depth = 0; depth < 8; depth++) {
    const candidate = path.join(dir, 'public', 'data', 'projects');
    if (isDirectory(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function loadCatalog(ctx: CommandContext): Promise<Project[]> {
  const assetsBaseUrl =
    flagString(ctx.args.flags, 'assets-base-url') ?? ctx.config.assetsBaseUrl ?? DEFAULTS.assetsBaseUrl;
  const source = resolveEditor({
    editorUrl: flagString(ctx.args.flags, 'editor-url') ?? ctx.config.editorUrl,
    cwd: ctx.root,
    assetsBaseUrl,
  });
  const manifest = loadManifest(manifestPath());
  const dirs = [
    ...(source.kind === 'local' ? [path.join(source.dir, 'data', 'projects')] : []),
    ...(findCheckoutTemplates(ctx.root) ? [findCheckoutTemplates(ctx.root)!] : []),
  ].filter((dir, index, all) => all.indexOf(dir) === index && isDirectory(dir));
  const tasks = TEMPLATE_CATEGORIES.flatMap((category) =>
    category.files.map((file) => ({ file, category: category.id }))
  );

  const loaded = await mapPooled(tasks, 12, async ({ file, category }): Promise<Project | null> => {
    const requestPath = `/data/projects/${file}`;
    let text: string | null = null;

    for (const dir of dirs) {
      const onDisk = path.join(dir, file);
      if (fs.existsSync(onDisk)) {
        text = fs.readFileSync(onDisk, 'utf8');
        break;
      }
    }
    if (text === null) {
      // Not on disk. If the packaged manifest knows the path it is cacheable
      // artwork and hydrate handles the digest check and the offline error.
      const hydrated = await hydrate(requestPath, { manifest, assetsBaseUrl, offline: ctx.offline });
      if (hydrated) text = hydrated.toString('utf8');
    }
    if (text === null) {
      if (ctx.offline) return null;
      const origin = source.kind === 'remote' ? source.origin : assetsBaseUrl.replace(/\/+$/, '');
      const response = await fetch(`${origin}${requestPath}`);
      if (!response.ok) {
        debug(`template ${file}: HTTP ${response.status}`);
        return null;
      }
      text = await response.text();
    }

    try {
      // A template file is either the whole Project object or a bare array of
      // artboards; both spellings exist in the catalog.
      const data = JSON.parse(text) as unknown;
      const record = Array.isArray(data) ? null : (data as Record<string, unknown>);
      const baseName = file.replace(/\.json$/, '');
      const displayName = baseName.charAt(0).toUpperCase() + baseName.slice(1);
      const name = (typeof record?.name === 'string' && record.name) || displayName;
      return {
        id: `template_${baseName}`,
        sourceId: typeof record?.id === 'string' ? record.id : undefined,
        name,
        description: (typeof record?.description === 'string' && record.description) || `${name} project template`,
        timestamp: new Date(),
        category,
        projectData: (Array.isArray(data) ? data : (record?.projectData ?? [])) as ArtboardState[],
      };
    } catch (error) {
      // One malformed file must not lose the other hundred, which is what the
      // app does with the same failure.
      debug(`template ${file}: ${(error as Error).message}`);
      return null;
    }
  });

  const templates = loaded.filter((entry): entry is Project => entry !== null && entry.projectData.length > 0);
  if (templates.length === 0) {
    throw driverError(
      'No templates could be loaded.',
      ctx.offline
        ? 'Run `osg cache warm` once with a network, or drop --offline.'
        : `Check the network, or point --assets-base-url at a mirror of ${assetsBaseUrl}.`
    );
  }
  debug(`catalog: ${templates.length} templates from ${dirs[0] ?? source.label}`);
  return templates;
}

const flatten = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

function findTemplate(templates: Project[], wanted: string): Project {
  const target = flatten(wanted);
  const exact = templates.find(
    (entry) =>
      flatten(entry.id) === target ||
      flatten(entry.sourceId ?? '') === target ||
      flatten(entry.id) === flatten(`template_${wanted}`) ||
      flatten(entry.name) === target
  );
  if (exact) return exact;
  const near = templates.filter((entry) => flatten(entry.id).includes(target) || flatten(entry.name).includes(target));
  if (near.length === 1) return near[0];
  throw usageError(
    `No template "${wanted}"`,
    near.length > 0
      ? `Did you mean: ${near.slice(0, 5).map((entry) => entry.id).join(', ')}? Run \`osg templates\` for the full list.`
      : 'Run `osg templates` for the list, or pass --template auto to rank the catalog against your screenshots.'
  );
}

function resolveFormat(
  raw: string | boolean | string[] | undefined,
  filled: Project,
  device: DeviceType
): DeviceFormatPreset | null {
  if (raw === false) return null;
  if (typeof raw === 'string') {
    const preset = DEVICE_FORMAT_PRESETS.find((entry) => entry.id === raw);
    if (!preset) {
      throw usageError(
        `No store format "${raw}"`,
        `Known formats: ${DEVICE_FORMAT_PRESETS.map((entry) => entry.id).join(', ')}. Pass --no-format to keep the template's own canvas.`
      );
    }
    return preset;
  }
  // The catalog is mostly iPhone, so an iPad or Android upload would otherwise
  // land in a layout that fits the screenshots and not the store. This is the
  // whole-project conversion the app offers in the same situation, and it
  // answers null whenever the template already speaks the right format.
  return suggestedFormat(filled, device);
}

const UNUSED_POLICIES: UnusedBoardPolicy[] = ['trim', 'keep', 'repeat'];

function resolveUnusedPolicy(raw: string | undefined): UnusedBoardPolicy {
  if (!raw) return 'trim';
  if ((UNUSED_POLICIES as string[]).includes(raw)) return raw as UnusedBoardPolicy;
  throw usageError(
    `No such --unused policy "${raw}"`,
    'trim drops boards nothing landed on, keep leaves the template demo screens in place, repeat cycles your screenshots until every frame is full.'
  );
}

export async function run(ctx: CommandContext): Promise<number> {
  const { flags } = ctx.args;
  const screenshotsFlag = flagString(flags, 'screenshots') ?? ctx.config.screenshots;
  if (!screenshotsFlag) {
    throw usageError(
      'osg fill needs screenshots',
      'Pass --screenshots <dir>, set `screenshots` in osg.config.ts, or run `osg import <your app>` to download the ones on your store listing.'
    );
  }
  const force = flagBool(flags, 'force', false);
  if (fs.existsSync(ctx.projectFile) && !force) {
    throw usageError(
      `A project already exists at ${ctx.projectFile}`,
      'Pass --force to replace it, or --project <path> to write somewhere else.'
    );
  }

  const { shots, store: importedStore, appName } = readShots(path.resolve(ctx.root, screenshotsFlag));
  const query = ctx.args.positionals.join(' ').trim() || flagString(flags, 'query');
  const accent = flagString(flags, 'accent') ?? null;
  const isDark = flagBool(flags, 'dark', false);

  const profile = buildIntakeProfile(
    shots.map((shot) => ({
      analysis: {
        device: shot.device,
        isDark,
        // No pixel decode off browser, so the only colour we can honestly claim
        // is one the user named. An empty palette simply drops the colour term
        // out of the score rather than matching everything at once.
        palette: accent ? [accent] : [],
      },
    })),
    { query }
  );

  step(`${shots.length} screenshots, ${shots[0].width} x ${shots[0].height}, reads as ${deviceLabel(profile.device)}`);
  if (!isDark) debug('assuming a light UI; pass --dark for a dark one');

  const templates = await loadCatalog(ctx);
  const wanted = flagString(flags, 'template') ?? ctx.config.template ?? 'auto';

  let chosen: Project;
  let ranking: TemplateScore[] = [];
  if (wanted === 'auto') {
    ranking = rankTemplates(buildTemplateIndex(templates), profile);
    if (ranking.length === 0) {
      throw usageError(
        'No template in the catalog can hold these screenshots.',
        'That normally means the shots read as a device the catalog has no layouts for. Name one with --template <slug>.'
      );
    }
    const top = ranking[0];
    const byId = new Map(templates.map((entry) => [entry.id, entry]));
    chosen = byId.get(top.entry.id)!;

    const shown = flagNumber(flags, 'top') ?? 5;
    info(`ranked ${ranking.length} templates${accent ? '' : ', colours skipped (nothing decodes pixels off browser)'}`);
    for (const [index, scored] of ranking.slice(0, Math.max(1, shown)).entries()) {
      const line = `  ${index === 0 ? '>' : ' '} ${String(Math.round(scored.score)).padStart(3)}  ${scored.entry.id}`;
      info(`${index === 0 ? bold(line) : line}  ${dim(scored.reasons.join(', '))}`);
    }
  } else {
    chosen = findTemplate(templates, wanted);
    const scored = rankTemplates([...buildTemplateIndex([chosen]).values()], profile);
    ranking = scored;
    step(`template ${chosen.id}`);
  }

  const chosenEntry = indexTemplate(chosen);
  if (chosenEntry.slots.length === 0) {
    throw usageError(
      `${chosen.name} has no device frames, so there is nowhere to put a screenshot.`,
      'App Preview templates play a recording instead. Pick another with `osg templates`, or use --template auto.'
    );
  }

  const placeable: PlaceableShot[] = shots.map((shot, index) => ({
    id: `shot_${index + 1}`,
    dataUrl: shot.dataUrl,
    width: shot.width,
    height: shot.height,
    device: shot.device,
  }));

  // fitTextBox measures with a DOM probe (src/lib/textFit.ts) and answers 0
  // when there is no document, so a headline set here grows no box: off browser
  // a long line can overflow the box the template author sized. That is why the
  // render pass re-fits in the page, where the real face, weight and tracking
  // are loaded and the measurement agrees with what the canvas will draw.
  const headline = flagString(flags, 'headline') ?? null;

  const result = fillTemplate(chosen, placeable, {
    unusedBoards: resolveUnusedPolicy(flagString(flags, 'unused')),
    // Off unless asked for, which is what the app's own quickstart defaults to:
    // the device is inferred from pixel dimensions, and re-skinning every frame
    // in a design on the strength of an aspect ratio guess is a big edit to
    // make on somebody's behalf. The format swap below is the safe half of it.
    matchDeviceType: flagBool(flags, 'match-device', false),
    accentColor: accent,
    headline,
    nameOverride: flagString(flags, 'name') ?? ctx.config.name ?? appName ?? undefined,
  });

  let preset = resolveFormat(flags.format, result.project, profile.device);
  // A store screenshot's dimensions are the store's, not a device's: Apple
  // renders a listing at whatever fits its box, and that reshaped aspect can
  // read as another platform's phone. Converting on that guess would hand an
  // App Store app a set of Play Store canvases. An explicit --format still wins.
  const storeFlag = flagString(flags, 'store');
  if (storeFlag && storeFlag !== 'appstore' && storeFlag !== 'play') {
    throw usageError(`No such store "${storeFlag}"`, 'Use --store appstore or --store play.');
  }
  // Validated just above, so the cast is a narrowing tsc cannot do on a string.
  const store: Store | null = (storeFlag as Store | undefined) ?? ctx.config.store ?? importedStore;
  if (preset && store && typeof flags.format !== 'string') {
    const apple = (APP_STORE_FORMAT_IDS as readonly string[]).includes(preset.id);
    if ((store === 'appstore') !== apple) {
      warn(`not converting to ${preset.label}: this project targets the ${store === 'appstore' ? 'App Store' : 'Play Store'}. Pass --format ${preset.id} to convert anyway`);
      preset = null;
    }
  }
  const project = preset ? applyFormat(result.project, preset) : result.project;
  if (preset) step(`converted to ${preset.label}, ${preset.artboard.width} x ${preset.artboard.height}`);

  // The catalog is overwhelmingly iPhone, so an iPad, watch or Mac upload can
  // win a design built for something else on capacity and mood alone. Say so:
  // a conversion covers the phone and tablet store formats and nothing else.
  if (!preset && chosenEntry.deviceCategory !== 'mixed' && chosenEntry.deviceCategory !== profile.category) {
    warn(
      `${chosen.name} is built around ${chosenEntry.deviceCategory} frames and your screenshots read as ${deviceLabel(profile.device)}. Pass --template <slug> for a different design, or --match-device to re-skin the frames`
    );
  }

  const boards = project.projectData;
  const file = {
    // A new id, not the template's. fillTemplate keeps the template id on
    // purpose so the app can report which design was used, but the id in a
    // project file is the project's own and would otherwise collide with the
    // template it came from.
    id: `project_${Date.now()}`,
    name: project.name,
    description: project.description,
    category: project.category,
    timestamp: new Date().toISOString(),
    projectData: boards,
    osg: {
      command: 'fill',
      createdAt: new Date().toISOString(),
      template: { id: chosen.id, name: chosen.name },
      device: profile.device,
      format: preset ? preset.id : null,
      screenshots: shots.map((shot) => ({
        file: path.relative(ctx.root, shot.file).split(path.sep).join('/'),
        width: shot.width,
        height: shot.height,
      })),
    },
  };

  fs.mkdirSync(path.dirname(ctx.projectFile), { recursive: true });
  fs.writeFileSync(ctx.projectFile, `${JSON.stringify(file, null, 2)}\n`);
  const bytes = fs.statSync(ctx.projectFile).size;

  if (ctx.json) {
    emit({
      command: 'fill',
      projectFile: ctx.projectFile,
      projectId: file.id,
      name: project.name,
      bytes,
      template: {
        id: chosen.id,
        name: chosen.name,
        score: ranking[0] ? Math.round(ranking[0].score) : null,
        reasons: ranking[0]?.reasons ?? [],
      },
      ranking: ranking.slice(0, flagNumber(flags, 'top') ?? 5).map((scored) => ({
        id: scored.entry.id,
        name: scored.entry.name,
        score: Math.round(scored.score),
        reasons: scored.reasons,
        slots: scored.entry.slots.length,
        fits: scored.fits,
      })),
      device: profile.device,
      format: preset ? { id: preset.id, ...preset.artboard } : null,
      artboards: boards.map((board) => ({ id: board.id, name: board.name, width: board.size.width, height: board.size.height })),
      screenshots: file.osg.screenshots,
      placed: result.placed,
      unfilled: result.unfilled,
      trimmed: result.trimmed,
      swapped: result.swapped,
    });
    return EXIT.ok;
  }

  if (result.unfilled > 0) {
    warn(`${result.unfilled} device ${result.unfilled === 1 ? 'frame is' : 'frames are'} still empty. Add more screenshots, or pass --unused repeat to cycle the ones you have`);
  }
  ok(`${project.name}, ${boards.length} boards, ${result.placed} screenshots placed`);
  if (result.trimmed > 0) info(`   ${result.trimmed} unused ${result.trimmed === 1 ? 'board' : 'boards'} dropped`);
  if (result.swapped > 0) info(`   ${result.swapped} frames re-skinned to ${deviceLabel(profile.device)}`);
  info(`   ${ctx.projectFile} (${humanBytes(bytes)})`);
  info('');
  info('Next: `osg render` for the store PNGs, or `osg studio` to open this in the editor');
  return EXIT.ok;
}

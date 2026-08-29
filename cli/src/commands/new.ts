/**
 * osg new: a project from a named template, with the user's screenshots in it.
 *
 * One tool call does the work. `create_project_from_template` copies the
 * template, fills the copy the user named, drops the screenshots into the
 * device frames, saves the project and opens it, which is the same function the
 * gallery calls when a person clicks a template. A project made here is
 * therefore indistinguishable from a clicked one, down to the element ids.
 *
 * The files are read from disk in node and decoded IN THE PAGE. Node has no
 * canvas, and the app caps an uploaded screenshot's long edge at the tallest
 * canvas it supports before storing it (STORAGE_MAX_EDGE in
 * src/lib/ai/imageUtils.ts). Decoding here would mean a second image pipeline
 * that can drift from the app's; decoding in the page means the bytes that land
 * in a device frame are the bytes an upload would have produced.
 *
 * The project file this writes carries those data URLs inline rather than the
 * `asset:<id>` references the page leaves behind, because the browser profile a
 * run uses is thrown away with the run. A project file has to open on a machine
 * that has never seen this session (see the read-back in `run` below).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ArtboardState, DeviceFrameElementProps } from '@/types/artboard';
import { flagBool, flagString } from '../args.js';
import type { CommandContext } from '../context.js';
import type { Session } from '../driver/session.js';
import { EXIT, driverError, usageError } from '../errors.js';
import { debug, emit, humanBytes, info, ok, step, warn } from '../log.js';

/** What the page can decode. Anything else is not a screenshot. */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.bmp']);

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
};

interface TemplateSummary {
  id: string;
  name: string;
  category: string;
  description: string;
  artboardCount: number;
  deviceSlotCount: number;
  width: number;
  height: number;
}

interface TemplateDetail extends TemplateSummary {
  artboards: Array<{
    index: number;
    name: string;
    width: number;
    height: number;
    deviceSlots: Array<{ elementId: string; deviceType: string; hasScreenshot: boolean }>;
    textSlots: Array<{ elementId: string; content: string }>;
  }>;
}

interface CreatedProject {
  projectId: string;
  name: string;
  artboards: Array<{ id: string; name: string; width: number; height: number }>;
  warnings: string[];
}

interface Ingested {
  dataUrl: string;
  width: number;
  height: number;
}

/** Files a user names 1, 2, 10 must not sort as 1, 10, 2. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function listScreenshots(target: string): string[] {
  const stat = fs.existsSync(target) ? fs.statSync(target) : null;
  if (!stat) {
    throw usageError(`No screenshots at ${target}`, 'Point --screenshots at a folder of PNG or JPEG captures, or run `osg import <your app>` to pull the ones already on your store listing.');
  }
  if (stat.isFile()) return [path.resolve(target)];
  const files = fs
    .readdirSync(target)
    .filter((name) => IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .sort(collator.compare)
    .map((name) => path.join(path.resolve(target), name));
  if (files.length === 0) {
    throw usageError(`No images in ${target}`, `Supported extensions: ${[...IMAGE_EXTENSIONS].join(', ')}.`);
  }
  return files;
}

/**
 * `--text hero_title=Track every run`.
 *
 * Read straight off the raw flags rather than through flagList, which splits on
 * commas: half the headlines anybody writes have a comma in them.
 */
function parseTextFlags(raw: string | boolean | string[] | undefined): { elementId: string; content: string }[] {
  if (raw === undefined || typeof raw === 'boolean') return [];
  const entries = Array.isArray(raw) ? raw : [raw];
  return entries.map((entry) => {
    const split = entry.indexOf('=');
    if (split <= 0) {
      throw usageError(`--text needs elementId=content, got "${entry}"`, 'Element ids come from `osg templates --template <slug>`, which lists every text slot.');
    }
    return { elementId: entry.slice(0, split).trim(), content: entry.slice(split + 1) };
  });
}

/** Ids differ by a hyphen or an underscore across the catalog, so compare flat. */
const flatten = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

function resolveTemplateId(templates: TemplateSummary[], wanted: string): TemplateSummary {
  const target = flatten(wanted);
  const exact = templates.find(
    (entry) => flatten(entry.id) === target || flatten(entry.id) === flatten(`template_${wanted}`) || flatten(entry.name) === target
  );
  if (exact) return exact;

  const near = templates
    .filter((entry) => flatten(entry.id).includes(target) || flatten(entry.name).includes(target))
    .slice(0, 5);
  if (near.length === 1) return near[0];
  throw usageError(
    `No template "${wanted}"`,
    near.length > 0
      ? `Did you mean: ${near.map((entry) => entry.id).join(', ')}? Run \`osg templates\` for the full list.`
      : 'Run `osg templates` to list all 101, or `osg fill` to rank them against your screenshots automatically.'
  );
}

/**
 * Decode one image in the page and hand back a storable data URL.
 *
 * The expression is built as a string because session.evaluate takes one: with
 * a string body puppeteer sends Runtime.evaluate and drops any arguments, so
 * the source URL is inlined rather than passed.
 *
 * The long edge cap mirrors STORAGE_MAX_EDGE in src/lib/ai/imageUtils.ts, and
 * the "only re-encode when we actually scaled" rule mirrors it too: re-encoding
 * a PNG that did not need resizing is lossless but routinely doubles its size.
 */
async function ingest(session: Session, source: string): Promise<Ingested> {
  return session.evaluate<Ingested>(`(async () => {
    const response = await fetch(${JSON.stringify(source)});
    if (!response.ok) throw new Error('fetch failed with ' + response.status);
    const blob = await response.blob();
    let bitmap;
    try {
      bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch (error) {
      bitmap = await createImageBitmap(blob);
    }
    const width = bitmap.width;
    const height = bitmap.height;
    const longest = Math.max(width, height);
    const factor = longest > 2796 ? 2796 / longest : 1;
    const keepable = blob.type === 'image/png' || blob.type === 'image/jpeg' || blob.type === 'image/webp';
    let dataUrl;
    if (factor < 1 || !keepable) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * factor));
      canvas.height = Math.max(1, Math.round(height * factor));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('this browser gave no 2d context');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      dataUrl = canvas.toDataURL('image/png');
    } else {
      dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('the browser could not read the blob'));
        reader.readAsDataURL(blob);
      });
    }
    if (bitmap.close) bitmap.close();
    return { dataUrl, width, height };
  })()`);
}

/**
 * Wait until the page's own status agrees the new project is open.
 *
 * createProjectFromTemplate returns before React has re-rendered, and every
 * read tool closes over the render it was built in, so a get_artboard fired
 * straight after the create can answer with the state from before it.
 */
async function waitForProject(session: Session, projectId: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const status = await session.status();
    if (status.projectId === projectId) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw driverError(
    'The editor created the project but never opened it.',
    'Re-run with --verbose to see the page console, or with --headed to watch it.'
  );
}

export async function run(ctx: CommandContext): Promise<number> {
  const { flags } = ctx.args;
  const wanted = flagString(flags, 'template') ?? ctx.args.positionals[0] ?? ctx.config.template;
  if (!wanted || wanted === 'auto') {
    throw usageError(
      'osg new needs a template',
      'Pass --template <slug> (see `osg templates`), or run `osg fill` to rank the catalog against your screenshots and pick for you.'
    );
  }

  const screenshotsFlag = flagString(flags, 'screenshots') ?? ctx.config.screenshots;
  const files = screenshotsFlag ? listScreenshots(path.resolve(ctx.root, screenshotsFlag)) : [];
  const texts = parseTextFlags(flags.text);
  const force = flagBool(flags, 'force', false);

  if (fs.existsSync(ctx.projectFile) && !force) {
    throw usageError(
      `A project already exists at ${ctx.projectFile}`,
      'Pass --force to replace it, or --project <path> to write somewhere else.'
    );
  }

  const session = await ctx.session();

  const templates = (await session.call('list_templates')) as TemplateSummary[];
  const summary = resolveTemplateId(templates, wanted);
  const detail = (await session.call('get_template', { templateId: summary.id })) as TemplateDetail;

  // Slots in reading order, which is the order src/lib/intake/autoFill.ts walks
  // them in, so a screenshot lands in the same frame whichever path placed it.
  const slots = detail.artboards.flatMap((board) => board.deviceSlots);
  if (files.length > slots.length) {
    warn(`${detail.name} holds ${slots.length} screenshots, you have ${files.length}. The extra ${files.length - slots.length} are not placed`);
  } else if (files.length > 0 && files.length < slots.length) {
    warn(`${detail.name} has ${slots.length} device frames and you have ${files.length} screenshots, so ${slots.length - files.length} keep the template's demo screen`);
  } else if (files.length === 0) {
    info(`no screenshots given, so all ${slots.length} frames keep the template's demo screens`);
  }

  step(`template ${summary.id}, ${detail.artboardCount} boards, ${slots.length} device frames`);

  const placed: { file: string; elementId: string; width: number; height: number; dataUrl: string }[] = [];
  for (const [index, file] of files.slice(0, slots.length).entries()) {
    // A local file reaches the page over the run's own origin. With
    // --editor-url there is no origin of ours to serve from, so the bytes ride
    // in as a data URL instead and the page decodes that.
    const source = session.server
      ? session.serveFile(file)
      : `data:${MIME_BY_EXTENSION[path.extname(file).toLowerCase()] ?? 'image/png'};base64,${fs.readFileSync(file).toString('base64')}`;
    const image = await ingest(session, source);
    debug(`ingested ${path.basename(file)} at ${image.width}x${image.height}`);
    placed.push({ file, elementId: slots[index].elementId, width: image.width, height: image.height, dataUrl: image.dataUrl });
    info(`  ${index + 1}. ${path.basename(file)} into ${slots[index].deviceType}`);
  }

  const name = flagString(flags, 'name') ?? ctx.config.name;
  step(`creating ${name ?? `${detail.name} Copy`}`);
  const created = (await session.call('create_project_from_template', {
    templateId: summary.id,
    ...(name ? { name } : {}),
    ...(texts.length > 0 ? { texts } : {}),
    ...(placed.length > 0 ? { screenshots: placed.map((entry) => ({ elementId: entry.elementId, src: entry.dataUrl })) } : {}),
  })) as CreatedProject;

  for (const warning of created.warnings ?? []) warn(warning);

  await waitForProject(session, created.projectId);

  // Read the finished boards back out of the app rather than rebuilding them
  // here: the copy went through calculateArtboardPositions and any locale
  // mirroring on the way in, and only the app knows what that produced.
  const boards: ArtboardState[] = [];
  for (const board of created.artboards) {
    const state = (await session.call('get_artboard', { artboardId: board.id })) as ArtboardState & { active?: boolean };
    delete state.active;
    boards.push(state);
  }

  // Put the inline images back. The page moved them into its own media table on
  // save and left `asset:<id>` behind (src/lib/externalizeInlineMedia.ts), which
  // is right for a browser and useless in a file: that table dies with the
  // profile. Loading this file anywhere externalizes it again.
  const byElementId = new Map(placed.map((entry) => [entry.elementId, entry]));
  for (const board of boards) {
    for (const element of board.elements ?? []) {
      if (element.type !== 'device') continue;
      const entry = byElementId.get(element.id);
      if (!entry) continue;
      const device = element as DeviceFrameElementProps;
      device.screenshotSrc = entry.dataUrl;
      device.naturalScreenshotWidth = entry.width;
      device.naturalScreenshotHeight = entry.height;
    }
  }

  const project = {
    id: created.projectId,
    name: created.name,
    description: detail.description,
    category: detail.category,
    timestamp: new Date().toISOString(),
    projectData: boards,
    // Provenance, so `osg manifest` and a person reading a diff six months from
    // now can both tell where this came from without opening the editor.
    osg: {
      command: 'new',
      createdAt: new Date().toISOString(),
      template: { id: summary.id, name: summary.name },
      screenshots: placed.map((entry) => ({
        file: path.relative(ctx.root, entry.file).split(path.sep).join('/'),
        elementId: entry.elementId,
        width: entry.width,
        height: entry.height,
      })),
    },
  };

  fs.mkdirSync(path.dirname(ctx.projectFile), { recursive: true });
  fs.writeFileSync(ctx.projectFile, `${JSON.stringify(project, null, 2)}\n`);
  const bytes = fs.statSync(ctx.projectFile).size;
  if (bytes > 25 * 1024 * 1024) {
    warn(`the project file is ${humanBytes(bytes)}, almost all of it screenshot data. Smaller captures make every later run faster`);
  }

  if (ctx.json) {
    emit({
      command: 'new',
      projectFile: ctx.projectFile,
      projectId: created.projectId,
      name: created.name,
      bytes,
      template: { id: summary.id, name: summary.name, boards: detail.artboardCount, slots: slots.length },
      artboards: boards.map((board) => ({ id: board.id, name: board.name, width: board.size.width, height: board.size.height })),
      screenshots: project.osg.screenshots,
      unfilled: Math.max(0, slots.length - placed.length),
      warnings: created.warnings ?? [],
    });
    return EXIT.ok;
  }

  ok(`${created.name}, ${boards.length} boards, ${placed.length} screenshots placed`);
  info(`   ${ctx.projectFile} (${humanBytes(bytes)})`);
  info('');
  info('Next: `osg render` for the store PNGs, or `osg studio` to open this in the editor');
  return EXIT.ok;
}

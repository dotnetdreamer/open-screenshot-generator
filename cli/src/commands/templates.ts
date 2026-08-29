/**
 * `osg templates`: list and search the 101 bundled templates, with no browser.
 *
 * This is the command an agent runs before it builds anything, so it has to be
 * fast and it has to be honest. Fast means never booting Chrome: the template
 * JSONs ship inside the package, so the listing is a directory read. Honest
 * means the ids, names and slot counts here are the ones the rest of the
 * pipeline uses, which is why the loading mirrors loadProjectTemplates in
 * src/services/projectService.ts (catalog order, template_<basename> ids, the
 * same name and description fallbacks) and the slot counts come from
 * buildTemplateCatalog rather than from a second walk of the element tree.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { CommandContext } from '../context.js';
import { flagString } from '../args.js';
import { DEFAULTS } from '../config.js';
import { EXIT, usageError } from '../errors.js';
import { info, step, warn, debug, emit, bold, dim, cyan } from '../log.js';
import { resolveEditor, manifestPath } from '../editor/resolve.js';
import { loadManifest, hydrate, type AssetManifest } from '../editor/assets.js';
import { TEMPLATE_CATEGORIES } from '@/lib/templateCategories';
import { buildTemplateCatalog, countDeviceSlots } from '@/lib/ai/templateCatalog';
import type { Project } from '@/types/artboard';

/**
 * buildTemplateCatalog hides App Preview templates, because the agent it feeds
 * cannot supply the screen recording they are built around. A listing is not
 * an agent, so every template is handed over under one placeholder category
 * and the real one is put back on the row afterwards.
 */
const LISTING_CATEGORY = 'listing';

const DESCRIPTION_LIMIT = 20;

interface Row {
  id: string;
  sourceId: string | null;
  name: string;
  category: string;
  categoryLabel: string;
  description: string;
  file: string;
  boards: number;
  width: number;
  height: number;
  deviceSlots: number;
  textSlots: number;
  /** Everything searchable about the template, lowercased once. */
  haystack: string;
}

export async function run(ctx: CommandContext): Promise<number> {
  const dirs = templateDirs(ctx);
  const manifest = loadManifest(manifestPath());
  const assetsBaseUrl =
    flagString(ctx.args.flags, 'assets-base-url') ?? ctx.config.assetsBaseUrl ?? DEFAULTS.assetsBaseUrl;

  if (dirs.length === 0 && Object.keys(manifest.entries).length === 0) {
    throw usageError('No template files are reachable.', 'Reinstall the package, or point OSG_EDITOR_DIR at a build of the editor.');
  }
  debug(`template dirs: ${dirs.join(', ') || 'none, manifest only'}`);

  const rows: Row[] = [];
  const unreadable: string[] = [];

  for (const category of TEMPLATE_CATEGORIES) {
    for (const filename of category.files) {
      const raw = await readTemplate(filename, dirs, { manifest, assetsBaseUrl, offline: ctx.offline });
      if (!raw) {
        unreadable.push(filename);
        continue;
      }
      rows.push(toRow(filename, category.id, category.label, raw));
    }
  }

  if (unreadable.length) {
    // projectService warns and drops a template it cannot load, and so does
    // this, but it says how many rather than losing them silently.
    warn(`${unreadable.length} of ${unreadable.length + rows.length} templates could not be read`);
    info(dim(`     Run \`osg cache warm\` to fetch them, or check ${dirs[0] ?? 'the editor directory'}`));
  }

  const total = rows.length;
  const query = ctx.args.positionals.join(' ').trim();
  const categoryFilter = flagString(ctx.args.flags, 'category');
  const matched = filterRows(rows, query, categoryFilter);

  if (ctx.json) {
    emit({
      total,
      count: matched.length,
      query: query || null,
      category: categoryFilter ?? null,
      categories: TEMPLATE_CATEGORIES.map((c) => ({ id: c.id, label: c.label, count: c.files.length })),
      templates: matched.map(({ haystack, ...row }) => row),
    });
    return EXIT.ok;
  }

  render(matched, total, query, categoryFilter);
  return EXIT.ok;
}

// ---------------------------------------------------------------------------

function render(rows: Row[], total: number, query: string, categoryFilter: string | undefined): void {
  const scope = [query ? `matching "${query}"` : '', categoryFilter ? `in ${categoryFilter}` : '']
    .filter(Boolean)
    .join(' ');

  if (rows.length === 0) {
    step(`no templates ${scope || 'found'}`);
    info(dim(`     ${total} templates in total. Categories: ${TEMPLATE_CATEGORIES.map((c) => c.id).join(', ')}`));
    return;
  }

  step(rows.length === total ? `${total} templates` : `${rows.length} of ${total} templates ${scope}`);
  info('');

  const idWidth = Math.max(...rows.map((r) => r.id.length));
  const nameWidth = Math.max(...rows.map((r) => Math.min(r.name.length, 28)));
  const categoryWidth = Math.max(...rows.map((r) => r.category.length));
  const withDescription = rows.length <= DESCRIPTION_LIMIT;

  for (const row of rows) {
    const facts = [
      `${row.boards} board${row.boards === 1 ? '' : 's'}`,
      `${row.width}x${row.height}`,
      `${row.deviceSlots} device${row.deviceSlots === 1 ? '' : 's'}`,
      `${row.textSlots} text${row.textSlots === 1 ? '' : 's'}`,
    ].join('  ');
    info(
      `${cyan(row.id.padEnd(idWidth))}  ${bold(clip(row.name, 28).padEnd(nameWidth))}  ${dim(
        row.category.padEnd(categoryWidth)
      )}  ${facts}`
    );
    if (withDescription && row.description) info(dim(`  ${clip(row.description, 96)}`));
  }

  if (rows.some((row) => row.category === 'app-preview')) {
    // Their mockups are video-device elements, so the catalog counts no device
    // slots and a reader would otherwise think the template is empty.
    info('');
    info(dim('App Preview boards play a screen recording rather than holding screenshots, so they report 0 device slots'));
  }

  info('');
  info(`Use one: ${cyan(`osg new --template ${rows[0].id}`)}`);
  info(dim('     Search with `osg templates <words>`, narrow with --category, script it with --json'));
}

function filterRows(rows: Row[], query: string, categoryFilter: string | undefined): Row[] {
  let matched = rows;

  if (categoryFilter) {
    const wanted = categoryFilter.trim().toLowerCase();
    matched = matched.filter(
      (row) => row.category.toLowerCase().startsWith(wanted) || row.categoryLabel.toLowerCase().includes(wanted)
    );
  }

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length) {
    // Every term has to hit, so "dark finance" narrows rather than widens.
    matched = matched.filter((row) => terms.every((term) => row.haystack.includes(term)));
  }

  return matched;
}

function toRow(filename: string, categoryId: string, categoryLabel: string, raw: unknown): Row {
  const baseName = filename.replace(/\.json$/, '');
  const displayName = baseName.charAt(0).toUpperCase() + baseName.slice(1);
  const isArray = Array.isArray(raw);
  const record = (isArray ? {} : (raw as Record<string, unknown>)) ?? {};
  const name = (typeof record.name === 'string' && record.name) || displayName;
  const description = (typeof record.description === 'string' && record.description) || `${name} project template`;
  const artboards = (isArray ? raw : record.projectData) ?? [];

  const project = {
    id: `template_${baseName}`,
    sourceId: typeof record.id === 'string' ? record.id : undefined,
    name,
    description,
    timestamp: new Date(),
    category: LISTING_CATEGORY,
    projectData: artboards,
  } as unknown as Project;

  const entry = buildTemplateCatalog([project])[0];
  const textSlots = entry.artboards.reduce((sum, board) => sum + board.textSlots.length, 0);
  const first = entry.artboards.length ? project.projectData[0] : undefined;
  const copy = entry.artboards
    .flatMap((board) => board.textSlots.map((slot) => slot.text))
    .join(' ');

  return {
    id: entry.id,
    sourceId: project.sourceId ?? null,
    name: entry.name,
    category: categoryId,
    categoryLabel,
    description: entry.description,
    file: filename,
    boards: entry.artboards.length,
    width: first?.size?.width ?? 0,
    height: first?.size?.height ?? 0,
    deviceSlots: countDeviceSlots(entry),
    textSlots,
    // The headlines are the most useful thing to search on: people look for
    // "sleep tracking" and not for "somnia".
    haystack: `${entry.id} ${entry.name} ${entry.description} ${categoryId} ${categoryLabel} ${copy}`.toLowerCase(),
  };
}

/**
 * Where the template JSONs live, most authoritative first: the editor bundle
 * this run would actually drive, then a repository checkout, so a contributor
 * editing public/data/projects sees the edit without rebuilding.
 */
function templateDirs(ctx: CommandContext): string[] {
  const dirs: string[] = [];
  const editor = resolveEditor({
    editorUrl: flagString(ctx.args.flags, 'editor-url') ?? ctx.config.editorUrl,
    cwd: ctx.root,
    assetsBaseUrl: ctx.config.assetsBaseUrl ?? DEFAULTS.assetsBaseUrl,
  });
  if (editor.kind === 'local') dirs.push(path.join(editor.dir, 'data', 'projects'));

  const checkout = findCheckoutTemplates(ctx.root);
  if (checkout) dirs.push(checkout);

  return dirs.filter((dir, index) => dirs.indexOf(dir) === index && isDirectory(dir));
}

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

interface HydrateContext {
  manifest: AssetManifest;
  assetsBaseUrl: string;
  offline: boolean;
}

async function readTemplate(filename: string, dirs: string[], context: HydrateContext): Promise<unknown | null> {
  for (const dir of dirs) {
    const file = path.join(dir, filename);
    try {
      if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      debug(`${filename}: ${(error as Error).message}`);
      return null;
    }
  }

  // Nothing on disk. The manifest may still know the path, which is the case
  // when the CLI is driving a remote editor, so fetch it the same way the
  // local server would and let the digest check catch a version mismatch.
  try {
    const body = await hydrate(`/data/projects/${filename}`, context);
    return body ? (JSON.parse(body.toString('utf8')) as unknown) : null;
  } catch (error) {
    debug(`${filename}: ${(error as Error).message}`);
    return null;
  }
}

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
}

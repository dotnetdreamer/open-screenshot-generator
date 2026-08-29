/**
 * osg call: one tool call, the raw JSON result on stdout, nothing else.
 *
 * This is the escape hatch. An agent with no MCP support at all still has the
 * whole 49-tool design surface from a single Bash call, and a shell script can
 * pipe the answer into jq. Everything human goes to stderr so that stdout stays
 * exactly one JSON document.
 *
 *   osg call list_artboards
 *   osg call add_element '{"type":"text","text":"Track every run"}'
 *   echo '{"artboardId":"ab_1"}' | osg call get_artboard
 *   osg call --list
 *
 * A one-shot call is usually a question, so the project is opened for the tool
 * to read but is not written back unless --save says so. `osg edit` is the
 * command that persists, and the asymmetry keeps `osg call list_fonts` from
 * rewriting a committed file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { flagBool, flagString } from '../args.js';
import type { CommandContext } from '../context.js';
import type { Session } from '../driver/session.js';
import { EXIT, OsgError, usageError } from '../errors.js';
import { debug, dim, emit, fail, info, warn } from '../log.js';

export async function run(ctx: CommandContext): Promise<number> {
  const flags = ctx.args.flags;

  if (flagBool(flags, 'list', false)) return listTools(ctx);

  const tool = ctx.args.positionals[0] ?? flagString(flags, 'tool');
  if (!tool) {
    throw usageError('osg call needs a tool name', 'Try: osg call list_artboards, or osg call --list to see them all.');
  }

  const inline = ctx.args.positionals[1] ?? flagString(flags, 'args');
  const raw = inline ?? (await readStdin());
  const args = raw && raw.trim() ? parseArgs(raw) : {};

  const session = await ctx.session();
  await openProjectFile(ctx, session);

  let result: unknown;
  try {
    result = await session.call(tool, args);
  } catch (error) {
    // The app's own message, unchanged: it names the artboard that does not
    // exist or the property that was rejected, and rewording it would only
    // make it harder to act on.
    fail(error instanceof Error ? error.message : String(error));
    if (error instanceof OsgError && error.code === EXIT.usage) return EXIT.usage;
    return EXIT.driver;
  }

  if (flagBool(flags, 'save', false)) {
    const file = await writeProjectFile(ctx, session);
    info(dim(`project: ${file}`));
  }

  emit(result);
  return EXIT.ok;
}

async function listTools(ctx: CommandContext): Promise<number> {
  const session = await ctx.session();
  const tools = (await session.listTools()).slice().sort((a, b) => a.name.localeCompare(b.name));

  if (ctx.json) {
    emit({ ok: true, command: 'call', tools: tools.map((tool) => ({ name: tool.name, description: oneLine(tool.description) })) });
    return EXIT.ok;
  }

  const width = tools.reduce((longest, tool) => Math.max(longest, tool.name.length), 0);
  for (const tool of tools) info(`${tool.name.padEnd(width)}  ${dim(oneLine(tool.description))}`);
  info(dim(`${tools.length} tools, call one with: osg call <tool> '<json>'`));
  return EXIT.ok;
}

/** First sentence of a tool's description, short enough for one terminal row. */
function oneLine(description: string): string {
  const text = (description ?? '').replace(/\s+/g, ' ').trim();
  const stop = text.indexOf('. ');
  const first = stop === -1 ? text : text.slice(0, stop + 1);
  return first.length > 110 ? `${first.slice(0, 107)}...` : first;
}

function parseArgs(raw: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw usageError(
      `The arguments are not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      'Quote the whole object, for example: osg call add_element \'{"type":"text","text":"Hi"}\'.'
    );
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw usageError('The arguments have to be a JSON object', 'For example \'{"artboardId":"ab_1"}\'.');
  }
  return value as Record<string, unknown>;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

// --- the project file -------------------------------------------------------

/**
 * A headless browser starts with an empty document, so a tool would answer
 * about nothing unless the project is opened first. Missing is not an error
 * here: list_templates and list_fonts are perfectly good questions to ask in a
 * directory that has no project yet.
 */
async function openProjectFile(ctx: CommandContext, session: Session): Promise<void> {
  const file = ctx.projectFile;
  if (!fs.existsSync(file)) {
    debug(`no project at ${file}`);
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw usageError(
      `${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      'Fix the file, or re-create it with osg new.'
    );
  }

  const record = Array.isArray(parsed) ? { projectData: parsed } : ((parsed ?? {}) as Record<string, unknown>);
  const data = record.projectData;
  if (!Array.isArray(data)) {
    throw usageError(`${file} has no projectData array`, 'A project file is {"id","name","timestamp","projectData"}.');
  }
  const name = typeof record.name === 'string' ? record.name : ctx.config.name ?? path.basename(file, path.extname(file));
  const id = typeof record.id === 'string' ? record.id : `project_${Date.now()}`;

  // The driver hands page.evaluate a string, so the document travels as a
  // literal in the expression rather than as an argument.
  const script = `(async () => {
    const bridge = window.__osg;
    if (!bridge || typeof bridge.loadProject !== 'function') return false;
    return await bridge.loadProject(${JSON.stringify(data)}, ${JSON.stringify(name)}, ${JSON.stringify(id)});
  })()`;
  const opened = await session.evaluate<boolean>(script);
  if (!opened) warn(`the editor refused to open ${file}, the tool will see an empty document`);
}

/** Rebuilt from the live boards: no tool hands back a whole project. */
async function writeProjectFile(ctx: CommandContext, session: Session): Promise<string> {
  const status = await session.status();
  const projectData: unknown[] = [];
  for (const board of status.artboards) {
    const full = (await session.call('get_artboard', { artboardId: board.id })) as Record<string, unknown>;
    const state = { ...full };
    // `active` is a view flag the tool adds, not part of the document.
    delete state.active;
    projectData.push(state);
  }

  const file = ctx.projectFile;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `${JSON.stringify(
      {
        id: status.projectId ?? `project_${Date.now()}`,
        name: status.projectName || ctx.config.name || 'Project',
        timestamp: new Date().toISOString(),
        projectData,
      },
      null,
      2
    )}\n`,
    'utf8'
  );
  return file;
}

/**
 * osg edit: run design-tool calls against the open project.
 *
 * This is the batch form of `osg call`, and the one an agent reaches for when
 * it has a plan rather than a question: a script of forty edits runs in one
 * browser start instead of forty.
 *
 * The calls are executed strictly in order, one at a time, and that is not a
 * politeness. The app's MCP api closes over the artboards of the render that
 * produced it, so two mutations dispatched in the same tick both read the
 * pre-change state and the second silently clobbers the first: forty edits
 * would land as one. The driver's queue already serialises everything through
 * window.__osg, and this command never gets ahead of it by awaiting each call
 * before it forms the next.
 *
 * Three ways in, because agents write all three:
 *   --tool <name> --args '<json>'
 *   --script <file>     a JSON array of {tool, args}, or NDJSON, one per line
 *   --stdin             the same content on stdin
 */
import fs from 'node:fs';
import path from 'node:path';
import { flagBool, flagString } from '../args.js';
import type { CommandContext } from '../context.js';
import type { Session } from '../driver/session.js';
import { EXIT, OsgError, usageError } from '../errors.js';
import { debug, dim, emit, fail, humanMs, info, ok, step, warn } from '../log.js';

interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

interface CallOutcome {
  index: number;
  tool: string;
  ok: boolean;
  ms: number;
  result?: unknown;
  error?: string;
}

export async function run(ctx: CommandContext): Promise<number> {
  const flags = ctx.args.flags;
  const calls = await collectCalls(ctx);
  const keepGoing = flagBool(flags, 'continue-on-error', false);
  const save = flagBool(flags, 'save', true);

  const session = await ctx.session();
  const loaded = await openProjectFile(ctx, session);

  step(`edit: ${calls.length} call${calls.length === 1 ? '' : 's'}`);
  const startedAt = Date.now();
  const outcomes: CallOutcome[] = [];
  let failed = 0;

  for (const [index, call] of calls.entries()) {
    const label = `${index + 1}/${calls.length} ${call.tool}`;
    const at = Date.now();
    try {
      const result = await session.call(call.tool, call.args);
      const ms = Date.now() - at;
      outcomes.push({ index: index + 1, tool: call.tool, ok: true, ms, result });
      ok(`${label} ${dim(humanMs(ms))}`);
      debug(typeof result === 'string' ? result : JSON.stringify(result));
    } catch (error) {
      const ms = Date.now() - at;
      const message = error instanceof Error ? error.message : String(error);
      outcomes.push({ index: index + 1, tool: call.tool, ok: false, ms, error: message });
      failed += 1;
      fail(`${label}: ${message}`);
      // A script is a plan: once one step of it did not happen, every later
      // step is working from a document nobody described. Stopping is the safe
      // default, and --continue-on-error is the explicit opt out.
      if (!keepGoing) break;
    }
  }

  const succeeded = outcomes.filter((outcome) => outcome.ok).length;
  let saved: string | null = null;
  // Nothing changed means nothing to write, and rewriting the file after a run
  // that only failed would churn the diff for no reason.
  if (save && succeeded > 0) saved = await writeProjectFile(ctx, session, loaded?.name);

  const status = await session.status();
  info(
    `${succeeded} ok, ${failed} failed, ${outcomes.length} of ${calls.length} run in ${humanMs(Date.now() - startedAt)}`
  );
  if (saved) info(`project: ${saved}`);
  else if (!save) info(dim('project not written, --no-save'));

  if (ctx.json) {
    emit({
      ok: failed === 0,
      command: 'edit',
      calls: outcomes,
      ran: outcomes.length,
      planned: calls.length,
      failed,
      project: saved,
      artboards: status.artboards,
      durationMs: Date.now() - startedAt,
    });
  }

  // The per-call FAIL lines already carry the app's own message, so a throw
  // here would only repeat one of them and lose the rest of the run.
  return failed === 0 ? EXIT.ok : EXIT.driver;
}

// --- input ------------------------------------------------------------------

async function collectCalls(ctx: CommandContext): Promise<ToolCall[]> {
  const flags = ctx.args.flags;
  const tool = flagString(flags, 'tool');
  const script = flagString(flags, 'script');
  const stdin = flagBool(flags, 'stdin', false);

  const modes = [tool ? '--tool' : null, script ? '--script' : null, stdin ? '--stdin' : null].filter(Boolean);
  if (modes.length === 0) {
    throw usageError(
      'osg edit needs something to run',
      'Use --tool <name> --args \'<json>\', --script <file>, or --stdin.'
    );
  }
  if (modes.length > 1) {
    throw usageError(`osg edit takes one input, got ${modes.join(' and ')}`, 'Pick one of --tool, --script or --stdin.');
  }

  if (tool) {
    const raw = flagString(flags, 'args');
    return [{ tool, args: raw ? parseArgsJson(raw, '--args') : {} }];
  }

  if (script) {
    const file = path.resolve(ctx.root, script);
    if (!fs.existsSync(file)) {
      throw usageError(`Script not found: ${file}`, 'Pass --script <path> to a JSON array or an NDJSON file.');
    }
    return parseScript(fs.readFileSync(file, 'utf8'), file);
  }

  const text = await readStdin();
  if (!text.trim()) {
    throw usageError('Nothing arrived on stdin', 'Pipe a JSON array or NDJSON in, or use --script <file>.');
  }
  return parseScript(text, 'stdin');
}

function parseArgsJson(raw: string, where: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw usageError(
      `${where} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      'Quote the whole object, for example --args \'{"text":"Hello"}\'.'
    );
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw usageError(`${where} has to be a JSON object`, 'For example --args \'{"artboardId":"ab_1"}\'.');
  }
  return value as Record<string, unknown>;
}

/**
 * A JSON array, a single object, or NDJSON. Agents produce all three, and the
 * difference between them is not worth an error message.
 */
function parseScript(text: string, source: string): ToolCall[] {
  const trimmed = text.trim();
  if (!trimmed) throw usageError(`${source} is empty`, 'Write a JSON array of {tool, args} entries.');

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      // A file of one JSON object per line also starts with '{', so a failed
      // parse here is not yet an error: fall through to the line reader.
      if (!trimmed.startsWith('{')) {
        throw usageError(
          `${source} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
          'Write a JSON array of {tool, args} entries, or one JSON object per line.'
        );
      }
      parsed = undefined;
    }
    if (parsed !== undefined) {
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return list.map((entry, index) => toCall(entry, `${source} entry ${index + 1}`));
    }
  }

  return trimmed
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    // `#` and `//` let a generated script carry a note about what it is doing.
    .filter((entry) => entry.line && !entry.line.startsWith('#') && !entry.line.startsWith('//'))
    .map((entry) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(entry.line);
      } catch (error) {
        throw usageError(
          `${source} line ${entry.number} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
          'Each line is one {"tool": "...", "args": {...}} object.'
        );
      }
      return toCall(parsed, `${source} line ${entry.number}`);
    });
}

/** Accepts {tool, args} and the JSON-RPC spelling {name, arguments}. */
function toCall(entry: unknown, where: string): ToolCall {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw usageError(`${where} is not an object`, 'Each entry is {"tool": "...", "args": {...}}.');
  }
  const record = entry as Record<string, unknown>;
  const tool = typeof record.tool === 'string' ? record.tool : typeof record.name === 'string' ? record.name : '';
  if (!tool) {
    throw usageError(`${where} has no tool name`, 'Each entry needs a "tool" (or "name") string.');
  }
  const rawArgs = record.args ?? record.arguments ?? {};
  if (!rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs)) {
    throw usageError(`${where} has args that are not an object`, 'Use "args": {} for a tool that takes nothing.');
  }
  return { tool, args: rawArgs as Record<string, unknown> };
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

// --- the project file -------------------------------------------------------

interface LoadedProject {
  id: string;
  name: string;
  data: unknown[];
}

/**
 * A headless browser starts with an empty document and no IndexedDB, so "the
 * open project" only exists if this command opens it. The bridge's loadProject
 * is the same call the editor makes when you open a project from the start
 * screen, so the tools see exactly what a person would see.
 */
async function openProjectFile(ctx: CommandContext, session: Session): Promise<LoadedProject | null> {
  const file = ctx.projectFile;
  if (!fs.existsSync(file)) {
    warn(`no project at ${file}, editing the empty document`);
    return null;
  }

  const project = readProjectFile(file, ctx.config.name);
  // page.evaluate is handed a string by the driver, so the document travels as
  // a literal in the expression rather than as an argument.
  const script = `(async () => {
    const bridge = window.__osg;
    if (!bridge || typeof bridge.loadProject !== 'function') return false;
    return await bridge.loadProject(${JSON.stringify(project.data)}, ${JSON.stringify(project.name)}, ${JSON.stringify(
      project.id
    )});
  })()`;
  const opened = await session.evaluate<boolean>(script);
  if (!opened) {
    throw new OsgError(`The editor refused to open ${file}`, {
      code: EXIT.driver,
      fix: 'The project file may be from a newer app version, or its artboards may be malformed.',
    });
  }
  info(dim(`  project: ${file}, ${project.data.length} boards`));
  return project;
}

function readProjectFile(file: string, configName: string | undefined): LoadedProject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw usageError(
      `${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      'Fix the file, or re-create it with osg new.'
    );
  }

  const fallbackName = configName ?? path.basename(file, path.extname(file));
  if (Array.isArray(parsed)) {
    // A bare array of artboards is what a hand-written or exported document
    // often is, and refusing it would help nobody.
    return { id: `project_${Date.now()}`, name: fallbackName, data: parsed };
  }
  const record = (parsed ?? {}) as Record<string, unknown>;
  const data = record.projectData;
  if (!Array.isArray(data)) {
    throw usageError(`${file} has no projectData array`, 'A project file is {"id","name","timestamp","projectData"}.');
  }
  return {
    id: typeof record.id === 'string' ? record.id : `project_${Date.now()}`,
    name: typeof record.name === 'string' ? record.name : fallbackName,
    data,
  };
}

/**
 * Rebuilt from the live boards, because no tool hands back a whole project:
 * status() for the ids, get_artboard for each one's full state.
 */
async function writeProjectFile(ctx: CommandContext, session: Session, name: string | undefined): Promise<string> {
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
        name: name ?? status.projectName ?? ctx.config.name ?? 'Project',
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

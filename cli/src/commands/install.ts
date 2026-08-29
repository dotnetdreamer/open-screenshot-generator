/**
 * `osg install` - put this package's MCP server into a coding agent's config.
 *
 * The competitor ships a Claude Code plugin, which is one agent. This writes
 * the same three lines into whichever of six agents are actually on the
 * machine, and it does it by merging rather than by templating: the config file
 * belongs to the user, usually already has servers in it, and losing one of
 * those to a tool that "installed" something would be unforgivable. So the rule
 * here is read, parse, merge one key, write back, and refuse outright when the
 * existing file does not parse. A refusal names the file and prints the entry
 * so the user can paste it, which is strictly better than a guess at what they
 * meant by a trailing comma.
 *
 * The entry is `npx -y open-screenshot-generator@0 mcp --stdio` rather than a
 * path to a local install, because an agent config outlives any one checkout
 * and `npx` is the one invocation that works on a machine that has never seen
 * this package. Pinned to the 0 major so a future breaking change cannot land
 * in somebody's editor overnight.
 *
 * Codex is the odd one out: its config is TOML, and merging TOML without a
 * parser is how configs get corrupted. We only ever append a block that is not
 * there yet, and otherwise print and refuse.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CommandContext } from '../context.js';
import { flagBool, flagList, flagString } from '../args.js';
import { EXIT, usageError } from '../errors.js';
import { bold, cyan, dim, emit, info, ok, step, warn } from '../log.js';

/** Exactly what goes into the config, and what `--print` shows. */
const SERVER_KEY = 'open-screenshot-generator';
const SERVER_ENTRY = {
  command: 'npx',
  args: ['-y', 'open-screenshot-generator@0', 'mcp', '--stdio'],
} as const;

type Scope = 'project' | 'user';

interface AgentSpec {
  id: string;
  label: string;
  /** VS Code calls the map `servers`, everybody else calls it `mcpServers`. */
  mapKey: 'mcpServers' | 'servers';
  format: 'json' | 'toml';
  /** Null when the agent has no such scope. */
  file(scope: Scope, root: string): string | null;
  /** A directory whose existence means the agent is installed here. */
  marker(): string;
}

function appConfigDir(): string {
  if (process.platform === 'win32') return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support');
  return process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), '.config');
}

const home = () => os.homedir();

const AGENTS: AgentSpec[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    mapKey: 'mcpServers',
    format: 'json',
    // .mcp.json is the shared, committable one; ~/.claude.json is this user's.
    file: (scope, root) => (scope === 'project' ? path.join(root, '.mcp.json') : path.join(home(), '.claude.json')),
    marker: () => path.join(home(), '.claude'),
  },
  {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    mapKey: 'mcpServers',
    format: 'json',
    file: (scope) => (scope === 'project' ? null : path.join(appConfigDir(), 'Claude', 'claude_desktop_config.json')),
    marker: () => path.join(appConfigDir(), 'Claude'),
  },
  {
    id: 'cursor',
    label: 'Cursor',
    mapKey: 'mcpServers',
    format: 'json',
    file: (scope, root) =>
      scope === 'project' ? path.join(root, '.cursor', 'mcp.json') : path.join(home(), '.cursor', 'mcp.json'),
    marker: () => path.join(home(), '.cursor'),
  },
  {
    id: 'vscode',
    label: 'VS Code',
    mapKey: 'servers',
    format: 'json',
    file: (scope, root) =>
      scope === 'project' ? path.join(root, '.vscode', 'mcp.json') : path.join(appConfigDir(), 'Code', 'User', 'mcp.json'),
    marker: () => path.join(appConfigDir(), 'Code'),
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    mapKey: 'mcpServers',
    format: 'json',
    file: (scope) => (scope === 'project' ? null : path.join(home(), '.codeium', 'windsurf', 'mcp_config.json')),
    marker: () => path.join(home(), '.codeium', 'windsurf'),
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    mapKey: 'mcpServers',
    format: 'toml',
    file: (scope) => (scope === 'project' ? null : path.join(home(), '.codex', 'config.toml')),
    marker: () => path.join(home(), '.codex'),
  },
];

interface WriteOutcome {
  agent: string;
  /** Carried so a refusal can print the block in that agent's own shape. */
  mapKey: AgentSpec['mapKey'] | 'toml';
  file: string;
  scope: Scope;
  status: 'written' | 'unchanged' | 'skipped';
  reason?: string;
}

export async function run(ctx: CommandContext): Promise<number> {
  const scope: Scope = (flagString(ctx.args.flags, 'scope') as Scope | undefined) ?? 'user';
  if (scope !== 'project' && scope !== 'user') {
    throw usageError(`Unknown scope: ${scope}`, 'Use --scope project or --scope user');
  }

  const detected = AGENTS.filter((agent) => isPresent(agent, ctx.root));
  const named = flagList(ctx.args.flags, 'agent') ?? ctx.args.positionals;
  const all = flagBool(ctx.args.flags, 'all', false);
  const printOnly = flagBool(ctx.args.flags, 'print', false);

  for (const id of named) {
    if (!AGENTS.some((agent) => agent.id === id)) {
      throw usageError(
        `Unknown agent: ${id}`,
        `Known agents: ${AGENTS.map((agent) => agent.id).join(', ')}. Any other client takes the JSON below by hand.`
      );
    }
  }

  if (printOnly) {
    return printEntry(ctx, detected, scope);
  }

  const targets = all ? detected : AGENTS.filter((agent) => named.includes(agent.id));

  if (targets.length === 0) {
    // Nothing was named, so this run is a survey and not a failure: say what is
    // here and what to type next.
    return survey(ctx, detected, scope);
  }

  const outcomes: WriteOutcome[] = [];
  for (const agent of targets) {
    outcomes.push(writeAgent(agent, scope, ctx.root));
  }

  if (ctx.json) {
    emit({
      ok: outcomes.every((entry) => entry.status !== 'skipped'),
      key: SERVER_KEY,
      entry: SERVER_ENTRY,
      scope,
      results: outcomes,
    });
  } else {
    for (const outcome of outcomes) {
      if (outcome.status === 'written') ok(`${outcome.agent}: wrote ${outcome.file}`);
      else if (outcome.status === 'unchanged') info(`${dim('same')} ${outcome.agent}: already in ${outcome.file}`);
      else warn(`${outcome.agent}: ${outcome.reason}`);
    }
    if (outcomes.some((entry) => entry.status === 'written')) {
      info(`\n  ${dim('Restart the agent, then ask it to list its tools. There are 49')}\n`);
    }
    for (const outcome of outcomes.filter((entry) => entry.status === 'skipped')) {
      info(`  ${dim(`Paste this into ${outcome.file || 'the config'} yourself:`)}\n`);
      info(outcome.mapKey === 'toml' ? tomlBlock() : entryBlock(outcome.mapKey));
    }
  }

  // A config we refused to touch is a usage failure, because the user has to do
  // something about it before the server exists in that agent.
  return outcomes.some((entry) => entry.status === 'skipped') ? EXIT.usage : EXIT.ok;
}

// --- reporting --------------------------------------------------------------

function survey(ctx: CommandContext, detected: AgentSpec[], scope: Scope): number {
  if (ctx.json) {
    emit({
      ok: true,
      key: SERVER_KEY,
      entry: SERVER_ENTRY,
      scope,
      detected: detected.map((agent) => describe(agent, scope, ctx.root)),
      agents: AGENTS.map((agent) => describe(agent, scope, ctx.root)),
    });
    return EXIT.ok;
  }

  if (detected.length === 0) {
    warn('No agent config was found on this machine.');
    info(`  ${dim('Add this to whichever client you use:')}\n`);
    info(entryBlock('mcpServers'));
    return EXIT.ok;
  }

  info(`\n  ${bold('Found on this machine')}\n`);
  for (const agent of detected) {
    const file = agent.file(scope, ctx.root);
    info(`  ${agent.id.padEnd(15)} ${dim(file ?? `no ${scope} scope, use --scope user`)}`);
  }
  info(`\n  ${dim('Write it with')} ${cyan(`osg install --agent ${detected[0].id}`)} ${dim('or')} ${cyan('osg install --all')}`);
  info(`  ${dim('Preview with')} ${cyan('osg install --print')}\n`);
  return EXIT.ok;
}

function printEntry(ctx: CommandContext, detected: AgentSpec[], scope: Scope): number {
  if (ctx.json) {
    emit({
      ok: true,
      key: SERVER_KEY,
      entry: SERVER_ENTRY,
      scope,
      files: AGENTS.map((agent) => describe(agent, scope, ctx.root)),
    });
    return EXIT.ok;
  }
  info(`\n  ${bold('MCP server entry')}\n`);
  info(entryBlock('mcpServers'));
  info(`  ${dim('VS Code calls the map "servers" rather than "mcpServers". Codex uses TOML:')}\n`);
  info(tomlBlock());
  info(`  ${bold('Where it would go')}\n`);
  for (const agent of AGENTS) {
    const file = agent.file(scope, ctx.root);
    const mark = detected.includes(agent) ? '' : dim(' (not installed here)');
    info(`  ${agent.id.padEnd(15)} ${dim(file ?? `no ${scope} scope`)}${mark}`);
  }
  info('');
  return EXIT.ok;
}

function describe(agent: AgentSpec, scope: Scope, root: string): Record<string, unknown> {
  const file = agent.file(scope, root);
  return {
    id: agent.id,
    label: agent.label,
    format: agent.format,
    mapKey: agent.mapKey,
    file,
    exists: !!file && fs.existsSync(file),
    installed: isPresent(agent, root),
  };
}

/** Indented so it reads as a block in a terminal, with no colour to copy. */
function entryBlock(mapKey: string): string {
  const document = { [mapKey]: { [SERVER_KEY]: SERVER_ENTRY } };
  return `${JSON.stringify(document, null, 2).replace(/^/gm, '    ')}\n`;
}

function tomlBlock(): string {
  return (
    [
      `[mcp_servers.${SERVER_KEY}]`,
      `command = "${SERVER_ENTRY.command}"`,
      `args = [${SERVER_ENTRY.args.map((arg) => `"${arg}"`).join(', ')}]`,
    ]
      .map((line) => `    ${line}`)
      .join('\n') + '\n\n'
  );
}

// --- writing ----------------------------------------------------------------

function isPresent(agent: AgentSpec, root: string): boolean {
  if (fs.existsSync(agent.marker())) return true;
  for (const scope of ['user', 'project'] as Scope[]) {
    const file = agent.file(scope, root);
    if (file && fs.existsSync(file)) return true;
  }
  return false;
}

function writeAgent(agent: AgentSpec, scope: Scope, root: string): WriteOutcome {
  const file = agent.file(scope, root);
  if (!file) {
    return {
      agent: agent.id,
      file: '',
      scope,
      status: 'skipped',
      mapKey: agent.mapKey,
      reason: `${agent.label} has no ${scope} scope config. Re-run with --scope user`,
    };
  }
  step(`${agent.label}: ${file}`);
  return agent.format === 'toml' ? writeToml(agent, file, scope) : writeJson(agent, file, scope);
}

function writeJson(agent: AgentSpec, file: string, scope: Scope): WriteOutcome {
  let document: Record<string, unknown> = {};
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8');
    if (raw.trim()) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
        document = parsed as Record<string, unknown>;
      } catch (error) {
        // Comments and trailing commas are legal in some of these files and are
        // not legal JSON. Rewriting one would silently delete the comments, so
        // the honest move is to refuse and hand the user the entry.
        return {
          agent: agent.id,
          file,
          scope,
          status: 'skipped',
          mapKey: agent.mapKey,
          reason: `${file} does not parse as JSON (${(error as Error).message}), so nothing was written`,
        };
      }
    }
  }

  const existingMap = document[agent.mapKey];
  const servers: Record<string, unknown> =
    existingMap && typeof existingMap === 'object' && !Array.isArray(existingMap)
      ? { ...(existingMap as Record<string, unknown>) }
      : {};

  if (JSON.stringify(servers[SERVER_KEY]) === JSON.stringify(SERVER_ENTRY)) {
    return { agent: agent.id, mapKey: agent.mapKey, file, scope, status: 'unchanged' };
  }

  servers[SERVER_KEY] = SERVER_ENTRY;
  const next = { ...document, [agent.mapKey]: servers };

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return { agent: agent.id, mapKey: agent.mapKey, file, scope, status: 'written' };
}

function writeToml(agent: AgentSpec, file: string, scope: Scope): WriteOutcome {
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (existing.includes(`[mcp_servers.${SERVER_KEY}]`)) {
    return { agent: agent.id, mapKey: 'toml', file, scope, status: 'unchanged' };
  }
  // Appending is the only edit that cannot lose a comment or reorder a table,
  // and a TOML table at the end of the file is valid wherever it lands.
  const block = [
    '',
    `[mcp_servers.${SERVER_KEY}]`,
    `command = "${SERVER_ENTRY.command}"`,
    `args = [${SERVER_ENTRY.args.map((arg) => `"${arg}"`).join(', ')}]`,
    '',
  ].join('\n');

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, existing.trimEnd() + block, 'utf8');
  return { agent: agent.id, mapKey: 'toml', file, scope, status: 'written' };
}

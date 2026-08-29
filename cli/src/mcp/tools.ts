/**
 * The tool manifest, and the rule for who answers what.
 *
 * Every MCP client calls `initialize` and then `tools/list` the moment it
 * connects, before a person has asked for anything. If those two cost a
 * browser boot, then adding this server to Claude Code, Cursor or Claude
 * Desktop costs 30 seconds of spinner at every editor start, on a machine
 * where the user may never invoke a design tool at all. So the handshake is
 * answered from a manifest generated at build time and the browser is not
 * started until the first `tools/call`.
 *
 * The manifest is `tools.json`, written next to `dist/` by the package build
 * from the live editor's own `tools/list` output. It carries the shape:
 *
 *   { version, protocolVersion, serverInfo: {...}, instructions, tools: [...] }
 *
 * A dev checkout that has never run the build has no manifest. That is not an
 * error: `initialize` and `ping` still answer from the constants below, and
 * `tools/list` falls through to the page, paying one boot.
 *
 * The manifest can also go stale, which is the failure this file exists to
 * catch. This repo has shipped exactly that bug before: relayBridge.ts claimed
 * 42 tools long after there were 49, and nothing anywhere noticed. So the
 * first real `tools/call` triggers `reconcile`, which asks the live page what
 * it actually has, says both numbers out loud if they disagree, and prefers
 * the page from then on.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CommandContext } from '../context.js';
import type { Session } from '../driver/session.js';
import { debug, info, warn } from '../log.js';

export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: unknown;
}

export interface ToolManifest {
  /** Package version the manifest was generated from. */
  version: string;
  /** The build's own count, cross-checked against the array below. */
  count?: number;
  protocolVersion: string;
  serverInfo: { name: string; title?: string; version: string };
  /** The usage paragraph the app returns from `initialize`. */
  instructions?: string;
  tools: ToolDescriptor[];
}

/**
 * Used only when there is no manifest. Must match DEFAULT_PROTOCOL_VERSION and
 * SERVER_INFO in src/lib/mcp/desktopMcpServer.ts.
 *
 * `instructions` is deliberately not duplicated here: it is a long paragraph
 * that is edited in the app, a stale copy would be worse than none, and a
 * client that gets no instructions still works.
 */
const FALLBACK_PROTOCOL_VERSION = '2025-06-18';
const FALLBACK_SERVER_INFO = {
  name: 'open-screenshot-generator',
  title: 'Open Screenshot Generator',
  version: '0.0.0',
};

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The build bundles everything into dist/cli.js, so at runtime `here` is
 * <package>/dist and the manifest is one level up. The other two candidates
 * cover an unbundled dist/mcp/tools.js and a checkout running src/mcp/tools.ts
 * straight through jiti, so `osg mcp` works while developing the CLI itself.
 */
const MANIFEST_CANDIDATES = [
  path.resolve(here, '..', 'tools.json'),
  path.resolve(here, '..', '..', 'tools.json'),
  path.resolve(here, '..', '..', '..', 'tools.json'),
];

let manifestLoaded = false;
let manifest: ToolManifest | null = null;

/** Keep only entries a client can actually use, so one bad row cannot poison the list. */
function normalizeTools(value: unknown): ToolDescriptor[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is ToolDescriptor => {
      const tool = entry as { name?: unknown; inputSchema?: unknown };
      return !!tool && typeof tool.name === 'string' && !!tool.inputSchema;
    })
    .map((tool) => ({
      name: tool.name,
      description: typeof tool.description === 'string' ? tool.description : '',
      inputSchema: tool.inputSchema,
    }));
}

/** The packaged manifest, or null when this checkout has never been built. Cached, including the miss. */
export function loadToolManifest(): ToolManifest | null {
  if (manifestLoaded) return manifest;
  manifestLoaded = true;

  for (const file of MANIFEST_CANDIDATES) {
    if (!fs.existsSync(file)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<ToolManifest> | ToolDescriptor[];
      // Accept a bare array too, so a hand written manifest is not a trap.
      const raw = Array.isArray(parsed) ? { tools: parsed } : parsed;
      const tools = normalizeTools(raw.tools);
      if (!tools.length) {
        warn(`tool manifest at ${file} has no usable tools, asking the editor instead`);
        break;
      }
      const version = typeof raw.version === 'string' ? raw.version : '0';
      if (typeof raw.count === 'number' && raw.count !== tools.length) {
        // The generator writes both, so a disagreement means the file was
        // hand edited or truncated. Say it here rather than let reconcile
        // report a mismatch against the page that has nothing to do with it.
        warn(`tool manifest says ${raw.count} tools but carries ${tools.length}`);
      }
      manifest = {
        version,
        count: typeof raw.count === 'number' ? raw.count : undefined,
        protocolVersion: typeof raw.protocolVersion === 'string' ? raw.protocolVersion : FALLBACK_PROTOCOL_VERSION,
        // The build writes the package version and no serverInfo, so carry the
        // version across: a client shows serverInfo in its connection list and
        // "0.0.0" there is how a stale server goes unnoticed.
        serverInfo: raw.serverInfo ?? { ...FALLBACK_SERVER_INFO, version },
        instructions: typeof raw.instructions === 'string' ? raw.instructions : undefined,
        tools,
      };
      debug(`tool manifest ${file}: ${tools.length} tools`);
      break;
    } catch (error) {
      warn(`tool manifest unreadable at ${file}: ${(error as Error).message}`);
      break;
    }
  }

  if (!manifest) debug('no packaged tool manifest, tools/list will ask the editor');
  return manifest;
}

/**
 * What the live page reports, once we have asked it. Preferred over the
 * manifest for every later tools/list, because the page is the truth and the
 * manifest is a snapshot of it.
 */
let liveTools: ToolDescriptor[] | null = null;
let reconciling = false;

/** How many tools this server advertises, or null when nothing knows yet. */
export function toolCount(): number | null {
  return (liveTools ?? loadToolManifest()?.tools)?.length ?? null;
}

export function rpcResult(id: unknown, result: unknown): unknown {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

export function rpcError(id: unknown, code: number, message: string, data?: unknown): unknown {
  return { jsonrpc: '2.0', id: id ?? null, error: data === undefined ? { code, message } : { code, message, data } };
}

/**
 * True for a JSON-RPC request, which must be answered. A message with a method
 * and no id is a notification and gets nothing back; anything else is a stray
 * response. Same test as `is_request` in src-tauri/src/mcp_server.rs, because
 * the two transports have to agree about what deserves a reply.
 */
export function isJsonRpcRequest(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const message = value as { method?: unknown; id?: unknown };
  return typeof message.method === 'string' && message.id !== undefined && message.id !== null;
}

/**
 * Answer a message without a browser, or return null to say it needs the live
 * page. Null is the signal, never an error: a caller that gets null starts the
 * session and forwards.
 */
export function staticHandle(message: unknown): unknown | null {
  if (!message || typeof message !== 'object') return null;
  const { id, method, params } = message as { id?: unknown; method?: unknown; params?: { protocolVersion?: unknown } };
  if (typeof method !== 'string') return null;

  switch (method) {
    case 'initialize': {
      const loaded = loadToolManifest();
      const result: Record<string, unknown> = {
        // Echo the client's version when it named one, exactly as the app
        // does, so a client on an older spec revision is not handed a newer
        // one it will refuse.
        protocolVersion:
          typeof params?.protocolVersion === 'string'
            ? params.protocolVersion
            : loaded?.protocolVersion ?? FALLBACK_PROTOCOL_VERSION,
        // listChanged stays false to match the app. `reconcile` can widen the
        // list mid-session, but a manifest that disagrees with the page is a
        // build bug to fix, not a runtime event worth teaching clients about.
        capabilities: { tools: { listChanged: false } },
        serverInfo: loaded?.serverInfo ?? FALLBACK_SERVER_INFO,
      };
      if (loaded?.instructions) result.instructions = loaded.instructions;
      return rpcResult(id, result);
    }

    case 'ping':
      return rpcResult(id, {});

    case 'tools/list': {
      const tools = liveTools ?? loadToolManifest()?.tools ?? null;
      if (!tools) return null;
      return rpcResult(id, { tools });
    }

    default:
      return null;
  }
}

/**
 * Compare the packaged manifest against what the page actually exposes, once
 * per run, after the first tool call has already paid for the browser.
 *
 * Naming both numbers is the whole point. A silent mismatch means a client was
 * told about tools that do not exist, or never told about tools that do, and
 * neither shows up as a failure anywhere else.
 */
export async function reconcile(session: Session): Promise<void> {
  if (liveTools || reconciling) return;
  reconciling = true;
  try {
    const live = await session.listTools();
    if (!live.length) {
      // An empty answer is a page that is not ready, not a page with no tools.
      debug('reconcile: the editor reported no tools, keeping the packaged list');
      return;
    }

    const shipped = loadToolManifest()?.tools ?? null;
    if (shipped && shipped.length !== live.length) {
      warn(`packaged tool manifest lists ${shipped.length} tools, the editor reports ${live.length}`);
      const shippedNames = new Set(shipped.map((tool) => tool.name));
      const liveNames = new Set(live.map((tool) => tool.name));
      const added = live.filter((tool) => !shippedNames.has(tool.name)).map((tool) => tool.name);
      const dropped = shipped.filter((tool) => !liveNames.has(tool.name)).map((tool) => tool.name);
      if (added.length) warn(`only in the editor: ${added.join(', ')}`);
      if (dropped.length) warn(`only in the manifest: ${dropped.join(', ')}`);
      warn('using the editor list. Rebuild the package to regenerate tools.json');
    }

    liveTools = live;
    debug(`reconcile: ${live.length} tools from the editor`);
  } catch (error) {
    // A failed reconcile must never take down a working tool call, and
    // `liveTools` stays null so a later call tries again.
    debug(`reconcile skipped: ${(error as Error).message}`);
  } finally {
    reconciling = false;
  }
}

export type SessionProvider = () => Promise<Session>;

/**
 * One session per server, started on demand.
 *
 * The memo is on the promise, not on the resolved session, because a client is
 * free to pipeline: two tool calls arriving in the same tick would otherwise
 * both see "no session yet" and launch two browsers. On failure the memo is
 * dropped, so a user who acts on the fix line (installs a browser, frees a
 * port) gets a working server on their next call rather than after a restart.
 */
export function lazySession(ctx: CommandContext): SessionProvider {
  let pending: Promise<Session> | null = null;
  return () => {
    if (!pending) {
      info('starting the editor, the first tool call pays for the browser boot');
      pending = ctx.session().catch((error) => {
        pending = null;
        throw error;
      });
    }
    return pending;
  };
}

/**
 * A JSON-RPC error carrying the actionable line inside `message`, because a
 * client surfaces `message` to the agent and nothing else. An agent that reads
 * "No browser found. Run osg doctor --install-browser" can fix its own run.
 *
 * The `fix` is duck typed rather than tested with `instanceof OsgError`: the
 * CLI can be loaded through jiti during development, and two module instances
 * of errors.ts would silently fail an instanceof and drop the useful half of
 * every message.
 */
function errorResponse(id: unknown, error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error);
  const candidate = (error as { fix?: unknown })?.fix;
  const fix = typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
  return rpcError(id, -32000, fix ? `${message} ${fix}` : message, fix ? { fix } : undefined);
}

/**
 * Answer one JSON-RPC request: from the manifest where possible, from the live
 * page otherwise. Shared by both transports so stdio and HTTP cannot drift.
 * The caller has already established that this message deserves a reply.
 */
export async function dispatch(message: unknown, getSession: SessionProvider): Promise<unknown> {
  const id = (message as { id?: unknown })?.id ?? null;

  const answered = staticHandle(message);
  if (answered !== null) return answered;

  let session: Session;
  try {
    session = await getSession();
  } catch (error) {
    return errorResponse(id, error);
  }

  try {
    const response = await session.rpc(message);
    if ((message as { method?: unknown }).method === 'tools/call') {
      // After the answer, not before: the client should not wait on an audit.
      void reconcile(session);
    }
    if (response === undefined || response === null) {
      return rpcError(id, -32603, 'the editor returned no response');
    }
    return response;
  } catch (error) {
    return errorResponse(id, error);
  }
}

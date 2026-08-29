/**
 * osg design: the AI agent.
 *
 * Screenshots plus one sentence become a finished project. Everything that
 * decides how the design looks happens in the page, not here: generatePlan and
 * buildProjectFromPlan run inside the editor bundle behind window.__osg.agent,
 * which is what buys the browser's own screenshot downscale, the real template
 * catalog, and the operation timeline --trace reads back afterwards. This
 * module only chooses a provider, a model and a key, hands over the pixels,
 * and writes down what came out.
 *
 * The key is the one thing this command must never be careless with. It is
 * read from a flag or the environment, passed to the page as a call argument,
 * and never written to the config, never written to the project file, never
 * logged, not even a prefix of it: a truncated key in a CI log is still a
 * fingerprint of which key leaked.
 */
import fs from 'node:fs';
import path from 'node:path';
import { flagBool, flagString } from '../args.js';
import type { CommandContext } from '../context.js';
import type { Session } from '../driver/session.js';
import { EXIT, driverError, usageError } from '../errors.js';
import { debug, dim, emit, humanBytes, humanMs, info, ok, step, warn } from '../log.js';

type ProviderId = 'anthropic' | 'openai' | 'google' | 'openrouter' | 'compatible';

interface ProviderSpec {
  label: string;
  /** Mirrors AI_PROVIDERS[id].defaultModel in src/lib/ai/providers.ts. */
  defaultModel: string;
  /** Host the page talks to when no endpoint is named. Used for --offline. */
  defaultHost: string;
  /** The variable that provider's own tooling already sets. */
  keyEnv: string;
}

/**
 * A deliberately small mirror of src/lib/ai/providers.ts. The CLI cannot import
 * the app's module (different build, different runtime), and the alternative,
 * asking the page for its registry, would need the bundle loaded before the
 * flags could even be validated. Model ids churn faster than anything else
 * here, so --model and config.ai.model always win over the default below.
 */
const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  anthropic: {
    label: 'Anthropic Claude',
    defaultModel: 'claude-opus-4-8',
    defaultHost: 'api.anthropic.com',
    keyEnv: 'ANTHROPIC_API_KEY',
  },
  openai: {
    label: 'OpenAI',
    defaultModel: 'gpt-4o',
    defaultHost: 'api.openai.com',
    keyEnv: 'OPENAI_API_KEY',
  },
  google: {
    label: 'Google Gemini',
    defaultModel: 'gemini-2.5-flash',
    defaultHost: 'generativelanguage.googleapis.com',
    keyEnv: 'GOOGLE_GENERATIVE_AI_API_KEY',
  },
  openrouter: {
    label: 'OpenRouter',
    defaultModel: 'google/gemini-2.0-flash-exp:free',
    defaultHost: 'openrouter.ai',
    keyEnv: 'OPENROUTER_API_KEY',
  },
  compatible: {
    label: 'OpenAI compatible endpoint',
    defaultModel: '',
    defaultHost: '',
    keyEnv: '',
  },
};

/** Names people type for the five real ids, including the config's older one. */
const ALIASES: Record<string, ProviderId> = {
  anthropic: 'anthropic',
  claude: 'anthropic',
  openai: 'openai',
  gpt: 'openai',
  google: 'google',
  gemini: 'google',
  openrouter: 'openrouter',
  compatible: 'compatible',
  'openai-compatible': 'compatible',
  custom: 'compatible',
};

/**
 * Endpoints from COMPATIBLE_PRESETS, so `--provider deepseek` works without the
 * user pasting a URL. Only the base URL is mirrored: it is the one field that
 * is stable, and --base-url overrides it anyway. Everything else about a preset
 * (its models, where to get a key) belongs to the app's UI.
 */
const PRESET_BASE_URLS: Record<string, string> = {
  minimax: 'https://api.minimax.io/v1',
  deepseek: 'https://api.deepseek.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  together: 'https://api.together.xyz/v1',
  mistral: 'https://api.mistral.ai/v1',
  xai: 'https://api.x.ai/v1',
  moonshot: 'https://api.moonshot.ai/v1',
  zai: 'https://api.z.ai/api/paas/v4',
  qwen: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  fireworks: 'https://api.fireworks.ai/inference/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  nebius: 'https://api.studio.nebius.com/v1',
  huggingface: 'https://router.huggingface.co/v1',
  nvidia: 'https://integrate.api.nvidia.com/v1',
  vercel: 'https://ai-gateway.vercel.sh/v1',
  ollama: 'http://127.0.0.1:11434/v1',
  lmstudio: 'http://127.0.0.1:1234/v1',
  llamacpp: 'http://127.0.0.1:8080/v1',
  vllm: 'http://127.0.0.1:8000/v1',
  litellm: 'http://127.0.0.1:4000/v1',
};

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/** Past this the CDP transfer itself becomes the slow part of the run. */
const PAYLOAD_WARN_BYTES = 40 * 1024 * 1024;
/** One timeline body, clamped before it crosses back out of the page. */
const TRACE_DETAIL_CHARS = 4000;

interface AgentSummary {
  action?: string;
  templateName?: string | null;
  artboardCount?: number;
  screenshotsPlaced?: number;
  textsUpdated?: number;
  localesAdded?: string[];
}

interface AgentResult {
  ok?: boolean;
  error?: string;
  warnings?: string[];
  summary?: AgentSummary;
}

interface TraceEntry {
  t: number;
  kind: string;
  label: string;
  stage?: string;
  code?: string;
  direction?: string;
  detail?: string;
  image?: boolean;
}

interface TraceOperation {
  id: string;
  status: string;
  provider: string;
  providerLabel?: string;
  model?: string;
  startedAt: number;
  endedAt?: number;
  errorCode?: string;
  errorMessage?: string;
  entries: TraceEntry[];
}

interface Screenshot {
  name: string;
  dataUrl: string;
  bytes: number;
}

export async function run(ctx: CommandContext): Promise<number> {
  const flags = ctx.args.flags;
  const instruction = (flagString(flags, 'instruction') ?? ctx.args.positionals.join(' ')).trim();
  if (!instruction) {
    throw usageError(
      'osg design needs an instruction',
      'Try: osg design "clean dark screenshots for a running app" --screenshots ./shots'
    );
  }

  const provider = resolveProvider(ctx);
  const baseUrl = resolveBaseUrl(ctx, provider);
  if (provider === 'compatible' && !baseUrl) {
    throw usageError(
      'The compatible provider needs an endpoint',
      'Pass --base-url https://host/v1, or name a preset such as --provider deepseek.'
    );
  }

  const model = flagString(flags, 'model') ?? ctx.config.ai?.model ?? PROVIDERS[provider].defaultModel;
  if (!model) {
    throw usageError(
      'That provider has no default model, so the model has to be named',
      'Pass --model <id>, or set ai.model in osg.config.ts.'
    );
  }

  const apiKey = resolveApiKey(ctx, provider, baseUrl);
  const screenshots = collectScreenshots(ctx);
  const trace = flagBool(flags, 'trace', false);

  step(`design: ${PROVIDERS[provider].label}, ${model}`);
  if (baseUrl) info(dim(`  endpoint ${baseUrl}`));
  info(
    dim(
      `  ${screenshots.length} screenshot${screenshots.length === 1 ? '' : 's'}, ${humanBytes(
        screenshots.reduce((total, shot) => total + shot.bytes, 0)
      )}`
    )
  );
  if (provider === 'compatible') {
    // The app calls a custom endpoint through the Tauri HTTP bridge, which has
    // no CORS. The CLI drives a real browser, so here the endpoint has to allow
    // this origin itself, and a host that does not looks like a dead network.
    info(dim('  a custom endpoint is called from the browser here, so it has to allow cross origin requests'));
  }

  // In --offline mode every host is blocked unless it is named, and the whole
  // point of this command is one request to a provider.
  const allowHosts = hostOf(baseUrl) ?? PROVIDERS[provider].defaultHost;
  const session = await ctx.session(allowHosts ? { allowHosts: [allowHosts] } : {});

  const startedAt = Date.now();
  const pageConsole = trace ? captureConsole(session) : null;
  let result: AgentResult;
  try {
    result = (await session.agent({
      instruction,
      screenshots: screenshots.map((shot) => ({ name: shot.name, dataUrl: shot.dataUrl })),
      provider,
      model,
      apiKey,
      ...(baseUrl ? { baseUrl } : {}),
    })) as AgentResult;
  } finally {
    pageConsole?.stop();
  }

  // Read the timeline before anything can throw: a failed headless run is a
  // black box otherwise, and the failure is exactly when it is worth having.
  const timeline = trace ? await readTrace(session, startedAt) : [];
  const consoleLines = pageConsole?.lines ?? [];
  if (trace && !ctx.json) printTrace(timeline, consoleLines);

  const warnings = Array.isArray(result.warnings) ? result.warnings.filter((line) => typeof line === 'string') : [];

  if (!result.ok) {
    const message = result.error || 'The AI run did not produce a project.';
    throw driverError(message, fixFor(message, provider, trace), {
      provider,
      model,
      warnings,
      ...(trace ? { trace: timeline, console: consoleLines } : {}),
    });
  }

  const status = await session.status();
  const projectPath = await writeProjectFile(ctx, session, status.projectName || ctx.config.name || 'Project');

  const summary = result.summary ?? {};
  ok(
    `${summary.templateName || 'a generated layout'}, ${summary.artboardCount ?? status.artboards.length} boards, ` +
      `${summary.screenshotsPlaced ?? 0} screenshots placed, ${summary.textsUpdated ?? 0} texts written`
  );
  for (const line of warnings) warn(line);
  info(`project: ${projectPath}`);
  info(dim(`  ${humanMs(Date.now() - startedAt)}, next: osg render`));

  if (ctx.json) {
    emit({
      ok: true,
      command: 'design',
      instruction,
      provider,
      model,
      ...(baseUrl ? { baseUrl } : {}),
      project: projectPath,
      screenshots: screenshots.map((shot) => shot.name),
      summary,
      warnings,
      artboards: status.artboards,
      durationMs: Date.now() - startedAt,
      ...(trace ? { trace: timeline, console: consoleLines } : {}),
    });
  }

  return EXIT.ok;
}

// --- provider, model, key ---------------------------------------------------

function resolveProvider(ctx: CommandContext): ProviderId {
  const named = (flagString(ctx.args.flags, 'provider') ?? ctx.config.ai?.provider ?? '').trim().toLowerCase();
  if (!named) return detectProvider();
  if (ALIASES[named]) return ALIASES[named];
  // A preset id is really `compatible` with the endpoint filled in, which is
  // how the app models it too.
  if (PRESET_BASE_URLS[named]) return 'compatible';
  throw usageError(
    `Unknown provider "${named}"`,
    `Use one of: ${Object.keys(PROVIDERS).join(', ')}, a preset (${Object.keys(PRESET_BASE_URLS)
      .slice(0, 6)
      .join(', ')}, ...), or --provider compatible --base-url <url>.`
  );
}

/** Nothing configured: take the provider whose own key is already exported. */
function detectProvider(): ProviderId {
  const order: ProviderId[] = ['anthropic', 'openai', 'google', 'openrouter'];
  for (const id of order) {
    if (process.env[PROVIDERS[id].keyEnv]?.trim()) {
      debug(`provider: ${id}, from ${PROVIDERS[id].keyEnv}`);
      return id;
    }
  }
  return 'anthropic';
}

function resolveBaseUrl(ctx: CommandContext, provider: ProviderId): string {
  const explicit = (flagString(ctx.args.flags, 'base-url') ?? ctx.config.ai?.baseUrl ?? '').trim();
  if (explicit) return explicit;
  if (provider !== 'compatible') return '';
  const named = (flagString(ctx.args.flags, 'provider') ?? ctx.config.ai?.provider ?? '').trim().toLowerCase();
  return PRESET_BASE_URLS[named] ?? '';
}

/**
 * --api-key, then OSG_API_KEY, then the variable the config names, then the
 * provider's own. A local runtime needs no key at all, so an empty string is a
 * legitimate answer there and only there.
 */
function resolveApiKey(ctx: CommandContext, provider: ProviderId, baseUrl: string): string {
  const fromFlag = flagString(ctx.args.flags, 'api-key')?.trim();
  if (fromFlag) {
    // A key in argv is a key in the shell history and in `ps`. Worth saying
    // once at --verbose, not worth nagging about on every run.
    debug('key: --api-key');
    return fromFlag;
  }

  const named = ctx.config.ai?.apiKeyEnv?.trim();
  const candidates = ['OSG_API_KEY', ...(named ? [named] : []), ...(PROVIDERS[provider].keyEnv ? [PROVIDERS[provider].keyEnv] : [])];
  for (const variable of candidates) {
    const value = process.env[variable]?.trim();
    if (value) {
      debug(`key: ${variable}`);
      return value;
    }
  }

  if (isLocalEndpoint(baseUrl)) {
    debug('key: none, the endpoint runs on this machine');
    return '';
  }

  throw usageError(`No API key for ${PROVIDERS[provider].label}`, `Set ${candidates.join(' or ')}, or pass --api-key.`);
}

function isLocalEndpoint(baseUrl: string): boolean {
  const host = hostOf(baseUrl);
  if (!host) return false;
  const bare = host.split(':')[0];
  return (
    bare === 'localhost' ||
    bare === '0.0.0.0' ||
    bare.endsWith('.local') ||
    /^127\./.test(bare) ||
    /^10\./.test(bare) ||
    /^192\.168\./.test(bare) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(bare)
  );
}

function hostOf(url: string): string | null {
  if (!url) return null;
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).host;
  } catch {
    return null;
  }
}

function fixFor(message: string, provider: ProviderId, traced: boolean): string {
  if (/api key|unauthor|401|403|invalid.*token/i.test(message)) {
    return `Check the key for ${PROVIDERS[provider].label}, and that it has access to this model.`;
  }
  if (/rate limit|429|quota/i.test(message)) {
    return 'The provider is rate limiting this key. Wait, or use a smaller model.';
  }
  if (/failed to fetch|network|cors|econn/i.test(message)) {
    return 'The page could not reach the endpoint. Check the URL, that it allows browser calls, and --offline.';
  }
  if (/plan|schema|not a valid/i.test(message)) {
    return 'The model wrote a plan the app could not build. Try again, or a stronger model with --model.';
  }
  return traced ? 'Read the timeline above for the stage that failed.' : 'Re-run with --trace to see what the page did.';
}

// --- screenshots ------------------------------------------------------------

function collectScreenshots(ctx: CommandContext): Screenshot[] {
  const named = flagString(ctx.args.flags, 'screenshots') ?? ctx.config.screenshots;
  const candidates = named
    ? [path.resolve(ctx.root, named)]
    : [path.join(ctx.root, 'screenshots'), path.join(ctx.root, 'osg', 'screenshots')];

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    if (named) {
      throw usageError(`No screenshots at ${candidates[0]}`, 'Point --screenshots at the directory holding your app screenshots.');
    }
    warn('no screenshots found, the plan will design around empty devices');
    return [];
  }

  const files = fs.statSync(found).isDirectory()
    ? fs
        .readdirSync(found)
        .filter((entry) => IMAGE_TYPES[path.extname(entry).toLowerCase()])
        .sort(new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare)
        .map((entry) => path.join(found, entry))
    : [found];

  if (files.length === 0) {
    warn(`no png, jpg or webp files in ${found}`);
    return [];
  }

  // Full resolution on purpose: the page owns the downscale (AI_MAX_EDGE and
  // STORAGE_MAX_EDGE live in the app), so the CLI never has a second opinion
  // about how a screenshot should be resized.
  const shots = files.map((file) => {
    const bytes = fs.readFileSync(file);
    const type = IMAGE_TYPES[path.extname(file).toLowerCase()] ?? 'image/png';
    return { name: path.basename(file), dataUrl: `data:${type};base64,${bytes.toString('base64')}`, bytes: bytes.length };
  });

  const total = shots.reduce((sum, shot) => sum + shot.bytes, 0);
  if (total > PAYLOAD_WARN_BYTES) {
    warn(`${humanBytes(total)} of screenshots, handing that to the page takes a while`);
  }
  return shots;
}

// --- the project file -------------------------------------------------------

/**
 * There is no tool that hands back a whole project, so the file is rebuilt from
 * the boards the run produced: status() for the ids, get_artboard for each
 * one's full state. The shape written is the app's own Project record, which is
 * what the bridge's loadProject takes back in.
 */
async function writeProjectFile(ctx: CommandContext, session: Session, name: string): Promise<string> {
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
        name,
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

// --- trace ------------------------------------------------------------------

/**
 * The app records every AI run as an operation in IndexedDB (see
 * src/lib/ai/operationLog.ts). Reading it back is the only way a headless run
 * is inspectable at all: nothing is on screen, and the prompt and the raw reply
 * exist nowhere else.
 *
 * Read with the raw IndexedDB api rather than through the app's module, because
 * page.evaluate has no import of its own, and as an expression rather than a
 * function with arguments, because the driver's evaluate hands a string
 * straight to the page.
 */
async function readTrace(session: Session, since: number): Promise<TraceOperation[]> {
  const script = `(async () => {
    const rows = await new Promise((resolve) => {
      let request;
      try { request = indexedDB.open('ProjectDatabase'); } catch (error) { resolve(null); return; }
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('operations')) { db.close(); resolve([]); return; }
        const all = db.transaction('operations', 'readonly').objectStore('operations').getAll();
        all.onsuccess = () => { const value = all.result; db.close(); resolve(value); };
        all.onerror = () => { db.close(); resolve(null); };
      };
    });
    if (!rows) return [];
    return rows
      .filter((row) => row && typeof row.startedAt === 'number' && row.startedAt >= ${Math.max(0, since - 2000)})
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((row) => ({
        id: row.id,
        status: row.status,
        provider: row.provider,
        providerLabel: row.providerLabel,
        model: row.model,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        errorCode: row.errorCode,
        errorMessage: row.errorMessage,
        entries: (row.entries || []).slice().sort((a, b) => a.t - b.t).map((entry) => ({
          t: entry.t,
          kind: entry.kind,
          label: entry.label,
          stage: entry.stage,
          code: entry.code,
          direction: entry.direction,
          // A screenshot entry is a data URL of a provider window. Megabytes of
          // base64 across the CDP boundary buy nothing in a terminal, so only
          // the fact that one exists travels.
          image: !!entry.image,
          detail: typeof entry.detail === 'string' ? entry.detail.slice(0, ${TRACE_DETAIL_CHARS}) : undefined,
        })),
      }));
  })()`;

  try {
    return (await session.evaluate<TraceOperation[] | null>(script)) ?? [];
  } catch (error) {
    debug(`trace: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/** Page console, kept only for --trace. See printTrace for why it is worth it. */
function captureConsole(session: Session): { lines: string[]; stop: () => void } {
  const lines: string[] = [];
  const handler = (message: { type(): string; text(): string }) => {
    if (lines.length >= 300) return;
    lines.push(`${message.type()}: ${message.text().slice(0, 500)}`);
  };
  session.page.on('console', handler);
  return {
    lines,
    stop: () => {
      session.page.off('console', handler);
    },
  };
}

function printTrace(operations: TraceOperation[], consoleLines: string[]): void {
  if (operations.length === 0) {
    info(dim('trace: the run recorded no operation timeline'));
    // Only the api-key path through the app's own start screen opens an
    // OperationRecorder, so a bundle that runs generatePlan straight from the
    // bridge leaves nothing behind. The page console is then the only light
    // there is, which is the whole reason it was captured.
    for (const line of consoleLines.slice(-40)) info(dim(`  ${line}`));
    return;
  }

  for (const operation of operations) {
    const took = operation.endedAt ? humanMs(operation.endedAt - operation.startedAt) : 'unfinished';
    info(
      dim(
        `trace ${operation.providerLabel || operation.provider}${operation.model ? ` ${operation.model}` : ''}, ${
          operation.status
        }, ${took}`
      )
    );
    for (const entry of operation.entries) {
      const at = humanMs(entry.t - operation.startedAt).padStart(8);
      const arrow = entry.direction === 'app-to-provider' ? '>' : entry.direction === 'provider-to-app' ? '<' : ' ';
      info(dim(`  ${at} ${arrow} ${entry.kind === 'stage' ? entry.stage ?? 'stage' : entry.kind}  ${entry.label}`));
      if (entry.image) info(dim("           screenshot captured, open it in the app's run history"));
      if (entry.detail) debug(entry.detail);
    }
    if (operation.errorMessage) info(dim(`  ${operation.errorCode ?? 'error'}: ${operation.errorMessage}`));
  }
}

/**
 * A live editor session: a local origin, a browser, a loaded page, and the
 * `window.__osg` bridge on the other side of it.
 *
 * Every command in this CLI goes through here, and the single most important
 * rule it enforces is one call in flight. The app's MCP api closes over the
 * artboards of the render that produced it, so two mutations dispatched in the
 * same tick both read the pre-change state and the second silently clobbers
 * the first. The queue below is what makes an agent's forty element edits
 * land as forty edits rather than as one.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'puppeteer-core';
import { resolveEditor, manifestPath, type EditorSource } from '../editor/resolve.js';
import { loadManifest, type AssetManifest } from '../editor/assets.js';
import { startEditorServer, type EditorServer } from '../editor/server.js';
import { launchBrowser, type LaunchedBrowser } from '../browser/launch.js';
import { OsgError, EXIT, driverError } from '../errors.js';
import { debug, step, humanMs } from '../log.js';
import { ensureDir } from '../paths.js';

/** Must match HEADLESS_PROTOCOL in src/lib/headless/bridge.ts. */
export const REQUIRED_PROTOCOL = 1;

/** Mirrors SLOW_TOOLS in src/lib/mcp/desktopMcpServer.ts. */
const SLOW_TOOLS = new Set([
  'export_png',
  'export_all',
  'create_project_from_template',
  'open_project',
  'translate_locales',
  'add_locales',
  'upload_asset',
  'upload_recording',
]);

const HANDLER_TIMEOUT_MS = 30_000;
const SLOW_HANDLER_TIMEOUT_MS = 180_000;

export interface SessionOptions {
  editorUrl?: string;
  assetsBaseUrl: string;
  browser?: string;
  headed?: boolean;
  offline?: boolean;
  downloadDir?: string;
  width?: number;
  height?: number;
  /** Extra hosts the page may reach in --offline mode (an AI endpoint). */
  allowHosts?: string[];
  cwd?: string;
}

export interface ArtboardSummary {
  id: string;
  name: string;
  width: number;
  height: number;
  elements: number;
}

export interface SessionStatus {
  protocol: number;
  ready: boolean;
  projectId: string | null;
  projectName: string;
  artboards: ArtboardSummary[];
  locales: string[];
  baseLocale: string | null;
  activeArtboardId: string | null;
}

export interface SavedFile {
  filename: string;
  path?: string;
}

export interface CapturedImage {
  artboardId: string;
  fileName: string;
  base64: string;
  width: number;
  height: number;
  locale: string | null;
}

export interface Session {
  origin: string;
  page: Page;
  source: EditorSource;
  server: EditorServer | null;
  manifest: AssetManifest;
  downloadDir: string;
  /** Raw JSON-RPC in, raw JSON-RPC out. The MCP transports use this. */
  rpc(message: unknown): Promise<unknown>;
  /** One tool call. Throws OsgError on a JSON-RPC error or an isError result. */
  call(tool: string, args?: Record<string, unknown>): Promise<unknown>;
  /** tools/list, straight from the page. */
  listTools(): Promise<{ name: string; description: string; inputSchema: unknown }[]>;
  status(): Promise<SessionStatus>;
  exportImages(selection: {
    asIs: boolean;
    generateFormats: string[];
    currentArtboardOnly: boolean;
    locales?: string[];
  }): Promise<SavedFile[]>;
  exportVideo(request: Record<string, unknown>): Promise<SavedFile[]>;
  capture(artboardIds: string[], formatId: string | null, locale?: string | null): Promise<CapturedImage[]>;
  agent(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Publish a local file at a URL the page can fetch. */
  serveFile(absolutePath: string, name?: string): string;
  /** Evaluate in the page. The escape hatch; commands prefer the methods above. */
  evaluate<T>(fn: string, ...args: unknown[]): Promise<T>;
  close(): Promise<void>;
}

let jsonRpcId = 0;

export async function startSession(options: SessionOptions): Promise<Session> {
  const started = Date.now();
  const source = resolveEditor({
    editorUrl: options.editorUrl,
    cwd: options.cwd,
    assetsBaseUrl: options.assetsBaseUrl,
  });
  const manifest = loadManifest(manifestPath());

  let server: EditorServer | null = null;
  let origin: string;
  if (source.kind === 'local') {
    server = await startEditorServer({
      dir: source.dir,
      manifest,
      assetsBaseUrl: options.assetsBaseUrl,
      offline: !!options.offline,
    });
    origin = server.origin;
  } else {
    origin = source.origin;
  }

  const downloadDir = options.downloadDir
    ? ensureDir(path.resolve(options.downloadDir))
    : ensureDir(path.join(process.cwd(), '.osg-downloads'));

  let launched: LaunchedBrowser;
  try {
    launched = await launchBrowser({
      headed: options.headed,
      browser: options.browser,
      offline: options.offline,
      width: options.width,
      height: options.height,
      downloadDir,
      allowHosts: [
        ...(options.allowHosts ?? []),
        ...(source.kind === 'remote' ? [new URL(source.origin).host] : []),
        new URL(options.assetsBaseUrl).host,
      ],
    });
  } catch (error) {
    await server?.close();
    throw error;
  }

  const { page } = launched;

  const teardown = async () => {
    await launched.close();
    await server?.close();
  };

  try {
    // Set before navigation, not after: the bridge installs on mount and the
    // app reads the flag to keep analytics, ads, cloud auto-save, Discover and
    // the collab session out of a machine-driven run.
    await page.evaluateOnNewDocument(() => {
      (window as unknown as { __OSG_HEADLESS: boolean }).__OSG_HEADLESS = true;
    });

    step(`editor: ${source.label}`);
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 120_000 });

    await page
      .waitForFunction('!!window.__osg && window.__osg.ready === true', { timeout: 120_000, polling: 250 })
      .catch(() => {
        throw driverError('The editor loaded but never installed its headless bridge.', [
          'If you passed --editor-url, that deployment is older than this CLI and has no bridge.',
          'Upgrade the deployment, drop --editor-url to use the bundled editor, or downgrade the CLI.',
        ].join(' '));
      });

    const protocol = await page.evaluate('window.__osg.protocol') as number;
    if (protocol !== REQUIRED_PROTOCOL) {
      throw driverError(
        `Editor bridge protocol ${protocol}, this CLI speaks ${REQUIRED_PROTOCOL}.`,
        protocol < REQUIRED_PROTOCOL
          ? 'The editor is older than the CLI. Drop --editor-url, or upgrade the deployment.'
          : 'The CLI is older than the editor. Run `npm i -g open-screenshot-generator@latest`.'
      );
    }
    debug(`session ready in ${humanMs(Date.now() - started)}`);
  } catch (error) {
    await teardown();
    throw error;
  }

  // The one-in-flight queue. Every bridge call chains onto the previous one.
  let tail: Promise<unknown> = Promise.resolve();
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const next = tail.then(work, work);
    // Keep the chain alive after a rejection, or one failed call would poison
    // every later call in the run.
    tail = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  };

  const rpc = (message: unknown): Promise<unknown> =>
    serialize(async () => {
      const name =
        (message as { method?: string; params?: { name?: string } }).method === 'tools/call'
          ? (message as { params?: { name?: string } }).params?.name
          : undefined;
      const budget = name && SLOW_TOOLS.has(name) ? SLOW_HANDLER_TIMEOUT_MS : HANDLER_TIMEOUT_MS;
      debug(`rpc ${(message as { method?: string }).method}${name ? ` ${name}` : ''}`);
      // The page has its own watchdog with the same budgets; this one is a
      // little longer so the app's own error message wins the race and the
      // user learns "waiting on a dialog" rather than "the CLI gave up".
      return await withTimeout(
        page.evaluate((m) => (window as unknown as { __osg: { mcp: (m: unknown) => Promise<unknown> } }).__osg.mcp(m), message),
        budget + 15_000,
        `${name ?? 'request'} did not return within ${Math.round((budget + 15_000) / 1000)}s`
      );
    });

  const session: Session = {
    origin,
    page,
    source,
    server,
    manifest,
    downloadDir,
    rpc,

    async call(tool, args = {}) {
      const response = (await rpc({
        jsonrpc: '2.0',
        id: ++jsonRpcId,
        method: 'tools/call',
        params: { name: tool, arguments: args },
      })) as {
        error?: { code: number; message: string };
        result?: { content?: { type: string; text?: string }[]; isError?: boolean };
      };

      if (response?.error) {
        throw new OsgError(`${tool}: ${response.error.message}`, {
          code: EXIT.driver,
          detail: { tool, jsonRpcCode: response.error.code },
        });
      }
      const text = response?.result?.content?.map((part) => part.text ?? '').join('') ?? '';
      if (response?.result?.isError) {
        throw new OsgError(`${tool}: ${text || 'the tool reported an error'}`, {
          code: EXIT.driver,
          detail: { tool },
        });
      }
      // Most tools answer with a JSON document in a text part. Hand back the
      // parsed value where there is one and the raw text where there is not,
      // rather than forcing every caller to guess.
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    },

    async listTools() {
      const response = (await rpc({ jsonrpc: '2.0', id: ++jsonRpcId, method: 'tools/list' })) as {
        result?: { tools?: { name: string; description: string; inputSchema: unknown }[] };
      };
      return response?.result?.tools ?? [];
    },

    status: () =>
      serialize(() =>
        page.evaluate(() => (window as unknown as { __osg: { status: () => SessionStatus } }).__osg.status())
      ) as Promise<SessionStatus>,

    exportImages: (selection) =>
      serialize(() =>
        withTimeout(
          page.evaluate(
            (s) =>
              (window as unknown as { __osg: { exportImages: (s: unknown) => Promise<SavedFile[]> } }).__osg.exportImages(s),
            selection
          ),
          20 * 60_000,
          'the PNG export did not finish within 20 minutes'
        )
      ) as Promise<SavedFile[]>,

    exportVideo: (request) =>
      serialize(() =>
        withTimeout(
          page.evaluate(
            (r) =>
              (window as unknown as { __osg: { exportVideo: (r: unknown) => Promise<SavedFile[]> } }).__osg.exportVideo(r),
            request
          ),
          45 * 60_000,
          'the video export did not finish within 45 minutes'
        )
      ) as Promise<SavedFile[]>,

    capture: (artboardIds, formatId, locale) =>
      serialize(() =>
        page.evaluate(
          (ids, format, loc) =>
            (
              window as unknown as {
                __osg: { capture: (a: string[], f: string | null, l: string | null) => Promise<CapturedImage[]> };
              }
            ).__osg.capture(ids, format, loc),
          artboardIds,
          formatId,
          locale ?? null
        )
      ) as Promise<CapturedImage[]>,

    agent: (input) =>
      serialize(() =>
        withTimeout(
          page.evaluate(
            (i) =>
              (
                window as unknown as {
                  __osg: { agent: (i: unknown) => Promise<Record<string, unknown>> };
                }
              ).__osg.agent(i),
            input
          ),
          15 * 60_000,
          'the AI agent did not answer within 15 minutes'
        )
      ) as Promise<Record<string, unknown>>,

    serveFile(absolutePath, name) {
      if (!server) {
        throw driverError(
          'A local file cannot be handed to a remote editor.',
          'Drop --editor-url so the CLI serves the editor itself, and the file with it.'
        );
      }
      if (!fs.existsSync(absolutePath)) {
        throw new OsgError(`File not found: ${absolutePath}`, { code: EXIT.usage });
      }
      return server.serveFile(absolutePath, name);
    },

    evaluate: <T,>(fn: string, ...args: unknown[]) =>
      serialize(() => page.evaluate(fn as never, ...(args as never[]))) as Promise<T>,

    close: teardown,
  };

  return session;
}

function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(driverError(message, 'Re-run with --verbose to see the page console.')), ms);
  });
  return Promise.race([work, expiry]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

/**
 * The headless bridge: `window.__osg`.
 *
 * The CLI (npm package `open-screenshot-generator`) drives this exact editor
 * bundle rather than reimplementing any of it, which is the only reason a
 * screenshot it renders is byte-for-byte the screenshot the app renders. This
 * module is the whole seam between the two: a thin facade over handlers that
 * already exist, installed on `window` only when the page was opened with
 * `window.__OSG_HEADLESS` set by the driver before navigation.
 *
 * It adds no behaviour of its own. Every entry point below lands in the same
 * function a click in the UI lands in. mcp() goes through a serial runner of
 * its own, made by createSerialMcpRunner like the desktop server's and the web
 * relay's, so the bridge's calls queue only behind each other:
 *
 *   mcp()           -> createSerialMcpRunner(getMcpApi)   the 49 design tools
 *   exportImages()  -> handleConfirmExport                the store PNG run
 *   exportVideo()   -> handleExportVideo                  the MP4 run
 *   capture()       -> handlePublishCapture               bytes for an upload
 *   loadProject()   -> loadProjectFromData                open a project
 *   agent()         -> generatePlan + buildProjectFromPlan the AI agent
 *
 * Protocol versioning is deliberate: the CLI checks `protocol` and refuses to
 * drive a bundle it does not understand, naming both versions, because
 * `--editor-url` lets somebody point a new CLI at an old deployment.
 */
import type { ArtboardState, Project } from '@/types/artboard';
import type { DeviceFormat } from '@/lib/deviceRegistry';
import type { McpDesignApi } from '@/lib/mcp/desktopMcpServer';
import { createSerialMcpRunner } from '@/lib/mcp/desktopMcpServer';
import type { PublishImage } from '@/lib/publish/types';

/** Bumped whenever a method here changes shape. The CLI pins it. */
export const HEADLESS_PROTOCOL = 1;

export interface HeadlessSaved {
  filename: string;
  path?: string;
}

export interface HeadlessExportSelection {
  asIs: boolean;
  generateFormats: DeviceFormat[];
  currentArtboardOnly: boolean;
  locales?: string[];
}

export interface HeadlessStatus {
  protocol: number;
  ready: boolean;
  projectId: string | null;
  projectName: string;
  artboards: { id: string; name: string; width: number; height: number; elements: number }[];
  locales: string[];
  baseLocale: string | null;
  activeArtboardId: string | null;
}

export interface HeadlessCapturedImage {
  artboardId: string;
  fileName: string;
  /** Base64 PNG. Decoded and written by whoever asked for it. */
  base64: string;
  width: number;
  height: number;
  locale: string | null;
}

export interface HeadlessAgentInput {
  instruction: string;
  /** Full-resolution data URLs of the user's app screenshots, in order. */
  screenshots: { name: string; dataUrl: string }[];
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

export interface HeadlessAgentResult {
  ok: boolean;
  error?: string;
  warnings: string[];
  summary?: {
    action: string;
    templateName: string | null;
    artboardCount: number;
    screenshotsPlaced: number;
    textsUpdated: number;
    localesAdded?: string[];
  };
}

/**
 * Everything the bridge needs from the layout. Passing functions rather than
 * reaching into component state keeps this module free of React and keeps the
 * layout's diff to one call.
 */
export interface HeadlessHost {
  getMcpApi: () => McpDesignApi | null;
  exportImages: (selection: HeadlessExportSelection) => Promise<HeadlessSaved[]>;
  exportVideo: (request: unknown) => Promise<HeadlessSaved[]>;
  capture: (
    artboardIds: string[],
    formatId: DeviceFormat | null,
    locale?: string | null
  ) => Promise<PublishImage[]>;
  loadProject: (data: ArtboardState[], name: string, id: string) => Promise<boolean>;
  getStatus: () => Omit<HeadlessStatus, 'protocol' | 'ready'>;
}

export interface HeadlessBridge {
  protocol: number;
  ready: boolean;
  status: () => HeadlessStatus;
  mcp: (message: unknown) => Promise<unknown>;
  exportImages: (selection: HeadlessExportSelection) => Promise<HeadlessSaved[]>;
  exportVideo: (request: unknown) => Promise<HeadlessSaved[]>;
  capture: (
    artboardIds: string[],
    formatId: DeviceFormat | null,
    locale?: string | null
  ) => Promise<HeadlessCapturedImage[]>;
  /**
   * Open a document as the project `id` and store it under that id. False
   * when the editor refuses it, and a document with no artboards is always
   * refused: a project keeps at least one (canOpenAsProject in
   * src/lib/projectCanvas.ts, which the CLI checks too, to say why).
   */
  loadProject: (data: ArtboardState[], name: string, id: string) => Promise<boolean>;
  agent: (input: HeadlessAgentInput) => Promise<HeadlessAgentResult>;
}

declare global {
  interface Window {
    /** Set by the CLI driver before navigation. Nothing installs without it. */
    __OSG_HEADLESS?: boolean;
    __osg?: HeadlessBridge;
  }
}

/** True when this page is being driven by the CLI rather than by a person. */
export function isHeadless(): boolean {
  return typeof window !== 'undefined' && window.__OSG_HEADLESS === true;
}

async function fileFromDataUrl(dataUrl: string, name: string): Promise<File> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], name, { type: blob.type || 'image/png' });
}

/**
 * Bytes to base64, in chunks. `String.fromCharCode(...bytes)` on a 12 MB PNG
 * blows the argument limit and throws a RangeError, which is a fun way to lose
 * an export that already succeeded.
 */
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Install the bridge and return the function that removes it. The layout
 * calls this once, from an effect, with a host that reads the latest render
 * through refs.
 */
export function installHeadlessBridge(host: HeadlessHost): () => void {
  if (typeof window === 'undefined' || !isHeadless()) return () => {};

  // One call at a time, and a call that follows a write waits until the
  // editor has rendered that write. Every tool closes over the artboards of
  // the render that built it, so a call that started sooner would begin from
  // the board as it was before the previous edit and undo that edit, with no
  // error. The CLI sends one call at a time, but nothing in that makes the
  // page render in between. A call still waiting when the bridge is removed
  // is answered "not ready" and never run.
  let removed = false;
  const run = createSerialMcpRunner(host.getMcpApi, { isOpen: () => !removed });

  const bridge: HeadlessBridge = {
    protocol: HEADLESS_PROTOCOL,
    ready: true,

    status: () => ({ protocol: HEADLESS_PROTOCOL, ready: true, ...host.getStatus() }),

    // An unknown tool comes back as -32602 and a thrown handler as an isError
    // result, so the CLI reports what the app reports rather than guessing.
    // The CLI is never the desktop app's own agent.
    mcp: (message: unknown) => run(message as never, { agent: false }),

    exportImages: (selection) => host.exportImages(selection),
    exportVideo: (request) => host.exportVideo(request),

    async capture(artboardIds, formatId, locale) {
      const images = await host.capture(artboardIds, formatId, locale ?? null);
      // Base64 rather than raw bytes, because this crosses the CDP boundary as
      // JSON. The CLI decodes and writes the file itself, which is how
      // `export_png { save: true }` finally works outside the desktop app.
      return images.map((image) => ({
        artboardId: image.artboardId,
        fileName: image.fileName,
        base64: bytesToBase64(image.bytes),
        width: image.width,
        height: image.height,
        locale: image.locale ?? null,
      }));
    },

    loadProject: (data, name, id) => host.loadProject(data, name, id),

    /**
     * The AI agent, run in the page rather than in node, which buys three
     * things node cannot have: the browser's own screenshot downscale (so the
     * CLI never reimplements STORAGE_MAX_EDGE / AI_MAX_EDGE), the localStorage
     * memo that stops a schema-hostile endpoint being re-probed every run, and
     * the operation timeline the app records for `osg design --trace`.
     */
    async agent(input): Promise<HeadlessAgentResult> {
      try {
        const [{ generatePlan }, { buildProjectFromPlan }, { readScreenshotFile }, { loadProjectTemplates }] =
          await Promise.all([
            import('@/lib/ai/generatePlan'),
            import('@/lib/ai/buildProjectFromPlan'),
            import('@/lib/ai/imageUtils'),
            import('@/services/projectService'),
          ]);

        const shots = [];
        for (const [index, entry] of input.screenshots.entries()) {
          const file = await fileFromDataUrl(entry.dataUrl, entry.name || `screenshot-${index + 1}.png`);
          shots.push(await readScreenshotFile(file));
        }

        const templates: Project[] = await loadProjectTemplates();

        const plan = await generatePlan({
          provider: input.provider as never,
          model: input.model,
          apiKey: input.apiKey,
          baseUrl: input.baseUrl,
          instruction: input.instruction,
          screenshots: shots,
          templates,
        });

        const built = buildProjectFromPlan(plan, shots, templates);
        const opened = await host.loadProject(
          built.project.projectData,
          built.project.name,
          built.project.id
        );
        if (!opened) {
          return { ok: false, error: 'The plan built a project the editor refused to open.', warnings: built.warnings };
        }
        return { ok: true, warnings: built.warnings, summary: built.summary };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          warnings: [],
        };
      }
    },
  };

  window.__osg = bridge;
  return () => {
    removed = true;
    if (window.__osg === bridge) delete window.__osg;
  };
}

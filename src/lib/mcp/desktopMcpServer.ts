// Desktop MCP server — the "application" half.
//
// Rust (src-tauri/src/mcp_server.rs) owns the local HTTP socket and the MCP
// Streamable-HTTP transport; a webview cannot listen on a port. But every
// design action lives here in the frontend, so Rust bridges each JSON-RPC
// request to the main window over the `abs-mcp-request` event, we run it
// against the live artboard state, and hand the JSON-RPC response back through
// the `abs_mcp_respond` command.
//
// This module is import-safe on the web (it only touches Tauri behind the
// isTauri() guard); startDesktopMcpBridge() is a no-op outside the desktop app.

import { isTauri } from '@/lib/desktop';
import {
  LIBRARY_KINDS,
  device3dOptions,
  listLibraryGroups,
  listLibraryItems,
  resolveLibraryItem,
  type LibraryKind,
} from '@/lib/mcp/assetLibrary';
import type {
  ArtboardState,
  ElementType,
  Point,
  Size,
} from '@/types/artboard';

// Must match MCP_REQUEST_EVENT in mcp_server.rs.
const MCP_REQUEST_EVENT = 'abs-mcp-request';
const MCP_STATUS_EVENT = 'abs-mcp-status';

const SERVER_INFO = {
  name: 'open-screenshot-generator',
  title: 'Open Screenshot Generator',
  version: '0.1.0',
};
const DEFAULT_PROTOCOL_VERSION = '2025-06-18';

// ---------------------------------------------------------------------------
// The surface the app layout must implement so the tools can do their work.
// ---------------------------------------------------------------------------

export interface McpArtboardSummary {
  id: string;
  name: string;
  width: number;
  height: number;
  backgroundColor: string;
  elementCount: number;
  active: boolean;
}

/** One template in the Start-a-New-Project gallery. */
export interface McpTemplateSummary {
  id: string;
  name: string;
  category: string;
  description: string;
  artboardCount: number;
  /** Device frames across the whole template — how many screenshots it wants. */
  deviceSlotCount: number;
  width: number;
  height: number;
}

/** A template's fillable slots, per artboard. Element ids are stable. */
export interface McpTemplateDetail extends McpTemplateSummary {
  artboards: Array<{
    index: number;
    name: string;
    width: number;
    height: number;
    deviceSlots: Array<{ elementId: string; deviceType: string; hasScreenshot: boolean }>;
    textSlots: Array<{ elementId: string; content: string }>;
  }>;
}

/** A saved project in the Recent projects list. */
export interface McpProjectSummary {
  id: string;
  name: string;
  /** ISO timestamp of the last save. */
  savedAt: string;
  artboardCount: number;
  open: boolean;
}

/** What creating or opening a project reports back. */
export interface McpProjectResult {
  projectId: string;
  name: string;
  artboards: McpArtboardSummary[];
  warnings: string[];
}

export interface McpDesignApi {
  /** Lightweight list of every artboard on the canvas. */
  listArtboards(): McpArtboardSummary[];
  /** Full state of one artboard (defaults to the active one), or null. */
  getArtboard(id?: string): (ArtboardState & { active: boolean }) | null;
  /** Create a new artboard from an explicit size or a size-preset id. */
  createArtboard(input: {
    name?: string;
    width?: number;
    height?: number;
    preset?: string;
    backgroundColor?: string;
  }): McpArtboardSummary;
  /** Make an artboard the active/selected one. */
  setActiveArtboard(id: string): boolean;
  /** Add an element; returns the new element id. */
  addElement(input: {
    artboardId?: string;
    type: ElementType;
    subType?: string;
    props?: Record<string, unknown>;
  }): { id: string };
  /** Merge props into an existing element. */
  updateElement(input: {
    artboardId?: string;
    elementId: string;
    props: Record<string, unknown>;
  }): boolean;
  /** Remove an element. */
  deleteElement(input: { artboardId?: string; elementId: string }): boolean;
  /** Set an artboard's solid colour or gradient background. */
  setBackground(input: {
    artboardId?: string;
    backgroundColor?: string;
    gradient?: { color1: string; color2: string; angle: number };
  }): boolean;
  /** Render an artboard to a PNG data URL. */
  exportPng(input: { artboardId?: string }): Promise<{ dataUrl: string; width: number; height: number }>;

  // -- Templates and projects -------------------------------------------------

  /** The template gallery, optionally filtered by category or free text. */
  listTemplates(input: { category?: string; query?: string }): McpTemplateSummary[];
  /** One template with its fillable device/text slots, or null. */
  getTemplate(templateId: string): McpTemplateDetail | null;
  /**
   * Copy a template into a new project, open it, and add it to Recent projects.
   * Text/screenshot overrides are applied to the copy before it is saved.
   */
  createProjectFromTemplate(input: {
    templateId: string;
    name?: string;
    texts?: Array<{ elementId: string; content: string }>;
    screenshots?: Array<{ elementId: string; src: string }>;
  }): Promise<McpProjectResult>;
  /** Saved projects, newest first (the Recent projects list). */
  listProjects(): Promise<McpProjectSummary[]>;
  /** Open a saved project in the editor. Null when the id is unknown. */
  openProject(projectId: string): Promise<McpProjectResult | null>;
}

// ---------------------------------------------------------------------------
// Tool definitions. Each tool declares its JSON schema (so the client can call
// it correctly) and a handler that runs it against the McpDesignApi.
// ---------------------------------------------------------------------------

type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

interface ToolResult {
  content: ToolContent[];
  structuredContent?: unknown;
  isError?: boolean;
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, any>, api: McpDesignApi) => Promise<ToolResult> | ToolResult;
}

const SHAPE_TYPES = [
  'rectangle', 'circle', 'triangle', 'message', 'speech-bubble',
  'star', 'hexagon', 'pentagon', 'diamond',
];
const DEVICE_TYPES = [
  'iphone', 'iphone-x', 'iphone-13', 'iphone-14', 'iphone-15', 'iphone-15-pro',
  'iphone-17-pro-max', 'ipad-pro-13', 'ipad-11', 'apple-watch', 'android-bar',
  'android-notch', 'android-punch-hole', 'tablet', 'tablet-7', 'tablet-10', 'desktop',
  'macbook', 'imac',
];

function textResult(value: unknown): ToolResult {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }], structuredContent: typeof value === 'string' ? undefined : value };
}

// Collect the flat element-property arguments shared by add/update into the
// nested { position, size, ...props } shape the design API expects.
function collectElementProps(args: Record<string, any>): Record<string, unknown> {
  const {
    artboardId, elementId, type, subType, id, libraryId, // routing keys, not element props
    x, y, width, height, ...rest
  } = args;
  void artboardId; void elementId; void type; void subType; void id; void libraryId;
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined && v !== null) props[k] = v;
  }
  if (x !== undefined || y !== undefined) {
    props.position = { x: Number(x ?? 0), y: Number(y ?? 0) } as Point;
  }
  if (width !== undefined && height !== undefined) {
    props.size = { width: Number(width), height: Number(height) } as Size;
  }
  return props;
}

// Shared element-property schema fragment for add/update tools.
const ELEMENT_PROP_SCHEMA: Record<string, unknown> = {
  x: { type: 'number', description: 'X position in artboard pixels (top-left origin).' },
  y: { type: 'number', description: 'Y position in artboard pixels (top-left origin).' },
  width: { type: 'number', description: 'Element width in pixels.' },
  height: { type: 'number', description: 'Element height in pixels.' },
  rotation: { type: 'number', description: 'Rotation in degrees.' },
  scale: { type: 'number', description: 'Scale multiplier (1 = 100%).' },
  content: { type: 'string', description: 'Text content (text elements).' },
  fontSize: { type: 'number', description: 'Font size in px (text). ~48 reads well on a phone canvas.' },
  color: { type: 'string', description: 'Text colour, any CSS colour (text).' },
  fontFamily: { type: 'string', description: 'Font family (text).' },
  fontWeight: { type: 'string', description: "e.g. 'normal', 'bold' (text)." },
  textAlign: { type: 'string', description: "'left' | 'center' | 'right' (text)." },
  fillColor: { type: 'string', description: 'Fill colour (shapes).' },
  strokeColor: { type: 'string', description: 'Stroke colour (shapes).' },
  strokeWidth: { type: 'number', description: 'Stroke width in px (shapes).' },
  borderRadius: { type: 'number', description: 'Corner radius in px (rectangle shapes / images).' },
  fillOpacity: { type: 'number', description: 'Fill opacity 0..1 (shapes).' },
  imageSrc: { type: 'string', description: 'Image URL or data: URL (image elements).' },
  objectFit: { type: 'string', description: "'contain' | 'cover' | 'fill' (image/device screenshot)." },
  opacity: { type: 'number', description: 'Opacity 0..1 (images).' },
  screenshotSrc: { type: 'string', description: 'Screenshot URL/data URL to place inside a device frame (device elements).' },
  screenshotObjectFit: { type: 'string', description: "How the screenshot fills the screen: 'contain' | 'cover' | 'fill' (device elements)." },
  styleType: { type: 'string', description: "Device style, e.g. 'normal', '3d-left', '3d-right' (device elements)." },
  pose3d: { type: 'string', description: "3D pose preset, e.g. 'classic', 'front', 'reclined' (device elements)." },
  frameColor3d: { type: 'string', description: "3D body finish: 'titanium' | 'black' | 'white' (device elements)." },
  frameColor: { type: 'string', description: 'Body colour of a flat device frame, any CSS colour (device elements).' },
  frameOpacity: { type: 'number', description: 'Alpha 0..1 for the flat frame colour, for transparent devices (device elements).' },
  frameStyle: { type: 'string', description: "'solid' or 'outline' (a coloured ring around a hollow frame) (device elements)." },
  notchColor: { type: 'string', description: 'Fill of the notch / Dynamic Island / punch hole (device elements).' },
  name: { type: 'string', description: 'Layer name shown in the Layers panel.' },
};

const TOOLS: ToolDef[] = [
  {
    name: 'list_artboards',
    description: 'List every artboard (screen) on the canvas with its id, name, size, background and element count. Call this first to discover ids.',
    inputSchema: { type: 'object', properties: {} },
    run: (_args, api) => textResult(api.listArtboards()),
  },
  {
    name: 'get_artboard',
    description: 'Get the full state of one artboard, including every element and its properties. Omit artboardId for the active artboard.',
    inputSchema: {
      type: 'object',
      properties: { artboardId: { type: 'string', description: 'Defaults to the active artboard.' } },
    },
    run: (args, api) => {
      const board = api.getArtboard(args.artboardId);
      if (!board) return { ...textResult('No such artboard.'), isError: true };
      return textResult(board);
    },
  },
  {
    name: 'create_artboard',
    description: 'Create a new artboard. Give either a width and height (pixels) or a size-preset id (e.g. "iphone-6-9"). Returns the new artboard.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        width: { type: 'number' },
        height: { type: 'number' },
        preset: { type: 'string', description: 'A canvas size preset id in place of width/height.' },
        backgroundColor: { type: 'string', description: 'Any CSS colour; defaults to white.' },
      },
    },
    run: (args, api) =>
      textResult(
        api.createArtboard({
          name: args.name,
          width: args.width,
          height: args.height,
          preset: args.preset,
          backgroundColor: args.backgroundColor,
        })
      ),
  },
  {
    name: 'set_active_artboard',
    description: 'Select an artboard so subsequent tools without an explicit artboardId target it.',
    inputSchema: {
      type: 'object',
      properties: { artboardId: { type: 'string' } },
      required: ['artboardId'],
    },
    run: (args, api) => {
      const ok = api.setActiveArtboard(args.artboardId);
      return ok ? textResult({ ok }) : { ...textResult('No such artboard.'), isError: true };
    },
  },
  {
    name: 'add_element',
    description:
      'Add an element to an artboard and return its id. type is one of text, shape, device, image. For shapes set subType to a shape name; for devices set subType to a device type. Position with x/y and size with width/height (artboard pixels). To place a ready-made asset from the palette (vector element, photo, badge, 3D or coloured device preset) pass libraryId from list_library instead of type/subType.',
    inputSchema: {
      type: 'object',
      properties: {
        artboardId: { type: 'string', description: 'Defaults to the active artboard.' },
        type: { type: 'string', enum: ['text', 'shape', 'device', 'image'] },
        subType: {
          type: 'string',
          description: `Shape name (${SHAPE_TYPES.join(', ')}) or device type (${DEVICE_TYPES.join(', ')}).`,
        },
        libraryId: {
          type: 'string',
          description: 'A palette asset id from list_library (e.g. "element:shape-octagon", "image:app-store", "device3d:iphone-tilted-left-black"). Fills in type, subType and the asset artwork; anything you pass alongside it wins.',
        },
        ...ELEMENT_PROP_SCHEMA,
      },
    },
    run: (args, api) => {
      let { type, subType } = args;
      let libraryProps: Record<string, unknown> = {};
      if (args.libraryId) {
        const resolved = resolveLibraryItem(args.libraryId);
        if (!resolved) {
          return { ...textResult(`Unknown libraryId "${args.libraryId}". Call list_library to get valid ids.`), isError: true };
        }
        type = type ?? resolved.type;
        subType = subType ?? resolved.subType;
        libraryProps = { ...resolved.props };
        // The asset's own size unless the caller gave explicit dimensions.
        if (resolved.defaultSize && (args.width === undefined || args.height === undefined)) {
          libraryProps.size = resolved.defaultSize;
        }
      }
      if (!type) {
        return { ...textResult('Pass either type (text, shape, device, image) or libraryId.'), isError: true };
      }
      const props = { ...libraryProps, ...collectElementProps(args) };
      const { id } = api.addElement({ artboardId: args.artboardId, type, subType, props });
      return textResult({ id });
    },
  },
  {
    name: 'update_element',
    description: 'Change properties of an existing element (position, size, colours, text, ...). Only the properties you pass are changed.',
    inputSchema: {
      type: 'object',
      properties: {
        artboardId: { type: 'string', description: 'Defaults to the active artboard.' },
        elementId: { type: 'string' },
        ...ELEMENT_PROP_SCHEMA,
      },
      required: ['elementId'],
    },
    run: (args, api) => {
      const props = collectElementProps(args);
      const ok = api.updateElement({ artboardId: args.artboardId, elementId: args.elementId, props });
      return ok ? textResult({ ok }) : { ...textResult('No such element.'), isError: true };
    },
  },
  {
    name: 'delete_element',
    description: 'Remove an element from an artboard.',
    inputSchema: {
      type: 'object',
      properties: {
        artboardId: { type: 'string', description: 'Defaults to the active artboard.' },
        elementId: { type: 'string' },
      },
      required: ['elementId'],
    },
    run: (args, api) => {
      const ok = api.deleteElement({ artboardId: args.artboardId, elementId: args.elementId });
      return ok ? textResult({ ok }) : { ...textResult('No such element.'), isError: true };
    },
  },
  {
    name: 'set_background',
    description: 'Set an artboard background to a solid colour or a two-stop gradient.',
    inputSchema: {
      type: 'object',
      properties: {
        artboardId: { type: 'string', description: 'Defaults to the active artboard.' },
        backgroundColor: { type: 'string', description: 'Any CSS colour for a solid background.' },
        gradient: {
          type: 'object',
          description: 'Two-stop linear gradient.',
          properties: {
            color1: { type: 'string' },
            color2: { type: 'string' },
            angle: { type: 'number', description: 'Gradient angle in degrees.' },
          },
          required: ['color1', 'color2', 'angle'],
        },
      },
    },
    run: (args, api) => {
      // A half-filled gradient would land in the artboard state and break the
      // background controls, so reject it here rather than storing it.
      const g = args.gradient;
      if (g && !(typeof g.color1 === 'string' && typeof g.color2 === 'string' && typeof g.angle === 'number')) {
        return { ...textResult('gradient needs color1, color2 and angle.'), isError: true };
      }
      const ok = api.setBackground({
        artboardId: args.artboardId,
        backgroundColor: args.backgroundColor,
        gradient: args.gradient,
      });
      return ok ? textResult({ ok }) : { ...textResult('No such artboard.'), isError: true };
    },
  },
  {
    name: 'list_templates',
    description:
      'List the ready-made store-screenshot templates (the Start a New Project gallery). Each entry reports how many artboards and device frames it has, so you can pick one that fits the number of screenshots you have. Start here rather than building a design from scratch. App Preview video templates are omitted: their mockups play a screen recording, which cannot be supplied over MCP.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Restrict to one gallery tab, e.g. "app-store", "play-store", "apple-watch", "mac".' },
        query: { type: 'string', description: 'Free-text filter over name, description and category.' },
      },
    },
    run: (args, api) => textResult(api.listTemplates({ category: args.category, query: args.query })),
  },
  {
    name: 'get_template',
    description:
      'Get one template\'s fillable slots: per artboard, the device frames (where screenshots go) and the text elements with their current copy. The element ids are stable, so pass them to create_project_from_template or update_element.',
    inputSchema: {
      type: 'object',
      properties: { templateId: { type: 'string' } },
      required: ['templateId'],
    },
    run: (args, api) => {
      const detail = api.getTemplate(args.templateId);
      if (!detail) return { ...textResult('No such template. Call list_templates for valid ids.'), isError: true };
      return textResult(detail);
    },
  },
  {
    name: 'create_project_from_template',
    description:
      'Copy a template into a new project, open it in the editor and add it to Recent projects. Optionally fill text and device screenshots in the same call using element ids from get_template. Returns the new project id and its artboards.',
    inputSchema: {
      type: 'object',
      properties: {
        templateId: { type: 'string' },
        name: { type: 'string', description: 'Project name. Defaults to "<template> Copy".' },
        texts: {
          type: 'array',
          description: 'Text replacements applied to the copy.',
          items: {
            type: 'object',
            properties: {
              elementId: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['elementId', 'content'],
          },
        },
        screenshots: {
          type: 'array',
          description: 'Screenshots to place inside device frames.',
          items: {
            type: 'object',
            properties: {
              elementId: { type: 'string', description: 'A device slot id from get_template.' },
              src: { type: 'string', description: 'Image URL or data: URL.' },
            },
            required: ['elementId', 'src'],
          },
        },
      },
      required: ['templateId'],
    },
    run: async (args, api) => {
      const result = await api.createProjectFromTemplate({
        templateId: args.templateId,
        name: args.name,
        texts: args.texts,
        screenshots: args.screenshots,
      });
      return textResult(result);
    },
  },
  {
    name: 'list_projects',
    description: 'List saved projects, newest first (the Recent projects list). `open` marks the one currently in the editor.',
    inputSchema: { type: 'object', properties: {} },
    run: async (_args, api) => textResult(await api.listProjects()),
  },
  {
    name: 'open_project',
    description: 'Open a saved project in the editor so you can inspect or edit its artboards. Use list_projects to find ids.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
    },
    run: async (args, api) => {
      const result = await api.openProject(args.projectId);
      if (!result) return { ...textResult('No such project. Call list_projects for valid ids.'), isError: true };
      return textResult(result);
    },
  },
  {
    name: 'list_library',
    description:
      'Browse the palette asset libraries: "elements" (vector shapes, arrows, icons, blobs, waves, patterns), "devices" (flat mockups, 3D posed devices, coloured frames) and "images" (photos of people holding phones, store badges). Without a group you get the groups and their sizes; with a group you get its items. Pass an item\'s libraryId to add_element.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: LIBRARY_KINDS, description: 'Which library to browse. Omit to list the groups in all three.' },
        group: { type: 'string', description: 'A group id from a previous call; returns that group\'s items.' },
        query: { type: 'string', description: 'Free-text filter over item labels and ids.' },
        limit: { type: 'number', description: 'Max items to return (default 200).' },
      },
    },
    run: (args) => {
      const kind = args.kind as LibraryKind | undefined;
      if (kind && !LIBRARY_KINDS.includes(kind)) {
        return { ...textResult(`Unknown kind "${args.kind}". Use one of: ${LIBRARY_KINDS.join(', ')}.`), isError: true };
      }
      // Groups-only view: no kind, or a kind with nothing narrowing it down.
      if (!kind || (!args.group && !args.query)) {
        return textResult({
          groups: listLibraryGroups(kind),
          ...(kind === 'devices' || !kind
            ? { device3dOptions: device3dOptions(), note: '3D poses can also be set directly on any device element with styleType + pose3d + frameColor3d.' }
            : {}),
        });
      }
      const { items, total } = listLibraryItems(kind, { group: args.group, query: args.query, limit: args.limit });
      return textResult({ items, returned: items.length, total });
    },
  },
  {
    name: 'export_png',
    description: 'Render an artboard to a PNG image and return it. Omit artboardId for the active artboard.',
    inputSchema: {
      type: 'object',
      properties: { artboardId: { type: 'string', description: 'Defaults to the active artboard.' } },
    },
    run: async (args, api) => {
      const { dataUrl, width, height } = await api.exportPng({ artboardId: args.artboardId });
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
      return {
        content: [
          { type: 'image', data: base64, mimeType: 'image/png' },
          { type: 'text', text: `Rendered ${width}x${height} PNG.` },
        ],
      };
    },
  },
];

function toolListPayload() {
  return TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
}

export interface McpToolSummary {
  name: string;
  description: string;
  params: string[];
}

/** Tool name/description/parameter list for the in-app info panel. Static — safe
 *  to call anywhere (no Tauri dependency). */
export function getMcpToolSummaries(): McpToolSummary[] {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    params: Object.keys((t.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}),
  }));
}

// ---------------------------------------------------------------------------
// JSON-RPC dispatch. Rust only bridges *requests* (they always carry an id), so
// every message here yields exactly one response object.
// ---------------------------------------------------------------------------

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: unknown;
  method?: string;
  params?: any;
}

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}
function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

export async function handleMcpMessage(
  message: JsonRpcMessage,
  api: McpDesignApi | null
): Promise<unknown> {
  const { id, method, params } = message;
  switch (method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: params?.protocolVersion ?? DEFAULT_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          'Open Screenshot Generator design tools. Use list_artboards to discover ids, create_artboard / add_element / update_element to build a screen, and export_png to render it.',
      });
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: toolListPayload() });
    case 'tools/call': {
      const name = params?.name as string | undefined;
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${name}`);
      if (!api) {
        return rpcResult(id, {
          content: [{ type: 'text', text: 'Open Screenshot Generator is not ready yet. Try again in a moment.' }],
          isError: true,
        });
      }
      try {
        const result = await tool.run(params?.arguments ?? {}, api);
        return rpcResult(id, result);
      } catch (e) {
        return rpcResult(id, {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        });
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

// ---------------------------------------------------------------------------
// The bridge: listen for Rust-forwarded requests, run them, reply.
// ---------------------------------------------------------------------------

/**
 * Start handling MCP requests bridged from the Rust transport. `getApi` is
 * called per request so it always sees the latest design state. Returns an
 * unsubscribe function. No-op (returns immediately) outside the desktop app.
 */
export async function startDesktopMcpBridge(
  getApi: () => McpDesignApi | null
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const [{ listen }, { invoke }] = await Promise.all([
    import('@tauri-apps/api/event'),
    import('@tauri-apps/api/core'),
  ]);

  const unlisten = await listen<{ callId: string; message: JsonRpcMessage }>(
    MCP_REQUEST_EVENT,
    async (event) => {
      const { callId, message } = event.payload;
      let response: unknown;
      try {
        response = await handleMcpMessage(message, getApi());
      } catch (e) {
        response = rpcError(message?.id, -32603, e instanceof Error ? e.message : String(e));
      }
      try {
        await invoke('abs_mcp_respond', { callId, response });
      } catch {
        // The HTTP handler will time out on its own if the reply cannot be
        // delivered; nothing more we can do here.
      }
    }
  );
  return () => unlisten();
}

export interface McpServerStatus {
  running: boolean;
  port: number | null;
  url: string | null;
}

/** Read the current server status (running + URL) from the Rust side. */
export async function getMcpStatus(): Promise<McpServerStatus> {
  if (!isTauri()) return { running: false, port: null, url: null };
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<McpServerStatus>('abs_mcp_status');
}

/** Subscribe to server on/off changes (fired when the Settings toggle flips). */
export async function listenMcpStatus(
  cb: (status: McpServerStatus) => void
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<McpServerStatus>(MCP_STATUS_EVENT, (e) => cb(e.payload));
  return () => unlisten();
}

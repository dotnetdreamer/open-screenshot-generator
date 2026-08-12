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
import {
  deleteImageAsset,
  listImageAssets,
  resolveAssetProps,
  saveImageAsset,
  type StoredAsset,
} from '@/lib/mcp/assetStore';
import {
  listSupportedLocales,
  resolveCatalogLocale,
  type LocaleOverrideInput,
  type LocaleResetInput,
  type LocaleTextInput,
  type McpBulkTextResult,
  type McpLocaleConfigResult,
  type McpLocaleOverrideResult,
  type McpLocaleResetResult,
  type McpTranslationView,
  type TranslationViewOptions,
} from '@/lib/mcp/localeTools';
import type { LocalizedTextResult } from '@/lib/mcp/localizedText';
import { ALL_FONTS } from '@/services/fontService';
import { customFontFamilies } from '@/services/customFonts';
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

/** A rectangle in artboard pixels (top-left origin). */
export interface McpBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * What an element actually occupies once rendered — the thing no caller can
 * work out from the stored props alone, because text is laid out at
 * fontSize/0.3 and wraps inside its box.
 */
export interface McpElementMeasurement {
  elementId: string;
  artboardId: string;
  type: string;
  /** Axis-aligned bounds of the rendered element (includes rotation). */
  box: McpBox;
  /** What the stored props ask for: position and size × scale. */
  declared: McpBox;
  /** Text only: the box the glyphs really fill. */
  textBox?: McpBox;
  /** Text only: glyph size in artboard px (≈ 3.33 × the stored fontSize). */
  renderedFontSize?: number;
  /** Text only: the copy is taller/wider than its box and is being clipped. */
  clipped?: boolean;
  artboard: { width: number; height: number };
}

/** One rendered artboard, returned inline, written to disk, or both. */
export interface McpExportResult {
  artboardId: string;
  name: string;
  /** Output pixel size (artboard size × scale). */
  width: number;
  height: number;
  scale: number;
  /** Where it was written, when saving to disk was asked for. */
  path?: string;
  /** The PNG itself, when it was asked for inline. */
  dataUrl?: string;
  /** Size of the encoded PNG, so a caller can see what a scale change saved. */
  bytes: number;
}

/** One element to create in a batch. */
export interface McpElementSpec {
  type?: ElementType;
  subType?: string;
  props: Record<string, unknown>;
}

/** One language the project exports, with how much of it is written. */
export interface McpLocaleSummary {
  /** Store locale, e.g. "de-DE". The key everything else takes. */
  code: string;
  /** English name, e.g. "German". */
  name: string;
  /** The language's own name, e.g. "Deutsch". */
  nativeName: string;
  /** The language the design is written in. Exactly one is true. */
  base: boolean;
  /** The one the editor is showing right now. */
  active: boolean;
  /** Text elements with copy of their own in this language, out of the total. */
  translated: number;
  total: number;
}

/** The project's languages and which one the canvas is currently showing. */
export interface McpLocaleState {
  baseLocale: string;
  /** Null when the base language is showing. */
  activeLocale: string | null;
  /** The base language first, then each export language in project order. */
  locales: McpLocaleSummary[];
}

/** What one machine translation run did to one language. */
export interface McpTranslateRun {
  locale: string;
  translated: number;
  /** Asked for and did not come back. */
  failed: number;
  /** In scope and deliberately left alone, because a person wrote it. */
  skipped: number;
  /** The engine stopped answering, so `failed` includes strings never sent. */
  rateLimited: boolean;
  /**
   * This language could not be run at all, e.g. the engine does not cover it.
   * The other languages in the same call still ran.
   */
  error?: string;
}

export interface McpTranslateRunResult {
  /** The engine that ran. Null means none is configured in this app. */
  engine: 'ai' | 'libre' | null;
  runs: McpTranslateRun[];
  /** How complete each language is now. */
  completion: Array<{ locale: string; translated: number; total: number }>;
}

/** The translator's spreadsheet. */
export interface McpCsvExport {
  /** RFC4180 with CRLF line endings, ready to write to a .csv file. */
  csv: string;
  /** The language columns, after the id and base-string ones. */
  locales: string[];
  rows: number;
}

/** What a filled-in spreadsheet would change, and what was written. */
export interface McpCsvImport {
  applied: number;
  /** Rows whose ids and base string matched nothing in the project. */
  unmatched: number;
  /** True when nothing was written because the call only asked for the plan. */
  dryRun: boolean;
  changes: Array<{
    artboardId: string;
    elementId: string;
    locale: string;
    label: string;
    from: string;
    to: string;
    /** 'text' means the ids did not line up and the base string was the anchor. */
    matchedBy: 'id' | 'text';
  }>;
}

export interface McpDesignApi {
  /**
   * Lightweight list of every artboard on the canvas. A locale reads that
   * language's projection, where the only thing that can differ is the element
   * count, since an element may be hidden in one language.
   */
  listArtboards(locale?: string | null): McpArtboardSummary[];
  /**
   * Full state of one artboard (defaults to the active one), or null. With a
   * locale it is that language's projection: translated copy, substituted fonts
   * and per-language screenshots, read-only.
   */
  getArtboard(id?: string, locale?: string | null): (ArtboardState & { active: boolean }) | null;
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
  /** Rename, resize and/or reorder an artboard. Null when the id is unknown. */
  updateArtboard(input: {
    artboardId?: string;
    name?: string;
    width?: number;
    height?: number;
    preset?: string;
    /** New position in the canvas order (0-based). */
    index?: number;
    /** Scale the elements with the canvas on a resize (default true). */
    scaleContent?: boolean;
  }): McpArtboardSummary | null;
  /** Remove an artboard. Null when the id is unknown. */
  deleteArtboard(input: { artboardId?: string }): { deletedId: string; artboards: McpArtboardSummary[] } | null;
  /** Copy an artboard (elements included) and insert the copy after it. */
  duplicateArtboard(input: { artboardId?: string; name?: string; index?: number }): McpArtboardSummary | null;
  /** Add an element; returns the new element id. */
  addElement(input: {
    artboardId?: string;
    type: ElementType;
    subType?: string;
    props?: Record<string, unknown>;
  }): { id: string };
  /** Add several elements in one state update (all or nothing). */
  addElements(input: { artboardId?: string; elements: McpElementSpec[] }): { ids: string[] };
  /** Merge props into an existing element. */
  updateElement(input: {
    artboardId?: string;
    elementId: string;
    props: Record<string, unknown>;
  }): boolean;
  /** Remove an element. */
  deleteElement(input: { artboardId?: string; elementId: string }): boolean;
  /** Move an element through the stack (z-order is array order). */
  reorderElement(input: {
    artboardId?: string;
    elementId: string;
    action?: 'front' | 'back' | 'forward' | 'backward';
    index?: number;
  }): { index: number; total: number } | null;
  /** Measure what an element really occupies on the rendered canvas. */
  measureElement(input: { artboardId?: string; elementId: string }): McpElementMeasurement | null;
  /** Tag elements so they can be moved as one. Pass clear to untag them. */
  groupElements(input: {
    artboardId?: string;
    elementIds: string[];
    groupId?: string;
    clear?: boolean;
  }): { groupId: string | null; elementIds: string[] } | null;
  /** Move/scale a set of elements together, about the set's bounding box. */
  transformElements(input: {
    artboardId?: string;
    elementIds?: string[];
    groupId?: string;
    dx?: number;
    dy?: number;
    x?: number;
    y?: number;
    scale?: number;
  }): { elementIds: string[]; bounds: McpBox } | null;
  /** Set an artboard's solid colour or gradient background. */
  setBackground(input: {
    artboardId?: string;
    backgroundColor?: string;
    gradient?: { color1: string; color2: string; angle: number };
  }): boolean;
  /**
   * Render one artboard to a PNG (inline, on disk, or both). With a locale the
   * canvas is switched to it for the capture and switched back afterwards;
   * undefined captures whatever is on screen.
   */
  exportPng(input: {
    artboardId?: string;
    scale?: number;
    save?: boolean;
    directory?: string;
    fileName?: string;
    includeImage?: boolean;
    locale?: string | null;
  }): Promise<McpExportResult>;
  /** Render every artboard, normally straight to a folder. */
  exportAll(input: {
    scale?: number;
    save?: boolean;
    directory?: string;
    includeImage?: boolean;
    locale?: string | null;
  }): Promise<McpExportResult[]>;

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

  // -- Languages --------------------------------------------------------------

  /** The project's languages and the one on screen. Never null; no languages
   *  means a single entry for the base one. */
  listLocales(): McpLocaleState;
  /**
   * Switch the language the editor shows. Null (or the base code) goes back to
   * the base language. Resolves once the canvas has repainted, so an export
   * straight after this renders the language that was asked for. Null when the
   * project does not have that language.
   */
  setLocale(locale: string | null): Promise<McpLocaleState | null>;
  /**
   * Write one text element's copy for one language, leaving every other
   * language and the base document's own copy alone. An empty string clears it
   * again. Null when the artboard or the text element is not there.
   */
  setLocalizedText(input: {
    artboardId?: string;
    elementId: string;
    locale: string;
    text: string;
  }): LocalizedTextResult | null;
  /**
   * Add export languages, and set autoFont / autoFit on any of the listed codes
   * that the project already has. With `machineTranslate`, every newly added
   * language is drafted by the translation engine in the same commit, which is
   * what ticking the box in the language manager does.
   */
  addLocales(input: {
    locales: string[];
    baseLocale?: string;
    autoFont?: boolean;
    autoFit?: boolean;
    machineTranslate?: boolean;
  }): Promise<McpLocaleConfigResult & { translation?: McpTranslateRunResult }>;
  /** Remove export languages and every translation stored under them. */
  removeLocales(input: { locales: string[] }): McpLocaleConfigResult;
  /**
   * Say which language the design itself is written in. Throws once the project
   * has export languages, because re-basing would re-point every translation at
   * a different source string.
   */
  setBaseLocale(input: { locale: string }): McpLocaleConfigResult;
  /** The translation table as data: one row per string, one cell per language. */
  listTranslations(input: TranslationViewOptions): McpTranslationView;
  /** Write a batch of translated strings in ONE state update. */
  setLocalizedTexts(input: { writes: LocaleTextInput[] }): McpBulkTextResult;
  /**
   * Run the machine translation engine into one or more languages, optionally
   * narrowed to some artboards or elements. Commits once, for all of them.
   */
  translateLocales(input: {
    locales: string[];
    only?: 'empty' | 'stale' | 'all';
    includeManual?: boolean;
    guidance?: string;
    artboardIds?: string[];
    elementIds?: string[];
  }): Promise<McpTranslateRunResult>;
  /** The translator's spreadsheet, as text. */
  exportTranslationsCsv(input: { locales?: string[] }): McpCsvExport;
  /** Read a filled-in spreadsheet back. `dryRun` reports without writing. */
  importTranslationsCsv(input: { csv: string; dryRun?: boolean; locales?: string[] }): McpCsvImport;
  /**
   * Give one element its own copy of a property in one language: its own
   * screenshot, its own typeface, its own position, or hide it there entirely.
   */
  setLocaleOverride(input: LocaleOverrideInput): McpLocaleOverrideResult;
  /** Hand a language's overrides back to the shared design, at any scope. */
  resetLocaleOverrides(input: LocaleResetInput): McpLocaleResetResult;
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

/**
 * Render export results as MCP content: the summary as text (paths, sizes) plus
 * an image block per file that asked to come back inline. The data URLs are
 * stripped out of the summary — they are the payload, not metadata.
 */
function exportResultContent(results: McpExportResult[]): ToolResult {
  const content: ToolContent[] = [];
  for (const result of results) {
    if (result.dataUrl) {
      content.push({
        type: 'image',
        data: result.dataUrl.replace(/^data:image\/png;base64,/, ''),
        mimeType: 'image/png',
      });
    }
  }
  const summary = results.map(({ dataUrl, ...rest }) => rest);
  content.push({ type: 'text', text: JSON.stringify(summary.length === 1 ? summary[0] : summary, null, 2) });
  return { content, structuredContent: summary.length === 1 ? summary[0] : { files: summary } };
}

// Collect the flat element-property arguments shared by add/update into the
// nested { position, size, ...props } shape the design API expects.
//
// An explicit null means "clear this property" and becomes undefined, which the
// spread in updateElement drops off the element (and JSON.stringify then leaves
// out of the saved project). That is the only way to take a shadow or a
// gradient fill back off once it is set.
function collectElementProps(args: Record<string, any>): Record<string, unknown> {
  const {
    artboardId, elementId, type, subType, id, libraryId, // routing keys, not element props
    x, y, width, height, ...rest
  } = args;
  void artboardId; void elementId; void type; void subType; void id; void libraryId;
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined) props[k] = v === null ? undefined : v;
  }
  if (x !== undefined || y !== undefined) {
    props.position = { x: Number(x ?? 0), y: Number(y ?? 0) } as Point;
  }
  if (width !== undefined && height !== undefined) {
    props.size = { width: Number(width), height: Number(height) } as Size;
  }
  return props;
}

// ---------------------------------------------------------------------------
// Fonts. An unknown family used to fall through to the browser's default serif
// with no complaint, so a design would silently render in the wrong typeface.
// ---------------------------------------------------------------------------

// Recomputed per call, not cached: the user can import a font at any point in
// a session, and a snapshot taken at module load would reject it forever.
const fontFamilies = () => [...ALL_FONTS.map((f) => f.family), ...customFontFamilies()];
const fontByLower = () => new Map(fontFamilies().map((f) => [f.toLowerCase(), f]));

/** Nearest known families to a miss, for the error message. */
function similarFonts(requested: string, limit = 5): string[] {
  const needle = requested.toLowerCase().replace(/[^a-z0-9]/g, '');
  const scored = fontFamilies().map((family) => {
    const hay = family.toLowerCase().replace(/[^a-z0-9]/g, '');
    let score = 0;
    if (hay.includes(needle) || needle.includes(hay)) score = 100;
    else {
      // Cheap similarity: how many leading characters they share.
      while (score < Math.min(hay.length, needle.length) && hay[score] === needle[score]) score++;
    }
    return { family, score };
  })
    .filter((s) => s.score > 1)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.family);
}

/**
 * Normalise a requested family to its canonical spelling, or explain the miss.
 * Case- and spacing-insensitive so "fredoka one" and "Roboto  Flex" resolve.
 */
function resolveFontFamily(requested: unknown): { family?: string; error?: string } {
  if (typeof requested !== 'string' || !requested.trim()) return {};
  const raw = requested.trim();
  const known = fontByLower();
  const exact = known.get(raw.toLowerCase());
  if (exact) return { family: exact };
  const collapsed = known.get(raw.toLowerCase().replace(/\s+/g, ' '));
  if (collapsed) return { family: collapsed };
  const near = similarFonts(raw);
  return {
    error:
      `Unknown fontFamily "${raw}". The app only loads the families list_fonts returns, and anything else falls back to a system serif.` +
      (near.length > 0 ? ` Closest available: ${near.join(', ')}.` : ' Call list_fonts for the full list.'),
  };
}

// ---------------------------------------------------------------------------
// Languages. The project's own list is the vocabulary: a locale nobody added
// has no override map to write into, so a miss is reported rather than guessed.
// ---------------------------------------------------------------------------

/**
 * Resolves a requested language to one of the project's codes. Exact first,
 * then the language part alone ("de" for "de-DE") when only one code could be
 * meant, then the English or native name, because a caller rarely quotes a
 * store locale back exactly.
 */
function matchLocale(requested: unknown, state: McpLocaleState): string | null {
  if (typeof requested !== 'string') return null;
  const wanted = requested.trim().toLowerCase();
  if (!wanted) return null;
  const exact = state.locales.find((l) => l.code.toLowerCase() === wanted);
  if (exact) return exact.code;
  const byLanguage = state.locales.filter((l) => l.code.toLowerCase().split('-')[0] === wanted);
  if (byLanguage.length === 1) return byLanguage[0].code;
  const byName = state.locales.find(
    (l) => l.name.toLowerCase() === wanted || l.nativeName.toLowerCase() === wanted
  );
  return byName ? byName.code : null;
}

/** "de-DE (German), ja (Japanese)" for an error message. */
function localeChoices(state: McpLocaleState): string {
  return state.locales.map((l) => `${l.code} (${l.name})`).join(', ');
}

/**
 * The `locale` argument the export tools take. `undefined` means "whatever the
 * canvas is showing", which is what every export did before languages existed
 * and what a project with none still does, so it stays distinct from an
 * explicit request for the base language.
 */
function exportLocale(
  requested: unknown,
  api: McpDesignApi
): { locale?: string | null } | { error: string } {
  if (requested === undefined) return {};
  const state = api.listLocales();
  if (requested === null) return { locale: null };
  const locale = matchLocale(requested, state);
  if (!locale) {
    return {
      error: `This project has no language "${requested}". It has: ${localeChoices(state)}.`,
    };
  }
  return { locale: locale === state.baseLocale ? null : locale };
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
  fontSize: { type: 'number', description: 'Font size (text). Glyphs render about 3.3x this in artboard pixels, so ~48 is a headline on a phone canvas. Use measure_element for the real bounds.' },
  color: { type: 'string', description: 'Text colour, any CSS colour (text).' },
  fontFamily: { type: 'string', description: 'Font family (text). Must be one list_fonts returns; anything else is rejected rather than silently falling back.' },
  fontWeight: { type: 'string', description: "e.g. 'normal', 'bold' (text)." },
  fontStyle: { type: 'string', description: "'normal' | 'italic' (text)." },
  textDecoration: { type: 'string', description: "'none' | 'underline' | 'line-through' (text)." },
  textAlign: { type: 'string', description: "'left' | 'center' | 'right' (text)." },
  lineHeight: { type: 'number', description: 'Line height as a multiplier of the font size, e.g. 1.1 for tight headlines (text).' },
  letterSpacing: { type: 'number', description: 'Tracking, in the same units as fontSize (negative tightens). Text elements.' },
  fillColor: { type: 'string', description: 'Fill colour (shapes).' },
  fillGradient: {
    type: 'object',
    description: 'Two-stop linear gradient fill for a shape; wins over fillColor. Pass null to go back to the solid fill.',
    properties: {
      color1: { type: 'string' },
      color2: { type: 'string' },
      angle: { type: 'number', description: '0 = bottom to top, 90 = left to right.' },
    },
    required: ['color1', 'color2', 'angle'],
  },
  strokeColor: { type: 'string', description: 'Stroke colour (shapes).' },
  strokeWidth: { type: 'number', description: 'Stroke width in px (shapes).' },
  borderRadius: { type: 'number', description: 'Corner radius in px (rectangle shapes / images).' },
  fillOpacity: { type: 'number', description: 'Fill opacity 0..1 (shapes). Fades the fill only, not the stroke.' },
  innerRadius: { type: 'number', description: 'Hollow centre as a percent of the radius, 0..95, turns a circle or diamond into a ring (shapes).' },
  imageSrc: { type: 'string', description: 'Image URL, data: URL, or an "asset:<id>" reference from upload_asset (image elements).' },
  objectFit: { type: 'string', description: "'contain' | 'cover' | 'fill' (image/device screenshot)." },
  opacity: { type: 'number', description: 'Opacity 0..1 for the whole element. Works on every element type.' },
  shadow: {
    type: 'object',
    description: 'Drop shadow cast by the element\'s real silhouette (a star casts a star). Offsets and blur are in artboard px. Pass null to remove it.',
    properties: {
      x: { type: 'number' },
      y: { type: 'number' },
      blur: { type: 'number' },
      color: { type: 'string', description: "Any CSS colour with alpha, e.g. 'rgba(0,0,0,0.35)'." },
    },
    required: ['x', 'y', 'blur', 'color'],
  },
  blur: { type: 'number', description: 'Gaussian blur radius in artboard px. Use it for soft background glows. Works on every element type.' },
  screenshotSrc: { type: 'string', description: 'Screenshot URL, data: URL or "asset:<id>" to place inside a device frame (device elements).' },
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

/**
 * Turn one add_element-shaped argument bag into a ready element spec:
 * expand a palette `libraryId`, canonicalise the font family (and reject a
 * family we do not load), then swap any `asset:<id>` image reference for the
 * bytes it stands for. Shared by add_element and add_elements so a batch
 * validates exactly like a single call.
 */
async function buildElementSpec(
  args: Record<string, any>
): Promise<{ ok: true; spec: McpElementSpec } | { ok: false; message: string }> {
  let { type, subType } = args;
  let libraryProps: Record<string, unknown> = {};
  if (args.libraryId) {
    const resolved = resolveLibraryItem(args.libraryId);
    if (!resolved) {
      return { ok: false, message: `Unknown libraryId "${args.libraryId}". Call list_library to get valid ids.` };
    }
    type = type ?? resolved.type;
    subType = subType ?? resolved.subType;
    // Stamp the source tile on the element, exactly as a palette click does, so
    // the Properties panel names the library item behind an agent-made layer.
    libraryProps = { ...resolved.props, libraryId: String(args.libraryId).trim() };
    // The asset's own size unless the caller gave explicit dimensions.
    if (resolved.defaultSize && (args.width === undefined || args.height === undefined)) {
      libraryProps.size = resolved.defaultSize;
    }
  }
  if (!type) {
    return { ok: false, message: 'Pass either type (text, shape, device, image) or libraryId.' };
  }
  const own = collectElementProps(args);
  const font = resolveFontFamily(own.fontFamily);
  if (font.error) return { ok: false, message: font.error };
  if (font.family) own.fontFamily = font.family;
  const props = await resolveAssetProps({ ...libraryProps, ...own });
  return { ok: true, spec: { type, subType, props } };
}

const TOOLS: ToolDef[] = [
  {
    name: 'list_artboards',
    description: 'List every artboard (screen) on the canvas with its id, name, size, background and element count. Call this first to discover ids.',
    inputSchema: {
      type: 'object',
      properties: {
        locale: {
          type: 'string',
          description: 'Read one language instead of the base document (see list_locales). Only the element count can differ, since layout and size are shared by every language.',
        },
      },
    },
    run: (args, api) => {
      if (args.locale !== undefined) {
        const state = api.listLocales();
        const locale = matchLocale(args.locale, state);
        if (!locale) {
          return { ...textResult(`This project has no language "${args.locale}". It has: ${localeChoices(state)}.`), isError: true };
        }
        return textResult(api.listArtboards(locale));
      }
      return textResult(api.listArtboards());
    },
  },
  {
    name: 'get_artboard',
    description:
      'Get the full state of one artboard, including every element and its properties. Omit artboardId for the active artboard. Pass a locale to read that language instead: the translated copy, its fonts and its screenshots. That is a read-only view, because every editing tool writes the base document that all languages share; use set_localized_text to change one language.',
    inputSchema: {
      type: 'object',
      properties: {
        artboardId: { type: 'string', description: 'Defaults to the active artboard.' },
        locale: { type: 'string', description: 'A language code from list_locales. Defaults to the base language.' },
      },
    },
    run: (args, api) => {
      let locale: string | null = null;
      if (args.locale !== undefined) {
        const state = api.listLocales();
        locale = matchLocale(args.locale, state);
        if (!locale) {
          return { ...textResult(`This project has no language "${args.locale}". It has: ${localeChoices(state)}.`), isError: true };
        }
      }
      const board = api.getArtboard(args.artboardId, locale);
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
    name: 'update_artboard',
    description:
      'Rename, resize and/or reorder an artboard. Renaming matters because the name becomes the exported file name (a board left as "Blank Artboard" exports as one). Resizing scales the elements with the canvas unless you pass scaleContent:false. index moves the board along the canvas, 0 being leftmost.',
    inputSchema: {
      type: 'object',
      properties: {
        artboardId: { type: 'string', description: 'Defaults to the active artboard.' },
        name: { type: 'string' },
        width: { type: 'number' },
        height: { type: 'number' },
        preset: { type: 'string', description: 'A canvas size preset id in place of width/height.' },
        index: { type: 'number', description: 'New position in the canvas order (0-based).' },
        scaleContent: { type: 'boolean', description: 'Scale the elements to the new canvas on a resize. Default true.' },
      },
    },
    run: (args, api) => {
      if (['name', 'width', 'height', 'preset', 'index'].every((k) => args[k] === undefined)) {
        return { ...textResult('Pass at least one of name, width/height, preset or index.'), isError: true };
      }
      const updated = api.updateArtboard({
        artboardId: args.artboardId,
        name: args.name,
        width: args.width,
        height: args.height,
        preset: args.preset,
        index: args.index,
        scaleContent: args.scaleContent,
      });
      return updated ? textResult(updated) : { ...textResult('No such artboard.'), isError: true };
    },
  },
  {
    name: 'delete_artboard',
    description:
      'Remove an artboard and everything on it. Use it to drop a botched board instead of leaving it in the export. A project needs at least one artboard, so deleting the last one is refused.',
    inputSchema: {
      type: 'object',
      properties: { artboardId: { type: 'string', description: 'Defaults to the active artboard.' } },
    },
    run: (args, api) => {
      const result = api.deleteArtboard({ artboardId: args.artboardId });
      return result ? textResult(result) : { ...textResult('No such artboard.'), isError: true };
    },
  },
  {
    name: 'duplicate_artboard',
    description:
      'Copy an artboard with all of its elements and its background, and insert the copy next to it. The fastest way to build a set of store screenshots that share a base: build one board, duplicate it per screen, then change only the headline and the mockup.',
    inputSchema: {
      type: 'object',
      properties: {
        artboardId: { type: 'string', description: 'Defaults to the active artboard.' },
        name: { type: 'string', description: 'Name for the copy. Defaults to "<name> copy".' },
        index: { type: 'number', description: 'Where to insert it (0-based). Defaults to right after the source.' },
      },
    },
    run: (args, api) => {
      const copy = api.duplicateArtboard({ artboardId: args.artboardId, name: args.name, index: args.index });
      return copy ? textResult(copy) : { ...textResult('No such artboard.'), isError: true };
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
    run: async (args, api) => {
      const built = await buildElementSpec(args);
      if (!built.ok) return { ...textResult(built.message), isError: true };
      const { id } = api.addElement({
        artboardId: args.artboardId,
        type: built.spec.type as ElementType,
        subType: built.spec.subType,
        props: built.spec.props,
      });
      return textResult({ id });
    },
  },
  {
    name: 'add_elements',
    description:
      'Add several elements to one artboard in a single atomic update. Each entry takes the same arguments as add_element (type/subType or libraryId, x/y/width/height, colours, ...). Prefer this over a loop of add_element calls: it is one round trip instead of N, it lands as one undo step, and if any entry is rejected nothing is added, so you never end up with a half-built board. Elements stack in the order given, first at the back.',
    inputSchema: {
      type: 'object',
      properties: {
        artboardId: { type: 'string', description: 'Defaults to the active artboard.' },
        elements: {
          type: 'array',
          description: 'The elements to add, back to front.',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['text', 'shape', 'device', 'image'] },
              subType: { type: 'string', description: `Shape name (${SHAPE_TYPES.join(', ')}) or device type (${DEVICE_TYPES.join(', ')}).` },
              libraryId: { type: 'string', description: 'A palette asset id from list_library, in place of type/subType.' },
              ...ELEMENT_PROP_SCHEMA,
            },
          },
        },
      },
      required: ['elements'],
    },
    run: async (args, api) => {
      const list = Array.isArray(args.elements) ? args.elements : [];
      if (list.length === 0) {
        return { ...textResult('Pass a non-empty `elements` array.'), isError: true };
      }
      const specs: McpElementSpec[] = [];
      for (const [index, entry] of list.entries()) {
        const built = await buildElementSpec(entry ?? {});
        if (!built.ok) {
          return { ...textResult(`elements[${index}]: ${built.message} Nothing was added.`), isError: true };
        }
        specs.push(built.spec);
      }
      const { ids } = api.addElements({ artboardId: args.artboardId, elements: specs });
      return textResult({ ids, added: ids.length });
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
    run: async (args, api) => {
      const props = collectElementProps(args);
      const font = resolveFontFamily(props.fontFamily);
      if (font.error) return { ...textResult(font.error), isError: true };
      if (font.family) props.fontFamily = font.family;
      const resolved = await resolveAssetProps(props);
      const ok = api.updateElement({ artboardId: args.artboardId, elementId: args.elementId, props: resolved });
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
    name: 'reorder_element',
    description:
      'Change an element\'s z-order. Elements paint in list order (first = back, last = front), and adding one always puts it on top, so this is how you slide a background behind work you have already placed instead of rebuilding the artboard. Pass an action, or an explicit 0-based index.',
    inputSchema: {
      type: 'object',
      properties: {
        artboardId: { type: 'string', description: 'Defaults to the active artboard.' },
        elementId: { type: 'string' },
        action: {
          type: 'string',
          enum: ['front', 'back', 'forward', 'backward'],
          description: "'front'/'back' jump to the top/bottom of the stack; 'forward'/'backward' move one step.",
        },
        index: { type: 'number', description: 'Exact position in the stack, 0 = furthest back. Overrides action.' },
      },
      required: ['elementId'],
    },
    run: (args, api) => {
      if (args.action === undefined && args.index === undefined) {
        return { ...textResult("Pass an action ('front', 'back', 'forward', 'backward') or an index."), isError: true };
      }
      const moved = api.reorderElement({
        artboardId: args.artboardId,
        elementId: args.elementId,
        action: args.action,
        index: args.index,
      });
      return moved ? textResult(moved) : { ...textResult('No such element.'), isError: true };
    },
  },
  {
    name: 'measure_element',
    description:
      'Report what an element actually occupies on the rendered canvas, in artboard pixels. Text is the reason this exists: glyphs are laid out at roughly 3.3x the stored fontSize and wrap inside the element box, so the real ink bounds (textBox) cannot be predicted from the props. Use it to align something to a headline\'s true edge, or to check a line is not being clipped, before exporting.',
    inputSchema: {
      type: 'object',
      properties: {
        artboardId: { type: 'string', description: 'Defaults to the active artboard.' },
        elementId: { type: 'string' },
      },
      required: ['elementId'],
    },
    run: (args, api) => {
      const measured = api.measureElement({ artboardId: args.artboardId, elementId: args.elementId });
      if (!measured) {
        return {
          ...textResult('No such element, or it is not currently on screen (open the project in the app first).'),
          isError: true,
        };
      }
      return textResult(measured);
    },
  },
  {
    name: 'group_elements',
    description:
      'Tag elements with a shared groupId so transform_elements can move them together later. They stay separate layers; this only records that they belong to one arrangement (a hero scene, a badge row). Pass clear:true to untag them.',
    inputSchema: {
      type: 'object',
      properties: {
        artboardId: { type: 'string', description: 'Defaults to the active artboard.' },
        elementIds: { type: 'array', items: { type: 'string' } },
        groupId: { type: 'string', description: 'Reuse or name a group. Generated when omitted.' },
        clear: { type: 'boolean', description: 'Remove these elements from whatever group they are in.' },
      },
      required: ['elementIds'],
    },
    run: (args, api) => {
      const ids = Array.isArray(args.elementIds) ? args.elementIds : [];
      if (ids.length === 0) return { ...textResult('Pass a non-empty elementIds array.'), isError: true };
      const result = api.groupElements({
        artboardId: args.artboardId,
        elementIds: ids,
        groupId: args.groupId,
        clear: args.clear,
      });
      return result ? textResult(result) : { ...textResult('No such artboard, or none of those elements exist.'), isError: true };
    },
  },
  {
    name: 'transform_elements',
    description:
      'Move or scale several elements as one unit, about their shared bounding box: one call instead of a coordinated update per element. Target them by elementIds or by a groupId from group_elements. dx/dy nudge; x/y place the group\'s top-left corner; scale grows or shrinks the whole arrangement around its centre, keeping the elements\' relative layout.',
    inputSchema: {
      type: 'object',
      properties: {
        artboardId: { type: 'string', description: 'Defaults to the active artboard.' },
        elementIds: { type: 'array', items: { type: 'string' }, description: 'Explicit members. Omit when using groupId.' },
        groupId: { type: 'string', description: 'Every element carrying this groupId.' },
        dx: { type: 'number', description: 'Move right by this many artboard px (negative = left).' },
        dy: { type: 'number', description: 'Move down by this many artboard px (negative = up).' },
        x: { type: 'number', description: "New left edge of the group's bounding box." },
        y: { type: 'number', description: "New top edge of the group's bounding box." },
        scale: { type: 'number', description: 'Multiplier applied about the bounding-box centre, e.g. 0.8 to shrink the scene by a fifth.' },
      },
    },
    run: (args, api) => {
      const hasTarget = (Array.isArray(args.elementIds) && args.elementIds.length > 0) || !!args.groupId;
      if (!hasTarget) return { ...textResult('Pass elementIds or a groupId.'), isError: true };
      const moved = api.transformElements({
        artboardId: args.artboardId,
        elementIds: args.elementIds,
        groupId: args.groupId,
        dx: args.dx,
        dy: args.dy,
        x: args.x,
        y: args.y,
        scale: args.scale,
      });
      return moved ? textResult(moved) : { ...textResult('No such artboard, or none of those elements exist.'), isError: true };
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
    name: 'list_locales',
    description:
      'List the languages this project exports and say which one the canvas is showing. A project holds ONE set of artboards and one layout: only text, fonts and screenshots can differ per language, so a language is a small overlay on top of the design rather than a copy of it. `translated`/`total` counts the text elements that have copy of their own in that language.',
    inputSchema: { type: 'object', properties: {} },
    run: (_args, api) => textResult(api.listLocales()),
  },
  {
    name: 'set_locale',
    description:
      'Switch the language the editor shows, the same as picking one from the language menu. Everything that reads the canvas follows it, so this is how you export a language: set_locale, then export_png or export_all. Omit locale to go back to the base language. Editing tools are unaffected, they always write the base document.',
    inputSchema: {
      type: 'object',
      properties: {
        locale: {
          type: 'string',
          description: 'A code from list_locales. Omit it, or pass the base code, to show the base language.',
        },
      },
    },
    run: async (args, api) => {
      const state = api.listLocales();
      if (args.locale === undefined || args.locale === null) {
        const result = await api.setLocale(null);
        return textResult(result ?? state);
      }
      const locale = matchLocale(args.locale, state);
      if (!locale) {
        return {
          ...textResult(
            `This project has no language "${args.locale}". It has: ${localeChoices(state)}. Languages are added in the app, from the globe button in the toolbar.`
          ),
          isError: true,
        };
      }
      const result = await api.setLocale(locale === state.baseLocale ? null : locale);
      if (!result) return { ...textResult(`Could not switch to ${locale}.`), isError: true };
      return textResult(result);
    },
  },
  {
    name: 'set_localized_text',
    description:
      'Write one text element\'s copy for one language. Nothing else moves: the base copy, every other language, and the shared layout are untouched, and an empty string clears the translation so the element falls back to the base copy again. Use update_element instead to change the copy every language starts from. Element ids come from get_artboard.',
    inputSchema: {
      type: 'object',
      properties: {
        artboardId: { type: 'string', description: 'Defaults to the active artboard.' },
        elementId: { type: 'string', description: 'A text element id.' },
        locale: { type: 'string', description: 'A language code from list_locales, other than the base language.' },
        text: { type: 'string', description: 'The copy for that language. Empty clears it.' },
      },
      required: ['elementId', 'locale', 'text'],
    },
    run: (args, api) => {
      const state = api.listLocales();
      const locale = matchLocale(args.locale, state);
      if (!locale) {
        return {
          ...textResult(
            `This project has no language "${args.locale}". It has: ${localeChoices(state)}. Languages are added in the app, from the globe button in the toolbar.`
          ),
          isError: true,
        };
      }
      if (locale === state.baseLocale) {
        return {
          ...textResult(
            `${locale} is the language this design is written in, so it has no translations of its own. Use update_element to change the copy every language starts from.`
          ),
          isError: true,
        };
      }
      const result = api.setLocalizedText({
        artboardId: args.artboardId,
        elementId: args.elementId,
        locale,
        text: typeof args.text === 'string' ? args.text : '',
      });
      if (!result) return { ...textResult('No such text element on that artboard.'), isError: true };
      return textResult(result);
    },
  },
  {
    name: 'list_supported_locales',
    description:
      'List every language this app can add to a project, with the code to add it by, whether a machine engine can draft it, what App Store Connect and Google Play call it, and the font that has to be substituted for its script. Call this before add_locales: the code is a STORE locale ("de-DE", "zh-Hans", "pt-BR"), not a two-letter language, because en-GB and en-US, and zh-Hans and zh-Hant, are different listings on both stores.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Filter over the code, the English name and the native name.' },
      },
    },
    run: (args, api) => {
      const state = api.listLocales();
      const inProject = new Set(state.locales.map((entry) => entry.code));
      const catalog = listSupportedLocales(typeof args.query === 'string' ? args.query : undefined).map(
        (def) => ({ ...def, inProject: inProject.has(def.code), base: def.code === state.baseLocale })
      );
      return textResult({ baseLocale: state.baseLocale, total: catalog.length, locales: catalog });
    },
  },
  {
    name: 'add_locales',
    description:
      'Add export languages to the project, the same as ticking them in the language manager. A language is an OVERLAY: the project keeps one set of artboards and one layout, and the new language starts out showing the base design verbatim until strings are written into it. With machineTranslate it is drafted by the translation engine straight away; without it, write the strings yourself with set_localized_texts, which is usually the better copy. baseLocale is accepted only while the project has no languages yet.',
    inputSchema: {
      type: 'object',
      properties: {
        locales: {
          type: 'array',
          items: { type: 'string' },
          description: 'Store locales from list_supported_locales, e.g. ["de-DE", "ja", "pt-BR"].',
        },
        baseLocale: {
          type: 'string',
          description: 'The language the design is currently written in. Only settable before the first export language is added.',
        },
        machineTranslate: {
          type: 'boolean',
          description: 'Draft every newly added language with the translation engine right away. Default false. This can take a while on a big project.',
        },
        autoFont: {
          type: 'boolean',
          description: 'Substitute a script-appropriate family where the design font cannot draw the language (Japanese, Arabic, Thai). Default true. Set false to keep the design font and accept the risk of tofu.',
        },
        autoFit: {
          type: 'boolean',
          description: 'Shrink a translation that overruns its box instead of clipping it. Default true.',
        },
      },
      required: ['locales'],
    },
    run: async (args, api) => {
      const requested: string[] = Array.isArray(args.locales) ? args.locales.map(String) : [];
      if (requested.length === 0) {
        return { ...textResult('Pass at least one locale. Call list_supported_locales for the codes.'), isError: true };
      }
      // Resolved against the catalog, not the project: these are the languages
      // that are not in it yet, so the project's own list cannot name them.
      const resolved: string[] = [];
      const unknown: string[] = [];
      for (const code of requested) {
        const match = resolveCatalogLocale(code);
        if (match) resolved.push(match);
        else unknown.push(code);
      }
      if (resolved.length === 0) {
        return {
          ...textResult(
            `None of those are languages this app knows: ${unknown.join(', ')}. Call list_supported_locales, and pass store locales like "de-DE" or "zh-Hans".`
          ),
          isError: true,
        };
      }
      const base = args.baseLocale ? resolveCatalogLocale(String(args.baseLocale)) : undefined;
      const result = await api.addLocales({
        locales: resolved,
        baseLocale: base ?? undefined,
        autoFont: args.autoFont,
        autoFit: args.autoFit,
        machineTranslate: args.machineTranslate === true,
      });
      return textResult(
        unknown.length > 0
          ? { ...result, ignored: [...result.ignored, ...unknown.map((code) => ({ code, reason: 'Not a language this app knows.' }))] }
          : result
      );
    },
  },
  {
    name: 'remove_locales',
    description:
      'Remove export languages from the project. Every translation stored under them goes with them, and the count of strings deleted comes back in the result. The base language cannot be removed: it is the design itself.',
    inputSchema: {
      type: 'object',
      properties: {
        locales: { type: 'array', items: { type: 'string' }, description: 'Codes from list_locales.' },
      },
      required: ['locales'],
    },
    run: (args, api) => {
      const state = api.listLocales();
      const requested: string[] = Array.isArray(args.locales) ? args.locales.map(String) : [];
      const resolved = requested.map((code) => matchLocale(code, state) ?? code);
      if (resolved.length === 0) {
        return { ...textResult(`Pass at least one locale. This project has: ${localeChoices(state)}.`), isError: true };
      }
      return textResult(api.removeLocales({ locales: resolved }));
    },
  },
  {
    name: 'set_base_locale',
    description:
      'Say which language the design itself is written in. This does not translate anything: it labels the source, which is what every translation is tracked against and what the export filenames and both store uploads use for the base set. Locked once the project has export languages, because re-basing would point every existing translation at a different source string.',
    inputSchema: {
      type: 'object',
      properties: {
        locale: { type: 'string', description: 'A store locale from list_supported_locales.' },
      },
      required: ['locale'],
    },
    run: (args, api) => {
      const locale = resolveCatalogLocale(String(args.locale ?? ''));
      if (!locale) {
        return {
          ...textResult(`"${args.locale}" is not a language this app knows. Call list_supported_locales for the codes.`),
          isError: true,
        };
      }
      return textResult(api.setBaseLocale({ locale }));
    },
  },
  {
    name: 'list_translations',
    description:
      'The translation table as data: one row per translatable text element, with the base string and what each language has for it. Each cell says where its string came from, which is what tells you what you may overwrite: "inherited" nothing written yet, "manual" a person or an agent wrote it, "auto" a machine engine did, and a "stale-" prefix means the base string has been edited since, so that translation is of copy that no longer exists. This is the read half of translating a project: call it with filter "untranslated", write the strings with set_localized_texts.',
    inputSchema: {
      type: 'object',
      properties: {
        locales: { type: 'array', items: { type: 'string' }, description: 'Languages to put in the columns. Default: all of them.' },
        artboardIds: { type: 'array', items: { type: 'string' }, description: 'Restrict to these artboards.' },
        elementIds: { type: 'array', items: { type: 'string' }, description: 'Restrict to these text elements.' },
        filter: {
          type: 'string',
          enum: ['all', 'untranslated', 'translated', 'stale', 'machine'],
          description: 'Keep rows where ANY of the listed languages matches. "untranslated" still needs a string, "stale" was translated before the base copy changed, "machine" was drafted by an engine and is worth a review.',
        },
        limit: { type: 'number', description: 'Rows per call, 1 to 500. Default 100.' },
        offset: { type: 'number', description: 'Skip this many matching rows, for paging through a big project.' },
      },
    },
    run: (args, api) => {
      const state = api.listLocales();
      const locales = Array.isArray(args.locales)
        ? args.locales.map((code: unknown) => matchLocale(code, state)).filter((code: string | null): code is string => !!code)
        : undefined;
      if (Array.isArray(args.locales) && (!locales || locales.length === 0)) {
        return { ...textResult(`This project has none of those languages. It has: ${localeChoices(state)}.`), isError: true };
      }
      return textResult(
        api.listTranslations({
          locales,
          artboardIds: args.artboardIds,
          elementIds: args.elementIds,
          filter: args.filter,
          limit: args.limit,
          offset: args.offset,
        })
      );
    },
  },
  {
    name: 'set_localized_texts',
    description:
      'Write translated copy for many elements and many languages in ONE call, which is how a whole project should be translated: one round trip, one undo step, one save. You are a better translator than the built-in engine, so writing the strings here is the preferred path and translate_locales is the fallback. Element ids come from list_translations. An empty string, or a string identical to the base copy, clears the translation so the element falls back to the base. Everything written is marked as human-written, so a later "Update translations" run will not overwrite it.',
    inputSchema: {
      type: 'object',
      properties: {
        writes: {
          type: 'array',
          description: 'One entry per (element, language).',
          items: {
            type: 'object',
            properties: {
              elementId: { type: 'string', description: 'A text element id from list_translations.' },
              locale: { type: 'string', description: 'A language code from list_locales, other than the base language.' },
              text: { type: 'string', description: 'The copy for that language.' },
              artboardId: { type: 'string', description: 'Only needed if the same element id appears on two artboards.' },
            },
            required: ['elementId', 'locale', 'text'],
          },
        },
      },
      required: ['writes'],
    },
    run: (args, api) => {
      const state = api.listLocales();
      const entries: unknown[] = Array.isArray(args.writes) ? args.writes : [];
      if (entries.length === 0) return { ...textResult('Pass at least one write.'), isError: true };

      const writes: LocaleTextInput[] = [];
      const misses: Array<{ elementId: string; locale: string; reason: string }> = [];
      for (const raw of entries) {
        const entry = (raw ?? {}) as Record<string, unknown>;
        const elementId = String(entry.elementId ?? '');
        const locale = matchLocale(entry.locale, state);
        if (!locale) {
          misses.push({
            elementId,
            locale: String(entry.locale ?? ''),
            reason: `This project has no such language. It has: ${localeChoices(state)}.`,
          });
          continue;
        }
        if (locale === state.baseLocale) {
          misses.push({
            elementId,
            locale,
            reason: 'That is the base language, which the design is written in. Use update_element to change the copy every language starts from.',
          });
          continue;
        }
        writes.push({
          artboardId: entry.artboardId ? String(entry.artboardId) : undefined,
          elementId,
          locale,
          text: typeof entry.text === 'string' ? entry.text : '',
        });
      }

      if (writes.length === 0) {
        return { ...textResult({ written: 0, cleared: 0, unchanged: 0, misses, completion: [] }), isError: true };
      }
      const result = api.setLocalizedTexts({ writes });
      return textResult(misses.length > 0 ? { ...result, misses: [...misses, ...result.misses] } : result);
    },
  },
  {
    name: 'translate_locales',
    description:
      'Run the app\'s own translation engine over one or more languages. Prefer writing the strings yourself with set_localized_texts: this engine is a machine translator and store copy is what it is worst at. Use it for a first draft of a language you do not read, or to refresh the drafts it made earlier after the base copy changed ("only": "stale"). Strings a person wrote are skipped unless includeManual is set, and nothing here ever touches the base document.',
    inputSchema: {
      type: 'object',
      properties: {
        locales: { type: 'array', items: { type: 'string' }, description: 'Languages to translate into. Codes from list_locales.' },
        only: {
          type: 'string',
          enum: ['empty', 'stale', 'all'],
          description: '"empty" strings with no translation yet (the default), "stale" refresh translations whose base copy has since changed, "all" everything in scope.',
        },
        includeManual: {
          type: 'boolean',
          description: 'Also overwrite strings a person or an agent wrote. Off by default, and leaving it off is what protects reviewed copy.',
        },
        guidance: {
          type: 'string',
          description: 'A brand brief for the AI engine, e.g. "informal, second person, keep product names in English". Ignored by the plain machine engine.',
        },
        artboardIds: { type: 'array', items: { type: 'string' }, description: 'Restrict the run to these artboards.' },
        elementIds: { type: 'array', items: { type: 'string' }, description: 'Restrict the run to these text elements.' },
      },
      required: ['locales'],
    },
    run: async (args, api) => {
      const state = api.listLocales();
      const requested: unknown[] = Array.isArray(args.locales) ? args.locales : [];
      const locales: string[] = [];
      for (const code of requested) {
        const match = matchLocale(code, state);
        if (match && match !== state.baseLocale && !locales.includes(match)) locales.push(match);
      }
      if (locales.length === 0) {
        return {
          ...textResult(
            `No export language matched. This project has: ${localeChoices(state)}. The base language is written, not translated, so it cannot be a target.`
          ),
          isError: true,
        };
      }
      const result = await api.translateLocales({
        locales,
        only: args.only,
        includeManual: args.includeManual === true,
        guidance: typeof args.guidance === 'string' ? args.guidance : undefined,
        artboardIds: args.artboardIds,
        elementIds: args.elementIds,
      });
      if (!result.engine) {
        return {
          ...textResult(
            'No translation engine is configured in this app, so nothing was translated. Write the strings yourself with set_localized_texts instead: read them with list_translations, translate them, and send them back in one call.'
          ),
          isError: true,
        };
      }
      return textResult(result);
    },
  },
  {
    name: 'export_translations_csv',
    description:
      'The whole project as a translator\'s spreadsheet: one row per string, the ids first, then the base language, then a column per language. This is the format a human translation agency takes, and import_translations_csv reads it back. Returns the CSV text, write it to a file yourself.',
    inputSchema: {
      type: 'object',
      properties: {
        locales: { type: 'array', items: { type: 'string' }, description: 'Which languages get a column. Default: all of them.' },
      },
    },
    run: (args, api) => {
      const state = api.listLocales();
      const locales = Array.isArray(args.locales)
        ? args.locales.map((code: unknown) => matchLocale(code, state)).filter((code: string | null): code is string => !!code)
        : undefined;
      return textResult(api.exportTranslationsCsv({ locales }));
    },
  },
  {
    name: 'import_translations_csv',
    description:
      'Read a filled-in translation spreadsheet back into the project. Rows are matched on artboardId + elementId, falling back to the base string when the ids do not line up and exactly one element has that string. An EMPTY cell means "I did not translate this one" and never clears an existing translation. Only languages the project already has are written, so add them with add_locales first. Pass dryRun to see the changes without writing them.',
    inputSchema: {
      type: 'object',
      properties: {
        csv: { type: 'string', description: 'The file contents, as text.' },
        dryRun: { type: 'boolean', description: 'Report what would change and write nothing.' },
        locales: { type: 'array', items: { type: 'string' }, description: 'Only import these languages, even if the sheet has more columns.' },
      },
      required: ['csv'],
    },
    run: (args, api) => {
      if (typeof args.csv !== 'string' || args.csv.trim().length === 0) {
        return { ...textResult('Pass the CSV file contents as `csv`.'), isError: true };
      }
      const state = api.listLocales();
      const locales = Array.isArray(args.locales)
        ? args.locales.map((code: unknown) => matchLocale(code, state)).filter((code: string | null): code is string => !!code)
        : undefined;
      return textResult(
        api.importTranslationsCsv({ csv: args.csv, dryRun: args.dryRun === true, locales })
      );
    },
  },
  {
    name: 'set_locale_override',
    description:
      'Give one element its own version of something in ONE language, leaving every other language on the shared design. Use it for a localized screenshot inside a device frame (screenshotSrc), a typeface that can draw the script (fontFamily), a box or a position that fits a longer translation (position, size, fontSize, lineHeight), or hidden:true to drop a badge from the markets that never earned it. Pass null for a property to hand it back to the shared design. Anything other than content, screenshotSrc, imageSrc and mediaId is SHARED across languages until it is set here, so setting it is what pulls it apart, and update_element remains the way to change something for every language at once.',
    inputSchema: {
      type: 'object',
      properties: {
        elementId: { type: 'string', description: 'From get_artboard or list_translations.' },
        locale: { type: 'string', description: 'A language code from list_locales, other than the base language.' },
        artboardId: { type: 'string', description: 'Only needed if the same element id appears on two artboards.' },
        hidden: { type: 'boolean', description: 'true drops this element from this language only. false or null shows it again.' },
        content: { type: 'string', description: 'Text copy for this language (text elements). set_localized_texts is the batch version.' },
        screenshotSrc: { type: 'string', description: 'A localized screenshot for the screen inside a device frame. URL, data: URL, or an "asset:<id>" from upload_asset.' },
        imageSrc: { type: 'string', description: 'A localized image (image elements).' },
        mediaId: { type: 'string', description: 'A localized recording (video elements).' },
        fontFamily: { type: 'string', description: 'A typeface for this language only. Must be one list_fonts returns. Setting it also turns OFF the automatic script substitution for this element.' },
        fontSize: { type: 'number', description: 'Font size for this language only. Setting it turns off auto-shrink for this element, so the box will clip if the string is too long.' },
        lineHeight: { type: 'number' },
        letterSpacing: { type: 'number' },
        fontWeight: { type: 'string' },
        textAlign: { type: 'string', description: "'left' | 'center' | 'right'. RTL languages already flip through logical alignment, so this is for real layout differences." },
        color: { type: 'string' },
        rotation: { type: 'number' },
        scale: { type: 'number' },
        position: {
          type: 'object',
          description: 'Position for this language only, e.g. moving a badge to the other edge for Arabic.',
          properties: { x: { type: 'number' }, y: { type: 'number' } },
          required: ['x', 'y'],
        },
        size: {
          type: 'object',
          description: 'Box size for this language only, e.g. a wider headline box for German.',
          properties: { width: { type: 'number' }, height: { type: 'number' } },
          required: ['width', 'height'],
        },
      },
      required: ['elementId', 'locale'],
    },
    run: async (args, api) => {
      const state = api.listLocales();
      const locale = matchLocale(args.locale, state);
      if (!locale) {
        return { ...textResult(`This project has no language "${args.locale}". It has: ${localeChoices(state)}.`), isError: true };
      }
      if (locale === state.baseLocale) {
        return {
          ...textResult(
            `${locale} is the language this design is written in, so it has nothing to override. Use update_element to change the shared design.`
          ),
          isError: true,
        };
      }
      const { elementId, artboardId, locale: _locale, ...rest } = args;
      const props: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(rest)) {
        if (value !== undefined) props[key] = value;
      }
      if (Object.keys(props).length === 0) {
        return { ...textResult('Pass at least one property to override, or use reset_locale_overrides to hand this element back to the base design.'), isError: true };
      }
      // The same rejection add_element makes: a family the app does not load
      // falls through to a browser serif, which in a locale view looks exactly
      // like the script substitution failing.
      if (typeof props.fontFamily === 'string') {
        const font = resolveFontFamily(props.fontFamily);
        if (font.error) return { ...textResult(font.error), isError: true };
        if (font.family) props.fontFamily = font.family;
      }
      // asset:<id> references expand to bytes here, exactly as they do when an
      // element is built, so a localized screenshot can be uploaded once.
      const resolved = await resolveAssetProps(props);
      return textResult(api.setLocaleOverride({ artboardId, elementId: String(elementId), locale, props: resolved }));
    },
  },
  {
    name: 'reset_locale_overrides',
    description:
      'Hand a language back to the shared design. With no fields it drops everything that language holds for the scope, so those elements are projected verbatim from the base design again, translations included. With fields it drops only those properties, which is how you undo one layout tweak and keep the copy. Scope "project" clears a whole language, which is the thing to do before re-translating from scratch.',
    inputSchema: {
      type: 'object',
      properties: {
        locale: { type: 'string', description: 'A language code from list_locales.' },
        scope: {
          type: 'string',
          enum: ['element', 'artboard', 'project'],
          description: '"element" needs elementId, "artboard" needs artboardId, "project" is every artboard.',
        },
        elementId: { type: 'string' },
        artboardId: { type: 'string' },
        fields: {
          type: 'array',
          items: { type: 'string' },
          description: 'Only these properties, e.g. ["position", "size"] or ["fontFamily"]. Unset drops the whole override, translated copy included.',
        },
      },
      required: ['locale', 'scope'],
    },
    run: (args, api) => {
      const state = api.listLocales();
      const locale = matchLocale(args.locale, state);
      if (!locale) {
        return { ...textResult(`This project has no language "${args.locale}". It has: ${localeChoices(state)}.`), isError: true };
      }
      if (locale === state.baseLocale) {
        return {
          ...textResult(`${locale} is the base language. It has no overrides of its own, it IS the design.`),
          isError: true,
        };
      }
      return textResult(
        api.resetLocaleOverrides({
          locale,
          scope: args.scope,
          artboardId: args.artboardId,
          elementId: args.elementId,
          fields: Array.isArray(args.fields) ? args.fields.map(String) : undefined,
        })
      );
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
    description:
      'Render an artboard to a PNG. By default it comes back inline as an image, which at full size is megabytes of base64, so while you are iterating pass scale (0.25 gives a readable proof for a sixteenth of the payload). Pass save:true to write the file instead and get its path back, which is what you want for the final delivery. Pass locale to render one language without leaving the editor on it; with no locale it renders whatever the canvas is showing.',
    inputSchema: {
      type: 'object',
      properties: {
        artboardId: { type: 'string', description: 'Defaults to the active artboard.' },
        scale: { type: 'number', description: 'Output scale, 0.1 to 4. 1 = the artboard\'s real pixel size. Use 0.25 for a quick look.' },
        save: { type: 'boolean', description: 'Write the PNG to disk and return its path.' },
        directory: { type: 'string', description: 'Folder to save into. Defaults to "Open Screenshot Generator" in your Downloads.' },
        fileName: { type: 'string', description: 'File name for the saved PNG. Defaults to the artboard name. Name it after the language too when exporting several.' },
        includeImage: { type: 'boolean', description: 'Also return the image inline. Defaults to true, or false when save is set.' },
        locale: { type: 'string', description: 'Render this language (a code from list_locales). The canvas is switched, captured, and switched back.' },
      },
    },
    run: async (args, api) => {
      const locale = exportLocale(args.locale, api);
      if ('error' in locale) return { ...textResult(locale.error), isError: true };
      const result = await api.exportPng({
        artboardId: args.artboardId,
        scale: args.scale,
        save: args.save,
        directory: args.directory,
        fileName: args.fileName,
        includeImage: args.includeImage,
        locale: locale.locale,
      });
      return exportResultContent([result]);
    },
  },
  {
    name: 'export_all',
    description:
      'Render every artboard in the project, in canvas order. Made for final delivery: with save:true each board is written to one folder, named "01_<artboard name>.png" and so on, and you get the paths back instead of a wall of base64. Pass locale to render one language, which names the files "<locale>_01_<name>.png"; for the fastlane-style folder per language, call it once per language with a directory of its own. With no locale it renders whatever the canvas is showing.',
    inputSchema: {
      type: 'object',
      properties: {
        scale: { type: 'number', description: 'Output scale, 0.1 to 4. Defaults to 1.' },
        save: { type: 'boolean', description: 'Write the files to disk. Defaults to true.' },
        directory: { type: 'string', description: 'Folder to save into. Defaults to "Open Screenshot Generator" in your Downloads.' },
        includeImage: { type: 'boolean', description: 'Also return every image inline. Defaults to false, it is a lot of data.' },
        locale: { type: 'string', description: 'Render this language (a code from list_locales). The canvas is switched, captured, and switched back.' },
      },
    },
    run: async (args, api) => {
      const locale = exportLocale(args.locale, api);
      if ('error' in locale) return { ...textResult(locale.error), isError: true };
      const results = await api.exportAll({
        scale: args.scale,
        save: args.save,
        directory: args.directory,
        includeImage: args.includeImage,
        locale: locale.locale,
      });
      if (results.length === 0) return { ...textResult('There are no artboards to export.'), isError: true };
      return exportResultContent(results);
    },
  },
  {
    name: 'list_fonts',
    description:
      'The font families this app actually loads, grouped by script. Only these can be used for fontFamily. add_element and update_element reject anything else rather than letting the browser fall back to a default serif, so check here before inventing a family name.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text filter over family names.' },
        script: {
          type: 'string',
          enum: ['latin', 'arabic', 'urdu', 'hebrew', 'cjk', 'thai', 'devanagari', 'bengali', 'multilingual'],
          description: 'Restrict to one script.',
        },
      },
    },
    run: (args) => {
      const q = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
      // Imported files are latin-agnostic: nothing declares their coverage, so
      // they are reported as their own category rather than guessed at.
      const imported = customFontFamilies().map((family) => ({
        family,
        category: 'imported',
        script: 'latin' as const,
        variants: undefined as string[] | undefined,
      }));
      const fonts = [...ALL_FONTS, ...imported]
        .filter(
          (f) =>
            (!args.script || (f.script ?? 'latin') === args.script) &&
            (!q || f.family.toLowerCase().includes(q))
        )
        .map((f) => ({
          family: f.family,
          category: f.category ?? 'sans-serif',
          script: f.script ?? 'latin',
          weights: f.variants ?? ['400'],
        }));
      return textResult({ fonts, count: fonts.length, total: ALL_FONTS.length + imported.length });
    },
  },
  {
    name: 'upload_asset',
    description:
      'Register an image once and get back an "asset:<id>" reference you can pass to imageSrc or screenshotSrc as many times as you like. Send an icon, badge or screenshot through here before placing it on several artboards instead of repeating the data URL in every call.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'A data: URL, an http(s) image URL, or bare base64 (then set mimeType).' },
        name: { type: 'string', description: 'Label shown by list_assets.' },
        mimeType: { type: 'string', description: "Only needed for bare base64, e.g. 'image/png'." },
      },
      required: ['source'],
    },
    run: async (args) => {
      const asset = await saveImageAsset(args.source, { name: args.name, mimeType: args.mimeType });
      return textResult(asset);
    },
  },
  {
    name: 'list_assets',
    description: 'The images registered with upload_asset, newest first, with the reference to pass to imageSrc / screenshotSrc.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const assets: StoredAsset[] = await listImageAssets();
      return textResult({ assets, count: assets.length });
    },
  },
  {
    name: 'delete_asset',
    description: 'Forget an uploaded asset. Elements already placed keep their copy of the image.',
    inputSchema: {
      type: 'object',
      properties: { assetId: { type: 'string', description: 'The id (or "asset:<id>" reference) from upload_asset.' } },
      required: ['assetId'],
    },
    run: async (args) => {
      const ok = await deleteImageAsset(args.assetId);
      return ok ? textResult({ ok }) : { ...textResult('No such asset.'), isError: true };
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
          'Open Screenshot Generator design tools. Use list_artboards to discover ids, then build a screen with add_elements (one batched call per board, back to front) and refine with update_element. ' +
          'A set of store screenshots normally starts from one finished board plus duplicate_artboard. ' +
          'Send an image through upload_asset once and reuse the asset: reference; check fontFamily against list_fonts; use reorder_element rather than rebuilding a board to fix stacking; ' +
          'and while iterating call export_png with scale 0.25, keeping full-size or export_all for the final delivery. ' +
          'A project can export several languages from one design: list_locales says which it has, set_localized_text writes one language\'s copy, and every other tool reads and writes the base document that all of them share. ' +
          'Rendering follows the canvas, so export a language with set_locale then export_all.',
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
        // Answer *something* even if a tool hangs on a promise that never
        // settles. Rust drops the call at its own (longer) deadline either
        // way, but replying here frees the client's connection sooner and
        // tells it which tool misbehaved instead of just "no answer".
        response = await withWatchdog(handleMcpMessage(message, getApi()), message);
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

// Kept just under the Rust-side budgets in mcp_server.rs (12s / 180s) so the
// frontend is the one that reports a stuck tool.
const HANDLER_TIMEOUT_MS = 10_000;
const SLOW_HANDLER_TIMEOUT_MS = 170_000;
const SLOW_TOOLS = new Set([
  'export_png',
  'export_all',
  'create_project_from_template',
  'open_project',
  'upload_asset',
  'add_elements',
  'duplicate_artboard',
  'update_artboard',
  // One HTTP request per distinct string, per language, against a rate limit.
  'translate_locales',
  // Same, when it was asked to draft the languages it just added.
  'add_locales',
]);

function withWatchdog(work: Promise<unknown>, message: JsonRpcMessage): Promise<unknown> {
  const toolName = message?.method === 'tools/call' ? (message.params?.name as string | undefined) : undefined;
  const budget = toolName && SLOW_TOOLS.has(toolName) ? SLOW_HANDLER_TIMEOUT_MS : HANDLER_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<unknown>((resolve) => {
    timer = setTimeout(
      () =>
        resolve(
          rpcError(
            message?.id,
            -32001,
            `${toolName ?? message?.method ?? 'The request'} did not finish within ${Math.round(budget / 1000)}s and was abandoned. The app is still running, check whether it is waiting on a dialog.`
          )
        ),
      budget
    );
  });
  return Promise.race([work, expiry]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
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

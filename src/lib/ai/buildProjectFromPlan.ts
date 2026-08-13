import type {
  ArtboardElement,
  ArtboardState,
  DeviceFrameElementProps,
  DeviceType,
  ElementLocaleOverride,
  LocaleEntry,
  Project,
  TextElementProps,
} from '@/types/artboard';
import { getDeviceDescriptor } from '@/lib/deviceRegistry';
import { TEMPLATE_CATEGORIES } from '@/lib/templateCategories';
import { hash32 } from '@/lib/i18n/hash';
import { DEFAULT_BASE_LOCALE, LOCALES } from '@/lib/i18n/locales';
import { setLocalization } from '@/lib/i18n/localization';
import {
  AGENT_FONTS,
  AGENT_LIMITS,
  LAYOUT_VARIANTS,
  NEW_DESIGN_DEVICE_TYPES,
  type AgentCanvas,
  type AgentPlan,
  type LayoutVariant,
  type NewDesignArtboardSpec,
  type NewDesignSpec,
} from './agentPlanSchema';
import type { UploadedScreenshot } from './imageUtils';

/**
 * Turns a validated AgentPlan into a Project.
 *
 * Everything here is deterministic and defensive: the plan came from a language
 * model, so ids may not exist, indices may be out of range, and hex colors may
 * be three digits or a color name. Nothing in a plan can throw except an
 * unresolvable template id (which the user can act on); everything else is
 * clamped, repaired, or dropped into `warnings`.
 */

export class AgentBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentBuildError';
  }
}

export interface BuildResult {
  project: Project;
  warnings: string[];
  /** For the confirmation card. */
  summary: {
    action: AgentPlan['action'];
    templateName: string | null;
    artboardCount: number;
    screenshotsPlaced: number;
    textsUpdated: number;
    /** Languages the plan added on top of the base one, in plan order. */
    localesAdded?: string[];
  };
}

export function buildProjectFromPlan(
  plan: AgentPlan,
  screenshots: UploadedScreenshot[],
  templates: Project[]
): BuildResult {
  return plan.action === 'use-template'
    ? buildFromTemplate(plan, screenshots, templates)
    : buildNewDesign(plan, screenshots);
}

// --- use-template ---------------------------------------------------------

function buildFromTemplate(
  plan: AgentPlan,
  screenshots: UploadedScreenshot[],
  templates: Project[]
): BuildResult {
  const warnings: string[] = [];
  const template = resolveTemplate(plan.templateId, templates);
  let artboards: ArtboardState[] = deepCopy(template.projectData);

  const claimed = new Set<string>();
  const usedScreenshots = new Set<number>();
  let screenshotsPlaced = 0;

  for (const placement of plan.screenshotPlacements) {
    const shot = screenshots[placement.screenshotIndex];
    if (!shot) {
      warnings.push(`Screenshot ${placement.screenshotIndex} does not exist and was skipped.`);
      continue;
    }
    const artboard = artboards[placement.artboardIndex];
    if (!artboard) {
      warnings.push(
        `Artboard ${placement.artboardIndex} does not exist in this template, so screenshot ${placement.screenshotIndex} was skipped.`
      );
      continue;
    }
    const device = placement.deviceElementId
      ? (artboard.elements.find(
          (el): el is DeviceFrameElementProps =>
            el.type === 'device' && el.id === placement.deviceElementId
        ) ?? null)
      : null;
    const target =
      device && !claimed.has(device.id) ? device : firstFreeDevice(artboard, claimed);
    if (!target) {
      warnings.push(
        `No free device frame on artboard ${placement.artboardIndex} for screenshot ${placement.screenshotIndex}.`
      );
      continue;
    }
    applyScreenshot(target, shot);
    claimed.add(target.id);
    usedScreenshots.add(placement.screenshotIndex);
    screenshotsPlaced++;
  }

  // A plan that placed nothing (or only some) still beats an empty project:
  // drop the leftovers into whatever frames remain, in reading order.
  const leftovers = screenshots.filter((_, i) => !usedScreenshots.has(i));
  if (leftovers.length > 0) {
    let cursor = 0;
    for (const artboard of artboards) {
      let free = firstFreeDevice(artboard, claimed);
      while (free && cursor < leftovers.length) {
        applyScreenshot(free, leftovers[cursor++]);
        claimed.add(free.id);
        screenshotsPlaced++;
        free = firstFreeDevice(artboard, claimed);
      }
    }
  }

  // Resolved up front so the base copy can be written before any translation of
  // it. A translation's sourceHash tracks the copy that ends up underneath it,
  // and a plan is free to list the German line first, which would otherwise
  // hash the template's original wording and be born reading "the English
  // changed since this was translated".
  interface PlannedText {
    board: ArtboardState;
    element: TextElementProps;
    text: string;
    /** Null is the language the design is written in. */
    locale: string | null;
  }
  const planned: PlannedText[] = [];
  // Insertion-ordered, so the language chips end up in the order the plan asked
  // for them rather than in whatever order the text slots happen to be in.
  const localesAdded: string[] = [];

  for (const override of plan.textOverrides) {
    const slot = findTextSlot(artboards, override.artboardIndex, override.elementId);
    if (!slot) {
      warnings.push(`Text element "${override.elementId}" was not found and was skipped.`);
      continue;
    }
    const text = clampText(override.text);
    const asked = override.locale?.trim();
    if (!asked) {
      planned.push({ ...slot, text, locale: null });
      continue;
    }

    const locale = resolvePlanLocale(asked);
    if (!locale) {
      warnings.push(`"${asked}" is not a language this app knows, so that copy was skipped.`);
      continue;
    }
    // The design is already written in the base language; a translation of it
    // into itself would only shadow the copy sitting underneath.
    if (locale === DEFAULT_BASE_LOCALE) {
      planned.push({ ...slot, text, locale: null });
      continue;
    }
    if (!localesAdded.includes(locale)) {
      if (localesAdded.length >= AGENT_LIMITS.maxLocales) {
        warnings.push(
          `The plan asked for more than ${AGENT_LIMITS.maxLocales} languages; ${locale} and anything after it were skipped. Add the rest in the app.`
        );
        continue;
      }
      if (locale !== asked) warnings.push(`Language "${asked}" was read as ${locale}.`);
      localesAdded.push(locale);
    }
    planned.push({ ...slot, text, locale });
  }

  let textsUpdated = 0;
  for (const item of planned) {
    if (item.locale) continue;
    item.element.content = item.text;
    textsUpdated++;
  }
  for (const item of planned) {
    if (!item.locale) continue;
    writeLocaleText(item.board, item.element, item.locale, item.text);
    textsUpdated++;
  }

  if (localesAdded.length > 0) {
    artboards = setLocalization(artboards, {
      baseLocale: DEFAULT_BASE_LOCALE,
      locales: localesAdded.map((code): LocaleEntry => ({ code })),
    });
  }

  return {
    project: {
      id: 'agent_plan',
      name: clampName(plan.projectName) || template.name,
      description: plan.reasoning ?? `Built from ${template.name} by the AI agent.`,
      timestamp: new Date(),
      projectData: artboards,
      category: template.category,
    },
    warnings,
    summary: {
      action: 'use-template',
      templateName: template.name,
      artboardCount: artboards.length,
      screenshotsPlaced,
      textsUpdated,
      ...(localesAdded.length > 0 ? { localesAdded } : {}),
    },
  };
}

function resolveTemplate(templateId: string | null, templates: Project[]): Project {
  if (templates.length === 0) {
    throw new AgentBuildError('Templates have not finished loading yet. Try again in a moment.');
  }
  const wanted = (templateId ?? '').trim().toLowerCase();
  if (!wanted) {
    throw new AgentBuildError('The plan did not name a template.');
  }
  const normalize = (value: string) => value.trim().toLowerCase().replace(/^template_/, '');
  const target = normalize(wanted);

  const byId = templates.find((t) => normalize(t.id) === target);
  if (byId) return byId;
  const byName = templates.find((t) => t.name.trim().toLowerCase() === wanted);
  if (byName) return byName;
  // Models routinely return a filename or a partial slug.
  const byPrefix = templates.find(
    (t) => normalize(t.id).startsWith(target) || target.startsWith(normalize(t.id))
  );
  if (byPrefix) return byPrefix;

  const suggestions = templates.slice(0, 4).map((t) => t.id).join(', ');
  throw new AgentBuildError(
    `No template called "${templateId}". Try again, or pick one by hand. Known ids look like: ${suggestions}`
  );
}

function firstFreeDevice(
  artboard: ArtboardState,
  claimed: Set<string>
): DeviceFrameElementProps | null {
  return (
    artboard.elements.find(
      (el): el is DeviceFrameElementProps => el.type === 'device' && !claimed.has(el.id)
    ) ?? null
  );
}

/**
 * Mirrors DeviceFrameElement's own upload handler. `screenshotRect` is left
 * alone on purpose: templates use it to frame the visible slice of the screen,
 * and overwriting it would undo the author's crop.
 */
function applyScreenshot(device: DeviceFrameElementProps, shot: UploadedScreenshot): void {
  device.screenshotSrc = shot.dataUrl;
  device.screenshotObjectFit = device.screenshotObjectFit ?? 'cover';
  device.naturalScreenshotWidth = shot.width;
  device.naturalScreenshotHeight = shot.height;
}

/**
 * Looks in the named artboard first, then anywhere, since models miscount
 * indices. The board comes back with the element because a translation is
 * stored on the board that holds it, not on the element.
 */
function findTextSlot(
  artboards: ArtboardState[],
  artboardIndex: number,
  elementId: string
): { board: ArtboardState; element: TextElementProps } | null {
  const named = artboards[artboardIndex];
  const inNamed = named?.elements.find(
    (el): el is TextElementProps => el.type === 'text' && el.id === elementId
  );
  if (inNamed) return { board: named, element: inNamed };
  for (const artboard of artboards) {
    const found = artboard.elements.find(
      (el): el is TextElementProps => el.type === 'text' && el.id === elementId
    );
    if (found) return { board: artboard, element: found };
  }
  return null;
}

// --- languages ------------------------------------------------------------

/**
 * Resolves whatever the model called a language to one of ours. Models quote
 * "de", "German" and "de-DE" interchangeably, and a plan that came back with a
 * near-miss is worth resolving rather than dropping, so the ladder goes: the
 * exact store code, the translate code when only one language uses it, the
 * language part alone, then the English or native name. Null means we could not
 * place it, which the caller reports instead of guessing.
 */
function resolvePlanLocale(requested: string): string | null {
  const wanted = requested.trim().toLowerCase();
  if (!wanted) return null;

  const exact = LOCALES.find((locale) => locale.code.toLowerCase() === wanted);
  if (exact) return exact.code;

  const byTranslateCode = LOCALES.filter(
    (locale) => (locale.translateCode ?? '').toLowerCase() === wanted
  );
  if (byTranslateCode.length === 1) return byTranslateCode[0].code;

  const byLanguage = LOCALES.filter(
    (locale) => locale.code.toLowerCase().split('-')[0] === wanted
  );
  if (byLanguage.length > 0) {
    // "de" means de-DE and "fr" means fr-FR, so the regional twin of the
    // language itself is the least surprising read. "en" has no en-EN, and the
    // base locale is the right answer there.
    const twin = byLanguage.find((locale) => locale.code.toLowerCase() === `${wanted}-${wanted}`);
    const base = byLanguage.find((locale) => locale.code === DEFAULT_BASE_LOCALE);
    return (twin ?? base ?? byLanguage[0]).code;
  }

  const byName = LOCALES.find(
    (locale) =>
      locale.name.toLowerCase() === wanted || locale.nativeName.toLowerCase() === wanted
  );
  return byName?.code ?? null;
}

/**
 * Stores one language's copy for one element. Marked `auto` with the base
 * string's hash: a machine wrote it, so "Update translations" may refresh it,
 * and it goes amber the moment somebody rewrites the English underneath.
 */
function writeLocaleText(
  board: ArtboardState,
  element: TextElementProps,
  locale: string,
  text: string
): void {
  const override: ElementLocaleOverride = {
    content: text,
    origin: 'auto',
    sourceHash: hash32(element.content),
  };
  if (!board.localized) board.localized = {};
  board.localized[locale] = { ...(board.localized[locale] ?? {}), [element.id]: override };
}

// --- generate-new ---------------------------------------------------------

/**
 * Layout recipes in normalized coordinates (fractions of the canvas), so one
 * table serves the 1290x2796 phone canvas, the 422x514 watch canvas, and the
 * 1024x500 landscape banner. The banner splits text and device left/right
 * instead, handled below.
 */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Recipe {
  headline: Box;
  subheadline: Box;
  device: Box | null;
  angled?: boolean;
}

const PORTRAIT_RECIPES: Record<LayoutVariant, Recipe> = {
  'device-bottom': {
    headline: { x: 0.06, y: 0.055, w: 0.88, h: 0.14 },
    subheadline: { x: 0.1, y: 0.2, w: 0.8, h: 0.07 },
    device: { x: 0.19, y: 0.4, w: 0.62, h: 0.58 },
  },
  'device-top': {
    headline: { x: 0.06, y: 0.7, w: 0.88, h: 0.14 },
    subheadline: { x: 0.1, y: 0.85, w: 0.8, h: 0.07 },
    device: { x: 0.21, y: 0.04, w: 0.58, h: 0.62 },
  },
  'device-center': {
    headline: { x: 0.06, y: 0.045, w: 0.88, h: 0.1 },
    subheadline: { x: 0.1, y: 0.16, w: 0.8, h: 0.07 },
    device: { x: 0.225, y: 0.3, w: 0.55, h: 0.62 },
  },
  'device-angled': {
    headline: { x: 0.06, y: 0.055, w: 0.88, h: 0.14 },
    subheadline: { x: 0.1, y: 0.2, w: 0.8, h: 0.07 },
    device: { x: 0.14, y: 0.36, w: 0.72, h: 0.6 },
    angled: true,
  },
  'text-only': {
    headline: { x: 0.06, y: 0.3, w: 0.88, h: 0.22 },
    subheadline: { x: 0.1, y: 0.55, w: 0.8, h: 0.1 },
    device: null,
  },
};

const LANDSCAPE_RECIPES: Record<LayoutVariant, Recipe> = {
  'device-bottom': {
    headline: { x: 0.05, y: 0.2, w: 0.45, h: 0.3 },
    subheadline: { x: 0.05, y: 0.54, w: 0.42, h: 0.16 },
    device: { x: 0.58, y: 0.14, w: 0.28, h: 0.95 },
  },
  'device-top': {
    headline: { x: 0.52, y: 0.2, w: 0.43, h: 0.3 },
    subheadline: { x: 0.52, y: 0.54, w: 0.4, h: 0.16 },
    device: { x: 0.14, y: 0.1, w: 0.26, h: 0.92 },
  },
  'device-center': {
    headline: { x: 0.05, y: 0.18, w: 0.45, h: 0.3 },
    subheadline: { x: 0.05, y: 0.52, w: 0.42, h: 0.16 },
    device: { x: 0.6, y: 0.1, w: 0.26, h: 0.9 },
  },
  'device-angled': {
    headline: { x: 0.05, y: 0.2, w: 0.45, h: 0.3 },
    subheadline: { x: 0.05, y: 0.54, w: 0.42, h: 0.16 },
    device: { x: 0.55, y: 0.12, w: 0.34, h: 0.92 },
    angled: true,
  },
  'text-only': {
    headline: { x: 0.08, y: 0.24, w: 0.84, h: 0.32 },
    subheadline: { x: 0.14, y: 0.6, w: 0.72, h: 0.16 },
    device: null,
  },
};

function canvasSize(canvas: AgentCanvas): { width: number; height: number } {
  const category = TEMPLATE_CATEGORIES.find((c) => c.id === canvas) ?? TEMPLATE_CATEGORIES[0];
  return category.defaultSize;
}

function buildNewDesign(plan: AgentPlan, screenshots: UploadedScreenshot[]): BuildResult {
  const warnings: string[] = [];
  const spec = plan.newDesign;
  if (!spec) {
    throw new AgentBuildError('The plan asked for a new design but did not describe one.');
  }

  const canvas = spec.canvas;
  const size = canvasSize(canvas);
  const landscape = size.width > size.height;

  let deviceType: DeviceType = NEW_DESIGN_DEVICE_TYPES.includes(spec.deviceType)
    ? spec.deviceType
    : 'iphone-15-pro';
  if (canvas === 'apple-watch' && deviceType !== 'apple-watch') {
    warnings.push('Apple Watch canvas always uses the Apple Watch mockup.');
    deviceType = 'apple-watch';
  }

  const fontFamily = (AGENT_FONTS as readonly string[]).includes(spec.fontFamily)
    ? spec.fontFamily
    : AGENT_FONTS[0];

  const boards = spec.artboards.slice(0, AGENT_LIMITS.maxNewDesignArtboards);
  if (spec.artboards.length > boards.length) {
    warnings.push(
      `The plan asked for ${spec.artboards.length} artboards; only the first ${boards.length} were created.`
    );
  }

  let screenshotsPlaced = 0;
  const artboards: ArtboardState[] = boards.map((board, index) => {
    const { artboard, placed } = buildNewArtboard({
      board,
      index,
      size,
      landscape,
      deviceType,
      fontFamily,
      screenshots,
      warnings,
    });
    if (placed) screenshotsPlaced++;
    return artboard;
  });

  return {
    project: {
      id: 'agent_plan',
      name: clampName(plan.projectName) || spec.themeName || 'AI design',
      description: plan.reasoning ?? `Generated by the AI agent (${spec.themeName}).`,
      timestamp: new Date(),
      projectData: artboards,
      category: canvas,
    },
    warnings,
    summary: {
      action: 'generate-new',
      templateName: null,
      artboardCount: artboards.length,
      screenshotsPlaced,
      textsUpdated: 0,
    },
  };
}

function buildNewArtboard(args: {
  board: NewDesignArtboardSpec;
  index: number;
  size: { width: number; height: number };
  landscape: boolean;
  deviceType: DeviceType;
  fontFamily: string;
  screenshots: UploadedScreenshot[];
  warnings: string[];
}): { artboard: ArtboardState; placed: boolean } {
  const { board, index, size, landscape, deviceType, fontFamily, screenshots, warnings } = args;
  const layout: LayoutVariant = LAYOUT_VARIANTS.includes(board.layout)
    ? board.layout
    : 'device-bottom';
  const recipe = (landscape ? LANDSCAPE_RECIPES : PORTRAIT_RECIPES)[layout];

  const color1 = safeHex(board.backgroundColor1, '#101820');
  const color2 = safeHex(board.backgroundColor2, color1);
  const textColor = safeHex(board.textColor, '#FFFFFF');
  const gradient = board.backgroundType === 'gradient';

  // TextElement renders glyphs at fontSize / 0.3 px, so a template headline of
  // 42 on a 1290px board draws at 140px. Keeping the same ratio makes generated
  // text match hand-authored templates at any canvas size.
  const headlineSize = clamp(Math.round(size.width * 0.033), 12, 48);
  const subheadlineSize = Math.max(10, Math.round(headlineSize * 0.42));

  const elements: ArtboardElement[] = [];
  const id = (suffix: string) => `agent-b${index + 1}-${suffix}`;

  elements.push({
    id: id('headline'),
    type: 'text',
    name: 'Headline',
    ...boxToFrame(recipe.headline, size),
    rotation: 0,
    scale: 1,
    content: clampText(board.headline),
    fontSize: headlineSize,
    color: textColor,
    fontFamily,
    fontWeight: '700',
    textAlign: landscape ? 'left' : 'center',
    lineHeight: 1.15,
  } satisfies TextElementProps);

  if (board.subheadline?.trim()) {
    elements.push({
      id: id('subheadline'),
      type: 'text',
      name: 'Subheadline',
      ...boxToFrame(recipe.subheadline, size),
      rotation: 0,
      scale: 1,
      content: clampText(board.subheadline),
      fontSize: subheadlineSize,
      color: textColor,
      fontFamily,
      fontWeight: '400',
      textAlign: landscape ? 'left' : 'center',
      lineHeight: 1.35,
    } satisfies TextElementProps);
  }

  let placed = false;
  if (recipe.device) {
    const frame = fitDevice(recipe.device, size, deviceType);
    const shot =
      board.screenshotIndex === null ? undefined : screenshots[board.screenshotIndex];
    if (board.screenshotIndex !== null && !shot) {
      warnings.push(
        `Artboard ${index} asked for screenshot ${board.screenshotIndex}, which does not exist.`
      );
    }
    const device: DeviceFrameElementProps = {
      id: id('device'),
      type: 'device',
      name: 'Device',
      ...frame,
      rotation: 0,
      scale: 1,
      deviceType,
      screenshotObjectFit: 'cover',
      screenshotRect: { left: 0, top: 0, width: 100, height: 100 },
      styleType: recipe.angled ? '3d-left' : 'normal',
      ...(recipe.angled ? { pose3d: 'tilted' as const, frameColor3d: 'titanium' as const } : {}),
    };
    if (shot) {
      applyScreenshot(device, shot);
      placed = true;
    }
    elements.push(device);
  }

  return {
    artboard: {
      id: `agent-board-${index + 1}`,
      name: clampName(board.name) || `Screen ${index + 1}`,
      // calculateArtboardPositions re-lays every board side by side on load,
      // so this is only a placeholder.
      position: { x: 15, y: 15 },
      size: { ...size },
      backgroundColor: color1,
      backgroundType: gradient ? 'gradient' : 'solid',
      ...(gradient
        ? {
            backgroundGradient: {
              color1,
              color2,
              angle: clamp(Math.round(board.backgroundAngle ?? 135), 0, 360),
            },
          }
        : {}),
      zoom: 1,
      elements,
    },
    placed,
  };
}

function boxToFrame(
  box: Box,
  size: { width: number; height: number }
): { position: { x: number; y: number }; size: { width: number; height: number } } {
  return {
    position: { x: Math.round(box.x * size.width), y: Math.round(box.y * size.height) },
    size: { width: Math.round(box.w * size.width), height: Math.round(box.h * size.height) },
  };
}

/** Fits the device's native aspect inside the recipe box so frames never stretch. */
function fitDevice(
  box: Box,
  size: { width: number; height: number },
  deviceType: DeviceType
): { position: { x: number; y: number }; size: { width: number; height: number } } {
  const aspect = getDeviceDescriptor(deviceType).nativeAspect;
  const boxW = box.w * size.width;
  const boxH = box.h * size.height;
  let width = boxW;
  let height = width / aspect;
  if (height > boxH) {
    height = boxH;
    width = height * aspect;
  }
  const centerX = (box.x + box.w / 2) * size.width;
  return {
    position: { x: Math.round(centerX - width / 2), y: Math.round(box.y * size.height) },
    size: { width: Math.round(width), height: Math.round(height) },
  };
}

// --- shared helpers -------------------------------------------------------

function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampText(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > AGENT_LIMITS.maxTextLength
    ? trimmed.slice(0, AGENT_LIMITS.maxTextLength)
    : trimmed;
}

function clampName(value: string): string {
  return value.trim().slice(0, 60);
}

/** Accepts #RGB and #RRGGBB, with or without the hash. Anything else falls back. */
function safeHex(value: string | null, fallback: string): string {
  if (!value) return fallback;
  const raw = value.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toUpperCase()}`;
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw
      .split('')
      .map((c) => c + c)
      .join('')
      .toUpperCase()}`;
  }
  return fallback;
}

/** Dev-only fixtures so the whole pipeline can be exercised without a key. */
export function mockPlan(action: AgentPlan['action'], templateId?: string): AgentPlan {
  if (action === 'use-template') {
    return {
      action: 'use-template',
      projectName: 'Mock template project',
      reasoning: 'Mock plan: dropped the screenshots into the first template.',
      templateId: templateId ?? 'template_breathora-breathing',
      screenshotPlacements: [],
      textOverrides: [],
      newDesign: null,
    };
  }
  return {
    action: 'generate-new',
    projectName: 'Mock new design',
    reasoning: 'Mock plan: a three screen set generated from scratch.',
    templateId: null,
    screenshotPlacements: [],
    textOverrides: [],
    newDesign: {
      themeName: 'Midnight',
      canvas: 'screenshots',
      deviceType: 'iphone-15-pro',
      fontFamily: 'Bricolage Grotesque',
      artboards: [
        {
          name: 'Hero',
          headline: 'Everything you need,\nin one place',
          subheadline: 'Track, plan and ship without leaving the app.',
          layout: 'device-bottom',
          screenshotIndex: 0,
          backgroundType: 'gradient',
          backgroundColor1: '#101820',
          backgroundColor2: '#2A4B7C',
          backgroundAngle: 135,
          textColor: '#FFFFFF',
        },
        {
          name: 'Feature',
          headline: 'Built for focus',
          subheadline: null,
          layout: 'device-center',
          screenshotIndex: 1,
          backgroundType: 'solid',
          backgroundColor1: '#F4F1EA',
          backgroundColor2: null,
          backgroundAngle: null,
          textColor: '#101820',
        },
        {
          name: 'Close',
          headline: 'Start today',
          subheadline: 'Free for the first month.',
          layout: 'device-angled',
          screenshotIndex: 2,
          backgroundType: 'gradient',
          backgroundColor1: '#2A0A3C',
          backgroundColor2: '#7C1418',
          backgroundAngle: 160,
          textColor: '#FFFFFF',
        },
      ],
    } satisfies NewDesignSpec,
  };
}

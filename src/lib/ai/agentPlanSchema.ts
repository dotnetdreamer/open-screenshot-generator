import { z } from 'zod';
import type { DeviceType } from '@/types/artboard';

/**
 * The single contract between the AI agent and Open Screenshot Generator.
 *
 * Both execution modes (API key via the Vercel AI SDK, and the browser-session
 * mode that drives claude.ai / chatgpt.com / gemini.google.com) produce one of
 * these. `buildProjectFromPlan` turns it into a real Project.
 *
 * The model only ever FILLS SLOTS: which template, which screenshot goes in
 * which device frame, what the copy says, and (for a net-new design) a picked
 * layout from a fixed set. It never emits element trees, SVG paths, or
 * coordinates, so a hallucinated plan degrades into a slightly odd project
 * rather than a broken canvas.
 *
 * Schema shape rules, driven by OpenAI's strict structured-output mode (the
 * strictest of the three providers we support):
 *   - every object key is present; optionality is expressed with .nullable()
 *   - no .min()/.max()/.regex() (they become JSON Schema keywords OpenAI's
 *     strict mode rejects). Bounds are enforced by the builder instead, which
 *     has to sanitize the browser-session mode's pasted JSON anyway.
 *   - no z.record / z.discriminatedUnion.
 */

// Devices the generate-new layout recipes know how to size and pose.
// (Templates may use any DeviceType; this allowlist only constrains net-new
// designs.)
export const NEW_DESIGN_DEVICE_TYPES = [
  'iphone-15-pro',
  'iphone-17-pro-max',
  'android-punch-hole',
  'apple-watch',
  'ipad-pro-13',
] as const satisfies readonly DeviceType[];

export type NewDesignDeviceType = (typeof NEW_DESIGN_DEVICE_TYPES)[number];

/**
 * Decoration a generated board can carry, named rather than drawn.
 *
 * A board built from the fields below alone is a headline, a subheadline and a
 * phone on a flat colour, which is why generated designs read as plain next to
 * the templates: a template board averages eight elements and the richest have
 * thirty. The gap is entirely decorative, and none of it was expressible here.
 *
 * These stay slot names for the same reason everything else in this file does.
 * The builder owns every coordinate, size and opacity, so the worst a wrong
 * pick can do is look odd; a model handing over shapes and paths could hand
 * over a broken canvas instead.
 */
export const DECORATION_STYLES = [
  'none', // flat colour, which is still right for a stark design
  'glow', // a soft coloured halo behind the device, the "shiny" look
  'blobs', // two large organic shapes bleeding off opposite corners
  'sparkles', // a scatter of small stars, good over a dark gradient
  'rings', // concentric outlined circles behind the device
  'arc', // a wide band sweeping across the lower third
] as const;

export type DecorationStyle = (typeof DECORATION_STYLES)[number];

export const LAYOUT_VARIANTS = [
  'device-bottom', // headline up top, device rising from the bottom edge
  'device-top', // device up top, copy below it
  'device-center', // slim headline, whole device centered
  'device-angled', // 3D tilted device, hero shot
  'text-only', // headline + subheadline, no device
] as const;

export type LayoutVariant = (typeof LAYOUT_VARIANTS)[number];

// Restricted to families the app actually loads (see services/fontService.ts).
// Anything else would silently render as a system fallback.
export const AGENT_FONTS = [
  'Bricolage Grotesque',
  'Calistoga',
  'Oswald',
  'DM Serif Display',
  'Merriweather Sans',
  'Fira Sans Condensed',
  'Noto Sans',
  // Display faces, for a headline that has to carry the whole board
  'Anton',
  'Bebas Neue',
  'Playfair Display',
  'Poppins',
  // Non-Latin scripts. Without these a plan asking for a Japanese or Hebrew
  // board could only pick a Latin face, which renders the copy as tofu.
  'Noto Sans JP',
  'Noto Sans SC',
  'Noto Sans TC',
  'Noto Sans KR',
  'Noto Sans Hebrew',
  'Noto Sans Arabic',
  'Noto Sans Thai',
  'Noto Sans Devanagari',
  'Noto Sans Bengali',
] as const;

export type AgentFont = (typeof AGENT_FONTS)[number];

// Canvas presets, keyed by TEMPLATE_CATEGORIES id so the builder can look the
// size up rather than hardcode it twice.
export const AGENT_CANVASES = ['screenshots', 'apple-watch', 'play-feature-graphic'] as const;

export type AgentCanvas = (typeof AGENT_CANVASES)[number];

const screenshotPlacementSchema = z.object({
  // 0-based index into the user's uploads, in the order they appear in the UI.
  screenshotIndex: z.number().int(),
  artboardIndex: z.number().int(),
  // Exact element id from the template catalog. null means "the first device
  // frame in that artboard that nothing has claimed yet".
  deviceElementId: z.string().nullable(),
});

const textOverrideSchema = z.object({
  artboardIndex: z.number().int(),
  // Exact text element id from the template catalog.
  elementId: z.string(),
  text: z.string(),
  /**
   * Which language this copy is for: a language code such as "de-DE" or "ja",
   * or null for the language the design itself is written in.
   *
   * A localized entry writes ONE string on top of the shared design, so the
   * layout, the colours and the screenshots stay identical in every language
   * and a second language costs a handful of strings rather than a second copy
   * of the project. The builder resolves loose codes ("de", "German") and
   * warns about ones it cannot place.
   */
  locale: z.string().nullable(),
});

const newDesignArtboardSchema = z.object({
  name: z.string(),
  headline: z.string(),
  subheadline: z.string().nullable(),
  layout: z.enum(LAYOUT_VARIANTS),
  // null renders an empty device frame (or nothing, for 'text-only').
  screenshotIndex: z.number().int().nullable(),
  backgroundType: z.enum(['solid', 'gradient']),
  // 6-digit hex, e.g. "#1A2B3C". Validated and repaired by the builder.
  backgroundColor1: z.string(),
  backgroundColor2: z.string().nullable(),
  backgroundAngle: z.number().nullable(),
  textColor: z.string(),
  decoration: z.enum(DECORATION_STYLES),
  /**
   * The colour the decoration is drawn in. 6-digit hex, or null to let the
   * builder pick one off the background, which is the safer answer whenever the
   * model has no strong opinion.
   */
  decorationColor: z.string().nullable(),
});

const newDesignSchema = z.object({
  themeName: z.string(),
  canvas: z.enum(AGENT_CANVASES),
  deviceType: z.enum(NEW_DESIGN_DEVICE_TYPES),
  fontFamily: z.enum(AGENT_FONTS),
  artboards: z.array(newDesignArtboardSchema),
});

/**
 * Provider-facing schema. Plain object, no refinements, so it converts to a
 * JSON Schema every provider's structured-output mode accepts.
 */
export const AgentPlanObjectSchema = z.object({
  action: z.enum(['use-template', 'generate-new']),
  // One short sentence, shown to the user before they confirm.
  reasoning: z.string().nullable(),
  projectName: z.string(),
  // The catalog ref (e.g. "t12") as emitted by the model; resolveAliases
  // rewrites it to the real template id before validation. Required when
  // action is use-template.
  templateId: z.string().nullable(),
  screenshotPlacements: z.array(screenshotPlacementSchema),
  textOverrides: z.array(textOverrideSchema),
  // Required when action is generate-new.
  newDesign: newDesignSchema.nullable(),
});

/**
 * Validation-facing schema: adds the one cross-field rule. Used on pasted JSON
 * and on whatever the API mode returns, never sent to a provider.
 */
export const AgentPlanSchema = AgentPlanObjectSchema.superRefine((plan, ctx) => {
  if (plan.action === 'use-template' && !plan.templateId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['templateId'],
      message: 'templateId is required when action is "use-template"',
    });
  }
  if (plan.action === 'generate-new' && !plan.newDesign) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['newDesign'],
      message: 'newDesign is required when action is "generate-new"',
    });
  }
  if (plan.newDesign && plan.newDesign.artboards.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['newDesign', 'artboards'],
      message: 'newDesign.artboards must contain at least one artboard',
    });
  }
});

export type AgentPlan = z.infer<typeof AgentPlanObjectSchema>;
export type NewDesignSpec = NonNullable<AgentPlan['newDesign']>;
export type NewDesignArtboardSpec = NewDesignSpec['artboards'][number];
export type ScreenshotPlacement = AgentPlan['screenshotPlacements'][number];
export type TextOverride = AgentPlan['textOverrides'][number];

/** Caps the builder enforces. Kept here so the prompt can quote them. */
export const AGENT_LIMITS = {
  maxScreenshots: 3,
  maxNewDesignArtboards: 6,
  maxTextLength: 200,
  /** Languages one plan may add. Past this it is a translation job, not a design. */
  maxLocales: 8,
} as const;

/**
 * Formats zod issues into lines a non-developer can act on, e.g.
 * `screenshotPlacements[2].screenshotIndex: Expected number, received string`.
 */
export function formatPlanIssues(error: z.ZodError, limit = 4): string[] {
  return error.issues.slice(0, limit).map((issue) => {
    const path = issue.path
      .map((seg) => (typeof seg === 'number' ? `[${seg}]` : `.${seg}`))
      .join('')
      .replace(/^\./, '');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

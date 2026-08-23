/**
 * A derived, in-memory index of the template catalog.
 *
 * The 101 templates already sit in memory by the time the start dialog opens
 * (projectService fetches every one of them up front), so everything the fast
 * intake flow needs to rank them can be computed from the artboards themselves.
 * That matters: it means matching improves whenever a template is authored or
 * edited, and no hand-written tag file can go stale against the JSON.
 *
 * Nothing here touches the DOM, so it runs identically in a worker, in Node,
 * and during the static export.
 */

import type {
  ArtboardState,
  DeviceFrameElementProps,
  DeviceType,
  Project,
  Size,
  TextElementProps,
} from '@/types/artboard';
import { DEVICE_REGISTRY, type DeviceCategory, type DevicePlatform } from '@/lib/deviceRegistry';
import { normalizeGradient } from '@/lib/artboardBackground';

/** One screenshot-shaped hole in a template, in reading order. */
export interface TemplateSlot {
  artboardIndex: number;
  elementId: string;
  deviceType: DeviceType;
  /** A 3D device costs a WebGL context wherever it renders. */
  is3d: boolean;
}

/** The biggest line of copy on a board: what an app name replaces. */
export interface TemplateHeadline {
  artboardIndex: number;
  elementId: string;
  content: string;
  fontSize: number;
}

export interface TemplateIndexEntry {
  id: string;
  name: string;
  category: string | undefined;
  boardCount: number;
  canvas: Size;
  slots: TemplateSlot[];
  headlines: TemplateHeadline[];
  deviceTypes: DeviceType[];
  /** 'mixed' when a template pairs, say, a phone and a Mac. */
  platform: DevicePlatform | 'mixed';
  deviceCategory: DeviceCategory | 'mixed';
  /** WebGL contexts the whole template would cost if every board rendered. */
  cost3d: number;
  /** Contexts the FIRST board costs, which is what a result card renders. */
  cost3dFirstBoard: number;
  hasVideo: boolean;
  /** Mean luminance of the board backgrounds, 0 to 1. */
  luminance: number;
  isDark: boolean;
  /** Background colours in board order, for the palette match. */
  backgroundColors: string[];
  /** Lowercased words from the name and description, for text search. */
  keywords: string[];
}

function hexToRgb(value: string): [number, number, number] | null {
  const hex = value.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
  if (short) {
    return [
      parseInt(short[1] + short[1], 16),
      parseInt(short[2] + short[2], 16),
      parseInt(short[3] + short[3], 16),
    ];
  }
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (long) {
    return [parseInt(long[1], 16), parseInt(long[2], 16), parseInt(long[3], 16)];
  }
  return null;
}

function luminanceOf(color: string): number | null {
  const rgb = hexToRgb(color);
  if (!rgb) return null;
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
}

/** The colour a board reads as, gradient midpoint included. */
export function boardBackgroundColor(board: ArtboardState): string {
  // Both halves of the test matter: 169 of the catalog's 450 artboards omit
  // backgroundType altogether and are solid, and normalizeGradient answers a
  // green-to-blue default for a missing gradient rather than failing.
  if (board.backgroundType === 'gradient' && board.backgroundGradient) {
    return normalizeGradient(board.backgroundGradient).color1;
  }
  return board.backgroundColor || '#FFFFFF';
}

function boardLuminance(board: ArtboardState): number | null {
  if (board.backgroundType === 'gradient' && board.backgroundGradient) {
    const gradient = normalizeGradient(board.backgroundGradient);
    const a = luminanceOf(gradient.color1);
    const b = luminanceOf(gradient.color2);
    if (a === null && b === null) return null;
    return ((a ?? b ?? 0.5) + (b ?? a ?? 0.5)) / 2;
  }
  return luminanceOf(board.backgroundColor || '#FFFFFF');
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'a', 'an', 'of', 'to', 'in', 'on', 'app', 'store', 'play',
  'screenshots', 'screenshot', 'one', 'its', 'that', 'this', 'from', 'over', 'into', 'each',
]);

function keywordsOf(project: Project): string[] {
  const text = `${project.name} ${project.description ?? ''}`.toLowerCase();
  const words = text.match(/[a-z][a-z0-9+]{2,}/g) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const word of words) {
    if (STOP_WORDS.has(word) || seen.has(word)) continue;
    seen.add(word);
    out.push(word);
    if (out.length >= 40) break;
  }
  return out;
}

/** Index one template. Cheap enough to run for the whole catalog in a memo. */
export function indexTemplate(project: Project): TemplateIndexEntry {
  const boards = project.projectData ?? [];
  const slots: TemplateSlot[] = [];
  const headlines: TemplateHeadline[] = [];
  const deviceTypes: DeviceType[] = [];
  const backgroundColors: string[] = [];
  let cost3d = 0;
  let cost3dFirstBoard = 0;
  let hasVideo = false;
  let lumTotal = 0;
  let lumCount = 0;

  boards.forEach((board, artboardIndex) => {
    backgroundColors.push(boardBackgroundColor(board));
    const boardLum = boardLuminance(board);
    if (boardLum !== null) {
      lumTotal += boardLum;
      lumCount++;
    }

    let headline: TemplateHeadline | null = null;
    for (const element of board.elements ?? []) {
      if (element.type === 'device') {
        const device = element as DeviceFrameElementProps;
        const is3d = device.styleType === '3d-left' || device.styleType === '3d-right';
        slots.push({ artboardIndex, elementId: device.id, deviceType: device.deviceType, is3d });
        if (!deviceTypes.includes(device.deviceType)) deviceTypes.push(device.deviceType);
        if (is3d) {
          cost3d++;
          if (artboardIndex === 0) cost3dFirstBoard++;
        }
      } else if (element.type === 'video-device') {
        hasVideo = true;
      } else if (element.type === 'text') {
        const text = element as TextElementProps;
        const size = text.fontSize ?? 0;
        // The headline is the biggest type on the board, and it has to be real
        // copy: a one-character label is a badge, not a title.
        if ((text.content ?? '').trim().length > 2 && (!headline || size > headline.fontSize)) {
          headline = {
            artboardIndex,
            elementId: text.id,
            content: text.content ?? '',
            fontSize: size,
          };
        }
      }
    }
    if (headline) headlines.push(headline);
  });

  const platforms = new Set(deviceTypes.map((id) => DEVICE_REGISTRY[id]?.platform).filter(Boolean));
  const categories = new Set(deviceTypes.map((id) => DEVICE_REGISTRY[id]?.category).filter(Boolean));
  // 'neutral' devices go with anything, so they never make a template "mixed".
  platforms.delete('neutral');

  const luminance = lumCount > 0 ? lumTotal / lumCount : 1;

  return {
    id: project.id,
    name: project.name,
    category: project.category,
    boardCount: boards.length,
    canvas: boards[0]?.size ?? { width: 1290, height: 2796 },
    slots,
    headlines,
    deviceTypes,
    platform: platforms.size === 1 ? ([...platforms][0] as DevicePlatform) : platforms.size === 0 ? 'neutral' : 'mixed',
    deviceCategory:
      categories.size === 1 ? ([...categories][0] as DeviceCategory) : categories.size === 0 ? 'custom' : 'mixed',
    cost3d,
    cost3dFirstBoard,
    hasVideo,
    luminance,
    isDark: luminance < 0.45,
    backgroundColors,
    keywords: keywordsOf(project),
  };
}

export function buildTemplateIndex(projects: Project[]): Map<string, TemplateIndexEntry> {
  const index = new Map<string, TemplateIndexEntry>();
  for (const project of projects) {
    if (!project.projectData?.length) continue;
    index.set(project.id, indexTemplate(project));
  }
  return index;
}

/** What the user actually uploaded, reduced to the facts that drive ranking. */
export interface IntakeProfile {
  count: number;
  /** The device most of the shots came from. */
  device: DeviceType;
  category: DeviceCategory;
  platform: DevicePlatform;
  isDark: boolean;
  /** Colours pulled out of the shots, best first. */
  palette: string[];
  /** Free-text the user typed, if any. Matched against template keywords. */
  query?: string;
}

/** Enough colour in it to be worth matching on. */
function isVivid(hex: string): boolean {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 40) return false; // grey, white, black
  const light = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return light > 0.08 && light < 0.94;
}

/** Distance between two colours in plain RGB, normalised to 0 to 1. */
function colorDistance(a: string, b: string): number {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  if (!x || !y) return 1;
  const d = Math.sqrt((x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2);
  return Math.min(1, d / 441.673);
}

export interface TemplateScore {
  entry: TemplateIndexEntry;
  score: number;
  /** Short, user-facing reasons this template came up, best first. */
  reasons: string[];
  /** How many of the user's screenshots this template can actually hold. */
  fits: number;
}

/**
 * Rank one template against an upload set.
 *
 * The weights are deliberately blunt and readable rather than tuned: a template
 * that cannot hold the screenshots is useless no matter how pretty, a template
 * built for the wrong device is close behind, and only then do colour and mood
 * get a vote. Scores land in roughly 0 to 100.
 */
export function scoreTemplate(entry: TemplateIndexEntry, profile: IntakeProfile): TemplateScore {
  const reasons: string[] = [];
  const slotCount = entry.slots.length;
  const fits = Math.min(slotCount, profile.count);

  // 1. Capacity, worth up to 45. A template with no device frames at all cannot
  //    take a screenshot, so it scores zero and never reaches the results grid.
  if (slotCount === 0) {
    return { entry, score: 0, reasons: [], fits: 0 };
  }
  let score = 0;
  const surplus = slotCount - profile.count;
  if (surplus === 0) {
    score += 45;
    reasons.push(`Holds all ${profile.count}`);
  } else if (surplus > 0) {
    score += Math.max(18, 45 - surplus * 7);
    if (surplus <= 2) reasons.push(`Room for ${slotCount}`);
  } else {
    // Too small: the leftovers would be dropped, so this is the harsher penalty.
    score += Math.max(6, 45 + surplus * 11);
    reasons.push(`Fits ${slotCount} of ${profile.count}`);
  }

  // 2. Device match, worth up to 30.
  if (entry.deviceTypes.includes(profile.device)) {
    score += 30;
    reasons.push(`Built for ${DEVICE_REGISTRY[profile.device]?.label ?? profile.device}`);
  } else if (entry.deviceCategory === profile.category) {
    score += 20;
    reasons.push(`${profile.category === 'phone' ? 'Phone' : DEVICE_REGISTRY[profile.device]?.label ?? 'Device'} sized`);
  } else if (entry.deviceCategory === 'mixed') {
    score += 10;
  } else {
    // A watch template holding phone screenshots is a different product.
    score -= 25;
  }
  if (entry.platform !== 'mixed' && entry.platform !== 'neutral' && entry.platform === profile.platform) {
    score += 5;
  }

  // 3. Mood, worth up to 12. A dark app in a dark layout reads as one design;
  //    a dark app on a white board reads as a mistake.
  if (entry.isDark === profile.isDark) {
    score += 12;
    if (profile.isDark) reasons.push('Dark layout');
  } else {
    score += 2;
  }

  // 4. Colour affinity, worth up to 13. Closeness to ANY of the user's colours,
  //    because a screenshot's accent matching the board is the moment the whole
  //    thing looks intentional.
  //
  //    Only colours with real saturation get a vote. Almost every screenshot
  //    yields a near-white and a near-black, and those two match every light
  //    and every dark template in the catalog, so leaving them in ranks the
  //    entire library at once and says nothing.
  const vividPalette = profile.palette.filter(isVivid).slice(0, 3);
  if (vividPalette.length > 0 && entry.backgroundColors.length > 0) {
    let best = 1;
    for (const wanted of vividPalette) {
      for (const background of entry.backgroundColors) {
        best = Math.min(best, colorDistance(wanted, background));
      }
    }
    score += (1 - best) * 13;
    if (best < 0.22) reasons.push('Colours match');
  }

  // 5. Typed query, worth up to 60, which is deliberately more than device and
  //    mood put together. Somebody who types "meditation" has told us more
  //    about what they want than every derived signal here, and a ranking that
  //    answers with the best-fitting banking layout has ignored them. A name
  //    hit counts double: template names are chosen, descriptions are prose.
  const query = profile.query?.trim().toLowerCase();
  if (query) {
    const terms = query.match(/[a-z][a-z0-9+]{1,}/g) ?? [];
    let hits = 0;
    for (const term of terms) {
      if (entry.name.toLowerCase().includes(term)) hits += 2;
      else if (entry.keywords.some((word) => word.startsWith(term))) hits += 1;
    }
    if (terms.length > 0) {
      const ratio = Math.min(1, hits / (terms.length * 1.5));
      score += ratio * 60;
      if (ratio >= 0.45) reasons.unshift('Matches your words');
    }
  }

  return { entry, score: Math.max(0, score), reasons: reasons.slice(0, 3), fits };
}

/**
 * Every template that can hold at least one screenshot, best first.
 * Ties break on the shorter template, so the tightest fit wins a coin toss.
 */
export function rankTemplates(
  index: Map<string, TemplateIndexEntry> | TemplateIndexEntry[],
  profile: IntakeProfile
): TemplateScore[] {
  const entries = Array.isArray(index) ? index : [...index.values()];
  return entries
    .map((entry) => scoreTemplate(entry, profile))
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.slots.length - b.entry.slots.length);
}

/**
 * Reduce an upload set to the facts that drive ranking.
 *
 * Kept here rather than inline in the screen so the deck, a drop onto the
 * canvas, and anything added later all ask the same question the same way. The
 * device is a majority vote, because a set of five phone captures with one
 * stray tablet shot is still a phone project.
 */
export function buildIntakeProfile(
  shots: Array<{ analysis: { device: DeviceType; isDark: boolean; palette: string[] } }>,
  options: { query?: string; fallbackCount?: number } = {}
): IntakeProfile {
  const votes = new Map<DeviceType, number>();
  let dark = 0;
  for (const shot of shots) {
    votes.set(shot.analysis.device, (votes.get(shot.analysis.device) ?? 0) + 1);
    if (shot.analysis.isDark) dark++;
  }

  let device: DeviceType = shots[0]?.analysis.device ?? 'iphone-15';
  let best = 0;
  for (const [id, count] of votes) {
    if (count > best) {
      best = count;
      device = id;
    }
  }

  const descriptor = DEVICE_REGISTRY[device];
  const palette: string[] = [];
  const seen = new Set<string>();
  const depth = Math.max(0, ...shots.map((shot) => shot.analysis.palette.length));
  for (let rank = 0; rank < depth && palette.length < 6; rank++) {
    for (const shot of shots) {
      const hex = shot.analysis.palette[rank];
      if (!hex || seen.has(hex)) continue;
      seen.add(hex);
      palette.push(hex);
      if (palette.length >= 6) break;
    }
  }

  return {
    // Nothing uploaded yet still has to produce a sensible deck, and a set of
    // one would rank every single slot feature graphic above the phone layouts
    // most people came for. Five is what the catalog is built around: 72 of its
    // 101 designs have exactly five boards.
    count: shots.length > 0 ? shots.length : (options.fallbackCount ?? 5),
    device,
    category: descriptor?.category ?? 'phone',
    platform: descriptor?.platform ?? 'neutral',
    isDark: shots.length > 0 && dark * 2 > shots.length,
    palette,
    query: options.query?.trim() || undefined,
  };
}

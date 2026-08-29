/**
 * The store rule set: what App Store Connect and Google Play accept.
 *
 * Almost nothing here is a number. The app already owns every store table it
 * uploads against, and scripts/build.mjs resolves `@` to the repo's src/ for
 * exactly this reason, so the tables are IMPORTED rather than copied. A size
 * Apple adds to src/lib/publish/storeTargets.ts is a size `osg verify` accepts
 * on the next build, with no second edit and no chance of the CLI passing a
 * file the app's own publish path would refuse.
 *
 * Imported, and therefore never restated below:
 *   APPLE_DISPLAY_TARGETS   the exact pixel sizes each ScreenshotDisplayType
 *                           takes, and whether it also takes them rotated
 *   appleTargetForSize      the same table's own matcher
 *   nearestAppleSizes       the same table's own "did you mean" hint
 *   validatePlayImage       Play's 320 to 3840 px and 2:1 bounds
 *   suggestPlayImageType    which Play slot a size belongs to
 *   PLAY_IMAGE_TARGETS      the fixed-size slots and how many Play keeps
 *   CANVAS_SIZE_PRESET_GROUPS  which tiers the canvas marks `required: true`
 *
 * Four things could not be imported and are stated here with their source:
 * two module-private or transport-coupled constants, Play's "at least 2" and
 * the feature graphic's opacity, all marked below. Everything stated carries a
 * source URL, and VERIFIED_ON says when it was last checked against it.
 *
 * Apple:
 *   https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/
 *   https://developer.apple.com/help/app-store-connect/reference/app-preview-specifications/
 * Google:
 *   https://support.google.com/googleplay/android-developer/answer/9866151
 */
import {
  APPLE_DISPLAY_TARGETS,
  PLAY_IMAGE_TARGETS,
  appleTargetForSize,
  nearestAppleSizes,
  suggestPlayImageType,
  validatePlayImage,
} from '@/lib/publish/storeTargets';
import { CANVAS_SIZE_PRESET_GROUPS } from '@/lib/sizePresets';
import type { PngInfo } from './png.js';
import { PNG_COLOR_TYPES } from './png.js';
import type { Mp4Info } from './mp4.js';

/** The day every stated number below was last checked against its source. */
export const VERIFIED_ON = '2026-08-28';

export type RuleLevel = 'ok' | 'warn' | 'fail';

export interface Finding {
  level: RuleLevel;
  /** Stable and greppable, so an agent can switch on it instead of on prose. */
  code: string;
  message: string;
}

export type StoreId = 'appstore' | 'play';

export interface AcceptedSize {
  width: number;
  height: number;
  /** The tier this size belongs to, for the message. */
  label: string;
  /** True when the store takes the same size rotated (iPhone and iPad only). */
  rotatable: boolean;
  /** The store will not publish without at least one asset of this tier. */
  required: boolean;
}

/** A slot that is one exact size and nothing else, like the Play feature graphic. */
export interface FixedSlot {
  slot: string;
  label: string;
  width: number;
  height: number;
  requireOpaque: boolean;
}

export interface PngRules {
  /**
   * How a size is judged. 'apple-table' is an exact match against
   * APPLE_DISPLAY_TARGETS; 'play-bounds' defers to validatePlayImage, which
   * owns Play's minimum, maximum and aspect numbers.
   */
  sizing: 'apple-table' | 'play-bounds';
  /** The table behind 'apple-table'. Empty under 'play-bounds', which has none. */
  acceptedSizes: AcceptedSize[];
  fixedSlots: FixedSlot[];
  /** 'reject' means an alpha channel fails the upload even when fully opaque. */
  alpha: 'reject' | 'allow';
  maxBytes: number | null;
  /** Bit depths that upload cleanly. Anything else is a warning, not a failure. */
  bitDepths: number[];
  maxPerSet: number;
  minPerSet: number;
}

export interface Mp4Rules {
  acceptedSizes: AcceptedSize[];
  /** Sample entry four character codes the store accepts. */
  codecs: string[];
  maxFps: number;
  minSeconds: number;
  maxSeconds: number;
  /** True when a file with no audio track is rejected. See videoExport.ts. */
  requireAudioTrack: boolean;
  maxPerSet: number;
}

export interface StoreRuleset {
  id: StoreId;
  label: string;
  png: PngRules;
  /** Null when the store takes no video file at all. Play takes a YouTube URL. */
  mp4: Mp4Rules | null;
}

/**
 * Tolerances, so a correctly produced file never fails on arithmetic. fps comes
 * out of a sample table as a ratio, so a 30 fps export can read 29.97, and a
 * duration computed from a timescale lands a frame either side of round.
 */
const FPS_TOLERANCE = 0.5;
const SECONDS_TOLERANCE = 0.5;

const key = (width: number, height: number) => `${width}x${height}`;
const size = (width: number, height: number) => `${width}x${height}`;

function presetsInGroups(prefix: string) {
  return CANVAS_SIZE_PRESET_GROUPS.filter((group) => group.key.startsWith(prefix)).flatMap(
    (group) => group.presets
  );
}

/**
 * The canvas tiers a store will not publish without, keyed by size. `required`
 * lives on the canvas presets rather than on the upload table, because it is a
 * statement about the listing, not about one file.
 */
const REQUIRED_APPSTORE_SIZES = new Set(
  presetsInGroups('appstore-')
    .filter((preset) => preset.required)
    .map((preset) => key(preset.width, preset.height))
);

/**
 * Every App Store screenshot size, flattened out of the upload table so a
 * caller can list them (`osg verify --json`, `osg doctor`) without reaching
 * into the app itself. The matching is still done by the app's own
 * appleTargetForSize, which knows about rotation.
 */
const APPSTORE_SCREENSHOT_SIZES: AcceptedSize[] = APPLE_DISPLAY_TARGETS.flatMap((target) =>
  target.sizes.map((entry) => ({
    width: entry.width,
    height: entry.height,
    label: target.label,
    rotatable: target.allowRotated,
    required: REQUIRED_APPSTORE_SIZES.has(key(entry.width, entry.height)),
  }))
);

/**
 * Sizes the canvas offers as required App Store tiers that the upload table
 * does not list. Today that is the 422x514 Apple Watch Ultra 3 board:
 * sizePresets.ts marks it the required watch baseline, storeTargets.ts still
 * only lists 410x502 for APP_WATCH_ULTRA. Failing a board the editor itself
 * hands you as "required" would be the wrong call, so it warns instead, and the
 * set empties itself the day the two files agree.
 */
const APPSTORE_PRESET_ONLY_SIZES = new Set(
  presetsInGroups('appstore-')
    .filter((preset) => preset.required && !appleTargetForSize(preset.width, preset.height))
    .map((preset) => key(preset.width, preset.height))
);

/**
 * App preview video sizes, from the canvas group that exists to hold them.
 * Each orientation is its own preset, so nothing here rotates.
 */
const APPSTORE_PREVIEW_SIZES: AcceptedSize[] = presetsInGroups('appstore-previews').map((preset) => ({
  width: preset.width,
  height: preset.height,
  label: preset.label,
  rotatable: false,
  required: !!preset.required,
}));

const PLAY_FIXED_SLOTS: FixedSlot[] = PLAY_IMAGE_TARGETS.filter((target) => target.exactSize).map(
  (target) => ({
    slot: target.imageType,
    label: target.label,
    width: target.exactSize!.width,
    height: target.exactSize!.height,
    // Stated, not imported: sizePresets.ts says of play-feature-graphic
    // "must be exactly 1024x500, no transparency", and that note is prose.
    // https://support.google.com/googleplay/android-developer/answer/9866151
    requireOpaque: target.imageType === 'featureGraphic',
  })
);

const PLAY_SCREENSHOT_SLOT = PLAY_IMAGE_TARGETS.find(
  (target) => target.imageType === 'phoneScreenshots'
);

export const APPSTORE_RULES: StoreRuleset = {
  id: 'appstore',
  label: 'App Store',
  png: {
    sizing: 'apple-table',
    acceptedSizes: APPSTORE_SCREENSHOT_SIZES,
    fixedSlots: [],
    // "Images can't contain alpha channels or transparencies", even where every
    // pixel is opaque. src/lib/pngOpaque.ts exists only to satisfy this, and it
    // exists because both Chromium and WebKit write colour type 6 from a canvas.
    alpha: 'reject',
    maxBytes: null,
    bitDepths: [8],
    // Stated, not imported: MAX_SCREENSHOTS_PER_SET in
    // src/lib/publish/appStoreConnect.ts, which cannot be imported here without
    // pulling the desktop-only account transport into a node bundle. Apple
    // rejects the eleventh at reservation time, before a byte is uploaded.
    maxPerSet: 10,
    minPerSet: 1,
  },
  mp4: {
    acceptedSizes: APPSTORE_PREVIEW_SIZES,
    // H264_CODEC_CANDIDATES in src/lib/video/videoExport.ts are all avc1
    // profiles. avc3 is the same codec with in-band parameter sets.
    codecs: ['avc1', 'avc3'],
    // AppPreviewExportDialog.tsx offers 30 and 60; only 30 is a preview Apple
    // takes, the 60 fps option is there for the styled cut that goes elsewhere.
    maxFps: 30,
    // AppPreviewExportDialog.tsx, verbatim: "Apple requires 15 to 30 seconds.
    // Shorter is fine for ads and socials, but App Store Connect will reject it."
    minSeconds: 15,
    maxSeconds: 30,
    requireAudioTrack: true,
    // AppPreviewExportDialog.tsx: "Apple accepts up to 3 previews per device size."
    maxPerSet: 3,
  },
};

export const PLAY_RULES: StoreRuleset = {
  id: 'play',
  label: 'Google Play',
  png: {
    sizing: 'play-bounds',
    acceptedSizes: [],
    fixedSlots: PLAY_FIXED_SLOTS,
    alpha: 'allow',
    // Stated, not imported: MAX_PLAY_IMAGE_BYTES in
    // src/lib/publish/googlePlay.ts is module-private.
    // https://support.google.com/googleplay/android-developer/answer/9866151
    maxBytes: 8 * 1024 * 1024,
    bitDepths: [8],
    maxPerSet: PLAY_SCREENSHOT_SLOT?.max ?? 8,
    // Stated, not imported: the phoneScreenshots slot's note is "At least 2
    // required", and a note is prose.
    minPerSet: 2,
  },
  // Play has no video upload. A listing links a YouTube URL instead, which is
  // why src/lib/publish/googlePlay.ts uploads images and nothing else.
  mp4: null,
};

export const RULESETS: Record<StoreId, StoreRuleset> = {
  appstore: APPSTORE_RULES,
  play: PLAY_RULES,
};

/** The ruleset for a config's `store`, defaulting the way config.ts does. */
export function rulesetFor(store: string | undefined): StoreRuleset {
  return store === 'play' ? PLAY_RULES : APPSTORE_RULES;
}

// --- Checks -----------------------------------------------------------------

function matchSize(width: number, height: number, sizes: AcceptedSize[]): AcceptedSize | null {
  for (const accepted of sizes) {
    if (accepted.width === width && accepted.height === height) return accepted;
    if (accepted.rotatable && accepted.width === height && accepted.height === width) return accepted;
  }
  return null;
}

/**
 * The two closest sizes by aspect ratio, for a "did you mean" hint. The App
 * Store screenshot table has nearestAppleSizes for this; app preview sizes have
 * no equivalent in the app, so this covers them.
 */
export function nearestAcceptedSizes(width: number, height: number, sizes: AcceptedSize[]): string {
  if (!sizes.length || !height) return '';
  const ratio = width / height;
  return sizes
    .map((accepted) => ({
      accepted,
      distance: Math.abs(accepted.width / accepted.height - ratio),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 2)
    .map(({ accepted }) => `${size(accepted.width, accepted.height)} (${accepted.label})`)
    .join(' or ');
}

/**
 * Findings for one rendered PNG. Always returns at least one row, an 'ok' when
 * nothing is wrong, so `--json` has a line per file and a caller can count
 * levels rather than special case an empty array.
 */
export function checkPng(info: PngInfo, ruleset: StoreRuleset): Finding[] {
  const findings: Finding[] = [];
  const rules = ruleset.png;

  // Play does not tag a slot by size, but its two fixed slots are identified by
  // size and nothing else, so an exact hit is the only way to know a file is a
  // feature graphic and therefore has to be opaque.
  const slot =
    rules.fixedSlots.find((entry) => entry.width === info.width && entry.height === info.height) ??
    null;

  if (rules.sizing === 'apple-table') {
    if (!appleTargetForSize(info.width, info.height)) {
      const preset = APPSTORE_PRESET_ONLY_SIZES.has(key(info.width, info.height));
      findings.push({
        level: preset ? 'warn' : 'fail',
        code: preset ? 'png-size-unlisted' : 'png-size',
        message: preset
          ? `${size(info.width, info.height)} is a required canvas tier that the upload table does not list yet, closest listed: ${nearestAppleSizes(info.width, info.height)}`
          : `${size(info.width, info.height)} is not a size the App Store accepts, closest accepted: ${nearestAppleSizes(info.width, info.height)}`,
      });
    }
  } else {
    // validatePlayImage owns Play's numbers and its wording. Give it the slot
    // the app would have picked, so a 1024x500 file is judged as the feature
    // graphic it is and not as a screenshot with a bad aspect ratio.
    const problem = validatePlayImage(
      info.width,
      info.height,
      slot?.slot ?? suggestPlayImageType(info.width, info.height)
    );
    if (problem) {
      findings.push({
        level: 'fail',
        code: 'png-size',
        message: `${size(info.width, info.height)}: ${problem}`,
      });
    }
  }

  const mustBeOpaque = rules.alpha === 'reject' || !!slot?.requireOpaque;
  if (mustBeOpaque && info.hasAlpha) {
    const kind = PNG_COLOR_TYPES[info.colorType] ?? `colour type ${info.colorType}`;
    findings.push({
      level: 'fail',
      code: 'png-alpha',
      message: slot?.requireOpaque
        ? `a ${slot.label} cannot carry transparency and this one is ${kind}`
        : `${ruleset.label} rejects a screenshot with an alpha channel and this one is ${kind}, re-export it from the editor`,
    });
  }

  if (rules.maxBytes !== null && info.bytes > rules.maxBytes) {
    const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MB`;
    findings.push({
      level: 'fail',
      code: 'png-bytes',
      message: `${mb(info.bytes)} is over ${ruleset.label}'s ${mb(rules.maxBytes)} cap for one image`,
    });
  }

  if (!rules.bitDepths.includes(info.bitDepth)) {
    findings.push({
      level: 'warn',
      code: 'png-bit-depth',
      message: `${info.bitDepth} bits per sample is unusual for a store upload, the editor writes ${rules.bitDepths.join(' or ')}`,
    });
  }

  if (!findings.length) {
    // Says what the file IS rather than what it is not: a Play app icon passes
    // with an alpha channel, so "no transparency" would be a lie there.
    findings.push({
      level: 'ok',
      code: 'png-ok',
      message: `${size(info.width, info.height)}, ${PNG_COLOR_TYPES[info.colorType] ?? `colour type ${info.colorType}`}, ${ruleset.label} accepts it`,
    });
  }
  return findings;
}

/** Findings for one exported app preview MP4. */
export function checkMp4(info: Mp4Info, ruleset: StoreRuleset): Finding[] {
  const rules = ruleset.mp4;
  if (!rules) {
    return [
      {
        level: 'warn',
        code: 'mp4-not-a-store-asset',
        message: `${ruleset.label} takes a YouTube link rather than a video file, so this MP4 is not part of the listing upload`,
      },
    ];
  }

  const findings: Finding[] = [];

  if (!info.codec) {
    findings.push({ level: 'fail', code: 'mp4-no-video', message: 'this file has no video track' });
  } else if (!rules.codecs.includes(info.codec)) {
    findings.push({
      level: 'fail',
      code: 'mp4-codec',
      message: `${ruleset.label} previews have to be H.264 and this one is ${info.codec}`,
    });
  }

  if (info.width && info.height && !matchSize(info.width, info.height, rules.acceptedSizes)) {
    const nearest = nearestAcceptedSizes(info.width, info.height, rules.acceptedSizes);
    findings.push({
      level: 'fail',
      code: 'mp4-size',
      message: `${size(info.width, info.height)} is not an app preview size${nearest ? `, closest accepted: ${nearest}` : ''}`,
    });
  }

  if (info.fps > rules.maxFps + FPS_TOLERANCE) {
    findings.push({
      level: 'fail',
      code: 'mp4-fps',
      message: `${info.fps} fps is over the ${rules.maxFps} fps ${ruleset.label} accepts, re-export the preview at ${rules.maxFps} fps`,
    });
  } else if (info.fps === 0) {
    findings.push({
      level: 'warn',
      code: 'mp4-fps-unknown',
      message: 'the frame rate could not be read from this file',
    });
  }

  if (info.durationSeconds > 0) {
    if (info.durationSeconds < rules.minSeconds - SECONDS_TOLERANCE) {
      findings.push({
        level: 'fail',
        code: 'mp4-too-short',
        message: `${info.durationSeconds}s is under the ${rules.minSeconds} to ${rules.maxSeconds} seconds ${ruleset.label} requires`,
      });
    } else if (info.durationSeconds > rules.maxSeconds + SECONDS_TOLERANCE) {
      findings.push({
        level: 'fail',
        code: 'mp4-too-long',
        message: `${info.durationSeconds}s is over the ${rules.maxSeconds} second maximum ${ruleset.label} allows`,
      });
    }
  } else {
    findings.push({
      level: 'warn',
      code: 'mp4-duration-unknown',
      message: 'the duration could not be read from this file',
    });
  }

  // The one nobody expects. videoExport.ts muxes silence into every export
  // precisely because App Store Connect reads a missing audio track as a
  // corrupt one, and that mux is skipped without complaint when the browser has
  // no AudioEncoder, which is the likeliest case in a headless render. So this
  // is the defect a CLI render can produce that a desktop export never does.
  if (rules.requireAudioTrack && !info.hasAudioTrack) {
    findings.push({
      level: 'fail',
      code: 'mp4-no-audio',
      message: `${ruleset.label} reads a preview with no audio track as corrupted audio, re-export it in a browser that can encode AAC`,
    });
  }

  if (!findings.length) {
    findings.push({
      level: 'ok',
      code: 'mp4-ok',
      message: `${size(info.width, info.height)}, ${info.fps} fps, ${info.durationSeconds}s, ${info.codecString ?? info.codec}${info.hasAudioTrack ? ', audio track present' : ''}`,
    });
  }
  return findings;
}

/**
 * Count rules, which no single file can answer. `label` names what was counted,
 * so the message reads as a sentence about one set, e.g. 'iPhone 6.9-inch'.
 */
export function checkScreenshotCount(count: number, label: string, ruleset: StoreRuleset): Finding[] {
  const rules = ruleset.png;
  if (count > rules.maxPerSet) {
    return [
      {
        level: 'fail',
        code: 'set-too-many',
        message: `${label} has ${count} screenshots and ${ruleset.label} keeps at most ${rules.maxPerSet} per size`,
      },
    ];
  }
  if (count < rules.minPerSet) {
    return [
      {
        level: 'fail',
        code: 'set-too-few',
        message: `${label} has ${count} screenshots and ${ruleset.label} needs at least ${rules.minPerSet} to publish`,
      },
    ];
  }
  return [{ level: 'ok', code: 'set-ok', message: `${label}: ${count} screenshots` }];
}

/** The same for preview videos. Returns nothing for a store that takes none. */
export function checkPreviewCount(count: number, label: string, ruleset: StoreRuleset): Finding[] {
  const rules = ruleset.mp4;
  if (!rules) return [];
  if (count > rules.maxPerSet) {
    return [
      {
        level: 'fail',
        code: 'preview-too-many',
        message: `${label} has ${count} previews and ${ruleset.label} keeps at most ${rules.maxPerSet} per size`,
      },
    ];
  }
  return [{ level: 'ok', code: 'preview-ok', message: `${label}: ${count} previews` }];
}

/** The worst level in a run of findings, which is what an exit code turns on. */
export function worstLevel(findings: Finding[]): RuleLevel {
  if (findings.some((finding) => finding.level === 'fail')) return 'fail';
  if (findings.some((finding) => finding.level === 'warn')) return 'warn';
  return 'ok';
}

/**
 * What App Review and an iPhone screen would say about a creative artboard,
 * before anything is uploaded.
 *
 * The rules are App Review guideline 2.3.14 and the "General policies" on
 * Apple's asset best practices page: no specific or discounted prices, no web
 * addresses, no copyright symbols, no Apple recognitions, nothing about other
 * platforms or stores, no claims Apple cannot verify, and short text. Three more
 * come from the placement itself: keep text inside the art safe area, out from
 * under the back and share buttons iOS floats over a header, and big enough to
 * read at the size an iPhone shows it. Two more are the canvas's own: every
 * line has to fit inside its text box, and screens that all sit inside the
 * safe area make a design that looks small on a phone.
 *
 * Text is matched with patterns, so this is a lint and not a verdict: it can
 * miss a price written out in words, and "sale" in an app about garage sales
 * is a false alarm. That is why the softer rules are warnings. App Review has
 * the last word either way.
 *
 * Text that runs out of its box is measured the way textFit.ts measures it,
 * because TextElement clips at the box. Without a DOM (a unit test, a script)
 * the line count is estimated instead, by typeFit.ts, the way the designs
 * estimate theirs. Nothing else here reads the page, so a board can be checked
 * on every render.
 */

import type { ArtboardElement, ArtboardState, TextElementProps } from '@/types/artboard';
import { projectArtboards } from '@/lib/i18n/project';
import { getBaseLocale, getProjectLocales, localizableTextElements } from '@/lib/i18n/localization';
import { localeName } from '@/lib/i18n/locales';
import { onFontsSettled } from '@/lib/fontsSettled';
import { measureTextHeight } from '@/lib/textFit';
import { estimatedHeight } from './typeFit';
import {
  acceptsSize,
  creativeSpec,
  iphoneAreaFor,
  iphoneHeaderButtonsFor,
  iphonePointsPerPixel,
  isCreativeAssetKind,
  MIN_READABLE_POINTS,
  safeAreaFor,
  type PixelRect,
} from './specs';

export type CreativeIssueLevel = 'error' | 'warning';

export interface CreativeIssue {
  /** Stable across renders, for React keys. */
  key: string;
  /** An error is something App Review rejects. A warning is worth a look. */
  level: CreativeIssueLevel;
  title: string;
  detail?: string;
  elementId?: string;
}

interface TextRule {
  id: string;
  level: CreativeIssueLevel;
  title: string;
  pattern: RegExp;
}

const TEXT_RULES: TextRule[] = [
  {
    id: 'price',
    level: 'error',
    title: 'No prices or discounts',
    pattern:
      /[$€£¥₹₩₽₺]\s?\d|\d(?:[.,]\d{1,2})?\s?(?:[$€£¥₹₩₽₺]|\b(?:usd|eur|gbp)\b)|\b\d{1,3}\s?%\s?off\b|\bpercent off\b|\bhalf price\b/iu,
  },
  {
    // "Ad-free" and "stress free" are fine; "free download" is a price.
    id: 'offer',
    level: 'warning',
    title: 'Reads like a price or an offer',
    pattern:
      /\bfree (?:download|trial|to (?:play|use|download)|forever|for)\b|\bfor free\b|\bdiscounts?\b|\bsales?\b|\bdeals?\b|\bcoupons?\b|\bpromo codes?\b/iu,
  },
  {
    id: 'url',
    level: 'error',
    title: 'No web addresses',
    pattern: /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|net|org|io|app|co|dev|ai|me|gg|tv|xyz|store|shop)\b/iu,
  },
  {
    id: 'copyright',
    level: 'error',
    title: 'No copyright symbols',
    pattern: /©|\(c\)|\bcopyright\b/iu,
  },
  {
    id: 'apple-recognition',
    level: 'error',
    title: 'No Apple recognitions',
    pattern: /editors?['’]?\s*choice|\bapp of the day\b|\bgame of the day\b|\bapple design award|\bapps we love\b|\bfeatured (?:by apple|on the app store|in the app store)/iu,
  },
  {
    id: 'other-platform',
    level: 'error',
    title: 'No other platforms or stores',
    pattern: /\bandroid\b|\bgoogle play\b|\bplay store\b|\bmicrosoft store\b|\bgalaxy store\b|\bappgallery\b|\bamazon appstore\b|\bf-droid\b/iu,
  },
  {
    // Ordinary words too ("clean your windows"), so only worth a look.
    id: 'other-platform-maybe',
    level: 'warning',
    title: 'Mentions another platform',
    pattern: /\bwindows\b|\bsteam\b|\bxbox\b|\bplaystation\b|\bnintendo\b/iu,
  },
  {
    // Rankings, awards, user counts, star ratings, and press logos or "as seen
    // in", none of which a reviewer can check.
    id: 'claim',
    level: 'warning',
    title: 'A claim Apple cannot verify',
    pattern:
      /#\s?1\b|\bno\.?\s?1\b|\bnumber one\b|\bthe best\b|\bbest (?:app|game|tool|way)\b|\bawards?\b|\baward[- ]winning\b|\btop[- ]rated\b|\bmost popular\b|\bworld['’]?s (?:best|first|leading|most)\b|\b\d+(?:[.,]\d+)?\s?(?:k|m|million|thousand)?\+?\s+(?:users|downloads|people|players|reviews)\b|\b[1-5](?:[.,]\d)?\s?(?:★|stars?\b)|\bas seen (?:in|on)\b|\bfeatured in\b|\bforbes\b|\bnew york times\b|\btechcrunch\b|\bthe verge\b|\bwall street journal\b|\bwired\b/iu,
  },
];

/**
 * Copy as one line. A screenshot's headline is often broken mid phrase
 * ("APP OF / THE DAY"), and a rule has to see the phrase.
 */
function flat(content: string): string {
  return content.replace(/\s+/g, ' ');
}

/** More words than this stops being "a short phrase". */
const MAX_WORDS = 10;

/**
 * True when copy would draw a rule from this check: an error, or with
 * `strict`, any warning too. The design builder uses it to pass over a
 * screenshot's "App of the day" badge rather than set it as a tagline.
 */
export function breaksStoreRules(content: string, strict = false): boolean {
  const line = flat(content);
  return TEXT_RULES.some((rule) => (strict || rule.level === 'error') && rule.pattern.test(line));
}

/** Short enough for Apple's "short phrase": what the long-copy rule lets through. */
export function isShortPhrase(content: string): boolean {
  return wordCount(content) <= MAX_WORDS;
}

/** A text element's copy, cut to something that fits a list row. */
function snippet(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  return flat.length > 36 ? `${flat.slice(0, 34).trimEnd()}...` : flat;
}

function overlaps(a: PixelRect, b: PixelRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** True when `inner` sits inside `outer`, with a little slack for rounding. */
function within(inner: PixelRect, outer: PixelRect): boolean {
  const slack = 2;
  return (
    inner.x >= outer.x - slack &&
    inner.y >= outer.y - slack &&
    inner.x + inner.width <= outer.x + outer.width + slack &&
    inner.y + inner.height <= outer.y + outer.height + slack
  );
}

/**
 * The rectangle a layer's box covers on the board once it is turned. The
 * canvas turns an element about its centre, so a box that sits inside the safe
 * area flat can reach outside it at 30 degrees.
 */
export function boundsOf(layer: Pick<ArtboardElement, 'position' | 'size' | 'scale' | 'rotation'>): PixelRect {
  const scale = layer.scale || 1;
  const width = layer.size.width * scale;
  const height = layer.size.height * scale;
  const turn = ((layer.rotation || 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(turn));
  const sin = Math.abs(Math.sin(turn));
  const turnedWidth = width * cos + height * sin;
  const turnedHeight = width * sin + height * cos;
  return {
    x: layer.position.x + (width - turnedWidth) / 2,
    y: layer.position.y + (height - turnedHeight) / 2,
    width: turnedWidth,
    height: turnedHeight,
  };
}

const neededHeights = new Map<string, number>();

// Measured against a fallback face, a line breaks somewhere else. Forget every
// measurement once a font arrives; the chip checks again at the same moment.
onFontsSettled(() => neededHeights.clear());

function neededHeight(text: TextElementProps): number {
  const key = [
    text.content,
    text.fontFamily,
    text.fontWeight,
    text.fontStyle,
    text.fontSize,
    text.lineHeight,
    text.letterSpacing,
    text.size.width,
    text.scale,
  ].join('\u0000');
  const known = neededHeights.get(key);
  if (known !== undefined) return known;
  // measureTextHeight answers in element units, before scale.
  const measured = measureTextHeight(text, text.content) * (text.scale || 1);
  const needed = measured > 0 ? measured : estimatedHeight(text);
  // Every keystroke in a text layer is a new key.
  if (neededHeights.size > 500) neededHeights.clear();
  neededHeights.set(key, needed);
  return needed;
}

function wordCount(content: string): number {
  return content.trim().split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/**
 * One creative artboard as one language shows it. `board` is already projected
 * for `locale` (null for the base language); its `localized` map is still the
 * base board's, which is how a missing translation is told apart from one that
 * happens to read the same.
 */
function checkProjected(board: ArtboardState, locale: string | null, baseLocale: string): CreativeIssue[] {
  if (!isCreativeAssetKind(board.creativeAsset)) return [];
  const spec = creativeSpec(board.creativeAsset);
  const issues: CreativeIssue[] = [];

  if (!acceptsSize(spec.kind, board.size)) {
    issues.push({
      key: 'size',
      level: 'error',
      title: 'Not a size App Store Connect takes',
      detail:
        spec.kind === 'search'
          ? 'Search results art is any 3:2 size from 1920 x 1280 to 3840 x 2560'
          : `${spec.label} art is exactly ${spec.width} x ${spec.height}`,
    });
  }

  const safe = safeAreaFor(board);
  const iphone = iphoneAreaFor(board);
  const buttons = iphoneHeaderButtonsFor(board);
  const pointsPerPixel = iphonePointsPerPixel(board);
  const texts = board.elements.filter(
    (el): el is TextElementProps => el.type === 'text' && !!el.content && el.content.trim().length > 0
  );

  for (const text of texts) {
    const quoted = `"${snippet(text.content)}"`;

    const line = flat(text.content);
    for (const rule of TEXT_RULES) {
      if (rule.pattern.test(line)) {
        issues.push({ key: `${rule.id}:${text.id}`, level: rule.level, title: rule.title, detail: quoted, elementId: text.id });
      }
    }

    if (wordCount(text.content) > MAX_WORDS) {
      issues.push({
        key: `long:${text.id}`,
        level: 'warning',
        title: 'Long for a header or search card',
        detail: `${quoted} has ${wordCount(text.content)} words. Apple asks for a short phrase`,
        elementId: text.id,
      });
    }

    // The box rather than the glyphs, which is what the language overlay keeps
    // the text inside, turned the way the canvas turns it.
    const box = boundsOf(text);
    if (safe && !within(box, safe)) {
      // An iPhone shows far more than the safe area, so most text outside it
      // is only at risk on other devices.
      issues.push({
        key: `safe:${text.id}`,
        level: 'warning',
        title: 'Text outside the safe area',
        detail:
          iphone && within(box, iphone)
            ? `${quoted} shows on an iPhone, but other devices can cut it off`
            : `${quoted} is cut off on an iPhone`,
        elementId: text.id,
      });
    }

    // TextElement clips at its box, so lines past it never show anywhere. A
    // fifth of a line is let through: that much is the gap between lines.
    const shown = text.size.height * (text.scale || 1);
    if (neededHeight(text) > shown + Math.max(2, (text.fontSize / 0.3) * 0.2)) {
      issues.push({
        key: `clipped:${text.id}`,
        level: 'warning',
        title: 'Text cut off by its box',
        detail: `${quoted} needs a taller box or smaller type`,
        elementId: text.id,
      });
    }

    // iOS floats the back and share buttons over the top corners of what an
    // iPhone shows of a header. Both are clear of the safe area, so this is
    // about text that was moved out of it.
    if (buttons.some((button) => overlaps(box, button))) {
      issues.push({
        key: `button:${text.id}`,
        level: 'warning',
        title: 'Under a button on an iPhone',
        detail: `${quoted} sits where iOS puts the back or share button`,
        elementId: text.id,
      });
    }

    if (pointsPerPixel) {
      const points = (text.fontSize / 0.3) * pointsPerPixel;
      if (points < MIN_READABLE_POINTS - 1) {
        issues.push({
          key: `small:${text.id}`,
          level: 'warning',
          title: 'Too small to read on an iPhone',
          detail: `${quoted} shows at about ${Math.max(1, Math.round(points))}pt`,
          elementId: text.id,
        });
      }
    }
  }

  // A design whose screens all sit inside the safe area leaves the rest of
  // what an iPhone shows bare, which is how the first designs of this editor
  // came out (issue #46). The newer ones stand their screens beside the safe
  // area, or under it on a universal image, so they never match this.
  const screens = board.elements.filter((el) => el.type === 'device' || el.type === 'video-device').map(boundsOf);
  if (safe && screens.length > 0) {
    const slack = 2;
    const across = screens.every((box) => box.x >= safe.x - slack && box.x + box.width <= safe.x + safe.width + slack);
    const startsInside = screens.some((box) => box.y >= safe.y - slack && box.y < safe.y + safe.height);
    if (across && startsInside) {
      issues.push({
        key: 'screens',
        level: 'warning',
        title: 'Looks small on an iPhone',
        detail:
          screens.length === 1
            ? 'The screen sits inside the safe area. An iPhone shows much more, so there is empty space around the design'
            : 'Every screen sits inside the safe area. An iPhone shows much more, so there is empty space around the design',
      });
    }
  }

  // A language that has nothing of its own for a text layer shows the base
  // language's words.
  if (locale && locale !== baseLocale) {
    const own = board.localized?.[locale] ?? {};
    const missing = localizableTextElements(board).filter((el) => !own[el.id]?.content?.trim());
    if (missing.length > 0) {
      issues.push({
        key: `untranslated:${locale}`,
        level: 'warning',
        title: `Not translated into ${localeName(locale)}`,
        detail:
          missing.length === 1
            ? `${`"${snippet(missing[0].content)}"`} shows in ${localeName(baseLocale)}`
            : `${missing.length} text layers show in ${localeName(baseLocale)}`,
      });
    }
  }

  return issues.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
}

export interface LanguageCheck {
  /** null is the base language. */
  locale: string | null;
  label: string;
  issues: CreativeIssue[];
}

/**
 * One creative artboard, checked in every language the project has, base
 * first. A project with no languages gets one entry.
 */
export function checkCreativeBoard(base: ArtboardState[], boardId: string): LanguageCheck[] {
  const baseBoard = base.find((board) => board.id === boardId);
  if (!baseBoard || !isCreativeAssetKind(baseBoard.creativeAsset)) return [];
  const baseLocale = getBaseLocale(base);
  const locales: (string | null)[] = [null, ...getProjectLocales(base).map((entry) => entry.code)];
  return locales.map((locale) => {
    const projected = locale ? projectArtboards(base, locale).find((board) => board.id === boardId) ?? baseBoard : baseBoard;
    return {
      locale,
      label: localeName(locale ?? baseLocale),
      issues: checkProjected(projected, locale, baseLocale),
    };
  });
}

/**
 * The artboard the canvas is drawing, already in the language on screen. It
 * carries its project's language list (mirrored onto every artboard), so the
 * canvas can check it without the rest of the project.
 */
export function checkCreativeView(board: ArtboardState, locale: string | null): CreativeIssue[] {
  if (!isCreativeAssetKind(board.creativeAsset)) return [];
  return checkProjected(board, locale, getBaseLocale([board]));
}

/** Errors and warnings across every language, for a badge. */
export function countIssues(checks: LanguageCheck[]): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const check of checks) {
    for (const issue of check.issues) {
      if (issue.level === 'error') errors += 1;
      else warnings += 1;
    }
  }
  return { errors, warnings };
}

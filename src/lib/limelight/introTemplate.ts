/**
 * The App intro: Limelight's opening film for an app. This is its first
 * tone, a dark stage lit by the app's own colour; more tones are more
 * `IntroTone`s.
 *
 * Fifteen seconds, eight bars at 128 beats a minute, every cut on a bar:
 *
 *   0 to 1.9     the hook: the app's name comes in huge, letter by letter,
 *                and the phone sweeps up in front of it, its first screen on
 *   1.9 to 8.9   three features, each a new angle cut on the beat, a new
 *                screen sliding in and that screen's own headline rising in
 *                over the phone, its last words in the app's colour
 *   8.9 to 11.3  the camera pulls back as two more phones slide in beside
 *                the first, so the app shows three screens at once
 *   11.3 to 15   the phones fall away and the app's icon pops in as a glossy
 *                tile, with the name and where to get the app under it
 *
 * Every word is the project's own: the captions are its headlines
 * (artboardHeadline in projectShots.ts), the glow its colour, the words its
 * font, the tile its icon. Every shot is framed for the video's shape by
 * measuring what it shows, so a tall story, a square post and a wide film
 * all fill their frame.
 *
 * Templates.ts loads this file only when the template is used, so none of it
 * comes with the editor.
 */

import type { DeviceType } from '@/types/artboard';
import { DEVICE_REGISTRY } from '@/lib/deviceRegistry';
import type { FoundCard } from './cards';
import { cameraToFitPoints, freeName, stagePoints, titleBox, turnPoint } from './edit';
import { loadTitleFaces } from './fonts';
import { stageModelFor } from './models';
import { DEFAULT_LIFT, defaultFormat, defaultLook, deviceHeight, deviceWidth, newDeviceActor, newId, newPictureActor, newScene, newShot, newTextActor, normalizeScene } from './scene';
import type { TemplateInput } from './templates';
import type {
  ActorPose,
  CameraShot,
  CameraState,
  DeviceActor,
  LimelightActor,
  LimelightBackdrop,
  LimelightEase,
  LimelightEnvironment,
  LimelightLight,
  LimelightScene,
  PictureActor,
  ScreenChange,
  ScreenTransition,
  TextActor,
  TextReveal,
  Turn,
  XYZ,
} from './types';

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function toHsl(hex: string | undefined): Hsl | null {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  return { h, s, l };
}

function hex({ h, s, l }: Hsl): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return `#${[f(0), f(8), f(4)].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * A hue that stays clean as a light in the dark. Yellows and yellow greens go
 * brown and olive when they are dim, so they lean to the amber or the green
 * beside them; every other hue is kept.
 */
function glowHue(h: number): number {
  if (h >= 35 && h < 80) return h + (24 - h) * 0.6;
  if (h >= 80 && h < 120) return h + (135 - h) * 0.7;
  return h;
}

/** Indigo, for a project without a colour of its own. */
const NO_ACCENT: Hsl = { h: 232, s: 0.8, l: 0.6 };

// ---------------------------------------------------------------------------
// Tones
// ---------------------------------------------------------------------------

/** One look the intro can take: its stage, its light and its words' colours. */
export interface IntroTone {
  id: string;
  environment: LimelightEnvironment;
  /** The backdrop, from the project's colour when it has one. */
  backdrop: (accent: Hsl | null) => LimelightBackdrop;
  light: LimelightLight;
  exposure: number;
  shadow: number;
  vignette: number;
  grain: number;
  /** The camera's handheld wobble, 0 to 1. */
  shake: number;
  /** For a project whose font the app doesn't ship. */
  font: string;
  title: string;
  caption: string;
  /** A caption's last words, in the app's colour. */
  highlight: (accent: Hsl | null) => string;
  small: string;
}

/** Dark, lit by soft lights in the app's colour that drift as the camera moves. */
export const CINEMATIC: IntroTone = {
  id: 'cinematic',
  environment: 'night',
  backdrop: (accent) => {
    const { h, s } = accent && accent.s > 0.12 ? accent : NO_ACCENT;
    const hue = glowHue(h);
    return { style: 'glow', top: hex({ h: hue, s: Math.min(0.85, Math.max(0.6, s)), l: 0.3 }), bottom: hex({ h: hue, s: 0.3, l: 0.025 }) };
  },
  light: { azimuth: -38, elevation: 34, intensity: 1.1 },
  exposure: 1.05,
  shadow: 0.55,
  vignette: 0.32,
  grain: 0.05,
  shake: 0.06,
  font: 'Plus Jakarta Sans',
  title: '#ffffff',
  caption: '#ffffff',
  highlight: (accent) => {
    const { h } = accent && accent.s > 0.12 ? accent : NO_ACCENT;
    return hex({ h: glowHue(h), s: 0.9, l: 0.72 });
  },
  small: '#c3c9d6',
};

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/**
 * Breaks a caption into as few lines of at most `maxChars` as it can (three
 * at most), as even as they can be, the way a designer sets a headline:
 * "Manage budget / without stress" rather than a long line and a short one.
 */
export function balanceLines(text: string, maxChars: number): string {
  const words = text.split(' ').filter(Boolean);
  if (text.length <= maxChars || words.length < 2) return text;
  let best = text;
  let bestScore = Infinity;
  const n = words.length;
  const score = (lines: string[]) => {
    const lengths = lines.map((line) => line.length);
    const longest = Math.max(...lengths);
    // A line past the limit loses to any that keep to it; then fewer lines win; then the evenest.
    return (longest > maxChars ? 1000 + (longest - maxChars) * 100 : 0) + lines.length * maxChars * 0.5 + longest - Math.min(...lengths);
  };
  for (let a = 1; a < n; a++) {
    const two = [words.slice(0, a).join(' '), words.slice(a).join(' ')];
    if (score(two) < bestScore) {
      bestScore = score(two);
      best = two.join('\n');
    }
    for (let b = a + 1; b < n; b++) {
      const three = [words.slice(0, a).join(' '), words.slice(a, b).join(' '), words.slice(b).join(' ')];
      if (score(three) < bestScore) {
        bestScore = score(three);
        best = three.join('\n');
      }
    }
  }
  return best;
}

/**
 * How many of a caption's last words take the app's colour: its last line
 * when it has two or more, its last word when it is one line of three words
 * or more, none for a word or two.
 */
export function highlightedWords(text: string): number {
  const lines = text.split('\n');
  const count = (line: string) => line.split(/\s+/).filter(Boolean).length;
  if (lines.length > 1) return count(lines[lines.length - 1]);
  return count(text) >= 3 ? 1 : 0;
}

/** Where to get the app, for the closing title. A store preview leaves it out: the store is where it plays. */
function storeLine(device: DeviceType, preset: string | undefined): string | null {
  if (preset?.startsWith('app-store')) return null;
  return DEVICE_REGISTRY[device]?.platform === 'android' ? 'Get it on Google Play' : 'Available on the App Store';
}

/**
 * Where a card of the screen's picture lies on the phone: its middle in
 * centimetres from the phone's middle, on the glass, and its size. The
 * picture covers the display the way the stage lays it, scaled up until it
 * fills it with the overflow cut evenly, and the card is clipped to what
 * shows. Null for a model without a display or a card that doesn't show.
 */
export function cardOnScreen(device: DeviceType, card: FoundCard): { x: number; y: number; z: number; width: number; height: number } | null {
  const model = stageModelFor(device);
  if (!model?.display || !(card.aspect > 0)) return null;
  const dw = model.display.width / 10;
  const dh = model.display.height / 10;
  const k = Math.max(dw / card.aspect, dh);
  const shownW = card.aspect * k;
  const shownH = k;
  const x0 = Math.max(-dw / 2, -shownW / 2 + card.crop.x * shownW);
  const x1 = Math.min(dw / 2, -shownW / 2 + (card.crop.x + card.crop.width) * shownW);
  const y0 = Math.min(dh / 2, shownH / 2 - card.crop.y * shownH);
  const y1 = Math.max(-dh / 2, shownH / 2 - (card.crop.y + card.crop.height) * shownH);
  if (x1 - x0 < 0.5 || y0 - y1 < 0.5) return null;
  // The display is centred down the phone unless the bezel over it differs from the one under it.
  const middle = model.display.top !== undefined ? (model.height / 2 - model.display.top - model.display.height / 2) / 10 : 0;
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 + middle, z: model.thickness / 20 + 0.02, width: x1 - x0, height: y0 - y1 };
}

/** A light finish for the phone, which stands out on a dark stage; unset keeps the model's own. */
function lightFinish(device: DeviceType): string | undefined {
  const finishes = stageModelFor(device)?.finishes ?? [];
  return finishes.find((finish) => /silver|white|cloud|frost|porcelain/i.test(`${finish.id} ${finish.label}`))?.id;
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

function pose(time: number, position: XYZ, turn: Turn, ease: LimelightEase, opacity = 1, scale = 1): ActorPose {
  return { id: newId('pose'), time, ease, position: { ...position }, turn: { ...turn }, scale, opacity };
}

const STILL: Turn = { yaw: 0, pitch: 0, roll: 0 };

interface TitleSpec {
  text: string;
  at: XYZ;
  size: number;
  weight: number;
  color: string;
  font: string;
  align: TextActor['align'];
  reveal: TextReveal;
  /** When it starts to lift away and fade; unset, it stays to the end. */
  out?: number;
}

function title(spec: TitleSpec): TextActor {
  const actor = newTextActor(spec.text, spec.at);
  actor.size = spec.size;
  actor.weight = spec.weight;
  actor.color = spec.color;
  actor.font = spec.font;
  actor.align = spec.align;
  actor.facing = 'camera';
  actor.reveal = spec.reveal;
  if (spec.out !== undefined) {
    const lifted = { ...spec.at, y: spec.at.y + spec.size * 1.2 };
    actor.poses = [pose(0, spec.at, STILL, 'smooth'), pose(spec.out, spec.at, STILL, 'smooth'), pose(spec.out + 0.32, lifted, STILL, 'smooth', 0)];
  }
  return actor;
}

/** A reveal of `count` words or letters that takes a little longer the more there are. */
function reveal(style: TextReveal['style'], by: TextReveal['by'], time: number, count: number, perUnit: number, least: number, most: number): TextReveal {
  return { style, by, time, duration: Math.min(most, Math.max(least, perUnit * count)) };
}

// ---------------------------------------------------------------------------
// The film
// ---------------------------------------------------------------------------

/** 128 beats a minute: a bar is 1.875 seconds, and eight of them are the film. */
export const BEAT = 60 / 128;
const BAR = 4 * BEAT;
const DURATION = 8 * BAR;

/** When each part starts, in seconds. */
export const AT = {
  /** The name's first letter starts to rise. */
  name: 0.12,
  /** The phone starts up from below, and is in place. */
  rise: 0.3,
  land: 1.55,
  /** Each feature, on a bar and a quarter. */
  features: [BAR, 2.25 * BAR, 3.5 * BAR],
  /** The other two phones slide in. */
  trio: 4.75 * BAR,
  /** The icon, the name and the store. */
  end: 6 * BAR,
} as const;

/**
 * The App intro in its first tone. Its words are framed by measuring them in
 * their own face, so the faces are loaded first: framed in the fallback, a
 * wide face (Bungee) ran off both sides of the picture.
 */
export async function buildAppIntro(input: TemplateInput): Promise<LimelightScene> {
  const font = input.font || CINEMATIC.font;
  // Every word the intro may set, so a face split by unicode-range loads the pieces for them.
  const text = [input.title?.trim() || 'Your app', ...(input.captions ?? []), 'Available on the App Store', 'Get it on Google Play'].join(' ');
  await loadTitleFaces([500, 800].map((weight) => ({ weight, font, text })));
  return buildIntro(input, CINEMATIC);
}

export function buildIntro(input: TemplateInput, tone: IntroTone): LimelightScene {
  const base = newScene({ format: input.format ?? defaultFormat(), name: input.name });
  const format = { ...base.format, duration: DURATION };
  const aspect = format.width / format.height;
  // A wide video puts the words beside the phone; anything else over it.
  const wide = aspect > 1.2;
  const type: DeviceType = input.device ?? 'iphone-17-pro';
  const h = deviceHeight(type);
  const w = deviceWidth(type);
  const accent = toHsl(input.accent);
  const font = input.font || tone.font;
  const appName = (input.title?.trim() || 'Your app').replace(/\s+/g, ' ').slice(0, 40);
  const pictures = input.pictures.slice(0, 4);
  const captions = AT.features.map((_, k) => (k < pictures.length || (k === 0 && pictures.length === 0) ? input.captions?.[k]?.replace(/\s+/g, ' ').trim() || undefined : undefined));
  const rest: XYZ = { x: 0, y: h / 2 + DEFAULT_LIFT, z: 0 };
  const finish = lightFinish(type);
  const icon = input.icon ?? null;

  // ---- The phones -----------------------------------------------------------

  const phone = newDeviceActor(type, { position: rest });
  if (finish) phone.finish = finish;
  phone.glare = 0.35;
  // A card lifts from exactly where it is on the screen, so a phone with cards keeps still for them.
  const lifts = AT.features.map((_, k) => (pictures[k] && input.cards?.[k] ? cardOnScreen(type, input.cards[k]!) : null));
  phone.motion = { float: lifts.some(Boolean) ? 0 : 0.3, spin: 0 };
  const below = { ...rest, y: rest.y - h * 1.4 };
  const swoop: Turn = { yaw: -58, pitch: 34, roll: -14 };
  const turns = {
    hook: { yaw: -12, pitch: -3, roll: 0 },
    features: [
      { yaw: -21, pitch: -3, roll: 0 },
      { yaw: 18, pitch: -2, roll: 0 },
      { yaw: -8, pitch: 7, roll: 0 },
    ],
    trio: { yaw: 0, pitch: -2, roll: 0 },
  };
  const [f1, f2, f3] = AT.features;
  phone.poses = [
    // Out of the picture until it comes up, so it never shows as a dark blur under the name.
    pose(0, below, swoop, 'cut', 0),
    // Up from below, turning to face the camera: quick, then a long settle.
    pose(AT.rise, below, swoop, 'snappy'),
    pose(AT.land, rest, turns.hook, 'smooth'),
    // On each feature it turns to show another side, quick on the cut.
    pose(f1, rest, turns.hook, 'snappy'),
    pose(f1 + 0.6, rest, turns.features[0], 'smooth'),
    pose(f2, rest, turns.features[0], 'snappy'),
    pose(f2 + 0.6, rest, turns.features[1], 'smooth'),
    pose(f3, rest, turns.features[1], 'snappy'),
    pose(f3 + 0.6, rest, turns.features[2], 'smooth'),
    pose(AT.trio, rest, turns.features[2], 'snappy'),
    pose(AT.trio + 0.7, rest, turns.trio, 'smooth'),
    ...(icon
      ? // Gone on the cut to the icon, with the music's hit.
        [pose(AT.end - 0.001, rest, turns.trio, 'cut'), pose(AT.end, rest, turns.trio, 'cut', 0)]
      : [pose(AT.end, rest, turns.trio, 'snappy'), pose(AT.end + 1, rest, { yaw: 9, pitch: -3, roll: 0 }, 'smooth'), pose(DURATION, rest, { yaw: -3, pitch: -3, roll: 0 }, 'smooth')]),
  ];
  const screens: ScreenChange[] = [];
  const show = (target: ScreenChange[], time: number, media: string | undefined, transition: ScreenTransition, duration: number) => {
    if (media) target.push({ id: newId('screen'), time, media, transition: target.length === 0 ? 'cut' : transition, duration });
  };
  show(screens, 0, pictures[0], 'cut', 0);
  show(screens, f2 + 0.02, pictures[1], 'slide', 0.55);
  show(screens, f3 + 0.02, pictures[2], 'scroll', 0.65);
  // The three together show the fourth in the middle, or the first again.
  if (pictures.length > 1) show(screens, AT.trio + 0.05, pictures[3] ?? pictures[0], 'zoom', 0.6);
  phone.screens = screens;

  /** A phone that slides in beside the first for the three together, and out again for the close. */
  const sidePhone = (sign: 1 | -1, media: string | undefined): DeviceActor => {
    // Behind the first and half hidden by it, a fan rather than a row: the
    // three are about as tall as they are wide, so they fill a tall frame too.
    const at = wide ? { x: sign * w * 1.05, y: rest.y - 0.3, z: -4 } : { x: sign * w * 0.68, y: rest.y + sign * -0.6, z: -6.5 };
    const away = { x: sign * w * 3.6, y: rest.y - 1.2, z: -8 };
    // Turned toward the middle: positive yaw turns the screen to the right.
    const turn = { yaw: -sign * (wide ? 22 : 30), pitch: -2, roll: sign * (wide ? 0 : -4) };
    const actor = newDeviceActor(type, { position: at });
    if (finish) actor.finish = finish;
    actor.glare = 0.3;
    actor.motion = { float: 0.3, spin: 0 };
    actor.poses = [
      pose(0, away, turn, 'cut', 0),
      pose(AT.trio, away, turn, 'snappy'),
      pose(AT.trio + 0.8, at, turn, 'smooth'),
      // Gone on the cut to the close.
      pose(AT.end - 0.001, at, turn, 'cut'),
      pose(AT.end, at, turn, 'cut', 0),
    ];
    show(actor.screens, 0, media, 'cut', 0);
    return actor;
  };
  // On each feature, a card of that screen lifts off the glass toward the camera and settles back before the cut.
  const cardActors: PictureActor[] = [];
  lifts.forEach((place, k) => {
    const card = input.cards?.[k];
    if (!place || !card) return;
    const turn = turns.features[k];
    const next = k < AT.features.length - 1 ? AT.features[k + 1] : AT.trio;
    const world = (lift: number) => {
      const q = turnPoint({ x: place.x, y: place.y, z: place.z + lift }, turn);
      return { x: rest.x + q.x, y: rest.y + q.y, z: rest.z + q.z };
    };
    const actor = newPictureActor(pictures[k], { width: place.width, aspect: place.width / place.height, corner: 0.08 });
    actor.crop = card.crop;
    actor.glare = 0.15;
    actor.name = `Card ${k + 1}`;
    const up = AT.features[k] + 0.75;
    const down = next - 0.55;
    actor.poses = [
      pose(0, world(0), turn, 'cut', 0),
      pose(up, world(0), turn, 'snappy'),
      pose(up + 0.5, world(2.4), turn, 'smooth', 1, 1.12),
      pose(down, world(2.4), turn, 'smooth', 1, 1.12),
      pose(next - 0.2, world(0), turn, 'cut'),
      pose(next - 0.19, world(0), turn, 'cut', 0),
    ];
    cardActors.push(actor);
  });

  const left = sidePhone(-1, pictures[1] ?? pictures[0]);
  const right = sidePhone(1, pictures[2] ?? pictures[0]);
  left.name = 'Left phone';
  right.name = 'Right phone';

  // ---- The words -----------------------------------------------------------

  const letters = Array.from(appName.replace(/\s/g, '')).length;
  const byLetter = letters <= 24 ? 'letter' : 'word';

  // The hook: the name huge, over the phone in a tall video and beside it in a wide one, the phone in front of its foot.
  const heroText = wide ? appName : balanceLines(appName, 9);
  const heroWidth = wide ? w * 2.5 : aspect > 0.8 ? w * 2.1 : w * 1.8;
  const heroSize = Math.max(1, Math.min(4.2, heroWidth / Math.max(0.1, titleBox(heroText, 1, 800, font).width)));
  const heroBox = titleBox(heroText, heroSize, 800, font);
  // The phone's top hides the foot of the last line only, so every letter still reads.
  const heroLine = heroBox.height / heroText.split('\n').length;
  const heroAt = wide
    ? { x: -(w / 2 + heroBox.width / 2) + heroSize * 0.12, y: rest.y + h * 0.08, z: -5 }
    : { x: 0, y: rest.y + h / 2 + heroBox.height / 2 - heroLine * 0.3, z: -5 };
  const hero = title({
    text: heroText,
    at: heroAt,
    size: heroSize,
    weight: 800,
    color: tone.title,
    font,
    align: wide ? 'right' : 'center',
    reveal: reveal('rise', byLetter, AT.name, letters, 0.05, 0.45, 0.8),
    out: f1 - 0.28,
  });
  hero.name = 'App name';

  const captionSize = wide ? 1.0 : aspect > 0.8 ? 0.95 : 1.05;
  const captionActors: TextActor[] = [];
  captions.forEach((caption, k) => {
    if (!caption) return;
    const text = balanceLines(caption, wide ? 18 : 14);
    const box = titleBox(text, captionSize, 800, font);
    const gap = 1.4;
    // In the phone's own plane, so they are as sharp as its screen from every angle.
    const at = wide ? { x: -(w / 2 + gap * 1.6 + box.width / 2), y: rest.y + 0.6, z: 0 } : { x: 0, y: rest.y + h / 2 + gap + box.height / 2, z: 0 };
    const next = k < AT.features.length - 1 ? AT.features[k + 1] : AT.trio;
    const words = text.split(/\s+/).length;
    const actor = title({
      text,
      at,
      size: captionSize,
      weight: 800,
      color: tone.caption,
      font,
      align: wide ? 'left' : 'center',
      reveal: reveal('rise', 'word', AT.features[k] + 0.12, words, 0.09, 0.4, 0.8),
      // Gone just before the cut, so the next shot opens clean.
      out: next - 0.36,
    });
    const marked = highlightedWords(text);
    if (marked > 0) actor.highlight = { color: tone.highlight(accent), words: marked };
    actor.name = `Caption ${k + 1}`;
    captionActors.push(actor);
  });

  // The close: the icon as a glossy tile, then the name and where to get the app under it.
  const store = storeLine(type, format.preset);
  const iconSize = 6.5;
  const closeText = balanceLines(appName, wide ? 22 : 13);
  // Under the icon the name is never wider than about the icon, which stays the biggest thing.
  const closeSize = Math.max(0.7, Math.min(icon ? 1.15 : 1.5, (iconSize * (wide ? 1.7 : 1.35)) / Math.max(0.1, titleBox(closeText, 1, 800, font).width)));
  const closeBox = titleBox(closeText, closeSize, 800, font);
  const smallSize = 0.5;
  const smallBox = store ? titleBox(store, smallSize, 500, font) : { width: 0, height: 0 };
  const closeActors: LimelightActor[] = [];
  let closeIds: string[];
  if (icon) {
    const iconAt = { x: 0, y: rest.y + 2.4, z: 2 };
    const tile = newPictureActor(icon, { width: iconSize, aspect: 1, corner: 0.225, depth: iconSize * 0.12, position: iconAt });
    tile.name = 'App icon';
    tile.glare = 0.22;
    tile.poses = [
      pose(0, iconAt, { yaw: -40, pitch: 18, roll: -6 }, 'cut', 0, 0.2),
      // It pops in on the hit, a little past its size, turning to the front, then keeps turning slowly so its edge catches the light.
      pose(AT.end + 0.03, iconAt, { yaw: -40, pitch: 18, roll: -6 }, 'bounce', 1, 0.2),
      pose(AT.end + 0.8, iconAt, { yaw: -8, pitch: 5, roll: 0 }, 'smooth'),
      pose(DURATION, iconAt, { yaw: 10, pitch: -2, roll: 0 }, 'smooth'),
    ];
    // A light sweeps across its face once it has landed.
    tile.shine = AT.end + 0.95;
    const nameY = iconAt.y - iconSize / 2 - 1.1 - closeBox.height / 2;
    const closeName = title({
      text: closeText,
      at: { x: 0, y: nameY, z: iconAt.z },
      size: closeSize,
      weight: 800,
      color: tone.title,
      font,
      align: 'center',
      reveal: reveal('rise', byLetter, AT.end + 0.6, letters, 0.05, 0.45, 0.8),
    });
    closeName.name = 'Closing name';
    closeActors.push(tile, closeName);
    if (store) {
      const small = title({
        text: store,
        at: { x: 0, y: nameY - closeBox.height / 2 - 0.25 - smallBox.height / 2, z: iconAt.z },
        size: smallSize,
        weight: 500,
        color: tone.small,
        font,
        align: 'center',
        reveal: reveal('fade', 'word', AT.end + 1.3, store.split(' ').length, 0.1, 0.45, 0.7),
      });
      small.name = 'Where to get it';
      closeActors.push(small);
    }
    closeIds = closeActors.map((actor) => actor.id);
  } else {
    // No icon: the name and the store beside the phone in a wide video, over it in any other.
    const gap = 1.6;
    const leftEdge = -(w / 2 + gap * 1.6 + Math.max(closeBox.width, smallBox.width));
    const closeY = wide ? rest.y + (store ? smallBox.height / 2 + 0.2 : 0) : rest.y + h / 2 + gap + (store ? smallBox.height + 0.3 : 0) + closeBox.height / 2;
    const closeName = title({
      text: closeText,
      at: { x: wide ? leftEdge + closeBox.width / 2 : 0, y: closeY, z: 0 },
      size: closeSize,
      weight: 800,
      color: tone.title,
      font,
      align: wide ? 'left' : 'center',
      reveal: reveal('rise', byLetter, AT.end + 0.4, letters, 0.05, 0.45, 0.8),
    });
    closeName.name = 'Closing name';
    closeActors.push(closeName);
    if (store) {
      const small = title({
        text: store,
        at: { x: wide ? leftEdge + smallBox.width / 2 : 0, y: closeY - closeBox.height / 2 - 0.3 - smallBox.height / 2, z: 0 },
        size: smallSize,
        weight: 500,
        color: tone.small,
        font,
        align: wide ? 'left' : 'center',
        reveal: reveal('fade', 'word', AT.end + 1.1, store.split(' ').length, 0.1, 0.45, 0.7),
      });
      small.name = 'Where to get it';
      closeActors.push(small);
    }
    closeIds = [phone.id, ...closeActors.map((actor) => actor.id)];
  }

  // ---- The scene, then the camera framed on it ------------------------------

  const actors: LimelightActor[] = [phone, left, right, ...cardActors, hero, ...captionActors, ...closeActors];
  let scene: LimelightScene = {
    ...base,
    format,
    look: {
      ...defaultLook(tone.environment),
      backdrop: tone.backdrop(accent),
      light: { ...tone.light },
      exposure: tone.exposure,
      shadow: tone.shadow,
      depthOfField: true,
      vignette: tone.vignette,
      grain: tone.grain,
    },
    actors: [],
    template: 'app-intro',
    // Its own soundtrack at 128 beats a minute: every cut above is on a beat of it.
    music: { track: 'pulse', volume: 0.8 },
  };
  for (const actor of actors) scene = { ...scene, actors: [...scene.actors, { ...actor, name: freeName(scene, actor.name) }] };

  const start: CameraState = { ...base.camera.shots[0].camera, roll: 0, focus: 0 };
  /** A shot at `time` that frames these actors as they are at `fitAt`, from this angle, then moves in or out by `pull`. */
  const framed = (time: number, ids: string[], fitAt: number, angle: Partial<CameraState>, pull: number, ease: LimelightEase, share = 0.84): CameraShot => {
    const subset = { ...scene, actors: scene.actors.filter((actor) => ids.includes(actor.id)) };
    const camera = cameraToFitPoints(stagePoints(subset, fitAt), { ...start, ...angle }, aspect, share);
    return newShot(time, { ...camera, distance: camera.distance * pull }, ease);
  };
  const featureIds = (k: number) => [phone.id, ...captionActors.filter((actor) => actor.reveal && Math.abs(actor.reveal.time - AT.features[k]) < 0.5).map((actor) => actor.id)];
  const trioIds = [phone.id, left.id, right.id];
  const sharp = { aperture: 8 };
  const shots: CameraShot[] = [
    // The hook: on the name as it comes in, tilting down and back as the phone comes up into it.
    framed(0, [hero.id], AT.land, { azimuth: -5, elevation: 2, lens: 50, ...sharp }, 0.98, 'snappy', 0.8),
    framed(AT.land + 0.1, [hero.id, phone.id], AT.land, { azimuth: 3, elevation: 4, lens: 50, ...sharp }, 1.01, 'glide'),
    framed(f1 - 0.01, [hero.id, phone.id], AT.land, { azimuth: 7, elevation: 5, lens: 50, ...sharp }, 0.97, 'cut'),
    // The features: each a new angle, cut on the bar, easing in.
    framed(f1, featureIds(0), f1 + 0.8, { azimuth: -17, elevation: 8, lens: 60, ...sharp }, 1.04, 'steady'),
    framed(f2 - 0.01, featureIds(0), f1 + 0.8, { azimuth: -8, elevation: 5, lens: 60, ...sharp }, 0.95, 'cut'),
    framed(f2, featureIds(1), f2 + 0.8, { azimuth: 23, elevation: -7, lens: 45, ...sharp }, 1.03, 'steady'),
    framed(f3 - 0.01, featureIds(1), f2 + 0.8, { azimuth: 14, elevation: -4, lens: 45, ...sharp }, 0.95, 'cut'),
    framed(f3, featureIds(2), f3 + 0.8, { azimuth: -25, elevation: 17, lens: 70, ...sharp }, 1.03, 'steady'),
    framed(AT.trio - 0.01, featureIds(2), f3 + 0.8, { azimuth: -15, elevation: 11, lens: 70, ...sharp }, 0.94, 'cut'),
    // The three: in close on the first, pulling back as the others come in.
    framed(AT.trio, [phone.id], AT.trio + 0.7, { azimuth: -4, elevation: 6, lens: 50, ...sharp }, 0.95, 'snappy'),
    framed(AT.trio + 0.9, trioIds, AT.trio + 0.9, { azimuth: 5, elevation: 7, lens: 50, ...sharp }, 1.02, 'glide'),
    framed(AT.end - 0.01, trioIds, AT.trio + 0.9, { azimuth: 11, elevation: 5, lens: 50, ...sharp }, 0.97, 'cut'),
    // The close: drifting round and in as the name comes.
    framed(AT.end, closeIds, DURATION - 0.3, { azimuth: -9, elevation: 4, lens: 60, ...sharp }, 1.12, 'glide', 0.8),
    framed(DURATION, closeIds, DURATION - 0.3, { azimuth: 3, elevation: 2, lens: 60, ...sharp }, 1, 'glide', 0.8),
  ];
  return normalizeScene({ ...scene, camera: { shots, shake: tone.shake } });
}

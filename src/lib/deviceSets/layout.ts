// Lays an artboard out again for another screen shape.
//
// convertArtboardsToFormat scales everything by one factor and centres it, so
// an iPhone design put on an iPad canvas keeps its narrow column with empty
// bands either side. This reads the design instead and rebuilds it:
//
//   backdrop  shapes and pictures that cover the artboard, or are bigger than
//             it (a soft glow), stretched or scaled to cover the new one
//   band      full width strips, stretched sideways and kept on their edge
//   hero      the device mockups and everything that sits on them, moved and
//             sized as one piece, so a badge stays on its phone; with no
//             device, the main picture (cards with text on them, a photo)
//   rows      the text, one row per line of the layout. A text is set again
//             at the new size and width and measured, so it wraps for the new
//             shape; a group of text and shapes (a card, a button), a turned
//             text and a line of pictures (an icon, five stars) keep their
//             shape and are only scaled
//   decor     everything else, kept near the corner or edge it was near
//
// Then one of the layouts places them: `stacked` keeps the design's own order
// top to bottom, `beside` and `beside-flipped` put the text in a column next
// to the devices (for landscape screens), and `scaled` is
// convertArtboardsToFormat's uniform scale, for designs this reading gets
// wrong. A rebuilt layout that cuts text off or runs text into text or into a
// device further than the design did falls back to `scaled` (looksRight).
//
// A layout is worked out once, on the artboard as it is in its main language,
// and comes back as a plan: the new box of every element. Applying the plan
// to the same artboard in another language keeps the layout the same in every
// language and only fits each language's text into its box (`applyPlan`).
//
// Pure apart from the text measure, which the caller passes. Without one (in
// node) text keeps its line breaks and is only scaled, which always fits.

import type {
  ArtboardElement,
  ArtboardState,
  DeviceFrameElementProps,
  DeviceSetLayout,
  DeviceType,
  ShapeElementProps,
  Size,
  TextElementProps,
} from '@/types/artboard';
import { elementVisualBounds, hasCanvasBox, type Bounds } from '@/lib/elementGeometry';
import { getDeviceDescriptor, scaleElementsToCanvas, swapDeviceInElements } from '@/lib/deviceRegistry';

export type DeviceLayout = DeviceSetLayout;

/**
 * How tall a text element's box has to be for its content, at the element's
 * own width and size, in element units. 0 when it cannot be measured.
 */
export type TextMeasure = (element: TextElementProps) => number;

/** The new geometry of one element. Anything absent stays as it was. */
export interface ElementPatch {
  position: { x: number; y: number };
  size: { width: number; height: number };
  scale?: number;
  /** Text only: what the font size, tracking and outline are multiplied by. */
  fontScale?: number;
  /** Device only: the frame it shows on this screen. */
  deviceType?: DeviceType;
  /** A picture or shape fitted to a new frame's screen: that screen's corner. */
  borderRadius?: number;
}

export interface BoardPlan {
  layout: DeviceLayout;
  /**
   * No rebuilt layout that was tried fits this design, so `layout` is
   * `scaled`: for a layout someone picked, that one; for the automatic one,
   * every rebuilt layout.
   */
  fellBack: boolean;
  size: Size;
  patches: Map<string, ElementPatch>;
  /** Devices whose frame changed, by element id. */
  frames: Map<string, DeviceType>;
}

// --- reading the design ---------------------------------------------------

interface Item {
  el: ArtboardElement;
  box: Bounds;
}

type RowPlace = 'above' | 'below' | 'left' | 'right';

interface Row {
  /** The text elements in the row, left to right. Empty for a row of pictures. */
  texts: Item[];
  /** Shapes and pictures that move with the row's text, keyed by the text they follow. */
  attached: Map<string, Item[]>;
  /** A row of pictures only: an app icon over a headline, a row of stars. */
  graphics: Item[];
  /** Moved and scaled as one piece, never set again: a card, a button, a group. */
  rigid: boolean;
  box: Bounds;
  place: RowPlace;
}

interface Reading {
  width: number;
  height: number;
  backdrops: Item[];
  bands: Item[];
  hero: Item[];
  heroBox: Bounds | null;
  rows: Row[];
  decor: Item[];
  crossing: Item[];
}

const area = (b: Bounds) => Math.max(0, b.width) * Math.max(0, b.height);

function intersect(a: Bounds, b: Bounds): Bounds {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

function union(boxes: Bounds[]): Bounds {
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Share of `a`'s own area that `b` covers. */
const coveredBy = (a: Bounds, b: Bounds) => (area(a) > 0 ? area(intersect(a, b)) / area(a) : 0);

/** How far apart two boxes are, 0 when they touch or overlap. */
function gapBetween(a: Bounds, b: Bounds): number {
  const across = Math.max(0, a.x - (b.x + b.width), b.x - (a.x + a.width));
  const down = Math.max(0, a.y - (b.y + b.height), b.y - (a.y + a.height));
  return Math.max(across, down);
}

/** True when two boxes share at least `share` of the shorter one's height. */
function sameLine(a: Bounds, b: Bounds, share = 0.5): boolean {
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return bottom - top >= Math.min(a.height, b.height) * share;
}

/**
 * The artboard edges a box hangs off, by more than 3% of its own size: a phone
 * cut off at the bottom on purpose, not one that overshoots by a few pixels.
 */
function overhang(box: Bounds, width: number, height: number) {
  const x = Math.max(2, box.width * 0.03);
  const y = Math.max(2, box.height * 0.03);
  return {
    left: box.x < -x,
    right: box.x + box.width > width + x,
    top: box.y < -y,
    bottom: box.y + box.height > height + y,
  };
}

const isDevice = (el: ArtboardElement) => el.type === 'device' || el.type === 'video-device';

/**
 * The area a hero member covers for deciding what sits on it. A turned device
 * covers its own box, not the larger upright box around it, or a headline
 * beside a tilted phone would count as on the phone.
 */
function seatOf(item: Item): Bounds {
  return isDevice(item.el) && item.el.rotation % 360 !== 0 ? layoutBox(item.el) : item.box;
}

/** A group of text and shapes, a card or a button, that only ever moves as one piece. */
interface Unit {
  members: Item[];
  box: Bounds;
  texts: Item[];
}

/**
 * With no device on the artboard, the picture the design is about: the
 * largest cluster of touching cards, tiles and pictures that has text on it
 * (an interface drawn in shapes), or a large picture fully on the artboard.
 * Decorations without words, like rings and blobs, are not it.
 */
function mainPicture(pieces: Array<{ items: Item[]; box: Bounds }>, texts: Item[], frame: Bounds): Item[] {
  const boardArea = area(frame);
  // A card or a screen sits on the artboard; a ring or a blob that runs off it is decoration.
  const candidates = pieces.filter(
    (piece) => area(intersect(piece.box, frame)) >= boardArea * 0.015 && coveredBy(piece.box, frame) >= 0.9
  );
  const reach = Math.max(frame.width, frame.height) * 0.025;
  const seen = new Set<number>();
  let best: { members: Item[]; score: number } | null = null;
  candidates.forEach((_, startIndex) => {
    if (seen.has(startIndex)) return;
    const cluster: number[] = [];
    const queue = [startIndex];
    seen.add(startIndex);
    while (queue.length) {
      const index = queue.pop()!;
      cluster.push(index);
      candidates.forEach((other, otherIndex) => {
        if (!seen.has(otherIndex) && gapBetween(candidates[index].box, other.box) <= reach) {
          seen.add(otherIndex);
          queue.push(otherIndex);
        }
      });
    }
    const members = cluster.flatMap((index) => candidates[index].items);
    const box = union(cluster.map((index) => candidates[index].box));
    const score = area(intersect(box, frame));
    if (score < boardArea * 0.12) return;
    const words = texts.filter(
      (text) => members.includes(text) || members.some((member) => member.el.type !== 'text' && coveredBy(text.box, member.box) >= 0.5)
    ).length;
    const photo = members.some(
      (member) =>
        (member.el.type === 'image' || member.el.type === 'video') &&
        area(intersect(member.box, frame)) >= boardArea * 0.2 &&
        coveredBy(member.box, frame) >= 0.9
    );
    if (words < 2 && !photo) return;
    if (!best || score > best.score) best = { members, score };
  });
  return best ? (best as { members: Item[] }).members : [];
}

/**
 * Sorts an artboard's elements into the parts the layouts move. Elements in
 * one group land in the same part: a group with a device is the hero, a group
 * of text and shapes is one piece wherever it goes, and a group of text only
 * is set again line by line like any text.
 */
export function readBoard(board: ArtboardState): Reading {
  const width = board.size.width;
  const height = board.size.height;
  const frame: Bounds = { x: 0, y: 0, width, height };
  const boardArea = width * height;
  const items: Item[] = board.elements
    .filter(hasCanvasBox)
    .map((el) => ({ el, box: elementVisualBounds(el) }));

  const backdrops: Item[] = [];
  let bands: Item[] = [];
  const devices: Item[] = [];
  const texts: Item[] = [];
  const loose: Item[] = [];
  const crossing: Item[] = [];
  const offstage: Item[] = [];
  for (const item of items) {
    const { el, box } = item;
    const crossesSide = box.x < -1 || box.x + box.width > width + 1;
    if (el.spanArtboards && crossesSide) {
      crossing.push(item);
    } else if (area(box) > 0 && coveredBy(box, frame) < 0.05) {
      // Parked off the artboard, where it shows nothing: kept off it.
      offstage.push(item);
    } else if (isDevice(el)) {
      devices.push(item);
    } else if (el.type === 'text') {
      texts.push(item);
    } else {
      const inside = intersect(box, frame);
      // A picture bigger than the artboard itself, like a soft glow, is part
      // of the background. A shape that size (a swoosh) is not: it goes with
      // what it sits behind.
      const atmosphere = el.type === 'image' && (box.width >= width * 1.25 || box.height >= height * 1.25);
      if (area(inside) / boardArea >= 0.8 || atmosphere) backdrops.push(item);
      else if (inside.width >= width * 0.92 && inside.height < height * 0.8) bands.push(item);
      else loose.push(item);
    }
  }
  const placedElsewhere = (item: Item) =>
    backdrops.includes(item) || bands.includes(item) || crossing.includes(item) || offstage.includes(item);

  // Groups.
  const byGroup = new Map<string, Item[]>();
  for (const item of items) {
    if (!item.el.groupId || placedElsewhere(item)) continue;
    const list = byGroup.get(item.el.groupId) ?? [];
    list.push(item);
    byGroup.set(item.el.groupId, list);
  }
  const units: Unit[] = [];
  const unitOf = new Map<Item, Unit>();
  for (const members of byGroup.values()) {
    if (members.some((member) => isDevice(member.el))) continue;
    const unitTexts = members.filter((member) => member.el.type === 'text');
    const others = members.filter((member) => member.el.type !== 'text');
    if (unitTexts.length === 0 || others.length === 0) continue;
    const unit: Unit = { members, box: union(members.map((member) => member.box)), texts: unitTexts };
    units.push(unit);
    for (const member of members) unitOf.set(member, unit);
  }

  // The hero: devices and whatever sits on them, or with no device the main picture.
  const pieces = [
    ...loose.filter((item) => !unitOf.has(item)).map((item) => ({ items: [item], box: item.box })),
    ...units.map((unit) => ({ items: unit.members, box: unit.box })),
  ];
  const seeds = devices.length > 0 ? devices : mainPicture(pieces, texts, frame);
  const hero = new Set<Item>(seeds);
  if (seeds.length > 0) {
    const seats = seeds.map(seatOf);
    for (const item of loose) {
      if (seats.some((seat) => coveredBy(item.box, seat) >= 0.25)) hero.add(item);
    }
    for (const item of texts) {
      if (seats.some((seat) => coveredBy(item.box, seat) >= 0.5)) hero.add(item);
    }
    // A strip that cannot stretch (a wave, a row of bars) behind the devices goes with them.
    const seatBox = union(seats);
    bands = bands.filter((item) => {
      if (stretchesCleanly(item.el)) return true;
      const behind = seats.some((seat) => coveredBy(item.box, seat) >= 0.25) || coveredBy(item.box, seatBox) >= 0.1;
      if (!behind) return true;
      hero.add(item);
      return false;
    });
    // A shadow under a card on the phone: covered by something already in.
    for (const item of loose) {
      if (hero.has(item)) continue;
      if ([...hero].some((member) => coveredBy(item.box, seatOf(member)) >= 0.5)) hero.add(item);
    }
    for (const item of items) {
      if (item.el.type === 'gesture') hero.add(item);
    }
  }
  // Groups stay together: a group with a hero member joins the hero whole.
  for (const members of byGroup.values()) {
    if (!members.some((member) => hero.has(member))) continue;
    for (const member of members) hero.add(member);
  }

  // A large shape mostly behind the devices (a swoosh, a blob) is part of their picture.
  const heroSoFar = [...hero];
  if (heroSoFar.length > 0) {
    const around = union(heroSoFar.map(seatOf));
    for (const item of loose) {
      if (hero.has(item) || unitOf.has(item)) continue;
      if (area(item.box) >= boardArea * 0.05 && coveredBy(item.box, around) >= 0.3) hero.add(item);
    }
  }

  // A label on something small that rides with the devices (a badge) rides too.
  const riders = [...hero].filter(
    (member) => !isDevice(member.el) && member.el.type !== 'text' && area(member.box) <= boardArea * 0.15
  );
  for (const text of texts) {
    if (hero.has(text) || unitOf.has(text)) continue;
    if (riders.some((rider) => coveredBy(text.box, rider.box) >= 0.5)) hero.add(text);
  }

  const heroItems = items.filter((item) => hero.has(item));
  const heroBox = heroItems.length > 0 ? union(heroItems.map((item) => item.box)) : null;
  // Whether a text is on the devices is asked of the devices (or the main
  // picture's cards) themselves, never of a swoosh or a glow riding with them.
  const heroSeats = seeds.map(seatOf);
  const placeOf = (box: Bounds): RowPlace | 'over' => {
    if (!heroBox) return 'above';
    const slackY = box.height * 0.25;
    const slackX = box.width * 0.25;
    if (box.y + box.height <= heroBox.y + slackY) return 'above';
    if (box.y >= heroBox.y + heroBox.height - slackY) return 'below';
    if (box.x + box.width <= heroBox.x + slackX) return 'left';
    if (box.x >= heroBox.x + heroBox.width - slackX) return 'right';
    // Inside the box around the devices but on none of them (beside a
    // tilted phone): its middle says which side it is on.
    if (heroSeats.every((seat) => coveredBy(box, seat) < 0.3)) {
      const middle = box.y + box.height / 2;
      return middle < heroBox.y + heroBox.height / 2 ? 'above' : 'below';
    }
    return 'over';
  };

  // Text rows, and what moves with each text.
  const freeTexts = texts.filter((item) => !hero.has(item) && !unitOf.has(item));
  const freeLoose = loose.filter((item) => !hero.has(item) && !unitOf.has(item));
  const attachedTo = new Map<string, Item[]>();
  const taken = new Set<Item>();
  const attach = (text: Item, item: Item) => {
    const list = attachedTo.get(text.el.id) ?? [];
    list.push(item);
    attachedTo.set(text.el.id, list);
    taken.add(item);
  };
  // Small pictures side by side on one line (five stars, a row of badges)
  // go wherever the first of them goes.
  const lineOf = new Map<Item, Item[]>();
  const small = freeLoose.filter((item) => area(item.box) <= boardArea * 0.02);
  for (const item of small) {
    if (lineOf.has(item)) continue;
    const line = [item];
    lineOf.set(item, line);
    for (let i = 0; i < line.length; i += 1) {
      for (const other of small) {
        if (lineOf.has(other)) continue;
        if (sameLine(line[i].box, other.box, 0.5) && gapBetween(line[i].box, other.box) <= width * 0.06) {
          line.push(other);
          lineOf.set(other, line);
        }
      }
    }
  }
  const lineMates = (item: Item) => (lineOf.get(item)?.length ?? 0) > 1 ? lineOf.get(item)! : [item];

  for (const item of freeLoose) {
    if (taken.has(item)) continue;
    // Behind or on a text, and about its size: a pill, a highlight.
    const under = freeTexts.find(
      (text) =>
        coveredBy(item.box, text.box) >= 0.5 ||
        (coveredBy(text.box, item.box) >= 0.9 && area(item.box) <= area(text.box) * 4)
    );
    if (under) {
      attach(under, item);
      continue;
    }
    // Right above or below a text: stars under a quote.
    if (area(item.box) > boardArea * 0.15) continue;
    const gap = height * 0.025;
    const near = freeTexts.find((text) => {
      const sideways = item.box.x < text.box.x + text.box.width && item.box.x + item.box.width > text.box.x;
      const above = text.box.y - (item.box.y + item.box.height);
      const below = item.box.y - (text.box.y + text.box.height);
      return sideways && ((above >= -gap && above <= gap) || (below >= -gap && below <= gap));
    });
    if (near) {
      for (const mate of lineMates(item)) if (!taken.has(mate)) attach(near, mate);
    }
  }

  // Texts that share their height sit in one row.
  const sorted = [...freeTexts].sort((a, b) => a.box.y - b.box.y);
  const rowsTexts: Item[][] = [];
  for (const text of sorted) {
    const row = rowsTexts.find((candidate) => candidate.some((other) => sameLine(other.box, text.box)));
    if (row) row.push(text);
    else rowsTexts.push([text]);
  }
  const rows: Row[] = [];
  const overHero = (members: Item[]) => {
    for (const member of members) hero.add(member);
  };
  for (const rowTexts of rowsTexts) {
    rowTexts.sort((a, b) => a.box.x - b.box.x);
    const attached = new Map<string, Item[]>();
    for (const text of rowTexts) attached.set(text.el.id, attachedTo.get(text.el.id) ?? []);
    const box = union([...rowTexts, ...[...attached.values()].flat()].map((item) => item.box));
    const place = placeOf(box);
    if (place === 'over') {
      // Text over the devices belongs to them: a label across a phone.
      overHero([...rowTexts, ...[...attached.values()].flat()]);
      continue;
    }
    rows.push({ texts: rowTexts, attached, graphics: [], rigid: false, box, place });
  }
  // Cards and buttons outside the hero are rows of their own, moved whole.
  for (const unit of units) {
    if (unit.members.some((member) => hero.has(member))) continue;
    const place = placeOf(unit.box);
    if (place === 'over') {
      overHero(unit.members);
      continue;
    }
    rows.push({
      texts: [...unit.texts].sort((a, b) => a.box.x - b.box.x),
      attached: new Map(),
      graphics: unit.members.filter((member) => member.el.type !== 'text'),
      rigid: true,
      box: unit.box,
      place,
    });
  }

  // A picture in the text column, on a line of its own above or between the
  // rows (an app icon over a headline), is a row of its own, so it keeps its
  // place in the stack instead of being run into by text that grew.
  const inRow = new Set(rows.flatMap((row) => [...row.texts, ...row.graphics, ...[...row.attached.values()].flat()]));
  for (const first of freeLoose) {
    if (hero.has(first) || inRow.has(first) || taken.has(first)) continue;
    const mates = lineMates(first).filter((item) => !hero.has(item) && !inRow.has(item) && !taken.has(item));
    const box = union(mates.map((item) => item.box));
    if (area(box) > boardArea * 0.15 || coveredBy(box, frame) < 0.9) continue;
    const place = placeOf(box);
    if (place !== 'above' && place !== 'below') continue;
    const textRows = rows.filter((row) => row.texts.length > 0 && row.place === place);
    if (textRows.some((row) => sameLine(row.box, box, 0.1))) continue;
    const column = textRows.some(
      (row) => Math.min(row.box.x + row.box.width, box.x + box.width) - Math.max(row.box.x, box.x) >= box.width * 0.3
    );
    if (!column) continue;
    rows.push({ texts: [], attached: new Map(), graphics: mates, rigid: true, box, place });
    for (const item of mates) inRow.add(item);
  }

  const finalHero = items.filter((item) => hero.has(item));
  const finalHeroBox = finalHero.length > 0 ? union(finalHero.map((item) => item.box)) : null;
  const keptRows = rows.filter((row) => ![...row.texts, ...row.graphics].some((item) => hero.has(item)));
  if (!finalHeroBox) {
    // Nothing to stack around: the rows split into blocks where a wide gap
    // parts them, and a block in the lower part keeps to the bottom edge.
    keptRows.sort((a, b) => a.box.y - b.box.y);
    let block: Row[] = [];
    const settle = () => {
      if (block.length === 0) return;
      const top = block[0].box.y;
      const bottom = Math.max(...block.map((row) => row.box.y + row.box.height));
      const place: RowPlace = (top + bottom) / 2 > height * 0.6 ? 'below' : 'above';
      for (const row of block) row.place = place;
      block = [];
    };
    keptRows.forEach((row, i) => {
      const previous = keptRows[i - 1];
      if (previous && row.box.y - (previous.box.y + previous.box.height) > height * 0.1) settle();
      block.push(row);
    });
    settle();
  }
  const inKeptRow = new Set(keptRows.flatMap((row) => [...row.texts, ...row.graphics, ...[...row.attached.values()].flat()]));
  // Everything else, and whatever sits off the artboard, keeps near the edge
  // or corner it was near. Nothing is lost.
  const decor = items.filter(
    (item) =>
      !hero.has(item) &&
      !inKeptRow.has(item) &&
      !backdrops.includes(item) &&
      !bands.includes(item) &&
      !crossing.includes(item)
  );

  return {
    width,
    height,
    backdrops,
    bands,
    hero: finalHero,
    heroBox: finalHeroBox,
    rows: keptRows.sort((a, b) => a.box.y - b.box.y),
    decor,
    crossing,
  };
}

// --- placing it again ------------------------------------------------------

/** How far a text box may widen beyond its scaled width, so lines stay a readable length. */
const MAX_WIDEN = 1.6;

interface Ctx {
  r: Reading;
  /** The hero's box in the design, before any of its frames changed shape. */
  heroBefore: Bounds | null;
  W2: number;
  H2: number;
  sx: number;
  sy: number;
  measure: TextMeasure | null;
  patches: Map<string, ElementPatch>;
}

/** The box of an element as written: position and size times scale, no rotation. */
function layoutBox(el: ArtboardElement): Bounds {
  const scale = el.scale || 1;
  return { x: el.position.x, y: el.position.y, width: el.size.width * scale, height: el.size.height * scale };
}

/** Moves and scales an element uniformly: its box maps by `x' = ox + (x - ix) * k`. */
function uniformPatch(el: ArtboardElement, k: number, from: { x: number; y: number }, to: { x: number; y: number }): ElementPatch {
  const box = layoutBox(el);
  const position = { x: to.x + (box.x - from.x) * k, y: to.y + (box.y - from.y) * k };
  if (el.type === 'text') {
    return { position, size: { width: box.width * k, height: box.height * k }, scale: 1, fontScale: k };
  }
  return { position, size: { ...el.size }, scale: (el.scale || 1) * k };
}

/** Stretches an element's box on each axis. For shapes and covering pictures only. */
function stretchPatch(el: ArtboardElement, box: Bounds): ElementPatch {
  const scale = el.scale || 1;
  return {
    position: { x: box.x, y: box.y },
    size: { width: box.width / scale, height: box.height / scale },
    scale,
  };
}

/** True when stretching the element on one axis does not distort what it draws. */
function stretchesCleanly(el: ArtboardElement): boolean {
  if (el.rotation % 360 !== 0) return false;
  if (el.type === 'shape') return (el as ShapeElementProps).shapeType === 'rectangle';
  if (el.type === 'image' || el.type === 'video') {
    const fit = (el as { objectFit?: string }).objectFit;
    return fit === undefined || fit === 'cover';
  }
  return false;
}

function placeBackdrops(ctx: Ctx) {
  const { r, W2, H2, sx, sy } = ctx;
  for (const { el } of r.backdrops) {
    const box = layoutBox(el);
    if (stretchesCleanly(el)) {
      ctx.patches.set(el.id, stretchPatch(el, { x: box.x * sx, y: box.y * sy, width: box.width * sx, height: box.height * sy }));
    } else {
      // Scaled to cover, about the middle.
      const k = Math.max(sx, sy);
      const cx = W2 / 2 + (box.x + box.width / 2 - r.width / 2) * k;
      const cy = H2 / 2 + (box.y + box.height / 2 - r.height / 2) * k;
      ctx.patches.set(el.id, uniformPatch(el, k, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: cx, y: cy }));
    }
  }
}

interface HeroMap {
  k: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

const mapY = (hero: HeroMap, y: number) => hero.to.y + (y - hero.from.y) * hero.k;

function placeBands(ctx: Ctx, hero: HeroMap | null) {
  const { r, H2, sx, sy } = ctx;
  for (const { el } of r.bands) {
    const box = layoutBox(el);
    const top = box.y;
    const bottom = box.y + box.height;
    const middle = (top + bottom) / 2;
    const followsHero =
      hero && r.heroBox && middle >= r.heroBox.y && middle <= r.heroBox.y + r.heroBox.height;
    const edgeY = (y: number, fallback: number) => {
      if (y >= r.height - 2) return H2 + (y - r.height) * sy;
      if (y <= 2) return y * sy;
      return fallback;
    };
    const top2 = edgeY(top, followsHero ? mapY(hero!, top) : top * sy);
    const bottom2 = edgeY(bottom, followsHero ? mapY(hero!, bottom) : bottom * sy);
    const x2 = box.x * sx;
    const w2 = box.width * sx;
    if (stretchesCleanly(el)) {
      ctx.patches.set(el.id, stretchPatch(el, { x: x2, y: top2, width: w2, height: Math.max(1, bottom2 - top2) }));
    } else {
      // Kept in proportion, as wide as the strip has to be.
      const k = sx;
      const anchorBottom = bottom >= r.height - 2;
      const to = anchorBottom
        ? { x: x2, y: bottom2 - box.height * k }
        : { x: x2, y: top2 };
      ctx.patches.set(el.id, uniformPatch(el, k, { x: box.x, y: box.y }, to));
    }
  }
}

function placeDecor(ctx: Ctx, items: Item[], ft: number) {
  const { r, W2, H2, sx, sy } = ctx;
  const edge = Math.min(sy, ft);
  for (const { el, box: visual } of items) {
    const cx = visual.x + visual.width / 2;
    const cy = visual.y + visual.height / 2;
    const cx2 =
      cx < r.width / 3
        ? cx * ft
        : cx > (r.width * 2) / 3
          ? W2 - (r.width - cx) * ft
          : W2 / 2 + (cx - r.width / 2) * sx;
    const cy2 =
      cy < r.height / 3
        ? cy * edge
        : cy > (r.height * 2) / 3
          ? H2 - (r.height - cy) * edge
          : H2 / 2 + (cy - r.height / 2) * sy;
    ctx.patches.set(el.id, uniformPatch(el, ft, { x: cx, y: cy }, { x: cx2, y: cy2 }));
  }
}

function placeCrossing(ctx: Ctx) {
  const { r, W2, sy } = ctx;
  for (const { el, box: visual } of r.crossing) {
    const box = layoutBox(el);
    const k = sy;
    const crossesRight = visual.x + visual.width > r.width + 1;
    const x2 = crossesRight ? W2 - (r.width - box.x) * k : box.x * k;
    ctx.patches.set(el.id, uniformPatch(el, k, { x: box.x, y: box.y }, { x: x2, y: box.y * sy }));
  }
}

/**
 * A distance from an artboard edge, on the new artboard. A margin keeps to the
 * type's scale; anything further in keeps its share of the width, so a label
 * two thirds across stays two thirds across.
 */
function fromEdge(ctx: Ctx, distance: number, ft: number): number {
  return distance < ctx.r.width * 0.12 ? distance * Math.min(ctx.sx, ft) : distance * ctx.sx;
}

/** Where a text box sits across its row: its anchor and how far from it. */
function textAnchor(box: Bounds, width: number): 'left' | 'center' | 'right' {
  const middle = box.x + box.width / 2;
  if (Math.abs(middle - width / 2) <= width * 0.06) return 'center';
  return box.x <= width - (box.x + box.width) ? 'left' : 'right';
}

interface SizedText {
  item: Item;
  /** The new box, with x set and y relative to the row's top. */
  box: Bounds;
  fontScale: number;
}

interface SizedRow {
  row: Row;
  height: number;
  texts: SizedText[];
  /** What moves with the text, placed once the row's top is known. */
  attached: Array<{ item: Item; patch: (rowTop: number) => ElementPatch }>;
}

function measured(ctx: Ctx, text: TextElementProps): number {
  if (!ctx.measure) return 0;
  const value = ctx.measure(text);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * The text of one element set again: the font scaled by `ft`, the box as
 * wide as `width` (or the scaled width when it cannot be measured) and as
 * tall as its text needs, keeping the slack the design gave it.
 */
function setText(ctx: Ctx, el: TextElementProps, ft: number, width: number): { width: number; height: number; fontScale: number } {
  const box = layoutBox(el);
  const scaledWidth = box.width * ft;
  const sourceNeeds = measured(ctx, { ...el, size: { width: box.width, height: box.height }, scale: 1 });
  if (!sourceNeeds || el.rotation % 360 !== 0) {
    return { width: scaledWidth, height: box.height * ft, fontScale: ft };
  }
  const probe: TextElementProps = {
    ...el,
    scale: 1,
    size: { width, height: box.height * ft },
    fontSize: el.fontSize * ft,
    ...(typeof el.letterSpacing === 'number' ? { letterSpacing: el.letterSpacing * ft } : null),
    ...(typeof el.outlineWidth === 'number' ? { outlineWidth: el.outlineWidth * ft } : null),
  };
  const needs = measured(ctx, probe);
  if (!needs) return { width: scaledWidth, height: box.height * ft, fontScale: ft };
  // The room the design left around the text, kept as an amount, so a text
  // that gains a line does not gain room as well.
  const room = Math.min(box.height * 0.5, Math.max(0, box.height - sourceNeeds));
  return { width, height: Math.ceil(needs + room * ft), fontScale: ft };
}

/**
 * One row sized for a column `columnX` to `columnX + columnWidth`. A row of
 * one text gets the column's width as its line length (within MAX_WIDEN); a
 * row of several keeps their arrangement and is only scaled.
 */
function sizeRow(
  ctx: Ctx,
  row: Row,
  ft: number,
  column: { x: number; width: number; sourceX: number; sourceWidth: number },
  alignTo: 'source' | 'column'
): SizedRow {
  const { r } = ctx;
  if (row.rigid || row.texts.length !== 1 || row.texts.some((item) => item.el.rotation % 360 !== 0)) {
    // Kept as one piece: several texts side by side, a row of pictures, or a
    // turned text, whose row box is its turned outline.
    const rowLeft = row.box.x;
    const rowWidth2 = row.box.width * ft;
    const anchor = textAnchor(row.box, r.width);
    const left2 =
      alignTo === 'column'
        ? column.x + Math.max(0, (column.width - rowWidth2) / 2)
        : anchor === 'center'
          ? column.x + column.width / 2 - rowWidth2 / 2 + (row.box.x + row.box.width / 2 - r.width / 2) * ctx.sx
          : anchor === 'left'
            ? column.x + fromEdge(ctx, rowLeft - column.sourceX, ft)
            : column.x + column.width - fromEdge(ctx, column.sourceX + column.sourceWidth - (row.box.x + row.box.width), ft) - rowWidth2;
    const texts: SizedText[] = row.texts.map((item) => {
      const box = layoutBox(item.el);
      return {
        item,
        box: {
          x: left2 + (box.x - rowLeft) * ft,
          y: (box.y - row.box.y) * ft,
          width: box.width * ft,
          height: box.height * ft,
        },
        fontScale: ft,
      };
    });
    const attached = [...[...row.attached.values()].flat(), ...row.graphics].map((item) => ({
      item,
      patch: (rowTop: number) =>
        uniformPatch(item.el, ft, { x: rowLeft, y: row.box.y }, { x: left2, y: rowTop }),
    }));
    return { row, height: row.box.height * ft, texts, attached };
  }

  const item = row.texts[0];
  const el = item.el as TextElementProps;
  const box = layoutBox(el);
  const anchor = alignTo === 'column' ? 'column' : textAnchor(box, r.width);
  const edge = Math.min(ctx.sx, ft);
  // How wide the line may run.
  let width: number;
  const wide = box.width >= column.sourceWidth * 0.7;
  if (alignTo === 'column') {
    width = Math.min(column.width, box.width * ft * MAX_WIDEN);
    if (wide) width = column.width;
  } else if (wide) {
    const margins = (box.x - column.sourceX + (column.sourceX + column.sourceWidth - (box.x + box.width))) * edge;
    width = column.width - margins;
  } else {
    width = box.width * ft * Math.min(MAX_WIDEN, Math.max(1, ctx.sx / ft));
  }
  width = Math.max(box.width * ft * 0.6, Math.min(width, box.width * ft * MAX_WIDEN, column.width));
  const set = setText(ctx, el, ft, width);
  const placed =
    anchor === 'column'
      ? el.textAlign === 'right'
        ? column.x + column.width - set.width
        : el.textAlign === 'center'
          ? column.x + (column.width - set.width) / 2
          : column.x
      : anchor === 'center'
        ? column.x + column.width / 2 - set.width / 2 + (box.x + box.width / 2 - (column.sourceX + column.sourceWidth / 2)) * ctx.sx
        : anchor === 'left'
          ? column.x + fromEdge(ctx, box.x - column.sourceX, ft)
          : column.x + column.width - fromEdge(ctx, column.sourceX + column.sourceWidth - (box.x + box.width), ft) - set.width;
  // A text that was on the artboard stays on it, however much wider it got.
  const wasInside = box.x >= -1 && box.x + box.width <= r.width + 1;
  const x2 = wasInside
    ? Math.max(column.x, Math.min(placed, column.x + column.width - set.width))
    : placed;

  // What follows the text moves with the point its alignment holds still.
  const align = el.textAlign === 'right' ? 'right' : el.textAlign === 'left' || el.textAlign === 'justify' ? 'left' : 'center';
  const pin = (b: Bounds) => ({
    x: align === 'left' ? b.x : align === 'right' ? b.x + b.width : b.x + b.width / 2,
    y: b.y + b.height / 2,
  });
  const fromPin = pin(box);
  const attachedItems = row.attached.get(el.id) ?? [];
  // The row's content: the text's box and what follows it, relative to the row top.
  const textTop = 0;
  const textBox: Bounds = { x: x2, y: textTop, width: set.width, height: set.height };
  const toPin = pin(textBox);
  const followers = attachedItems.map((follower) => {
    const fbox = layoutBox(follower.el);
    const wrapsText =
      follower.el.type === 'shape' &&
      stretchesCleanly(follower.el) &&
      fbox.width >= box.width * 0.8;
    if (wrapsText) {
      // A card or pill around the text grows with the box.
      const kx = set.width / box.width;
      const ky = set.height / box.height;
      const rel = {
        x: x2 + (fbox.x - box.x) * kx,
        y: textTop + (fbox.y - box.y) * ky,
        width: fbox.width * kx,
        height: fbox.height * ky,
      };
      return { item: follower, rel, stretch: true };
    }
    const k = set.fontScale;
    const rel = {
      x: toPin.x + (fbox.x - fromPin.x) * k,
      y: toPin.y + (fbox.y - fromPin.y) * k,
      width: fbox.width * k,
      height: fbox.height * k,
    };
    return { item: follower, rel, stretch: false };
  });
  // Followers above the text push the row's top up.
  const visualTops = followers.map((f) => f.rel.y);
  const visualBottoms = followers.map((f) => f.rel.y + f.rel.height);
  const top = Math.min(textTop, ...visualTops);
  const bottom = Math.max(textTop + set.height, ...visualBottoms);
  const shift = -top;
  const texts: SizedText[] = [
    { item, box: { ...textBox, y: textBox.y + shift }, fontScale: set.fontScale },
  ];
  const attached = followers.map((f) => ({
    item: f.item,
    patch: (rowTop: number) => {
      const y = rowTop + f.rel.y + shift;
      if (f.stretch) return stretchPatch(f.item.el, { x: f.rel.x, y, width: f.rel.width, height: f.rel.height });
      const fbox = layoutBox(f.item.el);
      return uniformPatch(f.item.el, set.fontScale, { x: fbox.x, y: fbox.y }, { x: f.rel.x, y });
    },
  }));
  return { row, height: bottom - top, texts, attached };
}

function commitRow(ctx: Ctx, sized: SizedRow, rowTop: number) {
  for (const text of sized.texts) {
    ctx.patches.set(text.item.el.id, {
      position: { x: text.box.x, y: rowTop + text.box.y },
      size: { width: text.box.width, height: text.box.height },
      scale: 1,
      fontScale: text.fontScale,
    });
  }
  for (const follower of sized.attached) ctx.patches.set(follower.item.el.id, follower.patch(rowTop));
}

function placeHero(ctx: Ctx, map: HeroMap) {
  for (const { el } of ctx.r.hero) ctx.patches.set(el.id, uniformPatch(el, map.k, map.from, map.to));
}

/**
 * A gap between rows on the new artboard. A small one is the type's rhythm
 * and follows the type's size; a large one is room in the layout and follows
 * the artboard's height.
 */
function gapAfterScaling(ctx: Ctx, gap: number, ft: number): number {
  return gap > ctx.r.height * 0.06 ? gap * Math.min(ctx.sy, ft) : gap * ft;
}

/** Gap above row `i` in the design: from the board's top or the row before. */
function gapsOf(rows: Row[], startY: number): number[] {
  return rows.map((row, i) => row.box.y - (i === 0 ? startY : rows[i - 1].box.y + rows[i - 1].box.height));
}

/**
 * The design's own order, top to bottom: the text above the devices stays
 * above, the text below stays below, and the devices fill what is left the
 * way they filled it before. Text that sat beside the devices goes above them.
 */
function layoutStacked(ctx: Ctx, ft0: number): boolean {
  const { r, W2, H2, sx, sy } = ctx;
  const hero = r.heroBox;
  const above = r.rows.filter((row) => row.place !== 'below').sort((a, b) => a.box.y - b.box.y);
  const below = r.rows.filter((row) => row.place === 'below').sort((a, b) => a.box.y - b.box.y);
  const column = { x: 0, width: W2, sourceX: 0, sourceWidth: r.width };

  let ft = ft0;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const margin = Math.min(sy, ft);
    const sizedAbove = above.map((row) => sizeRow(ctx, row, ft, column, 'source'));
    const sizedBelow = below.map((row) => sizeRow(ctx, row, ft, column, 'source'));

    // Text above, from the top.
    const aboveTops: number[] = [];
    let y = 0;
    const aboveGaps = gapsOf(above, 0);
    sizedAbove.forEach((sized, i) => {
      const gap = i === 0 ? Math.max(0, aboveGaps[0]) * margin : gapAfterScaling(ctx, aboveGaps[i], ft);
      y += gap;
      aboveTops.push(y);
      y += sized.height;
    });
    // Text below, from the bottom.
    const belowTops: number[] = new Array(sizedBelow.length);
    let yb = H2;
    const belowGaps = below.map((row, i) =>
      (i === below.length - 1 ? r.height : below[i + 1].box.y) - (row.box.y + row.box.height)
    );
    for (let i = sizedBelow.length - 1; i >= 0; i -= 1) {
      const gap = i === sizedBelow.length - 1 ? Math.max(0, belowGaps[i]) * margin : gapAfterScaling(ctx, belowGaps[i], ft);
      yb -= gap + sizedBelow[i].height;
      belowTops[i] = yb;
    }

    // Text that sat beside the devices now sits over them, so the devices get
    // the room under it, measured against what showed of them on the board.
    const sideText = above.some((row) => row.place === 'left' || row.place === 'right');
    const boardBox = { x: 0, y: 0, width: r.width, height: r.height };
    // What the design showed, before any frame changed shape.
    const was = ctx.heroBefore ?? hero;
    const visibleHero = was ? intersect(was, boardBox) : null;
    const textBottom2 = above.length ? aboveTops[aboveTops.length - 1] + sizedAbove[sizedAbove.length - 1].height : 0;
    const topRef = sideText && visibleHero
      ? visibleHero.y
      : above.length ? above[above.length - 1].box.y + above[above.length - 1].box.height : 0;
    const botRef = sideText && visibleHero
      ? visibleHero.y + visibleHero.height
      : below.length ? below[0].box.y : r.height;
    const topRef2 = sideText ? textBottom2 + H2 * 0.03 : textBottom2;
    const botRef2 = below.length ? belowTops[0] : H2;

    let heroMap: HeroMap | null = null;
    if (hero) {
      const span = botRef - topRef;
      const span2 = botRef2 - topRef2;
      // Too little room left for the devices: smaller text, and try again.
      if (span2 < Math.min(span * sy, H2) * 0.62 && attempt < 4 && r.rows.length > 0) {
        ft *= 0.88;
        continue;
      }
      if (span <= 0 || span2 <= 0) return false;
      const hangs = overhang(hero, r.width, r.height);
      // A frame that changed shape shows as much height as the design's did.
      const shownBefore = intersect(was!, boardBox).height;
      const shownNow = intersect(hero, boardBox).height;
      const fill = shownBefore > 0 && shownNow > 0 ? shownBefore / shownNow : 1;
      const kH = (span2 / span) * fill;
      const kW = hangs.left || hangs.right
        ? sx
        : (W2 - (Math.max(0, hero.x) + Math.max(0, r.width - (hero.x + hero.width))) * Math.min(sx, ft)) / hero.width;
      const k = Math.max(0.05, Math.min(kH, kW));
      const width2 = hero.width * k;
      const height2 = hero.height * k;
      // Across: an edge it hung off stays hung off, otherwise its place from the middle.
      let x2: number;
      if (hangs.right && !hangs.left) x2 = W2 + (hero.x + hero.width - r.width) * k - width2;
      else if (hangs.left && !hangs.right) x2 = hero.x * k;
      else x2 = W2 / 2 + (hero.x + hero.width / 2 - r.width / 2) * sx - width2 / 2;
      // Down: likewise for the top and bottom, otherwise the same gaps.
      let y2: number;
      const bleedsBottom = hangs.bottom && below.length === 0;
      const bleedsTop = hangs.top && above.length === 0;
      if (bleedsBottom) y2 = H2 + (hero.y + hero.height - r.height) * k - height2;
      else if (bleedsTop) y2 = hero.y * k;
      else {
        // The design's gap above the devices, and any height the devices
        // could not fill split above and below them.
        const ratio = span2 / span;
        const wanted = shownBefore * ratio;
        y2 = topRef2 + (was!.y - topRef) * ratio + (wanted - shownNow * k) / 2;
      }
      heroMap = { k, from: { x: hero.x, y: hero.y }, to: { x: x2, y: y2 } };
    }

    // No devices, a block at the top and one at the bottom, and no room
    // between them: smaller type, and try again.
    if (!hero && sizedAbove.length > 0 && sizedBelow.length > 0 && y > belowTops[0] - H2 * 0.03) {
      if (attempt < 4) {
        ft *= 0.88;
        continue;
      }
      return false;
    }

    // No devices: the text keeps its place down the artboard.
    if (!hero && sizedAbove.length > 0) {
      const blockTop = above[0].box.y;
      const blockBottom = above[above.length - 1].box.y + above[above.length - 1].box.height;
      const block2 = y - aboveTops[0];
      const middle2 = ((blockTop + blockBottom) / 2) * sy;
      const shift = Math.max(0, Math.min(H2 - block2, middle2 - block2 / 2)) - aboveTops[0];
      for (let i = 0; i < aboveTops.length; i += 1) aboveTops[i] += shift;
    }

    sizedAbove.forEach((sized, i) => commitRow(ctx, sized, aboveTops[i]));
    sizedBelow.forEach((sized, i) => commitRow(ctx, sized, belowTops[i]));
    if (heroMap) placeHero(ctx, heroMap);
    placeBands(ctx, heroMap);
    placeDecor(ctx, r.decor, ft);
    return true;
  }
  return false;
}

/**
 * Text in a column on one side and the devices on the other, for a screen
 * wider than it is tall. `flipped` puts the devices on the left.
 */
function layoutBeside(ctx: Ctx, ft0: number, flipped: boolean): boolean {
  const { r, W2, H2, sy } = ctx;
  const hero = r.heroBox;
  if (!hero || r.rows.length === 0) return false;
  const rows = [...r.rows].sort((a, b) => a.box.y - b.box.y);
  const margin = W2 * 0.06;
  const gap = W2 * 0.04;
  const inner = W2 - margin * 2 - gap;
  const textWidth = inner * 0.44;
  const heroWidth = inner - textWidth;
  const textX = flipped ? margin + heroWidth + gap : margin;
  const heroX = flipped ? margin : margin + textWidth + gap;
  const column = { x: textX, width: textWidth, sourceX: 0, sourceWidth: r.width };

  let ft = ft0;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const sized = rows.map((row) => sizeRow(ctx, row, ft, column, 'column'));
    // In a column of its own the text closes up where the devices sat between two rows.
    const gaps = gapsOf(rows, 0).map((value, i) =>
      i === 0 ? 0 : Math.min(gapAfterScaling(ctx, Math.max(0, value), ft), H2 * 0.05)
    );
    const stack = sized.reduce((sum, row, i) => sum + gaps[i] + row.height, 0);
    if (stack > H2 * 0.84 && attempt < 5) {
      ft *= 0.88;
      continue;
    }
    let y = (H2 - stack) / 2;
    sized.forEach((row, i) => {
      y += gaps[i];
      commitRow(ctx, row, y);
      y += row.height;
    });

    // The devices: as tall as they were on the board, a little taller, and
    // never wider than their column. The share is the design's, before any
    // frame changed shape.
    const boardBox = { x: 0, y: 0, width: r.width, height: r.height };
    const shownBefore = intersect(ctx.heroBefore ?? hero, boardBox).height;
    const shownNow = intersect(hero, boardBox).height;
    const share = Math.min(0.9, Math.max(0.6, shownBefore / r.height + 0.1));
    const k = Math.max(0.05, Math.min((share * H2) / Math.max(1, shownNow), heroWidth / hero.width));
    const width2 = hero.width * k;
    const height2 = hero.height * k;
    const x2 = heroX + (heroWidth - width2) / 2;
    const hangs = overhang(hero, r.width, r.height);
    let y2: number;
    if (hangs.bottom) y2 = H2 + (hero.y + hero.height - r.height) * k - height2;
    else if (hangs.top) y2 = hero.y * k;
    else y2 = (H2 - height2) / 2;
    const heroMap: HeroMap = { k, from: { x: hero.x, y: hero.y }, to: { x: x2, y: y2 } };
    placeHero(ctx, heroMap);
    placeBands(ctx, heroMap);
    placeDecor(ctx, r.decor, Math.min(ft, sy * 1.2));
    return true;
  }
  return false;
}

/** convertArtboardsToFormat's scaling: one factor, centred. */
function layoutScaled(board: ArtboardState, target: Size): Map<string, ElementPatch> {
  const scaled = scaleElementsToCanvas(board.elements, board.size, target);
  const patches = new Map<string, ElementPatch>();
  board.elements.forEach((el, i) => {
    const next = scaled[i];
    if (el.type === 'text') {
      patches.set(el.id, {
        position: next.position,
        size: next.size,
        scale: el.scale,
        fontScale: (next as TextElementProps).fontSize / Math.max(1e-6, (el as TextElementProps).fontSize),
      });
    } else {
      patches.set(el.id, { position: next.position, size: next.size, scale: next.scale });
    }
  });
  return patches;
}

/**
 * A frame that changed shape keeps hanging off the edges the first one hung off,
 * by the same share of its size: a phone cut off at the bottom becomes an iPad
 * cut off at the bottom. The pictures fitted to its screen move with it.
 */
function keepEdges(elements: ArtboardElement[], before: ArtboardElement, refitted: Set<string>, size: Size): ArtboardElement[] {
  const device = elements.find((el) => el.id === before.id);
  if (!device) return elements;
  const was = elementVisualBounds(before);
  const now = elementVisualBounds(device);
  const hangs = overhang(was, size.width, size.height);
  let dx = 0;
  let dy = 0;
  if (hangs.bottom && !hangs.top) {
    dy = size.height + ((was.y + was.height - size.height) / was.height) * now.height - (now.y + now.height);
  } else if (hangs.top && !hangs.bottom) {
    dy = (was.y / was.height) * now.height - now.y;
  }
  if (hangs.right && !hangs.left) {
    dx = size.width + ((was.x + was.width - size.width) / was.width) * now.width - (now.x + now.width);
  } else if (hangs.left && !hangs.right) {
    dx = (was.x / was.width) * now.width - now.x;
  }
  if (!dx && !dy) return elements;
  return elements.map((el) =>
    el.id === before.id || refitted.has(el.id)
      ? { ...el, position: { x: el.position.x + dx, y: el.position.y + dy } }
      : el
  );
}

/**
 * After a frame changed shape (a phone became an iPad), what sat on it or was
 * grouped with it keeps its place on the frame, as a share of the frame's
 * width and height: a badge on a phone's top corner goes to the iPad's top
 * corner. Sizes stay. Pictures already fitted to the new screen are left alone.
 */
function followFrame(elements: ArtboardElement[], before: ArtboardElement, refitted: Set<string>): ArtboardElement[] {
  const after = elements.find((el) => el.id === before.id);
  if (!after) return elements;
  const from = elementVisualBounds(before);
  const to = elementVisualBounds(after);
  if (from.width <= 0 || from.height <= 0) return elements;
  return elements.map((el) => {
    if (el.id === before.id || refitted.has(el.id) || !hasCanvasBox(el) || isDevice(el)) return el;
    const box = elementVisualBounds(el);
    const rides = coveredBy(box, from) >= 0.25 || (!!before.groupId && el.groupId === before.groupId);
    if (!rides) return el;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const nx = to.x + ((cx - from.x) / from.width) * to.width;
    const ny = to.y + ((cy - from.y) / from.height) * to.height;
    return { ...el, position: { x: el.position.x + nx - cx, y: el.position.y + ny - cy } };
  });
}

/** The layout a board gets when nobody picked one. */
export function automaticLayout(board: ArtboardState, target: Size): DeviceLayout {
  const reading = readBoard(board);
  return pickLayout(reading, target);
}

/** True when the two sizes have the same shape, within 3%: the design only needs scaling. */
export function sameShape(a: Size, b: Size): boolean {
  return Math.abs(Math.log((a.width / a.height) / (b.width / b.height))) < 0.03;
}

function pickLayout(reading: Reading, target: Size): DeviceLayout {
  if (sameShape({ width: reading.width, height: reading.height }, target)) return 'scaled';
  const wide = target.width / target.height >= 1.15;
  if (!wide || !reading.heroBox || reading.rows.length === 0) return 'stacked';
  const side = reading.rows.find((row) => row.place === 'left' || row.place === 'right');
  if (side) return side.place === 'right' ? 'beside-flipped' : 'beside';
  const hero = reading.heroBox;
  return hero.width / hero.height <= 1.2 ? 'beside' : 'stacked';
}

/** The layouts that make sense for this board on this screen, best first. */
export function layoutsFor(board: ArtboardState, target: Size): DeviceLayout[] {
  const reading = readBoard(board);
  const auto = pickLayout(reading, target);
  const list: DeviceLayout[] = [auto];
  const canSide = !!reading.heroBox && reading.rows.length > 0;
  for (const layout of ['stacked', 'beside', 'beside-flipped', 'scaled'] as DeviceLayout[]) {
    if (list.includes(layout)) continue;
    if ((layout === 'beside' || layout === 'beside-flipped') && !canSide) continue;
    list.push(layout);
  }
  return list;
}

/**
 * Works out where every element of `board` goes on a `target` sized artboard.
 * `frames` swaps device frames first (element id to the new device), so the
 * layout is worked out for the frames the artboard will show.
 */
export function planBoard(
  board: ArtboardState,
  target: Size,
  layout: DeviceLayout | 'auto',
  options: { measure?: TextMeasure | null; frames?: Map<string, DeviceType> } = {}
): BoardPlan {
  // Swap the frames in the design's own space, so the hero is measured with them.
  let elements = board.elements;
  const frames = new Map<string, DeviceType>();
  const overlayRadii = new Map<string, number>();
  for (const [id, deviceType] of options.frames ?? []) {
    const before = elements.find((el) => el.id === id);
    const swapped = swapDeviceInElements(elements, id, deviceType);
    if (!before || !swapped) continue;
    const refitted = new Set<string>();
    swapped.forEach((el, i) => {
      if (el === elements[i] || el.id === id) return;
      refitted.add(el.id);
      if (typeof (el as { borderRadius?: number }).borderRadius === 'number') {
        overlayRadii.set(el.id, (el as { borderRadius: number }).borderRadius);
      }
    });
    elements = followFrame(keepEdges(swapped, before, refitted, board.size), before, refitted);
    frames.set(id, deviceType);
  }
  const swappedBoard: ArtboardState = elements === board.elements ? board : { ...board, elements };

  const reading = readBoard(swappedBoard);
  const chosen = layout === 'auto' ? pickLayout(reading, target) : layout;
  const sx = target.width / board.size.width;
  const sy = target.height / board.size.height;
  const ft = Math.sqrt(sx * sy);
  const original = new Map(board.elements.map((el) => [el.id, el]));
  const before = reading.hero
    .map((item) => original.get(item.el.id))
    .filter((el): el is ArtboardElement => !!el)
    .map(elementVisualBounds);
  const ctx: Ctx = {
    r: reading,
    heroBefore: before.length > 0 ? union(before) : null,
    W2: target.width,
    H2: target.height,
    sx,
    sy,
    measure: options.measure ?? null,
    patches: new Map(),
  };

  // A layout someone picked is tried alone. The automatic one is the best
  // guess first, then every other rebuilt layout, and only when none of them
  // fits is the artboard shrunk to fit.
  const tries: DeviceLayout[] =
    layout === 'auto'
      ? [chosen, ...(['stacked', 'beside', 'beside-flipped'] as DeviceLayout[]).filter((other) => other !== chosen)]
      : [chosen];
  const canSide = !!reading.heroBox && reading.rows.length > 0;
  let used: DeviceLayout = 'scaled';
  for (const attempt of tries) {
    if (attempt === 'scaled') break;
    if ((attempt === 'beside' || attempt === 'beside-flipped') && !canSide) continue;
    ctx.patches = new Map();
    const placed =
      attempt === 'stacked' ? layoutStacked(ctx, ft) : layoutBeside(ctx, ft, attempt === 'beside-flipped');
    if (!placed) continue;
    placeBackdrops(ctx);
    placeCrossing(ctx);
    if (looksRight(swappedBoard, ctx)) {
      used = attempt;
      break;
    }
  }
  if (used === 'scaled') ctx.patches = layoutScaled(swappedBoard, target);

  // The frame and its fitted overlays go into the patches too.
  for (const [id, deviceType] of frames) {
    const patch = ctx.patches.get(id);
    if (patch) patch.deviceType = deviceType;
  }
  for (const [id, radius] of overlayRadii) {
    const patch = ctx.patches.get(id);
    if (patch) patch.borderRadius = radius;
  }
  // Fell back: shrunk to fit because no rebuilt layout that was tried fits.
  return { layout: used, fellBack: used === 'scaled' && chosen !== 'scaled', size: { ...target }, patches: ctx.patches, frames };
}

/**
 * The checks a rebuilt layout has to pass, or the board falls back to the
 * scaled one: text that showed whole still does, anything else that showed
 * whole still mostly shows, and no text runs into the devices further than
 * it did in the design.
 */
function looksRight(board: ArtboardState, ctx: Ctx): boolean {
  const before: Bounds = { x: 0, y: 0, width: ctx.r.width, height: ctx.r.height };
  const frame: Bounds = { x: -2, y: -2, width: ctx.W2 + 4, height: ctx.H2 + 4 };
  const after = new Map<string, Bounds>();
  for (const el of board.elements) {
    const patch = ctx.patches.get(el.id);
    if (!patch || !hasCanvasBox(el)) continue;
    const moved = {
      ...el,
      position: patch.position,
      size: patch.size,
      scale: patch.scale ?? el.scale,
    } as ArtboardElement;
    const box = elementVisualBounds(moved);
    after.set(el.id, box);
    const was = coveredBy(elementVisualBounds(el), before);
    if (was < 0.9) continue;
    const now = coveredBy(box, frame);
    if (el.type === 'text' ? now < 0.98 : now < 0.75) return false;
  }
  // Text set again runs into no other text, and no further into a device,
  // than it did in the design.
  const textsBefore = ctx.r.rows.flatMap((row) => row.texts);
  const devicesBefore = ctx.r.hero.filter((item) => isDevice(item.el));
  for (const text of textsBefore) {
    const box = after.get(text.el.id);
    if (!box) continue;
    for (const other of textsBefore) {
      if (other === text) continue;
      const otherBox = after.get(other.el.id);
      if (!otherBox) continue;
      if (coveredBy(box, otherBox) > coveredBy(text.box, other.box) + 0.1) return false;
    }
    for (const device of devicesBefore) {
      const deviceBox = after.get(device.el.id);
      if (!deviceBox) continue;
      if (coveredBy(box, deviceBox) > coveredBy(text.box, device.box) + 0.15) return false;
    }
  }
  return true;
}

/**
 * The plan applied to an artboard: the base one it was worked out on, or the
 * same artboard in another language. Text in another language keeps its box
 * and, where it is longer, its size comes down until it fits (with `measure`).
 */
export function applyPlan(board: ArtboardState, plan: BoardPlan, measure?: TextMeasure | null): ArtboardState {
  const elements = board.elements.map((el): ArtboardElement => {
    const patch = plan.patches.get(el.id);
    if (!patch) return el;
    const next: Record<string, unknown> = { ...el, position: { ...patch.position } };
    if (patch.size) next.size = { ...patch.size };
    if (patch.scale !== undefined) next.scale = patch.scale;
    if (el.type === 'text' && patch.fontScale !== undefined) {
      const text = el as TextElementProps;
      const k = patch.fontScale;
      next.fontSize = text.fontSize * k;
      if (typeof text.letterSpacing === 'number') next.letterSpacing = text.letterSpacing * k;
      if (typeof text.outlineWidth === 'number') next.outlineWidth = text.outlineWidth * k;
      if (measure) fitInBox(next as unknown as TextElementProps, measure);
    }
    if (patch.deviceType && el.type === 'device') next.deviceType = patch.deviceType;
    if (patch.borderRadius !== undefined && (el.type === 'image' || el.type === 'shape')) next.borderRadius = patch.borderRadius;
    return next as unknown as ArtboardElement;
  });
  return { ...board, size: { ...plan.size }, elements };
}

/** Brings a text's size down, in steps, until it fits its box. Never below 60%. */
function fitInBox(text: TextElementProps, measure: TextMeasure) {
  const start = text.fontSize;
  const ratio = (value: number) => value / start;
  let needs = measure(text);
  if (!(needs > 0) || needs <= text.size.height + 1) return;
  const spacing = text.letterSpacing;
  const outline = text.outlineWidth;
  let size = start;
  while (needs > text.size.height + 1 && ratio(size) > 0.6) {
    size *= 0.95;
    text.fontSize = size;
    if (typeof spacing === 'number') text.letterSpacing = spacing * ratio(size);
    if (typeof outline === 'number') text.outlineWidth = outline * ratio(size);
    needs = measure(text);
    if (!(needs > 0)) break;
  }
}

/** True when the element is a device frame the plan may give another frame. */
export function isSwappableDevice(el: ArtboardElement): el is DeviceFrameElementProps {
  if (el.type !== 'device') return false;
  const category = getDeviceDescriptor((el as DeviceFrameElementProps).deviceType).category;
  return category !== 'custom' && category !== 'watch';
}

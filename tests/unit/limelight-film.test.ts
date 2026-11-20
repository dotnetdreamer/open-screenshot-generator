// What the App intro's second design added to Limelight: picture cards (the
// app's icon, a card lifted off a screen), the glow backdrop, highlighted
// words, the cards found in screenshots, and the music made for a scene.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { actorAt, frameMediaIds, sceneAt } from '@/lib/limelight/animate';
import { findCard, type FoundCard } from '@/lib/limelight/cards';
import { highlightStarts, retimeScene, stagePoints, updateActor } from '@/lib/limelight/edit';
import { AT, CINEMATIC, buildIntro, cardOnScreen, highlightedWords } from '@/lib/limelight/introTemplate';
import { stageModelFor } from '@/lib/limelight/models';
import { MUSIC_BAR, MUSIC_BEAT, cutTimes, frequency, musicPlan } from '@/lib/limelight/music';
import { newPictureActor, newScene, normalizeHighlight, normalizeMusic, normalizeScene, sceneMediaIds } from '@/lib/limelight/scene';
import { secondGlow } from '@/lib/limelight/stage/environment';
import { fromMyTemplate, type TemplateInput } from '@/lib/limelight/templates';
import type { DeviceActor, LimelightScene, PictureActor } from '@/lib/limelight/types';

const close = (actual: number, expected: number, tolerance = 1e-6, label = '') =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} expected ${expected}, got ${actual}`);
const named = (scene: LimelightScene, name: string) => scene.actors.find((actor) => actor.name === name);
const intro = (input: TemplateInput) => buildIntro(input, CINEMATIC);
const F = AT.features;
const BOARD = ['media_a', 'media_b', 'media_c', 'media_d'];
const CAPTIONS = ['Manage budget without stress', 'Set Monthly Spending Limits', 'Voice Powered Expense Logging'];
const D = Math.PI / 180;

// ---------------------------------------------------------------------------
// Picture cards
// ---------------------------------------------------------------------------

test('limelight film: a picture card reads back as it was, and a broken one is mended or dropped', () => {
  const card = newPictureActor('media_icon', { width: 6, aspect: 1, corner: 0.225, depth: 0.7 });
  card.crop = { x: 0.1, y: 0.2, width: 0.5, height: 0.3 };
  card.shine = 12.2;
  const scene = { ...newScene(), actors: [card] };
  const back = normalizeScene(JSON.parse(JSON.stringify(scene)));
  assert.deepEqual(back.actors[0], card);
  // Out-of-range numbers are clamped, a bad picture id is a blank card, a crop stays inside the picture.
  const mended = normalizeScene({ ...scene, actors: [{ ...card, media: '../../etc', corner: 3, depth: -1, glare: 9, crop: { x: 0.8, y: -1, width: 2, height: 0 } }] }).actors[0] as PictureActor;
  assert.equal(mended.media, null);
  assert.equal(mended.corner, 0.5);
  assert.equal(mended.depth, 0);
  assert.equal(mended.glare, 1);
  assert.ok(mended.crop && mended.crop.x + mended.crop.width <= 1 + 1e-9 && mended.crop.y === 0 && mended.crop.height > 0);
  // A whole-picture crop is no crop.
  assert.equal((normalizeScene({ ...scene, actors: [{ ...card, crop: { x: 0, y: 0, width: 1, height: 1 } }] }).actors[0] as PictureActor).crop, undefined);
  // An unknown kind is still dropped.
  assert.equal(normalizeScene({ ...scene, actors: [{ ...card, kind: 'hologram' }] }).actors.length, 0);
});

test("limelight film: a card's picture is the scene's, loaded only while the card shows, and its sweep keeps time with the video", () => {
  const card = newPictureActor('media_icon', { width: 6, aspect: 1 });
  card.poses = [
    { ...card.poses[0], time: 0, ease: 'cut', opacity: 0 },
    { ...card.poses[0], id: 'pose_b', time: 5, ease: 'smooth', opacity: 1 },
  ];
  card.shine = 6;
  const scene = { ...newScene({ media: 'media_screen' }), actors: [...newScene({ media: 'media_screen' }).actors, card] };
  assert.deepEqual([...sceneMediaIds(scene)].sort(), ['media_icon', 'media_screen']);
  assert.deepEqual([...frameMediaIds(sceneAt(scene, 1))], ['media_screen'], 'not while it is hidden');
  assert.deepEqual([...frameMediaIds(sceneAt(scene, 5.5))].sort(), ['media_icon', 'media_screen']);
  const twice = retimeScene(scene, 2).actors[1] as PictureActor;
  assert.equal(twice.shine, 12);
  // Its corners count when a shot is framed, thickness and all.
  const points = stagePoints({ ...scene, actors: [{ ...card, depth: 1 }] }, 6);
  assert.equal(points.length, 8);
  close(Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x)), 6, 1e-9, 'across');
  // Width and corners change through the same edit as any actor.
  const wider = updateActor(scene, card.id, { width: 8, corner: 0.3 }).actors[1] as PictureActor;
  assert.equal(wider.width, 8);
  assert.equal(wider.corner, 0.3);
});

// ---------------------------------------------------------------------------
// Highlighted words, the glow
// ---------------------------------------------------------------------------

test('limelight film: the last words of a title take the highlight, counted back across its lines', () => {
  assert.deepEqual(highlightStarts(['Manage budget', 'without stress'], 2), [13, 0]);
  assert.deepEqual(highlightStarts(['Manage budget', 'without stress'], 1), [13, 8]);
  assert.deepEqual(highlightStarts(['Manage budget', 'without stress'], 3), [7, 0]);
  assert.deepEqual(highlightStarts(['Manage budget', 'without stress'], 9), [0, 0]);
  assert.deepEqual(highlightStarts(['One line'], 0), [8]);
  // A caption's last line takes the colour; one line of three words or more, its last word; a word or two, none.
  assert.equal(highlightedWords('Manage budget\nwithout stress'), 2);
  assert.equal(highlightedWords('Track every habit'), 1);
  assert.equal(highlightedWords('Two words'), 0);
  assert.deepEqual(normalizeHighlight({ color: '#FF00AA', words: 2.4 }), { color: '#ff00aa', words: 2 });
  assert.equal(normalizeHighlight({ color: '#ff00aa', words: 0 }), undefined);
  assert.equal(normalizeHighlight({ color: 'pink', words: 2 }), undefined);
});

test("limelight film: the glow backdrop reads back, and its second light is the next hue along, a little deeper", () => {
  const scene = newScene();
  const glow = normalizeScene({ ...scene, look: { ...scene.look, backdrop: { style: 'glow', top: '#2f9155', bottom: '#030806' } } });
  assert.deepEqual(glow.look.backdrop, { style: 'glow', top: '#2f9155', bottom: '#030806' });
  assert.equal(normalizeScene({ ...scene, look: { ...scene.look, backdrop: { style: 'plasma', top: '#2f9155', bottom: '#030806' } } }).look.backdrop.style, scene.look.backdrop.style);
  const hsl = { h: 0, s: 0, l: 0 };
  const first = new THREE.Color('#2f9155').getHSL({ ...hsl });
  const second = secondGlow('#2f9155').getHSL({ ...hsl });
  close((second.h - first.h + 1) % 1, 0.16, 1e-6, 'a sixth of the way round');
  assert.ok(second.l < first.l);
  // A grey has no hue to move along: it stays a grey.
  close(secondGlow('#808080').getHSL({ ...hsl }).s, 0, 1e-6, 'grey');
});

// ---------------------------------------------------------------------------
// The App intro's icon, cards and music
// ---------------------------------------------------------------------------

test("limelight intro: with the project's icon it closes on a glossy tile, the phones gone on the cut; without one it closes on the phone", () => {
  const withIcon = intro({ pictures: BOARD, title: 'Budgetly', captions: CAPTIONS, icon: 'media_icon' });
  const tile = named(withIcon, 'App icon') as PictureActor;
  assert.equal(tile.kind, 'picture');
  assert.equal(tile.media, 'media_icon');
  assert.equal(tile.width, tile.height, 'square');
  close(tile.corner, 0.225, 1e-9, "Apple's icon corner");
  assert.ok(tile.depth > 0, 'a tile with an edge, not a sheet');
  // Hidden until the close, then popping in past its size and settling.
  assert.equal(actorAt(tile, AT.end - 0.1).opacity, 0);
  assert.equal(actorAt(tile, AT.end + 0.4).opacity, 1);
  assert.ok(Math.max(...[0.3, 0.4, 0.5, 0.6].map((dt) => actorAt(tile, AT.end + dt).scale)) > 1, 'it goes a little past its size');
  close(actorAt(tile, AT.end + 1.5).scale, 1, 1e-9, 'and settles');
  assert.ok(tile.shine !== undefined && tile.shine > AT.end + 0.5 && tile.shine < 15 - 1, 'a light sweeps across it once it has landed');
  for (const phone of withIcon.actors.filter((actor) => actor.kind === 'device')) {
    assert.equal(actorAt(phone, AT.end + 0.01).opacity, 0, `${phone.name} is gone on the cut to the icon`);
  }
  const without = intro({ pictures: BOARD, title: 'Budgetly', captions: CAPTIONS });
  assert.equal(without.actors.filter((actor) => actor.kind === 'picture').length, 0);
  assert.equal(actorAt(named(without, 'iPhone 17 Pro')!, 14.9).opacity, 1, 'the phone stays for the close');
  // The three phones are there from the pull back, and the two beside it only then.
  for (const name of ['Left phone', 'Right phone']) {
    assert.equal(actorAt(named(without, name)!, AT.trio - 0.1).opacity, 0, `${name} is out of the picture before`);
    assert.equal(actorAt(named(without, name)!, AT.trio + 1).opacity, 1);
  }
});

/** A card a fifth of the screen tall, a third of the way down, in a picture the display's own shape. */
function cardFor(device: 'iphone-17-pro', crop = { x: 0.05, y: 0.3, width: 0.9, height: 0.2 }): FoundCard {
  const model = stageModelFor(device)!;
  return { crop, aspect: model.display.width / model.display.height };
}

test('limelight intro: a card lies on the screen where it shows in the picture, clipped to the display', () => {
  const model = stageModelFor('iphone-17-pro')!;
  const dw = model.display.width / 10;
  const dh = model.display.height / 10;
  const place = cardOnScreen('iphone-17-pro', cardFor('iphone-17-pro'))!;
  close(place.x, 0, 1e-9, 'across');
  close(place.y, dh * (0.5 - 0.4), 1e-9, 'its middle two fifths of the way down');
  close(place.width, 0.9 * dw, 1e-9, 'width');
  close(place.height, 0.2 * dh, 1e-9, 'height');
  close(place.z, model.thickness / 20 + 0.02, 1e-9, 'on the glass');
  // A picture wider than the display is cropped at its sides, as the screen shows it: a card at its edge is cut to the display.
  const wide = cardOnScreen('iphone-17-pro', { crop: { x: 0, y: 0.3, width: 0.5, height: 0.2 }, aspect: (model.display.width / model.display.height) * 1.5 })!;
  close(wide.x - wide.width / 2, -dw / 2, 1e-9, 'its left edge is the display');
  // A card the screen doesn't show is none.
  assert.equal(cardOnScreen('iphone-17-pro', { crop: { x: 0, y: 0.3, width: 0.1, height: 0.2 }, aspect: (model.display.width / model.display.height) * 3 }), null);
});

test('limelight intro: a lifted card starts on the glass over its own picture, rises toward the camera, and is gone before the screen changes', () => {
  const model = stageModelFor('iphone-17-pro')!;
  const scene = intro({ pictures: BOARD, title: 'Budgetly', captions: CAPTIONS, cards: [cardFor('iphone-17-pro'), null, cardFor('iphone-17-pro', { x: 0.05, y: 0.55, width: 0.9, height: 0.25 })] });
  const phone = named(scene, 'iPhone 17 Pro') as DeviceActor;
  assert.equal(phone.motion.float, 0, 'a phone with cards keeps still for them');
  assert.equal(named(scene, 'Card 2'), undefined, 'no card where none was found');
  assert.equal(intro({ pictures: BOARD, title: 'Budgetly' }).actors.find((actor) => actor.kind === 'device')!.motion.float > 0, true, 'without cards the phone floats');
  const local = (t: number, actor: PictureActor, point: { x: number; y: number; z: number }) => {
    const body = actorAt(phone, t);
    const card = actorAt(actor, t);
    const turn = (f: typeof body) => new THREE.Quaternion().setFromEuler(new THREE.Euler(f.turn.pitch * D, f.turn.yaw * D, f.turn.roll * D, 'ZXY'));
    const world = new THREE.Vector3(point.x, point.y, point.z).multiplyScalar(card.scale).applyQuaternion(turn(card)).add(new THREE.Vector3(card.position.x, card.position.y, card.position.z));
    return world.sub(new THREE.Vector3(body.position.x, body.position.y, body.position.z)).applyQuaternion(turn(body).invert());
  };
  const screenChanges = phone.screens.map((screen) => screen.time);
  for (const [k, name] of [
    [0, 'Card 1'],
    [2, 'Card 3'],
  ] as const) {
    const actor = named(scene, name) as PictureActor;
    const up = F[k] + 0.75;
    assert.equal(actorAt(actor, up - 0.05).opacity, 0, `${name} is hidden until it lifts`);
    // The picture on the screen at that moment is the card's.
    assert.equal(sceneAt(scene, up).screens[phone.id].media, actor.media, `${name} shows what the screen shows`);
    // Its corners on the glass and inside the display, turned as the phone is.
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const p = local(up + 0.001, actor, { x: (sx * actor.width) / 2, y: (sy * actor.height) / 2, z: 0 });
      close(p.z, model.thickness / 20 + 0.02, 2e-3, `${name} on the glass`);
      assert.ok(Math.abs(p.x) <= model.display.width / 20 + 1e-6 && Math.abs(p.y) <= model.display.height / 20 + 1e-6, `${name} inside the display`);
    }
    // Then off the glass toward the camera, a little bigger.
    const lifted = local(up + 0.8, actor, { x: 0, y: 0, z: 0 });
    assert.ok(lifted.z > model.thickness / 20 + 2, `${name} rises off the screen (${lifted.z.toFixed(2)} cm)`);
    assert.ok(actorAt(actor, up + 0.8).scale > 1.05);
    // Gone before the next picture comes onto the screen.
    const next = screenChanges.find((t) => t > up)!;
    assert.equal(actorAt(actor, next - 0.05).opacity, 0, `${name} is gone before the screen changes at ${next.toFixed(2)}`);
  }
});

test("limelight intro: kept as the user's own template, it drops the cards cut from its old screenshots when new ones go in, and keeps the icon", () => {
  const scene = intro({ pictures: BOARD, title: 'Budgetly', captions: CAPTIONS, icon: 'media_icon', cards: [cardFor('iphone-17-pro'), null, cardFor('iphone-17-pro')] });
  assert.deepEqual(scene.actors.filter((actor) => actor.kind === 'picture').map((actor) => actor.name).sort(), ['App icon', 'Card 1', 'Card 3']);
  const reused = fromMyTemplate(scene, ['media_new_1', 'media_new_2']);
  const pictures = reused.actors.filter((actor): actor is PictureActor => actor.kind === 'picture');
  assert.deepEqual(pictures.map((actor) => actor.name), ['App icon']);
  assert.equal(pictures[0].media, 'media_icon');
  // Without new pictures it is the scene as it was, cards and all.
  assert.equal(fromMyTemplate(scene, []).actors.filter((actor) => actor.kind === 'picture').length, 3);
});

test('limelight intro: every cut is on a beat of its music, and the music marks each one', () => {
  const scene = intro({ pictures: BOARD, title: 'Budgetly', captions: CAPTIONS, icon: 'media_icon' });
  const cuts = cutTimes(scene);
  assert.deepEqual(cuts, [F[0], F[1], F[2], AT.trio, AT.end].map((t) => Math.round(t * 1000) / 1000));
  for (const t of cuts) close(Math.round(t / MUSIC_BEAT) * MUSIC_BEAT, t, 1e-3, `the cut at ${t}`);
  close(AT.end, 6 * MUSIC_BAR, 1e-9, 'the close starts on a bar');
  const plan = musicPlan('pulse', scene.format.duration, cuts);
  close(plan.groove, F[0], 1e-9, 'the drums come in on the first cut');
  close(plan.close, AT.end, 1e-9, 'and the music closes with the film');
  const crashes = plan.notes.filter((note) => note.voice === 'crash').map((note) => Math.round(note.time * 1000) / 1000);
  for (const t of cuts) assert.ok(crashes.includes(t), `a cymbal on the cut at ${t}`);
  assert.ok(plan.notes.some((note) => note.voice === 'impact' && Math.abs(note.time - AT.end) < 1e-9), 'a hit where the icon comes');
});

// ---------------------------------------------------------------------------
// The music
// ---------------------------------------------------------------------------

test('limelight film: a track is built on the beat: kicks on it, chords a bar each, nothing past the end, and the same every time', () => {
  for (const track of ['pulse', 'calm'] as const) {
    for (const duration of [15, 9.5, 30]) {
      const plan = musicPlan(track, duration, [MUSIC_BAR * 2]);
      assert.deepEqual(musicPlan(track, duration, [MUSIC_BAR * 2]), plan, `${track} ${duration}: the same plan every time`);
      assert.ok(plan.notes.every((note) => note.time >= 0 && note.time < duration), `${track} ${duration}: nothing past the end`);
      const kicks = plan.notes.filter((note) => note.voice === 'kick');
      assert.ok(kicks.length > 0);
      for (const kick of kicks) close(Math.round(kick.time / MUSIC_BEAT) * MUSIC_BEAT, kick.time, 1e-9, `${track}: a kick on the beat`);
      assert.ok(kicks.every((kick) => kick.time >= plan.groove - 1e-9), 'no kick before the groove');
      // Half time: kicks on the first and third beat of the bar only.
      if (track === 'calm') for (const kick of kicks.filter((k) => k.time < plan.close)) assert.equal(Math.round((kick.time - plan.groove) / MUSIC_BEAT) % 2, 0);
      // The close is the last two whole bars, a bar of groove at least before it.
      assert.equal(plan.close, Math.max(2 * MUSIC_BAR, (Math.floor(duration / MUSIC_BAR + 1e-6) - 2) * MUSIC_BAR));
      // Each bar of the groove holds its own chord.
      const pads = plan.notes.filter((note) => note.voice === 'pad' && note.time >= plan.groove && note.time < plan.close);
      const bars = new Set(pads.map((note) => Math.round((note.time - plan.groove) / MUSIC_BAR)));
      assert.equal(bars.size, Math.round((plan.close - plan.groove) / MUSIC_BAR));
    }
  }
  // Too short for a groove: the hit and nothing that runs past.
  const blip = musicPlan('pulse', 1);
  assert.ok(blip.notes.some((note) => note.voice === 'impact'));
  assert.equal(blip.notes.filter((note) => note.voice === 'kick').length, 0);
  close(frequency(69), 440, 1e-9, 'A4');
  close(frequency(57), 220, 1e-9, 'A3');
  // A track this build doesn't know is no music; the volume is kept to 0 to 1.
  assert.equal(normalizeMusic({ track: 'polka', volume: 1 }), undefined);
  assert.deepEqual(normalizeMusic({ track: 'calm', volume: 3 }), { track: 'calm', volume: 1 });
  const scene = newScene();
  assert.deepEqual(normalizeScene({ ...scene, music: { track: 'pulse', volume: 0.5 } }).music, { track: 'pulse', volume: 0.5 });
  assert.equal(normalizeScene(scene).music, undefined);
});

// ---------------------------------------------------------------------------
// Finding a card in a screenshot
// ---------------------------------------------------------------------------

/** A phone screenshot 160 pixels wide on one background colour, with rectangles drawn in shares of it. */
function screenshot(rects: Array<{ x: number; y: number; w: number; h: number; rgb: [number, number, number] }>, ground: (y: number) => [number, number, number] = () => [244, 245, 249]) {
  const w = 160;
  const h = 346;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const g = ground(y / h);
    for (let x = 0; x < w; x++) data.set([...g, 255], (y * w + x) * 4);
  }
  for (const r of rects) {
    for (let y = Math.round(r.y * h); y < Math.round((r.y + r.h) * h); y++) {
      for (let x = Math.round(r.x * w); x < Math.round((r.x + r.w) * w); x++) data.set([...r.rgb, 255], (y * w + x) * 4);
    }
  }
  return { data, w, h };
}

const WHITE: [number, number, number] = [255, 255, 255];
const PURPLE: [number, number, number] = [124, 92, 255];
const GREY: [number, number, number] = [150, 150, 156];

test('limelight film: the card found in a screenshot is a colourful panel of a good size between the bars, or none', () => {
  // A chart card and a list card of the better size: the chart's colour wins it.
  const chart = { x: 0.06, y: 0.24, w: 0.88, h: 0.28, rgb: WHITE };
  const bars = [0.15, 0.3, 0.45, 0.6].map((x, i) => ({ x, y: 0.36 - i * 0.01, w: 0.08, h: 0.13 + i * 0.01, rgb: PURPLE }));
  const list = { x: 0.06, y: 0.58, w: 0.88, h: 0.22, rgb: WHITE };
  const lines = [0.61, 0.66, 0.71].map((y) => ({ x: 0.1, y, w: 0.6, h: 0.015, rgb: GREY }));
  const shot = screenshot([chart, ...bars, list, ...lines]);
  const found = findCard(shot.data, shot.w, shot.h)!;
  assert.ok(found, 'a card');
  close(found.crop.y, 0.24, 0.02, 'the chart card, from its top');
  close(found.crop.height, 0.28, 0.03, 'to its bottom');
  close(found.crop.x, 0.06, 0.03, 'and from side to side');
  close(found.aspect, 160 / 346, 1e-9, 'shape');
  // The list alone is a card too, when it's all there is.
  const listOnly = screenshot([list, ...lines]);
  close(findCard(listOnly.data, listOnly.w, listOnly.h)!.crop.y, 0.58, 0.02, 'the list');
  // A photo with two plain stripes across it isn't a screen on a plain background: the photo between them is no card.
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const photo = screenshot([
    { x: 0, y: 0.1, w: 1, h: 0.1, rgb: [30, 30, 30] },
    { x: 0, y: 0.45, w: 1, h: 0.1, rgb: [30, 30, 30] },
  ]);
  for (let y = 0; y < photo.h; y++) {
    const share = y / photo.h;
    if ((share >= 0.1 && share < 0.2) || (share >= 0.45 && share < 0.55)) continue;
    for (let x = 0; x < photo.w; x++) photo.data.set([random() * 255, random() * 255, random() * 255, 255], (y * photo.w + x) * 4);
  }
  assert.equal(findCard(photo.data, photo.w, photo.h), null, 'no card in a photo');
  // Under the status bar or over the tab bar, or too small, it isn't one.
  for (const rect of [
    { x: 0.06, y: 0.0, w: 0.88, h: 0.2, rgb: PURPLE },
    { x: 0.06, y: 0.82, w: 0.88, h: 0.17, rgb: PURPLE },
    { x: 0.06, y: 0.4, w: 0.88, h: 0.05, rgb: PURPLE },
    { x: 0.4, y: 0.4, w: 0.2, h: 0.2, rgb: PURPLE },
  ]) {
    const only = screenshot([rect]);
    assert.equal(findCard(only.data, only.w, only.h), null, `no card at ${JSON.stringify(rect)}`);
  }
  // A screen without a plain background, a gradient from top to bottom, has none.
  const gradient = screenshot([chart, ...bars], (y) => [Math.round(40 + 180 * y), 90, Math.round(220 - 150 * y)]);
  assert.equal(findCard(gradient.data, gradient.w, gradient.h), null);
  // A picture too small to read has none.
  assert.equal(findCard(new Uint8ClampedArray(8 * 8 * 4), 8, 8), null);
});

// ---------------------------------------------------------------------------
// Loaded with the view, never with the editor
// ---------------------------------------------------------------------------

/** The files the editor's page loads with it: its static imports, followed, skipping `import type` and import(). */
function staticGraph(entry: string): Set<string> {
  const root = process.cwd();
  const seen = new Set<string>();
  const resolve = (from: string, spec: string): string | null => {
    const base = spec.startsWith('@/') ? path.join(root, 'src', spec.slice(2)) : spec.startsWith('.') ? path.resolve(path.dirname(from), spec) : null;
    if (!base) return null;
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return null;
  };
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/^\s*(import|export)\s+(?!type\s)([^;]*?)\s+from\s+['"]([^'"]+)['"]/gm)) {
      const next = resolve(file, match[3]);
      if (next) visit(next);
    }
    for (const match of source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) {
      const next = resolve(file, match[1]);
      if (next) visit(next);
    }
  };
  visit(entry);
  return seen;
}

test("limelight film: the intro, the music and the card finder come with Limelight's view, never with the editor", () => {
  const editor = staticGraph(path.join(process.cwd(), 'src/components/open-screenshot-generator/OpenScreenshotGeneratorLayout.tsx'));
  assert.ok(editor.size > 50, `the walk found the editor's files (${editor.size})`);
  assert.ok([...editor].some((file) => file.endsWith('src/lib/limelight/mcp.ts')), 'the agent tools come with the editor');
  for (const name of ['introTemplate.ts', 'music.ts', 'musicRender.ts', 'musicPlayer.ts', 'cards.ts']) {
    const reached = [...editor].filter((file) => file.endsWith(`src/lib/limelight/${name}`));
    assert.deepEqual(reached, [], `${name} loads with the editor`);
  }
  // The view itself brings them: its page is the one that imports them.
  const view = staticGraph(path.join(process.cwd(), 'src/components/open-screenshot-generator/limelight/LimelightWorkspace.tsx'));
  for (const name of ['music.ts', 'musicRender.ts', 'musicPlayer.ts', 'cards.ts']) {
    assert.ok([...view].some((file) => file.endsWith(`src/lib/limelight/${name}`)), `${name} comes with the view`);
  }
});

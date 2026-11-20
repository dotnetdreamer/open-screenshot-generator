// Limelight's App intro (src/lib/limelight/introTemplate.ts) and what it is
// made of: titles whose words come in one after another, the project's own
// headlines, colour, font and name, and the intro loading only when asked for.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { actorAt, revealEach, revealLook, revealProgress, sceneAt } from '@/lib/limelight/animate';
import { cameraPose } from '@/lib/limelight/camera';
import { setFormat, stagePoints, titleBox } from '@/lib/limelight/edit';
import { faceReady, loadTitleFaces } from '@/lib/limelight/fonts';
import { AT, CINEMATIC, balanceLines, buildAppIntro, buildIntro, cardOnScreen, highlightedWords } from '@/lib/limelight/introTemplate';
import type { TemplateInput } from '@/lib/limelight/templates';
import { FORMAT_PRESETS } from '@/lib/limelight/presets';
import { artboardHeadline, projectAccent, projectAppName, projectFont, projectShots } from '@/lib/limelight/projectShots';
import { normalizeReveal, normalizeScene } from '@/lib/limelight/scene';
import { TEMPLATES, buildTemplate, templateById } from '@/lib/limelight/templates';
import { TEXT_REVEAL_STYLES, type CameraState, type LimelightScene, type TextActor, type TextReveal } from '@/lib/limelight/types';
import type { ArtboardElement, ArtboardState } from '@/types/artboard';

const close = (actual: number, expected: number, tolerance = 1e-6, label = '') =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} expected ${expected}, got ${actual}`);

/** Where a point lands in the picture: -1 to 1 across and up is inside. */
function project(camera: CameraState, aspect: number, p: { x: number; y: number; z: number }): [number, number] {
  const pose = cameraPose(camera, aspect);
  const rel = { x: p.x - pose.position.x, y: p.y - pose.position.y, z: p.z - pose.position.z };
  const forward = { x: pose.target.x - pose.position.x, y: pose.target.y - pose.position.y, z: pose.target.z - pose.position.z };
  const length = Math.hypot(forward.x, forward.y, forward.z);
  const depth = (rel.x * forward.x + rel.y * forward.y + rel.z * forward.z) / length;
  const tan = Math.tan((pose.fov * Math.PI) / 360);
  return [(rel.x * pose.right.x + rel.y * pose.right.y + rel.z * pose.right.z) / (depth * tan * aspect), (rel.x * pose.up.x + rel.y * pose.up.y + rel.z * pose.up.z) / (depth * tan)];
}

const titles = (scene: LimelightScene) => scene.actors.filter((actor): actor is TextActor => actor.kind === 'text');
const named = (scene: LimelightScene, name: string) => scene.actors.find((actor) => actor.name === name);
/** The intro as built once its faces are in (buildAppIntro loads them first; Node has none to load). */
const intro = (input: TemplateInput) => buildIntro(input, CINEMATIC);

// ---------------------------------------------------------------------------
// Words that come in one after another
// ---------------------------------------------------------------------------

test('limelight intro: words come in one after another, in order, the last in place when the reveal ends', () => {
  const reveal: TextReveal = { style: 'rise', by: 'word', time: 2, duration: 1 };
  assert.deepEqual(revealProgress(reveal, 4, 1.99), [0, 0, 0, 0]);
  assert.deepEqual(revealProgress(reveal, 4, 3), [1, 1, 1, 1]);
  for (let t = 2; t <= 3; t += 0.01) {
    const progress = revealProgress(reveal, 4, t);
    for (let i = 1; i < 4; i++) assert.ok(progress[i - 1] >= progress[i], `at ${t.toFixed(2)} word ${i} is ahead of word ${i - 1}`);
  }
  // The first word starts at the reveal's time and takes `each`; the last lands at the end, not before.
  const each = revealEach(reveal, 4);
  close(revealProgress(reveal, 4, 2 + each / 2)[0], 0.5, 1e-9, 'first word halfway');
  assert.ok(revealProgress(reveal, 4, 2.99)[3] < 1, 'the last word is still coming in just before the end');
  // They overlap: the second has started before the first is in place.
  assert.ok(revealProgress(reveal, 4, 2 + each * 0.9)[1] > 0);
  // One word takes the whole reveal; no reveal has every word there from the start.
  close(revealProgress(reveal, 1, 2.5)[0], 0.5, 1e-9, 'one word');
  assert.deepEqual(revealProgress(undefined, 3, 0), [1, 1, 1]);
});

test('limelight intro: every reveal starts hidden and ends in place; a rising word comes up from behind its line; a pop goes a little past its size', () => {
  for (const style of TEXT_REVEAL_STYLES) {
    const start = revealLook(style, 0);
    const end = revealLook(style, 1);
    assert.equal(start.opacity, 0, `${style} starts hidden`);
    assert.deepEqual({ opacity: end.opacity, drop: end.drop, scale: end.scale }, { opacity: 1, drop: 0, scale: 1 }, `${style} ends in place`);
  }
  const rise = revealLook('rise', 0);
  assert.equal(rise.drop, 1);
  assert.equal(rise.masked, true);
  // It only ever moves up.
  let last = 1;
  for (let u = 0; u <= 1; u += 0.02) {
    const drop = revealLook('rise', u).drop;
    assert.ok(drop <= last + 1e-12, `rise goes back down at ${u}`);
    last = drop;
  }
  const peak = Math.max(...Array.from({ length: 201 }, (_, i) => revealLook('pop', i / 200).scale));
  assert.ok(peak > 1.03 && peak < 1.08, `pop peaks at ${peak}`);
});

test('limelight intro: a reveal reads back as it was, a style this build lacks is dropped, and a longer video stretches it', () => {
  const scene = intro({ pictures: ['media_a'], title: 'Juniper', captions: ['Track every habit'] });
  assert.ok(titles(scene).length >= 3);
  assert.ok(titles(scene).every((title) => title.reveal), 'every title of the intro comes in');
  assert.deepEqual(normalizeScene(JSON.parse(JSON.stringify(scene))), scene);
  assert.equal(normalizeReveal({ style: 'spin', time: 1 }), undefined);
  assert.equal(normalizeReveal(null), undefined);
  assert.deepEqual(normalizeReveal({ style: 'pop', by: 'sideways', time: -3, duration: 99 }), { style: 'pop', by: 'word', time: 0, duration: 10 });
  const longer = setFormat(scene, { duration: 30 }, true);
  for (const title of titles(scene)) {
    const stretched = titles(longer).find((t) => t.id === title.id)!.reveal!;
    close(stretched.time, title.reveal!.time * 2, 1e-9, `${title.name} starts`);
    close(stretched.duration, title.reveal!.duration * 2, 1e-9, `${title.name} takes`);
  }
});

// ---------------------------------------------------------------------------
// The film
// ---------------------------------------------------------------------------

const CAPTIONS = ['Manage budget without stress', 'Set Monthly Spending Limits', 'Voice Powered Expense Logging'];

const F = AT.features;
const BOARD = ['media_a', 'media_b', 'media_c', 'media_d'];

/** How far the furthest of these actors reaches across the picture at `t`: 1 is the frame's edge. */
function reach(scene: LimelightScene, names: string[], t: number): number {
  const aspect = scene.format.width / scene.format.height;
  const subset = { ...scene, actors: scene.actors.filter((actor) => names.includes(actor.name)) };
  assert.equal(subset.actors.length, names.length, `at ${t}: ${names.join(', ')}`);
  const camera = sceneAt(scene, t).camera;
  return Math.max(...stagePoints(subset, t).map((p) => project(camera, aspect, p)).map(([x, y]) => Math.max(Math.abs(x), Math.abs(y))));
}

test('limelight intro: at every size, with an icon and without, each part is in the picture and fills it', () => {
  for (const preset of FORMAT_PRESETS) {
    const format = { width: preset.width, height: preset.height, fps: preset.fps, duration: 15, preset: preset.id };
    const store = preset.id.startsWith('app-store') ? [] : ['Where to get it'];
    for (const icon of [undefined, 'media_icon']) {
      const scene = intro({ format, pictures: BOARD, title: 'Budgetly Finance', captions: CAPTIONS, icon });
      const moments = [
        { t: AT.land, names: ['App name', 'iPhone 17 Pro'] },
        { t: F[0] + 0.9, names: ['iPhone 17 Pro', 'Caption 1'] },
        { t: F[1] + 0.9, names: ['iPhone 17 Pro', 'Caption 2'] },
        { t: F[2] + 0.9, names: ['iPhone 17 Pro', 'Caption 3'] },
        { t: AT.trio + 1.2, names: ['iPhone 17 Pro', 'Left phone', 'Right phone'] },
        { t: 14.9, names: [icon ? 'App icon' : 'iPhone 17 Pro', 'Closing name', ...store] },
      ];
      for (const { t, names } of moments) {
        const out = reach(scene, names, t);
        const label = `${preset.id}${icon ? ' with an icon' : ''} at ${t.toFixed(2)}: ${names.join(', ')}`;
        assert.ok(out <= 1, `${label} reach ${out.toFixed(3)} of the picture`);
        assert.ok(out >= 0.6, `${label} fill only ${out.toFixed(3)} of the picture`);
      }
      // The phone comes up from below in the first second, hidden until it does.
      const phone = named(scene, 'iPhone 17 Pro')!;
      assert.equal(actorAt(phone, 0.1).opacity, 0, `${preset.id}: the phone is out of sight at first`);
      assert.equal(actorAt(phone, 1).opacity, 1, `${preset.id}: the phone is up within a second`);
    }
  }
});

test("limelight intro: the captions are the pictures' own headlines, a picture without one has none, and each comes in on its beat", () => {
  const scene = intro({ pictures: ['media_a', 'media_b', 'media_c'], title: 'Juniper', captions: ['Track every habit', undefined, 'See your  streaks   grow'] });
  const caption1 = named(scene, 'Caption 1') as TextActor;
  const caption3 = named(scene, 'Caption 3') as TextActor;
  assert.equal(caption1.text.replace(/\n/g, ' '), 'Track every habit');
  // Spaces tidied, words kept.
  assert.equal(caption3.text.replace(/\n/g, ' '), 'See your streaks grow');
  assert.equal(named(scene, 'Caption 2'), undefined, 'no caption for a picture without a headline');
  // Each caption is in while its picture shows and gone by the next cut.
  const phone = named(scene, 'iPhone 17 Pro')!;
  assert.equal(sceneAt(scene, F[0] + 1).screens[phone.id].media, 'media_a');
  assert.equal(sceneAt(scene, F[2] + 1).screens[phone.id].media, 'media_c');
  assert.deepEqual(revealProgress(caption1.reveal, 3, F[0] + 1), [1, 1, 1]);
  assert.equal(actorAt(caption1, F[1]).opacity, 0, 'caption 1 is gone by the second cut');
  assert.equal(actorAt(caption3, AT.trio).opacity, 0, 'caption 3 is gone when the three phones come');
  assert.ok(actorAt(caption3, F[2] + 1).opacity === 1 && revealProgress(caption3.reveal, 4, F[2] + 1).every((p) => p === 1));
  // A caption's last line, or its last word, is in the app's colour: "Track / every habit".
  assert.equal(caption1.text, 'Track\nevery habit');
  assert.equal(caption1.highlight?.words, 2);
  const budgetly = intro({ pictures: BOARD, title: 'Budgetly', captions: CAPTIONS, accent: '#2f9155' });
  const first = named(budgetly, 'Caption 1') as TextActor;
  assert.equal(first.text, 'Manage budget\nwithout stress');
  assert.equal(first.highlight?.words, 2);
  // Four pictures at most: a fifth isn't shown.
  const five = intro({ pictures: ['a', 'b', 'c', 'd', 'e'], title: 'Juniper' });
  const shown = new Set(five.actors.flatMap((actor) => (actor.kind === 'device' ? actor.screens.map((s) => s.media) : [])));
  assert.deepEqual([...shown].sort(), ['a', 'b', 'c', 'd']);
  assert.equal(templateById('app-intro')!.pictures, 4);
});

test("limelight intro: the close says where to get the app, except in a store's own preview, and in the device's store", () => {
  const at = (preset: string, device?: 'pixel-10-pro') => {
    const p = FORMAT_PRESETS.find((f) => f.id === preset)!;
    const scene = intro({ format: { width: p.width, height: p.height, fps: p.fps, duration: 15, preset: p.id }, pictures: ['a'], title: 'Juniper', device });
    return (named(scene, 'Where to get it') as TextActor | undefined)?.text;
  };
  assert.equal(at('app-store-iphone'), undefined);
  assert.equal(at('app-store-mac'), undefined);
  assert.equal(at('story'), 'Available on the App Store');
  assert.equal(at('google-play', 'pixel-10-pro'), 'Get it on Google Play');
});

test("limelight intro: the backdrop takes the project's colour, the words its font, and without them it has its own", () => {
  const plain = intro({ pictures: [], title: 'Juniper' });
  const green = intro({ pictures: [], title: 'Juniper', accent: '#2f9155', font: 'Outfit' });
  const hue = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return r === Math.max(r, g, b) ? 'red' : g === Math.max(r, g, b) ? 'green' : 'blue';
  };
  assert.equal(green.look.backdrop.style, 'glow');
  assert.equal(hue(green.look.backdrop.top), 'green');
  assert.notEqual(green.look.backdrop.top, plain.look.backdrop.top);
  assert.equal(hue(plain.look.backdrop.top), 'blue', 'indigo without a colour of its own');
  assert.ok(titles(green).every((title) => title.font === 'Outfit'));
  assert.ok(titles(plain).every((title) => title.font === 'Plus Jakarta Sans'));
  // A dark stage lit in the colour: near black behind lights of middling brightness, so white words read on it.
  const brightest = (hex: string) => Math.max(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
  for (const accent of ['#ffe600', '#2f9155', '#c21858', '#7fa4f5']) {
    const { top, bottom } = intro({ pictures: [], title: 'J', accent }).look.backdrop;
    assert.ok(brightest(bottom) < 20, `${accent}: behind the lights is ${bottom}`);
    assert.ok(brightest(top) > 90 && brightest(top) < 160, `${accent} lights at ${top}`);
    // The highlighted words: the colour, light enough to read on the dark.
    const marked = (titles(intro({ pictures: ['a'], title: 'J', accent, captions: ['Plan every single day'] })).find((t) => t.highlight))!.highlight!.color;
    assert.ok(brightest(marked) > 200, `${accent} highlights in ${marked}`);
  }
  // Yellow lights lean amber rather than going olive in the dark.
  assert.equal(hue(intro({ pictures: [], title: 'J', accent: '#ffe600' }).look.backdrop.top), 'red');
  // Its own music, at the tempo its cuts are on.
  assert.deepEqual(green.music, { track: 'pulse', volume: 0.8 });
  // With no name, a stand-in the user replaces.
  const nameless = intro({ pictures: [], title: '  ' });
  assert.equal((named(nameless, 'App name') as TextActor).text, 'Your app');
});

test('limelight intro: a long name goes on two lines in a tall video and stays on one in a wide one', () => {
  const tall = intro({ pictures: [], title: 'Budgetly Finance' });
  assert.equal((named(tall, 'App name') as TextActor).text, 'Budgetly\nFinance');
  const wide = intro({ format: { width: 1920, height: 1080, fps: 30, duration: 15 }, pictures: [], title: 'Budgetly Finance' });
  assert.equal((named(wide, 'App name') as TextActor).text, 'Budgetly Finance');
  // A long name in letters still comes in by letter; a very long one by word.
  assert.equal((named(tall, 'App name') as TextActor).reveal!.by, 'letter');
  const long = intro({ pictures: [], title: 'The Extremely Long Name Of An App' });
  assert.equal((named(long, 'App name') as TextActor).reveal!.by, 'word');
});

test('limelight intro: captions break into as few even lines as fit', () => {
  assert.equal(balanceLines('Track every habit', 20), 'Track every habit');
  assert.equal(balanceLines('Manage budget without stress', 14), 'Manage budget\nwithout stress');
  assert.equal(balanceLines('Set Monthly Spending Limits', 20), 'Set Monthly\nSpending Limits');
  assert.equal(balanceLines('Set Monthly Spending Limits', 14), 'Set Monthly\nSpending\nLimits');
  // A single long word can't break.
  assert.equal(balanceLines('Supercalifragilistic', 10), 'Supercalifragilistic');
  for (const text of CAPTIONS) for (const width of [10, 14, 20]) assert.equal(balanceLines(text, width).replace(/\n/g, ' '), text);
});

test("limelight intro: a title's box is as wide as its own letters, wide ones and narrow ones", () => {
  // Without a canvas (Node) each letter is the widest the app's bold faces set it, measured in Chrome: W 1.54, i 0.45.
  close(titleBox('WWW', 1, 800).width, 3 * 1.54, 1e-9, 'WWW');
  close(titleBox('iii', 1, 800).width, 3 * 0.45, 1e-9, 'iii');
  // The average letter (0.84) framed WWW at 2.52 capitals, and cut off both of its ends.
  assert.ok(titleBox('WWW', 1, 800).width > 2.52 * 1.8);
  // Headlines in those faces averaged 0.71 to 0.81 a letter; the box is never narrower.
  assert.ok(titleBox('Manage budget', 1, 800).width >= 13 * 0.81);
  // The widest line counts, and a line is 1.2 of the font tall.
  close(titleBox('WW\nii', 2, 800).width, 2 * 2 * 1.54, 1e-9);
  close(titleBox('a\nb', 1, 400).height, (2 * 1.2) / 0.7, 1e-9);
});

test('limelight intro: a name of wide letters stays inside the opening and the close at every size', () => {
  for (const preset of FORMAT_PRESETS) {
    const format = { width: preset.width, height: preset.height, fps: preset.fps, duration: 15, preset: preset.id };
    for (const name of ['WWW', 'MMMMMMMMMMMM', 'W W W W W W']) {
      for (const icon of [undefined, 'media_icon']) {
        const scene = intro({ format, pictures: ['media_a'], title: name, icon });
        for (const [t, names] of [[AT.land, ['App name']], [14.9, ['Closing name']]] as const) {
          const out = reach(scene, [...names], t);
          assert.ok(out <= 1, `${name}${icon ? ' with an icon' : ''} at ${preset.id}, ${t} s: reaches ${out.toFixed(3)} of the picture`);
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------
// The faces titles are set in
// ---------------------------------------------------------------------------

/** A page's font set that never finishes loading anything, keeping what it was asked for. */
async function withStalledFonts(run: (asked: Array<{ font: string; text: string }>) => Promise<void>) {
  const asked: Array<{ font: string; text: string }> = [];
  const globals = globalThis as unknown as { document?: unknown; window?: unknown };
  const before = { document: globals.document, window: globals.window };
  globals.document = {
    fonts: {
      load: (font: string, text: string) => {
        asked.push({ font, text });
        return new Promise(() => {});
      },
      check: () => false,
    },
  };
  globals.window = { setTimeout, clearTimeout };
  try {
    await run(asked);
  } finally {
    globals.document = before.document;
    globals.window = before.window;
  }
}

test('limelight intro: a face whose download stalls is waited for once, for its own time, and asked for with the letters it will draw', async () => {
  await withStalledFonts(async (asked) => {
    const face = { weight: 800, font: 'Stalled Test Face', text: '日本語 Go' };
    let started = performance.now();
    await loadTitleFaces([face], 80);
    const firstMs = performance.now() - started;
    // The audit's case: the wait ends at its limit, not when the face comes (it never does here).
    assert.ok(firstMs >= 70 && firstMs < 1000, `the first wait took ${firstMs.toFixed(0)} ms`);
    // A video's next frame doesn't wait for it again.
    started = performance.now();
    await loadTitleFaces([face], 80);
    assert.ok(performance.now() - started < 30, `the second wait took ${(performance.now() - started).toFixed(0)} ms`);
    // Asked for once, with the words' letters: asked for a space, a face split by unicode-range loads only its Latin piece.
    assert.equal(asked.length, 1);
    assert.match(asked[0].font, /^800 10px "Stalled Test Face"/);
    for (const letter of ['日', '本', '語', 'G', 'o']) assert.ok(asked[0].text.includes(letter), `asked for ${letter}: "${asked[0].text}"`);
    // Other letters in the same face are a new question, and get their own wait.
    started = performance.now();
    await loadTitleFaces([{ ...face, text: 'Different' }], 80);
    assert.ok(performance.now() - started >= 70, 'new letters are waited for');
    assert.equal(asked.length, 2);
    // A face loaded for one set of letters isn't ready for others.
    assert.equal(faceReady(face), false);
  });
});

// ---------------------------------------------------------------------------
// The project's own words, colour, font and name
// ---------------------------------------------------------------------------

let elementCount = 0;
function text(content: string, fontSize: number, y: number, extra: Partial<Record<string, unknown>> = {}): ArtboardElement {
  return {
    id: `t${elementCount++}`,
    type: 'text',
    content,
    fontSize,
    color: '#111111',
    fontFamily: 'Plus Jakarta Sans',
    position: { x: 100, y },
    size: { width: 1000, height: (fontSize / 0.3) * 1.2 * content.split('\n').length },
    rotation: 0,
    scale: 1,
    ...extra,
  } as unknown as ArtboardElement;
}

function board(elements: ArtboardElement[], extra: Partial<ArtboardState> = {}): ArtboardState {
  return { id: `b${elementCount++}`, name: 'Board', position: { x: 0, y: 0 }, size: { width: 1206, height: 2622 }, elements, backgroundColor: '#ffffff', ...extra } as ArtboardState;
}

test("limelight intro: an artboard's headline is its biggest text with the same-size lines stacked with it, never the app's own name", () => {
  // A headline set as three text boxes of one size, one under another.
  assert.equal(artboardHeadline(board([text('When It', 28, 300), text('Clicks,', 28, 420), text('You Both Know', 28, 540), text('★★★★★', 17, 800)])), 'When It Clicks, You Both Know');
  // The logo is the app's name: the headline is the next one.
  assert.equal(artboardHeadline(board([text('paylark', 50, 77), text('Get rewarded\nfor your work', 32.77, 355)]), 'Paylark'), 'Get rewarded for your work');
  // A much smaller line under it is a subtitle, not part of it.
  assert.equal(artboardHeadline(board([text('Log in\nseconds', 47, 200), text('Pick a meal or quick-log workout and weight.', 18, 560)])), 'Log in seconds');
  // Same size side by side (a row of labels) isn't one headline.
  assert.equal(artboardHeadline(board([text('Warning', 30, 300, { position: { x: 0, y: 300 }, size: { width: 300, height: 120 } }), text('Danger', 30, 300, { position: { x: 600, y: 300 }, size: { width: 300, height: 120 } })])), 'Warning');
  // Nothing but a review: too long for a caption.
  assert.equal(artboardHeadline(board([text('I love how personal everything feels and every month I get products I actually use and enjoy', 30, 300)])), undefined);
  // No letters, turned on its side, or see-through: not a headline.
  assert.equal(artboardHeadline(board([text('4.8', 60, 100), text('Sideways', 60, 300, { rotation: 90 }), text('Ghost', 60, 500, { opacity: 0 })])), undefined);
});

test("limelight intro: only the app's whole name or a whole word of it is taken for a logo, never a word that starts the same", () => {
  // The audit's case: "Plan" for an app called Planner is the headline, not the small badge.
  assert.equal(artboardHeadline(board([text('Plan', 60, 300), text('SMART FINANCE', 14, 120)]), 'Planner'), 'Plan');
  // The name itself, alone, is the logo.
  assert.equal(artboardHeadline(board([text('Planner', 60, 100), text('Plan your week', 30, 400)]), 'Planner'), 'Plan your week');
  // One whole word of a longer name is too ("paylark" over Paylark Benefits), and the whole name with its spaces.
  assert.equal(artboardHeadline(board([text('Benefits', 60, 100), text('Get paid early', 30, 400)]), 'Paylark Benefits'), 'Get paid early');
  assert.equal(artboardHeadline(board([text('Paylark Benefits', 60, 100), text('Get paid early', 30, 400)]), 'Paylark Benefits'), 'Get paid early');
  // A headline that only holds a word of the name is a headline.
  assert.equal(artboardHeadline(board([text('Benefits for everyone', 60, 100)]), 'Paylark Benefits'), 'Benefits for everyone');
});

test('limelight intro: layers nobody sees choose neither the headline, the font nor the colour', () => {
  // The audit's board: a see-through Poppins headline and a see-through red shape over a white board with an Outfit headline.
  const audited = board(
    [
      text('Track every habit', 35, 100, { fontFamily: 'Outfit', position: { x: 0, y: 100 }, size: { width: 1000, height: 200 } }),
      text('Old headline', 90, 100, { fontFamily: 'Poppins', opacity: 0, position: { x: 0, y: 100 }, size: { width: 1000, height: 200 } }),
      { id: 'red', type: 'shape', shapeType: 'rectangle', fillColor: '#ff0000', opacity: 0, rotation: 0, scale: 1, position: { x: 0, y: 0 }, size: { width: 1000, height: 2000 } } as unknown as ArtboardElement,
    ],
    { size: { width: 1000, height: 2000 } }
  );
  assert.equal(artboardHeadline(audited), 'Track every habit');
  assert.equal(projectFont([audited]), 'Outfit');
  assert.equal(projectAccent([audited]), undefined);
  // A faint shape counts for as little as it shows: a full strength smaller one wins over a faint purer one.
  const shape = (fill: string, opacity: number, height: number) =>
    ({ id: fill, type: 'shape', shapeType: 'rectangle', fillColor: fill, opacity, rotation: 0, scale: 1, position: { x: 0, y: 0 }, size: { width: 1000, height } } as unknown as ArtboardElement);
  assert.equal(projectAccent([board([shape('#ff0000', 0.1, 2000), shape('#2e63e7', 1, 600)], { size: { width: 1000, height: 2000 } })]), '#2e63e7');
  // One nobody can make out (3%) doesn't count at all, even with nothing else on a white board.
  assert.equal(projectAccent([board([shape('#ff0000', 0.03, 2000)], { size: { width: 1000, height: 2000 } })]), undefined);
  // The logo doesn't choose the font either: the headline does.
  assert.equal(projectFont([board([text('Planner', 90, 100, { fontFamily: 'Bungee' }), text('Plan your week', 40, 400, { fontFamily: 'Outfit' })])], 'Planner'), 'Outfit');
});

test('limelight intro: a shape counts by the paint it shows: its fill opacity, its gradient, its colour\'s own alpha', () => {
  const whole = { size: { width: 1000, height: 2000 } };
  const shape = (extra: Record<string, unknown>) =>
    ({ id: 's', type: 'shape', shapeType: 'rectangle', fillColor: '#ff0000', strokeWidth: 0, opacity: 1, rotation: 0, scale: 1, position: { x: 0, y: 0 }, size: { width: 1000, height: 2000 }, ...extra } as unknown as ArtboardElement);
  // The audit's cases: a red fill at 3% opacity on white, and a shape painting a blue gradient over its old red fill.
  assert.equal(projectAccent([board([shape({ fillOpacity: 0.03 })], whole)]), undefined);
  assert.equal(projectAccent([board([shape({ fillGradient: { color1: '#2e63e7', color2: '#2e63e7', angle: 90 } })], whole)]), '#2e63e7');
  // A colour's own alpha counts the same way.
  assert.equal(projectAccent([board([shape({ fillColor: 'rgba(255, 0, 0, 0.03)' })], whole)]), undefined);
  // A half-strength fill still counts when nothing else does.
  assert.equal(projectAccent([board([shape({ fillOpacity: 0.5 })], whole)]), '#ff0000');
  // A gradient's stops both count: the more colourful one wins.
  assert.equal(projectAccent([board([shape({ fillGradient: { color1: '#7fa4f5', color2: '#2e63e7', angle: 0 } })], whole)]), '#2e63e7');
});

test('limelight intro: the caption and the font come from the same text when two are the same size', () => {
  // The audit's board: a button lower down stored before the headline, both at 40.
  const tie = board([
    text('Get started', 40, 1500, { fontFamily: 'Poppins', position: { x: 100, y: 1500 }, size: { width: 800, height: 200 } }),
    text('Plan your week', 40, 100, { fontFamily: 'Outfit', position: { x: 100, y: 100 }, size: { width: 800, height: 200 } }),
  ]);
  assert.equal(artboardHeadline(tie), 'Plan your week');
  assert.equal(projectFont([tie]), 'Outfit');
  // In the other order too.
  const swapped = board([...(tie.elements ?? [])].reverse());
  assert.equal(artboardHeadline(swapped), 'Plan your week');
  assert.equal(projectFont([swapped]), 'Outfit');
});

/** A template project from public/data/projects, as the start dialog opens it, with the dialog's template names. */
function templateProject(file: string): { name: string; artboards: ArtboardState[]; templateNames: string[] } {
  const json = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public/data/projects', file), 'utf8'));
  const data = typeof json.projectData === 'string' ? JSON.parse(json.projectData) : json.projectData;
  return { name: `${json.name} Copy`, artboards: Array.isArray(data) ? data : data.artboards, templateNames: ['Coinly Crypto', json.name, 'Paylark Benefits'] };
}

test("limelight intro: the app's own templates give each screenshot its headline, and the project its name, colour and font", () => {
  const budgetly = templateProject('budgetly-finance.json');
  assert.equal(projectAppName(budgetly), 'Budgetly Finance');
  const headlines = projectShots(budgetly.artboards, projectAppName(budgetly)).map((shot) => shot.headline);
  assert.ok(headlines.includes('Manage budget without stress'), headlines.join(' | '));
  assert.ok(headlines.every((headline) => !headline || (headline.length <= 60 && !/budgetly/i.test(headline))), headlines.join(' | '));
  const paylark = templateProject('paylark-benefits.json');
  const paylarkHeadlines = projectShots(paylark.artboards, 'Paylark').map((shot) => shot.headline);
  assert.ok(paylarkHeadlines.includes('Get rewarded for your work'), paylarkHeadlines.join(' | '));
  assert.equal(projectFont(paylark.artboards), 'Plus Jakarta Sans');
  // Coinly's boards are four strong colours; one of them is its colour.
  const coinly = templateProject('coinly-crypto.json');
  assert.ok(['#2e63e7', '#7fa4f5', '#c21858', '#28b446', '#9d2be8'].includes(projectAccent(coinly.artboards) ?? ''), projectAccent(coinly.artboards));
});

test("limelight intro: a project's colour is a strong or pastel colour of its boards or big shapes, never a grey", () => {
  assert.equal(projectAccent([board([])]), undefined, 'white');
  assert.equal(projectAccent([board([], { backgroundColor: '#f8f8f8' }), board([], { backgroundColor: '#1a1a1a' })]), undefined, 'greys');
  assert.equal(projectAccent([board([], { backgroundColor: '#E2F2D3' })]), '#e2f2d3', 'a pastel');
  assert.equal(projectAccent([board([], { backgroundType: 'gradient', backgroundGradient: { color1: '#2E63E7', color2: '#7FA4F5', angle: 160 } })]), '#2e63e7');
  const shape = { id: 's', type: 'shape', shapeType: 'rectangle', fillColor: 'rgb(194, 24, 88)', strokeColor: 'none', strokeWidth: 0, position: { x: 0, y: 0 }, size: { width: 1206, height: 1000 }, rotation: 0, scale: 1 } as unknown as ArtboardElement;
  assert.equal(projectAccent([board([shape])]), '#c21858', 'a big shape');
  // An icon artboard's colours aren't the screenshots'.
  assert.equal(projectAccent([board([], { backgroundColor: '#ff0000', appIcon: {} })]), undefined);
  // A new project's name is no name; the icon's own name wins.
  assert.equal(projectAppName({ name: 'Untitled Project', artboards: [] }), '');
  assert.equal(projectAppName({ name: 'Paylark Benefits', artboards: [board([], { appIcon: { appName: 'Paylark' } })] }), 'Paylark');
});

test('limelight intro: only a template\'s copy loses " Copy" from its name; an app called Carbon Copy keeps it', () => {
  const templateNames = ['Budgetly Finance', 'Paylark Benefits'];
  // The layout names a project made from a template "<template> Copy".
  assert.equal(projectAppName({ name: 'Budgetly Finance Copy', artboards: [], templateNames }), 'Budgetly Finance');
  // The audit's case: the user's own name that happens to end in Copy.
  assert.equal(projectAppName({ name: 'Carbon Copy', artboards: [], templateNames }), 'Carbon Copy');
  assert.equal(projectAppName({ name: 'Copy', artboards: [], templateNames }), 'Copy');
  // Not quite the layout's pattern, or no template list to check against: the name as it is.
  assert.equal(projectAppName({ name: 'Paylark Benefits Copy 2', artboards: [], templateNames }), 'Paylark Benefits Copy 2');
  assert.equal(projectAppName({ name: 'Budgetly Finance Copy', artboards: [] }), 'Budgetly Finance Copy');
});

// ---------------------------------------------------------------------------
// Loaded only when it is used
// ---------------------------------------------------------------------------

test('limelight intro: its code is loaded only on demand, never with the editor', async () => {
  const intro = TEMPLATES.find((template) => template.id === 'app-intro')!;
  assert.equal(intro.build, undefined, 'the list carries no builder for it');
  assert.equal(typeof intro.load, 'function');
  // Nothing in the app imports the file statically; templates.ts brings it in with import().
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
    }
  };
  walk(path.join(process.cwd(), 'src'));
  const statics = files.filter((file) => /^\s*import\s[^;]*['"][^'"]*introTemplate['"]/m.test(fs.readFileSync(file, 'utf8')));
  assert.deepEqual(statics, [], 'files that import the intro statically');
  assert.match(fs.readFileSync(path.join(process.cwd(), 'src/lib/limelight/templates.ts'), 'utf8'), /import\('\.\/introTemplate'\)/);
  // And building it through the list brings it in.
  const scene = await buildTemplate('app-intro', { pictures: ['media_a'], title: 'Juniper' });
  assert.equal(scene?.template, 'app-intro');
  assert.equal(scene?.name, 'App intro');
});

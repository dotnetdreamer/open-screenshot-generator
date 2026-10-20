// The 3D Studio device: the measured models hold together, pose parity with
// the posed devices, the orientation maths and the turntable drag, keeping the
// box round a turned device, finishes, the conversion from other styles, and
// the seams that count or list 3D devices.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STUDIO_FOLD_POSES,
  STUDIO_LOOKS,
  STUDIO_MODELS,
  STUDIO_TILE_FOLD,
  STUDIO_TILE_LOOK,
  FOLD_INNER_PREFERENCE,
  foldDisplaysInView,
  foldScreenInView,
  foldScreenOf,
  isFoldable,
  isMeasuredModel,
  matchStudioLook,
  mirrorOrientation,
  orientationForPose,
  orientationFromMatrix,
  orientationMatrix,
  rehugStudioBox,
  studioBounds,
  studioConversionPatch,
  studioDefaultSize,
  studioFinishOf,
  studioCameraDistance,
  studioFoldGrip,
  studioFoldPoseById,
  studioFoldTo,
  studioFrame,
  studioLookById,
  studioModelFor,
  studioPostureOf,
  studioTileStyleProps,
  turntableTurn,
  withStudioRehug,
  wrapDegrees,
} from '@/lib/device3dStudio';
import {
  backEdgeLift,
  cutoutPolygons,
  displayShape,
  foldLeftPoint,
  hullPoints,
  insetAt,
  insetOutline,
  leafBack,
  leafOutline,
  lensWindowOutline,
  phoneOutline,
  plateauDeck,
  smoothCorner,
  spineSection,
  surfaceHeightAt,
} from '@/lib/device3dGeometry';
import { displayInsetsOf, displayRadiiOf, flatFaceOf, type PlateauPad } from '@/lib/device3dModels';
import { DEVICE_3D_POSE_ANGLES } from '@/lib/device3dPoseAngles';
import { IPHONE_3D_SIZES, POSE_ORDER } from '@/lib/device3dPresets';
import { DEVICE_FORMAT_PRESETS, DEVICE_REGISTRY, buildSwapUpdates, convertArtboardsToFormat, swapTargetFor } from '@/lib/deviceRegistry';
import { isDevice3dStyle } from '@/lib/devicePerspective';
import { flattenBoard3d } from '@/components/open-screenshot-generator/start/quickstart/deckLayout';
import { listLibraryItems, resolveLibraryItem } from '@/lib/mcp/assetLibrary';
import { describeArtboardsChange } from '@/lib/historyLabels';
import type { ArtboardState, Device3DOrientation, DeviceFrameElementProps, DeviceType } from '@/types/artboard';

const near = (a: number, b: number, tolerance = 1e-6) => Math.abs(a - b) <= tolerance;
const PRO_MAX = studioModelFor('iphone-17-pro-max')!;

function studioPhone(overrides: Partial<DeviceFrameElementProps> = {}): DeviceFrameElementProps {
  const rotation3d = overrides.rotation3d ?? { yaw: 34, pitch: 0, roll: 0 };
  const deviceType = overrides.deviceType ?? 'iphone-17-pro-max';
  const size = studioDefaultSize(studioModelFor(deviceType)!, rotation3d);
  return {
    id: 'phone',
    type: 'device',
    deviceType,
    styleType: '3d-studio',
    position: { x: 300, y: 600 },
    size,
    scale: 1,
    rotation: 0,
    rotation3d,
    ...overrides,
  };
}

/** Where the device centre lands on the artboard, the point a turn must not move, and its scale. */
function deviceCentre(el: DeviceFrameElementProps) {
  const model = studioModelFor(el.deviceType)!;
  const w = el.size.width * el.scale;
  const h = el.size.height * el.scale;
  const frame = studioFrame(model, el.rotation3d!, el.lens3d ?? 20, w, h, studioPostureOf(el, model));
  const lx = -frame.centerU * frame.scale;
  const ly = frame.centerV * frame.scale;
  const a = (el.rotation * Math.PI) / 180;
  return {
    x: el.position.x + w / 2 + lx * Math.cos(a) - ly * Math.sin(a),
    y: el.position.y + h / 2 + lx * Math.sin(a) + ly * Math.cos(a),
    scale: frame.scale,
  };
}

// ---------------------------------------------------------------------------
// The measured models
// ---------------------------------------------------------------------------

test('every measured model holds together', () => {
  assert.ok(STUDIO_MODELS.length > 0);
  for (const m of STUDIO_MODELS) {
    const where = m.label;
    assert.ok(m.drawing.match(/^\d{4}-\d{2}-\d{2}$/), `${where}: drawing date`);
    if (m.fold) {
      // A foldable's model is the phone open flat: each half is about a phone wide.
      assert.ok(m.width / 2 > 60 && m.width / 2 < 100 && m.height > 100 && m.height < 175, `${where}: size`);
    } else {
      assert.ok(m.width > 60 && m.width < 85 && m.height > 130 && m.height < 175, `${where}: size`);
    }
    assert.ok(m.thickness > 5 && m.thickness < 10, `${where}: thickness`);
    // The display sits inside the glass, which sits inside the outline.
    assert.ok(m.display.width < m.glass.width && m.glass.width < m.width, `${where}: widths nest`);
    assert.ok(m.display.height < m.glass.height && m.glass.height < m.height, `${where}: heights nest`);
    if (m.maker === 'apple') {
      // Every Apple sheet draws one bezel all round. A printed active area that
      // disagrees with it (the 16 Pro's 144.79) is a label slip, not the panel.
      const bezelX = (m.width - m.display.width) / 2;
      const bezelY = (m.height - m.display.height) / 2;
      assert.ok(near(bezelX, bezelY, 0.01), `${where}: an even bezel all round (${bezelX} vs ${bezelY})`);
    } else {
      // A Pixel's screen sits where Google's device frame puts it, its corners
      // inside the outline's.
      const insets = displayInsetsOf(m);
      assert.ok(insets.side > 1 && insets.top > 1 && insets.bottom > 1, `${where}: bezels (${JSON.stringify(insets)})`);
      assert.ok(m.display.radius !== undefined && m.display.radius > 1, `${where}: display corners`);
    }
    // The corner runs from the top tangent to the side tangent.
    const first = m.corner[0];
    const last = m.corner[m.corner.length - 1];
    assert.ok(first[1] === 0 && last[0] === 0 && first[0] > 8 && last[1] > 8, `${where}: corner ends`);
    // The edge starts where the front is flat and ends where the back is.
    assert.ok(near(m.edge[0][0], m.flatInset, 0.02), `${where}: edge starts at the flat front`);
    assert.ok(near(m.edge[0][1] - m.edge[m.edge.length - 1][1], m.thickness, 0.03), `${where}: edge spans the thickness`);
    assert.ok(m.edge.some(([inset]) => inset === 0), `${where}: the edge reaches the outline`);
    // Everything on the back is on the back.
    for (const lens of m.lenses) {
      assert.ok(lens.x - lens.ring / 2 > 0 && lens.x + lens.ring / 2 < m.width, `${where}: lens x`);
      assert.ok(lens.y - lens.ring / 2 > 0 && lens.y + lens.ring / 2 < m.height / 2, `${where}: lens y`);
      assert.ok(lens.glass < lens.ring, `${where}: lens glass inside its ring`);
      assert.ok(m.lensTop > surfaceHeightAt(m, lens.x, lens.y), `${where}: lens stands proud of what it sits on`);
    }
    for (const button of m.buttons) {
      // A button on the top edge is placed along the width.
      const along = button.side === 'top' ? m.width : m.height;
      assert.ok(button.center - button.length / 2 > 10 && button.center + button.length / 2 < along - 10, `${where}: button on its edge`);
      assert.ok(button.width < m.thickness, `${where}: button fits the edge`);
    }
    assert.ok(m.finishes.some((f) => f.id === m.defaultFinish), `${where}: default finish exists`);
    for (const f of m.finishes) assert.match(f.frame + f.back + (f.accent ?? ''), /^#[0-9a-f]{6}#[0-9a-f]{6}(#[0-9a-f]{6})?$/, `${where}: ${f.id} colours`);
    // Each measured model is a device type of its own, labelled the same, on its maker's platform.
    assert.equal(DEVICE_REGISTRY[m.id]?.label, m.label, `${where}: registered`);
    assert.equal(DEVICE_REGISTRY[m.id]?.platform, m.maker === 'google' ? 'android' : 'ios', `${where}: platform`);
    assert.equal(isMeasuredModel(m.id), true);
  }
});

test('the outline passes through every measured corner point, and the display sits inside it where the model puts it', () => {
  for (const m of STUDIO_MODELS) {
    const outline = phoneOutline(m);
    const xs = outline.map((p) => p.x);
    const ys = outline.map((p) => p.y);
    assert.ok(near(Math.max(...xs) - Math.min(...xs), m.width, 1e-6), `${m.label}: outline width`);
    assert.ok(near(Math.max(...ys) - Math.min(...ys), m.height, 1e-6), `${m.label}: outline height`);
    const curve = smoothCorner(m.corner);
    for (const [x, y] of m.corner) {
      const closest = Math.min(...curve.map(([cx, cy]) => Math.hypot(cx - x, cy - y)));
      assert.ok(closest < 1e-6, `${m.label}: corner point ${x},${y}`);
    }
    const screen = displayShape(m);
    const dx = screen.outline.map((p) => p.x);
    const dy = screen.outline.map((p) => p.y);
    assert.ok(near(Math.max(...dx) - Math.min(...dx), m.display.width, 0.01), `${m.label}: display width`);
    assert.ok(near(Math.max(...dy) - Math.min(...dy), m.display.height, 0.01), `${m.label}: display height`);
    assert.ok(near(Math.max(...dy), m.height / 2 - displayInsetsOf(m).top, 0.01), `${m.label}: display top`);
    assert.ok(near((Math.max(...dy) + Math.min(...dy)) / 2, screen.centerY, 0.01), `${m.label}: display centre`);
    // An iPhone's display is the outline moved in by its bezel.
    if (m.maker === 'apple') assert.deepEqual(screen.outline, insetOutline(m, (m.width - m.display.width) / 2));
    // The display never reaches past the outline.
    for (const p of screen.outline) assert.ok(insetAt(outline, p.x, p.y) > 0.5, `${m.label}: display inside the outline at ${p.x.toFixed(2)}, ${p.y.toFixed(2)}`);
  }
});

test('the 17 Pro Max matches its drawing', () => {
  // Spot checks against Apple's sheet: product, display, island, lenses.
  assert.deepEqual([PRO_MAX.width, PRO_MAX.height, PRO_MAX.thickness], [77.98, 163.43, 8.75]);
  assert.deepEqual([PRO_MAX.display.width, PRO_MAX.display.height], [72.86, 158.31]);
  assert.deepEqual(PRO_MAX.cutout, { kind: 'island', width: 20.76, height: 6.07, center: 7.91 });
  assert.deepEqual(PRO_MAX.lenses.map((l) => [l.x, l.y, l.ring]), [[14.37, 14.37, 16.2], [14.37, 33.61, 16.2], [32.36, 23.99, 16.2]]);
  assert.equal(PRO_MAX.lensTop, 2.55 + 1.88);
});

test("the Pixels match Google's spec page and device frames", () => {
  // Size from Google's tech specs, front from the Android Studio device frame.
  const pro = studioModelFor('pixel-10-pro')!;
  assert.deepEqual([pro.width, pro.height, pro.thickness], [72.0, 152.8, 8.6]);
  assert.deepEqual(pro.display, { width: 65.85, height: 147.06, top: 3.06, radius: 9.22 });
  assert.deepEqual(pro.cutout, { kind: 'punch', d: 4.7, center: 8.37 });
  // The frame draws the display at the panel's own pitch: 1280 by 2856 pixels.
  assert.ok(near(pro.display.width / pro.display.height, 1280 / 2856, 0.001));
  const tenA = studioModelFor('pixel-10a')!;
  assert.deepEqual([tenA.width, tenA.height, tenA.thickness], [73.0, 153.9, 9.0]);
  const four = studioModelFor('pixel-4')!;
  assert.deepEqual([four.width, four.height, four.thickness], [68.8, 147.1, 8.2]);
  const xl = studioModelFor('pixel-3-xl')!;
  assert.deepEqual([xl.width, xl.height, xl.thickness], [76.7, 158.0, 7.9]);
  // One of each kind of Android screen: a camera hole, a notch, and none.
  assert.deepEqual(
    STUDIO_MODELS.filter((m) => m.maker === 'google').map((m) => [m.id, m.cutout.kind]),
    [['pixel-10-pro', 'punch'], ['pixel-10a', 'punch'], ['pixel-4', 'none'], ['pixel-3-xl', 'notch']]
  );
});

// ---------------------------------------------------------------------------
// The iPhone Duo
// ---------------------------------------------------------------------------

const DUO = studioModelFor('iphone-duo')!;

/** The folded body's extent, both halves and the spine (not the cameras or buttons), in mm. */
function foldedBody(opening: number) {
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const add = ([x, y, z]: [number, number, number]) => {
    xs.push(x);
    ys.push(y);
    zs.push(z);
  };
  for (const side of ['right', 'left'] as const) {
    for (const p of leafOutline(DUO, side)) {
      for (const [inset, z] of DUO.edge) {
        const point: [number, number, number] = [p.x - p.nx * inset, p.y - p.ny * inset, z];
        add(side === 'left' ? foldLeftPoint(DUO, opening, point) : point);
      }
    }
  }
  for (const p of spineSection(DUO, opening) ?? []) add([p.x, 0, p.z]);
  const span = (v: number[]) => Math.max(...v) - Math.min(...v);
  return { width: span(xs), height: span(ys), thickness: span(zs) };
}

test("the iPhone Duo folds to the sizes on Apple's tech specs page", () => {
  assert.equal(isFoldable(DUO), true);
  assert.equal(isFoldable(PRO_MAX), false);
  const open = foldedBody(180);
  assert.ok(near(open.width, 164.6) && near(open.height, 117.8) && near(open.thickness, 5.2), JSON.stringify(open));
  const closed = foldedBody(0);
  assert.ok(near(closed.width, 84.1) && near(closed.height, 117.8) && near(closed.thickness, 11.3), JSON.stringify(closed));
  // Closed, the left half lies on the right one with their hinge sides level
  // and the spec's gap between the displays.
  const free = foldLeftPoint(DUO, 0, [-DUO.width / 2, 0, DUO.thickness / 2]);
  assert.ok(near(free[0], DUO.width / 2) && near(free[2] - DUO.thickness / 2, 11.3 - 2 * 5.2));
  // The spine is inside while it lies flat. In between, the left half's back
  // corner swings out by up to 0.1 mm as it starts to turn about an axis in
  // front of the display.
  assert.equal(spineSection(DUO, 180), null);
  for (const opening of [1, 30, 60, 90, 120, 150, 179]) {
    const body = foldedBody(opening);
    assert.ok(body.width <= 164.6 + 0.2 && near(body.height, 117.8), `opening ${opening}: ${JSON.stringify(body)}`);
  }
});

test("the iPhone Duo's displays are the size of Apple's bezel openings and its screenshots", () => {
  // The bezels draw both displays at 3x; the 117.8 mm height is 2130.5 of their pixels.
  const pitch = 117.8 / 2130.5;
  assert.ok(near(DUO.display.width, 2853 * pitch, 0.05) && near(DUO.display.height, 2007 * pitch, 0.05));
  const outer = DUO.fold!.outer;
  assert.ok(near(outer.width, 1398 * pitch, 0.05) && near(outer.height, 2034 * pitch, 0.05));
  assert.ok(near(DUO.display.width / DUO.display.height, 2853 / 2007, 0.002));
  assert.ok(near(outer.width / outer.height, 1398 / 2034, 0.002));
  assert.deepEqual(DUO.screenPoints, [951, 669]);
  assert.deepEqual(outer.screenPoints, [466, 678]);
  assert.ok(outer.hinge + outer.width < DUO.width / 2 - 2, 'the outer display fits its half');
  assert.ok(outer.camera.x > outer.camera.d && outer.camera.y > outer.camera.d, 'the camera hole is inside the display corner');
  // The earpiece slot lies on the outer glass's straight top edge and stops above the display.
  const back = DUO.fold!.back;
  const slot = outer.receiver;
  assert.ok(slot.from > back.hinge.inset + back.hinge.corner[0][0] && slot.to < DUO.width / 2 - DUO.corner[0][0], 'the slot is on the straight top edge');
  assert.ok(back.inset + slot.depth < (DUO.height - outer.height) / 2, 'the slot stops above the outer display');
});

test("the Duo's back glass meets the frame where Apple's back bezel draws it, closer to the hinge", () => {
  const back = DUO.fold!.back;
  const H = DUO.height / 2;
  const turn = back.hinge.corner;
  // Where the glass's hinge corner leaves the end edge and meets the hinge edge.
  const turnStart = back.hinge.inset + turn[0][0];
  const turnEnd = back.inset + turn[turn.length - 1][1];
  for (const side of ['right', 'left'] as const) {
    const leaf = leafBack(DUO, side);
    const shape = leafOutline(DUO, side);
    assert.equal(leaf.glass.length, leaf.outline.length, `${side}: every outline point has its glass point`);
    // The outline is leafOutline's own shape, only with more points beside the hinge corners.
    const offShape = (p: { x: number; y: number }) =>
      Math.min(
        ...shape.map((a, i) => {
          const b = shape[(i + 1) % shape.length];
          const ex = b.x - a.x;
          const ey = b.y - a.y;
          const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / (ex * ex + ey * ey || 1)));
          return Math.hypot(p.x - a.x - ex * t, p.y - a.y - ey * t);
        })
      );
    assert.ok(leaf.outline.every((p) => offShape(p) < 1e-9), `${side}: outline keeps its shape`);
    leaf.outline.forEach((p, i) => {
      const band = leaf.bands[i];
      const onHinge = Math.abs(p.x) < 1e-9 && Math.abs(p.y) <= H - turnEnd + 1e-6;
      const onEnd = Math.abs(Math.abs(p.y) - H) < 1e-9 && Math.abs(p.x) >= turnStart - 1e-6 && Math.abs(p.x) <= DUO.width / 2 - DUO.corner[0][0];
      if (onHinge) {
        assert.ok(near(band.glass, back.hinge.inset, 1e-6) && near(Math.abs(band.dx), 1, 1e-9), `${side}: straight across the hinge at ${p.y}`);
        assert.ok(near(band.round, back.hinge.round, 1e-6) && near(band.glass - band.seal, back.hinge.seal, 1e-6));
      }
      if (onEnd) assert.ok(near(band.glass, back.inset, 1e-4) && near(band.round, back.round, 1e-6), `${side}: the end edge at ${p.x}`);
    });
    // Round each hinge corner the glass is rounder than the outline, so the
    // frame there is wider than either straight band, and no two pairs cross.
    const widest = Math.max(...leaf.bands.map((b) => b.glass));
    assert.ok(widest > back.inset + 0.5 && widest < turnEnd, `${side}: frame round the hinge corner ${widest}`);
    for (let i = 0; i < leaf.outline.length; i++) {
      const j = (i + 1) % leaf.outline.length;
      const [a, b, c, d] = [leaf.outline[i], leaf.outline[j], leaf.glass[j], leaf.glass[i]];
      const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y) + ((c.x - a.x) * (d.y - a.y) - (d.x - a.x) * (c.y - a.y));
      assert.ok(area > 0, `${side}: the frame folds over itself at ${i}`);
    }
  }
});

test('the iPhone Duo flat frame is its inner display held tall', () => {
  const entry = DEVICE_REGISTRY['iphone-duo'];
  assert.equal(entry.category, 'phone');
  assert.equal(entry.platform, 'ios');
  assert.ok(near(entry.nativeAspect, 669 / 951, 1e-9));
  const face = flatFaceOf(DUO);
  assert.deepEqual([face.width, face.height, face.display.width, face.display.height], [117.8, 164.6, 110.97, 157.77]);
  assert.equal(face.fold, undefined);
  const pad = entry.screen!.paddingPercent;
  assert.ok(near(pad.left, ((117.8 - 110.97) / 2 / 117.8) * 100, 1e-9) && near(pad.top, ((164.6 - 157.77) / 2 / 117.8) * 100, 1e-9));
  assert.equal(entry.counterpart?.android, 'pixel-10-pro');
});

test('folding the Duo keeps the device centre where it was and its size on screen', () => {
  const duo = studioPhone({ deviceType: 'iphone-duo', rotation3d: { yaw: 20, pitch: -10, roll: 0 }, fold3d: 180 });
  const before = deviceCentre(duo);
  for (const fold3d of [0, 45, 90, 135]) {
    for (const hinge3d of ['upright', 'across'] as const) {
      const after = deviceCentre({ ...duo, ...withStudioRehug(duo, { fold3d, hinge3d }), fold3d, hinge3d });
      assert.ok(near(after.scale, before.scale, before.scale * 0.003), `scale at ${fold3d} ${hinge3d}`);
      assert.ok(near(after.x, before.x, 0.05) && near(after.y, before.y, 0.05), `centre at ${fold3d} ${hinge3d}`);
    }
  }
  // A hinge across is a quarter turn: open, the phone stands tall.
  const straight = { yaw: 0, pitch: 0, roll: 0 };
  const wide = studioBounds(DUO, straight, 6, { opening: 180, across: false });
  const tall = studioBounds(DUO, straight, 6, { opening: 180, across: true });
  assert.ok(wide.maxU - wide.minU > 1.3 * (wide.maxV - wide.minV));
  assert.ok(tall.maxV - tall.minV > 1.3 * (tall.maxU - tall.minU));
  // Unset, the posture is the model's own, and it stays in range.
  assert.deepEqual(studioPostureOf({}, DUO), { opening: 180, across: false });
  assert.deepEqual(studioPostureOf({ fold3d: 400, hinge3d: 'across' }, DUO), { opening: 180, across: true });
  assert.equal(studioPostureOf({ fold3d: -5 }, DUO).opening, 0);
});

test('a Duo from the palette arrives held tall and nearly open', () => {
  const tile = studioTileStyleProps(DUO);
  assert.equal(tile.fold3d, STUDIO_TILE_FOLD.opening);
  assert.equal(tile.hinge3d, 'across');
  assert.deepEqual(tile.rotation3d, studioLookById(STUDIO_TILE_LOOK)!.orientation);
  const size = tile.defaultSize as { width: number; height: number };
  assert.ok(size.height > size.width, 'a portrait box');
  const resolved = resolveLibraryItem('studio3d:iphone-duo')!;
  assert.equal(resolved.props.fold3d, STUDIO_TILE_FOLD.opening);
  assert.equal(resolved.props.hinge3d, 'across');
  assert.equal(studioTileStyleProps(PRO_MAX).fold3d, undefined, 'other phones say nothing about folding');
  assert.equal(studioFoldPoseById('laptop')?.across, true);
  // When the camera sees neither display, the opening says which one is in use.
  assert.equal(foldScreenOf(180), 'inner');
  assert.equal(foldScreenOf(90), 'inner');
  assert.equal(foldScreenOf(89.9), 'outer');
  assert.equal(foldScreenOf(0), 'outer');
  // The poses run from closed to flat.
  assert.deepEqual(STUDIO_FOLD_POSES.map((p) => p.opening), [0, 70, 105, 150, 180]);
});

test('the screenshot goes on whichever Duo display the camera sees', () => {
  const front = { yaw: 0, pitch: 0, roll: 0 };
  const lens = 20;
  const at = (opening: number, o = front, across = true, current?: 'inner' | 'outer') =>
    foldScreenInView(DUO, { opening, across }, o, lens, current);
  // Seen from the front, the inner display shows until the swinging half covers most of it,
  // and from the palette angle too, all the way through a fold to half open.
  for (const opening of [180, 150, 120, 89, 75, 60]) assert.equal(at(opening), 'inner', `${opening} from the front`);
  for (const opening of [160, 120, 90, 59]) assert.equal(at(opening, { yaw: 24, pitch: -12, roll: -8 }, true, 'inner'), 'inner', `${opening} at the palette angle`);
  for (const opening of [30, 10, 0]) assert.equal(at(opening), 'outer', `${opening} from the front`);
  // From behind or below the open phone, only the outer display is in view.
  assert.equal(at(180, { yaw: 180, pitch: 0, roll: 0 }), 'outer');
  assert.equal(at(120, { yaw: 0, pitch: -60, roll: 0 }), 'outer');
  // Each fold pose shows its screenshot where the pose shows a display.
  const expected: Record<string, 'inner' | 'outer'> = { closed: 'outer', tent: 'outer', laptop: 'inner', book: 'inner', open: 'inner' };
  for (const pose of STUDIO_FOLD_POSES) assert.equal(at(pose.opening, pose.orientation, pose.across), expected[pose.id], pose.id);
  // Where both are about as much in view, the display it is on keeps it.
  let tie = 0;
  let closest = Infinity;
  for (let opening = 30; opening <= 90; opening += 0.5) {
    const s = foldDisplaysInView(DUO, { opening, across: true }, front, lens);
    const gap = Math.abs(Math.log((s.inner * FOLD_INNER_PREFERENCE) / s.outer));
    if (gap < closest) {
      closest = gap;
      tie = opening;
    }
  }
  assert.ok(closest < Math.log(1.15), `the two are never close: ${closest}`);
  assert.equal(at(tie, front, true, 'inner'), 'inner', `at ${tie}`);
  assert.equal(at(tie, front, true, 'outer'), 'outer', `at ${tie}`);
  // Edge on, the camera sees neither, and the opening decides.
  assert.equal(at(180, { yaw: 90, pitch: 0, roll: 0 }), 'inner');
  const seen = foldDisplaysInView(DUO, { opening: 89, across: true }, front, lens);
  assert.ok(seen.inner > 20 * seen.outer, JSON.stringify(seen));
});

test('dragging the Duo fold grip finds the opening that puts the grip under the pointer', () => {
  const lens = 20;
  for (const o of [{ yaw: 0, pitch: 0, roll: 0 }, { yaw: 24, pitch: -12, roll: -8 }, { yaw: -50, pitch: 25, roll: 30 }]) {
    for (const across of [true, false]) {
      const box = studioDefaultSize(DUO, o, lens, { opening: 160, across });
      const frame = studioFrame(DUO, o, lens, box.width, box.height, { opening: 160, across });
      for (const opening of [170, 140, 100, 60, 25]) {
        const grip = studioFoldGrip(DUO, o, lens, { opening, across }, frame, box.width, box.height);
        const found = studioFoldTo(DUO, o, lens, across, frame, box.width, box.height, grip, opening + 12);
        assert.ok(Math.abs(found - opening) < 0.3, `${JSON.stringify(o)} ${across ? 'across' : 'upright'}: ${opening} came back as ${found}`);
      }
    }
  }
  // Past either end of the swing the grip stops at that end.
  const o = { yaw: 0, pitch: 0, roll: 0 };
  const box = studioDefaultSize(DUO, o, lens, { opening: 160, across: true });
  const frame = studioFrame(DUO, o, lens, box.width, box.height, { opening: 160, across: true });
  const far = { x: box.width / 2, y: box.height * 3 };
  assert.equal(studioFoldTo(DUO, o, lens, true, frame, box.width, box.height, far, 170), 180);
});

test("the camera stays put as the Duo folds, the way it does for a real phone", () => {
  const open = studioCameraDistance(DUO, 20, { opening: 180, across: false });
  for (const opening of [0, 45, 90, 135]) {
    for (const across of [false, true]) assert.equal(studioCameraDistance(DUO, 20, { opening, across }), open);
  }
});

test('a fold reads as one history step named for the fold', () => {
  const duo = studioPhone({ deviceType: 'iphone-duo', fold3d: 180 });
  const board = (el: DeviceFrameElementProps): ArtboardState => ({
    id: 'b',
    name: 'Hero',
    position: { x: 0, y: 0 },
    size: { width: 1290, height: 2796 },
    backgroundColor: '#fff',
    zoom: 1,
    elements: [el],
  });
  const folded = { ...duo, ...withStudioRehug(duo, { fold3d: 90 }) };
  assert.equal(describeArtboardsChange([board(duo)], [board(folded)])?.label, 'Fold');
});

test('the Pixel 4 has no cutout: its front camera sits in the bezel above the screen', () => {
  const four = studioModelFor('pixel-4')!;
  const insets = displayInsetsOf(four);
  assert.ok(insets.top > 1.9 * insets.bottom, `forehead ${insets.top} over chin ${insets.bottom}`);
  const camera = four.front?.find((part) => part.kind === 'camera');
  assert.ok(camera && camera.y + camera.height / 2 < insets.top, 'the camera is above the screen');
});

test('the Pixel 10 Pro periscope window and fitted hull keep its rectangular proportions', () => {
  const model = studioModelFor('pixel-10-pro')!;
  const lens = model.lenses[2];
  const outline = lensWindowOutline(lens)!;
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  assert.ok(near(Math.max(...xs) - Math.min(...xs), 7.45));
  assert.ok(near(Math.max(...ys) - Math.min(...ys), 10.05));
  assert.ok(Math.max(...ys) > lens.ring / 2, 'the window reaches beyond the circular stand-in');
  const inset = lensWindowOutline(lens, (lens.window!.width - lens.glass) / 2)!;
  assert.ok(near(Math.max(...inset.map((p) => p.x)) - Math.min(...inset.map((p) => p.x)), lens.glass));
  const points = hullPoints(model);
  const cx = model.width / 2 - lens.x;
  const cy = model.height / 2 - lens.y;
  const z = model.edge[model.edge.length - 1][1] - model.lensTop;
  for (const p of outline) assert.ok(points.some(([x, y, depth]) => near(x, cx + p.x) && near(y, cy + p.y) && near(depth, z)));
  for (const other of STUDIO_MODELS.flatMap((phone) => phone.lenses).filter((candidate) => candidate !== lens)) {
    assert.equal(lensWindowOutline(other), null, 'other lens geometry keeps its circular path');
  }
});

test('the Pixel 3 XL draws its notch from the cutout path in its AOSP device config', () => {
  const xl = studioModelFor('pixel-3-xl')!;
  if (xl.cutout.kind !== 'notch' || !xl.cutout.path) throw new Error('the 3 XL has a notch with a path');
  const { path } = xl.cutout;
  const polygons = cutoutPolygons(path.d, 1);
  assert.equal(polygons.length, 2, 'two halves');
  const xs = polygons.flat().map(([x]) => x);
  const ys = polygons.flat().map(([, y]) => y);
  assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.max(...ys)], [-338, 338, 171]);
  // The quadratic leaves the top edge a hair above it, never more.
  assert.ok(Math.min(...ys) > -0.5);
  // The rounds kept for the flat frames agree with the path's size.
  assert.ok(near(xl.cutout.depth, 171 * path.pixel, 0.01));
  assert.ok(near(xl.cutout.width, 516 * path.pixel, 0.01));
  // Its display corners are rounder at the top than at the bottom.
  const radii = displayRadiiOf(xl);
  assert.ok(radii.top > 1.5 * radii.bottom);
});

test('cutoutPolygons reads the absolute and relative path commands', () => {
  assert.deepEqual(cutoutPolygons('M 0,0 L 10,0 L 10,10 Z', 2), [[[0, 0], [20, 0], [20, 20]]]);
  assert.deepEqual(cutoutPolygons('m 1 1 h 4 v 4 h -4 z', 1), [[[1, 1], [5, 1], [5, 5], [1, 5]]]);
  const curve = cutoutPolygons('M 0 0 Q 5 10 10 0 Z', 1, 2)[0];
  assert.deepEqual(curve, [[0, 0], [5, 5], [10, 0]]);
});

test("swapping platforms takes a measured phone to the other maker's phone with the same kind of screen", () => {
  assert.equal(DEVICE_REGISTRY['iphone-17-pro'].counterpart?.android, 'pixel-10-pro');
  assert.equal(DEVICE_REGISTRY['iphone-16e'].counterpart?.android, 'pixel-3-xl');
  assert.equal(DEVICE_REGISTRY['pixel-10-pro'].counterpart?.ios, 'iphone-17-pro');
  assert.equal(DEVICE_REGISTRY['pixel-10a'].counterpart?.ios, 'iphone-17');
  assert.equal(DEVICE_REGISTRY['pixel-3-xl'].counterpart?.ios, 'iphone-17e');
  assert.equal(DEVICE_REGISTRY['pixel-4'].counterpart?.ios, 'iphone');
  // A turned studio iPhone becomes a turned Pixel, its centre where it was.
  const phone = studioPhone({ deviceType: 'iphone-17-pro', rotation3d: { yaw: 30, pitch: -10, roll: 0 } });
  const before = deviceCentre(phone);
  const target = swapTargetFor('iphone-17-pro', 'android')!;
  const patch = buildSwapUpdates(phone, target);
  assert.equal(patch.deviceType, 'pixel-10-pro');
  const after = deviceCentre({ ...phone, ...patch });
  assert.ok(near(after.x, before.x, 0.1) && near(after.y, before.y, 0.1), 'centre kept');
});

test('a Pixel registers its own bezels and screen corners for the flat frame', () => {
  const four = DEVICE_REGISTRY['pixel-4'];
  const pad = four.screen!.paddingPercent;
  assert.ok(near(pad.top, (8.55 / 68.8) * 100, 1e-9));
  assert.ok(pad.top > 1.9 * pad.bottom, 'the forehead is twice the chin');
  assert.ok(near(pad.left, pad.right, 1e-9));
  assert.ok(near(four.screen!.radiusFactor, 6.1 / 68.8, 1e-9));
  assert.ok(near(four.nativeAspect, 1080 / 2280, 1e-9));
  assert.equal(four.category, 'phone');
});

test('Android format conversion takes all thirteen measured iPhones to Pixels with matching cutouts', () => {
  const iphones = STUDIO_MODELS.filter((model) => model.maker === 'apple');
  assert.equal(iphones.length, 13);
  const preset = DEVICE_FORMAT_PRESETS.find((entry) => entry.id === 'android')!;
  for (const model of iphones) {
    const phone = studioPhone({ deviceType: model.id, rotation: 17, screenshotSrc: 'asset:existing-screenshot' });
    const source: ArtboardState[] = [{
      id: model.id,
      name: model.label,
      position: { x: 0, y: 0 },
      size: { ...preset.artboard },
      backgroundColor: '#ffffff',
      zoom: 1,
      elements: [phone],
    }];
    const original = structuredClone(source);
    const before = deviceCentre(phone);
    const result = convertArtboardsToFormat(source, preset);
    const converted = result.artboards[0].elements[0] as DeviceFrameElementProps;
    const target = studioModelFor(converted.deviceType)!;
    assert.ok(converted.deviceType.startsWith('pixel-'), `${model.label}: a real Pixel`);
    assert.equal(target.cutout.kind, model.cutout.kind === 'notch' ? 'notch' : 'punch', `${model.label}: matching cutout`);
    assert.equal(converted.styleType, '3d-studio');
    assert.deepEqual(converted.rotation3d, phone.rotation3d);
    assert.equal(converted.rotation, phone.rotation);
    assert.equal(converted.screenshotSrc, phone.screenshotSrc);
    const after = deviceCentre(converted);
    assert.ok(near(after.x, before.x, 0.1) && near(after.y, before.y, 0.1), `${model.label}: centre kept`);
    assert.equal(result.swapped, 1);
    assert.equal(result.resized, 0);
    assert.equal(result.skipped, 0);
    assert.deepEqual(source, original, `${model.label}: source unchanged`);
  }
});

test('a Pro plateau is a flat top on a concave wall, inside the frame rim, meeting the back where the drawings do', () => {
  const plateaus = STUDIO_MODELS.flatMap((m) => m.pads.filter((p): p is PlateauPad => p.shape === 'plateau').map((p) => ({ m, p })));
  assert.deepEqual(plateaus.map(({ m }) => m.id), ['iphone-18-pro-max', 'iphone-18-pro', 'iphone-17-pro-max', 'iphone-17-pro']);
  for (const { m, p } of plateaus) {
    const where = m.label;
    const { wall } = p;
    assert.deepEqual(wall[0], [0, p.height], `${where}: the wall starts at the top's edge and height`);
    assert.equal(wall[wall.length - 1][1], 0, `${where}: the wall ends on the back`);
    // Every one of these back views draws the line where the wall lies down
    // on the back 47.96 from the top.
    assert.ok(near(p.deckBottom + wall[wall.length - 1][0], 47.96, 0.01), `${where}: the wall meets the back at 47.96`);
    // Concave: past the crisp edge it only gets gentler.
    const slopes = wall.slice(1).map(([d, r], i) => (wall[i][1] - r) / (d - wall[i][0]));
    assert.ok(slopes.every((s) => s >= 0), `${where}: the wall only falls`);
    for (let i = 2; i < slopes.length; i++) assert.ok(slopes[i] <= slopes[i - 1] + 0.01, `${where}: concave at wall point ${i + 1}`);
    // The flat top sits inside the frame's rounded rim all round, its corners
    // rounder than the outline's.
    const outline = phoneOutline(m);
    const deck = plateauDeck(m, p);
    const backFlat = m.edge[m.edge.length - 1][0];
    assert.ok(p.deckInset > backFlat, `${where}: the top starts inside the back's flat`);
    for (const q of deck) assert.ok(insetAt(outline, q.x, q.y) >= p.deckInset - 0.01, `${where}: the top's edge at ${q.x.toFixed(2)}, ${q.y.toFixed(2)}`);
  }
});

test('every camera bump has the cove its section draws, falling from its top to its footprint', () => {
  const falls = (where: string, wall: Array<[number, number]>, height: number, width: number, tolerance = 1e-9) => {
    assert.deepEqual(wall[0], [0, height], `${where}: starts at the top's edge and height`);
    assert.ok(near(wall[wall.length - 1][0], width, tolerance) && wall[wall.length - 1][1] === 0, `${where}: lies down on the back ${width} out`);
    for (let i = 1; i < wall.length; i++) assert.ok(wall[i][0] > wall[i - 1][0] && wall[i][1] <= wall[i - 1][1], `${where}: point ${i}`);
  };
  let bumps = 0;
  // Apple's sheets draw a section through every bump; Google's diagrams have
  // none. The iPhone Duo has no sheet yet: its cove is the iPhone 17's
  // stretched to the band its bezel shows, so it still has to fall the same way.
  for (const m of STUDIO_MODELS.filter((model) => model.maker === 'apple')) {
    for (const p of m.pads) {
      if (p.shape === 'plateau') continue;
      bumps++;
      if (p.shape === 'loft') {
        // Widest below the bar, narrowest above it: the drawing's base line
        // there is 1.14 in from the edge.
        falls(`${m.label} skirt`, p.wall, p.height, p.baseBottom - p.top.y1);
        falls(`${m.label} narrow skirt`, p.wallNarrow, p.height, p.top.y0 - p.inset, 0.15);
      } else {
        assert.equal(p.edge, 'cove', `${m.label}: glass bumps are coves`);
        assert.ok(p.wall, `${m.label}: measured cove`);
        falls(m.label, p.wall!, p.height, p.round);
      }
    }
  }
  assert.equal(bumps, 7);
});

test('the frame edge a plateau wall rides on rounds from the side band to the back flat', () => {
  const m = PRO_MAX;
  const lift = backEdgeLift(m);
  const back = m.edge[m.edge.length - 1][1];
  assert.ok(near(lift(0), -1.44 - back, 1e-9), 'the band ends 1.44 behind the middle');
  assert.equal(lift(m.edge[m.edge.length - 1][0]), 0);
  assert.equal(lift(10), 0);
  for (let s = 0.1; s < 3.8; s += 0.1) assert.ok(lift(s) <= lift(s - 0.1) + 1e-9, `lift at ${s.toFixed(1)}`);
});

test('other phones and tablets get a plain model; watches and Macs do not', () => {
  for (const type of ['android-punch-hole', 'iphone-15-pro', 'ipad-pro-13'] as DeviceType[]) {
    const model = studioModelFor(type);
    assert.ok(model, type);
    assert.equal(isMeasuredModel(type), false);
  }
  assert.equal(studioModelFor('apple-watch'), null);
  assert.equal(studioModelFor('macbook'), null);
  assert.equal(studioModelFor('custom'), null);
});

// ---------------------------------------------------------------------------
// Angles
// ---------------------------------------------------------------------------

test('every pose preset converts to the same angles the posed renderer uses, mirrored for the right side', () => {
  for (const pose of Object.keys(DEVICE_3D_POSE_ANGLES) as Array<keyof typeof DEVICE_3D_POSE_ANGLES>) {
    const angles = DEVICE_3D_POSE_ANGLES[pose];
    const left = orientationForPose(pose, 'left');
    const right = orientationForPose(pose, 'right');
    assert.ok(near(left.yaw, wrapDegrees(angles.yaw), 0.01), `${pose} left yaw`);
    assert.ok(near(left.pitch, angles.pitch, 0.01), `${pose} left pitch`);
    assert.ok(near(left.roll, angles.roll ?? 0, 0.01), `${pose} left roll`);
    assert.ok(near(right.yaw, wrapDegrees(-angles.yaw), 0.01), `${pose} right yaw`);
    assert.ok(near(right.roll, wrapDegrees(-(angles.roll ?? 0)), 0.01), `${pose} right roll`);
  }
});

test('the studio looks include every phone pose preset by name', () => {
  for (const pose of POSE_ORDER) {
    const look = STUDIO_LOOKS.find((l) => l.id === pose);
    assert.ok(look, `missing look ${pose}`);
    assert.deepEqual(look!.orientation, orientationForPose(pose, 'left'));
  }
});

test('orientation matrix and angles round trip', () => {
  const cases: Device3DOrientation[] = [
    { yaw: 34, pitch: 0, roll: 0 },
    { yaw: -148, pitch: -10, roll: 0 },
    { yaw: 49.11, pitch: -23.58, roll: 70.89 },
    { yaw: 170, pitch: 80, roll: -120 },
    { yaw: -5, pitch: -60, roll: 33 },
  ];
  for (const o of cases) {
    const back = orientationFromMatrix(orientationMatrix(o));
    const m1 = orientationMatrix(o);
    const m2 = orientationMatrix(back);
    for (let i = 0; i < 9; i++) assert.ok(near(m1[i], m2[i], 1e-3), `matrix entry ${i} for ${JSON.stringify(o)}`);
  }
});

test('yaw shows the left side, pitch leans the top toward the camera', () => {
  // The device's left edge, local (-1, 0, 0), is minus column 0; its z must
  // come toward the camera (+z) for a positive yaw.
  const yaw = orientationMatrix({ yaw: 34, pitch: 0, roll: 0 });
  assert.ok(-yaw[6] > 0.5, 'left edge comes forward');
  // The top, local (0, 1, 0), is column 1; its z must be positive.
  const pitch = orientationMatrix({ yaw: 0, pitch: 30, roll: 0 });
  assert.ok(pitch[7] > 0.4, 'top leans toward the camera');
});

test('the rotate handle turns like a turntable', () => {
  const start = { yaw: 10, pitch: 5, roll: -8 };
  const right = turntableTurn(start, 100, 0, 200);
  assert.ok(right.yaw > start.yaw && right.pitch === start.pitch && right.roll === start.roll, 'across only turns');
  // Front normal is column 2: dragging right turns the front toward the right.
  assert.ok(orientationMatrix(turntableTurn({ yaw: 0, pitch: 0, roll: 0 }, 80, 0, 200))[2] > 0.3);
  const down = turntableTurn(start, 0, 100, 200);
  assert.ok(down.pitch > start.pitch && down.yaw === start.yaw, 'down only tips');
  assert.equal(turntableTurn(start, 0, 100000, 200).pitch, 90, 'tipping stops straight up');
  assert.equal(turntableTurn(start, 0, -100000, 200).pitch, -90, 'and straight down');
  assert.deepEqual(turntableTurn(start, 0, 0, 200), start);
  const snapped = turntableTurn(start, 37, 21, 200, 15);
  assert.equal(snapped.yaw % 15, 0);
  assert.equal(snapped.pitch % 15, 0);
});

test('mirroring flips yaw and roll and nothing else', () => {
  assert.deepEqual(mirrorOrientation({ yaw: 30, pitch: 26, roll: -20 }), { yaw: -30, pitch: 26, roll: 20 });
  const match = matchStudioLook(orientationForPose('tilted', 'right'));
  assert.equal(match?.look.id, 'tilted');
  assert.equal(match?.mirrored, true);
});

// ---------------------------------------------------------------------------
// The box
// ---------------------------------------------------------------------------

test('turning keeps the device the same size on screen and its centre where it was', () => {
  for (const rotation of [0, 17, -40]) {
    const phone = studioPhone({ rotation, scale: 0.8 });
    const before = deviceCentre(phone);
    for (const next of [
      { yaw: 148, pitch: -10, roll: 0 },
      { yaw: 0, pitch: -58, roll: 0 },
      { yaw: 34, pitch: 36, roll: -20 },
      { yaw: 90, pitch: 0, roll: 0 },
    ]) {
      const box = rehugStudioBox(
        { position: phone.position, size: phone.size, scale: phone.scale, rotation },
        { model: PRO_MAX, orientation: phone.rotation3d!, lens: 20 },
        { model: PRO_MAX, orientation: next, lens: 20 }
      );
      const after = deviceCentre({ ...phone, ...box, rotation3d: next });
      assert.ok(near(after.scale, before.scale, before.scale * 0.003), `scale kept at ${JSON.stringify(next)}`);
      assert.ok(near(after.x, before.x, 0.05) && near(after.y, before.y, 0.05), `centre kept at ${JSON.stringify(next)}`);
    }
  }
});

test('a box that already hugs its device is left as it is', () => {
  const phone = studioPhone({ rotation3d: { yaw: -30, pitch: 26, roll: 0 } });
  const patch = withStudioRehug(phone, { rotation3d: phone.rotation3d });
  assert.ok(near(patch.size!.width, phone.size.width, 0.6) && near(patch.size!.height, phone.size.height, 0.6));
  assert.ok(near(patch.position!.x, phone.position.x, 0.6) && near(patch.position!.y, phone.position.y, 0.6));
});

test('a lens change keeps the device centre and its size at the centre plane', () => {
  const phone = studioPhone();
  const before = deviceCentre(phone);
  const patch = withStudioRehug(phone, { lens3d: 45 });
  const after = deviceCentre({ ...phone, ...patch });
  assert.ok(near(after.scale, before.scale, before.scale * 0.003));
  assert.ok(near(after.x, before.x, 0.05) && near(after.y, before.y, 0.05));
});

test('changing the model keeps the device centre and its height on screen', () => {
  const phone = studioPhone({ rotation3d: { yaw: 0, pitch: 0, roll: 0 } });
  const before = deviceCentre(phone);
  const target: DeviceType = 'android-punch-hole';
  const patch = buildSwapUpdates(phone, target);
  assert.equal(patch.deviceType, target);
  const after = deviceCentre({ ...phone, ...patch });
  assert.ok(near(after.x, before.x, 0.1) && near(after.y, before.y, 0.1), 'centre kept');
  const heightOnScreen = (el: DeviceFrameElementProps, scale: number) => {
    const m = studioModelFor(el.deviceType)!;
    return (m.height / m.width) * scale;
  };
  assert.ok(near(heightOnScreen({ ...phone, ...patch }, after.scale), heightOnScreen(phone, before.scale), 0.5));
});

test('withStudioRehug leaves other styles alone', () => {
  const flat = studioPhone({ styleType: 'normal' });
  assert.deepEqual(withStudioRehug(flat, { rotation3d: { yaw: 10, pitch: 0, roll: 0 } }), {
    rotation3d: { yaw: 10, pitch: 0, roll: 0 },
  });
});

test('an upright studio phone drops in a box shaped like the upright posed tile', () => {
  const size = studioDefaultSize(PRO_MAX, orientationForPose('upright', 'left'));
  const posed = IPHONE_3D_SIZES.upright;
  const ratio = size.width / size.height / (posed.width / posed.height);
  assert.ok(ratio > 0.85 && ratio < 1.15, `aspect ratio off by ${ratio}`);
});

// ---------------------------------------------------------------------------
// Finishes and conversions
// ---------------------------------------------------------------------------

test('a custom color wins, then the named finish, then the model default', () => {
  assert.equal(studioFinishOf({}, PRO_MAX).id, PRO_MAX.defaultFinish);
  assert.equal(studioFinishOf({ finish3d: 'deep-blue' }, PRO_MAX).label, 'Deep Blue');
  assert.equal(studioFinishOf({ finish3d: 'no-such-finish' }, PRO_MAX).id, PRO_MAX.defaultFinish);
  const custom = studioFinishOf({ finish3d: 'deep-blue', bodyColor3d: '#12AB34' }, PRO_MAX);
  assert.equal(custom.id, 'custom');
  assert.equal(custom.frame, '#12ab34');
});

test('switching a posed device to the studio keeps its pose, the nearest finish and its centre', () => {
  const posed: DeviceFrameElementProps = {
    id: 'posed',
    type: 'device',
    deviceType: 'iphone-17-pro-max',
    styleType: '3d-right',
    pose3d: 'tilted',
    frameColor3d: 'white',
    position: { x: 100, y: 200 },
    size: { ...IPHONE_3D_SIZES.tilted },
    scale: 1,
    rotation: 0,
  };
  const patch = studioConversionPatch(posed);
  assert.equal(patch.styleType, '3d-studio');
  assert.deepEqual(patch.rotation3d, orientationForPose('tilted', 'right'));
  assert.equal(patch.finish3d, 'silver');
  assert.ok(patch.light3d && patch.light3d.azimuth > 0, 'a right-facing pose is lit from the right');
  // The box closes round the device without moving its middle.
  const cx = posed.position.x + posed.size.width / 2;
  const cy = posed.position.y + posed.size.height / 2;
  const converted = { ...posed, ...patch } as DeviceFrameElementProps;
  const centre = deviceCentre(converted);
  assert.ok(Math.abs(centre.x - cx) < posed.size.width * 0.05);
  assert.ok(Math.abs(centre.y - cy) < posed.size.height * 0.05);
  assert.ok(converted.size.width <= posed.size.width + 1 && converted.size.height <= posed.size.height + 1);
});

test('the studio style counts as a WebGL device and flattens in the deck', () => {
  assert.equal(isDevice3dStyle('3d-studio'), true);
  assert.equal(isDevice3dStyle('3d-left'), true);
  assert.equal(isDevice3dStyle('normal'), false);
  assert.equal(isDevice3dStyle('perspective-left'), false);
  const board: ArtboardState = {
    id: 'b',
    name: 'b',
    position: { x: 0, y: 0 },
    size: { width: 1290, height: 2796 },
    backgroundColor: '#fff',
    zoom: 1,
    elements: [studioPhone()],
  };
  const flat = flattenBoard3d(board);
  assert.equal((flat.elements[0] as DeviceFrameElementProps).styleType, 'normal');
});

test('one palette tile per measured model, and each resolves over MCP to what the tile drops', () => {
  const { items, total } = listLibraryItems('devices', { group: '3d-studio' });
  assert.equal(total, STUDIO_MODELS.length);
  for (const item of items) {
    const resolved = resolveLibraryItem(item.libraryId);
    assert.ok(resolved, item.libraryId);
    assert.equal(resolved!.type, 'device');
    assert.equal(resolved!.props.styleType, '3d-studio');
    assert.deepEqual(resolved!.defaultSize, item.defaultSize);
    const model = studioModelFor(resolved!.subType as DeviceType)!;
    assert.equal(resolved!.props.finish3d, model.defaultFinish);
  }
  const tile = studioTileStyleProps(PRO_MAX);
  const resolved = resolveLibraryItem('studio3d:iphone-17-pro-max')!;
  assert.deepEqual(resolved.props.rotation3d, studioLookById(STUDIO_TILE_LOOK)!.orientation);
  assert.notEqual(resolved.props.rotation3d, tile.rotation3d, 'a copy, not the cached tile');
  assert.equal(resolveLibraryItem('studio3d:iphone-3'), null);
});

test('a turn reads as one history step named for the turn, not a resize', () => {
  const phone = studioPhone();
  const board = (el: DeviceFrameElementProps): ArtboardState => ({
    id: 'b',
    name: 'Hero',
    position: { x: 0, y: 0 },
    size: { width: 1290, height: 2796 },
    backgroundColor: '#fff',
    zoom: 1,
    elements: [el],
  });
  const turned = { ...phone, ...withStudioRehug(phone, { rotation3d: { yaw: 148, pitch: -10, roll: 0 } }) };
  assert.equal(describeArtboardsChange([board(phone)], [board(turned)])?.label, 'Rotate in 3D');
  const recolored = { ...phone, finish3d: 'deep-blue' };
  assert.equal(describeArtboardsChange([board(phone)], [board(recolored)])?.label, 'Device Color');
  const posed = { ...phone, styleType: '3d-left' as const };
  const converted = { ...posed, ...studioConversionPatch(posed) };
  assert.equal(describeArtboardsChange([board(posed)], [board(converted)])?.label, 'Transform');
});

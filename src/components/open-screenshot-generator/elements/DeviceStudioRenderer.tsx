"use client";
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Device3DLight, Device3DOrientation, DeviceType } from '@/types/artboard';
import { withBasePath } from '@/lib/basePath';
import {
  STUDIO_CAMERA_LIFT,
  clampLens,
  clampOpening,
  foldScreenInView,
  foldScreenOf,
  sameOrientation,
  studioCameraDistance,
  studioFrame,
  studioModelFor,
  studioSphereRadius,
} from '@/lib/device3dStudio';
import {
  BACK_SEAL,
  backEdgeLift,
  cornerRectEach,
  cutoutPolygons,
  displayShape,
  edgeCurve,
  edgeSplit,
  foldCenter,
  foldLeftPoint,
  foldPivot,
  foldTurn,
  fromBackView,
  fromFrontView,
  insetAt,
  insetCorner,
  insetOutline,
  islandFootprint,
  leafBack,
  leafOutline,
  lensWindowOutline,
  loftBase,
  loftTop,
  phoneOutline,
  plateauDeck,
  spineSection,
  wallCurve,
  wallRiseAt,
  rayExit,
  roundRect,
  smoothCorner,
  surfaceHeightAt,
  windowOutline,
  type EdgeSample,
  type FoldPosture,
  type LeafBack,
  type OutlinePoint,
  type SpinePoint,
} from '@/lib/device3dGeometry';
import { displayInsetsOf, type IslandPad, type LoftPad, type PhoneDisc, type PhoneModel, type PlateauPad, type Point2 } from '@/lib/device3dModels';
import { subscribeStudioLive, studioLiveState, type StudioLiveState } from '@/lib/device3dStudioLive';

interface DeviceStudioRendererProps {
  deviceType: DeviceType;
  screenshotSrc?: string;
  objectFit?: 'contain' | 'cover' | 'fill';
  orientation: Device3DOrientation;
  lens: number;
  /** The finish: frame metal and back glass, #rrggbb. */
  frameColor: string;
  backColor: string;
  /** A power button in its own colour; unset is the frame's. */
  accentColor?: string;
  light: Device3DLight;
  glare: number;
  /** A foldable's opening in degrees (0 closed, 180 flat; unset is the model's own) and whether its hinge runs across. */
  opening?: number;
  across?: boolean;
  /** The element drawn, so live gestures on it (device3dStudioLive) reach this canvas. */
  liveKey?: string;
}

// Live studio renderers, for the same pixel budget the posed renderer keeps:
// every one holds a WebGL context and browsers evict past ~16.
const liveInstances = new Set<symbol>();

function pixelRatioCap(): number {
  const count = liveInstances.size;
  return count <= 4 ? 3 : count <= 8 ? 2 : 1.5;
}

// ---------------------------------------------------------------------------
// Geometry helpers. Everything is built in millimetres; the model group is
// scaled to one device width.
// ---------------------------------------------------------------------------

function shapeOf(outline: { x: number; y: number }[]): THREE.Shape {
  const shape = new THREE.Shape();
  outline.forEach((p, i) => (i === 0 ? shape.moveTo(p.x, p.y) : shape.lineTo(p.x, p.y)));
  shape.closePath();
  return shape;
}

/** A flat face filling `outline` at height z, facing +z or -z. UVs span the outline's box. */
function faceGeometry(outline: { x: number; y: number }[], z: number, facing: 1 | -1): THREE.BufferGeometry {
  const geo = new THREE.ShapeGeometry(shapeOf(outline));
  if (facing < 0) {
    // Mirror through the face so it looks out of the back with its winding intact.
    geo.scale(1, 1, -1);
    const index = geo.index!;
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, a);
    }
    const normal = geo.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < normal.count; i++) normal.setXYZ(i, 0, 0, -1);
  }
  geo.translate(0, 0, z);
  return geo;
}

/** Intersect an outline with a rectangle centred at (0, cy): a contained screenshot's, or a band of the back. */
function clipOutline(outline: { x: number; y: number }[], width: number, height: number, cy = 0): { x: number; y: number }[] {
  return clipToRect(outline, -width / 2, width / 2, cy - height / 2, cy + height / 2);
}

/** Intersect an outline with the rectangle [x0, x1] x [y0, y1]. */
function clipToRect(outline: { x: number; y: number }[], x0: number, x1: number, y0: number, y1: number): { x: number; y: number }[] {
  let points = outline.map(({ x, y }) => ({ x, y }));
  const edges = [
    ['x', x0, false],
    ['x', x1, true],
    ['y', y0, false],
    ['y', y1, true],
  ] as const;
  for (const [axis, limit, below] of edges) {
    const inside = (p: { x: number; y: number }) => below ? p[axis] <= limit : p[axis] >= limit;
    const clipped: { x: number; y: number }[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const aInside = inside(a);
      const bInside = inside(b);
      if (aInside !== bInside) {
        const t = (limit - a[axis]) / (b[axis] - a[axis]);
        clipped.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
      if (bInside) clipped.push(b);
    }
    points = clipped;
  }
  return points;
}

/** UVs of a face remapped to 0..1 over a box centred at the origin. */
function fitUVs(geo: THREE.BufferGeometry, width: number, height: number, cx = 0, cy = 0) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (pos.getX(i) - cx) / width + 0.5, (pos.getY(i) - cy) / height + 0.5);
  }
  uv.needsUpdate = true;
}

/** Where a sample of a swept profile lands at the outline's point `i`, and its normal: [x, y, z, nx, ny, nz]. */
type SweepPlace = (p: OutlinePoint, i: number, q: EdgeSample) => [number, number, number, number, number, number];

/**
 * Sweeps a cross-section round an outline, the way a unibody frame is milled.
 * Normals come from the profile, so rounded edges shade smoothly. `place`
 * reshapes the profile point by point; without it each sample sits its inset
 * in along the outline's normal.
 */
function sweepGeometry(outline: OutlinePoint[], profile: EdgeSample[], place?: SweepPlace): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  outline.forEach((p, i) => {
    for (const q of profile) {
      if (place) {
        const [x, y, z, nx, ny, nz] = place(p, i, q);
        positions.push(x, y, z);
        normals.push(nx, ny, nz);
        continue;
      }
      positions.push(p.x - p.nx * q.inset, p.y - p.ny * q.inset, q.z);
      normals.push(p.nx * q.out, p.ny * q.out, q.nz);
    }
  });
  const indices: number[] = [];
  const n = outline.length;
  const m = profile.length;
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    for (let j = 0; j < m - 1; j++) {
      const a = i * m + j;
      const b = next * m + j;
      const c = next * m + j + 1;
      const d = i * m + j + 1;
      indices.push(a, d, b, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  return geo;
}

/**
 * The profile of a raised island on the back: a wall from just inside the
 * body, then a convex round over to the flat top `round` in from the edge.
 */
function islandProfile(back: number, pad: IslandPad): EdgeSample[] {
  const top = back - pad.height;
  if (pad.edge === 'cove') {
    // A circle tangent to the back at the footprint, through the top edge:
    // centred `r` out from the back, straight above the footprint line.
    const r = (pad.round ** 2 + pad.height ** 2) / (2 * pad.height);
    const out: EdgeSample[] = [{ inset: 0, z: back + 0.6, out: 1, nz: 0 }];
    const steps = 10;
    for (let i = 0; i <= steps; i++) {
      const u = (i / steps) * pad.round;
      const rise = r - Math.sqrt(Math.max(0, r * r - u * u));
      out.push({ inset: u, z: back - rise, out: u / r, nz: -Math.sqrt(Math.max(0, r * r - u * u)) / r });
    }
    return out;
  }
  const drop = Math.min(pad.height * 0.92, Math.max(0.2, pad.round));
  const out: EdgeSample[] = [{ inset: 0, z: back + 0.3, out: 1, nz: 0 }, { inset: 0, z: top + drop, out: 1, nz: 0 }];
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    const t = (i / steps) * (Math.PI / 2);
    const nx = Math.cos(t) / Math.max(pad.round, 1e-3);
    const nz = -Math.sin(t) / Math.max(drop, 1e-3);
    const len = Math.hypot(nx, nz) || 1;
    out.push({ inset: pad.round * (1 - Math.cos(t)), z: top + drop * (1 - Math.sin(t)), out: nx / len, nz: nz / len });
  }
  return out;
}

/**
 * Where a point of the back is: how far in from the outline, and how far the
 * phone's rounded edge has curved forward of the back there (0 on the flat).
 * A raised part's wall rides on that curve where it runs out over the edge.
 */
function backSurface(model: PhoneModel): (x: number, y: number) => { inset: number; lift: number } {
  const outline = phoneOutline(model);
  const lift = backEdgeLift(model);
  const backFlat = model.edge[model.edge.length - 1][0];
  const halfW = model.width / 2;
  const halfH = model.height / 2;
  return (x, y) => {
    // Far from the edges the outline's corners cannot be nearer than its
    // straight sides, and the edge is flat there anyway.
    const box = Math.min(halfW - Math.abs(x), halfH - Math.abs(y));
    const inset = box > backFlat + 6 ? box : insetAt(outline, x, y);
    return { inset, lift: lift(inset) };
  };
}

/** Quads between neighbouring rays of a grid laid out ray by ray, facing back and out. */
function rayGridIndices(rays: number, perRay: number, keep: (a: number, b: number, c: number, d: number) => number[]): void {
  for (let i = 0; i < rays; i++) {
    const next = (i + 1) % rays;
    for (let j = 0; j < perRay - 1; j++) {
      const a = i * perRay + j;
      const b = next * perRay + j;
      const c = next * perRay + j + 1;
      const d = i * perRay + j + 1;
      keep(a, b, c, d).push(a, b, d, b, c, d);
    }
  }
}

/**
 * A raised part's wall: its measured section swept out from the top's edge
 * along its normals, riding on the phone's rounded edge where it runs out
 * over it. With `rim`, the part over the frame's edge is group 1 (the
 * frame's finish, like the rest of the rim) and the rest group 0. It stops
 * where it is within a few microns of the back, short of lying flat on it.
 */
function wallGeometry(model: PhoneModel, top: OutlinePoint[], wall: Point2[], back: number, rim = false): THREE.BufferGeometry {
  const curve = wallCurve(wall);
  const end = curve.findIndex(([, rise]) => rise < 0.003);
  const profile = end > 1 ? curve.slice(0, end) : curve;
  const surface = backSurface(model);
  const backFlat = model.edge[model.edge.length - 1][0];
  const positions: number[] = [];
  const insets: number[] = [];
  for (const p of top) {
    for (const [d, rise] of profile) {
      const x = p.x + p.nx * d;
      const y = p.y + p.ny * d;
      const { inset, lift } = surface(x, y);
      positions.push(x, y, back - rise + lift);
      insets.push(inset);
    }
  }
  const inner: number[] = [];
  const onRim: number[] = [];
  rayGridIndices(top.length, profile.length, (a, b, c, d) =>
    rim && (insets[a] + insets[b] + insets[c] + insets[d]) / 4 < backFlat ? onRim : inner
  );
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex([...inner, ...onRim]);
  if (rim) {
    geo.addGroup(0, inner.length, 0);
    geo.addGroup(inner.length, onRim.length, 1);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * The skirt of a lofted bar: for each direction out from the top's centre,
 * the measured skirt from the top outline out to the base outline. The base
 * sits farther out below the bar than above it, and the drawing gives the
 * skirt at both widths; in between it takes a shape between the two by its
 * width. It rides on the phone's rounded edge where it runs out over it.
 */
function loftGeometry(model: PhoneModel, bar: LoftPad, back: number): THREE.BufferGeometry {
  const base = loftBase(model, bar);
  const top = loftTop(model, bar);
  const wide = wallCurve(bar.wall);
  const narrow = wallCurve(bar.wallNarrow);
  const wideWidth = bar.wall[bar.wall.length - 1][0];
  const narrowWidth = bar.wallNarrow[bar.wallNarrow.length - 1][0];
  const surface = backSurface(model);
  const around = 180;
  const steps = 20;
  const cx = top.reduce((sum, p) => sum + p.x, 0) / top.length;
  const cy = top.reduce((sum, p) => sum + p.y, 0) / top.length;
  const positions: number[] = [];
  for (let i = 0; i < around; i++) {
    const a = (i / around) * Math.PI * 2;
    const [bx, by] = rayExit(base, [cx, cy], a);
    const [tx, ty] = rayExit(top, [cx, cy], a);
    const w = Math.hypot(bx - tx, by - ty);
    const t = Math.max(0, Math.min(1, (w - narrowWidth) / Math.max(1e-6, wideWidth - narrowWidth)));
    for (let s = 0; s <= steps; s++) {
      // Closer together near the top's edge, where the skirt is steepest.
      const u = (s / steps) ** 1.5;
      const rise = (1 - t) * wallRiseAt(narrow, u * narrowWidth) + t * wallRiseAt(wide, u * wideWidth);
      const x = tx + (bx - tx) * u;
      const y = ty + (by - ty) * u;
      positions.push(x, y, back - rise + surface(x, y).lift);
    }
  }
  const indices: number[] = [];
  rayGridIndices(around, steps + 1, () => indices);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** The finish's shades: the polished lens rings a little darker than the frame. */
function ringShade(frame: THREE.Color): THREE.Color {
  return frame.clone().multiplyScalar(0.82);
}

/** Unit vector toward a light at this azimuth (from the right) and elevation. */
function lightDirection(light: Device3DLight): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(light.azimuth);
  const el = THREE.MathUtils.degToRad(light.elevation);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

/**
 * A small photo studio for the reflections: a grey sweep with a big key
 * softbox where the light is, a weaker fill opposite, a strip overhead and two
 * rim strips behind. Glass and metal pick these up as the highlights that make
 * a product shot read, and the key softbox follows the light control.
 */
function buildStudioEnvironment(light: Device3DLight): THREE.Scene {
  const scene = new THREE.Scene();
  const room = new THREE.SphereGeometry(40, 32, 16);
  const colors: number[] = [];
  const pos = room.attributes.position as THREE.BufferAttribute;
  // Linear values (vertex colours are not converted). A mid-grey sweep, not
  // a black room: polished metal mirrors whatever surrounds it, and silver
  // facing a dark wall turns black at half the angles.
  const top = new THREE.Color(0.42, 0.43, 0.46);
  const floor = new THREE.Color(0.07, 0.07, 0.08);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) / 40 + 1) / 2;
    const c = floor.clone().lerp(top, Math.pow(t, 0.7));
    colors.push(c.r, c.g, c.b);
  }
  room.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  scene.add(new THREE.Mesh(room, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));

  const panel = (width: number, height: number, intensity: number, dir: THREE.Vector3, distance = 20) => {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(intensity, intensity, intensity), side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
    mesh.position.copy(dir.clone().normalize().multiplyScalar(distance));
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
  };
  const key = lightDirection(light);
  panel(16, 11, 7, key);
  const fill = lightDirection({ ...light, azimuth: light.azimuth + 180, elevation: 12 });
  fill.z = Math.abs(fill.z) + 0.6; // the fill stays on the camera's side
  panel(18, 12, 1.4, fill);
  panel(34, 5, 3.2, new THREE.Vector3(0, 1, 0.15), 18);
  panel(4, 26, 2.6, new THREE.Vector3(1, 0.15, -0.55));
  panel(4, 26, 2.6, new THREE.Vector3(-1, 0.15, -0.55));
  panel(30, 7, 0.55, new THREE.Vector3(0, -0.25, 1));
  return scene;
}

interface PhoneMaterials {
  frame: THREE.MeshPhysicalMaterial;
  /** The frame's finish on a button of another colour (a Pixel's power button). */
  accent: THREE.MeshPhysicalMaterial;
  backMetal: THREE.MeshPhysicalMaterial;
  backGlass: THREE.MeshPhysicalMaterial;
  /** Polished glass round a matte panel (the Pixel 3 XL's back). */
  backGloss: THREE.MeshPhysicalMaterial;
  windowGlass: THREE.MeshPhysicalMaterial;
  padGlass: THREE.MeshPhysicalMaterial;
  /** The black glass over a Pixel's cameras: deeper than a lens cover, so it reads black from straight on. */
  cameraGlass: THREE.MeshPhysicalMaterial;
  /** The frame's colour in a satin finish, for metal that is not polished like the frame (the Pixel 10 Pro's camera bar). */
  satin: THREE.MeshPhysicalMaterial;
  ring: THREE.MeshPhysicalMaterial;
  frontGlass: THREE.MeshPhysicalMaterial;
  screenOff: THREE.MeshPhysicalMaterial;
  gasket: THREE.MeshStandardMaterial;
  lensGlass: THREE.MeshPhysicalMaterial;
  lensCore: THREE.MeshPhysicalMaterial;
  barrel: THREE.MeshPhysicalMaterial;
  flash: THREE.MeshPhysicalMaterial;
  control: THREE.MeshPhysicalMaterial;
  hole: THREE.MeshStandardMaterial;
  screw: THREE.MeshStandardMaterial;
  cutout: THREE.MeshBasicMaterial;
  frontCam: THREE.MeshBasicMaterial;
  glare: THREE.MeshPhysicalMaterial;
}

/**
 * How each frame shines. Anodised aluminium is satin; titanium is brushed and
 * a little brighter; polished aluminium is close to a mirror; a matte coating
 * over aluminium (Pixel 4, Pixel 3 XL) reads more like paint than metal.
 */
const FRAME_SHINE: Record<PhoneModel['metal'], { metalness: number; roughness: number }> = {
  aluminium: { metalness: 0.82, roughness: 0.38 },
  titanium: { metalness: 0.9, roughness: 0.28 },
  polished: { metalness: 0.92, roughness: 0.16 },
  coated: { metalness: 0.25, roughness: 0.55 },
};

function createMaterials(model: PhoneModel): PhoneMaterials {
  const shine = FRAME_SHINE[model.metal];
  return {
    frame: new THREE.MeshPhysicalMaterial(shine),
    accent: new THREE.MeshPhysicalMaterial(shine),
    backMetal: new THREE.MeshPhysicalMaterial({ metalness: 0.74, roughness: 0.5 }),
    backGlass: new THREE.MeshPhysicalMaterial({ metalness: 0.06, roughness: 0.5, clearcoat: 0.55, clearcoatRoughness: 0.32 }),
    backGloss: new THREE.MeshPhysicalMaterial({ metalness: 0.06, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 }),
    // The window in a unibody back is colour-matched to the metal round it,
    // so it shares some of its sheen and reads as one surface with a seam.
    windowGlass: new THREE.MeshPhysicalMaterial({ metalness: 0.45, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.3 }),
    padGlass: new THREE.MeshPhysicalMaterial({ metalness: 0.08, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.06 }),
    cameraGlass: new THREE.MeshPhysicalMaterial({ color: 0x000000, metalness: 0, roughness: 0.2, clearcoat: 0.3, clearcoatRoughness: 0.12, envMapIntensity: 0.07 }),
    satin: new THREE.MeshPhysicalMaterial({ metalness: 0.7, roughness: 0.42 }),
    ring: new THREE.MeshPhysicalMaterial({ metalness: 1, roughness: 0.2, side: THREE.DoubleSide }),
    frontGlass: new THREE.MeshPhysicalMaterial({ color: 0x030304, metalness: 0, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03 }),
    screenOff: new THREE.MeshPhysicalMaterial({ color: 0x000000, metalness: 0, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03 }),
    gasket: new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.55 }),
    lensGlass: new THREE.MeshPhysicalMaterial({ color: 0x040507, metalness: 0.1, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 0.55 }),
    // The optic's anti-reflective coating: a faint violet sheen, not a colour.
    lensCore: new THREE.MeshPhysicalMaterial({
      color: 0x03040a,
      metalness: 0.2,
      roughness: 0.1,
      clearcoat: 1,
      envMapIntensity: 0.3,
      iridescence: 0.6,
      iridescenceIOR: 1.35,
      iridescenceThicknessRange: [320, 460],
    }),
    barrel: new THREE.MeshPhysicalMaterial({ color: 0x2b2c31, metalness: 1, roughness: 0.32, envMapIntensity: 0.8 }),
    flash: new THREE.MeshPhysicalMaterial({ color: 0xece5cf, roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.2 }),
    control: new THREE.MeshPhysicalMaterial({ color: 0x1b1c21, metalness: 0.2, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 }),
    hole: new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.85 }),
    screw: new THREE.MeshStandardMaterial({ color: 0x4a4a4f, metalness: 0.8, roughness: 0.4 }),
    cutout: new THREE.MeshBasicMaterial({ color: 0x000000 }),
    frontCam: new THREE.MeshBasicMaterial({ color: 0x0c0e14 }),
    glare: new THREE.MeshPhysicalMaterial({
      color: 0x000000,
      metalness: 0,
      roughness: 0.04,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0,
    }),
  };
}

interface BuiltPhone {
  group: THREE.Group;
  /** The display's active area, for laying the screenshot on; centerY is 0 unless the bezels above and below it differ. */
  display: { outline: OutlinePoint[]; width: number; height: number; z: number; centerY: number };
  glareMesh: THREE.Mesh;
  geometries: THREE.BufferGeometry[];
}

/** The y of the phone's bottom edge at a given x, following the corner where it curves up. */
function bottomEdgeY(model: PhoneModel, x: number): number {
  const fromSide = model.width / 2 - Math.abs(x);
  const corner = smoothCorner(model.corner);
  const a = model.corner[0][0];
  if (fromSide >= a) return -model.height / 2;
  for (let i = 1; i < corner.length; i++) {
    const [x0, y0] = corner[i - 1];
    const [x1, y1] = corner[i];
    if ((fromSide <= x0 && fromSide >= x1) || (fromSide >= x0 && fromSide <= x1)) {
      const t = x1 === x0 ? 0 : (fromSide - x0) / (x1 - x0);
      return -model.height / 2 + y0 + (y1 - y0) * t;
    }
  }
  return -model.height / 2;
}

type AddMesh = (geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], order?: number) => THREE.Mesh;

/** Adds meshes to a group, keeping every geometry for disposal. */
function meshAdder(group: THREE.Group, geometries: THREE.BufferGeometry[]): AddMesh {
  return (geo, mat, order = 0) => {
    geometries.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = order;
    group.add(mesh);
    return mesh;
  };
}

/**
 * The edge: the measured cross-section swept round an outline, in bands for
 * the cover glass, its seal and the frame, and on a glass back, its seal and
 * the back glass. The glass meets the frame `frontGlass` in from the outline
 * at the front and `backGlass` at the back; null is a metal back, which is
 * all frame. A foldable half passes its `back`, and the back of the profile
 * is reshaped point by point to meet that half's glass.
 */
function addEdge(add: AddMesh, mats: PhoneMaterials, outline: OutlinePoint[], curve: EdgeSample[], frontGlass: number, backGlass: number | null, back?: LeafBack) {
  const iGlass = edgeSplit(curve, frontGlass, 'front');
  const iFrame = edgeSplit(curve, Math.max(0, frontGlass - 0.3), 'front');
  const iBackSeal = backGlass === null ? curve.length - 1 : edgeSplit(curve, Math.max(0, backGlass - BACK_SEAL), 'back');
  const iBackGlass = backGlass === null ? curve.length - 1 : edgeSplit(curve, backGlass, 'back');
  const place = back ? backPlace(back) : undefined;
  const sweep = (profile: EdgeSample[]) => sweepGeometry(outline, profile, place);
  add(sweep(curve.slice(0, iGlass + 1)), mats.frontGlass);
  if (iFrame > iGlass) add(sweep(curve.slice(iGlass, iFrame + 1)), mats.gasket);
  add(sweep(curve.slice(iFrame, iBackSeal + 1)), mats.frame);
  if (backGlass !== null) {
    if (iBackGlass > iBackSeal) add(sweep(curve.slice(iBackSeal, iBackGlass + 1)), mats.gasket);
    add(sweep(curve.slice(iBackGlass)), mats.backGlass);
  }
}

/**
 * Where a sample of the back of the edge lands on a foldable half: its inset
 * moved, a piece at a time (the round-over, the flat of the frame, the seal),
 * from the free side's band into this point's, toward the glass. The normal
 * leans with the profile as it steepens or flattens, and turns from facing
 * out of the side to facing back along the band as the round-over goes over.
 */
function backPlace({ bands, free }: LeafBack): SweepPlace {
  return (p, i, q) => {
    if (q.z >= 0) return [p.x - p.nx * q.inset, p.y - p.ny * q.inset, q.z, p.nx * q.out, p.ny * q.out, q.nz];
    const band = bands[i];
    const u = q.inset;
    let scale: number;
    let v: number;
    if (u <= free.round) {
      scale = band.round / free.round;
      v = u * scale;
    } else if (u <= free.seal) {
      scale = (band.seal - band.round) / (free.seal - free.round);
      v = band.round + (u - free.round) * scale;
    } else {
      scale = (band.glass - band.seal) / (free.glass - free.seal);
      v = band.seal + (u - free.seal) * scale;
    }
    const over = Math.min(1, u / free.round);
    let ox = p.nx * (1 - over) - band.dx * over;
    let oy = p.ny * (1 - over) - band.dy * over;
    const across = Math.hypot(ox, oy) || 1;
    ox /= across;
    oy /= across;
    const out = q.out / Math.max(scale, 1e-3);
    const len = Math.hypot(out, q.nz) || 1;
    return [p.x + band.dx * v, p.y + band.dy * v, q.z, (ox * out) / len, (oy * out) / len, q.nz / len];
  };
}

/**
 * What stands on the back, which sits at z `back`: the camera plateau or
 * islands, the lenses, the flash, sensor and mic, and a fingerprint sensor.
 */
function addBackHardware(add: AddMesh, mats: PhoneMaterials, model: PhoneModel, back: number) {
  // ---- camera plateau and islands ----------------------------------------------
  const padMaterial = (material: IslandPad['material']) =>
    material === 'frame' ? mats.frame : material === 'satin' ? mats.satin : material === 'glass' ? mats.cameraGlass : mats.padGlass;
  for (const pad of model.pads) {
    if (pad.shape === 'plateau') {
      const plateau = pad as PlateauPad;
      const deck = plateauDeck(model, plateau);
      add(wallGeometry(model, deck, plateau.wall, back, true), [mats.backMetal, mats.frame]);
      add(faceGeometry(deck, back - plateau.height, -1), mats.backMetal);
    } else if (pad.shape === 'loft') {
      const bar = pad as LoftPad;
      const mat = padMaterial(bar.material);
      add(loftGeometry(model, bar, back), mat);
      add(faceGeometry(loftTop(model, bar), back - bar.height, -1), mat);
    } else {
      const island = pad as IslandPad;
      const top = islandFootprint(model, island, island.round);
      const mat = padMaterial(island.material);
      if (island.wall) add(wallGeometry(model, top, island.wall, back), mat);
      else add(sweepGeometry(islandFootprint(model, island), islandProfile(back, island)), mat);
      add(faceGeometry(top, back - island.height, -1), mat);
    }
  }


  // ---- lenses, flash, sensor, mic --------------------------------------------
  /** A disc lying on the back at height `h` above it, facing out. */
  const backDisc = (cx: number, cy: number, h: number, r: number, mat: THREE.Material) => {
    const geo = new THREE.CircleGeometry(r, 40);
    geo.rotateY(Math.PI);
    geo.translate(cx, cy, back - h);
    return add(geo, mat);
  };
  for (const lens of model.lenses) {
    const [cx, cy] = fromBackView(model, lens.x, lens.y);
    const base = surfaceHeightAt(model, lens.x, lens.y);
    if (model.lensStyle === 'window') {
      // Behind the camera glass: the dark surround each lens shows through it,
      // the rim of the optic, its barrel and its coated centre. Where the glass
      // stands off what it sits on, its side is a short dark wall.
      const top = Math.max(base, model.lensTop);
      const rOut = lens.ring / 2;
      const rGlass = Math.min(lens.glass / 2, rOut * 0.95);
      const window = lensWindowOutline(lens);
      if (window) {
        const surround = faceGeometry(window, back - top - 0.004, -1);
        surround.translate(cx, cy, 0);
        add(surround, mats.cameraGlass);
        // In Google's photos it is the window's own edge that shows, so the rim
        // runs round the window rather than round the optic inside it.
        const rim = shapeOf(window);
        rim.holes.push(shapeOf(lensWindowOutline(lens, rGlass * 0.1)!));
        const rimGeo = new THREE.ShapeGeometry(rim);
        rimGeo.rotateY(Math.PI);
        rimGeo.translate(cx, cy, back - top - 0.008);
        add(rimGeo, mats.gasket);
        const barrel = new THREE.RingGeometry(rGlass * 0.56, rGlass * 0.74, 48);
        barrel.rotateY(Math.PI);
        barrel.translate(cx, cy, back - top - 0.012);
        add(barrel, mats.gasket);
        backDisc(cx, cy, top + 0.016, rGlass * 0.56, mats.lensCore);
        continue;
      }
      if (top - base > 0.05) {
        const wall = new THREE.CylinderGeometry(rOut, rOut, top - base, 48, 1, true);
        wall.rotateX(Math.PI / 2);
        wall.translate(cx, cy, back - (base + top) / 2);
        add(wall, mats.barrel);
      }
      backDisc(cx, cy, top + 0.004, rOut, mats.cameraGlass);
      const rim = new THREE.RingGeometry(rGlass * 0.9, rGlass, 48);
      rim.rotateY(Math.PI);
      rim.translate(cx, cy, back - top - 0.008);
      add(rim, mats.gasket);
      const barrel = new THREE.RingGeometry(rGlass * 0.56, rGlass * 0.74, 48);
      barrel.rotateY(Math.PI);
      barrel.translate(cx, cy, back - top - 0.012);
      add(barrel, mats.gasket);
      backDisc(cx, cy, top + 0.016, rGlass * 0.56, mats.lensCore);
      continue;
    }
    // The cover glass tops out at lensTop; the ring's top face is ringDrop
    // below it (above it when negative).
    const glassRise = Math.max(0.3, model.lensTop - base);
    const rise = Math.max(0.25, glassRise - (lens.ringDrop ?? 0));
    const rOut = lens.ring / 2;
    const rIn = (lens.ringInner ?? lens.ring * 0.86) / 2;
    const rGlass = Math.min(lens.glass / 2, rIn);
    const bend = Math.min(0.35, rise * 0.3);
    const profile: THREE.Vector2[] = [new THREE.Vector2(rOut, -0.3), new THREE.Vector2(rOut, rise - bend)];
    for (let i = 1; i <= 5; i++) {
      const a = (i / 5) * (Math.PI / 2);
      profile.push(new THREE.Vector2(rOut - bend + bend * Math.cos(a), rise - bend + bend * Math.sin(a)));
    }
    const bore = Math.min(rise, glassRise) - 0.35;
    profile.push(new THREE.Vector2(rIn + 0.08, rise), new THREE.Vector2(rIn, rise - 0.08), new THREE.Vector2(rIn, bore));
    const housing = new THREE.LatheGeometry(profile, 64);
    housing.rotateX(-Math.PI / 2);
    housing.translate(cx, cy, back - base);
    add(housing, mats.ring);
    // The cover glass fills the ring's opening and bevels up to its smaller
    // flat face, which is what shows when it stands proud of the ring.
    const shoulder = Math.min(glassRise - 0.08, Math.max(bore + 0.05, rise - 0.08));
    const glassProfile = [
      new THREE.Vector2(rIn, bore),
      new THREE.Vector2(rIn, shoulder),
      new THREE.Vector2(rGlass, glassRise),
      new THREE.Vector2(0, glassRise),
    ];
    const coverGlass = new THREE.LatheGeometry(glassProfile, 64);
    coverGlass.rotateX(-Math.PI / 2);
    coverGlass.translate(cx, cy, back - base);
    add(coverGlass, mats.lensGlass);
    const glassAt = base + glassRise;
    // The barrel between the cover glass and the optic gives a lens its depth.
    const barrel = new THREE.RingGeometry(rGlass * 0.56, rGlass * 0.74, 48);
    barrel.rotateY(Math.PI);
    barrel.translate(cx, cy, back - glassAt - 0.01);
    add(barrel, mats.barrel);
    backDisc(cx, cy, glassAt + 0.015, rGlass * 0.56, mats.lensCore);
  }
  const disc = (spot: PhoneDisc | undefined, mat: THREE.Material) => {
    if (!spot) return;
    const [cx, cy] = fromBackView(model, spot.x, spot.y);
    const h = surfaceHeightAt(model, spot.x, spot.y) + 0.02;
    if (spot.length !== undefined && spot.length > spot.d) {
      // A pill, its long side across the back.
      const half = spot.length / 2;
      add(faceGeometry(roundRect(cx - half, cy - spot.d / 2, cx + half, cy + spot.d / 2, spot.d / 2, 8), back - h, -1), mat);
      return;
    }
    backDisc(cx, cy, h, spot.d / 2, mat);
  };
  disc(model.flash, mats.flash);
  disc(model.sensor, mats.lensGlass);
  disc(model.mic, mats.hole);
  if (model.fingerprint) {
    // A shallow round dish in the back: a polished chamfer round an etched
    // face, with a dark line where the chamfer turns down into it.
    const fp = model.fingerprint;
    const [cx, cy] = fromBackView(model, fp.x, fp.y);
    const r = fp.d / 2;
    const chamfer = new THREE.RingGeometry(r - 1, r, 64);
    chamfer.rotateY(Math.PI);
    chamfer.translate(cx, cy, back - 0.02);
    add(chamfer, mats.backGloss);
    backDisc(cx, cy, 0.018, r - 1, mats.backGlass);
    const line = new THREE.RingGeometry(r - 1.08, r - 1, 64);
    line.rotateY(Math.PI);
    line.translate(cx, cy, back - 0.024);
    add(line, mats.gasket);
  }
}

/** The buttons: proud ones in the frame's finish (or their own accent), flush ones as a sapphire face in a metal surround. */
function addButtons(add: AddMesh, mats: PhoneMaterials, model: PhoneModel) {
  const W = model.width;
  const H = model.height;
  /** A stadium in the shape's own plane: x across the edge (model z), y along it. */
  const stadiumShape = (width: number, length: number) => {
    const half = width / 2;
    const shape = new THREE.Shape();
    shape.moveTo(-half, -length / 2 + half);
    shape.absarc(0, -length / 2 + half, half, Math.PI, Math.PI * 2, false);
    shape.lineTo(half, length / 2 - half);
    shape.absarc(0, length / 2 - half, half, 0, Math.PI, false);
    shape.closePath();
    return shape;
  };
  // Lays a shape drawn that way on the top edge: along it is model x, across
  // it model z, and the shape's +z points up out of the edge.
  const ontoTop = new THREE.Matrix4().set(0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1);
  for (const button of model.buttons) {
    const sign = button.side === 'left' ? -1 : 1;
    const z = button.z === undefined ? 0 : model.thickness / 2 - button.z;
    /** Puts a shape drawn in its own plane on the button's edge, `out` beyond it, its +z pointing out. */
    const place = (geo: THREE.BufferGeometry, out: number) => {
      if (button.side === 'top') {
        geo.applyMatrix4(ontoTop);
        geo.translate(button.center - W / 2, H / 2 + out, z);
      } else {
        // Extrude out of the side: the shape's +z becomes the outward x.
        geo.rotateY(sign * (Math.PI / 2));
        geo.translate(sign * (W / 2 + out), H / 2 - button.center, z);
      }
      return geo;
    };
    if (button.proud > 0) {
      const embed = 0.4;
      const bevel = Math.min(0.14, button.proud * 0.35);
      // The bevel grows the outline, so the shape is drawn that much smaller
      // and the button comes out at its measured size.
      const stadium = stadiumShape(button.width - 2 * bevel, button.length - 2 * bevel);
      const geo = new THREE.ExtrudeGeometry(stadium, {
        depth: Math.max(0.01, button.proud + embed - bevel),
        bevelEnabled: true,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelSegments: 3,
        curveSegments: 20,
      });
      add(place(geo, -embed), button.accent ? mats.accent : mats.frame);
    } else {
      // A flush control: the measured outline is its metal surround, with the
      // sapphire face set inside it.
      add(place(new THREE.ShapeGeometry(stadiumShape(button.width, button.length), 20), 0.01), mats.ring);
      add(place(new THREE.ShapeGeometry(stadiumShape(button.width - 0.5, button.length - 0.5), 20), 0.02), mats.control);
    }
  }
}

/**
 * The port, holes and screws in the bottom edge and the holes in the top
 * edge, each a flat shape facing out of its edge. Only those whose front view
 * x is between `from` and `to`: a foldable puts each half's on that half.
 */
function addEdgeHoles(add: AddMesh, mats: PhoneMaterials, model: PhoneModel, from = -Infinity, to = Infinity) {
  const W = model.width;
  const within = (x: number) => x >= from && x <= to;
  const onBottom = (geo: THREE.BufferGeometry, x: number, mat: THREE.Material) => {
    geo.rotateX(Math.PI / 2);
    geo.translate(x, bottomEdgeY(model, x) - 0.01, 0);
    return add(geo, mat);
  };
  const onTop = (geo: THREE.BufferGeometry, x: number, mat: THREE.Material) => {
    geo.rotateX(-Math.PI / 2);
    geo.translate(x, -bottomEdgeY(model, x) + 0.01, 0);
    return add(geo, mat);
  };
  const portX = model.port.x ?? W / 2;
  if (model.port.width > 0 && within(portX)) {
    const { width, height } = model.port;
    const outer = roundRect(-width / 2, -height / 2, width / 2, height / 2, height / 2, 10);
    onBottom(new THREE.ShapeGeometry(shapeOf(outer)), portX - W / 2, mats.hole);
  }
  for (const x of model.holes.x) {
    if (within(x)) onBottom(new THREE.CircleGeometry(model.holes.d / 2, 20), x - W / 2, mats.hole);
  }
  for (const x of model.screws.x) {
    if (within(x)) onBottom(new THREE.CircleGeometry(model.screws.d / 2, 20), x - W / 2, mats.screw);
  }
  const top = model.topHoles;
  for (const x of top?.x ?? []) {
    if (within(x)) onTop(new THREE.CircleGeometry(top!.d / 2, 20), x - W / 2, mats.hole);
  }
}

/**
 * Builds a phone from its measured model, in millimetres. The parts follow the
 * drawing: the edge cross-section swept round the outline with the cover
 * glass, its seal and the frame as separate bands, the flat glass and the
 * display's active area, the cutout, the back (glass, or metal with its
 * window), the camera plateau or islands, the lenses, flash, sensor and mic,
 * the buttons, and the port, holes and screws in the bottom edge.
 */
function buildPhone(model: PhoneModel, mats: PhoneMaterials): BuiltPhone {
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const add = meshAdder(group, geometries);

  const W = model.width;
  const H = model.height;
  const outline = phoneOutline(model);
  const curve = edgeCurve(model.edge);
  const front = model.edge[0][1];
  const back = model.edge[model.edge.length - 1][1];
  const glassInset = (W - model.glass.width) / 2;

  // ---- the edge ------------------------------------------------------------
  addEdge(add, mats, outline, curve, glassInset, model.back.kind === 'glass' ? glassInset : null);

  // ---- the front -------------------------------------------------------------
  add(faceGeometry(insetOutline(model, model.edge[0][0]), front, 1), mats.frontGlass);
  const insets = displayInsetsOf(model);
  const screen = displayShape(model);
  const displayOutline = screen.outline;
  const screenZ = front + 0.02;
  add(faceGeometry(displayOutline, screenZ, 1), mats.screenOff);
  const cutoutZ = front + 0.06;
  const cutout = model.cutout;
  if (cutout.kind === 'island') {
    const y = H / 2 - cutout.center;
    add(faceGeometry(roundRect(-cutout.width / 2, y - cutout.height / 2, cutout.width / 2, y + cutout.height / 2, cutout.height / 2, 12), cutoutZ, 1), mats.cutout, 2);
    // The front camera shows as a slightly lifted dot at the island's right end.
    const cam = new THREE.CircleGeometry(cutout.height * 0.27, 24);
    cam.translate(cutout.width / 2 - cutout.height / 2, y, cutoutZ + 0.01);
    add(cam, mats.frontCam, 3);
  } else if (cutout.kind === 'notch' && cutout.path) {
    // The phone's own cutout path, y down from the display's top edge. Its
    // top is lifted a hair above that edge so no line of screen shows along it.
    const top = H / 2 - insets.top;
    const shapes = cutoutPolygons(cutout.path.d, cutout.path.pixel).map((polygon) => {
      const shape = new THREE.Shape();
      polygon.forEach(([px, py], i) => {
        const y = py <= 1e-6 ? top + 0.05 : top - py;
        if (i === 0) shape.moveTo(px, y);
        else shape.lineTo(px, y);
      });
      shape.closePath();
      return shape;
    });
    const geo = new THREE.ShapeGeometry(shapes);
    geo.translate(0, 0, cutoutZ);
    add(geo, mats.cutout, 2);
  } else if (cutout.kind === 'notch') {
    const top = H / 2 - insets.top;
    // Black up to where the front glass stops being flat, not over its
    // curved edge or the frame.
    const glassTop = H / 2 - Math.min(model.flatInset, insets.top);
    const { width, depth, radius, shoulder } = cutout;
    const s = new THREE.Shape();
    const left = -width / 2;
    const right = width / 2;
    s.moveTo(left - shoulder, glassTop);
    s.lineTo(left - shoulder, top);
    s.absarc(left - shoulder, top - shoulder, shoulder, Math.PI / 2, 0, true);
    s.lineTo(left, top - depth + radius);
    s.absarc(left + radius, top - depth + radius, radius, Math.PI, Math.PI * 1.5, false);
    s.lineTo(right - radius, top - depth);
    s.absarc(right - radius, top - depth + radius, radius, Math.PI * 1.5, Math.PI * 2, false);
    s.lineTo(right, top - shoulder);
    s.absarc(right + shoulder, top - shoulder, shoulder, Math.PI, Math.PI / 2, true);
    s.lineTo(right + shoulder, glassTop);
    s.closePath();
    const geo = new THREE.ShapeGeometry(s, 24);
    geo.translate(0, 0, cutoutZ);
    add(geo, mats.cutout, 2);
  } else if (cutout.kind === 'punch') {
    const hole = new THREE.CircleGeometry(cutout.d / 2, 32);
    hole.translate(0, H / 2 - cutout.center, cutoutZ);
    add(hole, mats.cutout, 2);
    // The camera shows as a slightly lifted lens in the middle of the hole.
    const cam = new THREE.CircleGeometry(cutout.d * 0.3, 24);
    cam.translate(0, H / 2 - cutout.center, cutoutZ + 0.01);
    add(cam, mats.frontCam, 3);
  }
  // Cameras, sensors and grilles in a bezel or a notch sit over the glass like the cutout.
  for (const part of model.front ?? []) {
    const [cx, cy] = fromFrontView(model, part.x, part.y);
    const z = cutoutZ + 0.01;
    if (part.kind === 'camera') {
      const r = part.width / 2;
      const surround = new THREE.CircleGeometry(r, 32);
      surround.translate(cx, cy, z);
      add(surround, mats.barrel, 3);
      const lens = new THREE.CircleGeometry(r * 0.6, 32);
      lens.translate(cx, cy, z + 0.01);
      add(lens, mats.lensCore, 3);
    } else {
      const geo = faceGeometry(
        roundRect(cx - part.width / 2, cy - part.height / 2, cx + part.width / 2, cy + part.height / 2, Math.min(part.width, part.height) / 2, 8),
        z,
        1
      );
      add(geo, part.kind === 'grille' ? mats.hole : mats.gasket, 3);
    }
  }
  // Reflection on the screen glass, added over the shot (additive), so the
  // screenshot underneath keeps its own colours.
  const glareGeo = faceGeometry(displayOutline, cutoutZ + 0.03, 1);
  const glareMesh = add(glareGeo, mats.glare, 4);
  // The earpiece slot where the glass meets the frame at the top.
  if (model.receiver.width > 0) {
    const r = model.receiver;
    const h = Math.max(0.2, r.bottom - r.top);
    const y = H / 2 - (r.top + r.bottom) / 2;
    const geo = faceGeometry(roundRect(-r.width / 2, y - h / 2, r.width / 2, y + h / 2, h / 2, 6), front - 0.06, 1);
    add(geo, mats.hole, 1);
  }

  // ---- the back --------------------------------------------------------------
  const backFlat = model.edge[model.edge.length - 1][0];
  if (model.back.kind === 'metal') {
    add(faceGeometry(insetOutline(model, backFlat), back, -1), mats.backMetal);
    const win = windowOutline(model);
    if (win) {
      // The seam round the window, then the glass in it.
      add(faceGeometry(win.map((p) => ({ ...p, x: p.x + p.nx * 0.08, y: p.y + p.ny * 0.08 })), back - 0.01, -1), mats.gasket);
      add(faceGeometry(win, back - 0.02, -1), mats.windowGlass);
    }
  } else if (model.back.panel) {
    // Polished glass with an etched panel in it.
    const panel = model.back.panel;
    add(faceGeometry(insetOutline(model, backFlat), back, -1), mats.backGloss);
    const w = W / 2 - panel.side;
    add(faceGeometry(roundRect(-w, H / 2 - panel.bottom, w, H / 2 - panel.top, panel.radius, 12), back - 0.01, -1), mats.backGlass);
  } else {
    add(faceGeometry(insetOutline(model, backFlat), back, -1), mats.backGlass);
  }

  addBackHardware(add, mats, model, back);
  addButtons(add, mats, model);
  addEdgeHoles(add, mats, model);

  group.scale.setScalar(1 / W);
  return {
    group,
    display: { outline: displayOutline, width: model.display.width, height: model.display.height, z: screenZ, centerY: screen.centerY },
    glareMesh,
    geometries,
  };
}

// ---------------------------------------------------------------------------
// The device the component draws: a phone, or a foldable
// ---------------------------------------------------------------------------

/** The screenshot to lay on a display, and how it fills it. */
interface ShotInput {
  texture: THREE.Texture;
  image: HTMLImageElement;
  fit: 'contain' | 'cover' | 'fill';
}

/** What the component needs of a built device. */
interface BuiltDevice {
  group: THREE.Group;
  geometries: THREE.BufferGeometry[];
  glareMeshes: THREE.Mesh[];
  /** Lays the screenshot on the display that shows it, or takes it off. */
  setShot: (shot: ShotInput | null) => void;
  /** Folds a foldable the way a posture says. A phone has nothing to fold. */
  pose: (posture: FoldPosture) => void;
  /**
   * Called once the device is posed and turned: a foldable moves its
   * screenshot to the display the camera sees and, on the outer display of an
   * opened phone, turns it to read upright, as the phone's own display does.
   * A phone's screenshot stays where it is, with its top edge.
   */
  view: (seen: { orientation: Device3DOrientation; lens: number }, deviceRotation: THREE.Quaternion) => void;
  dispose: () => void;
}

/**
 * Crops a texture to a screen's proportions the way object-fit cover does, or
 * resets it. `centered` crops about the middle of the picture, which is where
 * a texture turns when its rotation is set; three.js scales about the same
 * point, so the crop then needs no offset of its own.
 */
function fitTexture(shot: ShotInput, screenAspect: number, centered = false) {
  const { texture, image, fit } = shot;
  texture.repeat.set(1, 1);
  texture.offset.set(0, 0);
  if (centered) {
    texture.center.set(0.5, 0.5);
    texture.rotation = 0;
  }
  if (fit !== 'cover') return;
  const imgAspect = image.naturalWidth / image.naturalHeight;
  if (imgAspect > screenAspect) {
    const rx = screenAspect / imgAspect;
    texture.repeat.set(rx, 1);
    if (!centered) texture.offset.set((1 - rx) / 2, 0);
  } else {
    const ry = imgAspect / screenAspect;
    texture.repeat.set(1, ry);
    if (!centered) texture.offset.set(0, (1 - ry) / 2);
  }
}

/** A built phone as a device: the screenshot lies on its display's active area. */
function phoneDevice(built: BuiltPhone): BuiltDevice {
  const { display } = built;
  let shotMesh: THREE.Mesh | null = null;
  const clear = () => {
    if (!shotMesh) return;
    built.group.remove(shotMesh);
    shotMesh.geometry.dispose();
    (shotMesh.material as THREE.Material).dispose();
    shotMesh = null;
  };
  return {
    group: built.group,
    geometries: built.geometries,
    glareMeshes: [built.glareMesh],
    pose: () => {},
    view: () => {},
    setShot: (shot) => {
      clear();
      if (!shot) return;
      let w = display.width;
      let h = display.height;
      const screenAspect = w / h;
      fitTexture(shot, screenAspect);
      let geo: THREE.BufferGeometry;
      if (shot.fit === 'contain') {
        const imgAspect = shot.image.naturalWidth / shot.image.naturalHeight;
        if (imgAspect > screenAspect) h = w / imgAspect;
        else w = h * imgAspect;
        geo = faceGeometry(clipOutline(display.outline, w, h, display.centerY), display.z + 0.01, 1);
      } else {
        geo = faceGeometry(display.outline, display.z + 0.01, 1);
      }
      fitUVs(geo, w, h, 0, display.centerY);
      // Screens emit light: unlit and not tone mapped, so the screenshot shows
      // exactly the colours it has.
      const mat = new THREE.MeshBasicMaterial({ map: shot.texture, toneMapped: false });
      shotMesh = new THREE.Mesh(geo, mat);
      shotMesh.renderOrder = 1;
      built.group.add(shotMesh);
    },
    dispose: clear,
  };
}

/**
 * A strip swept along y from y0 to y1 through a path in the xz plane, its
 * normals the path's. The path runs so the strip faces where the normals do.
 */
function stripGeometry(path: SpinePoint[], y0: number, y1: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (const p of path) {
    positions.push(p.x, y0, p.z, p.x, y1, p.z);
    normals.push(p.nx, 0, p.nz, p.nx, 0, p.nz);
  }
  for (let i = 0; i < path.length - 1; i++) {
    const a = 2 * i;
    const b = a + 1;
    const c = a + 3;
    const d = a + 2;
    indices.push(a, d, b, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((positions.length / 3) * 2).fill(0), 2));
  geo.setIndex(indices);
  return geo;
}

/** The spine: its section swept between its two ends, closed at each end. */
function spineGeometry(section: SpinePoint[], halfLength: number): THREE.BufferGeometry {
  const side = stripGeometry(section, -halfLength, halfLength);
  const positions = Array.from(side.attributes.position.array as Float32Array);
  const normals = Array.from(side.attributes.normal.array as Float32Array);
  const indices = Array.from(side.index!.array as ArrayLike<number>);
  for (const end of [-1, 1]) {
    const base = positions.length / 3;
    for (const p of section) {
      positions.push(p.x, end * halfLength, p.z);
      normals.push(0, end, 0);
    }
    // A fan over the section, closed by the straight line between its seams.
    for (let j = 1; j < section.length - 1; j++) {
      if (end > 0) indices.push(base, base + j, base + j + 1);
      else indices.push(base, base + j + 1, base + j);
    }
  }
  side.dispose();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  return geo;
}

/**
 * A screen in its half's own coordinates (model coordinates, open flat): its
 * middle, its size as the picture sees it, and the model directions that are
 * right and up on it.
 */
interface ScreenFrame {
  cx: number;
  cy: number;
  width: number;
  height: number;
  right: Point2;
  up: Point2;
}

/**
 * UVs over a screen, for a geometry built in the screen's half: 0..1 across
 * the given picture size. `atX` says where on the screen each vertex is
 * across, when that is not its own x: on a bend, how far along the sheet.
 */
function screenUVs(geo: THREE.BufferGeometry, frame: ScreenFrame, width: number, height: number, atX?: (index: number, x: number) => number) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const dx = (atX ? atX(i, pos.getX(i)) : pos.getX(i)) - frame.cx;
    const dy = pos.getY(i) - frame.cy;
    const sx = dx * frame.right[0] + dy * frame.right[1];
    const sy = dx * frame.up[0] + dy * frame.up[1];
    uv.setXY(i, sx / width + 0.5, sy / height + 0.5);
  }
  uv.needsUpdate = true;
}

/**
 * Builds a foldable (PhoneFold), in millimetres. Each half is built open flat
 * as a part of its own, with the measured edge swept round it: the right half
 * with the cameras and the buttons, the left half with the outer display on
 * its back, and the inner display across both. `pose` folds it: the left half
 * turns about the hinge axis, the spine closes over the hinge, the inner
 * display bends round the axis, and the whole is moved so the folded body's
 * middle is at the origin and turned a quarter for a hinge across, which is
 * the frame the box fit measures it in (foldedHullPoints).
 */
/** Degrees open past which a foldable is in use opened, so its outer display turns its picture upright, as in the tent. */
const OUTER_TURNS_ABOVE = 10;

function buildFoldable(model: PhoneModel, mats: PhoneMaterials): BuiltDevice {
  const fold = model.fold!;
  const W = model.width;
  const H = model.height;
  const front = model.edge[0][1];
  const back = model.edge[model.edge.length - 1][1];
  const pivot = foldPivot(model);
  const curve = edgeCurve(model.edge);
  const glassInset = (W - model.glass.width) / 2;
  const geometries: THREE.BufferGeometry[] = [];

  // group: device widths; hold: the quarter turn; body: the folded body's
  // middle at the origin; hinge: on the hinge axis, turned by the fold.
  const group = new THREE.Group();
  const hold = new THREE.Group();
  const body = new THREE.Group();
  const right = new THREE.Group();
  const hinge = new THREE.Group();
  const left = new THREE.Group();
  group.add(hold);
  hold.add(body);
  body.add(right, hinge);
  hinge.add(left);
  hinge.position.set(0, 0, pivot);
  left.position.set(0, 0, -pivot);
  const parts = { right: meshAdder(right, geometries), left: meshAdder(left, geometries) };
  const glareMeshes: THREE.Mesh[] = [];

  // ---- the halves ----------------------------------------------------------
  const screenZ = front + 0.02;
  const inner = displayShape(model).outline;
  const innerHalf = { right: clipToRect(inner, 0, W, -H, H), left: clipToRect(inner, -W, 0, -H, H) };
  const leaves = { right: leafBack(model, 'right'), left: leafBack(model, 'left') };
  for (const side of ['right', 'left'] as const) {
    const add = parts[side];
    addEdge(add, mats, leaves[side].outline, curve, glassInset, fold.back.inset, leaves[side]);
    add(faceGeometry(leafOutline(model, side, model.flatInset), front, 1), mats.frontGlass);
    add(faceGeometry(innerHalf[side], screenZ, 1), mats.screenOff);
    glareMeshes.push(add(faceGeometry(innerHalf[side], front + 0.09, 1), mats.glare, 4));
  }
  // The right half's back is glass with the cameras on it; its edges carry the buttons.
  parts.right(faceGeometry(leaves.right.glass, back, -1), mats.backGlass);
  addBackHardware(parts.right, mats, model, back);
  addButtons(parts.right, mats, model);
  addEdgeHoles(parts.right, mats, model, W / 2, W);
  addEdgeHoles(parts.left, mats, model, 0, W / 2);

  // The left half's back is the outer display under its glass, with its camera.
  const outer = fold.outer;
  parts.left(faceGeometry(leaves.left.glass, back, -1), mats.frontGlass);
  const freeCorner = insetCorner(smoothCorner(model.corner), W / 2 - outer.hinge - outer.width);
  const hingeCorner = smoothCorner(outer.hingeCorner);
  const outerScreen = cornerRectEach(-(outer.hinge + outer.width), -outer.height / 2, -outer.hinge, outer.height / 2, {
    topLeft: freeCorner,
    bottomLeft: freeCorner,
    topRight: hingeCorner,
    bottomRight: hingeCorner,
  });
  parts.left(faceGeometry(outerScreen, back - 0.02, -1), mats.screenOff);
  glareMeshes.push(parts.left(faceGeometry(outerScreen, back - 0.09, -1), mats.glare, 4));
  const camX = -(W / 2 - outer.camera.x);
  const camY = H / 2 - outer.camera.y;
  const camHole = new THREE.CircleGeometry(outer.camera.d / 2, 40);
  camHole.rotateY(Math.PI);
  camHole.translate(camX, camY, back - 0.06);
  parts.left(camHole, mats.cutout, 2);
  const camLens = new THREE.CircleGeometry(outer.camera.d * 0.2, 24);
  camLens.rotateY(Math.PI);
  camLens.translate(camX, camY, back - 0.07);
  parts.left(camLens, mats.frontCam, 3);
  // The earpiece slot where the outer display's glass meets the frame at the
  // top. A phone draws its slot just under the cover glass, where the glass
  // has already curved down past it; this glass is flat right to its edge,
  // so the slot is drawn on it.
  const slot = outer.receiver;
  const slotTop = H / 2 - fold.back.inset;
  parts.left(faceGeometry(roundRect(-slot.to, slotTop - slot.depth, -slot.from, slotTop, slot.depth / 2, 6), back - 0.03, -1), mats.hole, 2);

  // ---- what changes as it folds ----------------------------------------------
  let posture: FoldPosture = { opening: fold.opening, across: false };
  const moving: THREE.Mesh[] = [];
  const addMoving = (geo: THREE.BufferGeometry, mat: THREE.Material, order = 0) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = order;
    body.add(mesh);
    moving.push(mesh);
    return mesh;
  };
  const clearMoving = () => {
    for (const mesh of moving) {
      body.remove(mesh);
      mesh.geometry.dispose();
    }
    moving.length = 0;
  };

  /**
   * The inner display's bend round the hinge axis, `radius` in front of it,
   * from the left half's edge to the right half's, facing the axis; `flat`
   * carries it that far on along each half (the glass between the halves).
   */
  const bendPath = (opening: number, radius: number, flat = 0): SpinePoint[] => {
    const a = (foldTurn(opening) * Math.PI) / 180;
    const steps = Math.max(1, Math.ceil(a / (Math.PI / 36)));
    const path: SpinePoint[] = [];
    if (flat > 0) {
      const [x, , z] = foldLeftPoint(model, opening, [-flat, 0, pivot - radius]);
      path.push({ x, z, nx: Math.sin(a), nz: Math.cos(a) });
    }
    for (let i = steps; i >= 0; i--) {
      const phi = (i / steps) * a;
      path.push({ x: -radius * Math.sin(phi), z: pivot - radius * Math.cos(phi), nx: Math.sin(phi), nz: Math.cos(phi) });
    }
    if (flat > 0) path.push({ x: flat, z: pivot - radius, nx: 0, nz: 1 });
    return path;
  };

  // ---- the screenshot ----------------------------------------------------------
  let shot: ShotInput | null = null;
  let shotMaterial: THREE.MeshBasicMaterial | null = null;
  let shotScreen: 'inner' | 'outer' | null = null;
  const shotMeshes: THREE.Mesh[] = [];
  let shotFit: { frame: ScreenFrame; width: number; height: number } | null = null;

  const clearShot = () => {
    for (const mesh of shotMeshes) {
      mesh.parent?.remove(mesh);
      mesh.geometry.dispose();
    }
    shotMeshes.length = 0;
    shotFit = null;
  };
  /** The screen the screenshot is on, as the picture sees it in this posture. */
  const screenFrame = (screen: 'inner' | 'outer', across: boolean): ScreenFrame => {
    if (screen === 'inner') {
      const { width, height } = model.display;
      return across
        ? { cx: 0, cy: 0, width: height, height: width, right: [0, -1], up: [1, 0] }
        : { cx: 0, cy: 0, width, height, right: [1, 0], up: [0, 1] };
    }
    // The left half's back, seen with the phone closed: its x runs the other way.
    const cx = -(outer.hinge + outer.width / 2);
    return across
      ? { cx, cy: 0, width: outer.height, height: outer.width, right: [0, -1], up: [-1, 0] }
      : { cx, cy: 0, width: outer.width, height: outer.height, right: [-1, 0], up: [0, 1] };
  };
  /** The bend the inner display's picture lies on, just in front of the display's own. */
  const shotBendRadius = pivot - screenZ - 0.01;
  /**
   * The inner display is one sheet, the picture's width open flat, and the
   * bend adds its arc to the sheet's length. So the picture is laid along the
   * whole length, both flat parts and the bend between them, and nothing is
   * doubled or missing at the fold; it is narrower across the fold by the
   * bend's share of the length, under 1% half closed.
   */
  const sheet = () => {
    const bend = shotBendRadius * ((foldTurn(posture.opening) * Math.PI) / 180);
    return { bend, squeeze: model.display.width / (model.display.width + bend) };
  };
  const layShot = (screen: 'inner' | 'outer') => {
    clearShot();
    shotScreen = screen;
    if (!shot || !shotMaterial) return;
    const frame = screenFrame(screen, posture.across);
    fitTexture(shot, frame.width / frame.height, true);
    let width = frame.width;
    let height = frame.height;
    if (shot.fit === 'contain') {
      const imgAspect = shot.image.naturalWidth / shot.image.naturalHeight;
      if (imgAspect > width / height) height = width / imgAspect;
      else width = height * imgAspect;
    }
    shotFit = { frame, width, height };
    // The picture's rectangle in the half's coordinates.
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      xs.push(frame.cx + (sx * width) / 2 * frame.right[0] + (sy * height) / 2 * frame.up[0]);
      ys.push(frame.cy + (sx * width) / 2 * frame.right[1] + (sy * height) / 2 * frame.up[1]);
    }
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const add = (geo: THREE.BufferGeometry, group: THREE.Object3D) => {
      const mesh = new THREE.Mesh(geo, shotMaterial!);
      mesh.renderOrder = 1;
      group.add(mesh);
      shotMeshes.push(mesh);
    };
    if (screen === 'outer') {
      const geo = faceGeometry(clipToRect(outerScreen, x0, x1, y0, y1), back - 0.03, -1);
      screenUVs(geo, frame, width, height);
      add(geo, left);
      return;
    }
    // A point `x` across a half, open flat, is `x + shift` along the sheet
    // from its middle; the picture spans the sheet's length, squeezed.
    const { bend, squeeze } = sheet();
    for (const side of ['right', 'left'] as const) {
      const shift = side === 'right' ? bend / 2 : -bend / 2;
      const outline = clipToRect(innerHalf[side], x0 / squeeze - shift, x1 / squeeze - shift, y0, y1);
      if (outline.length < 3) continue;
      const geo = faceGeometry(outline, screenZ + 0.01, 1);
      screenUVs(geo, frame, width, height, (_, x) => (x + shift) * squeeze);
      add(geo, side === 'right' ? right : left);
    }
    if (bend > 1e-6) {
      // Round the bend, from the left half's edge to the right half's.
      const path = bendPath(posture.opening, shotBendRadius);
      const lengths = [0];
      for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z));
      const total = lengths[lengths.length - 1] || 1;
      const geo = stripGeometry(path, Math.max(y0, -model.display.height / 2), Math.min(y1, model.display.height / 2));
      screenUVs(geo, frame, width, height, (i) => (-bend / 2 + (lengths[Math.floor(i / 2)] / total) * bend) * squeeze);
      add(geo, body);
    }
  };

  const pose = (next: FoldPosture) => {
    const turnedBefore = posture.across;
    posture = { opening: Math.max(0, Math.min(180, next.opening)), across: next.across };
    const turn = (foldTurn(posture.opening) * Math.PI) / 180;
    hinge.rotation.set(0, turn, 0);
    const [cx, cy, cz] = foldCenter(model, posture.opening);
    body.position.set(-cx, -cy, -cz);
    hold.rotation.set(0, 0, posture.across ? Math.PI / 2 : 0);
    clearMoving();
    const section = spineSection(model, posture.opening);
    if (section) addMoving(spineGeometry(section, H / 2 - fold.spine.endInset), mats.frame);
    // The glass between the halves, the full height of the glass, and the
    // display across the bend, the height of the display.
    const glassSpan = H / 2 - glassInset - 0.3;
    addMoving(stripGeometry(bendPath(posture.opening, pivot - front, glassInset), -glassSpan, glassSpan), mats.frontGlass);
    if (turn > 1e-3) {
      const half = model.display.height / 2;
      addMoving(stripGeometry(bendPath(posture.opening, pivot - screenZ), -half, half), mats.screenOff);
    }
    // The inner display's picture lies along the sheet, which the bend
    // lengthens, so it follows every opening; the outer display's only
    // follows the hinge.
    if (shotScreen === 'inner' || (shotScreen === 'outer' && posture.across !== turnedBefore)) layShot(shotScreen);
  };

  // Which way is up on the screenshot, in the scene: its screen's up, turned
  // with that screen's half and the device.
  const up = new THREE.Vector3();
  /**
   * The outer display of an opened phone, as in the tent, turns its picture
   * round when it would read upside down, the way the phone's own display
   * does. Closed, the phone is held like any other and its picture stays with
   * its top edge, as the inner display's always does.
   */
  const orient = (deviceRotation: THREE.Quaternion) => {
    if (!shot || !shotFit) return;
    let turned = false;
    if (shotScreen === 'outer' && posture.opening > OUTER_TURNS_ABOVE) {
      up.set(shotFit.frame.up[0], shotFit.frame.up[1], 0)
        .applyQuaternion(hinge.quaternion)
        .applyQuaternion(hold.quaternion)
        .applyQuaternion(deviceRotation);
      // The camera looks along -z, so up in the picture is +y.
      turned = up.y < -1e-6;
    }
    shot.texture.rotation = turned ? Math.PI : 0;
  };

  group.scale.setScalar(1 / W);
  pose(posture);
  return {
    group,
    geometries,
    glareMeshes,
    pose,
    view: (seen, deviceRotation) => {
      if (shot) {
        const screen = foldScreenInView(model, posture, seen.orientation, seen.lens, shotScreen ?? undefined);
        if (screen !== shotScreen) layShot(screen);
      }
      orient(deviceRotation);
    },
    setShot: (next) => {
      shot = next;
      shotMaterial?.dispose();
      shotMaterial = next ? new THREE.MeshBasicMaterial({ map: next.texture, toneMapped: false }) : null;
      layShot(shotScreen ?? foldScreenOf(posture.opening));
    },
    dispose: () => {
      clearShot();
      clearMoving();
      shotMaterial?.dispose();
      shotMaterial = null;
    },
  };
}

/**
 * The 3D Studio device: one measured phone, turned to any angle, drawn with
 * three.js.
 *
 * Nothing here is rebuilt when the angle, lens, finish, light or glare change:
 * the scene stays and only its transforms, materials and camera move, which is
 * what lets a drag on the canvas turn the device at full frame rate. The
 * camera never moves when the device turns (see device3dStudio.ts), and while
 * a turn is live the canvas grows to the device's bounding sphere so nothing
 * is cut off before the box catches up.
 */
export function DeviceStudioRenderer({
  deviceType,
  screenshotSrc,
  objectFit = 'cover',
  orientation,
  lens,
  frameColor,
  backColor,
  accentColor,
  light,
  glare,
  opening,
  across = false,
  liveKey,
}: DeviceStudioRendererProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [rebuildTick, setRebuildTick] = useState(0);
  // The committed values, read by the scene without rebuilding it.
  const propsRef = useRef({ orientation, lens, frameColor, backColor, accentColor, light, glare, opening, across });
  propsRef.current = { orientation, lens, frameColor, backColor, accentColor, light, glare, opening, across };
  const refreshRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    const model = studioModelFor(deviceType);
    if (!mount || !model) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    const instanceId = Symbol('device-studio');
    liveInstances.add(instanceId);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Neutral keeps the finish's hue and saturation, which is the point of a
    // product shot. The screenshot opts out entirely (toneMapped false).
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1;
    const canvas = renderer.domElement;
    canvas.style.position = 'absolute';
    canvas.style.display = 'block';
    mount.appendChild(canvas);

    const handleContextLost = (e: Event) => e.preventDefault();
    const handleContextRestored = () => setRebuildTick((t) => t + 1);
    canvas.addEventListener('webglcontextlost', handleContextLost);
    canvas.addEventListener('webglcontextrestored', handleContextRestored);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    let envTexture: THREE.Texture | null = null;
    let envLight: Device3DLight | null = null;

    const camera = new THREE.PerspectiveCamera(20, 1, 0.1, 100);
    const keyLight = new THREE.DirectionalLight(0xffffff, 1);
    scene.add(keyLight);
    const ambient = new THREE.AmbientLight(0xffffff, 0.15);
    scene.add(ambient);

    const device = new THREE.Group();
    scene.add(device);
    const mats = createMaterials(model);
    const built = model.fold ? buildFoldable(model, mats) : phoneDevice(buildPhone(model, mats));
    device.add(built.group);
    const { glareMeshes } = built;

    // ---- screenshot ----------------------------------------------------------
    let texture: THREE.Texture | null = null;
    let textureImage: HTMLImageElement | null = null;
    const updateShot = () =>
      built.setShot(texture && textureImage ? { texture, image: textureImage, fit: objectFit } : null);

    // ---- state ---------------------------------------------------------------
    let live: StudioLiveState | null = liveKey ? studioLiveState(liveKey) ?? null : null;
    // Set when a gesture has ended but its commit has not reached the props yet.
    let ending: StudioLiveState | null = null;
    let endTimer = 0;
    // The frame the live canvas is drawn at: the committed one when the
    // gesture began, so the device keeps its size and centre throughout.
    let liveFrame: { scale: number; centerU: number; centerV: number } | null = null;
    let disposed = false;

    const defaultOpening = model.fold?.opening ?? 180;
    const postureOf = (opening: number | undefined, turned: boolean): FoldPosture => ({
      opening: clampOpening(opening, defaultOpening),
      across: turned,
    });
    const effective = () => {
      const base = propsRef.current;
      const over = live ?? ending;
      return {
        orientation: over?.orientation ?? base.orientation,
        lens: clampLens(over?.lens ?? base.lens),
        frameColor: over?.finish?.frame ?? base.frameColor,
        backColor: over?.finish?.back ?? base.backColor,
        // A finish being previewed is a custom colour, which has no accent.
        accentColor: over?.finish ? over.finish.frame : base.accentColor ?? base.frameColor,
        light: over?.light ?? base.light,
        glare: over?.glare ?? base.glare,
        posture: postureOf(over?.fold ?? base.opening, base.across),
      };
    };
    let posedAs = '';
    const applyPosture = (posture: FoldPosture) => {
      if (!model.fold) return;
      const key = `${posture.opening}|${posture.across}`;
      if (key === posedAs) return;
      posedAs = key;
      built.pose(posture);
    };

    let appliedFinish = '';
    const applyMaterials = (state: ReturnType<typeof effective>) => {
      const finishKey = `${state.frameColor}/${state.backColor}/${state.accentColor}`;
      if (finishKey !== appliedFinish) {
        appliedFinish = finishKey;
        const frame = new THREE.Color(state.frameColor);
        const backTint = new THREE.Color(state.backColor);
        mats.frame.color.copy(frame);
        mats.satin.color.copy(frame);
        mats.accent.color.set(state.accentColor);
        mats.backMetal.color.copy(frame);
        mats.backGlass.color.copy(backTint);
        mats.backGloss.color.copy(backTint);
        mats.windowGlass.color.copy(backTint);
        mats.padGlass.color.copy(backTint);
        mats.ring.color.copy(ringShade(frame));
      }
      const l = state.light;
      if (!envLight || envLight.azimuth !== l.azimuth || envLight.elevation !== l.elevation) {
        envLight = { ...l };
        const envScene = buildStudioEnvironment(l);
        const next = pmrem.fromScene(envScene, 0.02).texture;
        envScene.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.geometry.dispose();
            (mesh.material as THREE.Material).dispose();
          }
        });
        envTexture?.dispose();
        envTexture = next;
        scene.environment = next;
      }
      keyLight.position.copy(lightDirection(l).multiplyScalar(10));
      keyLight.intensity = 1.1 * l.intensity;
      scene.environmentIntensity = 0.95 * l.intensity;
      mats.glare.opacity = state.glare;
      for (const mesh of glareMeshes) mesh.visible = state.glare > 0.001;
    };

    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const applyOrientation = (o: Device3DOrientation) => {
      // ZXY Euler is roll(Z) * pitch(X) * yaw(Y), the order device3dStudio uses.
      euler.set(
        THREE.MathUtils.degToRad(o.pitch),
        THREE.MathUtils.degToRad(o.yaw),
        THREE.MathUtils.degToRad(o.roll),
        'ZXY'
      );
      device.quaternion.copy(quat.setFromEuler(euler));
    };

    /** Points the camera and sets an off-axis frustum over centre-plane units [uL,uR] x [vB,vT]. */
    const aimCamera = (lensDeg: number, posture: FoldPosture, uL: number, uR: number, vB: number, vT: number) => {
      const d = studioCameraDistance(model, lensDeg, posture);
      camera.position.set(0, STUDIO_CAMERA_LIFT * d, d);
      camera.up.set(0, 1, 0);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      const reach = studioSphereRadius(model, lensDeg, posture) * 0.6;
      const near = Math.max(0.01, (d - reach) * 0.5);
      const far = (d + reach) * 2 + 1;
      const centreDepth = d * Math.sqrt(1 + STUDIO_CAMERA_LIFT * STUDIO_CAMERA_LIFT);
      const k = near / centreDepth;
      camera.near = near;
      camera.far = far;
      camera.projectionMatrix.makePerspective(uL * k, uR * k, vT * k, vB * k, near, far);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    };

    let lastPixelRatio = 0;
    let lastW = 0;
    let lastH = 0;
    const effectivePixelRatio = (allowBelowOne = false) => {
      const rect = mount.getBoundingClientRect();
      const cssScale = mount.clientWidth > 0 ? rect.width / mount.clientWidth : 1;
      // ~2x the pixels on screen, like the posed renderer. The floor of 1 keeps
      // a resting canvas at least layout-sized for PNG export; a live gesture
      // is never exported, so it can drop below to stay smooth when zoomed out.
      const target = cssScale * (window.devicePixelRatio || 1) * 2;
      return Math.min(Math.max(target, allowBelowOne ? 0.5 : 1), pixelRatioCap());
    };

    /**
     * Where the canvas sits over the mount. At rest it fills the mount in CSS
     * percentages, so a handle drag stretches it until the buffer catches up;
     * during a gesture it is the square round the device.
     */
    const setCanvasBox = (left: number, top: number, w: number, h: number, pr: number, fill = false) => {
      canvas.style.left = fill ? '0' : `${left}px`;
      canvas.style.top = fill ? '0' : `${top}px`;
      canvas.style.width = fill ? '100%' : `${w}px`;
      canvas.style.height = fill ? '100%' : `${h}px`;
      const bw = Math.max(1, Math.round(w));
      const bh = Math.max(1, Math.round(h));
      if (pr !== lastPixelRatio || bw !== lastW || bh !== lastH) {
        lastPixelRatio = pr;
        lastW = bw;
        lastH = bh;
        renderer.setPixelRatio(pr);
        renderer.setSize(bw, bh, false);
      }
    };

    const render = () => renderer.render(scene, camera);

    /** Lay out, frame and draw from the current props and live state. Synchronous. */
    const refresh = (forcePixelRatio?: number) => {
      if (disposed) return;
      const cw = mount.clientWidth;
      const ch = mount.clientHeight;
      if (cw < 2 || ch < 2) return;
      // A finished gesture whose commit has landed hands back to the props.
      if (ending && !live) {
        const base = propsRef.current;
        const landed =
          (!ending.orientation || sameOrientation(ending.orientation, base.orientation, 0.02)) &&
          (ending.lens === undefined || Math.abs(clampLens(ending.lens) - clampLens(base.lens)) < 0.01) &&
          (ending.finish === undefined || (ending.finish.frame === base.frameColor && ending.finish.back === base.backColor)) &&
          (ending.glare === undefined || Math.abs(ending.glare - base.glare) < 0.001) &&
          (ending.fold === undefined || Math.abs(clampOpening(ending.fold) - clampOpening(base.opening, defaultOpening)) < 0.01) &&
          (!ending.light ||
            (ending.light.azimuth === base.light.azimuth &&
              ending.light.elevation === base.light.elevation &&
              ending.light.intensity === base.light.intensity));
        if (landed) {
          ending = null;
          liveFrame = null;
          window.clearTimeout(endTimer);
        }
      }
      const state = effective();
      applyMaterials(state);
      applyPosture(state.posture);
      applyOrientation(state.orientation);
      built.view({ orientation: state.orientation, lens: state.lens }, device.quaternion);
      if (liveFrame && (live || ending)) {
        // Live: a square round the device centre, at the frame the gesture
        // started from, large enough for the device at any angle.
        const s = liveFrame.scale;
        const half = studioSphereRadius(model, state.lens, state.posture) * 1.03;
        const side = 2 * half * s;
        const originX = cw / 2 - liveFrame.centerU * s;
        const originY = ch / 2 + liveFrame.centerV * s;
        setCanvasBox(originX - side / 2, originY - side / 2, side, side, forcePixelRatio ?? effectivePixelRatio(true));
        aimCamera(state.lens, state.posture, -half, half, -half, half);
      } else {
        setCanvasBox(0, 0, cw, ch, forcePixelRatio ?? effectivePixelRatio(), true);
        const frame = studioFrame(model, state.orientation, state.lens, cw, ch, state.posture);
        const hw = cw / (2 * frame.scale);
        const hh = ch / (2 * frame.scale);
        aimCamera(state.lens, state.posture, frame.centerU - hw, frame.centerU + hw, frame.centerV - hh, frame.centerV + hh);
      }
      // setSize wipes the drawing buffer, so a frame is presented before
      // returning: an export can snapshot the canvas at any moment.
      render();
    };
    refreshRef.current = () => refresh();

    // Live gestures: draw on the next frame, at most once a frame.
    let rafId = 0;
    const scheduleRefresh = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        refresh();
      });
    };
    const unsubscribeLive = liveKey
      ? subscribeStudioLive(liveKey, (state, reason) => {
          if (state) {
            if (!liveFrame) {
              const base = propsRef.current;
              const cw = mount.clientWidth;
              const ch = mount.clientHeight;
              liveFrame = studioFrame(model, base.orientation, clampLens(base.lens), Math.max(cw, 2), Math.max(ch, 2), postureOf(base.opening, base.across));
            }
            window.clearTimeout(endTimer);
            ending = null;
            live = state;
            scheduleRefresh();
            return;
          }
          if (reason === 'cancel') {
            live = null;
            ending = null;
            liveFrame = null;
            window.clearTimeout(endTimer);
            refresh();
            return;
          }
          // Ended. Keep showing it until the commit lands (refresh hands back),
          // or give up after a moment if nothing was committed.
          ending = live;
          live = null;
          window.clearTimeout(endTimer);
          endTimer = window.setTimeout(() => {
            ending = null;
            liveFrame = null;
            refresh();
          }, 900);
          refresh();
        })
      : () => {};
    if (live) {
      const base = propsRef.current;
      liveFrame = studioFrame(
        model,
        base.orientation,
        clampLens(base.lens),
        Math.max(mount.clientWidth, 2),
        Math.max(mount.clientHeight, 2),
        postureOf(base.opening, base.across)
      );
    }

    // Resizing by the handles stretches the canvas with CSS (cheap); the
    // buffer and frame catch up once the drag is idle.
    let resizeTimer = 0;
    let firstSize = true;
    const handleResize = () => {
      if (firstSize) {
        firstSize = false;
        refresh();
        return;
      }
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => refresh(), 110);
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(mount);
    handleResize();
    // Ancestor transforms (canvas zoom) are invisible to ResizeObserver.
    const scaleWatch = window.setInterval(() => {
      if (live) return;
      if (Math.abs(effectivePixelRatio() - lastPixelRatio) > 0.1) refresh();
    }, 800);

    // PNG and video export draw this canvas 1:1, so render supersampled while
    // one is in flight, the same contract the posed renderer keeps.
    const handleExportPhase = (e: Event) => {
      const phase = (e as CustomEvent).detail?.phase;
      if (phase === 'begin') {
        live = null;
        ending = null;
        liveFrame = null;
        refresh(Math.max(2, lastPixelRatio));
      } else {
        lastPixelRatio = 0;
        refresh();
      }
    };
    window.addEventListener('artboard:export', handleExportPhase);

    if (screenshotSrc) {
      const img = new window.Image();
      img.onload = () => {
        if (disposed) return;
        textureImage = img;
        texture = new THREE.Texture(img);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.needsUpdate = true;
        updateShot();
        refresh();
      };
      img.src = withBasePath(screenshotSrc);
    }

    return () => {
      disposed = true;
      refreshRef.current = null;
      liveInstances.delete(instanceId);
      unsubscribeLive();
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored);
      window.removeEventListener('artboard:export', handleExportPhase);
      window.clearInterval(scaleWatch);
      window.clearTimeout(resizeTimer);
      window.clearTimeout(endTimer);
      if (rafId) window.cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      built.dispose();
      for (const geo of built.geometries) geo.dispose();
      for (const mat of Object.values(mats)) mat.dispose();
      texture?.dispose();
      envTexture?.dispose();
      pmrem.dispose();
      renderer.dispose();
      // Release the context slot now rather than at GC, so a batch swap of N
      // devices never holds 2N contexts.
      renderer.forceContextLoss();
      mount.removeChild(canvas);
    };
  }, [deviceType, screenshotSrc, objectFit, liveKey, rebuildTick]);

  // Angle, lens, finish, light, glare and a foldable's posture reach the live
  // scene without a rebuild.
  useEffect(() => {
    refreshRef.current?.();
  }, [
    orientation.yaw,
    orientation.pitch,
    orientation.roll,
    lens,
    frameColor,
    backColor,
    accentColor,
    light.azimuth,
    light.elevation,
    light.intensity,
    glare,
    opening,
    across,
  ]);

  return <div ref={mountRef} style={{ position: 'relative', width: '100%', height: '100%', pointerEvents: 'none' }} />;
}

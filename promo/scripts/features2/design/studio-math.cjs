"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// <stdin>
var stdin_exports = {};
__export(stdin_exports, {
  FOLD_GRIP_REACH: () => FOLD_GRIP_REACH,
  FOLD_INNER_PREFERENCE: () => FOLD_INNER_PREFERENCE,
  PHONE_MODELS: () => PHONE_MODELS,
  STUDIO_CAMERA_LIFT: () => STUDIO_CAMERA_LIFT,
  STUDIO_DEFAULT_SCALE: () => STUDIO_DEFAULT_SCALE,
  STUDIO_DRAG_DEGREES_PER_RADIUS: () => STUDIO_DRAG_DEGREES_PER_RADIUS,
  STUDIO_FIT_MARGIN: () => STUDIO_FIT_MARGIN,
  STUDIO_FOLD_POSES: () => STUDIO_FOLD_POSES,
  STUDIO_LENS_DEFAULT: () => STUDIO_LENS_DEFAULT,
  STUDIO_LENS_MAX: () => STUDIO_LENS_MAX,
  STUDIO_LENS_MIN: () => STUDIO_LENS_MIN,
  STUDIO_LIGHT_DEFAULT: () => STUDIO_LIGHT_DEFAULT,
  STUDIO_LIGHT_ELEVATION_MAX: () => STUDIO_LIGHT_ELEVATION_MAX,
  STUDIO_LIGHT_ELEVATION_MIN: () => STUDIO_LIGHT_ELEVATION_MIN,
  STUDIO_LIGHT_INTENSITY_MAX: () => STUDIO_LIGHT_INTENSITY_MAX,
  STUDIO_LIGHT_INTENSITY_MIN: () => STUDIO_LIGHT_INTENSITY_MIN,
  STUDIO_LOOKS: () => STUDIO_LOOKS,
  STUDIO_MODELS: () => STUDIO_MODELS,
  STUDIO_TILE_FOLD: () => STUDIO_TILE_FOLD,
  STUDIO_TILE_LOOK: () => STUDIO_TILE_LOOK,
  clampLens: () => clampLens,
  clampOpening: () => clampOpening,
  defaultFoldPosture: () => defaultFoldPosture,
  exposedSide: () => exposedSide,
  foldDisplaysInView: () => foldDisplaysInView,
  foldScreenInView: () => foldScreenInView,
  foldScreenOf: () => foldScreenOf,
  isFoldable: () => isFoldable,
  isMeasuredModel: () => isMeasuredModel,
  isStudioStyle: () => isStudioStyle,
  lightForOrientation: () => lightForOrientation,
  matchStudioLook: () => matchStudioLook,
  measuredModelFor: () => measuredModelFor,
  mirrorOrientation: () => mirrorOrientation,
  orientationForPose: () => orientationForPose,
  orientationFromMatrix: () => orientationFromMatrix,
  orientationMatrix: () => orientationMatrix,
  rehugStudioBox: () => rehugStudioBox,
  sameOrientation: () => sameOrientation,
  snapDegrees: () => snapDegrees,
  studioBounds: () => studioBounds,
  studioCameraDistance: () => studioCameraDistance,
  studioConversionPatch: () => studioConversionPatch,
  studioCustomColorOf: () => studioCustomColorOf,
  studioDefaultScale: () => studioDefaultScale,
  studioDefaultSize: () => studioDefaultSize,
  studioFinishOf: () => studioFinishOf,
  studioFoldGrip: () => studioFoldGrip,
  studioFoldPoseById: () => studioFoldPoseById,
  studioFoldTo: () => studioFoldTo,
  studioFrame: () => studioFrame,
  studioGlareOf: () => studioGlareOf,
  studioHugSize: () => studioHugSize,
  studioLensOf: () => studioLensOf,
  studioLightOf: () => studioLightOf,
  studioLookById: () => studioLookById,
  studioModelFor: () => studioModelFor,
  studioOrientationOf: () => studioOrientationOf,
  studioPostureOf: () => studioPostureOf,
  studioSphereRadius: () => studioSphereRadius,
  studioTileStyleProps: () => studioTileStyleProps,
  turntableTurn: () => turntableTurn,
  withStudioRehug: () => withStudioRehug,
  wrapDegrees: () => wrapDegrees
});
module.exports = __toCommonJS(stdin_exports);

// ../../../../../../../../../../Documents/GitHub/artboard-studio/src/lib/device3dPoseAngles.ts
var DEVICE_3D_POSE_ANGLES = {
  classic: { yaw: 24, pitch: 0 },
  // Dead-on product shot with no rotation at all, only the perspective of the
  // camera itself (band tips foreshorten, rails stay hidden).
  front: { yaw: 0, pitch: 0 },
  upright: { yaw: 34, pitch: 0 },
  side: { yaw: 54, pitch: 0 },
  tilted: { yaw: 30, pitch: 26 },
  reclined: { yaw: 33, pitch: 48 },
  laying: { yaw: 28, pitch: 66 },
  floating: { yaw: 34, pitch: 36, roll: -20, bodyAspect: 2.05 },
  drifting: { yaw: 32, pitch: 46, roll: -35, bodyAspect: 2.05 },
  // Gentle diagonal rest: mild yaw toward the exposed rail, slight backward
  // pitch, strong in-image lean (clockwise on side 'left'). Long axis runs
  // diagonally but the screen stays ~90% visible.
  leaning: { yaw: 21, pitch: 10, roll: -31, bodyAspect: 2.05 },
  // Dramatic float: deeper yaw, NEGATIVE pitch (camera above the face, top
  // edge toward the viewer) and a heavy opposite lean (counter-clockwise on
  // side 'right'). Reads as a phone sailing diagonally across the canvas.
  soaring: { yaw: 35, pitch: -15, roll: -36, bodyAspect: 2.05 },
  // Exact yaw/pitch/roll decomposition of the classic 2D isometric mockup
  // projection: spin the phone 60° on the table, then view the table from
  // arccos(0.6) ≈ 53° above (SVG equivalent: rotate(∓60) scale(1, 0.6)).
  // The NEGATIVE pitch is what puts the camera above the face. The laying
  // poses use positive pitch and read as shot from below the plane.
  isometric: { yaw: 49.107, pitch: -23.578, roll: 70.893, bodyAspect: 2.05 }
};

// ../../../../../../../../../../Documents/GitHub/artboard-studio/src/lib/device3dModels.ts
var FINISHES_18_PRO = [
  { id: "black", label: "Black", frame: "#3b3b3e", back: "#36363a" },
  { id: "silver", label: "Silver", frame: "#dcdddf", back: "#e7e8ea" },
  { id: "glacier", label: "Glacier", frame: "#bccfdc", back: "#cddce6" },
  { id: "burgundy", label: "Burgundy", frame: "#4a1a24", back: "#55212b" }
];
var FINISHES_17_PRO = [
  { id: "cosmic-orange", label: "Cosmic Orange", frame: "#e8692b", back: "#ea7a3c" },
  { id: "deep-blue", label: "Deep Blue", frame: "#323d55", back: "#3a465f" },
  { id: "silver", label: "Silver", frame: "#dcdddf", back: "#e8e9eb" }
];
var FINISHES_AIR = [
  { id: "space-black", label: "Space Black", frame: "#2c2c2f", back: "#2a2a2d" },
  { id: "cloud-white", label: "Cloud White", frame: "#ecebe6", back: "#f2f1ec" },
  { id: "light-gold", label: "Light Gold", frame: "#e3d3b4", back: "#ebdfc8" },
  { id: "sky-blue", label: "Sky Blue", frame: "#c4d8e8", back: "#d3e3ef" }
];
var FINISHES_17 = [
  { id: "black", label: "Black", frame: "#2f2f32", back: "#2b2b2e" },
  { id: "white", label: "White", frame: "#ecece9", back: "#f3f3f0" },
  { id: "mist-blue", label: "Mist Blue", frame: "#9fb3c8", back: "#b3c3d4" },
  { id: "sage", label: "Sage", frame: "#a3b094", back: "#b7c2a9" },
  { id: "lavender", label: "Lavender", frame: "#c2b2da", back: "#d2c5e5" }
];
var FINISHES_17E = [
  { id: "black", label: "Black", frame: "#2d2d30", back: "#2a2a2d" },
  { id: "white", label: "White", frame: "#eeeeeb", back: "#f3f3f1" },
  { id: "soft-pink", label: "Soft Pink", frame: "#efcfd1", back: "#f3dadb" }
];
var FINISHES_16_PRO = [
  { id: "black-titanium", label: "Black Titanium", frame: "#3c3c3e", back: "#3a3a3d" },
  { id: "white-titanium", label: "White Titanium", frame: "#e6e4df", back: "#efede9" },
  { id: "natural-titanium", label: "Natural Titanium", frame: "#bdb7ac", back: "#c9c4bb" },
  { id: "desert-titanium", label: "Desert Titanium", frame: "#b49a80", back: "#bfa891" }
];
var FINISHES_16 = [
  { id: "black", label: "Black", frame: "#38383b", back: "#333336" },
  { id: "white", label: "White", frame: "#f0f0ec", back: "#f5f5f2" },
  { id: "pink", label: "Pink", frame: "#f08bc4", back: "#f3b3d8" },
  { id: "teal", label: "Teal", frame: "#6fb8b3", back: "#a9d3cf" },
  { id: "ultramarine", label: "Ultramarine", frame: "#4f62d9", back: "#8193ef" }
];
var FINISHES_16E = [
  { id: "black", label: "Black", frame: "#2e2e31", back: "#2b2b2e" },
  { id: "white", label: "White", frame: "#efefec", back: "#f4f4f1" }
];
var FINISHES_DUO = [
  { id: "star-white", label: "Star White", frame: "#d9d6cf", back: "#eeede9" },
  { id: "night-sky", label: "Night Sky", frame: "#3b4558", back: "#333c4b" }
];
var PLATEAU_WALL_18 = [
  [0, 2.78],
  [0.06, 2.731],
  [0.1, 2.498],
  [0.15, 2.295],
  [0.2, 2.134],
  [0.25, 1.997],
  [0.35, 1.771],
  [0.5, 1.501],
  [0.7, 1.216],
  [0.95, 0.939],
  [1.25, 0.687],
  [1.6, 0.464],
  [2, 0.285],
  [2.5, 0.138],
  [3, 0.054],
  [3.6, 0.011],
  [4.3, 1e-3],
  [5.11, 0]
];
var PLATEAU_WALL_17 = [
  [0, 2.55],
  [0.06, 2.502],
  [0.1, 2.347],
  [0.15, 2.175],
  [0.2, 2.037],
  [0.25, 1.915],
  [0.35, 1.729],
  [0.5, 1.451],
  [0.7, 1.195],
  [0.95, 0.901],
  [1.25, 0.667],
  [1.6, 0.436],
  [2, 0.269],
  [2.5, 0.131],
  [3, 0.05],
  [3.6, 0.011],
  [4.3, 2e-3],
  [5.07, 0]
];
var BUMP_WALL_17 = [
  [0, 1.78],
  [0.04, 1.682],
  [0.08, 1.587],
  [0.12, 1.492],
  [0.17, 1.378],
  [0.26, 1.188],
  [0.37, 0.995],
  [0.49, 0.814],
  [0.63, 0.648],
  [0.78, 0.498],
  [0.95, 0.365],
  [1.14, 0.25],
  [1.33, 0.162],
  [1.54, 0.092],
  [1.75, 0.045],
  [1.97, 0.016],
  [2.19, 5e-3],
  [2.62, 0]
];
var BUMP_WALL_16 = [
  [0, 1.85],
  [0.04, 1.749],
  [0.09, 1.631],
  [0.13, 1.539],
  [0.17, 1.445],
  [0.22, 1.334],
  [0.27, 1.235],
  [0.33, 1.124],
  [0.39, 1.024],
  [0.51, 0.845],
  [0.65, 0.675],
  [0.81, 0.519],
  [0.99, 0.378],
  [1.18, 0.26],
  [1.39, 0.164],
  [1.6, 0.093],
  [1.82, 0.044],
  [2.04, 0.016],
  [2.27, 4e-3],
  [2.71, 0]
];
var BUMP_WALL_16_PRO = [
  [0, 2.05],
  [0.25, 1.538],
  [0.58, 1.098],
  [1, 0.716],
  [1.48, 0.414],
  [2, 0.2],
  [2.55, 0.068],
  [3.1, 0.013],
  [3.66, 0]
];
function scaledWall(wall, width, height) {
  const [, h] = wall[0];
  const w = wall[wall.length - 1][0];
  return wall.map(([d, rise]) => [Math.round(d / w * width * 1e4) / 1e4, Math.round(rise / h * height * 1e4) / 1e4]);
}
var BUMP_WALL_DUO = scaledWall(BUMP_WALL_17, 1, 1.5);
var AIR_WALL = [
  [0, 3.03],
  [0.1, 2.825],
  [0.21, 2.622],
  [0.33, 2.423],
  [0.46, 2.232],
  [0.59, 2.053],
  [0.74, 1.87],
  [0.89, 1.702],
  [1.05, 1.539],
  [1.39, 1.234],
  [1.75, 0.967],
  [2.14, 0.727],
  [2.55, 0.522],
  [2.98, 0.353],
  [3.41, 0.226],
  [3.86, 0.129],
  [4.31, 0.066],
  [4.76, 0.027],
  [5.22, 9e-3],
  [6.11, 0]
];
var AIR_WALL_NARROW = [
  [0, 3.03],
  [0.12, 2.749],
  [0.25, 2.475],
  [0.4, 2.213],
  [0.56, 1.958],
  [0.74, 1.713],
  [0.94, 1.479],
  [1.15, 1.257],
  [1.37, 1.05],
  [1.6, 0.854],
  [1.85, 0.674],
  [2.1, 0.508],
  [2.37, 0.359],
  [2.92, 0.124],
  [3.5, 0]
];
var IPHONE_DUO = {
  id: "iphone-duo",
  label: "iPhone Duo",
  maker: "apple",
  drawing: "2026-10-16",
  width: 164.6,
  height: 117.8,
  thickness: 5.2,
  // The inner display's screenshot, 2853 x 2007 at 3x.
  screenPoints: [951, 669],
  metal: "titanium",
  // The open body's four corners agree to 0.02 mm; the corner leaves each edge 16 mm out.
  corner: [[16, 0], [13, 0.042], [11, 0.207], [9, 0.593], [7, 1.319], [5, 2.484], [3.648, 3.648], [2.484, 5], [1.319, 7], [0.593, 9], [0.207, 11], [0.042, 13], [0, 16]],
  // Estimated: a frame lip round the inner display that the bezel shows 0.65 mm
  // wide, flat sides, and a rounder back edge that it shows 1.31 mm wide.
  edge: [[0.65, 2.6], [0.45, 2.585], [0.3, 2.52], [0.17, 2.42], [0.08, 2.29], [0.02, 2.13], [0, 2], [0, -1.3], [0.04, -1.62], [0.17, -1.95], [0.38, -2.24], [0.65, -2.43], [0.95, -2.55], [1.31, -2.6]],
  glass: { width: 163.3, height: 116.5 },
  // The inner display: the bezel's 2853 x 2007 opening is 157.75 x 110.97 at
  // this scale, inside a bezel of 3.41 to 3.42 all round. One bezel of 3.415
  // all round, as on every iPhone sheet, gives these.
  display: { width: 157.77, height: 110.97 },
  flatInset: 0.65,
  // The inner camera sits under the display.
  cutout: { kind: "none" },
  receiver: { width: 0, top: 0, bottom: 0 },
  back: { kind: "glass" },
  pads: [
    // The glossy island, where the matte back's grain stops: a stadium whose
    // ends are nearly concentric with the first lens and the flash.
    { shape: "stadium", x0: 4.9, y0: 4.69, x1: 60.39, y1: 25.64, radius: 10.47, height: 1.5, round: 1, material: "back", edge: "cove", wall: BUMP_WALL_DUO }
  ],
  lenses: [
    { x: 15.15, y: 15.19, ring: 16.14, ringInner: 14.32, glass: 14.1, ringDrop: 0.18 },
    { x: 32.92, y: 15.19, ring: 16.14, ringInner: 14.32, glass: 14.1, ringDrop: 0.18 }
  ],
  // Estimated: the rings stand about as far off the island as an iPhone 17's off its bump.
  lensTop: 3.3,
  flash: { x: 49.59, y: 19.67, d: 3.81 },
  mic: { x: 49.57, y: 10.9, d: 1.45, length: 3.12 },
  // The side button holds Touch ID. The Camera Control is flush, so the bezel
  // cannot show it: its centre is where Apple's diagram labels it, its size an estimate.
  buttons: [
    { side: "top", center: 124.86, length: 10.87, width: 2.2, proud: 0.465, kind: "button" },
    { side: "top", center: 138.25, length: 10.87, width: 2.2, proud: 0.465, kind: "button" },
    { side: "right", center: 42.9, length: 18.66, width: 2.5, proud: 0.458, kind: "button" },
    { side: "right", center: 69.33, length: 17.1, width: 2.2, proud: 0, kind: "control" }
  ],
  // From Apple's diagram of the closed edges: the USB-C port and two mics on
  // the left half, the speaker and mics on the right half's bottom edge, the
  // other speaker on the left half's top edge. Hole sizes are estimates.
  port: { width: 8.6, height: 2.6, x: 41.4 },
  holes: { x: [34, 48.8, 98.22, 100.45, 102.75, 105.06, 115.8, 130.6, 141.43, 143.73, 145.96, 148.19], d: 1.1 },
  topHoles: { x: [33.51, 36.16, 38.81, 41.47, 44.12, 46.77], d: 1.2 },
  screws: { x: [], d: 0 },
  finishes: FINISHES_DUO,
  defaultFinish: "star-white",
  fold: {
    closedThickness: 11.3,
    closedWidth: 84.1,
    hingeCorner: [[0.94, 0], [0.72, 0.029], [0.5, 0.087], [0.33, 0.17], [0.245, 0.245], [0.17, 0.33], [0.087, 0.5], [0.029, 0.72], [0, 0.94]],
    // Both backs' glass, read off the open back bezel where it meets the
    // frame: 1.31 in on the free side, top and bottom (the round-over's end,
    // 0.65 in, is the edge profile's estimate). Along the hinge the glass
    // starts 0.97 from the hinge line (the back glass reads 0.976, the outer
    // display's 0.957) behind a seal the bezel draws as a hairline, and the
    // frame's round-over there is 0.28 wide. The glass turns each hinge
    // corner over 2.5 mm each way, 0.657 in on the diagonal: the mean of
    // both corners of both backs, which agree within 0.02 mm.
    back: {
      inset: 1.31,
      round: 0.65,
      hinge: {
        inset: 0.97,
        round: 0.28,
        seal: 0.06,
        corner: [[2.5, 0], [2.25, 0.017], [2, 0.036], [1.75, 0.08], [1.5, 0.147], [1.25, 0.246], [1, 0.373], [0.8, 0.521], [0.657, 0.657], [0.521, 0.8], [0.373, 1], [0.246, 1.25], [0.147, 1.5], [0.08, 1.75], [0.036, 2], [0.017, 2.25], [0, 2.5]]
      }
    },
    // The spine's ends are 1.43 mm in from the top and bottom on the closed
    // bezel; Apple's diagram draws it over the middle 70% of the closed
    // thickness with rounded edges, which puts its seams 0.9 mm behind each
    // half's middle.
    spine: { endInset: 1.43, seam: 0.9, round: 0.8 },
    outer: {
      // The bezel's 1398 x 2034 opening.
      width: 77.3,
      height: 112.47,
      hinge: 2.34,
      hingeCorner: [[1.5, 0], [1, 0.056], [0.75, 0.147], [0.5, 0.272], [0.394, 0.394], [0.272, 0.5], [0.147, 0.75], [0.056, 1], [0, 1.5]],
      camera: { d: 6.01, x: 10.57, y: 10.59 },
      // A pill the closed bezel draws over the top edge's speaker holes,
      // where the glass edge steps 0.18 mm lower for 12.6 mm.
      receiver: { from: 34.6, to: 47.25, depth: 0.18 },
      // The outer display's screenshot, 1398 x 2034 at 3x.
      screenPoints: [466, 678]
    },
    opening: 180
  }
};
var IPHONE_18_PRO_MAX = {
  id: "iphone-18-pro-max",
  label: "iPhone 18 Pro Max",
  maker: "apple",
  drawing: "2026-09-09",
  width: 77.98,
  height: 163.43,
  thickness: 8.75,
  screenPoints: [440, 956],
  metal: "aluminium",
  corner: [[19.43, 0], [13.9, 0.04], [8.46, 0.92], [3.8, 3.8], [0.92, 8.46], [0.04, 13.9], [0, 19.43]],
  edge: [[2.61, 4.38], [1.2, 4.29], [0.9, 4.24], [0.15, 2.99], [0.01, 1.5], [0, 0], [0, -1.44], [0.17, -2.86], [0.97, -4.01], [2.35, -4.35], [3.79, -4.38]],
  glass: { width: 75.58, height: 161.03 },
  display: { width: 72.86, height: 158.31 },
  // The sheet labels this 2.56, but its Detail A and B draw the flat glass starting at 2.61, as every other Pro sheet does.
  flatInset: 2.61,
  cutout: { kind: "island", width: 15.68, height: 6.07, center: 7.91 },
  receiver: { width: 26.58, top: 1.14, bottom: 1.6 },
  back: { kind: "metal", window: { side: 3.84, top: 48.81, bottom: 159.59 } },
  pads: [
    { shape: "plateau", height: 2.78, deckInset: 5.12, deckBottom: 42.85, deckCorner: 13.95, wall: PLATEAU_WALL_18 }
  ],
  lenses: [
    { x: 14.37, y: 14.37, ring: 16.58, ringInner: 14.23, glass: 12.86 },
    { x: 14.37, y: 33.61, ring: 16.58, ringInner: 14.23, glass: 12.86 },
    { x: 32.49, y: 23.99, ring: 16.58, ringInner: 14.23, glass: 12.86 }
  ],
  lensTop: 4.89,
  flash: { x: 64.16, y: 13.82, d: 6.9 },
  mic: { x: 64.16, y: 23.99, d: 1.15 },
  sensor: { x: 64.16, y: 34.16, d: 6.9 },
  buttons: [
    { side: "left", center: 34.28, length: 6.9, width: 2.66, proud: 0.45, kind: "button" },
    { side: "left", center: 48.43, length: 11.2, width: 2.66, proud: 0.45, kind: "button" },
    { side: "left", center: 62.63, length: 11.2, width: 2.66, proud: 0.45, kind: "button" },
    { side: "right", center: 55.53, length: 17.7, width: 2.66, proud: 0.45, kind: "button" },
    { side: "right", center: 111.82, length: 17.1, width: 3.03, proud: 0, kind: "control" }
  ],
  port: { width: 9, height: 3.14 },
  // The sheet's hole label disagrees with its own drawing; every Pro sheet draws these holes at 1.35, the size the 16 Pro sheet prints.
  holes: { x: [15.4, 17.65, 19.91, 22.16, 24.42, 26.67, 51.3, 53.56, 55.81, 58.07, 60.32, 62.58], d: 1.35 },
  screws: { x: [32.06, 45.91], d: 1.5 },
  finishes: FINISHES_18_PRO,
  defaultFinish: "glacier"
};
var IPHONE_18_PRO = {
  id: "iphone-18-pro",
  label: "iPhone 18 Pro",
  maker: "apple",
  drawing: "2026-09-09",
  width: 71.85,
  height: 150.01,
  thickness: 8.75,
  screenPoints: [402, 874],
  metal: "aluminium",
  corner: [[19.43, 0], [13.9, 0.04], [8.46, 0.92], [3.8, 3.8], [0.92, 8.46], [0.04, 13.9], [0, 19.43]],
  edge: [[2.61, 4.38], [1.2, 4.29], [0.9, 4.24], [0.15, 2.99], [0.01, 1.5], [0, 0], [0, -1.44], [0.17, -2.86], [0.97, -4.01], [2.35, -4.35], [3.79, -4.38]],
  glass: { width: 69.45, height: 147.61 },
  display: { width: 66.57, height: 144.73 },
  flatInset: 2.61,
  cutout: { kind: "island", width: 15.66, height: 6.07, center: 7.99 },
  receiver: { width: 26.58, top: 1.14, bottom: 1.6 },
  back: { kind: "metal", window: { side: 3.84, top: 48.81, bottom: 146.17 } },
  pads: [
    { shape: "plateau", height: 2.78, deckInset: 5.12, deckBottom: 42.85, deckCorner: 14.06, wall: PLATEAU_WALL_18 }
  ],
  lenses: [
    { x: 14.37, y: 14.37, ring: 16.58, ringInner: 14.23, glass: 12.86 },
    { x: 14.37, y: 33.61, ring: 16.58, ringInner: 14.23, glass: 12.86 },
    { x: 32.49, y: 23.99, ring: 16.58, ringInner: 14.23, glass: 12.86 }
  ],
  lensTop: 4.89,
  flash: { x: 58.03, y: 13.82, d: 6.9 },
  mic: { x: 58.03, y: 23.99, d: 1.15 },
  sensor: { x: 58.03, y: 34.16, d: 6.9 },
  buttons: [
    { side: "left", center: 34.28, length: 6.9, width: 2.66, proud: 0.45, kind: "button" },
    { side: "left", center: 48.43, length: 11.2, width: 2.66, proud: 0.45, kind: "button" },
    { side: "left", center: 62.63, length: 11.2, width: 2.66, proud: 0.45, kind: "button" },
    { side: "right", center: 55.53, length: 17.7, width: 2.66, proud: 0.45, kind: "button" },
    { side: "right", center: 98.4, length: 17.1, width: 3.03, proud: 0, kind: "control" }
  ],
  port: { width: 9, height: 3.14 },
  // The sheet's hole label disagrees with its own drawing; every Pro sheet draws these holes at 1.35, the size the 16 Pro sheet prints.
  holes: { x: [15.4, 17.65, 19.91, 22.16, 24.42, 47.43, 49.69, 51.94, 54.2, 56.45], d: 1.35 },
  screws: { x: [29, 42.85], d: 1.5 },
  finishes: FINISHES_18_PRO,
  defaultFinish: "burgundy"
};
var IPHONE_17_PRO_MAX = {
  id: "iphone-17-pro-max",
  label: "iPhone 17 Pro Max",
  maker: "apple",
  drawing: "2025-09-09",
  width: 77.98,
  height: 163.43,
  thickness: 8.75,
  screenPoints: [440, 956],
  metal: "aluminium",
  corner: [[19.43, 0], [13.9, 0.04], [8.46, 0.92], [3.8, 3.8], [0.92, 8.46], [0.04, 13.9], [0, 19.43]],
  edge: [[2.61, 4.38], [1.2, 4.29], [0.9, 4.24], [0.15, 2.99], [0.01, 1.5], [0, 0], [0, -1.44], [0.17, -2.86], [0.97, -4.01], [2.35, -4.35], [3.79, -4.38]],
  glass: { width: 75.58, height: 161.03 },
  display: { width: 72.86, height: 158.31 },
  flatInset: 2.61,
  cutout: { kind: "island", width: 20.76, height: 6.07, center: 7.91 },
  receiver: { width: 27.38, top: 0.9, bottom: 1.6 },
  back: { kind: "metal", window: { side: 3.84, top: 48.81, bottom: 159.58 } },
  pads: [
    // The flat top's edge is the innermost of the three nested lines the back view draws there (5.09, 5.03, 4.86 in from the side).
    { shape: "plateau", height: 2.55, deckInset: 5.09, deckBottom: 42.89, deckCorner: 13.9, wall: PLATEAU_WALL_17 }
  ],
  lenses: [
    { x: 14.37, y: 14.37, ring: 16.2, ringInner: 13.85, glass: 12.48 },
    { x: 14.37, y: 33.61, ring: 16.2, ringInner: 13.85, glass: 12.48 },
    { x: 32.36, y: 23.99, ring: 16.2, ringInner: 13.85, glass: 12.48 }
  ],
  lensTop: 4.43,
  flash: { x: 64.16, y: 13.82, d: 6.8 },
  mic: { x: 64.16, y: 23.99, d: 1.15 },
  sensor: { x: 64.16, y: 34.16, d: 6.65 },
  buttons: [
    { side: "left", center: 34.28, length: 6.9, width: 2.66, proud: 0.45, kind: "button" },
    { side: "left", center: 48.43, length: 11.2, width: 2.66, proud: 0.45, kind: "button" },
    { side: "left", center: 62.63, length: 11.2, width: 2.66, proud: 0.45, kind: "button" },
    { side: "right", center: 55.53, length: 17.7, width: 2.66, proud: 0.45, kind: "button" },
    { side: "right", center: 111.82, length: 17.1, width: 3.13, proud: 0, kind: "control" }
  ],
  port: { width: 9, height: 3.12 },
  // The sheet's hole label disagrees with its own drawing; every Pro sheet draws these holes at 1.35, the size the 16 Pro sheet prints.
  holes: { x: [15.41, 17.65, 19.91, 22.16, 24.42, 26.67, 51.3, 53.56, 55.81, 58.07, 60.32, 62.57], d: 1.35 },
  screws: { x: [32.06, 45.91], d: 1.5 },
  finishes: FINISHES_17_PRO,
  defaultFinish: "cosmic-orange"
};
var IPHONE_17_PRO = {
  id: "iphone-17-pro",
  label: "iPhone 17 Pro",
  maker: "apple",
  drawing: "2025-09-09",
  width: 71.85,
  height: 150.01,
  thickness: 8.75,
  screenPoints: [402, 874],
  metal: "aluminium",
  corner: [[19.43, 0], [13.9, 0.04], [8.46, 0.92], [3.8, 3.8], [0.92, 8.46], [0.04, 13.9], [0, 19.43]],
  edge: [[2.61, 4.38], [1.2, 4.29], [0.9, 4.24], [0.15, 2.99], [0.01, 1.5], [0, 0], [0, -1.44], [0.17, -2.86], [0.97, -4.01], [2.35, -4.35], [3.79, -4.38]],
  glass: { width: 69.45, height: 147.61 },
  display: { width: 66.57, height: 144.73 },
  flatInset: 2.61,
  cutout: { kind: "island", width: 20.76, height: 6.07, center: 7.99 },
  receiver: { width: 27.38, top: 0.9, bottom: 1.6 },
  back: { kind: "metal", window: { side: 3.84, top: 48.81, bottom: 146.17 } },
  pads: [
    { shape: "plateau", height: 2.55, deckInset: 5.09, deckBottom: 42.89, deckCorner: 13.89, wall: PLATEAU_WALL_17 }
  ],
  lenses: [
    { x: 14.37, y: 14.37, ring: 16.2, ringInner: 13.85, glass: 12.48 },
    { x: 14.37, y: 33.61, ring: 16.2, ringInner: 13.85, glass: 12.48 },
    { x: 32.36, y: 23.99, ring: 16.2, ringInner: 13.85, glass: 12.48 }
  ],
  lensTop: 4.43,
  flash: { x: 58.03, y: 13.82, d: 6.8 },
  mic: { x: 58.03, y: 23.99, d: 1.05 },
  sensor: { x: 58.03, y: 34.16, d: 6.65 },
  buttons: [
    { side: "left", center: 34.28, length: 6.9, width: 2.66, proud: 0.45, kind: "button" },
    { side: "left", center: 48.43, length: 11.2, width: 2.66, proud: 0.45, kind: "button" },
    { side: "left", center: 62.63, length: 11.2, width: 2.66, proud: 0.45, kind: "button" },
    { side: "right", center: 55.53, length: 17.7, width: 2.66, proud: 0.45, kind: "button" },
    { side: "right", center: 98.4, length: 17.1, width: 3.03, proud: 0, kind: "control" }
  ],
  port: { width: 9, height: 3.14 },
  // The sheet's hole label disagrees with its own drawing; every Pro sheet draws these holes at 1.35, the size the 16 Pro sheet prints.
  holes: { x: [15.4, 17.65, 19.91, 22.16, 24.42, 47.43, 49.69, 51.94, 54.2, 56.45], d: 1.35 },
  screws: { x: [29, 42.85], d: 1.5 },
  finishes: FINISHES_17_PRO,
  defaultFinish: "deep-blue"
};
var IPHONE_AIR = {
  id: "iphone-air",
  label: "iPhone Air",
  maker: "apple",
  drawing: "2025-09-09",
  width: 74.7,
  height: 156.18,
  thickness: 5.64,
  screenPoints: [420, 912],
  metal: "titanium",
  corner: [[19.36, 0], [13.85, 0.04], [8.43, 0.91], [3.78, 3.78], [0.91, 8.43], [0.04, 13.85], [0, 19.36]],
  edge: [[2.58, 2.82], [1.49, 2.79], [0.47, 2.44], [0.02, 1.47], [0, 0.38], [0, -0.38], [0.02, -1.47], [0.47, -2.44], [1.49, -2.79], [2.58, -2.82]],
  glass: { width: 72.42, height: 153.9 },
  display: { width: 69.55, height: 151.03 },
  flatInset: 2.58,
  cutout: { kind: "island", width: 20.76, height: 6.07, center: 8.92 },
  receiver: { width: 14.02, top: 1.09, bottom: 1.54 },
  back: { kind: "glass" },
  // The plateau is a stadium on top and follows the 1.14 glass seam at its base, so its skirt is wider at the bottom (6.12) than at the top (3.38).
  pads: [
    { shape: "loft", inset: 1.14, baseBottom: 34.17, baseCurve: 22.87, baseSide: 29.01, top: { x0: 4.77, y0: 4.52, x1: 69.94, y1: 28.06 }, height: 3.03, wall: AIR_WALL, wallNarrow: AIR_WALL_NARROW, material: "back" }
  ],
  lenses: [
    { x: 16.29, y: 16.29, ring: 15.82, ringInner: 13.46, glass: 12.52, ringDrop: 0.55 }
  ],
  lensTop: 5.68,
  flash: { x: 58.42, y: 16.29, d: 6.3 },
  mic: { x: 51.34, y: 16.29, d: 2.3 },
  buttons: [
    { side: "left", center: 34.08, length: 6.9, width: 2.35, proud: 0.45, kind: "button" },
    { side: "left", center: 48.23, length: 11.2, width: 2.35, proud: 0.45, kind: "button" },
    { side: "left", center: 62.43, length: 11.2, width: 2.35, proud: 0.45, kind: "button" },
    { side: "right", center: 55.33, length: 17.69, width: 2.35, proud: 0.45, kind: "button" },
    { side: "right", center: 104.77, length: 17.1, width: 2.53, proud: 0, kind: "control" }
  ],
  port: { width: 8.6, height: 2.7 },
  holes: { x: [24.34, 26.33, 48.38, 50.36], d: 1.1 },
  screws: { x: [30.01, 44.7], d: 1.5 },
  finishes: FINISHES_AIR,
  defaultFinish: "sky-blue"
};
var IPHONE_17 = {
  id: "iphone-17",
  label: "iPhone 17",
  maker: "apple",
  drawing: "2025-09-09",
  width: 71.45,
  height: 149.61,
  thickness: 7.95,
  screenPoints: [402, 874],
  metal: "aluminium",
  corner: [[19.23, 0], [14.53, 0.02], [9.87, 0.48], [5.56, 2.26], [2.26, 5.56], [0.48, 9.87], [0.02, 14.53], [0, 19.23]],
  edge: [[2.41, 3.975], [1.27, 3.93], [0.7, 3.78], [0.27, 3.39], [0.05, 2.85], [0, 2.27], [0, 1.69], [0, 0], [0, -1.69], [0, -2.28], [0.05, -2.86], [0.27, -3.4], [0.7, -3.79], [1.27, -3.93], [2.44, -3.975]],
  glass: { width: 69.45, height: 147.61 },
  display: { width: 66.57, height: 144.73 },
  flatInset: 2.41,
  cutout: { kind: "island", width: 20.74, height: 6.07, center: 7.79 },
  receiver: { width: 14.46, top: 0.95, bottom: 1.4 },
  back: { kind: "glass" },
  pads: [
    { shape: "stadium", x0: 1.18, y0: 1.34, x1: 26.06, y1: 43.62, radius: 12.44, height: 1.78, round: 2.62, material: "back", edge: "cove", wall: BUMP_WALL_17 }
  ],
  lenses: [
    { x: 13.62, y: 13.62, ring: 16, ringInner: 13.85, glass: 13.05, ringDrop: 0.185 },
    { x: 13.62, y: 31.34, ring: 16, ringInner: 13.85, glass: 13.05, ringDrop: 0.185 }
  ],
  lensTop: 3.45,
  flash: { x: 30.41, y: 22.48, d: 6.28 },
  mic: { x: 20.54, y: 22.48, d: 1 },
  buttons: [
    { side: "left", center: 34.08, length: 6.9, width: 2.66, proud: 0.45, kind: "button" },
    { side: "left", center: 48.23, length: 11.2, width: 2.66, proud: 0.45, kind: "button" },
    { side: "left", center: 62.43, length: 11.2, width: 2.66, proud: 0.45, kind: "button" },
    { side: "right", center: 55.32, length: 17.7, width: 2.66, proud: 0.45, kind: "button" },
    { side: "right", center: 98.2, length: 17.1, width: 3.03, proud: 0, kind: "control" }
  ],
  port: { width: 9, height: 3.14 },
  holes: { x: [19.71, 21.96, 24.22, 47.23, 49.48, 51.74, 53.99, 56.25], d: 1.35 },
  screws: { x: [28.8, 42.65], d: 1.5 },
  finishes: FINISHES_17,
  defaultFinish: "mist-blue"
};
var IPHONE_17E = {
  id: "iphone-17e",
  label: "iPhone 17e",
  maker: "apple",
  drawing: "2026-03-09",
  width: 71.52,
  height: 146.71,
  thickness: 7.8,
  screenPoints: [390, 844],
  metal: "aluminium",
  corner: [[15.89, 0], [11.38, 0.07], [6.97, 0.95], [3.22, 3.4], [0.86, 7.2], [0.06, 11.63], [0, 16.14]],
  edge: [[1.15, 3.9], [0.91, 3.82], [0.49, 3.79], [0.14, 3.54], [0.01, 3.14], [0, 2.71], [0, -2.71], [0.01, -3.14], [0.14, -3.54], [0.49, -3.79], [0.91, -3.82], [1.15, -3.9]],
  glass: { width: 69.42, height: 144.61 },
  display: { width: 64.58, height: 139.77 },
  flatInset: 1.15,
  cutout: { kind: "notch", width: 26.79, depth: 5.58, radius: 3.72, shoulder: 0.82 },
  receiver: { width: 11.95, top: 1.05, bottom: 2.42 },
  back: { kind: "glass" },
  pads: [],
  lenses: [
    { x: 13.32, y: 13.32, ring: 14.97, ringInner: 12.97, glass: 11.92, ringDrop: 0.28 }
  ],
  lensTop: 1.68,
  flash: { x: 29.68, y: 13.32, d: 3.75 },
  mic: { x: 24.3, y: 13.32, d: 1.3 },
  // The sheet's button labels measure the outermost outline round each button; these are the parts that stand proud, as on the other sheets.
  buttons: [
    { side: "left", center: 31.28, length: 6.9, width: 2.66, proud: 0.45, kind: "button" },
    { side: "left", center: 45.43, length: 11.2, width: 2.66, proud: 0.45, kind: "button" },
    { side: "left", center: 59.63, length: 11.2, width: 2.66, proud: 0.45, kind: "button" },
    { side: "right", center: 52.53, length: 17.7, width: 2.66, proud: 0.45, kind: "button" }
  ],
  port: { width: 9, height: 3.14 },
  holes: { x: [19.56, 21.82, 24.07, 47.46, 49.71, 51.97, 54.22, 56.48], d: 1.53 },
  screws: { x: [28.84, 42.69], d: 1.5 },
  finishes: FINISHES_17E,
  defaultFinish: "soft-pink"
};
var IPHONE_16_PRO_MAX = {
  id: "iphone-16-pro-max",
  label: "iPhone 16 Pro Max",
  maker: "apple",
  drawing: "2024-09-19",
  width: 77.58,
  height: 163.03,
  thickness: 8.25,
  screenPoints: [440, 956],
  metal: "titanium",
  corner: [[19.23, 0], [13.75, 0.04], [8.36, 0.89], [3.74, 3.74], [0.89, 8.36], [0.04, 13.75], [0, 19.23]],
  edge: [[2.41, 4.12], [1.39, 4.1], [0.45, 3.76], [0.02, 2.86], [0, 1.84], [0, 0], [0, -1.84], [0.02, -2.86], [0.45, -3.76], [1.39, -4.1], [2.41, -4.12]],
  glass: { width: 75.58, height: 161.03 },
  display: { width: 72.86, height: 158.31 },
  flatInset: 2.41,
  cutout: { kind: "island", width: 20.76, height: 6.07, center: 7.71 },
  receiver: { width: 14.02, top: 0.95, bottom: 1.4 },
  back: { kind: "glass" },
  pads: [
    { shape: "rounded", x0: 1.04, y0: 1.04, x1: 45.22, y1: 46.54, radius: 13.4, height: 2.05, round: 3.66, material: "back", edge: "cove", wall: BUMP_WALL_16_PRO }
  ],
  lenses: [
    { x: 14.17, y: 14.17, ring: 16.2, ringInner: 15.26, glass: 13.55 },
    { x: 14.17, y: 33.41, ring: 16.2, ringInner: 15.26, glass: 13.55 },
    { x: 32.16, y: 23.79, ring: 16.2, ringInner: 15.26, glass: 13.55 }
  ],
  lensTop: 4.28,
  flash: { x: 32.16, y: 10.22, d: 6.92 },
  mic: { x: 38, y: 34.14, d: 0.75 },
  // The LiDAR diameter is estimated; the sheet omits its visible outline.
  sensor: { x: 32.16, y: 38.14, d: 6.5 },
  buttons: [
    { side: "left", center: 34.08, length: 6.9, width: 2.66, proud: 0.45, kind: "button" },
    { side: "left", center: 48.23, length: 11.2, width: 2.66, proud: 0.45, kind: "button" },
    { side: "left", center: 62.43, length: 11.2, width: 2.66, proud: 0.45, kind: "button" },
    { side: "right", center: 55.33, length: 17.7, width: 2.66, proud: 0.45, kind: "button" },
    { side: "right", center: 111.62, length: 17.1, width: 3.03, proud: 0, kind: "control" }
  ],
  port: { width: 9, height: 3.14 },
  holes: { x: [20.11, 22.37, 24.62, 26.88, 50.7, 52.95, 55.21, 57.46, 59.72, 61.97], d: 1.35 },
  screws: { x: [31.86, 45.71], d: 1.5 },
  finishes: FINISHES_16_PRO,
  defaultFinish: "desert-titanium"
};
var IPHONE_16_PRO = {
  id: "iphone-16-pro",
  label: "iPhone 16 Pro",
  maker: "apple",
  drawing: "2024-09-19",
  width: 71.45,
  height: 149.61,
  thickness: 8.25,
  screenPoints: [402, 874],
  metal: "titanium",
  corner: [[19.23, 0], [13.75, 0.04], [8.36, 0.89], [3.74, 3.74], [0.89, 8.36], [0.04, 13.75], [0, 19.23]],
  edge: [[2.41, 4.12], [1.39, 4.1], [0.45, 3.76], [0.02, 2.86], [0, 1.84], [0, 0], [0, -1.84], [0.02, -2.86], [0.45, -3.76], [1.39, -4.1], [2.41, -4.12]],
  glass: { width: 69.45, height: 147.61 },
  // The sheet prints 144.79; its vector outline and 2.44 mm bezel give 144.73.
  display: { width: 66.57, height: 144.73 },
  flatInset: 2.41,
  cutout: { kind: "island", width: 20.73, height: 6.07, center: 7.71 },
  receiver: { width: 14.02, top: 0.95, bottom: 1.4 },
  back: { kind: "glass" },
  pads: [
    { shape: "rounded", x0: 1.04, y0: 1.04, x1: 45.22, y1: 46.54, radius: 13.4, height: 2.05, round: 3.66, material: "back", edge: "cove", wall: BUMP_WALL_16_PRO }
  ],
  lenses: [
    { x: 14.17, y: 14.17, ring: 16.2, ringInner: 15.26, glass: 13.55 },
    { x: 14.17, y: 33.41, ring: 16.2, ringInner: 15.26, glass: 13.55 },
    { x: 32.16, y: 23.79, ring: 16.2, ringInner: 15.26, glass: 13.55 }
  ],
  lensTop: 4.28,
  flash: { x: 32.16, y: 10.22, d: 6.92 },
  mic: { x: 38, y: 34.14, d: 0.75 },
  // The LiDAR diameter is estimated; the sheet omits its visible outline.
  sensor: { x: 32.16, y: 38.14, d: 6.5 },
  buttons: [
    { side: "left", center: 34.08, length: 6.9, width: 2.66, proud: 0.45, kind: "button" },
    { side: "left", center: 48.23, length: 11.2, width: 2.66, proud: 0.45, kind: "button" },
    { side: "left", center: 62.43, length: 11.2, width: 2.66, proud: 0.45, kind: "button" },
    { side: "right", center: 55.33, length: 17.7, width: 2.66, proud: 0.45, kind: "button" },
    { side: "right", center: 98.19, length: 17.1, width: 3.03, proud: 0, kind: "control" }
  ],
  port: { width: 9, height: 3.14 },
  holes: { x: [19.7, 21.96, 24.21, 47.23, 49.49, 51.74, 54, 56.25], d: 1.35 },
  screws: { x: [28.79, 42.64], d: 1.5 },
  finishes: FINISHES_16_PRO,
  defaultFinish: "natural-titanium"
};
var IPHONE_16_PLUS = {
  id: "iphone-16-plus",
  label: "iPhone 16 Plus",
  maker: "apple",
  drawing: "2024-09-19",
  width: 77.76,
  height: 160.89,
  thickness: 7.81,
  screenPoints: [430, 932],
  metal: "aluminium",
  corner: [[17.4, 0], [13.21, 0.04], [9.06, 0.59], [5.25, 2.29], [2.3, 5.24], [0.59, 9.06], [0.04, 13.21], [0, 17.4]],
  edge: [[2.41, 3.905], [1.6, 3.89], [1.27, 3.86], [1, 3.82], [1, 3.77], [0.81, 3.77], [0.4, 3.5], [0.13, 3.09], [0.02, 2.61], [0, 2.12], [0, 1.62], [0, -1.62], [0, -2.12], [0.02, -2.61], [0.13, -3.09], [0.4, -3.5], [0.81, -3.77], [1, -3.77], [1, -3.82], [1.27, -3.86], [1.6, -3.89], [2.41, -3.905]],
  glass: { width: 75.76, height: 158.89 },
  display: { width: 71.21, height: 154.34 },
  flatInset: 2.41,
  cutout: { kind: "island", width: 20.76, height: 6.07, center: 8.19 },
  receiver: { width: 14.02, top: 0.95, bottom: 1.4 },
  back: { kind: "glass" },
  pads: [
    { shape: "stadium", x0: 1.09, y0: 1.25, x1: 26.16, y1: 43.72, radius: 12.535, height: 1.85, round: 2.71, material: "back", edge: "cove", wall: BUMP_WALL_16 }
  ],
  lenses: [
    { x: 13.62, y: 13.62, ring: 16, ringInner: 13.85, glass: 13.55, ringDrop: 0.18 },
    { x: 13.62, y: 31.34, ring: 16, ringInner: 13.85, glass: 13.55, ringDrop: 0.18 }
  ],
  lensTop: 3.48,
  flash: { x: 30.01, y: 22.48, d: 6.28 },
  mic: { x: 20.55, y: 22.48, d: 1 },
  buttons: [
    { side: "left", center: 34.08, length: 6.9, width: 2.66, proud: 0.45, kind: "button" },
    { side: "left", center: 48.23, length: 11.2, width: 2.66, proud: 0.45, kind: "button" },
    { side: "left", center: 62.43, length: 11.2, width: 2.66, proud: 0.45, kind: "button" },
    { side: "right", center: 55.33, length: 17.7, width: 2.66, proud: 0.45, kind: "button" },
    { side: "right", center: 109.48, length: 17.1, width: 3.03, proud: 0, kind: "control" }
  ],
  port: { width: 9, height: 3.14 },
  holes: { x: [20.16, 22.41, 24.67, 26.92, 50.83, 53.09, 55.34, 57.6, 59.85, 62.11], d: 1.35 },
  screws: { x: [31.95, 45.8], d: 1.5 },
  finishes: FINISHES_16,
  defaultFinish: "teal"
};
var IPHONE_16 = {
  id: "iphone-16",
  label: "iPhone 16",
  maker: "apple",
  drawing: "2024-09-19",
  width: 71.63,
  height: 147.64,
  thickness: 7.81,
  screenPoints: [393, 852],
  metal: "aluminium",
  corner: [[17.4, 0], [13.21, 0.04], [9.06, 0.59], [5.24, 2.29], [2.29, 5.24], [0.59, 9.06], [0.04, 13.21], [0, 17.4]],
  edge: [[2.41, 3.905], [1.6, 3.89], [1.27, 3.86], [1, 3.82], [1, 3.77], [0.81, 3.77], [0.4, 3.5], [0.13, 3.09], [0.02, 2.61], [0, 2.12], [0, 1.62], [0, -1.62], [0, -2.12], [0.02, -2.61], [0.13, -3.09], [0.4, -3.5], [0.81, -3.77], [1, -3.77], [1, -3.82], [1.27, -3.86], [1.6, -3.89], [2.41, -3.905]],
  glass: { width: 69.63, height: 145.64 },
  display: { width: 65.08, height: 141.09 },
  flatInset: 2.41,
  cutout: { kind: "island", width: 20.69, height: 6.07, center: 8.18 },
  receiver: { width: 14.02, top: 0.95, bottom: 1.4 },
  back: { kind: "glass" },
  pads: [
    { shape: "stadium", x0: 1.09, y0: 1.25, x1: 26.16, y1: 43.72, radius: 12.535, height: 1.85, round: 2.71, material: "back", edge: "cove", wall: BUMP_WALL_16 }
  ],
  lenses: [
    { x: 13.62, y: 13.62, ring: 16, ringInner: 13.85, glass: 13.55, ringDrop: 0.18 },
    { x: 13.62, y: 31.34, ring: 16, ringInner: 13.85, glass: 13.55, ringDrop: 0.18 }
  ],
  lensTop: 3.48,
  flash: { x: 30.01, y: 22.48, d: 6.28 },
  mic: { x: 20.54, y: 22.48, d: 1 },
  buttons: [
    { side: "left", center: 34.08, length: 6.9, width: 2.66, proud: 0.45, kind: "button" },
    { side: "left", center: 48.23, length: 11.2, width: 2.66, proud: 0.45, kind: "button" },
    { side: "left", center: 62.43, length: 11.2, width: 2.66, proud: 0.45, kind: "button" },
    { side: "right", center: 55.33, length: 17.7, width: 2.66, proud: 0.45, kind: "button" },
    { side: "right", center: 96.23, length: 17.1, width: 3.03, proud: 0, kind: "control" }
  ],
  port: { width: 9, height: 3.14 },
  holes: { x: [19.75, 22.01, 24.26, 47.37, 49.62, 51.88, 54.13, 56.39], d: 1.35 },
  screws: { x: [28.89, 42.74], d: 1.5 },
  finishes: FINISHES_16,
  defaultFinish: "ultramarine"
};
var IPHONE_16E = {
  id: "iphone-16e",
  label: "iPhone 16e",
  maker: "apple",
  drawing: "2025-03-17",
  width: 71.52,
  height: 146.71,
  thickness: 7.8,
  screenPoints: [390, 844],
  metal: "aluminium",
  corner: [[15.89, 0], [11.38, 0.07], [6.97, 0.95], [3.22, 3.4], [0.86, 7.2], [0.06, 11.63], [0, 16.14]],
  edge: [[1.15, 3.9], [1.07, 3.82], [0.91, 3.82], [0.49, 3.79], [0.14, 3.54], [0.01, 3.14], [0, 2.71], [0, -2.71], [0.01, -3.14], [0.14, -3.54], [0.49, -3.79], [0.91, -3.82], [1.07, -3.82], [1.15, -3.9]],
  glass: { width: 69.42, height: 144.61 },
  display: { width: 64.58, height: 139.77 },
  flatInset: 1.15,
  cutout: { kind: "notch", width: 26.79, depth: 5.58, radius: 3.72, shoulder: 0.82 },
  receiver: { width: 11.95, top: 1.05, bottom: 2.43 },
  back: { kind: "glass" },
  pads: [],
  lenses: [
    { x: 13.32, y: 13.32, ring: 14.97, ringInner: 12.97, glass: 12.33, ringDrop: 0.28 }
  ],
  lensTop: 1.68,
  flash: { x: 29.68, y: 13.32, d: 3.75 },
  mic: { x: 24.3, y: 13.32, d: 1.3 },
  // The sheet's button labels measure the outermost outline round each button; these are the parts that stand proud, as on the other sheets.
  buttons: [
    { side: "left", center: 31.28, length: 6.9, width: 2.66, proud: 0.45, kind: "button" },
    { side: "left", center: 45.43, length: 11.2, width: 2.66, proud: 0.45, kind: "button" },
    { side: "left", center: 59.63, length: 11.2, width: 2.66, proud: 0.45, kind: "button" },
    { side: "right", center: 52.53, length: 17.7, width: 2.66, proud: 0.45, kind: "button" }
  ],
  port: { width: 8.99, height: 3.14 },
  holes: { x: [19.56, 21.81, 24.07, 47.45, 49.71, 51.96, 54.22, 56.47], d: 1.53 },
  screws: { x: [28.84, 42.69], d: 1.5 },
  finishes: FINISHES_16E,
  defaultFinish: "white"
};
var FINISHES_PIXEL_10_PRO = [
  { id: "moonstone", label: "Moonstone", frame: "#a2a8b7", back: "#787e8e" },
  { id: "jade", label: "Jade", frame: "#dacebc", back: "#c8d8b8" },
  { id: "porcelain", label: "Porcelain", frame: "#e6dbcb", back: "#f0eae3" },
  { id: "obsidian", label: "Obsidian", frame: "#606464", back: "#3c4040" }
];
var FINISHES_PIXEL_10A = [
  { id: "lavender", label: "Lavender", frame: "#7f9be6", back: "#81a2f3" },
  { id: "berry", label: "Berry", frame: "#e64852", back: "#f44c57" },
  { id: "fog", label: "Fog", frame: "#c4cec4", back: "#d2dad1" },
  { id: "obsidian", label: "Obsidian", frame: "#3a3e3d", back: "#3b3f3e" }
];
var FINISHES_PIXEL_4 = [
  { id: "clearly-white", label: "Clearly White", frame: "#1f1f21", back: "#eceeec", accent: "#ec8b70" },
  { id: "just-black", label: "Just Black", frame: "#1f1f21", back: "#151517" },
  { id: "oh-so-orange", label: "Oh So Orange", frame: "#1f1f21", back: "#f4895f" }
];
var FINISHES_PIXEL_3_XL = [
  { id: "just-black", label: "Just Black", frame: "#2a2a2c", back: "#1c1c1e" },
  { id: "clearly-white", label: "Clearly White", frame: "#ececea", back: "#f4f4f4", accent: "#79d1b3" },
  { id: "not-pink", label: "Not Pink", frame: "#ecd5cc", back: "#f2ddd5", accent: "#f37b52" }
];
var PIXEL_10_PRO = {
  id: "pixel-10-pro",
  label: "Pixel 10 Pro",
  maker: "google",
  drawing: "2026-10-16",
  width: 72,
  height: 152.8,
  thickness: 8.6,
  screenPoints: [1280, 2856],
  metal: "polished",
  // The four corners of the device frame agree to 0.03 mm. The corner is no
  // circle: it leaves each straight edge about 15 mm from the corner.
  corner: [[15, 0], [12, 0.07], [10, 0.29], [8, 0.81], [6, 1.74], [4, 3.2], [3.59, 3.59], [3.2, 4], [1.74, 6], [0.81, 8], [0.29, 10], [0.07, 12], [0, 15]],
  // Estimated from Google's side render: flat sides, the glass and the back each meeting the frame on a round of about a millimetre.
  edge: [[1.6, 4.3], [1.34, 4.24], [1.2, 4.14], [0.75, 3.98], [0.35, 3.7], [0.1, 3.3], [0.02, 2.9], [0, 2.5], [0, -2.5], [0.02, -2.9], [0.1, -3.3], [0.35, -3.7], [0.75, -3.98], [1.2, -4.14], [1.34, -4.24], [1.6, -4.3]],
  glass: { width: 69.32, height: 150.12 },
  // The device frame's screen opening: its bezel is 0.4 mm deeper above the screen than below, and its corners are circles (9.22, rms 0.005).
  display: { width: 65.85, height: 147.06, top: 3.06, radius: 9.22 },
  flatInset: 1.6,
  cutout: { kind: "punch", d: 4.7, center: 8.37 },
  receiver: { width: 12, top: 1.05, bottom: 1.3 },
  back: { kind: "glass" },
  // The camera bar from the Google Store render, which Google's side render
  // agrees with to 0.1 mm at its top: a metal stadium standing 3.4 mm off the
  // back, the camera glass set into it 0.8 mm in from its edge.
  pads: [
    { shape: "stadium", x0: 3.57, y0: 13.85, x1: 68.29, y1: 35.81, radius: 10.98, height: 3.4, round: 0.45, material: "satin" },
    { shape: "stadium", x0: 4.46, y0: 14.66, x1: 52.06, y1: 35, radius: 10.17, height: 3.42, round: 0.05, material: "glass" }
  ],
  lensStyle: "window",
  lenses: [
    { x: 13.78, y: 25, ring: 6.85, glass: 5.4 },
    { x: 29.98, y: 25, ring: 11.39, glass: 9.6 },
    // The 5x periscope sits in a vertical rounded window, 7.45 by 10.05 mm
    // with 1.9 mm corners, measured on Google's Store close-up of the camera
    // bar and scaled by the phone's 72.0 mm width.
    { x: 41.9, y: 25, ring: 7, glass: 5.6, window: { width: 7.45, height: 10.05, radius: 1.9 } }
  ],
  lensTop: 3.44,
  flash: { x: 58.61, y: 20.81, d: 6.03 },
  // The temperature sensor.
  sensor: { x: 58.61, y: 29.81, d: 6.2 },
  buttons: [
    { side: "right", center: 48.71, length: 12.1, width: 3.4, proud: 0.53, kind: "button" },
    { side: "right", center: 72.19, length: 21.06, width: 3.4, proud: 0.53, kind: "button" }
  ],
  // The bottom edge is estimated from the hardware diagram's labels: the speaker on the right, a microphone on the left.
  port: { width: 8.7, height: 3 },
  holes: { x: [18.3, 50, 52, 54, 56, 58], d: 1.1 },
  screws: { x: [], d: 0 },
  finishes: FINISHES_PIXEL_10_PRO,
  defaultFinish: "moonstone"
};
var PIXEL_10A = {
  id: "pixel-10a",
  label: "Pixel 10a",
  maker: "google",
  drawing: "2026-10-16",
  width: 73,
  height: 153.9,
  thickness: 9,
  screenPoints: [1080, 2424],
  metal: "aluminium",
  corner: [[15, 0], [12, 0.08], [10, 0.355], [8, 0.94], [6, 1.92], [4, 3.43], [3.71, 3.71], [3.43, 4], [1.92, 6], [0.94, 8], [0.355, 10], [0.08, 12], [0, 15]],
  // Estimated, as on the 10 Pro.
  edge: [[1.45, 4.5], [1.18, 4.44], [1.05, 4.34], [0.65, 4.18], [0.3, 3.9], [0.08, 3.5], [0.02, 3.1], [0, 2.7], [0, -2.7], [0.02, -3.1], [0.08, -3.5], [0.3, -3.9], [0.65, -4.18], [1.05, -4.34], [1.18, -4.44], [1.45, -4.5]],
  glass: { width: 70.64, height: 151.54 },
  display: { width: 65.26, height: 146.26, radius: 8.83 },
  flatInset: 1.45,
  cutout: { kind: "punch", d: 4.71, center: 9.08 },
  receiver: { width: 12, top: 0.95, bottom: 1.2 },
  back: { kind: "glass" },
  // From the hardware diagram. The camera glass is level with the back:
  // Google's side render shows nothing standing off it.
  pads: [
    { shape: "stadium", x0: 7.08, y0: 11.96, x1: 37.47, y1: 31.29, radius: 9.67, height: 0.12, round: 0.08, material: "glass" }
  ],
  lensStyle: "window",
  lenses: [
    { x: 15.62, y: 21.63, ring: 4.2, glass: 2.6 },
    { x: 28.9, y: 21.63, ring: 5.4, glass: 3.4 }
  ],
  lensTop: 0.14,
  flash: { x: 46.1, y: 21.63, d: 5.94 },
  buttons: [
    { side: "right", center: 49.22, length: 12.01, width: 3.4, proud: 0.475, kind: "button" },
    { side: "right", center: 72.72, length: 21, width: 3.4, proud: 0.475, kind: "button" }
  ],
  // Estimated from the hardware diagram's labels, as on the 10 Pro.
  port: { width: 8.7, height: 3 },
  holes: { x: [18.3, 50.5, 52.5, 54.5, 56.5, 58.5], d: 1.1 },
  screws: { x: [], d: 0 },
  finishes: FINISHES_PIXEL_10A,
  defaultFinish: "lavender"
};
var PIXEL_4 = {
  id: "pixel-4",
  label: "Pixel 4",
  maker: "google",
  drawing: "2026-10-16",
  width: 68.8,
  height: 147.1,
  thickness: 8.2,
  screenPoints: [1080, 2280],
  metal: "coated",
  // Close to a circle of 8.9; the device frame's corners agree to 0.15 mm.
  corner: [[10.5, 0], [8, 0.1], [7.23, 0.25], [6.11, 0.5], [4.84, 1], [3.3, 2], [2.61, 2.61], [2, 3.3], [1, 4.84], [0.5, 6.11], [0.25, 7.23], [0.1, 8], [0, 10.5]],
  // Estimated: rounded glass on a narrow matte frame.
  edge: [[1, 4.1], [0.7, 4.05], [0.5, 3.95], [0.35, 3.8], [0.15, 3.4], [0.04, 2.9], [0, 2.3], [0, -2.3], [0.04, -2.9], [0.15, -3.4], [0.35, -3.8], [0.5, -3.95], [0.7, -4.05], [1, -4.1]],
  glass: { width: 67.8, height: 146.1 },
  // No cutout: the front camera and the face unlock sensors sit in the bezel above the screen, twice as deep as the one below it.
  display: { width: 63.59, height: 134.37, top: 8.55, radius: 6.1 },
  flatInset: 1,
  cutout: { kind: "none" },
  receiver: { width: 0, top: 0, bottom: 0 },
  front: [
    { kind: "camera", x: 19.03, y: 5.57, width: 3.5, height: 3.5 },
    { kind: "sensor", x: 23.27, y: 5.57, width: 1.5, height: 3.4 },
    { kind: "grille", x: 34.46, y: 5.43, width: 7.07, height: 0.94 }
  ],
  back: { kind: "glass" },
  // The camera square from the hardware diagram; its height off the back is estimated.
  pads: [
    { shape: "rounded", x0: 5.49, y0: 5.49, x1: 28.59, y1: 28.6, radius: 4.6, height: 1.1, round: 0.5, material: "glass" }
  ],
  lensStyle: "window",
  lenses: [
    { x: 11.02, y: 16.94, ring: 5.6, glass: 2.4 },
    { x: 23, y: 16.94, ring: 5.6, glass: 2.4 }
  ],
  lensTop: 1.12,
  flash: { x: 17.04, y: 23.9, d: 4.25 },
  mic: { x: 23, y: 23.9, d: 1.2 },
  // The spectral and flicker sensor.
  sensor: { x: 17.04, y: 9.85, d: 1.6 },
  buttons: [
    { side: "right", center: 40.32, length: 9.19, width: 2.6, proud: 0.37, kind: "button", accent: true },
    { side: "right", center: 63.27, length: 18.21, width: 2.6, proud: 0.46, kind: "button" }
  ],
  // Estimated from the hardware diagram's labels: speaker and microphone either side of the port.
  port: { width: 8.7, height: 3 },
  holes: { x: [19.4, 21.4, 23.4, 45.4, 47.4, 49.4], d: 1 },
  screws: { x: [], d: 0 },
  finishes: FINISHES_PIXEL_4,
  defaultFinish: "clearly-white"
};
var PIXEL_3_XL = {
  id: "pixel-3-xl",
  label: "Pixel 3 XL",
  maker: "google",
  drawing: "2026-10-16",
  width: 76.7,
  height: 158,
  thickness: 7.9,
  screenPoints: [1440, 2960],
  metal: "coated",
  corner: [[10, 0], [8.05, 0.05], [6.68, 0.25], [5.76, 0.5], [4.56, 1], [3.05, 2], [2.5, 2.5], [2, 3.05], [1, 4.56], [0.5, 5.76], [0.25, 6.68], [0.05, 8.05], [0, 10]],
  // Estimated: rounded glass front and back on an aluminium band.
  edge: [[2, 3.95], [1.4, 3.88], [0.95, 3.75], [0.7, 3.6], [0.35, 3.3], [0.12, 2.9], [0.02, 2.3], [0, 1.6], [0, -1.6], [0.02, -2.3], [0.12, -2.9], [0.35, -3.3], [0.7, -3.6], [0.95, -3.75], [1.4, -3.88], [2, -3.95]],
  glass: { width: 75.3, height: 156.6 },
  // The chin holds the front speaker; the top corners are twice as round as the bottom ones.
  display: { width: 70.23, height: 144.2, top: 3.465, radius: 5.41, radiusBottom: 2.8 },
  flatInset: 2,
  // The cutout path in the phone's AOSP device config (device/google/crosshatch,
  // config_mainBuiltInDisplayCutout), at the display's 0.04877 mm a pixel. The
  // rounds are its nearest circles, within 0.4 mm of it.
  cutout: {
    kind: "notch",
    width: 25.17,
    depth: 8.34,
    radius: 4.5,
    shoulder: 3.7,
    path: {
      d: "M -338,0 q 86,-4 80,71.5 v 8 q 4,90 95,91.5 h 163 v -171 z M 338,0 q -86,-4 -80,71.5 v 8 q -4,90 -95,91.5 h -163 v -171 z",
      pixel: 0.04877
    }
  },
  receiver: { width: 0, top: 0, bottom: 0 },
  front: [
    { kind: "camera", x: 30.25, y: 7.34, width: 4.02, height: 4.02 },
    { kind: "camera", x: 46.45, y: 7.34, width: 4.02, height: 4.02 },
    { kind: "grille", x: 38.35, y: 8.76, width: 8.03, height: 1.51 },
    { kind: "grille", x: 38.34, y: 153.17, width: 22.39, height: 1.36 }
  ],
  // From the dimension drawing on Google's Pixel 3 spec page: glossy glass round the camera, etched matte below.
  // The drawing takes the panel to 1.9 mm from the bottom edge; it stops where the back starts to curve.
  back: { kind: "glass", panel: { side: 2.77, top: 29.47, bottom: 155.7, radius: 5.4 } },
  pads: [],
  lensStyle: "window",
  lenses: [
    { x: 14.76, y: 14.78, ring: 10.2, glass: 7 }
  ],
  lensTop: 0.3,
  flash: { x: 28.18, y: 14.78, d: 4.6 },
  sensor: { x: 22.73, y: 14.78, d: 2.1 },
  fingerprint: { x: 38.35, y: 41.6, d: 12.2 },
  buttons: [
    { side: "right", center: 41.61, length: 10.04, width: 2.6, proud: 0.51, kind: "button", accent: true },
    { side: "right", center: 66.63, length: 20.02, width: 2.6, proud: 0.51, kind: "button" }
  ],
  // Both speakers face the front.
  port: { width: 8.7, height: 3 },
  holes: { x: [], d: 0 },
  screws: { x: [], d: 0 },
  finishes: FINISHES_PIXEL_3_XL,
  defaultFinish: "clearly-white"
};
var PHONE_MODELS = [
  IPHONE_DUO,
  IPHONE_18_PRO_MAX,
  IPHONE_18_PRO,
  IPHONE_17_PRO_MAX,
  IPHONE_17_PRO,
  IPHONE_AIR,
  IPHONE_17,
  IPHONE_17E,
  IPHONE_16_PRO_MAX,
  IPHONE_16_PRO,
  IPHONE_16_PLUS,
  IPHONE_16,
  IPHONE_16E,
  PIXEL_10_PRO,
  PIXEL_10A,
  PIXEL_4,
  PIXEL_3_XL
];
var BY_ID = new Map(PHONE_MODELS.map((model) => [model.id, model]));
function measuredModelFor(deviceType) {
  return BY_ID.get(deviceType);
}
function cornerRadiusOf(model) {
  let best = model.corner[0];
  for (const p of model.corner) if (Math.abs(p[0] - p[1]) < Math.abs(best[0] - best[1])) best = p;
  return (best[0] + best[1]) / 2 / (1 - Math.SQRT1_2);
}
function bezelOf(model) {
  return (model.width - model.display.width) / 2;
}
function displayInsetsOf(model) {
  const side = bezelOf(model);
  const top = model.display.top ?? (model.height - model.display.height) / 2;
  return { side, top, bottom: model.height - model.display.height - top };
}
function displayRadiiOf(model) {
  const own = model.display.radius;
  if (own !== void 0) return { top: own, bottom: model.display.radiusBottom ?? own };
  const r = Math.max(0, cornerRadiusOf(model) - bezelOf(model));
  return { top: r, bottom: r };
}
function finishOf(model, id) {
  return model.finishes.find((finish) => finish.id === id) ?? model.finishes.find((finish) => finish.id === model.defaultFinish) ?? model.finishes[0];
}
var FLAT_FACES = /* @__PURE__ */ new WeakMap();
function flatFaceOf(model) {
  if (!model.fold) return model;
  let face = FLAT_FACES.get(model);
  if (!face) {
    face = {
      ...model,
      fold: void 0,
      width: model.height,
      height: model.width,
      glass: { width: model.glass.height, height: model.glass.width },
      display: { width: model.display.height, height: model.display.width },
      screenPoints: [model.screenPoints[1], model.screenPoints[0]]
    };
    FLAT_FACES.set(model, face);
  }
  return face;
}
var GENERIC_FINISHES = [
  { id: "black", label: "Black", frame: "#2f2f33", back: "#2b2b2f" },
  { id: "silver", label: "Silver", frame: "#d9dadc", back: "#e6e7e9" },
  { id: "white", label: "White", frame: "#efefec", back: "#f4f4f1" }
];
function circleCorner(r) {
  const points = [];
  for (let i = 0; i <= 6; i++) {
    const a = i / 6 * (Math.PI / 2);
    points.push([r * (1 - Math.sin(a)), r * (1 - Math.cos(a))]);
  }
  return points;
}
function roundEdge(thickness, round) {
  const t = thickness / 2;
  return [
    [round + 1, t],
    [round * 0.55, t - round * 0.1],
    [round * 0.12, t - round * 0.55],
    [0, 0],
    [round * 0.12, -t + round * 0.55],
    [round * 0.55, -t + round * 0.1],
    [round + 1, -t]
  ];
}
function genericPhoneModel(deviceType, label, kind, platform, screenAspect, cutout) {
  const tablet = kind === "tablet";
  const width = tablet ? 180 : 72;
  const bezel = tablet ? 6 : platform === "android" ? 2.2 : 2.6;
  const height = (width - 2 * bezel) / screenAspect + 2 * bezel;
  const thickness = tablet ? 6.1 : 8.2;
  const cornerRadius = tablet ? 14 : platform === "android" ? 8 : 12;
  const lensRing = tablet ? 7 : 13;
  const backX = tablet ? 14 : 13;
  const lenses = tablet ? [{ x: backX, y: 14, ring: lensRing, glass: lensRing * 0.7 }] : platform === "android" ? [0, 1, 2].map((i) => ({ x: backX, y: 14 + i * 14, ring: lensRing, glass: lensRing * 0.72 })) : [
    { x: backX, y: 13, ring: lensRing, glass: lensRing * 0.75 },
    { x: backX + 13, y: 26, ring: lensRing, glass: lensRing * 0.75 }
  ];
  return {
    id: deviceType,
    label,
    // Only which platform's conventions it follows; the stand-in is nobody's phone.
    maker: platform === "android" ? "google" : "apple",
    drawing: "",
    width,
    height,
    thickness,
    screenPoints: [Math.round(1e3 * screenAspect), 1e3],
    metal: "aluminium",
    corner: circleCorner(cornerRadius),
    edge: roundEdge(thickness, tablet ? 1.4 : 2.2),
    glass: { width: width - 2, height: height - 2 },
    display: { width: width - 2 * bezel, height: height - 2 * bezel },
    flatInset: tablet ? 2 : 3,
    cutout,
    receiver: { width: tablet ? 0 : 10, top: 0.7, bottom: 1.2 },
    back: { kind: "glass" },
    pads: tablet || platform === "android" ? [] : [{ shape: "rounded", x0: 2.5, y0: 2.5, x1: 37.5, y1: 37, radius: 8, height: 1.6, round: 1.6, material: "back" }],
    lenses,
    lensTop: tablet ? 0.9 : platform === "android" ? 1.4 : 3.2,
    flash: tablet ? void 0 : { x: platform === "android" ? backX + 12 : backX + 13, y: platform === "android" ? 14 : 12, d: 4.5 },
    buttons: tablet ? [{ side: "right", center: 30, length: 14, width: 2.2, proud: 0.4, kind: "button" }] : platform === "android" ? [
      { side: "right", center: 52, length: 22, width: 2.4, proud: 0.45, kind: "button" },
      { side: "right", center: 80, length: 11, width: 2.4, proud: 0.45, kind: "button" }
    ] : [
      { side: "left", center: 40, length: 10, width: 2.5, proud: 0.45, kind: "button" },
      { side: "left", center: 54, length: 10, width: 2.5, proud: 0.45, kind: "button" },
      { side: "right", center: 48, length: 16, width: 2.5, proud: 0.45, kind: "button" }
    ],
    port: tablet ? { width: 0, height: 0 } : { width: 8.9, height: 3.1 },
    holes: tablet ? { x: [], d: 0 } : { x: [12, 14.2, 16.4, 18.6, width - 18.6, width - 16.4, width - 14.2, width - 12], d: 1.4 },
    screws: tablet ? { x: [], d: 0 } : { x: [width / 2 - 7, width / 2 + 7], d: 1.4 },
    finishes: GENERIC_FINISHES,
    defaultFinish: "black"
  };
}

// ../../../../../../../../../../Documents/GitHub/artboard-studio/src/lib/device3dGeometry.ts
function monotoneSlopes(t, v, startSlope, endSlope) {
  const n = t.length;
  const secant = (k) => (v[k + 1] - v[k]) / (t[k + 1] - t[k]);
  const slopes = new Array(n).fill(0);
  slopes[0] = startSlope;
  slopes[n - 1] = endSlope;
  for (let k = 1; k < n - 1; k++) {
    const a = secant(k - 1);
    const b = secant(k);
    if (a * b <= 0) continue;
    const ha = t[k] - t[k - 1];
    const hb = t[k + 1] - t[k];
    const w1 = 2 * hb + ha;
    const w2 = hb + 2 * ha;
    slopes[k] = (w1 + w2) / (w1 / a + w2 / b);
  }
  const clamp = (k, s, edge) => {
    const d = secant(edge);
    if (d === 0) return 0;
    if (Math.sign(s) !== Math.sign(d) && s !== 0) return 0;
    return Math.sign(s) * Math.min(Math.abs(s), 3 * Math.abs(d));
  };
  slopes[0] = clamp(0, slopes[0], 0);
  slopes[n - 1] = clamp(n - 1, slopes[n - 1], n - 2);
  return slopes;
}
function throughPoints(points, start, end, perSegment) {
  const t = [0];
  for (let i = 1; i < points.length; i++) {
    t.push(t[i - 1] + Math.max(1e-6, Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])));
  }
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const mx = monotoneSlopes(t, xs, start[0], end[0]);
  const my = monotoneSlopes(t, ys, start[1], end[1]);
  const out = [];
  for (let k = 0; k < points.length - 1; k++) {
    const h = t[k + 1] - t[k];
    for (let s = 0; s < perSegment; s++) {
      const u = s / perSegment;
      const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
      const h10 = u ** 3 - 2 * u ** 2 + u;
      const h01 = -2 * u ** 3 + 3 * u ** 2;
      const h11 = u ** 3 - u ** 2;
      out.push([
        h00 * xs[k] + h10 * h * mx[k] + h01 * xs[k + 1] + h11 * h * mx[k + 1],
        h00 * ys[k] + h10 * h * my[k] + h01 * ys[k + 1] + h11 * h * my[k + 1]
      ]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}
function smoothCorner(corner, perSegment = 6) {
  return throughPoints(corner, [-1, 0], [0, 1], perSegment);
}
function insetCorner(corner, inset) {
  return corner.map((point, i) => {
    const prev = corner[Math.max(0, i - 1)];
    const next = corner[Math.min(corner.length - 1, i + 1)];
    let tx = next[0] - prev[0];
    let ty = next[1] - prev[1];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    return [Math.max(0, point[0] + ty * inset - inset), Math.max(0, point[1] - tx * inset - inset)];
  });
}
function withNormals(points) {
  const n = points.length;
  return points.map(([x, y], i) => {
    const [px, py] = points[(i - 1 + n) % n];
    const [qx, qy] = points[(i + 1) % n];
    let tx = qx - px;
    let ty = qy - py;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    return { x, y, nx: ty, ny: -tx };
  });
}
function cornerRect(corner, x0, y0, x1, y1, bottomCorner = corner) {
  return cornerRectEach(x0, y0, x1, y1, { topLeft: corner, topRight: corner, bottomLeft: bottomCorner, bottomRight: bottomCorner });
}
function cornerRectEach(x0, y0, x1, y1, corners) {
  const points = [];
  for (const [dx, dy] of [...corners.topRight].reverse()) points.push([x1 - dx, y1 - dy]);
  for (const [dx, dy] of corners.topLeft) points.push([x0 + dx, y1 - dy]);
  for (const [dx, dy] of [...corners.bottomLeft].reverse()) points.push([x0 + dx, y0 + dy]);
  for (const [dx, dy] of corners.bottomRight) points.push([x1 - dx, y0 + dy]);
  return withNormals(dedupe(points));
}
function circularCorner(r, perCorner) {
  const corner = [];
  for (let i = 0; i <= perCorner; i++) {
    const a = i / perCorner * (Math.PI / 2);
    corner.push([r * (1 - Math.sin(a)), r * (1 - Math.cos(a))]);
  }
  return corner;
}
function roundRect(x0, y0, x1, y1, radius, perCorner = 10, bottomRadius = radius) {
  const limit = (r) => Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
  return cornerRect(circularCorner(limit(radius), perCorner), x0, y0, x1, y1, circularCorner(limit(bottomRadius), perCorner));
}
function dedupe(points) {
  const out = [];
  for (const p of points) {
    const last2 = out[out.length - 1];
    if (!last2 || Math.hypot(p[0] - last2[0], p[1] - last2[1]) > 1e-4) out.push(p);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && Math.hypot(first[0] - last[0], first[1] - last[1]) <= 1e-4) out.pop();
  return out;
}
function phoneOutline(model) {
  const w = model.width / 2;
  const h = model.height / 2;
  return cornerRect(smoothCorner(model.corner), -w, -h, w, h);
}
function lensWindowOutline(lens, inset = 0) {
  if (!lens.window) return null;
  const width = Math.max(0, lens.window.width - 2 * inset);
  const height = Math.max(0, lens.window.height - 2 * inset);
  return roundRect(-width / 2, -height / 2, width / 2, height / 2, Math.max(0, lens.window.radius - inset), 12);
}
function fromBackView(model, x, y) {
  return [model.width / 2 - x, model.height / 2 - y];
}
function plateauDeck(model, pad) {
  const scale = pad.deckCorner / model.corner[0][0];
  const corner = smoothCorner(model.corner.map(([a, b]) => [a * scale, b * scale]));
  const w = model.width / 2 - pad.deckInset;
  return cornerRect(corner, -w, model.height / 2 - pad.deckBottom, w, model.height / 2 - pad.deckInset);
}
function loftTop(model, pad) {
  const [ax, ay] = fromBackView(model, pad.top.x0, pad.top.y0);
  const [bx, by] = fromBackView(model, pad.top.x1, pad.top.y1);
  const x0 = Math.min(ax, bx);
  const x1 = Math.max(ax, bx);
  const y0 = Math.min(ay, by);
  const y1 = Math.max(ay, by);
  return roundRect(x0, y0, x1, y1, Math.min(x1 - x0, y1 - y0) / 2, 16);
}
function islandFootprint(model, pad, inset = 0) {
  const [ax, ay] = fromBackView(model, pad.x0, pad.y0);
  const [bx, by] = fromBackView(model, pad.x1, pad.y1);
  const x0 = Math.min(ax, bx) + inset;
  const x1 = Math.max(ax, bx) - inset;
  const y0 = Math.min(ay, by) + inset;
  const y1 = Math.max(ay, by) - inset;
  const radius = pad.shape === "stadium" ? Math.min(x1 - x0, y1 - y0) / 2 : Math.max(0, pad.radius - inset);
  return roundRect(x0, y0, x1, y1, radius, 12);
}
function faceDepths(model) {
  return { front: model.edge[0][1], back: model.edge[model.edge.length - 1][1] };
}
function hullPoints(model, posture) {
  if (model.fold) return foldedHullPoints(model, posture ?? { opening: model.fold.opening, across: false });
  const points = [];
  const outline = phoneOutline(model);
  const step = Math.max(1, Math.floor(outline.length / 64));
  const ring = (inset, z) => {
    for (let i = 0; i < outline.length; i += step) {
      const p = outline[i];
      points.push([p.x - p.nx * inset, p.y - p.ny * inset, z]);
    }
  };
  for (const [inset, z] of model.edge) ring(inset, z);
  pushBackHardware(model, points);
  pushButtons(model, points);
  return points;
}
function pushBackHardware(model, points) {
  const { back } = faceDepths(model);
  for (const pad of model.pads) {
    const top = back - pad.height;
    if (pad.shape === "plateau") {
      for (const p of plateauDeck(model, pad)) points.push([p.x, p.y, top]);
    } else if (pad.shape === "loft") {
      for (const p of loftTop(model, pad)) points.push([p.x, p.y, top]);
    } else {
      const foot = islandFootprint(model, pad);
      for (let i = 0; i < foot.length; i += 2) points.push([foot[i].x, foot[i].y, top]);
    }
  }
  for (const lens of model.lenses) {
    const [cx, cy] = fromBackView(model, lens.x, lens.y);
    const top = model.lensTop + Math.max(0, -(lens.ringDrop ?? 0));
    const window = lensWindowOutline(lens);
    if (window) {
      for (const p of window) points.push([cx + p.x, cy + p.y, back - top]);
      continue;
    }
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2;
      points.push([cx + lens.ring / 2 * Math.cos(a), cy + lens.ring / 2 * Math.sin(a), back - top]);
    }
  }
}
function pushButtons(model, points) {
  for (const button of model.buttons) {
    const z = button.z === void 0 ? 0 : model.thickness / 2 - button.z;
    if (button.side === "top") {
      const x2 = button.center - model.width / 2;
      const y2 = model.height / 2 + button.proud;
      for (const dx of [-button.length / 2, button.length / 2]) {
        for (const dz of [-button.width / 2, button.width / 2]) points.push([x2 + dx, y2, z + dz]);
      }
      continue;
    }
    const x = (button.side === "left" ? -1 : 1) * (model.width / 2 + button.proud);
    const y = model.height / 2 - button.center;
    for (const dy of [-button.length / 2, button.length / 2]) {
      for (const dz of [-button.width / 2, button.width / 2]) points.push([x, y + dy, z + dz]);
    }
  }
}
function foldPivot(model) {
  return model.fold.closedThickness / 2 - model.thickness / 2;
}
function foldTurn(opening) {
  return 180 - Math.max(0, Math.min(180, opening));
}
function foldLeftPoint(model, opening, [x, y, z]) {
  const a = foldTurn(opening) * Math.PI / 180;
  const pivot = foldPivot(model);
  const w = z - pivot;
  return [x * Math.cos(a) + w * Math.sin(a), y, pivot - x * Math.sin(a) + w * Math.cos(a)];
}
function leafOutline(model, side, inset = 0) {
  const free = insetCorner(smoothCorner(model.corner), inset);
  const hinge = insetCorner(smoothCorner(model.fold.hingeCorner), inset);
  const w = model.width / 2;
  const h = model.height / 2 - inset;
  return side === "right" ? cornerRectEach(inset, -h, w - inset, h, { topLeft: hinge, bottomLeft: hinge, topRight: free, bottomRight: free }) : cornerRectEach(-w + inset, -h, -inset, h, { topLeft: free, bottomLeft: free, topRight: hinge, bottomRight: hinge });
}
function spineSection(model, opening, perRound = 6) {
  const fold = model.fold;
  const half = foldTurn(opening) * Math.PI / 180 / 2;
  if (half < 1e-4) return null;
  const s = Math.sin(half);
  const c = Math.cos(half);
  const pivot = foldPivot(model);
  const reach = pivot + fold.spine.seam;
  const t = [-c, s];
  const n = [-s, -c];
  const span = 2 * reach * s;
  const proud = (fold.closedWidth - model.width / 2) * s * s;
  const mx = reach * c * n[0];
  const mz = pivot + reach * c * n[1];
  const r = Math.min(fold.spine.round, proud, span / 2);
  const local = [[-span / 2, 0, -1, 0]];
  for (let i = 0; i <= perRound; i++) {
    const a = Math.PI - i / perRound * (Math.PI / 2);
    local.push([-span / 2 + r + r * Math.cos(a), proud - r + r * Math.sin(a), Math.cos(a), Math.sin(a)]);
  }
  for (let i = 0; i <= perRound; i++) {
    const a = Math.PI / 2 - i / perRound * (Math.PI / 2);
    local.push([span / 2 - r + r * Math.cos(a), proud - r + r * Math.sin(a), Math.cos(a), Math.sin(a)]);
  }
  local.push([span / 2, 0, 1, 0]);
  return local.map(([lt, ln, nt, nn]) => ({
    x: mx + lt * t[0] + ln * n[0],
    z: mz + lt * t[1] + ln * n[1],
    nx: nt * t[0] + nn * n[0],
    nz: nt * t[1] + nn * n[1]
  }));
}
function foldCenter(model, opening) {
  const w = model.width / 2;
  const t = model.thickness / 2;
  const xs = [];
  const zs = [];
  for (const x of [0, w]) for (const z of [-t, t]) {
    xs.push(x);
    zs.push(z);
  }
  for (const x of [-w, 0]) {
    for (const z of [-t, t]) {
      const [px, , pz] = foldLeftPoint(model, opening, [x, 0, z]);
      xs.push(px);
      zs.push(pz);
    }
  }
  for (const p of spineSection(model, opening) ?? []) {
    xs.push(p.x);
    zs.push(p.z);
  }
  return [(Math.min(...xs) + Math.max(...xs)) / 2, 0, (Math.min(...zs) + Math.max(...zs)) / 2];
}
function foldFrame(center, across, [x, y, z]) {
  const px = x - center[0];
  const py = y - center[1];
  const pz = z - center[2];
  return across ? [-py, px, pz] : [px, py, pz];
}
function foldedHullPoints(model, posture) {
  const right = [];
  const left = [];
  const ring = (side, into) => {
    const outline = leafOutline(model, side);
    const step = Math.max(1, Math.floor(outline.length / 48));
    for (const [inset, z] of model.edge) {
      for (let i = 0; i < outline.length; i += step) {
        const p = outline[i];
        into.push([p.x - p.nx * inset, p.y - p.ny * inset, z]);
      }
    }
  };
  ring("right", right);
  ring("left", left);
  pushBackHardware(model, right);
  pushButtons(model, right);
  const posed = [...right, ...left.map((p) => foldLeftPoint(model, posture.opening, p))];
  const y = model.height / 2 - model.fold.spine.endInset;
  for (const p of spineSection(model, posture.opening) ?? []) posed.push([p.x, -y, p.z], [p.x, y, p.z]);
  const center = foldCenter(model, posture.opening);
  return posed.map((p) => foldFrame(center, posture.across, p));
}

// ../../../../../../../../../../Documents/GitHub/artboard-studio/src/lib/creative/specs.ts
var CREATIVE_ASSETS = [
  {
    kind: "header",
    label: "Product page header",
    boardName: "Product page header",
    sizeLabel: "3840 x 1646, 21:9",
    width: 3840,
    height: 1646,
    safe: { x: 1097, y: 493, width: 1646, height: 661 },
    placements: ["header"],
    imageFormats: ["PNG", "JPEG"],
    video: { width: 3840, height: 1646, minSeconds: 5, maxSeconds: 30, fps: [30, 60] },
    fileTag: "AppStore_Header",
    presetId: "appstore-header"
  },
  {
    kind: "search",
    label: "Search results",
    boardName: "Search result",
    sizeLabel: "3840 x 2560, 3:2",
    width: 3840,
    height: 2560,
    safe: { x: 836, y: 765, width: 2168, height: 1030 },
    placements: ["search"],
    imageFormats: ["PNG", "JPEG"],
    video: { width: 3840, height: 2560, minSeconds: 5, maxSeconds: 30, fps: [30, 60] },
    fileTag: "AppStore_SearchResult",
    presetId: "appstore-search"
  },
  {
    kind: "universal",
    label: "Universal",
    boardName: "Universal header and search",
    sizeLabel: "5244 x 2950, 16:9",
    width: 5244,
    height: 2950,
    // Apple's universal safe area sits above the middle of the canvas.
    safe: { x: 1921, y: 660, width: 1402, height: 962 },
    placements: ["header", "search"],
    // The 16:9 size is PNG only, and there is no universal video size.
    imageFormats: ["PNG"],
    video: null,
    fileTag: "AppStore_Universal",
    presetId: "appstore-universal"
  }
];
var BY_KIND = new Map(
  CREATIVE_ASSETS.map((spec) => [spec.kind, spec])
);

// ../../../../../../../../../../Documents/GitHub/artboard-studio/src/lib/deviceRegistry.ts
var PIXEL_TO_IPHONE = {
  "pixel-10-pro": "iphone-17-pro",
  "pixel-10a": "iphone-17",
  "pixel-3-xl": "iphone-17e",
  "pixel-4": "iphone"
};
function measuredPhone(id) {
  const measured = measuredModelFor(id);
  if (!measured) throw new Error(`No measured model for ${id}`);
  const model = flatFaceOf(measured);
  const insets = displayInsetsOf(model);
  const corners = displayRadiiOf(model);
  const percent = (mm) => mm / model.width * 100;
  const android = model.maker === "google";
  return {
    id,
    label: model.label,
    platform: android ? "android" : "ios",
    category: "phone",
    nativeAspect: model.screenPoints[0] / model.screenPoints[1],
    counterpart: android ? { ios: PIXEL_TO_IPHONE[id] ?? "iphone-17" } : { android: model.cutout.kind === "notch" ? "pixel-3-xl" : "pixel-10-pro" },
    screen: {
      paddingPercent: {
        top: percent(insets.top),
        right: percent(insets.side),
        bottom: percent(insets.bottom),
        left: percent(insets.side)
      },
      radiusFactor: corners.top / model.width,
      ...corners.bottom !== corners.top ? { radiusBottomFactor: corners.bottom / model.width } : {}
    }
  };
}
var DEVICE_REGISTRY = {
  "iphone": { id: "iphone", label: "iPhone (Classic)", platform: "ios", category: "phone", nativeAspect: 390 / 844, counterpart: { android: "android-bar" }, screen: { paddingPercent: { top: 3.5, right: 3.5, bottom: 3.5, left: 3.5 }, radiusFactor: 0.08 } },
  "iphone-x": { id: "iphone-x", label: "iPhone X", platform: "ios", category: "phone", nativeAspect: 375 / 812, counterpart: { android: "android-notch" }, screen: { paddingPercent: { top: 3, right: 3, bottom: 3, left: 3 }, radiusFactor: 0.09 } },
  "iphone-13": { id: "iphone-13", label: "iPhone 13", platform: "ios", category: "phone", nativeAspect: 390 / 844, counterpart: { android: "android-notch" }, screen: { paddingPercent: { top: 3, right: 3, bottom: 3, left: 3 }, radiusFactor: 0.09 } },
  "iphone-14": { id: "iphone-14", label: "iPhone 14", platform: "ios", category: "phone", nativeAspect: 390 / 844, counterpart: { android: "android-notch" }, screen: { paddingPercent: { top: 3, right: 3, bottom: 3, left: 3 }, radiusFactor: 0.1 } },
  "iphone-15": { id: "iphone-15", label: "iPhone 15", platform: "ios", category: "phone", nativeAspect: 390 / 844, counterpart: { android: "android-punch-hole" }, screen: { paddingPercent: { top: 2.5, right: 3, bottom: 2.5, left: 3 }, radiusFactor: 0.11 } },
  "iphone-15-pro": { id: "iphone-15-pro", label: "iPhone 15 Pro", platform: "ios", category: "phone", nativeAspect: 390 / 844, counterpart: { android: "android-punch-hole" }, screen: { paddingPercent: { top: 2.5, right: 3, bottom: 2.5, left: 3 }, radiusFactor: 0.11 } },
  "iphone-17-pro-max": { id: "iphone-17-pro-max", label: "iPhone 17 Pro Max", platform: "ios", category: "phone", nativeAspect: 440 / 956, counterpart: { android: "pixel-10-pro" }, screen: { paddingPercent: { top: 2.4, right: 2.8, bottom: 2.4, left: 2.8 }, radiusFactor: 0.115 } },
  "iphone-duo": measuredPhone("iphone-duo"),
  "iphone-18-pro-max": measuredPhone("iphone-18-pro-max"),
  "iphone-18-pro": measuredPhone("iphone-18-pro"),
  "iphone-17-pro": measuredPhone("iphone-17-pro"),
  "iphone-air": measuredPhone("iphone-air"),
  "iphone-17": measuredPhone("iphone-17"),
  "iphone-17e": measuredPhone("iphone-17e"),
  "iphone-16-pro-max": measuredPhone("iphone-16-pro-max"),
  "iphone-16-pro": measuredPhone("iphone-16-pro"),
  "iphone-16-plus": measuredPhone("iphone-16-plus"),
  "iphone-16": measuredPhone("iphone-16"),
  "iphone-16e": measuredPhone("iphone-16e"),
  // App Store iPads. Like the Play Store tablets, they map to BOTH platforms'
  // phones so converting an iPad project to a phone format is never a dead end.
  "ipad-pro-13": { id: "ipad-pro-13", label: "iPad Pro 13-inch", platform: "ios", category: "tablet", nativeAspect: 2064 / 2752, counterpart: { ios: "iphone-17-pro-max", android: "android-punch-hole" }, screen: { paddingPercent: { top: 3.2, right: 3.2, bottom: 3.2, left: 3.2 }, radiusFactor: 0.032 } },
  "ipad-11": { id: "ipad-11", label: "iPad 11-inch", platform: "ios", category: "tablet", nativeAspect: 1668 / 2420, counterpart: { ios: "iphone-17-pro-max", android: "android-punch-hole" }, screen: { paddingPercent: { top: 3.6, right: 3.6, bottom: 3.6, left: 3.6 }, radiusFactor: 0.036 } },
  // Apple Watch (Series 10 46mm proportions). No counterpart: platform swaps
  // leave watch mockups as-is, like the generic tablet/desktop.
  "apple-watch": { id: "apple-watch", label: "Apple Watch", platform: "ios", category: "watch", nativeAspect: 39 / 46, screen: { paddingPercent: { top: 10, right: 10, bottom: 10, left: 10 }, radiusFactor: 0.28 } },
  "android-bar": { id: "android-bar", label: "Android (Bar)", platform: "android", category: "phone", nativeAspect: 1080 / 2340, counterpart: { ios: "iphone" }, screen: { paddingPercent: { top: 6, right: 3, bottom: 3, left: 3 }, radiusFactor: 0.02 } },
  "android-notch": { id: "android-notch", label: "Android (Notch)", platform: "android", category: "phone", nativeAspect: 1080 / 2340, counterpart: { ios: "iphone-14" }, screen: { paddingPercent: { top: 3, right: 3, bottom: 3, left: 3 }, radiusFactor: 0.02 } },
  "android-punch-hole": { id: "android-punch-hole", label: "Android (Punch Hole)", platform: "android", category: "phone", nativeAspect: 1080 / 2400, counterpart: { ios: "iphone-15" }, screen: { paddingPercent: { top: 3, right: 3, bottom: 3, left: 3 }, radiusFactor: 0.02 } },
  "pixel-10-pro": measuredPhone("pixel-10-pro"),
  "pixel-10a": measuredPhone("pixel-10a"),
  "pixel-4": measuredPhone("pixel-4"),
  "pixel-3-xl": measuredPhone("pixel-3-xl"),
  "tablet": { id: "tablet", label: "Tablet", platform: "neutral", category: "tablet", nativeAspect: 768 / 1024, screen: { paddingPercent: { top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 }, radiusFactor: 0.016 } },
  "tablet-7": { id: "tablet-7", label: "7-inch Tablet", platform: "android", category: "tablet", nativeAspect: 800 / 1280, counterpart: { ios: "iphone-15", android: "android-punch-hole" }, screen: { paddingPercent: { top: 4.5, right: 4.5, bottom: 4.5, left: 4.5 }, radiusFactor: 0.03 } },
  "tablet-10": { id: "tablet-10", label: "10-inch Tablet", platform: "android", category: "tablet", nativeAspect: 1600 / 2560, counterpart: { ios: "iphone-15", android: "android-punch-hole" }, screen: { paddingPercent: { top: 3, right: 3, bottom: 3, left: 3 }, radiusFactor: 0.025 } },
  "desktop": { id: "desktop", label: "Desktop Monitor", platform: "neutral", category: "desktop", nativeAspect: 16 / 9, screen: { paddingPercent: { top: 1.5, right: 1.5, bottom: 3.5, left: 1.5 }, radiusFactor: 9e-3 } },
  // Macs. The element box is the FULL silhouette (lid + base for the MacBook,
  // slab + stand for the iMac), so the screen paddings carry the chassis:
  // the MacBook's side padding is the base overhang beyond the lid bezel, and
  // the iMac's bottom padding spans chin + stand. No counterpart: like the
  // watch, platform swaps leave Mac mockups as-is.
  "macbook": { id: "macbook", label: "MacBook", platform: "ios", category: "desktop", nativeAspect: 100 / 57.9, screen: { paddingPercent: { top: 2, right: 10, bottom: 5.9, left: 10 }, radiusFactor: 8e-3 } },
  "imac": { id: "imac", label: "iMac", platform: "ios", category: "desktop", nativeAspect: 100 / 74.2, screen: { paddingPercent: { top: 1.5, right: 1.5, bottom: 18.1, left: 1.5 }, radiusFactor: 0.012 } },
  "custom": { id: "custom", label: "Custom Mockup", platform: "neutral", category: "custom", nativeAspect: 9 / 16 }
};
function getDeviceDescriptor(id) {
  return DEVICE_REGISTRY[id] ?? DEVICE_REGISTRY.custom;
}
var PLATFORM_LABELS = {
  ios: "iPhone",
  android: "Android"
};
var DEVICE_PICKER_GROUPS = [
  { label: "iPhone", platform: "ios", category: "phone" },
  { label: "iPad", platform: "ios", category: "tablet" },
  { label: "Apple Watch", platform: "ios", category: "watch" },
  { label: "Mac", platform: "ios", category: "desktop" },
  { label: "Android", platform: "android", category: null },
  { label: "Other", platform: "neutral", category: null }
].map((g) => ({
  label: g.label,
  platform: g.platform,
  devices: Object.values(DEVICE_REGISTRY).filter(
    (d) => d.platform === g.platform && d.category !== "custom" && (g.category === null || d.category === g.category)
  )
}));
var DEVICE_FORMAT_PRESETS = [
  { id: "android", label: PLATFORM_LABELS.android, artboard: { width: 1080, height: 1920 } },
  { id: "ios", label: PLATFORM_LABELS.ios, artboard: { width: 1206, height: 2622 } },
  { id: "ios-large", label: "iPhone (large display)", artboard: { width: 1290, height: 2796 } },
  { id: "ipad-pro-13", label: "iPad 13-inch", artboard: { width: 2064, height: 2752 } },
  { id: "ipad-11", label: "iPad 11-inch", artboard: { width: 1668, height: 2420 } },
  { id: "tablet-7", label: "7-inch tablet", artboard: { width: 1080, height: 1920 } },
  { id: "tablet-10", label: "10-inch tablet", artboard: { width: 1440, height: 2560 } }
];

// ../../../../../../../../../../Documents/GitHub/artboard-studio/src/lib/device3dStudio.ts
var STUDIO_LENS_DEFAULT = 20;
var STUDIO_LENS_MIN = 6;
var STUDIO_LENS_MAX = 50;
var STUDIO_LIGHT_DEFAULT = { azimuth: 37, elevation: 27, intensity: 1 };
var STUDIO_LIGHT_INTENSITY_MIN = 0.2;
var STUDIO_LIGHT_INTENSITY_MAX = 2;
var STUDIO_LIGHT_ELEVATION_MIN = -30;
var STUDIO_LIGHT_ELEVATION_MAX = 85;
var STUDIO_CAMERA_LIFT = 0.02;
var STUDIO_FIT_MARGIN = 1.06;
var STUDIO_DEFAULT_SCALE = 560;
var STUDIO_MODELS = PHONE_MODELS;
function isFoldable(model) {
  return !!model?.fold;
}
var CUTOUTS = {
  "iphone-15": { kind: "island", width: 19.6, height: 5.9, center: 8.2 },
  "iphone-15-pro": { kind: "island", width: 19.6, height: 5.9, center: 8.2 },
  "iphone-14": { kind: "notch", width: 26.8, depth: 5.5, radius: 3.7, shoulder: 0.8 },
  "iphone-13": { kind: "notch", width: 26.8, depth: 5.5, radius: 3.7, shoulder: 0.8 },
  "iphone-x": { kind: "notch", width: 34, depth: 5.5, radius: 3.7, shoulder: 0.8 },
  "android-notch": { kind: "notch", width: 18, depth: 4, radius: 3, shoulder: 0.8 },
  "android-punch-hole": { kind: "punch", d: 3.4, center: 5.5 }
};
var MODEL_CACHE = /* @__PURE__ */ new Map();
function studioModelFor(deviceType) {
  const measured = measuredModelFor(deviceType);
  if (measured) return measured;
  if (!MODEL_CACHE.has(deviceType)) {
    const d = getDeviceDescriptor(deviceType);
    const model = d.category === "phone" || d.category === "tablet" ? genericPhoneModel(deviceType, d.label, d.category, d.platform, d.nativeAspect, CUTOUTS[deviceType] ?? { kind: "none" }) : null;
    MODEL_CACHE.set(deviceType, model);
  }
  return MODEL_CACHE.get(deviceType) ?? null;
}
function isMeasuredModel(deviceType) {
  return !!measuredModelFor(deviceType);
}
var HULL_CACHE = /* @__PURE__ */ new WeakMap();
function hullOf(model, posture) {
  const pose = model.fold ? posture ?? defaultFoldPosture(model) : void 0;
  const key = pose ? `${Math.round(pose.opening * 100) / 100}|${pose.across ? 1 : 0}` : "";
  let byPosture = HULL_CACHE.get(model);
  if (!byPosture) {
    byPosture = /* @__PURE__ */ new Map();
    HULL_CACHE.set(model, byPosture);
  }
  const cached = byPosture.get(key);
  if (cached) return cached;
  const k = 1 / model.width;
  const points = hullPoints(model, pose).map(([x, y, z]) => [x * k, y * k, z * k]);
  const radius = points.reduce((max, [x, y, z]) => Math.max(max, Math.hypot(x, y, z)), 0);
  const hull = { points, radius };
  if (byPosture.size >= 48) byPosture.clear();
  byPosture.set(key, hull);
  return hull;
}
function defaultFoldPosture(model) {
  return { opening: model.fold?.opening ?? 180, across: false };
}
var DEG = Math.PI / 180;
function wrapDegrees(angle) {
  if (!Number.isFinite(angle)) return 0;
  let a = angle % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return Math.round(a * 100) / 100 || 0;
}
function orientationMatrix(o) {
  const cy = Math.cos(o.yaw * DEG);
  const sy = Math.sin(o.yaw * DEG);
  const cp = Math.cos(o.pitch * DEG);
  const sp = Math.sin(o.pitch * DEG);
  const cr = Math.cos(o.roll * DEG);
  const sr = Math.sin(o.roll * DEG);
  return [
    cr * cy - sr * sp * sy,
    -sr * cp,
    cr * sy + sr * sp * cy,
    sr * cy + cr * sp * sy,
    cr * cp,
    sr * sy - cr * sp * cy,
    -cp * sy,
    sp,
    cp * cy
  ];
}
function orientationFromMatrix(m) {
  const sp = Math.max(-1, Math.min(1, m[7]));
  const pitch = Math.asin(sp) / DEG;
  if (Math.abs(sp) < 0.999999) {
    return {
      yaw: wrapDegrees(Math.atan2(-m[6], m[8]) / DEG),
      pitch: wrapDegrees(pitch),
      roll: wrapDegrees(Math.atan2(-m[1], m[4]) / DEG)
    };
  }
  return { yaw: 0, pitch: wrapDegrees(pitch), roll: wrapDegrees(Math.atan2(m[3], m[0]) / DEG) };
}
function transform(m, [x, y, z]) {
  return [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
}
var STUDIO_DRAG_DEGREES_PER_RADIUS = 75;
function turntableTurn(start, dx, dy, radius, snap = 0) {
  if (radius <= 0) return start;
  const k = STUDIO_DRAG_DEGREES_PER_RADIUS / radius;
  let yaw = start.yaw + dx * k;
  let pitch = Math.max(-90, Math.min(90, start.pitch + dy * k));
  if (snap > 0) {
    yaw = Math.round(yaw / snap) * snap;
    pitch = Math.max(-90, Math.min(90, Math.round(pitch / snap) * snap));
  }
  return { yaw: wrapDegrees(yaw), pitch: wrapDegrees(pitch), roll: start.roll };
}
function snapDegrees(angle, step) {
  return wrapDegrees(Math.round(angle / step) * step);
}
function mirrorOrientation(o) {
  return { yaw: wrapDegrees(-o.yaw), pitch: o.pitch, roll: wrapDegrees(-o.roll) };
}
function sameOrientation(a, b, tolerance = 0.05) {
  const near = (x, y) => Math.abs(wrapDegrees(x - y)) <= tolerance;
  return near(a.yaw, b.yaw) && near(a.pitch, b.pitch) && near(a.roll, b.roll);
}
function exposedSide(o) {
  return Math.sin(2 * o.yaw * DEG) > 1e-6 ? -1 : 1;
}
function clampLens(lens) {
  const value = typeof lens === "number" && Number.isFinite(lens) ? lens : STUDIO_LENS_DEFAULT;
  return Math.max(STUDIO_LENS_MIN, Math.min(STUDIO_LENS_MAX, value));
}
var WIDEST_FOLD = /* @__PURE__ */ new WeakMap();
function cameraRadius(model, posture) {
  if (!model.fold) return hullOf(model, posture).radius;
  let widest = WIDEST_FOLD.get(model);
  if (widest === void 0) {
    widest = 0;
    for (let opening = 0; opening <= 180; opening += 15) widest = Math.max(widest, hullOf(model, { opening, across: false }).radius);
    WIDEST_FOLD.set(model, widest);
  }
  return widest;
}
function studioCameraDistance(model, lens, posture) {
  return cameraRadius(model, posture) / Math.tan(clampLens(lens) * DEG / 2);
}
function projector(model, lens, posture) {
  const d = studioCameraDistance(model, lens, posture);
  const lift = STUDIO_CAMERA_LIFT;
  const n = Math.sqrt(1 + lift * lift);
  const centreDepth = d * n;
  return ([x, y, z]) => {
    const depth = (d * (1 + lift * lift) - lift * y - z) / n;
    const viewY = (y - lift * z) / n;
    const k = centreDepth / Math.max(depth, 1e-6);
    return [x * k, viewY * k];
  };
}
function studioBounds(model, o, lens, posture) {
  const m = orientationMatrix(o);
  const project = projector(model, lens, posture);
  const bounds = { minU: Infinity, maxU: -Infinity, minV: Infinity, maxV: -Infinity };
  for (const point of hullOf(model, posture).points) {
    const [u, v] = project(transform(m, point));
    if (u < bounds.minU) bounds.minU = u;
    if (u > bounds.maxU) bounds.maxU = u;
    if (v < bounds.minV) bounds.minV = v;
    if (v > bounds.maxV) bounds.maxV = v;
  }
  return bounds;
}
function studioSphereRadius(model, lens, posture) {
  const r = hullOf(model, posture).radius;
  const d = studioCameraDistance(model, lens, posture) * Math.sqrt(1 + STUDIO_CAMERA_LIFT * STUDIO_CAMERA_LIFT);
  return r * d / Math.sqrt(Math.max(d * d - r * r, 1e-6));
}
function studioFrame(model, o, lens, boxWidth, boxHeight, posture) {
  const b = studioBounds(model, o, lens, posture);
  const width = Math.max(b.maxU - b.minU, 1e-6) * STUDIO_FIT_MARGIN;
  const height = Math.max(b.maxV - b.minV, 1e-6) * STUDIO_FIT_MARGIN;
  return {
    scale: Math.max(1e-6, Math.min(boxWidth / width, boxHeight / height)),
    centerU: (b.minU + b.maxU) / 2,
    centerV: (b.minV + b.maxV) / 2
  };
}
function studioHugSize(model, o, lens, scale, posture) {
  const b = studioBounds(model, o, lens, posture);
  return {
    width: (b.maxU - b.minU) * STUDIO_FIT_MARGIN * scale,
    height: (b.maxV - b.minV) * STUDIO_FIT_MARGIN * scale
  };
}
var roundTo = (value, places = 2) => {
  const f = 10 ** places;
  return Math.round(value * f) / f;
};
function rehugStudioBox(box, from, to) {
  const scale = box.scale || 1;
  const boxW = box.size.width * scale;
  const boxH = box.size.height * scale;
  const before = studioFrame(from.model, from.orientation, from.lens, boxW, boxH, from.posture);
  const after = studioBounds(to.model, to.orientation, to.lens, to.posture);
  const s = before.scale * (to.model === from.model ? 1 : from.model.height / from.model.width / (to.model.height / to.model.width));
  const nextW = Math.max(1, (after.maxU - after.minU) * STUDIO_FIT_MARGIN * s);
  const nextH = Math.max(1, (after.maxV - after.minV) * STUDIO_FIT_MARGIN * s);
  const centerU = (after.minU + after.maxU) / 2;
  const centerV = (after.minV + after.maxV) / 2;
  const localX = centerU * s - before.centerU * before.scale;
  const localY = before.centerV * before.scale - centerV * s;
  const angle = (box.rotation || 0) * DEG;
  const dx = localX * Math.cos(angle) - localY * Math.sin(angle);
  const dy = localX * Math.sin(angle) + localY * Math.cos(angle);
  const oldCenterX = box.position.x + boxW / 2;
  const oldCenterY = box.position.y + boxH / 2;
  return {
    position: { x: roundTo(oldCenterX + dx - nextW / 2), y: roundTo(oldCenterY + dy - nextH / 2) },
    size: { width: roundTo(nextW / scale), height: roundTo(nextH / scale) }
  };
}
function isStudioStyle(styleType) {
  return styleType === "3d-studio";
}
var finiteOr = (value, fallback) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
function studioOrientationOf(el) {
  const o = el.rotation3d;
  return {
    yaw: finiteOr(o?.yaw, 0),
    pitch: finiteOr(o?.pitch, 0),
    roll: finiteOr(o?.roll, 0)
  };
}
function studioLensOf(el) {
  return clampLens(el.lens3d);
}
function studioLightOf(el) {
  const l = el.light3d;
  return {
    azimuth: wrapDegrees(finiteOr(l?.azimuth, STUDIO_LIGHT_DEFAULT.azimuth)),
    elevation: Math.max(
      STUDIO_LIGHT_ELEVATION_MIN,
      Math.min(STUDIO_LIGHT_ELEVATION_MAX, finiteOr(l?.elevation, STUDIO_LIGHT_DEFAULT.elevation))
    ),
    intensity: Math.max(
      STUDIO_LIGHT_INTENSITY_MIN,
      Math.min(STUDIO_LIGHT_INTENSITY_MAX, finiteOr(l?.intensity, STUDIO_LIGHT_DEFAULT.intensity))
    )
  };
}
var HEX = /^#[0-9a-fA-F]{6}$/;
function studioCustomColorOf(el) {
  const color = el.bodyColor3d;
  return typeof color === "string" && HEX.test(color) ? color.toLowerCase() : null;
}
function backForCustom(hex) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => Math.round(c + (255 - c) * 0.08);
  const r = mix(n >> 16 & 255);
  const g = mix(n >> 8 & 255);
  const b = mix(n & 255);
  return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;
}
function studioFinishOf(el, model) {
  const custom = studioCustomColorOf(el);
  if (custom) return { id: "custom", label: "Custom", frame: custom, back: backForCustom(custom) };
  return finishOf(model, el.finish3d);
}
function studioGlareOf(el) {
  return Math.max(0, Math.min(1, finiteOr(el.glare3d, 0)));
}
function clampOpening(opening, fallback = 180) {
  return Math.max(0, Math.min(180, finiteOr(opening, fallback)));
}
function studioPostureOf(el, model) {
  return { opening: clampOpening(el.fold3d, model.fold?.opening ?? 180), across: el.hinge3d === "across" };
}
function foldScreenOf(opening) {
  return opening >= 90 ? "inner" : "outer";
}
function posedFold(model, posture, m, center, side, p, direction = false) {
  let q = p;
  if (side === "left") {
    if (direction) {
      const a = foldTurn(posture.opening) * DEG;
      q = [p[0] * Math.cos(a) + p[2] * Math.sin(a), p[1], -p[0] * Math.sin(a) + p[2] * Math.cos(a)];
    } else {
      q = foldLeftPoint(model, posture.opening, p);
    }
  }
  const f = foldFrame(direction ? [0, 0, 0] : center, posture.across, q);
  const k = direction ? 1 : 1 / model.width;
  return transform(m, [f[0] * k, f[1] * k, f[2] * k]);
}
function unposedFold(model, posture, m, center, side, p) {
  const t = [m[0] * p[0] + m[3] * p[1] + m[6] * p[2], m[1] * p[0] + m[4] * p[1] + m[7] * p[2], m[2] * p[0] + m[5] * p[1] + m[8] * p[2]];
  const w = [t[0] * model.width, t[1] * model.width, t[2] * model.width];
  const g = posture.across ? [w[1], -w[0], w[2]] : w;
  const q = [g[0] + center[0], g[1] + center[1], g[2] + center[2]];
  if (side === "right") return q;
  const a = foldTurn(posture.opening) * DEG;
  const pivot = foldPivot(model);
  const dz = q[2] - pivot;
  return [q[0] * Math.cos(a) - dz * Math.sin(a), q[1], q[0] * Math.sin(a) + dz * Math.cos(a) + pivot];
}
function segmentHitsBox(a, b, lo, hi) {
  let t0 = 0;
  let t1 = 1;
  for (let k = 0; k < 3; k++) {
    const d = b[k] - a[k];
    if (Math.abs(d) < 1e-12) {
      if (a[k] < lo[k] || a[k] > hi[k]) return false;
      continue;
    }
    let ta = (lo[k] - a[k]) / d;
    let tb = (hi[k] - a[k]) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}
var VIEW_SAMPLES = { across: 16, along: 8 };
function foldDisplaysInView(model, posture, o, lens) {
  const fold = model.fold;
  if (!fold) return { inner: 0, outer: 0 };
  const m = orientationMatrix(o);
  const center = foldCenter(model, posture.opening);
  const d = studioCameraDistance(model, lens, posture);
  const camera = [0, STUDIO_CAMERA_LIFT * d, d];
  const { front, back } = faceDepths(model);
  const halfW = model.width / 2;
  const halfH = model.height / 2;
  const e = 0.05;
  const hidden = (by, p) => {
    const x0 = by === "right" ? 0 : -halfW;
    return segmentHitsBox(
      unposedFold(model, posture, m, center, by, p),
      unposedFold(model, posture, m, center, by, camera),
      [x0 + e, -halfH + e, back + e],
      [x0 + halfW - e, halfH - e, front - e]
    );
  };
  const seen = (side, x0, x1, y0, y1, z, nz) => {
    const { across: n, along } = VIEW_SAMPLES;
    const cell = (x1 - x0) * (y1 - y0) / (n * along);
    const normal = posedFold(model, posture, m, center, side, [0, 0, nz], true);
    const other = side === "left" ? "right" : "left";
    let total = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < along; j++) {
        const p = posedFold(model, posture, m, center, side, [x0 + (i + 0.5) / n * (x1 - x0), y0 + (j + 0.5) / along * (y1 - y0), z]);
        const to = [camera[0] - p[0], camera[1] - p[1], camera[2] - p[2]];
        const facing = (normal[0] * to[0] + normal[1] * to[1] + normal[2] * to[2]) / Math.hypot(to[0], to[1], to[2]);
        if (facing > 0.02 && !hidden(other, p)) total += facing * cell;
      }
    }
    return total;
  };
  const dw = model.display.width / 2;
  const dh = model.display.height / 2;
  const outer = fold.outer;
  return {
    inner: seen("right", 0, dw, -dh, dh, front, 1) + seen("left", -dw, 0, -dh, dh, front, 1),
    outer: seen("left", -(outer.hinge + outer.width), -outer.hinge, -outer.height / 2, outer.height / 2, back, -1)
  };
}
var FOLD_INNER_PREFERENCE = 2.5;
function foldScreenInView(model, posture, o, lens, current) {
  const seen = foldDisplaysInView(model, posture, o, lens);
  if (seen.inner + seen.outer < model.display.width * model.display.height * 0.01) return current ?? foldScreenOf(posture.opening);
  const inner = seen.inner * FOLD_INNER_PREFERENCE;
  if (current === "inner") return seen.outer > inner * 1.15 ? "outer" : "inner";
  if (current === "outer") return inner > seen.outer * 1.15 ? "inner" : "outer";
  return inner >= seen.outer ? "inner" : "outer";
}
var FOLD_GRIP_REACH = 0.7;
function toBox(model, lens, posture, frame, boxW, boxH, p) {
  const [u, v] = projector(model, lens, posture)(p);
  return { x: boxW / 2 + (u - frame.centerU) * frame.scale, y: boxH / 2 - (v - frame.centerV) * frame.scale };
}
function studioFoldGrip(model, o, lens, posture, frame, boxW, boxH, reach = FOLD_GRIP_REACH) {
  const grip = [-reach * model.width / 2, 0, 0];
  const p = posedFold(model, posture, orientationMatrix(o), foldCenter(model, posture.opening), "left", grip);
  return toBox(model, lens, posture, frame, boxW, boxH, p);
}
function studioFoldTo(model, o, lens, across, frame, boxW, boxH, pointer, from, reach = FOLD_GRIP_REACH) {
  const miss = (opening) => {
    const g = studioFoldGrip(model, o, lens, { opening, across }, frame, boxW, boxH, reach);
    return Math.hypot(g.x - pointer.x, g.y - pointer.y);
  };
  const lo = Math.max(0, from - 45);
  const hi = Math.min(180, from + 45);
  let best = clampOpening(from);
  let bestMiss = miss(best);
  for (let a = lo; a <= hi + 1e-9; a += 1) {
    const m = miss(a);
    if (m < bestMiss) {
      bestMiss = m;
      best = a;
    }
  }
  let a0 = Math.max(0, best - 1);
  let a1 = Math.min(180, best + 1);
  for (let k = 0; k < 24; k++) {
    const m1 = a0 + (a1 - a0) / 3;
    const m2 = a1 - (a1 - a0) / 3;
    if (miss(m1) < miss(m2)) a1 = m2;
    else a0 = m1;
  }
  best = Math.round((a0 + a1) / 2 * 10) / 10;
  bestMiss = miss(best);
  const hinge = toBox(model, lens, { opening: best, across }, frame, boxW, boxH, posedFold(model, { opening: best, across }, orientationMatrix(o), foldCenter(model, best), "right", [0, 0, foldPivot(model)]));
  for (const end of [0, 180]) {
    if (Math.abs(best - end) > 30) continue;
    const g = studioFoldGrip(model, o, lens, { opening: end, across }, frame, boxW, boxH, reach);
    const ox = g.x - hinge.x;
    const oy = g.y - hinge.y;
    const len = Math.hypot(ox, oy);
    if (len < 2) continue;
    const t = ((pointer.x - g.x) * ox + (pointer.y - g.y) * oy) / len;
    if (t <= 0) continue;
    const off = Math.hypot(pointer.x - (g.x + ox / len * t), pointer.y - (g.y + oy / len * t));
    if (off < bestMiss) return end;
  }
  return best;
}
function withStudioRehug(el, changes) {
  const fromModel = studioModelFor(el.deviceType);
  const toModel = studioModelFor(changes.deviceType ?? el.deviceType);
  if (!isStudioStyle(el.styleType) || !fromModel || !toModel) return { ...changes };
  const box = rehugStudioBox(
    { position: el.position, size: el.size, scale: el.scale, rotation: el.rotation },
    { model: fromModel, orientation: studioOrientationOf(el), lens: studioLensOf(el), posture: studioPostureOf(el, fromModel) },
    {
      model: toModel,
      orientation: changes.rotation3d ? studioOrientationOf({ rotation3d: changes.rotation3d }) : studioOrientationOf(el),
      lens: changes.lens3d !== void 0 ? clampLens(changes.lens3d) : studioLensOf(el),
      posture: studioPostureOf({ fold3d: "fold3d" in changes ? changes.fold3d : el.fold3d, hinge3d: "hinge3d" in changes ? changes.hinge3d : el.hinge3d }, toModel)
    }
  );
  return { ...changes, ...box };
}
function orientationForPose(pose, side) {
  const angles = DEVICE_3D_POSE_ANGLES[pose] ?? DEVICE_3D_POSE_ANGLES.classic;
  const mirror = side === "left" ? 1 : -1;
  return {
    yaw: wrapDegrees(angles.yaw * mirror),
    pitch: wrapDegrees(angles.pitch),
    roll: wrapDegrees((angles.roll ?? 0) * mirror)
  };
}
var poseLook = (pose, label) => ({
  id: pose,
  label,
  orientation: orientationForPose(pose, "left")
});
var STUDIO_LOOKS = [
  { id: "front", label: "Front", orientation: { yaw: 0, pitch: 0, roll: 0 } },
  { id: "hero", label: "Hero", orientation: { yaw: 24, pitch: -12, roll: -8 } },
  poseLook("upright", "Upright"),
  poseLook("side", "Side"),
  poseLook("tilted", "Tilted"),
  poseLook("reclined", "Reclined"),
  poseLook("laying", "Laying"),
  poseLook("floating", "Floating"),
  poseLook("drifting", "Drifting"),
  poseLook("leaning", "Leaning"),
  poseLook("soaring", "Soaring"),
  poseLook("isometric", "Isometric"),
  { id: "flat-lay", label: "Flat lay", orientation: { yaw: 0, pitch: -58, roll: 0 } },
  { id: "profile", label: "Profile", orientation: { yaw: 78, pitch: 0, roll: 0 } },
  { id: "back-angled", label: "Back angled", orientation: { yaw: 148, pitch: -10, roll: 0 } },
  { id: "back", label: "Back", orientation: { yaw: 180, pitch: 0, roll: 0 } }
];
function studioLookById(id) {
  return STUDIO_LOOKS.find((look) => look.id === id);
}
var STUDIO_FOLD_POSES = [
  { id: "closed", label: "Closed", opening: 0, across: false, orientation: { yaw: 24, pitch: -12, roll: -8 } },
  // Standing on its two edges with the hinge on top, turned 28 degrees on the
  // table and seen from 14 degrees above: the outer display faces you.
  { id: "tent", label: "Tent", opening: 70, across: true, orientation: { yaw: -38.98, pitch: -43.6, roll: 158.17 } },
  // The lower half flat like a keyboard, the upper half the screen, seen from
  // the front and above.
  { id: "laptop", label: "Laptop", opening: 105, across: true, orientation: { yaw: 25, pitch: 20, roll: 0 } },
  { id: "book", label: "Book", opening: 150, across: false, orientation: { yaw: 14, pitch: -10, roll: -4 } },
  { id: "open", label: "Open", opening: 180, across: true, orientation: { yaw: 24, pitch: -12, roll: -8 } }
];
function studioFoldPoseById(id) {
  return STUDIO_FOLD_POSES.find((pose) => pose.id === id);
}
var STUDIO_TILE_FOLD = { opening: 160, across: true };
function matchStudioLook(o) {
  for (const look of STUDIO_LOOKS) {
    if (sameOrientation(look.orientation, o)) return { look, mirrored: false };
    if (sameOrientation(mirrorOrientation(look.orientation), o)) return { look, mirrored: true };
  }
  return null;
}
function lightForOrientation(light, o) {
  const side = exposedSide(o);
  const azimuth = Math.abs(light.azimuth);
  return { ...light, azimuth: wrapDegrees(side * (azimuth === 0 ? STUDIO_LIGHT_DEFAULT.azimuth : azimuth)) };
}
function studioDefaultScale(model) {
  return model.fold ? STUDIO_DEFAULT_SCALE * 2 : STUDIO_DEFAULT_SCALE;
}
function studioDefaultSize(model, o, lens = STUDIO_LENS_DEFAULT, posture) {
  const size = studioHugSize(model, o, lens, studioDefaultScale(model), posture);
  return { width: Math.round(size.width), height: Math.round(size.height) };
}
var STUDIO_TILE_LOOK = "hero";
var TILE_PROPS_CACHE = /* @__PURE__ */ new Map();
function studioTileStyleProps(model) {
  const cached = TILE_PROPS_CACHE.get(model.id);
  if (cached) return cached;
  const orientation = (studioLookById(STUDIO_TILE_LOOK) ?? STUDIO_LOOKS[0]).orientation;
  const posture = model.fold ? STUDIO_TILE_FOLD : void 0;
  const props = {
    styleType: "3d-studio",
    rotation3d: { ...orientation },
    finish3d: model.defaultFinish,
    light3d: lightForOrientation(STUDIO_LIGHT_DEFAULT, orientation),
    ...posture ? { fold3d: posture.opening, hinge3d: posture.across ? "across" : "upright" } : {},
    defaultSize: studioDefaultSize(model, orientation, STUDIO_LENS_DEFAULT, posture)
  };
  TILE_PROPS_CACHE.set(model.id, props);
  return props;
}
var POSED_FINISH_COLORS = {
  titanium: "#8d8d93",
  black: "#2f2f33",
  white: "#f1f1f3"
};
function nearestFinish(model, posed) {
  const rgb = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  };
  const target = rgb(POSED_FINISH_COLORS[posed]);
  let best = model.finishes[0];
  let bestDistance = Infinity;
  for (const finish of model.finishes) {
    const c = rgb(finish.frame);
    const distance = (c[0] - target[0]) ** 2 + (c[1] - target[1]) ** 2 + (c[2] - target[2]) ** 2;
    if (distance < bestDistance) {
      best = finish;
      bestDistance = distance;
    }
  }
  return best.id;
}
function studioConversionPatch(el) {
  const model = studioModelFor(el.deviceType);
  const posed = el.styleType === "3d-left" || el.styleType === "3d-right";
  const orientation = el.rotation3d ? studioOrientationOf(el) : posed ? orientationForPose(el.pose3d ?? "classic", el.styleType === "3d-left" ? "left" : "right") : { yaw: 0, pitch: 0, roll: 0 };
  const patch = {
    styleType: "3d-studio",
    rotation3d: orientation
  };
  if (model && !el.finish3d && !el.bodyColor3d && posed && el.frameColor3d) {
    patch.finish3d = nearestFinish(model, el.frameColor3d);
  }
  if (!el.light3d) patch.light3d = lightForOrientation(STUDIO_LIGHT_DEFAULT, orientation);
  if (!model) return patch;
  const lens = studioLensOf(el);
  const posture = studioPostureOf(el, model);
  const box = rehugStudioBox(
    { position: el.position, size: el.size, scale: el.scale, rotation: el.rotation },
    { model, orientation, lens, posture },
    { model, orientation, lens, posture }
  );
  return { ...patch, ...box };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  FOLD_GRIP_REACH,
  FOLD_INNER_PREFERENCE,
  PHONE_MODELS,
  STUDIO_CAMERA_LIFT,
  STUDIO_DEFAULT_SCALE,
  STUDIO_DRAG_DEGREES_PER_RADIUS,
  STUDIO_FIT_MARGIN,
  STUDIO_FOLD_POSES,
  STUDIO_LENS_DEFAULT,
  STUDIO_LENS_MAX,
  STUDIO_LENS_MIN,
  STUDIO_LIGHT_DEFAULT,
  STUDIO_LIGHT_ELEVATION_MAX,
  STUDIO_LIGHT_ELEVATION_MIN,
  STUDIO_LIGHT_INTENSITY_MAX,
  STUDIO_LIGHT_INTENSITY_MIN,
  STUDIO_LOOKS,
  STUDIO_MODELS,
  STUDIO_TILE_FOLD,
  STUDIO_TILE_LOOK,
  clampLens,
  clampOpening,
  defaultFoldPosture,
  exposedSide,
  foldDisplaysInView,
  foldScreenInView,
  foldScreenOf,
  isFoldable,
  isMeasuredModel,
  isStudioStyle,
  lightForOrientation,
  matchStudioLook,
  measuredModelFor,
  mirrorOrientation,
  orientationForPose,
  orientationFromMatrix,
  orientationMatrix,
  rehugStudioBox,
  sameOrientation,
  snapDegrees,
  studioBounds,
  studioCameraDistance,
  studioConversionPatch,
  studioCustomColorOf,
  studioDefaultScale,
  studioDefaultSize,
  studioFinishOf,
  studioFoldGrip,
  studioFoldPoseById,
  studioFoldTo,
  studioFrame,
  studioGlareOf,
  studioHugSize,
  studioLensOf,
  studioLightOf,
  studioLookById,
  studioModelFor,
  studioOrientationOf,
  studioPostureOf,
  studioSphereRadius,
  studioTileStyleProps,
  turntableTurn,
  withStudioRehug,
  wrapDegrees
});

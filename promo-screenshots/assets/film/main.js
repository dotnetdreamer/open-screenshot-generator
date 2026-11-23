// The film: one three.js stage, drawn for each seek from the time alone.
// Setup is one window.__hf.buildReady promise; every hf-seek registers its frame
// with waitUntil, so HyperFrames captures it only once the GPU has finished.
import * as THREE from "../vendor/three.bundle.js";
import { W, H, FPS, SHOT, SCREENS } from "./timing.js";
import { R, N, a, SCREEN, CAM, PROP_R, polar } from "./world.js";
import { camAt, camSpeed } from "./camera.js";
import { buildSet, buildLights } from "./set.js";
import { buildProps } from "./props.js";
import { buildSlate } from "./slate.js";
import { createScreens } from "./screens.js";
import { buildPost } from "./post.js";
import { loadFonts, loadShots } from "./assets.js";
import { FEATURES } from "./copy.js";

const READY_KEY = "one-take";
const canvas = document.getElementById("stage");
const vars = window.__hyperframes?.getVariables?.() ?? {};
// Drafts render the stage at a fraction of the frame and let the browser scale it up.
const scale = Math.min(1, Math.max(0.25, Number(vars.renderScale) || 1));
const width = Math.round(W * scale);
const height = Math.round(H * scale);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
renderer.setPixelRatio(1);
renderer.setSize(width, height, false);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.22;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x060504);
scene.fog = new THREE.FogExp2(0x0d0a08, 0.02);
const camera = new THREE.PerspectiveCamera(CAM.fov, W / H, 0.05, 90);
camera.rotation.order = "YXZ";

let screens = [];
let screenMeshes = [];
let props = [];
let slate = null;
let lights = null;
let post = null;
let frameT = 0;

function setCamera(t) {
  const c = camAt(t);
  camera.position.set(c.pos[0], c.pos[1], c.pos[2]);
  camera.rotation.set(c.pitch, c.yaw, c.roll);
  if (camera.fov !== c.fov) {
    camera.fov = c.fov;
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld(true);
  return c;
}

const accentColor = FEATURES.map((f) => new THREE.Color(f.accent));
const tmpColor = new THREE.Color();

/** Put the key, the screen glow and the rim where the camera is looking. */
function placeLights(t) {
  const c = camAt(t);
  if (t < SHOT.WHIP + 0.2) {
    const ang = Math.atan2(c.pos[0], c.pos[2]);
    const ip = -ang / (Math.PI * 2 / N);
    const i0 = Math.max(0, Math.min(SCREENS - 1, Math.round(ip)));
    lights.key.position.set(...polar(R - 4.6, ang + 0.05, 5.6));
    lights.key.target.position.set(...polar(PROP_R, ang, 0.7));
    lights.rim.position.set(...polar(R - 0.9, ang - 0.3, 5.0));
    lights.rim.target.position.set(...polar(PROP_R, ang, 1.0));
    lights.glow.position.set(...polar(R - 0.15, ang, SCREEN.yc));
    lights.glow.lookAt(0, SCREEN.yc, 0);
    // the glow takes the colour of the screen it sits under, mixed towards white
    const i1 = Math.max(0, Math.min(SCREENS - 1, i0 + Math.sign(ip - i0)));
    const w = Math.abs(ip - i0);
    tmpColor.copy(accentColor[i0]).lerp(accentColor[i1], w).lerp(new THREE.Color(1, 1, 1), 0.55);
    lights.glow.color.copy(tmpColor);
    lights.glow.intensity = 3.2;
    lights.key.intensity = 42;
  } else {
    // softer on the slate, so its cream lettering stays under the bloom threshold
    lights.key.intensity = 26;
    // The wide shot and the end card: the key comes from behind the camera onto the slate.
    const ang = Math.atan2(c.pos[0], c.pos[2]);
    lights.key.position.set(...polar(4.2, ang + 0.35, 6.2));
    lights.key.target.position.set(0, 1.9, 0);
    lights.rim.position.set(...polar(3.5, ang + Math.PI + 0.4, 5.5));
    lights.rim.target.position.set(0, 2.2, 0);
    lights.glow.position.set(...polar(3.0, ang, 2.4));
    lights.glow.lookAt(0, 2.3, 0);
    lights.glow.color.setRGB(1, 0.92, 0.82);
    lights.glow.intensity = 1.6;
  }
  lights.key.target.updateMatrixWorld();
  lights.rim.target.updateMatrixWorld();
}

const fwd = new THREE.Vector3();
const toScreen = new THREE.Vector3();
/** Screens worth drawing: in front of the camera within ~80 degrees (the floor reflects a little more than the frame). */
function screensInView() {
  camera.getWorldDirection(fwd);
  fwd.y = 0;
  fwd.normalize();
  return screens.filter((s, i) => {
    const p = polar(R, a(i), SCREEN.yc);
    toScreen.set(p[0] - camera.position.x, 0, p[2] - camera.position.z).normalize();
    return fwd.dot(toScreen) > 0.17;
  });
}

function renderSample(k, n, target) {
  const shutter = 0.5 / FPS; // 180 degrees
  const t = n > 1 ? frameT + ((k + 0.5) / n - 0.5) * shutter : frameT;
  setCamera(t);
  placeLights(t);
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x060504, 1);
  renderer.clear();
  renderer.render(scene, camera);
}

const pixel = new Uint8Array(4);
function waitForGpu() {
  const gl = renderer.getContext();
  renderer.setRenderTarget(null);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
}

function draw(t) {
  frameT = t;
  setCamera(t);
  for (const s of screensInView()) s.draw(t);
  for (const p of props) p.update(t);
  slate.update(t);
  const speed = camSpeed(t);
  post.accum.samples = speed < 0.04 ? 1 : Math.min(14, 3 + Math.ceil(speed * 5));
  // Depth of field opens as the camera comes in to the slate, focused on its face.
  const dofOpen = Math.min(1, Math.max(0, (t - SHOT.APPROACH) / (SHOT.CLAP - SHOT.APPROACH)));
  post.dof.uniforms.aperture.value = dofOpen * dofOpen * 1.1;
  post.dof.uniforms.near.value = camera.near;
  post.dof.uniforms.far.value = camera.far;
  post.dof.uniforms.focus.value = Math.hypot(camera.position.x, camera.position.y - 2.25, camera.position.z);
  post.grade.uniforms.frame.value = Math.round(t * FPS);
  if (vars.debugDirect) {
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
  } else post.composer.render();
  waitForGpu();
}

async function setup() {
  await loadFonts();
  const shots = await loadShots();
  buildSet(scene, { width, height });
  lights = buildLights(scene);
  props = buildProps(scene, shots);
  // the slate faces the camera's wide shot, which has its back to the last screen
  slate = buildSlate(scene, a(SCREENS - 1));
  screens = createScreens(shots);
  const geo = new THREE.PlaneGeometry(SCREEN.w, SCREEN.h);
  screenMeshes = screens.map((s, i) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: s.texture, color: new THREE.Color(1.0, 1.0, 1.0), fog: false }));
    m.position.set(...polar(R, a(i), SCREEN.yc));
    m.rotation.y = a(i) + Math.PI;
    scene.add(m);
    s.draw(-1);
    return m;
  });
  post = buildPost(renderer, width, height, renderSample);
  if (vars.noBloom) post.bloom.enabled = false;
  if (vars.noGrade) post.grade.enabled = false;
  setCamera(0);
  placeLights(0);
  await renderer.compileAsync(scene, camera);
  // The first image a renderer draws differs (warm-up), so draw one and throw it away.
  draw(0.0001);
}

const ready = setup();
window.__hf = window.__hf || {};
window.__hf.buildReady = window.__hf.buildReady || {};
window.__hf.buildReady[READY_KEY] = ready;

let shown = null;
let queue = ready;
window.addEventListener("hf-seek", (event) => {
  const { time } = event.detail;
  queue = queue
    .catch(() => {})
    .then(() => ready)
    .then(() => {
      if (time === shown) return;
      draw(time);
      shown = time;
    });
  event.detail.waitUntil(queue);
});

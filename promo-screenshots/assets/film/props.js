// One prop in front of each screen, 2.5 m out from it, the way the reference
// dresses its set. Each is a real object a film set or a desk would hold, and
// tied to its screen. Local axes: +x to the camera's right, +z towards the
// camera, +y up. At the hold the camera sees a prop from about 1.05 m up, so
// each one tops out at 1.4 to 1.75 m and only covers the bottom of its screen.
import * as THREE from "../vendor/three.bundle.js";
import { N, a, PROP_R, polar } from "./world.js";
import { landAt } from "./timing.js";

const M = {
  wood: new THREE.MeshStandardMaterial({ color: 0x8a5a36, roughness: 0.62, metalness: 0.02 }),
  woodDark: new THREE.MeshStandardMaterial({ color: 0x4e3020, roughness: 0.7 }),
  black: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.45, metalness: 0.3 }),
  satin: new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.55, metalness: 0.6 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x8e8e93, roughness: 0.32, metalness: 0.85 }),
  white: new THREE.MeshStandardMaterial({ color: 0xeeeae2, roughness: 0.35 }),
  cream: new THREE.MeshStandardMaterial({ color: 0xb9ad98, roughness: 0.7 }),
  red: new THREE.MeshStandardMaterial({ color: 0x8e1c22, roughness: 0.85 }),
  card: new THREE.MeshStandardMaterial({ color: 0xb98a5a, roughness: 0.9 }),
};
const std = (color, roughness = 0.4, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const glow = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b) });

function mesh(geo, mat, x = 0, y = 0, z = 0, parent = null) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
}
const box = (w, h, d, mat, x, y, z, p) => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z, p);
const rbox = (w, h, d, r, mat, x, y, z, p) => mesh(new THREE.RoundedBoxGeometry(w, h, d, 4, r), mat, x, y, z, p);
const cyl = (r1, r2, h, mat, x, y, z, p, seg = 32) => mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat, x, y, z, p);

function texOf(image) {
  const t = new THREE.Texture(image);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}
function canvasTex(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
/** A screen face that lights itself (devices, signs). */
const screenMat = (tex, k = 1) => new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(k, k, k) });

/** A tripod of three legs meeting at height h, spread r at the floor. */
function tripod(g, h, r, mat = M.black, x = 0, z = 0) {
  for (let k = 0; k < 3; k++) {
    const ang = (k / 3) * Math.PI * 2 + 0.5;
    const fx = x + Math.cos(ang) * r;
    const fz = z + Math.sin(ang) * r;
    const len = Math.hypot(r, h);
    const leg = cyl(0.018, 0.018, len, mat, (fx + x) / 2, h / 2, (fz + z) / 2, g, 10);
    leg.lookAt(x, h, z);
    leg.rotateX(Math.PI / 2);
  }
  cyl(0.03, 0.03, 0.12, mat, x, h + 0.04, z, g, 12);
}

/** A phone: rounded body, a lit screen with `tex`, a camera bump on the back. */
function phone(g, w, h, tex, backMat = M.black) {
  const body = rbox(w, h, w * 0.09, w * 0.08, backMat, 0, 0, 0, g);
  const scr = mesh(new THREE.PlaneGeometry(w * 0.9, h * 0.94), screenMat(tex, 0.95), 0, 0, w * 0.046, g);
  scr.castShadow = false;
  rbox(w * 0.34, w * 0.34, w * 0.03, w * 0.06, backMat, -w * 0.22, h * 0.36, -w * 0.06, g);
  return body;
}

// ---------------------------------------------------------------------------
const BUILD = [
  // 01 Templates: an easel holding a finished store screenshot
  (g, A) => {
    for (const s of [-1, 1]) {
      const leg = box(0.05, 1.72, 0.05, M.wood, s * 0.3, 0.84, 0.1, g);
      leg.rotation.z = s * 0.1;
      leg.rotation.x = -0.08;
    }
    const back = box(0.05, 1.62, 0.05, M.wood, 0, 0.78, -0.36, g);
    back.rotation.x = 0.28;
    box(0.74, 0.05, 0.08, M.wood, 0, 0.66, 0.15, g);
    const board = rbox(0.5, 1.06, 0.03, 0.01, M.white, 0, 1.2, 0.13, g);
    board.rotation.x = -0.08;
    const art = mesh(new THREE.PlaneGeometry(0.46, 1.0), new THREE.MeshStandardMaterial({ map: texOf(A.setEn[0]), roughness: 0.5, emissive: 0xffffff, emissiveMap: texOf(A.setEn[0]), emissiveIntensity: 0.25 }), 0, 1.2, 0.147, g);
    art.rotation.x = -0.08;
    return () => {};
  },
  // 02 Your screenshots: an oversized phone on a tripod, showing a plain screenshot
  (g, A) => {
    tripod(g, 0.72, 0.36);
    const ph = new THREE.Group();
    ph.position.set(0, 1.22, 0.02);
    ph.rotation.x = -0.06;
    g.add(ph);
    phone(ph, 0.4, 0.86, texOf(A.raw[0]), M.black);
    cyl(0.022, 0.022, 0.12, M.black, 0, 0.78, 0, g, 10);
    return () => {};
  },
  // 03 Edit anything: a step ladder with paint cans and a roller
  (g) => {
    for (const s of [-1, 1]) {
      const f = box(0.05, 1.52, 0.07, M.wood, s * 0.32, 0.74, 0.16, g);
      f.rotation.x = -0.16;
      const b = box(0.05, 1.48, 0.06, M.wood, s * 0.32, 0.72, -0.32, g);
      b.rotation.x = 0.2;
    }
    for (let k = 0; k < 4; k++) box(0.68, 0.035, 0.16, M.wood, 0, 0.34 + k * 0.34, 0.22 - k * 0.06, g);
    const cans = [[0.17, 1.38, 0.04, 0x7a4fd0], [-0.16, 1.38, 0.03, 0xe8794b], [0.1, 1.04, 0.1, 0x2d6a4f]];
    for (const [x, y, z, c] of cans) {
      cyl(0.12, 0.12, 0.19, M.metal, x, y + 0.095, z, g, 28);
      const paint = cyl(0.11, 0.11, 0.012, std(c, 0.25), x, y + 0.195, z, g, 28);
      paint.castShadow = false;
      const handle = mesh(new THREE.TorusGeometry(0.11, 0.006, 6, 24, Math.PI), M.metal, x, y + 0.19, z, g);
      handle.rotation.y = 0.6;
    }
    const roller = new THREE.Group();
    roller.position.set(-0.2, 1.1, 0.14);
    roller.rotation.z = 0.5;
    g.add(roller);
    cyl(0.05, 0.05, 0.26, std(0x7a4fd0, 0.6), 0, 0, 0, roller).rotation.z = Math.PI / 2;
    cyl(0.012, 0.012, 0.34, M.black, 0.16, -0.16, 0, roller, 8);
    return () => {};
  },
  // 04 Your fonts: wood type blocks on a crate
  (g) => {
    box(0.9, 0.78, 0.55, M.woodDark, 0, 0.39, 0, g);
    const glyph = (ch, cssFont) =>
      canvasTex(256, 256, (c) => {
        c.fillStyle = "#c8a97a";
        c.fillRect(0, 0, 256, 256);
        c.fillStyle = "#3a2516";
        c.font = cssFont;
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText(ch, 128, 138);
      });
    const blocks = [
      [-0.22, 0.96, 0.05, 0.36, "A", '400 210px "Instrument Serif"', 0.1],
      [0.2, 0.91, 0.08, 0.26, "g", '700 190px "Space Grotesk"', -0.2],
      [0.02, 1.32, 0.02, 0.3, "a", '700 180px "JetBrains Mono"', 0.25],
    ];
    for (const [x, y, z, s, ch, cssFont, ry] of blocks) {
      const t = glyph(ch, cssFont);
      const side = std(0xb89464, 0.7);
      const mats = [side, side, side, side, new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }), side];
      const m = mesh(new THREE.BoxGeometry(s, s, s), mats, x, y, z, g);
      m.rotation.y = ry;
    }
    return () => {};
  },
  // 05 3D phones: a phone turning on a turntable
  (g, A) => {
    cyl(0.3, 0.34, 0.74, M.black, 0, 0.37, 0, g, 40);
    cyl(0.34, 0.34, 0.04, M.satin, 0, 0.76, 0, g, 48);
    const spin = new THREE.Group();
    spin.position.set(0, 0.78, 0);
    g.add(spin);
    const ph = new THREE.Group();
    ph.position.y = 0.36;
    spin.add(ph);
    phone(ph, 0.33, 0.7, texOf(A.raw[1]), std(0x6b1d2a, 0.3, 0.6));
    return (t, lt) => {
      spin.rotation.y = -0.5 + 0.8 * Math.sin(lt * 1.3);
    };
  },
  // 06 One picture: a camera on a slider rail, gliding along it
  (g) => {
    for (const s of [-1, 1]) tripod(g, 0.95, 0.3, M.black, s * 0.62, 0);
    box(1.5, 0.05, 0.12, M.metal, 0, 1.06, 0, g);
    const cart = new THREE.Group();
    cart.position.y = 1.1;
    g.add(cart);
    box(0.18, 0.04, 0.16, M.black, 0, 0, 0, cart);
    rbox(0.26, 0.18, 0.14, 0.02, M.black, 0, 0.13, 0, cart);
    cyl(0.06, 0.07, 0.14, M.black, 0, 0.13, -0.13, cart, 24).rotation.x = Math.PI / 2;
    const lens = mesh(new THREE.CircleGeometry(0.05, 24), glow(0.4, 0.6, 0.9), 0, 0.13, -0.205, cart);
    lens.rotation.y = Math.PI;
    return (t, lt) => {
      cart.position.x = -0.55 + 1.1 * (0.5 - 0.5 * Math.cos(Math.min(Math.max((lt + 0.6) / 1.8, 0), 1) * Math.PI));
    };
  },
  // 07 Picture library: 3D objects on plinths
  (g) => {
    const items = [
      [-0.5, 0.82, std(0xff6fae, 0.18, 0.1), new THREE.TorusGeometry(0.15, 0.06, 24, 48)],
      [0, 1.0, std(0x5ec8ff, 0.12, 0.2), new THREE.SphereGeometry(0.17, 40, 24)],
      [0.5, 0.9, std(0xf5b83d, 0.2, 0.1), new THREE.RoundedBoxGeometry(0.26, 0.26, 0.26, 4, 0.04)],
    ];
    const objs = [];
    for (const [x, h, mat, geo] of items) {
      box(0.36, h, 0.36, M.white, x, h / 2, 0, g);
      objs.push(mesh(geo, mat, x, h + 0.24, 0, g));
    }
    return (t) => {
      objs[0].rotation.set(0.5 + t * 0.6, t * 0.9, 0);
      objs[2].rotation.set(t * 0.5, t * 0.7, 0.3);
    };
  },
  // 08 Community: a row of cinema seats on a riser
  (g) => {
    box(1.9, 0.26, 0.9, M.black, 0, 0.13, 0, g);
    for (const x of [-0.58, 0, 0.58]) {
      const seat = new THREE.Group();
      seat.position.set(x, 0.26, 0);
      g.add(seat);
      rbox(0.48, 0.12, 0.46, 0.04, M.red, 0, 0.42, 0.06, seat);
      rbox(0.48, 0.7, 0.12, 0.05, M.red, 0, 0.82, -0.18, seat);
      for (const s of [-1, 1]) box(0.06, 0.5, 0.5, M.black, s * 0.27, 0.3, 0, seat);
    }
    return () => {};
  },
  // 09 57 languages: a globe on a stand
  (g) => {
    const tex = canvasTex(1024, 512, (c, w, h) => {
      c.fillStyle = "#1f5f8b";
      c.fillRect(0, 0, w, h);
      const blobs = [[180, 170, 120, 80], [260, 300, 60, 110], [520, 150, 150, 70], [560, 300, 70, 100], [780, 180, 140, 90], [860, 360, 70, 50], [430, 420, 160, 30]];
      c.fillStyle = "#e8d9b5";
      for (const [x, y, rx, ry] of blobs) {
        c.beginPath();
        c.ellipse(x, y, rx, ry, 0.3, 0, Math.PI * 2);
        c.fill();
      }
      c.strokeStyle = "rgba(255,255,255,0.35)";
      c.lineWidth = 2;
      for (let i = 1; i < 12; i++) {
        c.beginPath();
        c.moveTo((i * w) / 12, 0);
        c.lineTo((i * w) / 12, h);
        c.stroke();
      }
      for (let j = 1; j < 6; j++) {
        c.beginPath();
        c.moveTo(0, (j * h) / 6);
        c.lineTo(w, (j * h) / 6);
        c.stroke();
      }
    });
    cyl(0.22, 0.28, 0.06, M.woodDark, 0, 0.03, 0, g, 32);
    cyl(0.03, 0.03, 0.86, M.metal, 0, 0.46, 0, g, 12);
    const tilt = new THREE.Group();
    tilt.position.y = 1.16;
    tilt.rotation.z = 0.41;
    g.add(tilt);
    const globe = mesh(new THREE.SphereGeometry(0.31, 48, 32), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35 }), 0, 0, 0, tilt);
    const ring = mesh(new THREE.TorusGeometry(0.35, 0.012, 8, 64), M.metal, 0, 0, 0, tilt);
    ring.rotation.y = Math.PI / 2;
    return (t) => {
      globe.rotation.y = t * 0.8;
    };
  },
  // 10 Every device: a standing desk with a laptop, an iPad and a phone
  (g, A) => {
    box(1.7, 0.05, 0.75, M.wood, 0, 0.86, 0, g);
    for (const s of [-1, 1]) box(0.06, 0.86, 0.6, M.black, s * 0.78, 0.43, 0, g);
    box(0.62, 0.02, 0.42, M.metal, -0.36, 0.895, 0.05, g);
    const lid = new THREE.Group();
    lid.position.set(-0.36, 0.905, -0.16);
    lid.rotation.x = -0.18;
    g.add(lid);
    box(0.62, 0.4, 0.015, M.metal, 0, 0.2, 0, lid);
    mesh(new THREE.PlaneGeometry(0.57, 0.35), screenMat(texOf(A.setEn[3]), 0.95), 0, 0.2, 0.009, lid).castShadow = false;
    const pad = new THREE.Group();
    pad.position.set(0.28, 1.14, -0.05);
    pad.rotation.x = -0.2;
    g.add(pad);
    phone(pad, 0.34, 0.46, texOf(A.setEn[1]), M.metal);
    box(0.04, 0.28, 0.04, M.black, 0.28, 1.0, -0.12, g);
    const ph = new THREE.Group();
    ph.position.set(0.66, 1.03, 0.05);
    ph.rotation.x = -0.25;
    g.add(ph);
    phone(ph, 0.12, 0.26, texOf(A.setEn[2]), M.black);
    return () => {};
  },
  // 11 Preview videos: a film camera on a tripod, its reels turning
  (g) => {
    tripod(g, 0.9, 0.42);
    const cam = new THREE.Group();
    cam.position.set(0, 1.12, 0);
    g.add(cam);
    rbox(0.3, 0.32, 0.5, 0.03, M.black, 0, 0, 0, cam);
    cyl(0.085, 0.1, 0.22, M.black, 0, 0, -0.34, cam, 28).rotation.x = Math.PI / 2;
    const reels = [];
    for (const z of [-0.13, 0.19]) {
      const r = new THREE.Group();
      r.position.set(0, 0.33, z);
      cam.add(r);
      const disc = cyl(0.19, 0.19, 0.05, M.metal, 0, 0, 0, r, 40);
      disc.rotation.z = Math.PI / 2;
      for (let k = 0; k < 3; k++) {
        const hole = cyl(0.042, 0.042, 0.06, M.black, 0, Math.cos((k * 2 * Math.PI) / 3) * 0.095, Math.sin((k * 2 * Math.PI) / 3) * 0.095, r, 16);
        hole.rotation.z = Math.PI / 2;
      }
      reels.push(r);
    }
    return (t) => {
      for (const r of reels) r.rotation.x = -t * 2.4;
    };
  },
  // 12 Capture: a phone on a tripod in front of a ring light
  (g, A) => {
    tripod(g, 0.82, 0.38);
    cyl(0.02, 0.02, 0.4, M.black, 0, 1.0, -0.06, g, 10);
    const ringLight = mesh(new THREE.TorusGeometry(0.32, 0.035, 16, 80), glow(1.18, 1.12, 1.04), 0, 1.24, -0.12, g);
    ringLight.castShadow = false;
    const ph = new THREE.Group();
    ph.position.set(0, 1.24, 0.02);
    g.add(ph);
    phone(ph, 0.19, 0.4, texOf(A.setEn[4]), M.black);
    return () => {};
  },
  // 13 AI agent: a friendly box robot, blinking
  (g) => {
    const body = std(0xb4aea4, 0.62);
    const accent = std(0xff9f43, 0.45);
    rbox(0.46, 0.52, 0.36, 0.05, body, 0, 0.82, 0, g);
    for (const s of [-1, 1]) {
      rbox(0.13, 0.56, 0.13, 0.04, body, s * 0.14, 0.28, 0, g);
      const arm = rbox(0.09, 0.38, 0.09, 0.04, accent, s * 0.3, 0.84, 0.02, g);
      arm.rotation.z = s * 0.25;
    }
    rbox(0.54, 0.42, 0.4, 0.06, body, 0, 1.3, 0, g);
    rbox(0.44, 0.29, 0.02, 0.04, M.black, 0, 1.3, 0.2, g).castShadow = false;
    const eyeGeo = new THREE.CircleGeometry(0.042, 24);
    const eyeMat = glow(1.2, 3.0, 2.0);
    const eyes = [-1, 1].map((s) => mesh(eyeGeo, eyeMat, s * 0.1, 1.32, 0.212, g));
    cyl(0.012, 0.012, 0.16, M.metal, 0, 1.59, 0, g, 8);
    mesh(new THREE.SphereGeometry(0.032, 16, 12), glow(3.2, 1.4, 0.4), 0, 1.69, 0, g);
    return (t) => {
      const blink = t % 2.3 < 0.09 ? 0.15 : 1;
      for (const e of eyes) e.scale.y = blink;
    };
  },
  // 14 CLI: a terminal on a cart
  (g) => {
    box(0.9, 0.05, 0.6, M.metal, 0, 0.8, 0, g);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(0.02, 0.02, 0.8, M.metal, sx * 0.4, 0.4, sz * 0.26, g, 8);
    rbox(0.66, 0.54, 0.5, 0.05, M.cream, 0, 1.1, -0.02, g);
    const scr = canvasTex(512, 384, (c, w, h) => {
      c.fillStyle = "#06140c";
      c.fillRect(0, 0, w, h);
      c.fillStyle = "#39d98a";
      c.font = '700 30px "JetBrains Mono"';
      c.fillText("$ npx open-", 26, 70);
      c.fillText("  screenshot-", 26, 112);
      c.fillText("  generator", 26, 154);
      c.fillText("ok 5 files", 26, 220);
      c.fillRect(26, 250, 18, 30);
    });
    mesh(new THREE.PlaneGeometry(0.5, 0.38), screenMat(scr, 1.0), 0, 1.12, 0.235, g).castShadow = false;
    rbox(0.56, 0.035, 0.2, 0.01, M.cream, 0, 0.84, 0.17, g).rotation.x = 0.1;
    return () => {};
  },
  // 15 Store listing: a lit Get sign on a pole
  (prop) => {
    // to the right of centre and low, so the screenshot row the screen swipes stays in view
    const g = new THREE.Group();
    g.position.set(0.62, -0.2, 0);
    prop.add(g);
    cyl(0.25, 0.3, 0.05, M.black, 0, 0.225, 0, g, 32);
    cyl(0.025, 0.025, 1.12, M.metal, 0, 0.78, 0, g, 12);
    const sign = canvasTex(512, 256, (c, w, h) => {
      c.fillStyle = "#0a84ff";
      c.beginPath();
      c.roundRect(8, 8, w - 16, h - 16, (h - 16) / 2);
      c.fill();
      c.fillStyle = "#ffffff";
      c.font = '700 150px "Inter"';
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText("Get", w / 2, h / 2 + 8);
    });
    rbox(0.8, 0.42, 0.08, 0.2, std(0x0a5fc4, 0.4), 0, 1.32, 0, g);
    mesh(new THREE.PlaneGeometry(0.78, 0.39), screenMat(sign, 1.1), 0, 1.32, 0.042, g).castShadow = false;
    return () => {};
  },
  // 16 Every size: shipping boxes stacked, each labelled with a store size
  (g) => {
    const label = (text) =>
      canvasTex(512, 256, (c, w, h) => {
        c.fillStyle = "#c49662";
        c.fillRect(0, 0, w, h);
        c.fillStyle = "#f3ead8";
        c.fillRect(40, 60, w - 80, h - 120);
        c.fillStyle = "#2a1d12";
        c.font = '700 64px "JetBrains Mono"';
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText(text, w / 2, h / 2 + 4);
      });
    const boxes = [
      [0, 0.3, 0, 1.0, 0.6, 0.6, "2064×2752", 0.0],
      [-0.12, 0.86, 0.02, 0.8, 0.52, 0.5, "1290×2796", 0.08],
      [0.1, 1.32, 0.04, 0.6, 0.4, 0.42, "1206×2622", -0.1],
      [0.62, 0.22, 0.12, 0.46, 0.44, 0.4, "1080×1920", 0.3],
    ];
    for (const [x, y, z, w, h, d, txt, ry] of boxes) {
      const side = M.card;
      const front = new THREE.MeshStandardMaterial({ map: label(txt), roughness: 0.85 });
      const m = mesh(new THREE.BoxGeometry(w, h, d), [side, side, side, side, front, side], x, y, z, g);
      m.rotation.y = ry;
      box(w * 0.18, 0.004, d + 0.002, std(0xd9c08f, 0.4), x, y + h / 2 + 0.002, z, g).rotation.y = ry;
    }
    return () => {};
  },
];

export function buildProps(scene, A) {
  return BUILD.map((build, i) => {
    const g = new THREE.Group();
    g.position.set(...polar(PROP_R, a(i), 0));
    g.rotation.y = a(i) + Math.PI;
    scene.add(g);
    const update = build(g, A) || (() => {});
    // a soft contact shadow so every prop sits on the floor
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.75, 32),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.004;
    g.add(blob);
    return { group: g, update: (t) => update(t, t - landAt(i)) };
  });
}

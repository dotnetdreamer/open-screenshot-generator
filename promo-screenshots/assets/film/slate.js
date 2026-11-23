// The clapperboard in the middle of the stage. Its face is the end card: the
// title, the sixteen features in two columns, and the production line. The
// list writes on as the camera comes in and the sticks close on the clap.
import * as THREE from "../vendor/three.bundle.js";
import { FEATURES, SLATE as COPY } from "./copy.js";
import { SLATE } from "./world.js";
import { SHOT } from "./timing.js";
import { F, font, text, measure, clamp, outCubic, ramp } from "./kit.js";

const FW = 1536;
const FH = Math.round((FW * SLATE.h) / SLATE.w); // 1637
const CREAM = "#EFE6D6";
const GOLD = "#E9B872";

function stripes(w, h, phase = 0) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d");
  x.fillStyle = "#16130F";
  x.fillRect(0, 0, w, h);
  x.fillStyle = "#E9DFCB";
  const sw = h * 1.05;
  for (let s = -h * 2 + phase; s < w + h; s += sw * 2) {
    x.beginPath();
    x.moveTo(s, h);
    x.lineTo(s + sw, h);
    x.lineTo(s + sw + h * 0.9, 0);
    x.lineTo(s + h * 0.9, 0);
    x.closePath();
    x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function drawFace(ctx, p) {
  // p: 0 blank slate .. 1 everything written.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, FH);
  g.addColorStop(0, "#1E1A17");
  g.addColorStop(1, "#141210");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, FW, FH);
  // chalk dust
  ctx.globalAlpha = 0.05;
  for (let k = 0; k < 900; k++) {
    const r = Math.sin(k * 91.7) * 43758.5453;
    const rx = (r - Math.floor(r)) * FW;
    const r2 = Math.sin(k * 17.3 + 3.1) * 24634.6345;
    const ry = (r2 - Math.floor(r2)) * FH;
    ctx.fillStyle = "#fff";
    ctx.fillRect(rx, ry, 2, 2);
  }
  ctx.globalAlpha = 1;
  // the cream inset line
  const m = 30;
  ctx.strokeStyle = "rgba(239,230,214,0.75)";
  ctx.lineWidth = 3;
  ctx.strokeRect(m, m, FW - 2 * m, FH - 2 * m);

  const a = (from, dur = 0.16) => clamp((p - from) / dur);

  // title: "16 features. One take."
  const tA = a(0.0, 0.2);
  const tf = font(400, 118, F.serif);
  const tfi = font(400, 118, F.serif, "italic");
  const w1 = measure(ctx, COPY.count + " ", tf);
  const w2 = measure(ctx, COPY.accent, tfi);
  const tx = (FW - w1 - w2) / 2;
  text(ctx, COPY.count, tx, 186, tf, CREAM, "left", tA);
  text(ctx, COPY.accent, tx + w1, 186, tfi, GOLD, "left", tA);
  // rule under the title, drawn across
  ctx.fillStyle = "rgba(239,230,214,0.75)";
  ctx.fillRect(m, 248, (FW - 2 * m) * outCubic(a(0.05, 0.25)), 3);

  // two columns of eight, numbers in gold mono, names, short lines
  const colX = [m + 70, FW / 2 + 52];
  const top = 330;
  const step = (FH - 250 - top) / 8;
  ctx.fillStyle = "rgba(239,230,214,0.5)";
  ctx.fillRect(FW / 2 - 6, 272, 3, (FH - 210 - 272) * outCubic(a(0.1, 0.4)));
  FEATURES.forEach((f, i) => {
    const col = i < 8 ? 0 : 1;
    const row = i % 8;
    const al = a(0.14 + i * 0.045, 0.14);
    if (al <= 0) return;
    const x = colX[col];
    const y = top + row * step;
    text(ctx, String(i + 1).padStart(2, "0"), x, y + 14, font(700, 27, F.mono), GOLD, "left", al);
    text(ctx, f.name, x + 56, y + 22, font(700, 52, F.head), "#F6F1E8", "left", al);
    text(ctx, f.short, x + 56, y + 64, font(500, 31, F.body), "#B8B0A4", "left", al);
  });

  // production line along the bottom, like a real slate
  const pA = a(0.8, 0.2);
  ctx.fillStyle = "rgba(239,230,214,0.75)";
  ctx.fillRect(m, FH - 190, FW - 2 * m, 3);
  text(ctx, "PROD.", m + 40, FH - 112, font(700, 30, F.mono), "rgba(239,230,214,0.6)", "left", pA);
  text(ctx, COPY.prod, m + 160, FH - 108, font(700, 50, F.head), CREAM, "left", pA);
  text(ctx, COPY.take, FW - m - 40, FH - 110, font(700, 40, F.mono), GOLD, "right", pA);
}

export function buildSlate(scene, facing) {
  const group = new THREE.Group();
  group.position.set(0, 0, 0);
  group.rotation.y = facing;
  scene.add(group);

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1a1714, roughness: 0.6, metalness: 0.1 });
  const body = new THREE.Mesh(new THREE.RoundedBoxGeometry(SLATE.w + 0.04, SLATE.h + 0.04, 0.05, 3, 0.012), bodyMat);
  body.position.y = SLATE.y;
  body.castShadow = true;
  group.add(body);

  const canvas = document.createElement("canvas");
  canvas.width = FW;
  canvas.height = FH;
  const ctx = canvas.getContext("2d");
  const faceTex = new THREE.CanvasTexture(canvas);
  faceTex.colorSpace = THREE.SRGBColorSpace;
  faceTex.anisotropy = 8;
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(SLATE.w, SLATE.h),
    new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.9, metalness: 0, emissive: 0xffffff, emissiveMap: faceTex, emissiveIntensity: 0.42 }),
  );
  face.position.set(0, SLATE.y, 0.027);
  group.add(face);

  // the sticks: the lower one fixed, the upper one hinged at its left end
  const stickH = SLATE.clap / 2;
  const stickGeo = new THREE.BoxGeometry(SLATE.w + 0.04, stickH - 0.006, 0.05);
  const stickTex = stripes(1024, 80);
  const stickMat = [
    bodyMat, bodyMat, bodyMat, bodyMat,
    new THREE.MeshStandardMaterial({ map: stickTex, roughness: 0.5 }),
    bodyMat,
  ];
  const lower = new THREE.Mesh(stickGeo, stickMat);
  lower.position.y = SLATE.y + SLATE.h / 2 + 0.02 + stickH / 2;
  lower.castShadow = true;
  group.add(lower);
  const hinge = new THREE.Group();
  hinge.position.set(-(SLATE.w + 0.04) / 2, SLATE.y + SLATE.h / 2 + 0.02 + stickH, 0);
  group.add(hinge);
  const upperTex = stripes(1024, 80, 40);
  const upper = new THREE.Mesh(stickGeo, [
    bodyMat, bodyMat, bodyMat, bodyMat,
    new THREE.MeshStandardMaterial({ map: upperTex, roughness: 0.5 }),
    bodyMat,
  ]);
  upper.position.set((SLATE.w + 0.04) / 2, stickH / 2 + 0.003, 0);
  upper.castShadow = true;
  hinge.add(upper);
  const pin = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, 0.07, 20),
    new THREE.MeshStandardMaterial({ color: 0x8c8172, roughness: 0.3, metalness: 0.9 }),
  );
  pin.rotation.x = Math.PI / 2;
  pin.position.copy(hinge.position);
  group.add(pin);

  // the stand: two posts and feet
  const postMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.35, metalness: 0.8 });
  const bottom = SLATE.y - SLATE.h / 2;
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, bottom + 0.05, 12), postMat);
    post.position.set(s * SLATE.w * 0.36, (bottom + 0.05) / 2, -0.04);
    post.castShadow = true;
    group.add(post);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.7), postMat);
    foot.position.set(s * SLATE.w * 0.36, 0.13, -0.04);
    group.add(foot);
  }

  let drawnP = -1;
  return {
    group,
    update(t) {
      // the list writes on over the push and is whole just before the clap
      const p = clamp((t - (SHOT.CLAP - 1.45)) / 1.25);
      const q = Math.round(p * 200) / 200;
      if (q !== drawnP) {
        drawnP = q;
        drawFace(ctx, q);
        faceTex.needsUpdate = true;
      }
      // sticks: open on the approach, shut on the clap
      const open = 0.5 * ramp(t, SHOT.CLAP - 1.9, 0.5, outCubic);
      const shut = clamp((t - (SHOT.CLAP - 5 / 60)) / (5 / 60));
      hinge.rotation.z = open * (1 - shut * shut);
    },
  };
}

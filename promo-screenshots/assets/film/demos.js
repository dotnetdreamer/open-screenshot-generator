// The live demo on each screen: DEMOS[i](ctx, lt, A, box, f) draws screen i's
// demo area at lt seconds after the camera lands on it (lt runs -1 to 3; the
// camera arrives over lt -0.75..0 and leaves from lt ~0.85). Every demo plays
// its one action inside the hold and then holds still. Pictures are the app's
// own (shots.js); drawn parts are only the cursor, ticks and highlights.
import {
  clamp, mix, ramp, keys, outExpo, outCubic, outQuint, outBack, inOutCubic, inOutSine, inCubic,
  rr, fillRR, strokeRR, img, text, measure, pill, check, checkBadge, cursor, clickRing, font, F, rgba,
} from "./kit.js";

const TEAL = "#6FB3B5";
const INK = "#F4F2ED";
const SUB = "#A7ADB4";
const PANEL = "#15181D";
const LINE = "rgba(255,255,255,0.08)";

function panel(ctx, x, y, w, h, r = 26, fill = PANEL) {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 12;
  fillRR(ctx, x, y, w, h, r, fill);
  ctx.restore();
  strokeRR(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r, LINE, 1.5);
}

/** Draw `draw()` scaled by s and faded by a around (cx, cy). */
function around(ctx, cx, cy, s, a, draw, rot = 0) {
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha *= clamp(a);
  ctx.translate(cx, cy);
  if (rot) ctx.rotate(rot);
  ctx.scale(s, s);
  ctx.translate(-cx, -cy);
  draw();
  ctx.restore();
}

function shadowed(ctx, blur, dy, fn, color = "rgba(0,0,0,0.55)") {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetY = dy;
  fn();
  ctx.restore();
}

/** A cursor that glides between key positions [[t, x, y], ...] and clicks at the times in `clicks`. */
function cursorPath(ctx, lt, path, clicks = [], scale = 1.15) {
  if (lt < path[0][0] - 0.25) return;
  const pos = keys(lt, path.map(([t, x, y]) => [t, [x, y]]), inOutCubic);
  let press = 0;
  for (const c of clicks) {
    const d = lt - c;
    if (d > -0.06 && d < 0.14) press = Math.max(press, 1 - Math.abs(d - 0.02) / 0.12);
    clickRing(ctx, pos[0], pos[1], clamp((lt - c) / 0.4), "rgba(255,255,255,0.9)");
  }
  const appear = clamp((lt - (path[0][0] - 0.25)) / 0.2);
  ctx.save();
  ctx.globalAlpha *= appear;
  cursor(ctx, pos[0], pos[1], scale, clamp(press));
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 01 Templates: a fast run down real template sets, settling on one, which is picked
// ---------------------------------------------------------------------------
const PICK = 7; // droply-habits, the template the Juniper set was made from
function templates(ctx, lt, A, b) {
  const sw = b.w;
  const sh = (sw * 366) / 1100;
  const gap = 22;
  const step = sh + gap;
  const centreOff = b.h * 0.4 - sh / 2;
  const target = PICK * step - centreOff;
  const scroll = keys(lt, [[-0.9, target - 5.6 * step], [1.0, target]], outExpo);
  const pick = ramp(lt, 1.0, 0.35, outBack);
  ctx.save();
  rr(ctx, b.x, b.y, b.w, b.h, 28);
  ctx.clip();
  A.wall.forEach((im, k) => {
    const y = b.y + k * step - scroll;
    if (y > b.y + b.h || y + sh < b.y) return;
    const isPick = k === PICK;
    const s = isPick ? 1 + 0.035 * pick : 1 - 0.02 * pick;
    const a = isPick ? 1 : 1 - 0.45 * pick;
    around(ctx, b.x + sw / 2, y + sh / 2, s, a, () => {
      img(ctx, im, null, [b.x, y, sw, sh], 22);
      if (isPick && pick > 0) {
        ctx.save();
        ctx.shadowColor = rgba(TEAL, 0.9);
        ctx.shadowBlur = 26 * pick;
        strokeRR(ctx, b.x + 3, y + 3, sw - 6, sh - 6, 21, TEAL, 7 * clamp(pick));
        ctx.restore();
      }
    });
  });
  ctx.restore();
  // soft fade at the bottom where the prop stands
  const g = ctx.createLinearGradient(0, b.y + b.h - 160, 0, b.y + b.h);
  g.addColorStop(0, "rgba(12,13,16,0)");
  g.addColorStop(1, "rgba(12,13,16,0.92)");
  ctx.fillStyle = g;
  ctx.fillRect(b.x, b.y + b.h - 160, b.w, 160);
  cursorPath(ctx, lt, [[0.7, b.x + b.w * 0.82, b.y + b.h * 0.78], [1.0, b.x + b.w * 0.62, b.y + centreOff + sh * 0.6]], [1.02]);
}

// ---------------------------------------------------------------------------
// 02 Your screenshots: three plain screenshots dropped in become three store screenshots
// ---------------------------------------------------------------------------
function yourShots(ctx, lt, A, b) {
  const gap = 30;
  const bw = (b.w - gap * 2) / 3;
  const bh = (bw * 956) / 440;
  const y0 = b.y + 16;
  // the drop target the start panel shows ("Drop your screenshots")
  const hint = 1 - ramp(lt, -0.35, 0.3);
  if (hint > 0) {
    ctx.save();
    ctx.globalAlpha = hint;
    ctx.setLineDash([18, 14]);
    strokeRR(ctx, b.x + 6, y0, b.w - 12, bh, 30, rgba(TEAL, 0.8), 4);
    ctx.setLineDash([]);
    text(ctx, "Drop your screenshots", b.x + b.w / 2, y0 + bh / 2 + 14, font(600, 44), rgba(TEAL, 0.95), "center");
    ctx.restore();
  }
  for (let i = 0; i < 3; i++) {
    const x = b.x + i * (bw + gap);
    const arrive = ramp(lt, -0.75 + i * 0.09, 0.5, outBack);
    const morph = ramp(lt, 0.12 + i * 0.1, 0.42, inOutCubic);
    // the store screenshot grows in behind the shot it is made from
    around(ctx, x + bw / 2, y0 + bh / 2, 0.86 + 0.14 * outBack(morph, 1.2), morph, () => {
      shadowed(ctx, 30, 12, () => img(ctx, A.setEn[i], null, [x, y0, bw, bh], 20));
    });
    const rw = bw * 0.8;
    const rh = (rw * 914) / 420;
    const ry = y0 + (bh - rh) / 2 - (1 - arrive) * 520;
    const rot = (1 - arrive) * (i - 1) * 0.35 + (i - 1) * 0.04 * (1 - morph);
    around(ctx, x + bw / 2, ry + rh / 2, 1 - 0.35 * morph, (arrive > 0 ? 1 : 0) * (1 - morph), () => {
      shadowed(ctx, 26, 14, () => img(ctx, A.raw[i], null, [x + (bw - rw) / 2, ry, rw, rh], 26));
      strokeRR(ctx, x + (bw - rw) / 2, ry, rw, rh, 26, "rgba(255,255,255,0.25)", 2);
    }, rot);
  }
}

// ---------------------------------------------------------------------------
// 03 Edit anything: click a colour in the real palette, the background changes
// ---------------------------------------------------------------------------
const recolorCache = new Map();
function recolored(A, color) {
  if (recolorCache.has(color)) return recolorCache.get(color);
  const im = A.editKeyed;
  const c = document.createElement("canvas");
  c.width = im.width;
  c.height = im.height;
  const x = c.getContext("2d");
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = "destination-out";
  x.drawImage(im, 0, 0); // removes the colour wherever the board is not background
  recolorCache.set(color, c);
  return c;
}
let paletteColors = null;
function sampleSwatches(A) {
  if (paletteColors) return paletteColors;
  const im = A.palette;
  const c = document.createElement("canvas");
  c.width = im.width;
  c.height = im.height;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(im, 0, 0);
  const at = (px, py) => {
    const d = x.getImageData(px, py, 1, 1).data;
    return `rgb(${d[0]},${d[1]},${d[2]})`;
  };
  // swatch centres in the 560 x 340 crop: columns and rows of the Color Palette grid
  const XS = [53, 163, 273, 382, 492];
  const YS = [83, 157, 229, 301];
  paletteColors = { violet: at(XS[4], YS[0]), coral: at(XS[0], YS[0]), pos: (cx, cy) => [XS[cx], YS[cy]] };
  return paletteColors;
}
function editAnything(ctx, lt, A, b) {
  const sw = sampleSwatches(A);
  const bw = 360;
  const bh = (bw * 1304) / 600;
  const bx = b.x + 18;
  const by = b.y + 4;
  shadowed(ctx, 34, 14, () => img(ctx, A.editB1, null, [bx, by, bw, bh], 18));
  const c1 = -0.05;
  const c2 = 0.5;
  const p1 = ramp(lt, c1 + 0.04, 0.32, inOutCubic);
  const p2 = ramp(lt, c2 + 0.04, 0.32, inOutCubic);
  for (const [p, col] of [[p1, sw.violet], [p2, sw.coral]]) {
    if (p <= 0) continue;
    ctx.save();
    rr(ctx, bx, by, bw, bh, 18);
    ctx.clip();
    ctx.beginPath();
    ctx.rect(bx, by, bw, bh * p);
    ctx.clip();
    ctx.drawImage(recolored(A, col), bx, by, bw, bh);
    ctx.restore();
  }
  // the real Color Palette, under its panel label
  const px = b.x + 430;
  const py = b.y + 70;
  const pw = 478;
  const ph = (pw * 340) / 560;
  text(ctx, "Artboard Background", px, py - 22, font(600, 34), INK);
  panel(ctx, px - 14, py, pw + 28, ph + 28, 22, "#121418");
  img(ctx, A.palette, null, [px, py + 14, pw, ph], 12);
  // Background Color field with the current hex
  const cur = p2 > 0.5 ? sw.coral : p1 > 0.5 ? sw.violet : "rgb(45,106,79)";
  const hex = "#" + cur.match(/\d+/g).map((n) => Number(n).toString(16).padStart(2, "0")).join("").toUpperCase();
  const fy = py + ph + 80;
  text(ctx, "Background Color", px, fy - 18, font(600, 28), SUB);
  fillRR(ctx, px - 14, fy, pw + 28, 76, 16, "#0E1013");
  strokeRR(ctx, px - 14, fy, pw + 28, 76, 16, LINE, 1.5);
  fillRR(ctx, px + 6, fy + 16, 44, 44, 8, cur);
  text(ctx, hex, px + 70, fy + 50, font(500, 32, F.mono), INK);
  const k = pw / 560;
  const [vx, vy] = sw.pos(4, 0);
  const [cx0, cy0] = sw.pos(0, 0);
  cursorPath(ctx, lt, [[-0.55, px + 360, py + ph + 180], [c1, px + vx * k + 8, py + 14 + vy * k + 8], [0.3, px + vx * k + 8, py + 14 + vy * k + 8], [c2, px + cx0 * k + 8, py + 14 + cy0 * k + 8]], [c1, c2]);
}

// ---------------------------------------------------------------------------
// 04 Your fonts: the same headline in one face after another
// ---------------------------------------------------------------------------
const FACES = [
  { name: "Space Grotesk", f: (s) => font(700, s, F.head) },
  { name: "Instrument Serif", f: (s) => font(400, s * 1.18, F.serif, "italic") },
  { name: "JetBrains Mono", f: (s) => font(700, s * 0.84, F.mono) },
  { name: "Inter", f: (s) => font(800, s * 0.96, F.body) },
];
const FACE_AT = [-0.4, 0.02, 0.36, 0.7];
function yourFonts(ctx, lt, A, b, f) {
  // the import button, pressed first
  const press = 0.12 * clamp(1 - Math.abs(lt + 0.48) / 0.1);
  around(ctx, b.x + 210, b.y + 40, 1 - press, 1, () => {
    pill(ctx, b.x + 24, b.y + 8, "Import font file", {
      font: font(600, 34), h: 66, fill: rgba(f.accent, 0.16), stroke: rgba(f.accent, 0.9), color: INK,
      icon: (c, x, y, s) => {
        c.save();
        c.strokeStyle = INK;
        c.lineWidth = 4;
        c.lineCap = "round";
        c.beginPath();
        c.moveTo(x, y + s * 0.45);
        c.lineTo(x, y - s * 0.45);
        c.moveTo(x - s * 0.32, y - s * 0.12);
        c.lineTo(x, y - s * 0.45);
        c.lineTo(x + s * 0.32, y - s * 0.12);
        c.stroke();
        c.restore();
      },
    });
  });
  // a store screenshot's headline card in Juniper green
  const cx = b.x;
  const cy = b.y + 120;
  const cw = b.w;
  const ch = 520;
  shadowed(ctx, 40, 16, () => fillRR(ctx, cx, cy, cw, ch, 30, "#2D6A4F"));
  let idx = 0;
  for (let k = 0; k < FACE_AT.length; k++) if (lt >= FACE_AT[k]) idx = k;
  const since = Math.max(0.2, lt - FACE_AT[idx]);
  // a quick blur swap: 0.05 s out, 0.08 s in, so each face reads sharp for most of its turn
  const swapIn = lt < FACE_AT[0] ? 1 : clamp((lt - FACE_AT[idx]) / 0.08);
  const nextIdx = idx + 1 < FACE_AT.length ? idx + 1 : -1;
  const out = nextIdx >= 0 ? clamp((lt - (FACE_AT[nextIdx] - 0.05)) / 0.05) : 0;
  const face = FACES[idx];
  ctx.save();
  ctx.filter = `blur(${(1 - swapIn) * 10 + out * 10}px)`;
  ctx.globalAlpha = Math.min(swapIn, 1 - out);
  text(ctx, "Build habits", cx + 64, cy + 210, face.f(122), "#F6F2E9");
  text(ctx, "that stick", cx + 64, cy + 350, face.f(122), "#F6F2E9");
  ctx.restore();
  // the face's name, in the accent
  text(ctx, "Aa", cx + 64, cy + ch - 44, face.f(52), rgba("#F6F2E9", 0.75));
  text(ctx, face.name, cx + 150, cy + ch - 50, font(500, 36, F.mono), "#CFEADB");
  // the list of faces, the active one ticked
  const ly = cy + ch + 70;
  FACES.forEach((fc, k) => {
    const x = b.x + 30 + (k % 2) * 450;
    const y = ly + Math.floor(k / 2) * 70;
    const on = k === idx;
    text(ctx, fc.name, x + 44, y, font(600, 34), on ? INK : SUB);
    if (on) checkBadge(ctx, x + 12, y - 12, 15, f.accent, clamp(since / 0.2));
    else {
      ctx.beginPath();
      ctx.arc(x + 12, y - 12, 13, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  });
  cursorPath(ctx, lt, [[-0.85, b.x + 520, b.y + 260], [-0.48, b.x + 260, b.y + 52], [-0.2, b.x + 300, b.y + 70]], [-0.48]);
}

// ---------------------------------------------------------------------------
// 05 3D phones: 3D Studio turning a real phone, and its other finishes
// ---------------------------------------------------------------------------
function phones3d(ctx, lt, A, b, f) {
  const fw = 470;
  const fh = (fw * 834) / 470;
  const fx = b.x + 8;
  const fy = b.y + 4;
  const k = Math.round(clamp((lt + 0.8) / 2.0) * 23);
  ctx.save();
  rr(ctx, fx, fy, fw, Math.min(fh, b.h - 10), 28);
  ctx.clip();
  ctx.fillStyle = "#0A1214";
  ctx.fillRect(fx, fy, fw, fh);
  ctx.drawImage(A.turn[k], fx, fy, fw, fh);
  ctx.restore();
  strokeRR(ctx, fx, fy, fw, Math.min(fh, b.h - 10), 28, LINE, 2);
  // the rotate handle's arc, sweeping as the phone turns
  ctx.save();
  ctx.strokeStyle = rgba(f.accent, 0.9);
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  const a0 = -Math.PI * 0.85;
  ctx.arc(fx + fw / 2, fy + fh * 0.55, fw * 0.46, a0, a0 + Math.PI * 0.7 * clamp((lt + 0.8) / 2.0));
  ctx.stroke();
  ctx.restore();
  // finishes and the Pixel, as 3D Studio renders them
  const names = ["Burgundy", "Forest", "Silver", "Pixel"];
  const tw = 196;
  const th = (tw * 364) / 260;
  A.finishes.forEach((im, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = b.x + 512 + col * (tw + 20);
    const y = b.y + 24 + row * (th + 74);
    const p = ramp(lt, -0.15 + i * 0.1, 0.4, outBack);
    around(ctx, x + tw / 2, y + th / 2, 0.7 + 0.3 * p, clamp(p * 1.5), () => {
      fillRR(ctx, x, y, tw, th, 20, "#0A1214");
      img(ctx, im, null, [x, y, tw, th], 20);
      strokeRR(ctx, x, y, tw, th, 20, LINE, 2);
      text(ctx, names[i], x + tw / 2, y + th + 42, font(600, 30), INK, "center");
    });
  });
  // the controls 3D Studio gives the phone
  const ctl = ["Angle", "Finish", "Perspective", "Light"];
  let x = b.x + 8;
  const y = Math.min(fy + fh + 26, b.y + b.h - 72);
  ctl.forEach((c, i) => {
    const on = i === 0;
    x += pill(ctx, x, y, c, { font: font(600, 28), h: 54, padX: 22, fill: on ? rgba(f.accent, 0.22) : "rgba(255,255,255,0.07)", stroke: on ? f.accent : null, color: on ? INK : SUB }) + 12;
  });
}

// ---------------------------------------------------------------------------
// 06 One picture: three screenshots slide together into one picture
// ---------------------------------------------------------------------------
function onePicture(ctx, lt, A, b, f) {
  const bw = 292;
  const bh = (bw * 870) / 400;
  const join = ramp(lt, -0.15, 0.6, inOutCubic);
  const gap = mix(54, 0, join);
  const total = 3 * bw + 2 * gap;
  const x0 = b.x + (b.w - total) / 2;
  const y0 = b.y + 22;
  const rots = [-0.06, 0.0, 0.055];
  const dys = [26, -14, 34];
  A.pano.forEach((im, i) => {
    const x = x0 + i * (bw + gap);
    const y = y0 + dys[i] * (1 - join);
    around(ctx, x + bw / 2, y + bh / 2, 1, 1, () => {
      shadowed(ctx, 30 * (1 - join) + 10, 12, () => img(ctx, im, null, [x, y, bw, bh], mix(18, 4, join)));
    }, rots[i] * (1 - join));
  });
  // once joined, the seams show where one screenshot ends and the next begins
  const seam = ramp(lt, 0.55, 0.3);
  if (seam > 0) {
    ctx.save();
    ctx.setLineDash([10, 10]);
    ctx.strokeStyle = `rgba(255,255,255,${0.55 * seam})`;
    ctx.lineWidth = 3;
    for (const i of [1, 2]) {
      const x = x0 + i * bw;
      ctx.beginPath();
      ctx.moveTo(x, y0 - 10);
      ctx.lineTo(x, y0 + bh + 10);
      ctx.stroke();
    }
    ctx.restore();
  }
  const lp = ramp(lt, 0.35, 0.4, outBack);
  around(ctx, b.x + b.w / 2, y0 + bh + 66, 0.8 + 0.2 * lp, lp, () => {
    pill(ctx, b.x + b.w / 2, y0 + bh + 36, "All artboards, split", { align: "center", font: font(600, 32), h: 62, fill: rgba(f.accent, 0.18), stroke: f.accent, color: INK });
  });
}

// ---------------------------------------------------------------------------
// 07 Picture library: in-house 3D objects, stickers and mascots pop into the palette
// ---------------------------------------------------------------------------
function library(ctx, lt, A, b, f) {
  const tabs = ["3D objects", "Stickers", "Mascots"];
  let x = b.x + 4;
  tabs.forEach((t, i) => {
    const on = i === 0;
    x += pill(ctx, x, b.y + 4, t, { font: font(600, 30), h: 58, padX: 24, fill: on ? rgba(f.accent, 0.2) : "rgba(255,255,255,0.07)", stroke: on ? f.accent : null, color: on ? INK : SUB }) + 12;
  });
  const cols = 3;
  const gap = 22;
  const cw = (b.w - gap * 2) / 3;
  const chh = 232;
  A.lib.forEach((im, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const cx = b.x + c * (cw + gap);
    const cy = b.y + 92 + r * (chh + gap);
    const p = ramp(lt, -0.55 + (c + r) * 0.09, 0.42, outBack);
    around(ctx, cx + cw / 2, cy + chh / 2, 0.6 + 0.4 * p, clamp(p * 1.4), () => {
      fillRR(ctx, cx, cy, cw, chh, 24, "#1B1E24");
      strokeRR(ctx, cx, cy, cw, chh, 24, LINE, 1.5);
      const s = Math.min((cw - 50) / im.width, (chh - 40) / im.height);
      const w = im.width * s;
      const h = im.height * s;
      shadowed(ctx, 18, 10, () => ctx.drawImage(im, cx + (cw - w) / 2, cy + (chh - h) / 2, w, h), "rgba(0,0,0,0.35)");
    });
  });
  // one is picked up to drop into a design
  const pickT = 0.55;
  const lift = ramp(lt, pickT, 0.3, outBack);
  if (lift > 0) {
    const cx = b.x + cw / 2;
    const cy = b.y + 92 + chh / 2;
    ctx.save();
    ctx.shadowColor = rgba(f.accent, 0.8);
    ctx.shadowBlur = 24 * lift;
    strokeRR(ctx, b.x, b.y + 92, cw, chh, 24, f.accent, 5 * lift);
    ctx.restore();
    void cx;
    void cy;
  }
  cursorPath(ctx, lt, [[0.1, b.x + b.w * 0.6, b.y + b.h * 0.7], [pickT, b.x + cw * 0.62, b.y + 92 + chh * 0.62], [1.2, b.x + cw * 0.62, b.y + 92 + chh * 0.62]], [pickT]);
}

// ---------------------------------------------------------------------------
// 08 Community: the community feed scrolls by
// ---------------------------------------------------------------------------
function community(ctx, lt, A, b) {
  const hw = 620;
  img(ctx, A.communityHead, null, [b.x, b.y + 6, hw, (hw * 64) / 700]);
  const sw = 250;
  img(ctx, A.communityShare, null, [b.x + b.w - sw, b.y, sw, (sw * 74) / 300], 10);
  const top = b.y + 96;
  const cw = b.w;
  const chh = (cw * 518) / 900;
  const scroll = keys(lt, [[0.0, 0], [0.78, chh * 0.62]], inOutCubic);
  ctx.save();
  rr(ctx, b.x, top, b.w, b.y + b.h - top, 24);
  ctx.clip();
  A.communityCards.forEach((im, i) => {
    const enter = ramp(lt, -0.6 + i * 0.12, 0.5, outCubic);
    const y = top + i * (chh + 26) - scroll + (1 - enter) * 120;
    around(ctx, b.x + cw / 2, y + chh / 2, 1, enter, () => {
      shadowed(ctx, 24, 10, () => img(ctx, im, null, [b.x, y, cw, chh], 22));
    });
  });
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 09 57 languages: the same two store screenshots in English, German, Japanese, Arabic
// ---------------------------------------------------------------------------
const LANGS = [
  { k: "setEn", label: "English (US)" },
  { k: "setDe", label: "Deutsch" },
  { k: "setJa", label: "日本語" },
  { k: "setAr", label: "العربية" },
];
const LANG_AT = [-9, 0.02, 0.34, 0.66];
function languages(ctx, lt, A, b, f) {
  let li = 0;
  for (let k = 0; k < LANG_AT.length; k++) if (lt >= LANG_AT[k]) li = k;
  const chipF = '600 30px "Inter", "Yu Gothic UI", "Meiryo", "Segoe UI", sans-serif';
  let x = b.x + 2;
  LANGS.forEach((l, i) => {
    const on = i === li;
    x += pill(ctx, x, b.y + 2, l.label, { font: chipF, h: 58, padX: 22, fill: on ? rgba(f.accent, 0.24) : "rgba(255,255,255,0.07)", stroke: on ? f.accent : null, color: on ? INK : SUB }) + 10;
  });
  const bw = 352;
  const bh = (bw * 956) / 440;
  const gap = 40;
  const x0 = b.x + (b.w - (bw * 2 + gap)) / 2;
  const y0 = b.y + 90;
  [0, 3].forEach((board, j) => {
    const bx = x0 + j * (bw + gap);
    // a flip at each change: squash to a line, swap, open again
    let shown = li;
    let sy = 1;
    for (let k = 1; k < LANG_AT.length; k++) {
      const u = (lt - LANG_AT[k] - j * 0.05) / 0.2;
      if (u >= 0 && u < 1) {
        sy = Math.abs(Math.cos(Math.PI * u));
        shown = u < 0.5 ? k - 1 : k;
      } else if (u >= 1) shown = k;
    }
    if (lt < LANG_AT[1] + j * 0.05) shown = 0;
    ctx.save();
    ctx.translate(bx + bw / 2, y0 + bh / 2);
    ctx.scale(1, Math.max(0.02, sy));
    ctx.translate(-(bx + bw / 2), -(y0 + bh / 2));
    shadowed(ctx, 30, 12, () => img(ctx, A[LANGS[shown].k][board], null, [bx, y0, bw, bh], 18));
    ctx.restore();
  });
}

// ---------------------------------------------------------------------------
// 10 Every device: the app's Every device view, the set laid out row by row
// for iPhone, iPad 13-inch, Android phone and Mac
// ---------------------------------------------------------------------------
function everyDevice(ctx, lt, A, b) {
  const k = 0.86;
  const hw = 900 * k;
  img(ctx, A.everyHead, null, [b.x, b.y + 2, hw, 56 * k]);
  let y = b.y + 56 * k + 18;
  A.every.forEach((im, i) => {
    const w = im.width * k;
    const h = im.height * k;
    const t0 = -0.55 + i * 0.24;
    const p = ramp(lt, t0, 0.4, outCubic);
    if (p > 0) {
      // each row is laid out from the left, as the view remakes it for that device
      ctx.save();
      ctx.globalAlpha = clamp(p * 1.6);
      ctx.beginPath();
      ctx.rect(b.x, y, w * clamp(0.18 + p), h);
      ctx.clip();
      ctx.drawImage(im, b.x + (1 - p) * -40, y, w, h);
      ctx.restore();
    }
    y += h + 12;
  });
}

// ---------------------------------------------------------------------------
// 11 Preview videos: the video boards play, the playhead runs, the music is in
// ---------------------------------------------------------------------------
function previewVideo(ctx, lt, A, b, f) {
  const w = 860;
  const x = b.x + (b.w - w) / 2;
  const bh = (w * 646) / 900;
  const th = (w * 272) / 900;
  const y = b.y + 4;
  shadowed(ctx, 24, 10, () => img(ctx, A.videoBoards, null, [x, y, w, bh], 18));
  const ty = y + bh + 16;
  panel(ctx, x - 6, ty - 6, w + 12, th + 12, 18, "#121418");
  img(ctx, A.videoTimeline, null, [x, ty, w, th], 12);
  // playhead: the ruler runs 0 s at x 12 to 12 s at x 1525 of the 1526 px crop
  const k = w / 1526;
  const secs = keys(lt, [[-0.7, 0.0], [1.4, 6.2]], (u) => u);
  const px = x + (12 + (secs / 12) * 1513) * k;
  ctx.save();
  ctx.strokeStyle = TEAL;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(px, ty + 40 * k * 1.9);
  ctx.lineTo(px, ty + th - 8);
  ctx.stroke();
  ctx.fillStyle = TEAL;
  ctx.beginPath();
  ctx.arc(px, ty + 40 * k * 1.9, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // the board that is playing lights up
  const boardW = w / 3;
  const playing = Math.min(2, Math.floor(secs / 4));
  ctx.save();
  ctx.shadowColor = rgba(f.accent, 0.8);
  ctx.shadowBlur = 20;
  strokeRR(ctx, x + playing * boardW + 6, y + 6, boardW - 12, bh - 30, 14, f.accent, 5);
  ctx.restore();
  // the sound, as bars under the timeline
  const by = ty + th + 30;
  for (let i = 0; i < 44; i++) {
    const hh = 10 + 26 * Math.abs(Math.sin(i * 1.7 + lt * 7)) * (0.5 + 0.5 * Math.sin(i * 0.37));
    fillRR(ctx, x + 70 + i * 18, by + 30 - hh / 2, 9, hh, 4, rgba(f.accent, 0.85));
  }
  text(ctx, "♪", x + 22, by + 44, font(700, 40), f.accent);
}

// ---------------------------------------------------------------------------
// 12 Capture: one click, and every screen arrives in every language
// ---------------------------------------------------------------------------
function capture(ctx, lt, A, b) {
  const bw = 420;
  const click = -0.12;
  const press = 0.06 * clamp(1 - Math.abs(lt - click) / 0.1);
  around(ctx, b.x + bw / 2, b.y + 33, 1 - press, 1, () => img(ctx, A.captureButton, null, [b.x, b.y, bw, (bw * 66) / 420], 12));
  const gw = b.w;
  const k = gw / 1640;
  const gh = 1390 * k;
  const gy = b.y + 92;
  img(ctx, A.captureGrid, null, [b.x, gy, gw, gh], 18);
  // cover the cells that are not taken yet; they arrive one by one with a flash
  const order = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) order.push([r, c]);
  order.forEach(([r, c], i) => {
    const t0 = 0.02 + i * 0.046;
    const cx = b.x + (361 + c * 211.2) * k;
    const cy = gy + (110 + r * 427.5) * k;
    const cw = 192 * k;
    const ch = 400 * k;
    const u = lt - t0;
    if (u < 0) {
      fillRR(ctx, cx - 2, cy - 2, cw + 4, ch + 4, 10, "#1A1D22");
      strokeRR(ctx, cx, cy, cw, ch, 9, "rgba(255,255,255,0.12)", 2);
    } else if (u < 0.18) {
      ctx.save();
      ctx.globalAlpha = 1 - u / 0.18;
      fillRR(ctx, cx, cy, cw, ch, 9, "#FFFFFF");
      ctx.restore();
    }
  });
  const done = ramp(lt, 0.9, 0.3, outBack);
  if (done > 0) {
    around(ctx, b.x + b.w - 150, b.y + 33, 0.8 + 0.2 * done, done, () => {
      checkBadge(ctx, b.x + b.w - 260, b.y + 33, 20, "#39D98A", done);
      text(ctx, "18 taken", b.x + b.w - 230, b.y + 45, font(600, 32), INK);
    });
  }
  cursorPath(ctx, lt, [[-0.7, b.x + 520, b.y + 260], [click, b.x + 300, b.y + 40], [0.4, b.x + 340, b.y + 60]], [click]);
}

// ---------------------------------------------------------------------------
// 13 AI agent: Claude Code works through its steps and the boards appear
// ---------------------------------------------------------------------------
function agent(ctx, lt, A, b) {
  const w = b.w;
  const bh = (w * 394) / 900;
  // boards appear left to right as the agent builds them
  for (let i = 0; i < 5; i++) {
    const p = ramp(lt, -0.45 + i * 0.13, 0.32, outCubic);
    if (p <= 0) continue;
    const sx = (900 / 5) * i;
    const dx = b.x + (w / 5) * i;
    ctx.save();
    ctx.globalAlpha = p;
    rr(ctx, dx, b.y, w / 5, bh, 0);
    ctx.clip();
    ctx.drawImage(A.agentBoards, sx, 0, 900 / 5, 394, dx, b.y + (1 - p) * 30, w / 5, bh);
    ctx.restore();
  }
  // the agent panel: header, steps checking off, then its summary
  const py = b.y + bh + 26;
  const ph = b.y + b.h - py - 6;
  panel(ctx, b.x, py, w, ph, 24, "#121418");
  const k = (w - 60) / 600;
  img(ctx, A.agentHead, null, [b.x + 30, py + 18, 600 * k, 56 * k]);
  const sy = py + 18 + 56 * k + 14;
  const rows = 5;
  const rowH = 172 / rows;
  for (let r = 0; r < rows; r++) {
    const p = ramp(lt, -0.3 + r * 0.14, 0.18);
    if (p <= 0) continue;
    ctx.save();
    ctx.globalAlpha = p;
    ctx.drawImage(A.agentSteps, 0, r * rowH, 600, rowH, b.x + 30, sy + r * rowH * k + (1 - p) * 10, 600 * k, rowH * k);
    ctx.restore();
  }
  const dp = ramp(lt, 0.55, 0.3);
  if (dp > 0) {
    ctx.save();
    ctx.globalAlpha = dp;
    ctx.drawImage(A.agentDone, b.x + 30, sy + 172 * k + 18, 600 * k, 68 * k);
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// 14 CLI: the real commands and the lines they print
// ---------------------------------------------------------------------------
// Printed by a real run on Juniper's five screenshots (22 November 2026); only
// render's absolute output path is shortened.
export const CLI_LINES = [
  { cmd: "npx open-screenshot-generator fill --screenshots ./shots --name Juniper", out: "Juniper, 5 boards, 5 screenshots placed" },
  { cmd: "npx open-screenshot-generator render", out: "5 files, 2.50 MB, 6.0 s -> osg/out" },
  { cmd: "npx open-screenshot-generator verify", out: "5 files in 1 set, 5 ok, 0 warnings, 0 failures" },
];
function cli(ctx, lt, A, b, f) {
  const x = b.x;
  const y = b.y + 4;
  const w = b.w;
  const h = Math.min(640, b.h - 20);
  panel(ctx, x, y, w, h, 24, "#0B0E12");
  fillRR(ctx, x, y, w, 64, 24, "#171B21");
  ctx.fillStyle = "#171B21";
  ctx.fillRect(x, y + 40, w, 24);
  ["#FF5F57", "#FEBC2E", "#28C840"].forEach((c, i) => {
    ctx.beginPath();
    ctx.arc(x + 40 + i * 34, y + 32, 10, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
  });
  text(ctx, "~/juniper", x + w / 2, y + 42, font(500, 26, F.mono), SUB, "center");
  const lf = font(500, 27, F.mono);
  const lh = 46;
  let ly = y + 128;
  const T0 = [-0.75, -0.05, 0.6];
  // JetBrains Mono joins "--" and "->" into one glyph; a zero width non-joiner keeps them as typed
  const plain = (s) => s.replace(/--/g, "-‌-").replace(/->/g, "-‌>");
  CLI_LINES.map((l) => ({ cmd: plain(l.cmd), out: plain(l.out) })).forEach((l, i) => {
    const t0 = T0[i];
    if (lt < t0) return;
    // the command types on, about 90 characters a second
    const n = Math.floor(clamp((lt - t0) / 0.42) * l.cmd.length);
    const shown = l.cmd.slice(0, n);
    text(ctx, "$", x + 34, ly, lf, f.accent);
    // long commands wrap at a space before the window's edge (where the whole
    // command would wrap, so a line does not jump while it types)
    const maxW = w - 110;
    const breaks = [];
    {
      let start = 0;
      let lastSpace = -1;
      for (let c = 0; c < l.cmd.length; c++) {
        if (l.cmd[c] === " ") lastSpace = c;
        if (measure(ctx, l.cmd.slice(start, c + 1), lf) > maxW && lastSpace > start) {
          breaks.push(lastSpace + 1);
          start = lastSpace + 1;
        }
      }
    }
    let line = "";
    let yy = ly;
    for (let c = 0; c < shown.length; c++) {
      if (breaks.includes(c)) {
        text(ctx, line, x + 70, yy, lf, INK);
        yy += lh;
        line = "";
      }
      line += shown[c];
    }
    text(ctx, line, x + 70, yy, lf, INK);
    const typed = n >= l.cmd.length;
    if (!typed && Math.floor(lt * 6) % 2 === 0) ctx.fillStyle = INK, ctx.fillRect(x + 72 + measure(ctx, line, lf), yy - 26, 14, 32);
    ly = yy + lh;
    const op = ramp(lt, t0 + 0.5, 0.12);
    if (op > 0) {
      text(ctx, "ok", x + 34, ly, font(700, 27, F.mono), "#39D98A", "left", op);
      text(ctx, l.out, x + 84, ly, lf, "#C9D1D9", "left", op);
      ly += lh + 18;
    }
  });
}

// ---------------------------------------------------------------------------
// 15 Store listing: the set in the App Store page, swiped like a shopper would
// ---------------------------------------------------------------------------
function storeListing(ctx, lt, A, b) {
  const ph = Math.min(b.h - 10, 860);
  const pw = (ph * 460) / 958;
  const px = b.x + (b.w - pw) / 2;
  const py = b.y + 4;
  shadowed(ctx, 50, 20, () => img(ctx, A.listing, null, [px, py, pw, ph], 40));
  // the screenshot row inside the page: source crop origin (820, 235), 646 px wide
  const k = pw / 646;
  const rowX = px + (878 - 820) * k;
  const rowY = py + (1025 - 235) * k;
  const cardW = 302 * k;
  const cardGap = 38 * k;
  const clipR = px + (1446 - 820) * k;
  const clipB = py + (1568 - 235) * k;
  const swipe = keys(lt, [[0.0, 0], [0.55, 1], [0.62, 1], [1.1, 2]], inOutCubic);
  if (swipe > 0.0001) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(rowX - 6, rowY - 4, clipR - rowX + 6, clipB - rowY + 4);
    ctx.clip();
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(rowX - 6, rowY - 4, clipR - rowX + 6, clipB - rowY + 4);
    for (let i = 0; i < 5; i++) {
      const cx = rowX + i * (cardW + cardGap) - swipe * (cardW + cardGap);
      img(ctx, A.setEn[i], null, [cx, rowY, cardW, (cardW * 956) / 440], 14 * k * 2);
    }
    ctx.restore();
  }
  // a finger swipe across the row
  const fp = clamp((lt - 0.0) / 1.1);
  if (lt > -0.1 && lt < 1.25) {
    const fx = mix(px + pw * 0.8, px + pw * 0.25, inOutSine((fp * 2) % 1));
    ctx.save();
    ctx.globalAlpha = 0.85 * Math.sin(Math.PI * ((fp * 2) % 1));
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.arc(fx, rowY + 180 * k * 2, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// 16 Every size: tick one more store size, the count updates, export
// ---------------------------------------------------------------------------
function everySize(ctx, lt, A, b, f) {
  const w = 860;
  const k = w / 966;
  const x = b.x + (b.w - w) / 2;
  let y = b.y + 2;
  const topH = 250 * k;
  const sizesH = 420 * k;
  const footH = 270 * k;
  panel(ctx, x - 10, y - 6, w + 20, topH + sizesH + footH + 20, 22, "#1B1E23");
  ctx.save();
  rr(ctx, x, y, w, topH, 14);
  ctx.clip();
  ctx.drawImage(A.exportTop, 0, 0, 860, 250 * (860 / 966), x, y, w, topH);
  ctx.restore();
  y += topH;
  img(ctx, A.exportSizes, null, [x, y, w, sizesH]);
  // the iPad 13-inch box, at (1025, 906) in the capture
  const click = 0.0;
  const tick = ramp(lt, click + 0.02, 0.2, outBack);
  const bx = x + (1014 - 960) * k;
  const by = y + (894 - 590) * k;
  const bs = 26 * k + 4;
  if (tick > 0) {
    around(ctx, bx + bs / 2, by + bs / 2, tick, 1, () => {
      fillRR(ctx, bx, by, bs, bs, 6, "#6FB3B5");
      check(ctx, bx + bs / 2, by + bs / 2, bs * 0.8, "#0E1013", 1, 3.5);
    });
  }
  y += sizesH;
  const fy = y;
  img(ctx, A.exportFoot, null, [x, fy, w, footH]);
  // the count: 5 boards x 3 sizes x 4 languages once iPad 13-inch is ticked
  if (tick > 0.5) {
    fillRR(ctx, x + 70 * k, fy + 34 * k, 420 * k, 80 * k, 6, "#1F2227");
    text(ctx, "60 PNG files", x + 77 * k, fy + 64 * k, font(500, 26 * k * 1.05), "#E8EAED");
    text(ctx, "5 artboards, 3 sizes, 4 languages", x + 77 * k, fy + 101 * k, font(400, 21 * k * 1.05), "#9AA0A6");
  }
  // Export pressed, and the files go out
  const ex = 0.48;
  const exX = x + (1800 - 960) * k;
  const exY = fy + (1664 - 1440) * k;
  const press = clamp(1 - Math.abs(lt - ex) / 0.1);
  if (press > 0) {
    ctx.save();
    ctx.globalAlpha = 0.25 * press;
    fillRR(ctx, exX - 70 * k, exY - 26 * k, 140 * k, 52 * k, 8, "#000");
    ctx.restore();
  }
  const fly = ramp(lt, ex + 0.06, 0.5, outCubic);
  if (fly > 0) {
    for (let i = 0; i < 4; i++) {
      const tw = 96;
      const th = (tw * 956) / 440;
      const fx = mix(exX - tw / 2, x + 120 + i * 170, fly);
      const fyy = mix(exY - th / 2, b.y + b.h - th - 10 - (i % 2) * 24, fly);
      around(ctx, fx + tw / 2, fyy + th / 2, 0.4 + 0.6 * fly, clamp(fly * 2), () => {
        shadowed(ctx, 20, 8, () => img(ctx, A[["setEn", "setDe", "setJa", "setAr"][i]][0], null, [fx, fyy, tw, th], 10));
      }, (i - 1.5) * 0.12 * fly);
    }
  }
  cursorPath(ctx, lt, [[-0.6, x + w * 0.7, y - sizesH * 0.2], [click, bx + bs * 0.6, by + bs * 0.6], [ex, exX, exY]], [click, ex]);
}

export const DEMOS = [
  templates, yourShots, editAnything, yourFonts, phones3d, onePicture, library, community,
  languages, everyDevice, previewVideo, capture, agent, cli, storeListing, everySize,
];

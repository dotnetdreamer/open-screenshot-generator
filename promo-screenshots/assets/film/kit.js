// 2D drawing kit for the screens. Every function draws from its arguments
// alone, so a screen at time t is the same whatever was drawn before it.

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const mix = (a, b, t) => a + (b - a) * t;
export const outExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(t)));
export const outCubic = (t) => 1 - Math.pow(1 - clamp(t), 3);
export const outQuint = (t) => 1 - Math.pow(1 - clamp(t), 5);
export const inCubic = (t) => Math.pow(clamp(t), 3);
export const inOutSine = (t) => -(Math.cos(Math.PI * clamp(t)) - 1) / 2;
export const inOutCubic = (t) => {
  const x = clamp(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
/** Spring-like settle with a small overshoot (damping about 0.7). */
export const outBack = (t, s = 1.4) => {
  const x = clamp(t) - 1;
  return 1 + (s + 1) * x * x * x + s * x * x;
};
/** 0 to 1 over `dur` seconds from `from`, eased. */
export const ramp = (lt, from, dur, ease = outCubic) => ease(clamp((lt - from) / dur));

/** Deterministic hash noise in [0, 1). */
export const rnd = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export const F = {
  head: '"Space Grotesk"',
  body: '"Inter"',
  mono: '"JetBrains Mono"',
  serif: '"Instrument Serif"',
};
export const font = (weight, size, family = F.body, style = "normal") =>
  `${style} ${weight} ${size}px ${family}, sans-serif`;

export function rr(ctx, x, y, w, h, r) {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

export function fillRR(ctx, x, y, w, h, r, fill) {
  rr(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function strokeRR(ctx, x, y, w, h, r, stroke, lw = 2) {
  rr(ctx, x, y, w, h, r);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lw;
  ctx.stroke();
}

/** Draw source rect (sx,sy,sw,sh) of img into (dx,dy,dw,dh), optionally clipped to a rounded rect. */
export function img(ctx, im, s, d, radius = 0, alpha = 1) {
  if (!im) return;
  const [sx, sy, sw, sh] = s || [0, 0, im.width, im.height];
  const [dx, dy, dw, dh] = d;
  ctx.save();
  ctx.globalAlpha *= alpha;
  if (radius > 0) {
    rr(ctx, dx, dy, dw, dh, radius);
    ctx.clip();
  }
  ctx.drawImage(im, sx, sy, sw, sh, dx, dy, dw, dh);
  ctx.restore();
}

/** Draw a whole image to fit width w at (x, y); returns its height. */
export function imgW(ctx, im, x, y, w, radius = 0, alpha = 1) {
  const h = (w * im.height) / im.width;
  img(ctx, im, null, [x, y, w, h], radius, alpha);
  return h;
}

/** Draw a whole image to fit height h at (x, y); returns its width. */
export function imgH(ctx, im, x, y, h, radius = 0, alpha = 1) {
  const w = (h * im.width) / im.height;
  img(ctx, im, null, [x, y, w, h], radius, alpha);
  return w;
}

export function text(ctx, str, x, y, f, color, align = "left", alpha = 1) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.font = f;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(str, x, y);
  ctx.restore();
}

export function wrap(ctx, str, maxW, f) {
  ctx.save();
  ctx.font = f;
  const words = str.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const tryLine = line ? line + " " + w : w;
    if (ctx.measureText(tryLine).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = tryLine;
  }
  if (line) lines.push(line);
  ctx.restore();
  return lines;
}

export function measure(ctx, str, f) {
  ctx.save();
  ctx.font = f;
  const w = ctx.measureText(str).width;
  ctx.restore();
  return w;
}

/** A pill with text. Returns its width. */
export function pill(ctx, x, y, label, o = {}) {
  const f = o.font || font(600, 30);
  const padX = o.padX ?? 26;
  const h = o.h ?? 58;
  const w = measure(ctx, label, f) + padX * 2 + (o.icon ? h * 0.6 : 0);
  const left = o.align === "center" ? x - w / 2 : o.align === "right" ? x - w : x;
  ctx.save();
  ctx.globalAlpha *= o.alpha ?? 1;
  if (o.shadow) {
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;
  }
  fillRR(ctx, left, y, w, h, h / 2, o.fill || "rgba(255,255,255,0.1)");
  ctx.shadowColor = "transparent";
  if (o.stroke) strokeRR(ctx, left, y, w, h, h / 2, o.stroke, o.lw || 2);
  let tx = left + padX;
  if (o.icon) {
    o.icon(ctx, tx + h * 0.22, y + h / 2, h * 0.42);
    tx += h * 0.6;
  }
  text(ctx, label, tx, y + h / 2 + (o.baseline ?? h * 0.18), f, o.color || "#fff");
  ctx.restore();
  return w;
}

/** A check mark drawn on as p goes 0 to 1. */
export function check(ctx, cx, cy, size, color, p = 1, lw) {
  if (p <= 0) return;
  const pts = [
    [cx - size * 0.45, cy + size * 0.02],
    [cx - size * 0.12, cy + size * 0.33],
    [cx + size * 0.48, cy - size * 0.3],
  ];
  const l1 = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
  const l2 = Math.hypot(pts[2][0] - pts[1][0], pts[2][1] - pts[1][1]);
  const L = (l1 + l2) * clamp(p);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lw || size * 0.16;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(...pts[0]);
  if (L <= l1) {
    const k = L / l1;
    ctx.lineTo(mix(pts[0][0], pts[1][0], k), mix(pts[0][1], pts[1][1], k));
  } else {
    ctx.lineTo(...pts[1]);
    const k = (L - l1) / l2;
    ctx.lineTo(mix(pts[1][0], pts[2][0], k), mix(pts[1][1], pts[2][1], k));
  }
  ctx.stroke();
  ctx.restore();
}

/** A round check badge (filled circle with a white tick). */
export function checkBadge(ctx, cx, cy, r, color, p = 1) {
  if (p <= 0) return;
  const s = outBack(p, 1.6);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  check(ctx, 0, 0, r * 1.1, "#fff", clamp(p * 1.6 - 0.3), r * 0.22);
  ctx.restore();
}

/** The macOS arrow pointer, tip at (x, y). `press` 0..1 squashes it a touch. */
export function cursor(ctx, x, y, scale = 1, press = 0) {
  const k = scale * (1 - 0.08 * press);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 46);
  ctx.lineTo(11, 35);
  ctx.lineTo(19, 53);
  ctx.lineTo(27, 49);
  ctx.lineTo(19, 32);
  ctx.lineTo(34, 32);
  ctx.closePath();
  ctx.fillStyle = "#111";
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.lineWidth = 3.2;
  ctx.strokeStyle = "#fff";
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();
}

/** A soft ring pulse where something is clicked (p 0..1). */
export function clickRing(ctx, x, y, p, color = "#fff") {
  if (p <= 0 || p >= 1) return;
  ctx.save();
  ctx.globalAlpha = (1 - p) * 0.8;
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(x, y, 14 + 40 * outCubic(p), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Linear interpolation through keys [[t, v], ...] with an ease per segment. */
export function keys(lt, ks, ease = inOutCubic) {
  if (lt <= ks[0][0]) return ks[0][1];
  for (let i = 1; i < ks.length; i++) {
    if (lt <= ks[i][0]) {
      const [t0, v0] = ks[i - 1];
      const [t1, v1] = ks[i];
      const e = ease((lt - t0) / (t1 - t0));
      if (Array.isArray(v0)) return v0.map((a, j) => mix(a, v1[j], e));
      return mix(v0, v1, e);
    }
  }
  return ks[ks.length - 1][1];
}

/** Hex colour to [r, g, b]. */
export const rgb = (hex) => {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
export const rgba = (hex, a) => {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};

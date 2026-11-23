// The sixteen LED screens: one canvas each (1024 x 1280, the panel's 0.8 aspect),
// a static header (accent bar, name, line, mono label) and a live demo under it.
import * as THREE from "../vendor/three.bundle.js";
import { FEATURES } from "./copy.js";
import { F, font, text, wrap, rgba } from "./kit.js";
import { DEMOS } from "./demos.js";
import { landAt } from "./timing.js";

export const SW = 1024;
export const SH = 1280;

function drawHeader(ctx, f) {
  const x = 96;
  let y = 150;
  const nameF = font(700, 84, F.head);
  const subF = font(600, 40, F.body);
  const monoF = font(500, 30, F.mono);
  text(ctx, f.name, x, y, nameF, "#F7F6F2");
  const lines = wrap(ctx, f.sub, SW - x - 70, subF);
  y += 64;
  for (const l of lines) {
    text(ctx, l, x, y, subF, "#E4E2DC");
    y += 50;
  }
  y += 4;
  text(ctx, f.mono, x, y, monoF, f.accent);
  // The accent bar spans the whole block, as in the reference.
  ctx.fillStyle = f.accent;
  ctx.fillRect(62, 84, 8, y - 84 + 10);
  return y + 46; // top of the demo area
}

export function createScreens(assets) {
  return FEATURES.map((f, i) => {
    const canvas = document.createElement("canvas");
    canvas.width = SW;
    canvas.height = SH;
    const ctx = canvas.getContext("2d");
    // The static part (ground and header) is drawn once and stamped every frame.
    const base = document.createElement("canvas");
    base.width = SW;
    base.height = SH;
    const b = base.getContext("2d");
    const g = b.createLinearGradient(0, 0, 0, SH);
    g.addColorStop(0, "#111317");
    g.addColorStop(0.55, "#0C0D10");
    g.addColorStop(1, "#0A0B0D");
    b.fillStyle = g;
    b.fillRect(0, 0, SW, SH);
    const glow = b.createRadialGradient(SW / 2, SH * 1.02, 40, SW / 2, SH * 1.02, SH * 0.75);
    glow.addColorStop(0, rgba(f.accent, 0.22));
    glow.addColorStop(1, rgba(f.accent, 0));
    b.fillStyle = glow;
    b.fillRect(0, 0, SW, SH);
    const top = drawHeader(b, f);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    const box = { x: 48, y: top, w: SW - 96, h: SH - top - 40 };
    let drawnAt = null;
    return {
      index: i,
      feature: f,
      canvas,
      texture,
      box,
      /** Draw the screen as it looks at film time t. */
      draw(t) {
        // A demo acts between 1 s before its screen lands and 3 s after, and holds
        // still outside that, so redraws stop there too.
        const lt = Math.max(-1, Math.min(t - landAt(i), 3));
        const key = Math.round(lt * 120);
        if (key === drawnAt) return;
        drawnAt = key;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.drawImage(base, 0, 0);
        ctx.save();
        DEMOS[i](ctx, lt, assets, box, f);
        ctx.restore();
        texture.needsUpdate = true;
      },
    };
  });
}

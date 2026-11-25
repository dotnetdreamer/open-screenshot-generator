// What the phone's screen shows before a film has a recording: a calm app
// skeleton with a note saying the recording goes there. Drawn once on a
// canvas the size of a phone recording, and reused.

let cached: HTMLCanvasElement | null = null;

export const PLACEHOLDER_SIZE = { width: 886, height: 1920 };

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function placeholderScreen(): HTMLCanvasElement {
  if (cached) return cached;
  const { width: w, height: h } = PLACEHOLDER_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const ground = ctx.createLinearGradient(0, 0, 0, h);
  ground.addColorStop(0, '#f6f7fb');
  ground.addColorStop(1, '#e8ebf3');
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, w, h);

  // The status bar and a header, as most apps start.
  ctx.fillStyle = '#1b1e27';
  ctx.font = '600 38px -apple-system, "SF Pro Text", system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('9:41', 70, 72);
  ctx.fillStyle = '#c9cede';
  rounded(ctx, 60, 190, 360, 58, 18);
  ctx.fill();
  rounded(ctx, 60, 268, 240, 30, 12);
  ctx.fill();

  // Cards.
  const cards = [
    [60, 360, w - 120, 250],
    [60, 640, (w - 150) / 2, 300],
    [60 + (w - 150) / 2 + 30, 640, (w - 150) / 2, 300],
    [60, 970, w - 120, 170],
    [60, 1170, w - 120, 170],
    [60, 1370, w - 120, 170],
  ];
  for (const [x, y, cw, ch] of cards) {
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(30, 40, 70, 0.08)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 6;
    rounded(ctx, x, y, cw, ch, 34);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#e3e6ef';
    rounded(ctx, x + 34, y + 36, Math.min(cw - 68, 300), 26, 12);
    ctx.fill();
    rounded(ctx, x + 34, y + 80, Math.min(cw - 68, 200), 22, 11);
    ctx.fill();
  }

  // The tab bar.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, h - 190, w, 190);
  ctx.fillStyle = '#d3d7e3';
  for (let i = 0; i < 4; i++) {
    rounded(ctx, 120 + i * ((w - 240) / 3) - 28, h - 150, 56, 56, 18);
    ctx.fill();
  }

  // The note, on a soft panel in the middle.
  const panelW = 640;
  const panelH = 300;
  const px = (w - panelW) / 2;
  const py = h / 2 - panelH / 2 - 60;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.shadowColor = 'rgba(30, 40, 70, 0.16)';
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 14;
  rounded(ctx, px, py, panelW, panelH, 48);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  const accent = ctx.createLinearGradient(px, py, px + panelW, py + panelH);
  accent.addColorStop(0, '#6366f1');
  accent.addColorStop(1, '#d946ef');
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(w / 2, py + 92, 46, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(w / 2 - 14, py + 70);
  ctx.lineTo(w / 2 + 22, py + 92);
  ctx.lineTo(w / 2 - 14, py + 114);
  ctx.closePath();
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#1b1e27';
  ctx.font = '700 46px -apple-system, "SF Pro Display", system-ui, sans-serif';
  ctx.fillText('Your screen recording', w / 2, py + 190);
  ctx.fillStyle = '#6b7183';
  ctx.font = '500 34px -apple-system, "SF Pro Text", system-ui, sans-serif';
  ctx.fillText('will appear here', w / 2, py + 240);

  cached = canvas;
  return canvas;
}

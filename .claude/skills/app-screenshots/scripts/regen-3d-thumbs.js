/**
 * Regenerates all 3D device thumbnails in public/elements/device-3d/ by
 * bundling the app's real Device3DRenderer (esbuild) and screenshotting each
 * pose/side/finish combo with a transparent background at 640px.
 *
 * Run from the repo root:  node .claude/skills/app-screenshots/scripts/regen-3d-thumbs.js
 * Optional args filter by device key: `... regen-3d-thumbs.js macbook imac`.
 * Re-run whenever poses, finishes, or materials change in Device3DRenderer.tsx.
 * (Thumbnail URLs don't change, so hard-refresh the browser afterwards.)
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync, execFileSync } = require('child_process');
const puppeteer = require('puppeteer-core');

const REPO = path.resolve(__dirname, '../../../..'); // scripts -> app-screenshots -> skills -> .claude -> repo root
const OUT_DIR = path.join(REPO, 'public/elements/device-3d');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const FFMPEG = 'C:/ffmpeg-2026-02-04-git-627da1111c-essentials_build/bin/ffmpeg.exe';
const THUMB_MAX = 1280; // max output dimension in px
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HARNESS_TSX = `
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Device3DRenderer } from './src/components/artboard-studio/elements/Device3DRenderer';

const mountEl = document.getElementById('mount') as HTMLDivElement;
let root: Root | null = null;
(window as any).__lastError = null;
window.onerror = (msg) => { (window as any).__lastError = String(msg); };

(window as any).renderPose = (opts: any) => {
  return new Promise<void>((resolve) => {
    if (root) { root.unmount(); root = null; }
    mountEl.innerHTML = '';
    const holder = document.createElement('div');
    const scale = ${THUMB_MAX} / Math.max(opts.w, opts.h);
    holder.style.width = Math.round(opts.w * scale) + 'px';
    holder.style.height = Math.round(opts.h * scale) + 'px';
    holder.style.flexShrink = '0';
    mountEl.appendChild(holder);
    root = createRoot(holder);
    root.render(
      <Device3DRenderer
        deviceType={opts.deviceType}
        side={opts.side}
        pose={opts.pose}
        frameColor={opts.frameColor}
        screenshotSrc={opts.wide ? (window as any).__WALLPAPER_WIDE__ : (window as any).__WALLPAPER__}
        objectFit="cover"
      />
    );
    setTimeout(resolve, 650);
  });
};
(window as any).__harnessReady = true;
`;

// Element sizes per pose (keep in sync with IPHONE_3D_SIZES / ANDROID_3D_SIZES
// in ElementPalette.tsx so thumbnails match the dropped elements' aspect).
const IP = { upright: { w: 600, h: 1300 }, side: { w: 600, h: 1300 }, tilted: { w: 640, h: 1120 }, reclined: { w: 720, h: 900 }, laying: { w: 800, h: 680 }, floating: { w: 760, h: 830 }, drifting: { w: 900, h: 700 }, leaning: { w: 780, h: 910 }, soaring: { w: 760, h: 950 }, isometric: { w: 900, h: 480 } };
const AND = { upright: { w: 600, h: 1333 }, side: { w: 600, h: 1333 }, tilted: { w: 640, h: 1150 }, reclined: { w: 720, h: 920 }, laying: { w: 800, h: 700 }, floating: { w: 760, h: 830 }, drifting: { w: 900, h: 700 }, leaning: { w: 780, h: 910 }, soaring: { w: 760, h: 950 }, isometric: { w: 900, h: 480 } };
const WATCH = { front: { w: 580, h: 1200 }, upright: { w: 560, h: 1240 }, side: { w: 560, h: 1240 }, tilted: { w: 660, h: 1100 }, reclined: { w: 720, h: 900 }, laying: { w: 800, h: 700 }, floating: { w: 740, h: 840 }, drifting: { w: 880, h: 700 }, leaning: { w: 760, h: 900 }, soaring: { w: 740, h: 950 }, isometric: { w: 900, h: 520 } };
// Macs offer a curated pose subset (keep in sync with MACBOOK_POSE_ORDER /
// IMAC_POSE_ORDER + their size maps in ElementPalette.tsx).
const MACBOOK = { front: { w: 1100, h: 800 }, upright: { w: 1150, h: 800 }, side: { w: 1150, h: 830 }, tilted: { w: 1200, h: 880 }, reclined: { w: 1200, h: 960 } };
const IMAC = { front: { w: 1000, h: 780 }, upright: { w: 1050, h: 800 }, side: { w: 1100, h: 820 } };

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbs-'));

  // 1. Dark abstract wallpaper for the screens (generated once per run).
  const wallpaperPng = path.join(work, 'wallpaper.png');
  execFileSync(FFMPEG, [
    '-y', '-v', 'error',
    '-f', 'lavfi', '-i', 'gradients=s=540x1200:c0=0x0a0f1f:c1=0x233a66:x0=100:y0=0:x1=440:y1=1200',
    '-vf', 'drawbox=x=140:y=340:w=260:h=8:color=0x77aaff@0.55:t=fill,drawbox=x=240:y=348:w=8:h=260:color=0x77aaff@0.45:t=fill,drawbox=x=120:y=760:w=300:h=8:color=0xffcc88@0.4:t=fill,gblur=sigma=6',
    '-frames:v', '1', wallpaperPng,
  ]);
  // Landscape 16:10 variant for the Mac screens (a portrait wallpaper would
  // crop to a sliver under objectFit cover).
  const wallpaperWidePng = path.join(work, 'wallpaper-wide.png');
  execFileSync(FFMPEG, [
    '-y', '-v', 'error',
    '-f', 'lavfi', '-i', 'gradients=s=1280x800:c0=0x0a0f1f:c1=0x233a66:x0=0:y0=100:x1=1280:y1=700',
    '-vf', 'drawbox=x=340:y=300:w=600:h=10:color=0x77aaff@0.55:t=fill,drawbox=x=635:y=310:w=10:h=240:color=0x77aaff@0.45:t=fill,drawbox=x=300:y=580:w=680:h=10:color=0xffcc88@0.4:t=fill,gblur=sigma=6',
    '-frames:v', '1', wallpaperWidePng,
  ]);

  // 2. Bundle the harness with the real renderer. The temp .tsx must live in
  //    the repo root (tsx/esbuild alias resolution).
  const harnessPath = path.join(REPO, '__tmp_thumbs_harness.tsx');
  const bundlePath = path.join(work, 'bundle.js');
  fs.writeFileSync(harnessPath, HARNESS_TSX);
  try {
    execSync(
      `npx esbuild __tmp_thumbs_harness.tsx --bundle --jsx=automatic --alias:@=./src --define:process.env.NODE_ENV='"production"' --define:process.env.NEXT_PUBLIC_BASE_PATH='""' --outfile="${bundlePath}"`,
      { cwd: REPO, stdio: 'pipe' }
    );
  } finally {
    fs.rmSync(harnessPath, { force: true });
  }

  // 3. Inline everything into one HTML file (file:// pages can't load external scripts reliably).
  const wallpaper = fs.readFileSync(wallpaperPng).toString('base64');
  const wallpaperWide = fs.readFileSync(wallpaperWidePng).toString('base64');
  const html = [
    '<!doctype html><html><head><meta charset="utf-8"><style>',
    'html,body{margin:0;background:transparent;}',
    `#mount{display:flex;align-items:center;justify-content:center;width:${THUMB_MAX + 80}px;height:${THUMB_MAX + 80}px;flex-shrink:0;}`,
    '</style></head><body><div id="mount"></div>',
    `<script>window.__WALLPAPER__='data:image/png;base64,${wallpaper}';window.__WALLPAPER_WIDE__='data:image/png;base64,${wallpaperWide}';</scr` + 'ipt>',
    '<script>', fs.readFileSync(bundlePath, 'utf8'), '</scr' + 'ipt>',
    '</body></html>',
  ].join('\n');
  const htmlPath = path.join(work, 'thumbs.html');
  fs.writeFileSync(htmlPath, html);

  // 4. Render every combo sequentially and screenshot the canvas.
  const only = process.argv.slice(2);
  const combos = [];
  for (const device of [
    { key: 'iphone', type: 'iphone-17-pro-max', sizes: IP },
    { key: 'android', type: 'android-punch-hole', sizes: AND },
    { key: 'watch', type: 'apple-watch', sizes: WATCH },
    { key: 'macbook', type: 'macbook', sizes: MACBOOK },
    { key: 'imac', type: 'imac', sizes: IMAC },
  ]) {
    if (only.length && !only.includes(device.key)) continue;
    for (const color of ['black', 'white']) {
      // Each device renders exactly the poses in its sizes map (the watch
      // adds 'front'; phones don't offer it).
      for (const pose of Object.keys(device.sizes)) {
        for (const side of ['left', 'right']) {
          combos.push({
            file: `${device.key}-${pose}-${side}-${color}.png`,
            deviceType: device.type, pose, side, frameColor: color,
            wide: device.key === 'macbook' || device.key === 'imac',
            ...device.sizes[pose],
          });
        }
      }
    }
  }

  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    args: ['--no-sandbox', '--force-device-scale-factor=1'],
    defaultViewport: { width: THUMB_MAX + 160, height: THUMB_MAX + 160 },
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
  await page.goto('file:///' + htmlPath.replace(/\\/g, '/'), { waitUntil: 'load' });
  await page.waitForFunction('window.__harnessReady === true', { timeout: 30000, polling: 500 });

  for (const combo of combos) {
    await page.evaluate((o) => window.renderPose(o), combo);
    const err = await page.evaluate('window.__lastError');
    if (err) throw new Error(`render error at ${combo.file}: ${err}`);
    const canvas = await page.$('#mount canvas');
    if (!canvas) throw new Error(`no canvas for ${combo.file}`);
    await canvas.screenshot({ path: path.join(OUT_DIR, combo.file), omitBackground: true });
    console.log('thumb:', combo.file);
  }

  await browser.close();
  fs.rmSync(work, { recursive: true, force: true });
  console.log(`DONE — ${combos.length} thumbnails at ${THUMB_MAX}px in ${OUT_DIR}`);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});

/**
 * Renders the 3D Studio thumbnails in public/elements/device-3d/studio/ by
 * bundling the app's real DeviceStudioRenderer (esbuild) and screenshotting
 * each one with a transparent background.
 *
 * Run from the repo root:
 *   node .claude/skills/app-screenshots/scripts/regen-studio-thumbs.js
 *
 * Writes two sets, both read by the app:
 *   <model>.png        one palette tile per measured model (STUDIO_MODELS), at
 *                      the palette look (STUDIO_TILE_LOOK) in its default finish
 *   look-<look>.png    every STUDIO_LOOKS entry on the reference model, for the
 *                      Properties panel's look grid
 *
 * Options, all optional:
 *   OUT=<dir>       write somewhere else (handy while tuning a model)
 *   SIZE=<px>       longest side of each thumbnail (default 640)
 *   LENS=<deg>      camera field of view (default the studio default; 6 is near flat,
 *                   for comparing a side or back view with its drawing)
 *   args            only these, as model[:look-or-angles[:finish]], where angles
 *                   are yaw,pitch,roll and the look defaults to the palette look:
 *                     iphone-air
 *                     iphone-17-pro:back:deep-blue
 *                     iphone-16:30,-10,0:ultramarine
 *                   or "looks" for the look grid alone
 *
 * Re-run whenever a model, the materials or the looks change. Thumbnail
 * names never change, so hard-refresh the browser afterwards.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync, execFileSync } = require('child_process');
const puppeteer = require('puppeteer-core');
const { EDGE } = require('./lib');

const REPO = path.resolve(__dirname, '../../../..');
const OUT_DIR = process.env.OUT ? path.resolve(process.env.OUT) : path.join(REPO, 'public/elements/device-3d/studio');
const FFMPEG = 'C:/ffmpeg-2026-02-04-git-627da1111c-essentials_build/bin/ffmpeg.exe';
const THUMB_MAX = Number(process.env.SIZE) || 640;
const LENS = process.env.LENS ? Number(process.env.LENS) : undefined;
/** The model the look grid is drawn on, in a neutral finish. */
const LOOK_MODEL = 'iphone-17-pro';
const LOOK_FINISH = 'silver';

const HARNESS_TSX = `
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DeviceStudioRenderer } from './src/components/open-screenshot-generator/elements/DeviceStudioRenderer';
import * as studio from './src/lib/device3dStudio';

const mountEl = document.getElementById('mount') as HTMLDivElement;
let root: Root | null = null;
(window as any).__lastError = null;
window.onerror = (msg) => { (window as any).__lastError = String(msg); };
(window as any).studio = {
  looks: studio.STUDIO_LOOKS.map((l) => l.id),
  models: studio.STUDIO_MODELS.map((m) => ({ id: m.id, finishes: m.finishes.map((f) => f.id), defaultFinish: m.defaultFinish })),
  tileLook: studio.STUDIO_TILE_LOOK,
};

(window as any).renderStudio = (opts: any) => {
  return new Promise<void>((resolve) => {
    if (root) { root.unmount(); root = null; }
    mountEl.innerHTML = '';
    const model = studio.studioModelFor(opts.deviceType)!;
    const look = opts.look ? studio.studioLookById(opts.look) : null;
    const orientation = look ? look.orientation : opts.orientation;
    const finish = studio.studioFinishOf({ finish3d: opts.finish }, model);
    const size = studio.studioDefaultSize(model, orientation);
    const scale = ${THUMB_MAX} / Math.max(size.width, size.height);
    const holder = document.createElement('div');
    holder.style.width = Math.round(size.width * scale) + 'px';
    holder.style.height = Math.round(size.height * scale) + 'px';
    holder.style.flexShrink = '0';
    mountEl.appendChild(holder);
    root = createRoot(holder);
    root.render(
      <DeviceStudioRenderer
        deviceType={opts.deviceType}
        screenshotSrc={(window as any).__WALLPAPER__}
        objectFit="cover"
        orientation={orientation}
        lens={opts.lens ?? studio.STUDIO_LENS_DEFAULT}
        frameColor={finish.frame}
        backColor={finish.back}
        accentColor={finish.accent}
        light={studio.lightForOrientation(studio.STUDIO_LIGHT_DEFAULT, orientation)}
        glare={0}
      />
    );
    setTimeout(resolve, 900);
  });
};
(window as any).__harnessReady = true;
`;

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-thumbs-'));

  // A dark abstract wallpaper for the screen, seeded so every run draws the same one.
  const wallpaperPng = path.join(work, 'wallpaper.png');
  execFileSync(FFMPEG, [
    '-y', '-v', 'error',
    '-f', 'lavfi', '-i', 'gradients=s=540x1170:c0=0x0a0f1f:c1=0x233a66:x0=100:y0=0:x1=440:y1=1170:seed=7',
    '-vf', 'drawbox=x=140:y=330:w=260:h=8:color=0x77aaff@0.55:t=fill,drawbox=x=240:y=338:w=8:h=260:color=0x77aaff@0.45:t=fill,drawbox=x=120:y=740:w=300:h=8:color=0xffcc88@0.4:t=fill,gblur=sigma=6',
    '-frames:v', '1', wallpaperPng,
  ]);

  const harnessPath = path.join(REPO, '__tmp_studio_harness.tsx');
  const bundlePath = path.join(work, 'bundle.js');
  fs.writeFileSync(harnessPath, HARNESS_TSX);
  try {
    execSync(
      `npx esbuild __tmp_studio_harness.tsx --bundle --jsx=automatic --alias:@=./src --define:process.env.NODE_ENV='"production"' --define:process.env.NEXT_PUBLIC_BASE_PATH='""' --outfile="${bundlePath}"`,
      { cwd: REPO, stdio: 'pipe' }
    );
  } finally {
    fs.rmSync(harnessPath, { force: true });
  }

  const wallpaper = fs.readFileSync(wallpaperPng).toString('base64');
  const html = [
    '<!doctype html><html><head><meta charset="utf-8"><style>',
    'html,body{margin:0;background:transparent;}',
    `#mount{display:flex;align-items:center;justify-content:center;width:${THUMB_MAX + 80}px;height:${THUMB_MAX + 80}px;flex-shrink:0;}`,
    '</style></head><body><div id="mount"></div>',
    `<script>window.__WALLPAPER__='data:image/png;base64,${wallpaper}';</scr` + 'ipt>',
    '<script>', fs.readFileSync(bundlePath, 'utf8'), '</scr' + 'ipt>',
    '</body></html>',
  ].join('\n');
  const htmlPath = path.join(work, 'studio.html');
  fs.writeFileSync(htmlPath, html);

  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    args: ['--no-sandbox', '--force-device-scale-factor=1'],
    defaultViewport: { width: THUMB_MAX + 160, height: THUMB_MAX + 160 },
  });
  const page = (await browser.pages())[0] ?? await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.text().slice(0, 300)); });
  await page.goto('file:///' + htmlPath.replace(/\\/g, '/'), { waitUntil: 'load' });
  await page.waitForFunction('window.__harnessReady === true', { timeout: 30000, polling: 500 });
  const lists = await page.evaluate('window.studio');
  const modelIds = lists.models.map((m) => m.id);
  const lookModel = modelIds.includes(LOOK_MODEL) ? LOOK_MODEL : modelIds[0];

  const lookCombos = () =>
    lists.looks.map((look) => ({ file: `look-${look}.png`, deviceType: lookModel, look, finish: LOOK_FINISH }));

  const combos = [];
  const only = process.argv.slice(2);
  if (only.length) {
    for (const arg of only) {
      if (arg === 'looks') {
        combos.push(...lookCombos());
        continue;
      }
      const [deviceType, what = lists.tileLook, finish] = arg.split(':');
      if (/^-?[\d.]+,-?[\d.]+,-?[\d.]+$/.test(what)) {
        const [yaw, pitch, roll] = what.split(',').map(Number);
        combos.push({ file: `${deviceType}_${what.replace(/,/g, '_')}${finish ? '-' + finish : ''}.png`, deviceType, orientation: { yaw, pitch, roll }, finish });
      } else if (lists.looks.includes(what)) {
        const file = what === lists.tileLook && !finish ? `${deviceType}.png` : `${deviceType}-${what}${finish ? '-' + finish : ''}.png`;
        combos.push({ file, deviceType, look: what, finish });
      } else {
        throw new Error(`unknown look "${what}"`);
      }
    }
  } else {
    for (const id of modelIds) combos.push({ file: `${id}.png`, deviceType: id, look: lists.tileLook });
    combos.push(...lookCombos());
  }

  for (const combo of combos) {
    await page.evaluate((o) => window.renderStudio(o), { ...combo, lens: LENS });
    const err = await page.evaluate('window.__lastError');
    if (err) throw new Error(`render error at ${combo.file}: ${err}`);
    const canvas = await page.$('#mount canvas');
    if (!canvas) throw new Error(`no canvas for ${combo.file}`);
    await canvas.screenshot({ path: path.join(OUT_DIR, combo.file), omitBackground: true });
    console.log('thumb:', combo.file);
  }

  await browser.close();
  fs.rmSync(work, { recursive: true, force: true });
  console.log(`DONE: ${combos.length} thumbnails at ${THUMB_MAX}px in ${OUT_DIR}`);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});

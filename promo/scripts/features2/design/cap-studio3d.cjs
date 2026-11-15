// Shot 3: the 3D Studio. One square board (1600x1600, #0B1112) with the newest measured
// iPhone holding Juniper's Today screen, rendered by the app itself (__osg.capture of the
// board, the same rasterizer the store upload uses):
//   studio3d/turn-00.png .. turn-47.png   a turntable sweep, yaw -35 to +35 and back
//   studio3d/finish-<name>.png            three finish or colour stills
//   studio3d/pixel.png                    a Pixel still
// Every frame is placed with the app's own box refit (rehugStudioBox from a single
// reference box), the one the rotate handle commits, so the phone's centre and its size on
// the board never move: identical framing in every frame.
//   node cap-studio3d.cjs            the full set
//   node cap-studio3d.cjs --test     a few looks into ./test-studio for choosing
const fs = require('fs');
const path = require('path');
const C = require('./common.cjs');
const M = require('./studio-math.cjs');

const TEST = process.argv.includes('--test');
const OUT = TEST ? path.join(__dirname, 'test-studio') : path.join(C.OUT, 'studio3d');
const BOARD = 1600;
const BG = '#0B1112';
const MODEL = 'iphone-18-pro';
const PIXEL = 'pixel-10-pro';
const LENS = 20;
const SCALE = Number(process.env.SCALE || 600);
const LIGHT = JSON.parse(process.env.LIGHT || '{"azimuth":30,"elevation":24,"intensity":1}');
const TURN_FINISH = process.env.FINISH || 'glacier';
const GLARE = Number(process.env.GLARE || 0);
const FRAMES = 48;
const YAW = 35;

const model = M.studioModelFor(MODEL);
const pixel = M.studioModelFor(PIXEL);
const O0 = { yaw: 0, pitch: 0, roll: 0 };
const size0 = M.studioHugSize(model, O0, LENS, SCALE);
const REF = { position: { x: BOARD / 2 - size0.width / 2, y: BOARD / 2 - size0.height / 2 }, size: size0, scale: 1, rotation: 0 };
const box = (o, m = model) => M.rehugStudioBox(REF, { model, orientation: O0, lens: LENS }, { model: m, orientation: o, lens: LENS });

/** Turntable angle for frame i: evenly spaced, -35 to +35 over frames 0..24, back over 24..47. */
function yawAt(i) {
  const half = FRAMES / 2;
  const t = i <= half ? i / half : (FRAMES - i) / half;
  return Math.round((-YAW + 2 * YAW * t) * 1000) / 1000;
}

const pendingRequests = new Map();

/** After a stall: reload the editor (the project is in IndexedDB) and wait for it to be back. */
async function reloadEditor(page) {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
  await C.lib.dismissTipsDialog(page, { timeout: 8000 });
  await page.waitForFunction("document.querySelectorAll('[data-artboard-dom-id] [data-element-id]').length >= 1", { timeout: 90000, polling: 400 });
  await page.waitForFunction('!!window.__osg && window.__osg.ready', { timeout: 60000, polling: 300 });
  await page.keyboard.press('Escape');
  await C.settle(page, 4000);
}

async function capture(page, boardId, file) {
  const t = Date.now();
  let imgs;
  for (let attempt = 1; ; attempt++) {
    try {
      if (await C.ensureVisible(page)) console.log('  page was hidden, brought to front');
      imgs = await C.withTimeout(page.evaluate((id) => window.__osg.capture([id], null, null), boardId), 30000, 'capture ' + path.basename(file));
      break;
    } catch (e) {
      const state = await C.withTimeout(page.evaluate(() => ({ fonts: document.fonts.status, hidden: document.hidden })), 5000, 'state').catch((err) => String(err));
      console.log('  !!', e.message, 'attempt', attempt, JSON.stringify(state), 'pending', pendingRequests.size, JSON.stringify([...pendingRequests.values()].slice(0, 6)));
      if (attempt >= 3) throw e;
      console.log('  reloading the editor');
      await reloadEditor(page);
    }
  }
  if (process.env.TIMING) console.log('  capture', path.basename(file), ((Date.now() - t) / 1000).toFixed(1) + 's');
  const buf = Buffer.from(imgs[0].base64, 'base64');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  return { width: imgs[0].width, height: imgs[0].height, bytes: buf.length };
}

/** Where the phone is in a frame: the box of pixels that are not the background. */
async function phoneBox(file) {
  const sharp = require(C.REPO + '/node_modules/sharp');
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const bg = [0x0b, 0x11, 0x12];
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
  for (let y = 0; y < info.height; y += 2) {
    for (let x = 0; x < info.width; x += 2) {
      const i = (y * info.width + x) * 3;
      if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}

async function setDevice(page, boardId, elementId, props) {
  await C.withTimeout(C.mcp(page, 'update_element', { artboardId: boardId, elementId, ...props }), 30000, 'update_element');
}

/** The same phone swapped for the Pixel (a model change keeps its height on the board), at the hero look. */
async function pixelStill(page, boardId, elementId, file) {
  const hero = { yaw: 24, pitch: -12, roll: -8 };
  const b = box(hero, pixel);
  await setDevice(page, boardId, elementId, {
    deviceType: PIXEL,
    name: pixel.label,
    finish3d: process.env.PIXEL_FINISH || 'porcelain',
    bodyColor3d: null,
    rotation3d: hero,
    x: b.position.x,
    y: b.position.y,
    width: b.size.width,
    height: b.size.height,
  });
  await waitRendered(page, 2500);
  await capture(page, boardId, file);
  console.log('pixel', JSON.stringify(await phoneBox(file)));
}

async function waitRendered(page, ms = 700) {
  await C.sleep(ms);
  // Two frames, or half a second if the page is not painting frames at all.
  await page.evaluate(() => Promise.race([new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))), new Promise((r) => setTimeout(r, 500))]));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { page, close } = await C.openEditor({ theme: 'dark', dpr: 1 });
  page.on('request', (r) => pendingRequests.set(r, r.url().slice(0, 120)));
  page.on('requestfinished', (r) => pendingRequests.delete(r));
  page.on('requestfailed', (r) => pendingRequests.delete(r));
  try {
    await C.waitStartDialog(page);
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('Start blank')).click());
    await page.waitForFunction("location.search.includes('projectId') && document.querySelectorAll('[data-artboard-dom-id]').length === 1", { timeout: 60000, polling: 400 });
    await page.waitForFunction('!!window.__osg && window.__osg.ready', { timeout: 60000, polling: 300 });
    await C.sleep(1500);
    await C.lib.dismissTipsDialog(page, { timeout: 2000 });

    const listed = await C.mcp(page, 'list_artboards', {});
    const boardId = (Array.isArray(listed) ? listed : listed.artboards)[0].id;
    await C.mcp(page, 'update_artboard', { artboardId: boardId, name: 'Turntable', width: BOARD, height: BOARD, scaleContent: false });
    await C.mcp(page, 'set_background', { artboardId: boardId, backgroundColor: BG });
    await C.mcp(page, 'rename_project', { name: 'Juniper 3D' });
    const asset = await C.mcp(page, 'upload_asset', { source: C.dataUrl(path.join(C.SCREENS, 'en', 'today.png')), name: 'juniper-en-today' });
    const ref = asset.ref || asset.reference || (asset.id ? `asset:${asset.id}` : asset);

    const o = { yaw: yawAt(0), pitch: 0, roll: 0 };
    const b = box(o);
    const added = await C.mcp(page, 'add_element', {
      artboardId: boardId,
      type: 'device',
      subType: MODEL,
      name: model.label,
      styleType: '3d-studio',
      rotation3d: o,
      lens3d: LENS,
      finish3d: TURN_FINISH,
      light3d: LIGHT,
      glare3d: GLARE,
      screenshotSrc: ref,
      screenshotObjectFit: 'cover',
      x: b.position.x,
      y: b.position.y,
      width: b.size.width,
      height: b.size.height,
    });
    const elementId = added.id;
    // Nothing selected, so no handle or outline is anywhere near the board.
    await page.keyboard.press('Escape');
    await C.settle(page, 4000);

    const log = [];
    if (TEST) {
      const looks = [
        ['turn-a', { yaw: -35, pitch: 0, roll: 0 }, { finish3d: 'glacier' }],
        ['turn-b', { yaw: 0, pitch: 0, roll: 0 }, { finish3d: 'glacier' }],
        ['turn-c', { yaw: 35, pitch: 0, roll: 0 }, { finish3d: 'glacier' }],
        ['silver-c', { yaw: 35, pitch: 0, roll: 0 }, { finish3d: 'silver' }],
        ['back-burgundy', { yaw: 148, pitch: -10, roll: 0 }, { finish3d: 'burgundy' }],
        ['back-silver', { yaw: 148, pitch: -10, roll: 0 }, { finish3d: 'silver' }],
        ['back-black', { yaw: 148, pitch: -10, roll: 0 }, { finish3d: 'black' }],
        ['back-forest', { yaw: 148, pitch: -10, roll: 0 }, { bodyColor3d: '#2D6A4F' }],
        ['hero-glacier', { yaw: 24, pitch: -12, roll: -8 }, { finish3d: 'glacier' }],
      ];
      const only = process.env.TEST_LOOKS ? process.env.TEST_LOOKS.split(',') : null;
      for (const [name, o, extra] of looks.filter(([n]) => !only || only.includes(n))) {
        console.log('look', name);
        const b = box(o);
        await setDevice(page, boardId, elementId, { rotation3d: o, x: b.position.x, y: b.position.y, width: b.size.width, height: b.size.height, bodyColor3d: null, ...extra });
        await waitRendered(page, 1500);
        const file = path.join(OUT, `${name}.png`);
        await capture(page, boardId, file);
        console.log(name, JSON.stringify(await phoneBox(file)));
      }
      await pixelStill(page, boardId, elementId, path.join(OUT, 'pixel-hero.png'));
    } else {
      // ---- the turntable -----------------------------------------------------------------
      for (let i = 0; i < FRAMES; i++) {
        const o = { yaw: yawAt(i), pitch: 0, roll: 0 };
        const b = box(o);
        await setDevice(page, boardId, elementId, { rotation3d: o, x: b.position.x, y: b.position.y, width: b.size.width, height: b.size.height });
        await waitRendered(page, i === 0 ? 1500 : 650);
        const file = path.join(OUT, `turn-${String(i).padStart(2, '0')}.png`);
        const meta = await capture(page, boardId, file);
        const pbx = await phoneBox(file);
        log.push({ frame: i, yaw: o.yaw, box: b, phone: pbx });
        console.log(`turn-${String(i).padStart(2, '0')} yaw ${o.yaw.toFixed(2)} ${meta.width}x${meta.height} phone c=${pbx.cx.toFixed(0)},${pbx.cy.toFixed(0)} ${pbx.w}x${pbx.h}`);
      }
      // ---- finishes: the back, angled, where the colour is -----------------------------------
      const back = { yaw: 148, pitch: -10, roll: 0 };
      for (const [name, extra] of [
        ['silver', { finish3d: 'silver', bodyColor3d: null }],
        ['burgundy', { finish3d: 'burgundy', bodyColor3d: null }],
        ['forest', { bodyColor3d: '#2D6A4F' }],
      ]) {
        const b = box(back);
        await setDevice(page, boardId, elementId, { rotation3d: back, x: b.position.x, y: b.position.y, width: b.size.width, height: b.size.height, ...extra });
        await waitRendered(page, 1500);
        const file = path.join(OUT, `finish-${name}.png`);
        await capture(page, boardId, file);
        console.log('finish', name, JSON.stringify(await phoneBox(file)));
      }
      await pixelStill(page, boardId, elementId, path.join(OUT, 'pixel.png'));
    }
    fs.writeFileSync(path.join(OUT, TEST ? 'test-log.json' : 'angles.json'), JSON.stringify({ model: model.label, lens: LENS, light: LIGHT, finish: TURN_FINISH, reference: REF, frames: log.map((l) => ({ frame: l.frame, yaw: l.yaw, pitch: 0, roll: 0 })) }, null, 2));
  } catch (e) {
    console.error(e);
    await page.screenshot({ path: path.join(__dirname, 'zz-studio-error.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    C.reportBlocked();
    await close();
  }
})();

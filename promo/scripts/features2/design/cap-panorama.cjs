// Shot 4: a three board panorama. Juniper's colours, art that carries on across the board
// edges (spanArtboards): a big tilted phone across boards 1 and 2, a soft wave and a cream
// ribbon across all three.
//   panorama/canvas.png    the editor zoomed to fit, the gaps between the boards visible
//   panorama/b1.png .. b3.png   each board exported by the app (1206 x 2622)
//   panorama/strip-check.png    the three exports edge to edge (the seam check, not for the film)
//   node cap-panorama.cjs
const fs = require('fs');
const path = require('path');
const C = require('./common.cjs');

const OUT = path.join(C.OUT, 'panorama');
const W = 1206;
const H = 2622;
const STRIP = W * 3;
const FOREST = '#2D6A4F';
const MID = '#3C8460';
const CREAM = '#F6F2E9';
const BERRY = '#4C55C9';

/** A smooth closed ribbon in a 0..100 box: a sine of `turns` periods, `thick` units deep. */
function ribbonPath({ turns = 1.25, amp = 26, mid = 50, thick = 14, phase = 0, steps = 40 }) {
  const f = (x) => mid + amp * Math.sin((x / 100) * turns * 2 * Math.PI + phase);
  const pts = (offset) => Array.from({ length: steps + 1 }, (_, i) => {
    const x = (i / steps) * 100;
    return [x, f(x) + offset];
  });
  // Catmull-Rom through the points, as cubic Beziers.
  const curve = (p, move) => {
    let d = move ? `M${p[0][0].toFixed(2)} ${p[0][1].toFixed(2)}` : `L${p[0][0].toFixed(2)} ${p[0][1].toFixed(2)}`;
    for (let i = 0; i < p.length - 1; i++) {
      const p0 = p[Math.max(0, i - 1)];
      const p1 = p[i];
      const p2 = p[i + 1];
      const p3 = p[Math.min(p.length - 1, i + 2)];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C${c1[0].toFixed(2)} ${c1[1].toFixed(2)} ${c2[0].toFixed(2)} ${c2[1].toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
    }
    return d;
  };
  const upper = pts(-thick / 2);
  const lower = pts(thick / 2).reverse();
  return `${curve(upper, true)} ${curve(lower, false)} Z`;
}

function headline(content, x, y, width, lines, align = 'left') {
  const fontSize = 37.4;
  const height = Math.round(lines * (fontSize / 0.3) * 1.18 + 0.32 * (fontSize / 0.3));
  return { type: 'text', name: 'Headline', content, x, y, width, height, fontSize, color: CREAM, fontFamily: 'Bricolage Grotesque', fontWeight: '700', textAlign: align, lineHeight: 1.18 };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { page, close } = await C.openEditor({ theme: 'dark', dpr: 2 });
  try {
    await C.waitStartDialog(page);
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('Start blank')).click());
    await page.waitForFunction("location.search.includes('projectId') && document.querySelectorAll('[data-artboard-dom-id]').length === 1", { timeout: 60000, polling: 400 });
    await page.waitForFunction('!!window.__osg && window.__osg.ready', { timeout: 60000, polling: 300 });
    await C.sleep(1500);

    const first = (await C.mcp(page, 'list_artboards', {}));
    const b1 = (Array.isArray(first) ? first : first.artboards)[0].id;
    await C.mcp(page, 'update_artboard', { artboardId: b1, name: 'Habits', width: W, height: H, scaleContent: false });
    const b2 = (await C.mcp(page, 'create_artboard', { name: 'Streaks', width: W, height: H, backgroundColor: FOREST })).id;
    const b3 = (await C.mcp(page, 'create_artboard', { name: 'Week', width: W, height: H, backgroundColor: FOREST })).id;
    for (const id of [b1, b2, b3]) await C.mcp(page, 'set_background', { artboardId: id, backgroundColor: FOREST });
    const order = await C.mcp(page, 'list_artboards', {});
    console.log('boards', JSON.stringify((Array.isArray(order) ? order : order.artboards).map((b) => `${b.id} ${b.name} ${b.width}x${b.height}`)));

    const up = async (screen) => {
      const a = await C.mcp(page, 'upload_asset', { source: C.dataUrl(path.join(C.SCREENS, 'en', `${screen}.png`)), name: `juniper-en-${screen}` });
      return a.ref || a.reference || (a.id ? `asset:${a.id}` : a);
    };
    const detail = await up('detail');
    const stats = await up('stats');

    // Board 1 holds everything that spans. Positions are board 1's own coordinates, so
    // anything past x 1206 lands on board 2 and past 2412 on board 3.
    const glow = ribbonPath({ turns: 1.15, amp: 22, mid: 52, thick: 46, phase: 0.35 });
    const ribbon = ribbonPath({ turns: 1.15, amp: 22, mid: 52, thick: 2.6, phase: 0.35 });
    const phoneW = 1000;
    const phoneH = Math.round(phoneW * (150.01 / 71.85));
    await C.mcp(page, 'add_elements', {
      artboardId: b1,
      elements: [
        {
          type: 'shape', subType: 'custom-svg', name: 'Soft wave', customPath: glow,
          specialProps: { viewBox: '0 0 100 100' },
          x: -160, y: 1180, width: STRIP + 320, height: 1300,
          fillColor: MID, strokeColor: MID, strokeWidth: 0, fillOpacity: 1, blur: 36,
          spanArtboards: true, spanBehind: true,
        },
        {
          type: 'shape', subType: 'custom-svg', name: 'Cream ribbon', customPath: ribbon,
          specialProps: { viewBox: '0 0 100 100' },
          x: -160, y: 1180, width: STRIP + 320, height: 1300,
          fillColor: CREAM, strokeColor: CREAM, strokeWidth: 0, fillOpacity: 0.9,
          spanArtboards: true, spanBehind: true,
        },
        {
          type: 'shape', subType: 'circle', name: 'Berry glow',
          x: 1700, y: 300, width: 1500, height: 1500,
          fillColor: BERRY, strokeColor: BERRY, strokeWidth: 0, fillOpacity: 0.55, blur: 160,
          spanArtboards: true, spanBehind: true,
        },
        {
          type: 'device', subType: 'iphone-18-pro', name: 'Phone across 1 and 2', styleType: 'normal',
          frameColor: '#1E2522', screenshotSrc: detail, screenshotObjectFit: 'cover',
          x: 1190 - phoneW / 2, y: 760, width: phoneW, height: phoneH, rotation: -14,
          shadow: { x: 0, y: 40, blur: 80, color: 'rgba(0,0,0,0.35)' },
          spanArtboards: true,
        },
        headline('BUILD HABITS\nTHAT STICK', 70, 150, 1066, 2),
      ],
    });
    await C.mcp(page, 'add_elements', {
      artboardId: b2,
      elements: [headline('WATCH YOUR\nSTREAK GROW', 120, 150, 1016, 2, 'right')],
    });
    const p3W = 860;
    await C.mcp(page, 'add_elements', {
      artboardId: b3,
      elements: [
        {
          type: 'device', subType: 'iphone-18-pro', name: 'Phone', styleType: 'normal',
          frameColor: '#1E2522', screenshotSrc: stats, screenshotObjectFit: 'cover',
          x: (W - p3W) / 2 + 40, y: 780, width: p3W, height: Math.round(p3W * (150.01 / 71.85)), rotation: 6,
          shadow: { x: 0, y: 40, blur: 80, color: 'rgba(0,0,0,0.35)' },
        },
        headline('YOUR WEEK\nAT A GLANCE', 70, 150, 1066, 2),
      ],
    });
    await C.mcp(page, 'rename_project', { name: 'Juniper panorama' });
    await page.keyboard.press('Escape');
    await C.settle(page, 3000);

    // ---- the canvas, zoomed to fit with the gaps showing ------------------------------------
    const framed = await C.frameBoards(page, { first: 0, last: 2, leftGaps: 1.5, rightGaps: 1.5 });
    console.log('zoom', await C.zoomLevel(page), JSON.stringify(framed.boards.map((b) => [Math.round(b.x), Math.round(b.y), Math.round(b.w), Math.round(b.h)])));
    // Nothing selected: a click on the bare canvas below the boards.
    const lay = await C.canvasLayout(page);
    await page.mouse.click(lay.scroller.x + lay.scroller.w / 2, Math.min(lay.scroller.y + lay.scroller.h - 120, lay.boards[0].y + lay.boards[0].h + 60));
    await C.settle(page, 2000);
    await C.parkMouse(page, 1000, 880);
    const canvasRects = {};
    for (let i = 0; i < 3; i++) canvasRects[`board${i + 1}`] = await C.rect(page, (i) => document.querySelectorAll('[data-artboard-dom-id]')[i], i);
    canvasRects.seam12 = { x: canvasRects.board1.x + canvasRects.board1.w, y: canvasRects.board1.y, w: canvasRects.board2.x - (canvasRects.board1.x + canvasRects.board1.w), h: canvasRects.board1.h };
    canvasRects.seam23 = { x: canvasRects.board2.x + canvasRects.board2.w, y: canvasRects.board2.y, w: canvasRects.board3.x - (canvasRects.board2.x + canvasRects.board2.w), h: canvasRects.board2.h };
    canvasRects.spanningPhone = await C.rect(page, () => {
      // The phone's own wrapper on board 1 plus its span copy on board 2, as one box.
      const own = [...document.querySelectorAll('[data-artboard-dom-id] [data-element-id]')].find((n) => n.querySelector('[data-device-frame]'));
      const copy = document.querySelector('[data-span-of] [data-device-frame]');
      const a = own.getBoundingClientRect();
      const b = copy ? copy.getBoundingClientRect() : a;
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), r = Math.max(a.right, b.right), bt = Math.max(a.bottom, b.bottom);
      return { getBoundingClientRect: () => ({ x, y, width: r - x, height: bt - y }) };
    });
    await C.shot(page, path.join(OUT, 'canvas.png'));
    C.writeRects(OUT, 'canvas.png', canvasRects);

    // ---- each board, exported by the app ---------------------------------------------------
    const files = [];
    for (const [i, id] of [b1, b2, b3].entries()) {
      const t = Date.now();
      const imgs = await page.evaluate((id) => window.__osg.capture([id], null, null), id);
      const file = path.join(OUT, `b${i + 1}.png`);
      fs.writeFileSync(file, Buffer.from(imgs[0].base64, 'base64'));
      files.push(file);
      console.log('exported', `b${i + 1}.png`, imgs[0].width + 'x' + imgs[0].height, ((Date.now() - t) / 1000).toFixed(1) + 's');
    }

    // ---- the seam check: the three exports edge to edge -----------------------------------
    const sharp = require(C.REPO + '/node_modules/sharp');
    const raws = await Promise.all(files.map((f) => sharp(f).removeAlpha().raw().toBuffer({ resolveWithObject: true })));
    const col = (r, x) => {
      const out = new Float64Array(r.info.height * 3);
      for (let y = 0; y < r.info.height; y++) for (let c = 0; c < 3; c++) out[y * 3 + c] = r.data[(y * r.info.width + x) * 3 + c];
      return out;
    };
    const diff = (a, b) => {
      let s = 0;
      for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
      return s / a.length;
    };
    for (const [l, r, name] of [[raws[0], raws[1], '1|2'], [raws[1], raws[2], '2|3']]) {
      const across = diff(col(l, l.info.width - 1), col(r, 0));
      const insideL = diff(col(l, l.info.width - 2), col(l, l.info.width - 1));
      const insideR = diff(col(r, 0), col(r, 1));
      console.log(`seam ${name}: mean step across ${across.toFixed(3)}, one column inside ${insideL.toFixed(3)} / ${insideR.toFixed(3)}`);
    }
    await sharp({ create: { width: STRIP, height: H, channels: 3, background: '#000000' } })
      .composite(files.map((f, i) => ({ input: f, left: i * W, top: 0 })))
      .png()
      .toFile(path.join(__dirname, 'panorama-strip.png'));
    console.log('strip written');
  } catch (e) {
    console.error(e);
    await page.screenshot({ path: path.join(__dirname, 'zz-panorama-error.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    C.reportBlocked();
    await close();
  }
})();

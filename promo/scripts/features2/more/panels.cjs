// "Panels on a second screen": the right dock torn off into its own window.
// The web build's dock bus is a BroadcastChannel, so a second page of the same
// browser opened at ?panel=dock renders the live panels of the editor page.
// The two shots are then set side by side on one 1440x900 frame.
const fs = require('fs');
const path = require('path');
const R = require('./rig.cjs');
const S = require('./steps.cjs');
const { buildJuniper } = require(path.join(R.CAP, 'juniper.cjs'));

const DEBUG = path.join(__dirname, 'explore');
const PANEL_W = 400;
const PANEL_H = 900;
const SCALE = Number(process.env.SCALE || 0.7);
const GAP = 16;

(async () => {
  const { browser, page, backend } = await R.openRig({ storage: R.signedInStorage(), posts: [], tauri: false });
  let panel = null;
  try {
    await R.capLib.openTemplate(page, 'Droply Habits');
    await buildJuniper(page, { languages: true });
    await R.capLib.settle(page, 2000);
    await R.dismissToasts(page);

    // A headline selected, so Properties shows the text controls.
    await S.fitView(page, { boardIds: ['tpl_dr_ab1', 'tpl_dr_ab2'], frac: 0.98 });
    await S.selectElement(page, 'tpl_dr_ab1_headline');
    await page.waitForSelector('#fontSize', { timeout: 15000 });

    // The panel window.
    panel = await browser.newPage();
    await panel.setViewport({ width: PANEL_W, height: PANEL_H, deviceScaleFactor: 2 });
    await R.preparePage(panel, { tauri: false, headless: false, theme: 'dark', storage: {}, backend, log: (l) => console.log('[panel] ' + l) });
    await panel.goto(`${R.capLib.BASE}/?panel=dock`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await R.sleep(6000);
    // Nudge the editor so it projects a fresh state, and leave the element where it was.
    await page.bringToFront();
    await page.keyboard.press('ArrowRight');
    await R.sleep(500);
    await page.keyboard.press('ArrowLeft');
    await R.sleep(2500);
    await panel.bringToFront();
    await panel.waitForFunction(() => !!document.querySelector('#fontSize'), { timeout: 30000, polling: 500 }).catch(() => {});
    await R.sleep(2000);
    const panelText = await panel.evaluate(() => document.body.innerText.slice(0, 300));
    console.log('panel says:', JSON.stringify(panelText));
    await panel.mouse.move(PANEL_W - 2, PANEL_H - 2);
    const panelShot = await panel.screenshot({ type: 'png' });
    fs.mkdirSync(DEBUG, { recursive: true });
    fs.writeFileSync(path.join(DEBUG, 'panel-window.png'), panelShot);

    await page.bringToFront();
    await R.sleep(1500);
    await R.dismissToasts(page);
    // The web build has no local MCP server, so its pill only says "off". The
    // shot is about the panels; the pill is left out rather than read as broken.
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('[title]')) {
        if (/MCP server/i.test(el.getAttribute('title') || '')) {
          const wrap = el.closest('.md\\:block') || el;
          wrap.style.display = 'none';
        }
      }
    });
    await S.parkMouse(page);
    console.log('editor hazards', await R.hazards(page));
    const editorShot = await page.screenshot({ type: 'png' });
    fs.writeFileSync(path.join(DEBUG, 'panel-editor.png'), editorShot);
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    // One frame: the editor on the left, the panel window on the right, at the
    // same scale, as two windows on one desk.
    const ew = 1440 * SCALE;
    const eh = 900 * SCALE;
    const pw = PANEL_W * SCALE;
    const ph = PANEL_H * SCALE;
    const total = ew + GAP + pw;
    const left = Math.round((1440 - total) / 2);
    const top = Math.round((900 - eh) / 2);
    const rects = {
      editor: { x: left, y: top, w: Math.round(ew), h: Math.round(eh) },
      panel: { x: Math.round(left + ew + GAP), y: top, w: Math.round(pw), h: Math.round(ph) },
    };
    const comp = await browser.newPage();
    await comp.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    const img = (buf) => 'data:image/png;base64,' + buf.toString('base64');
    await comp.setContent(`<!doctype html><html><body style="margin:0;width:1440px;height:900px;overflow:hidden;background:#07080a">
      <div style="position:absolute;inset:0;background:radial-gradient(1200px 700px at 50% 45%, #15171c 0%, #07080a 70%)"></div>
      ${[
        ['editor', img(editorShot)],
        ['panel', img(panelShot)],
      ]
        .map(
          ([k, src]) =>
            `<img src="${src}" style="position:absolute;left:${rects[k].x}px;top:${rects[k].y}px;width:${rects[k].w}px;height:${rects[k].h}px;border-radius:10px;outline:1px solid rgba(255,255,255,0.10);box-shadow:0 18px 50px rgba(0,0,0,0.55)">`
        )
        .join('')}
    </body></html>`);
    await comp.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
    await R.sleep(500);
    const out = path.join(R.OUT, 'panels.png');
    await comp.screenshot({ path: out });
    console.log('shot panels.png', JSON.stringify(rects), 'editor bg', background);
    R.saveRects('panels.png', rects);
    await comp.close();
  } catch (e) {
    console.error(e);
    await page.screenshot({ path: path.join(DEBUG, 'panels-error.png') }).catch(() => {});
    if (panel) await panel.screenshot({ path: path.join(DEBUG, 'panels-error-panel.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await R.closeRig(browser);
  }
})();

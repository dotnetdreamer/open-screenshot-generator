// Editor steps shared by the "more" capture scripts.
const R = require('./rig.cjs');
const { sleep } = R;

/** Set a React-controlled input the way a person typing would leave it. */
async function setInput(page, selector, value) {
  const ok = await page.evaluate(
    (selector, value) => {
      const input = typeof selector === 'string' ? document.querySelector(selector) : null;
      if (!input) return false;
      const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const set = Object.getOwnPropertyDescriptor(proto, 'value').set;
      input.focus();
      set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    selector,
    value
  );
  if (!ok) throw new Error('no input for ' + selector);
}

/** Rename the open project through the name pill under the canvas. */
async function renameProject(page, name) {
  const at = await R.centerOf(page, () => document.querySelector('[title="Double-click to rename project"]'));
  if (!at) throw new Error('no project name pill');
  await page.mouse.click(at.x, at.y, { clickCount: 2 });
  await page.waitForFunction(() => document.activeElement && document.activeElement.placeholder === 'Project name...', { timeout: 10000 });
  await page.evaluate((name) => {
    const input = document.activeElement;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(input, name);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, name);
  await sleep(150);
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    (name) => [...document.querySelectorAll('[title="Double-click to rename project"]')].some((n) => (n.textContent || '').trim() === name),
    { timeout: 10000 },
    name
  );
  await sleep(600);
}

async function zoomLevel(page) {
  return page.evaluate(() => {
    const b = document.querySelector('button[title="Reset zoom to 100%"]');
    return b ? parseInt(b.textContent, 10) : null;
  });
}

async function zoomBy(page, steps) {
  const title = steps < 0 ? 'Zoom Out' : 'Zoom In';
  for (let i = 0; i < Math.abs(steps); i++) {
    await page.evaluate((t) => [...document.querySelectorAll('button')].find((b) => b.title === t)?.click(), title);
    await sleep(250);
  }
  await sleep(500);
}

async function resetZoom(page) {
  await page.evaluate(() => document.querySelector('button[title="Reset zoom to 100%"]')?.click());
  await sleep(500);
}

/** Open the + and pick one of its items. */
async function create(page, item) {
  // The + opens on a click and on a resting mouse, and the two can cancel each
  // other out, so the click is repeated until the item is on screen.
  let shown = false;
  for (let i = 0; i < 4 && !shown; i++) {
    await R.clickPick(page, () => document.querySelector('button[aria-label="Create"]'));
    shown = await page
      .waitForFunction(
        (item) => [...document.querySelectorAll('button')].some((b) => b.getAttribute('aria-label') === item && b.offsetParent !== null),
        { timeout: 4000 },
        item
      )
      .then(() => true)
      .catch(() => false);
    if (!shown) {
      await page.mouse.move(700, 600);
      await sleep(800);
    }
  }
  if (!shown) throw new Error('the + menu never showed ' + item);
  await sleep(300);
  await R.clickPick(page, (item) => [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === item && b.offsetParent !== null), item);
  await sleep(1200);
}

/** Open a toolbar dropdown by its trigger title. */
async function openMenu(page, title) {
  await R.clickPick(page, (t) => [...document.querySelectorAll('button')].find((b) => b.title === t), title);
  await page.waitForSelector('[role="menu"]', { timeout: 10000 });
  await sleep(700);
}

async function closeMenus(page) {
  await page.keyboard.press('Escape');
  await sleep(600);
}

/** A right dock tab: Properties, History, Versions. */
async function dockTab(page, name) {
  await R.clickPick(page, (name) => [...document.querySelectorAll('[role="tab"]')].find((t) => (t.textContent || '').trim() === name && t.offsetParent !== null), name);
  await sleep(900);
}

/** A palette tab: Elements, Devices, Images, Previews, Header. */
async function paletteTab(page, name) {
  await R.clickPick(page, (name) => [...document.querySelectorAll('[role="tab"]')].find((t) => (t.textContent || '').trim() === name && t.offsetParent !== null), name);
  await sleep(900);
}

/** Click an element on the canvas by its element id (selects it). */
async function selectElement(page, elementId) {
  const at = await R.centerOf(page, (id) => document.querySelector(`[data-element-id="${id}"]`), elementId);
  if (!at) throw new Error('no element ' + elementId);
  await page.mouse.click(at.x, at.y);
  await sleep(900);
}

/** Click empty board area to select the artboard itself. */
async function selectBoardBackground(page, boardId, fx = 0.5, fy = 0.6) {
  const box = await R.rectOf(page, (id) => document.querySelector(`[data-artboard-dom-id="${id}"]`), boardId);
  if (!box) throw new Error('no board ' + boardId);
  await page.mouse.click(box.x + box.w * fx, box.y + box.h * fy);
  await sleep(900);
}

/** Move the mouse somewhere neutral so no hover state or tooltip is left behind. */
async function parkMouse(page, x = 1435, y = 895) {
  await page.mouse.move(x, y);
  await sleep(400);
}

/** Wait until no spinner or skeleton is visible, up to a limit. */
async function waitCalm(page, ms = 20000) {
  const end = Date.now() + ms;
  let h = [];
  while (Date.now() < end) {
    h = (await R.hazards(page)).filter((x) => !x.startsWith('toast'));
    if (!h.length) return [];
    await sleep(500);
  }
  return h;
}

/** Scroll the canvas so a board sits at a given place in the viewport. */
async function canvasScrollBy(page, dx, dy) {
  await page.evaluate(
    (dx, dy) => {
      const board = document.querySelector('[data-artboard-dom-id]');
      let el = board;
      while (el && el !== document.body) {
        const cs = getComputedStyle(el);
        if ((/(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth) || (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight)) {
          el.scrollLeft += dx;
          el.scrollTop += dy;
          return true;
        }
        el = el.parentElement;
      }
      return false;
    },
    dx,
    dy
  );
  await sleep(400);
}

/** The canvas viewport and the union box of some boards, in viewport px. */
async function canvasGeometry(page, boardIds) {
  return page.evaluate((ids) => {
    const boards = (ids && ids.length ? ids.map((id) => document.querySelector(`[data-artboard-dom-id="${id}"]`)) : [...document.querySelectorAll('[data-artboard-dom-id]')]).filter(Boolean);
    if (!boards.length) return null;
    let el = boards[0];
    let scroller = null;
    while (el && el !== document.body) {
      const cs = getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowX) || /(auto|scroll)/.test(cs.overflowY)) {
        scroller = el;
        break;
      }
      el = el.parentElement;
    }
    const v = (scroller || document.documentElement).getBoundingClientRect();
    const rs = boards.map((b) => b.getBoundingClientRect());
    const x1 = Math.min(...rs.map((r) => r.left));
    const y1 = Math.min(...rs.map((r) => r.top));
    const x2 = Math.max(...rs.map((r) => r.right));
    const y2 = Math.max(...rs.map((r) => r.bottom));
    return {
      view: { x: v.left, y: v.top, w: v.width, h: v.height },
      union: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 },
      scrollable: !!scroller,
    };
  }, boardIds || null);
}

/**
 * Zoom (in the editor's 1.2x steps) until the boards fill about `frac` of the
 * visible canvas, then scroll them to the middle of it. `insets` keeps clear of
 * the floating bars: top for the board toolbars, bottom for the zoom pill.
 */
async function fitView(page, { boardIds = null, frac = 0.86, insets = { top: 60, bottom: 70, left: 16, right: 16 }, debug = false } = {}) {
  // Zoom steps are 1.2x, and the boards ease to their new size, so the number
  // of steps is worked out once from a settled measurement, then checked.
  for (let pass = 0; pass < 3; pass++) {
    await sleep(900);
    const g = await canvasGeometry(page, boardIds);
    if (!g) {
      if (debug) console.log('fitView: no geometry for', boardIds);
      return null;
    }
    const availW = g.view.w - insets.left - insets.right;
    const availH = g.view.h - insets.top - insets.bottom;
    const ratio = Math.max(g.union.w / (availW * frac), g.union.h / (availH * frac));
    // Largest zoom whose ratio stays at or under 1.
    const steps = Math.floor(Math.log(1 / ratio) / Math.log(1.2) + 1e-6);
    if (debug) console.log('fitView pass', pass, JSON.stringify(g), 'ratio', ratio.toFixed(3), 'steps', steps, 'zoom', await zoomLevel(page));
    if (steps === 0) break;
    await zoomBy(page, steps);
  }
  await sleep(900);
  return centerView(page, { boardIds, insets });
}

/** Scroll the canvas so the boards sit in the middle of the clear area. */
async function centerView(page, { boardIds = null, insets = { top: 60, bottom: 70, left: 16, right: 16 }, dx = 0, dy = 0 } = {}) {
  for (let i = 0; i < 3; i++) {
    const g = await canvasGeometry(page, boardIds);
    if (!g) return null;
    const cx = g.view.x + insets.left + (g.view.w - insets.left - insets.right) / 2 + dx;
    const cy = g.view.y + insets.top + (g.view.h - insets.top - insets.bottom) / 2 + dy;
    const ux = g.union.x + g.union.w / 2;
    const uy = g.union.y + g.union.h / 2;
    const mx = Math.round(ux - cx);
    const my = Math.round(uy - cy);
    if (Math.abs(mx) < 2 && Math.abs(my) < 2) return g;
    await panCanvas(page, mx, my);
  }
  return canvasGeometry(page, boardIds);
}

/** Move the canvas content by (dx, dy) screen px: scroll if it scrolls, else wheel-pan. */
async function panCanvas(page, dx, dy) {
  const moved = await page.evaluate(
    (dx, dy) => {
      const board = document.querySelector('[data-artboard-dom-id]');
      let el = board;
      while (el && el !== document.body) {
        const cs = getComputedStyle(el);
        if (/(auto|scroll)/.test(cs.overflowX) || /(auto|scroll)/.test(cs.overflowY)) {
          const bx = el.scrollLeft;
          const by = el.scrollTop;
          el.scrollLeft += dx;
          el.scrollTop += dy;
          return el.scrollLeft !== bx || el.scrollTop !== by;
        }
        el = el.parentElement;
      }
      return false;
    },
    dx,
    dy
  );
  // The canvas pans by scrolling, so it stops at the edge of what is on it. No
  // wheel here: a wheel over the canvas zooms.
  await sleep(450);
  return moved;
}

module.exports = {
  canvasGeometry,
  fitView,
  centerView,
  panCanvas,
  setInput,
  renameProject,
  zoomLevel,
  zoomBy,
  resetZoom,
  create,
  openMenu,
  closeMenus,
  dockTab,
  paletteTab,
  selectElement,
  selectBoardBackground,
  parkMouse,
  waitCalm,
  canvasScrollBy,
};

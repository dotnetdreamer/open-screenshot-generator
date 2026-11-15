// Shots 2 and 6: Juniper in the editor (Droply Habits made into Juniper by buildJuniper).
//   editor.png              boards 1 to 3, board 1's headline selected, Text Properties open
//   editor-color.png        board 1 selected, its background colour field and Color Presets open
//   languages/menu.png      the Language menu open: English, Deutsch, 日本語, العربية
//   languages/editor-<lang>.png  the same canvas showing each language (menu closed)
//   languages/compare.png   Preview > Compare languages, every language side by side
//   node cap-editor.cjs [--only editor|languages]
const fs = require('fs');
const path = require('path');
const C = require('./common.cjs');

const OUT = C.OUT;
const LANG_OUT = path.join(OUT, 'languages');
const only = (() => {
  const i = process.argv.indexOf('--only');
  return i > 0 ? process.argv[i + 1] : null;
})();

const dockPanel = () => {
  // The active right-dock panel (Properties), scoped to the active tab panel.
  const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.trim() === 'Properties' && t.getAttribute('data-state') === 'active');
  const id = tab && tab.getAttribute('aria-controls');
  return id ? document.getElementById(id) : null;
};

/** Drag the divider between Properties and Layers until the Layers section is `height` px. */
async function dragLayersTo(page, height) {
  const info = await page.evaluate(() => {
    const sep = [...document.querySelectorAll('[role="separator"][title="Drag to resize"]')].find((n) => n.getBoundingClientRect().left > innerWidth / 2);
    const layers = sep && sep.nextElementSibling;
    const r = sep.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, layers: layers ? layers.getBoundingClientRect().height : null };
  });
  const dy = info.layers - height;
  await page.mouse.move(info.x, info.y);
  await page.mouse.down();
  await page.mouse.move(info.x, info.y + Math.sign(dy) * 3);
  await page.mouse.move(info.x, info.y + dy, { steps: 10 });
  await page.mouse.up();
  await C.sleep(500);
}

async function selectHeadline(page, boardIndex, elementId) {
  const r = await C.rect(page, (id) => document.querySelector(`[data-artboard-dom-id] [data-element-id="${id}"]`), elementId);
  // A point inside the text's own lines, not the empty top of its box.
  const textBox = await C.rect(
    page,
    (id) => {
      const el = document.querySelector(`[data-artboard-dom-id] [data-element-id="${id}"]`);
      const spans = [...el.querySelectorAll('*')].filter((n) => n.childElementCount === 0 && (n.textContent || '').trim());
      return spans[0] || el;
    },
    elementId
  );
  await page.mouse.click(textBox.x + Math.min(40, textBox.w / 3), textBox.y + textBox.h / 2);
  await C.sleep(900);
  return r;
}

(async () => {
  fs.mkdirSync(LANG_OUT, { recursive: true });
  // A shorter Layers section, so the Properties panel has room for the text controls.
  const { page, close } = await C.openEditor({ theme: 'dark', dpr: 2, storage: { 'abs-right-dock-layers-height': '150' } });
  try {
    await C.openTemplate(page, 'Droply Habits');
    await C.buildJuniper(page); // also renames the project to Juniper
    await C.settle(page, 3000);
    await C.clearToasts(page);
    const framed = await C.frameThree(page);
    console.log('zoom', await C.zoomLevel(page), 'boards', framed.boards.slice(0, 4).map((b) => `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)}`).join(' | '));
    await C.settle(page, 1500);

    if (!only || only === 'editor') {
      // ---- editor.png: board 1's headline selected --------------------------------------
      await selectHeadline(page, 0, 'tpl_dr_ab1_headline');
      await C.waitFor(page, `[...document.querySelectorAll('[role="tabpanel"][data-state="active"]')].some((p) => /Text Properties/.test(p.textContent || ''))`, 20000);
      // Scroll the panel past Position and size, so it opens on "Continue across artboards"
      // and Content, Font Family, Font Size and Color all show below it.
      const scrolled = await page.evaluate(() => {
        let box = document.querySelector('#textContent').parentElement;
        while (box && !(/auto|scroll/.test(getComputedStyle(box).overflowY) && box.scrollHeight > box.clientHeight + 2)) box = box.parentElement;
        if (!box) return 'no scroller';
        box.scrollTop = 0;
        const b = box.getBoundingClientRect();
        const label = [...box.querySelectorAll('*')].find((n) => n.childElementCount === 0 && (n.textContent || '').trim() === 'Continue across artboards');
        const want = label.getBoundingClientRect().top - b.top - 16;
        box.scrollTop = want;
        const color = document.querySelector('#fontColor').getBoundingClientRect();
        return { want: Math.round(want), scrollTop: box.scrollTop, colorBottom: Math.round(color.bottom), panelBottom: Math.round(b.bottom), fits: color.bottom <= b.bottom - 6 };
      });
      console.log('properties scroll', JSON.stringify(scrolled));
      await C.parkMouse(page, 1000, 880);
      await C.sleep(600);
      const editorRects = {
        selectedHeadline: await C.rect(page, () => document.querySelector('[data-artboard-dom-id] [data-element-id="tpl_dr_ab1_headline"]')),
        board1: await C.rect(page, () => document.querySelectorAll('[data-artboard-dom-id]')[0]),
        board2: await C.rect(page, () => document.querySelectorAll('[data-artboard-dom-id]')[1]),
        board3: await C.rect(page, () => document.querySelectorAll('[data-artboard-dom-id]')[2]),
        propertiesPanel: await C.rect(page, dockPanel),
        textContent: await C.rect(page, () => document.querySelector('#textContent')),
        fontFamily: await C.rect(page, () => document.querySelector('#fontFamily')),
        fontSize: await C.rect(page, () => document.querySelector('#fontSize')),
        fontColor: await C.rect(page, () => document.querySelector('#fontColor').closest('div.flex') || document.querySelector('#fontColor')),
        fontColorSwatch: await C.rect(page, () => document.querySelector('#fontColor')),
      };
      const selected = await page.evaluate(() => {
        const el = document.querySelector('[data-artboard-dom-id] [data-element-id="tpl_dr_ab1_headline"]');
        return !!(el && el.querySelector('[data-export-exclude="true"][style*="outline"]'));
      });
      console.log('headline selected:', selected);
      await C.shot(page, path.join(OUT, 'editor.png'));
      C.writeRects(OUT, 'editor.png', editorRects);

      // ---- editor-color.png: the board's background colour, presets open ---------------------
      // An empty spot of board 1 (top right corner, above the headline box) selects the board.
      const b1 = editorRects.board1;
      await page.mouse.click(b1.x + b1.w * 0.97, b1.y + b1.h * 0.015);
      await C.sleep(900);
      await C.waitFor(page, `[...document.querySelectorAll('[role="tabpanel"][data-state="active"]')].some((p) => /Artboard Background/.test(p.textContent || ''))`, 20000);
      // A Layers section short enough to sit wholly below the presets popover (which ends
      // about 768px down), so the popover covers nothing of it.
      await dragLayersTo(page, 122);
      const presets = await C.rect(page, () => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Color Presets'));
      await C.clickRect(page, presets);
      await C.waitFor(page, `[...document.querySelectorAll('[data-radix-popper-content-wrapper]')].some((p) => /Color Palette/.test(p.textContent || ''))`, 10000);
      // The popover focuses its first swatch, and the swatch ring then reads as a choice.
      // Focus stays inside the popover (on its own panel), so it stays open.
      await page.evaluate(() => {
        const content = [...document.querySelectorAll('[data-radix-popper-content-wrapper] > *')].find((p) => /Color Palette/.test(p.textContent || ''));
        if (!content.hasAttribute('tabindex')) content.setAttribute('tabindex', '-1');
        content.focus({ preventScroll: true });
      });
      await C.parkMouse(page, 1000, 880);
      await C.sleep(700);
      const overlap = await page.evaluate(() => {
        const pop = [...document.querySelectorAll('[data-radix-popper-content-wrapper] > *')].find((p) => /Color Palette/.test(p.textContent || '')).getBoundingClientRect();
        const sep = [...document.querySelectorAll('[role="separator"][title="Drag to resize"]')].find((n) => n.getBoundingClientRect().left > innerWidth / 2).getBoundingClientRect();
        const rows = [...document.querySelectorAll('[title^="Double-click to rename"]')].filter((n) => n.getBoundingClientRect().left > innerWidth / 2).map((n) => Math.round(n.getBoundingClientRect().bottom));
        return { popoverBottom: Math.round(pop.bottom), separatorTop: Math.round(sep.top), layerRowBottoms: rows };
      });
      console.log('popover vs layers', JSON.stringify(overlap));
      const colorRects = {
        board1: await C.rect(page, () => document.querySelectorAll('[data-artboard-dom-id]')[0]),
        propertiesPanel: await C.rect(page, dockPanel),
        backgroundColor: await C.rect(page, () => document.querySelector('#bgColor').closest('div.flex')),
        backgroundColorSwatch: await C.rect(page, () => document.querySelector('#bgColor')),
        colorPresetsButton: presets,
        colorPresets: await C.rect(page, () => [...document.querySelectorAll('[data-radix-popper-content-wrapper] > *')].find((p) => /Color Palette/.test(p.textContent || ''))),
      };
      // The swatches, in reading order, so the film can point at one.
      const swatches = await page.evaluate(() =>
        [...document.querySelectorAll('[data-radix-popper-content-wrapper] button[title^="#"]')].map((b) => {
          const r = b.getBoundingClientRect();
          return { color: b.title, x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
        })
      );
      swatches.forEach((s, i) => { colorRects[`swatch${i + 1}_${s.color.replace('#', '')}`] = { x: s.x, y: s.y, w: s.w, h: s.h }; });
      const bgValue = await page.evaluate(() => {
        const hex = document.querySelector('#bgColor').closest('div.flex').querySelector('input[type="text"]');
        return hex && hex.value;
      });
      console.log('board 1 background field:', bgValue, 'swatches', swatches.length);
      await C.shot(page, path.join(OUT, 'editor-color.png'));
      C.writeRects(OUT, 'editor-color.png', colorRects);
      await page.keyboard.press('Escape');
      await C.sleep(500);
    }

    if (!only || only === 'languages') {
      // ---- languages ---------------------------------------------------------------------
      // Nothing selected on the canvas, board 1 still the active board.
      const b1 = await C.rect(page, () => document.querySelectorAll('[data-artboard-dom-id]')[0]);
      await page.mouse.click(b1.x + b1.w * 0.97, b1.y + b1.h * 0.015);
      await C.sleep(700);
      const triggerFinder = () => [...document.querySelectorAll('button[title^="Showing "]')][0];
      const trigger = await C.rect(page, triggerFinder);
      const openMenu = async () => {
        await C.clickRect(page, trigger);
        await C.waitFor(page, `!!document.querySelector('[role="menu"]')`, 10000);
        await C.sleep(600);
      };
      await openMenu();
      await C.parkMouse(page, 1000, 880);
      await C.sleep(400);
      const items = await page.evaluate(() =>
        [...document.querySelectorAll('[role="menu"] [role="menuitemcheckbox"]')].map((n) => {
          const r = n.getBoundingClientRect();
          return { text: n.textContent.trim(), x: r.x, y: r.y, w: r.width, h: r.height };
        })
      );
      console.log('menu items', items.map((i) => i.text).join(' | '));
      const r1 = (v) => Math.round(v * 10) / 10;
      const menuRects = {
        trigger,
        menu: await C.rect(page, () => document.querySelector('[role="menu"]')),
      };
      const KEYS = [['English', 'english'], ['Deutsch', 'deutsch'], ['日本語', 'japanese'], ['العربية', 'arabic']];
      for (const [label, key] of KEYS) {
        const it = items.find((i) => i.text.includes(label));
        if (it) menuRects[key] = { x: r1(it.x), y: r1(it.y), w: r1(it.w), h: r1(it.h) };
        else console.log('  !! menu has no', label);
      }
      await C.shot(page, path.join(LANG_OUT, 'menu.png'));
      C.writeRects(LANG_OUT, 'menu.png', menuRects);
      await page.keyboard.press('Escape');
      await C.sleep(500);

      // The same canvas in each language: pick it from the menu the way a person would.
      for (const [label, key, file] of [['Deutsch', 'deutsch', 'editor-de.png'], ['日本語', 'japanese', 'editor-ja.png'], ['العربية', 'arabic', 'editor-ar.png'], ['English', 'english', 'editor-en.png']]) {
        await openMenu();
        const it = await C.rect(page, (label) => [...document.querySelectorAll('[role="menu"] [role="menuitemcheckbox"]')].find((n) => n.textContent.includes(label)), label);
        await C.clickRect(page, it);
        await C.sleep(800);
        await C.settle(page, 2500);
        // The menu hands focus back to its trigger, whose ring would read as a highlight.
        await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
        await C.parkMouse(page, 1000, 880);
        await C.sleep(300);
        await C.shot(page, path.join(LANG_OUT, file));
        C.writeRects(LANG_OUT, file, {
          trigger: await C.rect(page, triggerFinder),
          board1: await C.rect(page, () => document.querySelectorAll('[data-artboard-dom-id]')[0]),
          board2: await C.rect(page, () => document.querySelectorAll('[data-artboard-dom-id]')[1]),
          board3: await C.rect(page, () => document.querySelectorAll('[data-artboard-dom-id]')[2]),
        });
      }

      // ---- Preview > Compare languages ----------------------------------------------------
      await C.lib.clickMenuItem(page, 'Preview the project', 'Compare languages');
      await C.waitFor(page, `[...document.querySelectorAll('[role="dialog"]')].some((d) => (d.textContent || '').includes('Every language'))`, 30000);
      await C.sleep(1500);
      await C.waitFor(page, `document.querySelectorAll('[data-compare-cell] [data-artboard-surface], [data-compare-cell] .artboard').length >= 12`, 30000).catch(() => console.log('  !! fewer live compare cells than expected'));
      await C.settle(page, 3500);
      await C.parkMouse(page, 1439, 899);
      const compareRects = {
        // Every language row with its name: the nearest box holding the first and the last cell.
        compareSheet: await C.rect(page, () => {
          const cells = [...document.querySelectorAll('[data-compare-cell]')];
          let el = cells[0].parentElement;
          while (el && !el.contains(cells[cells.length - 1])) el = el.parentElement;
          return el;
        }),
        header: await C.rect(page, () => {
          const t = [...document.querySelectorAll('[role="dialog"] span')].find((s) => s.textContent.trim() === 'Every language');
          return t.closest('div.flex');
        }),
      };
      const rows = await page.evaluate(() => {
        const cells = [...document.querySelectorAll('[data-compare-cell]')];
        const byRow = {};
        for (const c of cells) {
          const row = c.getAttribute('data-compare-cell').split(':')[0];
          const r = c.getBoundingClientRect();
          (byRow[row] = byRow[row] || []).push(r);
        }
        return Object.entries(byRow).map(([row, rects]) => {
          const x = Math.min(...rects.map((r) => r.x));
          const y = Math.min(...rects.map((r) => r.y));
          const x2 = Math.max(...rects.map((r) => r.right));
          const y2 = Math.max(...rects.map((r) => r.bottom));
          return { row: Number(row), x, y, w: x2 - x, h: y2 - y };
        });
      });
      const rowNames = ['english', 'deutsch', 'japanese', 'arabic'];
      for (const r of rows) compareRects[`row_${rowNames[r.row] || r.row}`] = { x: r1(r.x), y: r1(r.y), w: r1(r.w), h: r1(r.h) };
      // Each row's language name, the line above its boards.
      const labels = await page.evaluate(() =>
        [0, 1, 2, 3].map((row) => {
          const cell = document.querySelector(`[data-compare-cell^="${row}:"]`);
          if (!cell) return null;
          let strip = cell.parentElement;
          let label = strip.previousElementSibling;
          while (!label && strip.parentElement) {
            strip = strip.parentElement;
            label = strip.previousElementSibling;
          }
          // The text itself, not the full-width line it sits on.
          const range = document.createRange();
          range.selectNodeContents(label);
          const b = range.getBoundingClientRect();
          return { text: label.textContent.trim(), x: b.x, y: b.y, w: b.width, h: b.height };
        })
      );
      labels.forEach((l, i) => {
        if (l) compareRects[`label_${rowNames[i]}`] = { x: r1(l.x), y: r1(l.y), w: r1(l.w), h: r1(l.h) };
      });
      console.log('compare labels', JSON.stringify(labels.map((l) => l && l.text)));
      // What the sheet holds: every row of boards with its language name.
      {
        const boxes = Object.entries(compareRects).filter(([k]) => /^(row|label)_/.test(k)).map(([, v]) => v);
        const x = Math.min(...boxes.map((b) => b.x));
        const y = Math.min(...boxes.map((b) => b.y));
        const x2 = Math.max(...boxes.map((b) => b.x + b.w));
        const y2 = Math.max(...boxes.map((b) => b.y + b.h));
        compareRects.compareContent = { x: r1(x), y: r1(y), w: r1(x2 - x), h: r1(y2 - y) };
      }
      const rowLabels = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].map((d) => d.textContent).join(' ').slice(0, 400));
      console.log('compare rows', rows.length, rowLabels.slice(0, 200));
      await C.shot(page, path.join(LANG_OUT, 'compare.png'));
      C.writeRects(LANG_OUT, 'compare.png', compareRects);
    }
  } catch (e) {
    console.error(e);
    await page.screenshot({ path: path.join(__dirname, 'zz-editor-error.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    C.reportBlocked();
    await close();
  }
})();

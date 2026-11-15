// The AI agent: the start screen on the Claude Code tab with Juniper's five English screens and
// the prompt, then the editor with the set Claude Code built and its finished chat in the dock.
//
//   agent-start.png  the start screen, ready to start: the prompt and three of Juniper's screens
//                    (the screen takes three at most, AGENT_LIMITS.maxScreenshots)
//   agent-chat.png   the Juniper set on the canvas, the chat that built it in the Agent dock: the
//                    first turn from the start screen, then the other two screens sent from the dock
//
// Start with Claude Code is pressed for real: the app makes the project, opens the dock, starts
// the (mocked) process and sends the first message. The agent's side is played the way
// the store-screenshot pipeline did it: stream-json lines through
// abs-claude-event, while the same design tools the agent would call (apply_template,
// set_background, add_locales, ...) build the set through the headless bridge.
//
//   node cap-agent.cjs
const fs = require('fs');
const path = require('path');
const F = require('./flows-lib.cjs');
const { sleep } = F;
const { mcp, BOARDS, LANGS } = F.juniper;

const PROMPT = 'Make App Store screenshots for Juniper, my habit tracker, with calm greens and short headlines';
const FINAL = 'Your Juniper set is ready: five boards with your screens and a headline on each, in English, German, Japanese and Arabic';
const SCREENS = ['today', 'detail', 'add', 'stats', 'trophies'];
/** What the start screen takes (three at most), and what follows from the dock. */
const FIRST = ['today', 'detail', 'stats'];
const LATER = ['add', 'trophies'];
const FOLLOW_UP = 'Here are the other two screens';
const SESSION = '3f6a1c2e-8b47-4d19-a5e0-6c2d9b7e4f13';

async function waitFor(page, fn, timeout = 30000, ...args) {
  await page.waitForFunction(fn, { timeout, polling: 300 }, ...args);
}

async function park(page, x = 1436, y = 640) {
  await page.mouse.move(x, y);
  await sleep(300);
}

const tool = (id, name, input) => ({
  type: 'assistant',
  uuid: `a-${id}`,
  message: { id: `m-${id}`, content: [{ type: 'tool_use', id, name: `mcp__osg-editor__${name}`, input }] },
});
const result = (id, content) => ({ type: 'user', uuid: `u-${id}`, message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } });
const text = (value) => [{ type: 'text', text: value }];
const say = (id, value) => ({ type: 'assistant', uuid: `t-${id}`, message: { id: `m-${id}`, content: [{ type: 'text', text: value }] } });

/** Claude Code's first turn: the template, the three screens it has, the headlines, then a question. */
function firstTurn({ templateId }) {
  const lines = [
    { type: 'system', subtype: 'init', session_id: SESSION, model: 'claude-opus-5-5', mcp_servers: [{ name: 'osg-editor', status: 'connected' }], apiKeySource: 'none', uuid: 'i1' },
    say('s1', 'Calm greens suit a habit tracker, so I will start from the Droply Habits template, put your screens in the phones and give each board a short headline'),
    tool('t1', 'list_templates', { query: 'habit tracker' }),
    result('t1', text('12 templates')),
    tool('t2', 'get_template', { templateId }),
    result('t2', text('Droply Habits: 5 artboards, 6 device frames, 5 text slots')),
    tool('t3', 'apply_template', { templateId, projectName: 'Juniper' }),
    result('t3', text('Applied Droply Habits: 5 artboards')),
  ];
  BOARDS.forEach((board, i) => {
    lines.push(tool(`b${i}`, 'set_background', { artboardId: board.id, backgroundColor: board.bg }), result(`b${i}`, text('ok')));
  });
  BOARDS.forEach((board, i) => {
    lines.push(tool(`h${i}`, 'update_element', { artboardId: board.id, elementId: board.id + '_headline', content: board.head.en }), result(`h${i}`, text('ok')));
  });
  lines.push(say('s2', 'The five boards are in place with your three screens, so send me your new habit and trophies screens and I will put them in boards 3 and 5'));
  lines.push({ type: 'result', subtype: 'success', is_error: false, result: 'done', num_turns: 15, duration_ms: 96000, session_id: SESSION, uuid: 'r1' });
  return lines;
}

/** The second turn: the two screens, the languages, a look at the result and the summary. */
function secondTurn({ thumb }) {
  return [
    { type: 'system', subtype: 'init', session_id: SESSION, model: 'claude-opus-5-5', mcp_servers: [{ name: 'osg-editor', status: 'connected' }], apiKeySource: 'none', uuid: 'i2' },
    tool('p1', 'update_element', { artboardId: 'tpl_dr_ab3', elementId: 'tpl_dr_ab3_device', screenshotSrc: 'asset:add' }),
    result('p1', text('ok')),
    tool('p2', 'update_element', { artboardId: 'tpl_dr_ab5', elementId: 'tpl_dr_ab5_device_top', screenshotSrc: 'asset:trophies' }),
    result('p2', text('ok')),
    tool('l1', 'add_locales', { locales: ['de-DE', 'ja', 'ar-SA'], autoFont: true, autoFit: true }),
    result('l1', text('Added 3 languages')),
    tool('l2', 'set_localized_texts', { writes: new Array(15).fill(0).map((_, i) => ({ i })) }),
    result('l2', text('Wrote 15 texts')),
    tool('x1', 'export_png', { artboardId: BOARDS[0].id, scale: 0.25 }),
    result('x1', [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: thumb } }, { type: 'text', text: 'Exported Habits at 25%' }]),
    say('s3', FINAL),
    { type: 'result', subtype: 'success', is_error: false, result: 'done', num_turns: 7, duration_ms: 52000, session_id: SESSION, uuid: 'r2' },
  ];
}

(async () => {
  const { page, close } = await F.openFlows({
    storage: { 'abs-right-dock-width': '420' },
  });
  try {
    // The start dialog's agent banner.
    await waitFor(page, () => [...document.querySelectorAll('button')].some((b) => (b.textContent || '').includes('Start with the AI agent')), 90000);
    await sleep(800);
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('Start with the AI agent')).click());
    await waitFor(page, () => [...document.querySelectorAll('[role="dialog"]')].some((d) => (d.textContent || '').includes('Design with the AI agent')), 30000);
    await waitFor(page, () => [...document.querySelectorAll('[role="dialog"]')].some((d) => /Claude Code [\d.]+ is ready/.test(d.textContent || '')), 30000);
    await sleep(600);

    // Three of Juniper's English screens, through the uploader's own file input.
    const input = await page.$('[role="dialog"] input[type="file"][accept="image/*"]');
    if (!input) throw new Error('no file input on the agent screen');
    await input.uploadFile(...FIRST.map((screen) => path.join(F.SCREENS, 'en', `${screen}.png`)));
    await waitFor(page, (n) => document.querySelectorAll('[role="dialog"] ul img[alt$=".png"]').length >= n, 30000, FIRST.length);
    await page.evaluate(() => {
      const t = document.querySelector('#agent-instruction');
      t.spellcheck = false;
    });
    await F.setValue(page, '#agent-instruction', PROMPT);
    await page.evaluate(() => document.activeElement?.blur());
    await sleep(800);

    // The agent screen scrolls inside the dialog, and at this window height the screenshots and
    // Start do not fit in one view. Two frames: the screenshots down to the model and effort, then
    // scrolled to Start.
    const BOX = `() => { const list = document.querySelector('[role="dialog"] ul img[alt$=".png"]')?.closest('ul'); let box = list?.parentElement; while (box && !(box.scrollHeight > box.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement; return box; }`;
    const layout = await page.evaluate(`(() => {
      const box = (${BOX})();
      const top = box.getBoundingClientRect().top - box.scrollTop;
      const list = document.querySelector('[role="dialog"] ul img[alt$=".png"]').closest('ul').getBoundingClientRect();
      const start = [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === 'Start with Claude Code').getBoundingClientRect();
      return { clientHeight: box.clientHeight, scrollHeight: box.scrollHeight, listTop: list.top - top, startBottom: start.bottom - top };
    })()`);
    console.log('agent screen', JSON.stringify(layout));
    const START_RECTS = {
      prompt: `() => document.querySelector('#agent-instruction')`,
      // The three thumbnails themselves, not the full-width list they sit in.
      'attached-screenshots': `() => { const items = [...document.querySelectorAll('[role="dialog"] ul img[alt$=".png"]')].map((img) => img.closest('li').getBoundingClientRect()); if (!items.length) return null; const left = Math.min(...items.map((r) => r.left)); const top = Math.min(...items.map((r) => r.top)); return { x: left, y: top, w: Math.max(...items.map((r) => r.right)) - left, h: Math.max(...items.map((r) => r.bottom)) - top }; }`,
      'start-button': `() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === 'Start with Claude Code')`,
      'tab-claude-code': `() => [...document.querySelectorAll('[role="dialog"] [role="tab"]')].find((t) => t.textContent.trim() === 'Claude Code')`,
      'tab-codex': `() => [...document.querySelectorAll('[role="dialog"] [role="tab"]')].find((t) => t.textContent.trim() === 'Codex')`,
      'claude-ready': `() => [...document.querySelectorAll('[role="dialog"] [role="alert"]')].find((a) => /is ready/.test(a.textContent))`,
      dialog: `() => [...document.querySelectorAll('[role="dialog"]')].find((d) => (d.textContent || '').includes('Design with the AI agent'))`,
    };
    /** Only what is fully in the dialog's view gets a rect. */
    const visibleRects = async () => {
      const rects = await F.measure(page, START_RECTS);
      const view = await page.evaluate(`(() => { const r = (${BOX})().getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; })()`);
      for (const [name, r] of Object.entries(rects)) {
        if (name !== 'dialog' && (r.y < view.top - 1 || r.y + r.h > view.bottom + 1)) {
          console.log('  (not fully in view, left out:', name + ')');
          delete rects[name];
        }
      }
      return rects;
    };
    // Frame 1: the screenshots just under the top edge.
    const first = await F.cleanScroll(page, BOX, { from: layout.listTop - 48, to: layout.listTop - 4, prefer: 'high' });
    console.log('frame 1 scroll', JSON.stringify(first));
    await sleep(500);
    await park(page, 1430, 880);
    const startRects = await visibleRects();
    await F.shot(page, 'agent-start.png');
    F.saveRects('agent-start.png', startRects);
    // Frame 2: scrolled down to Start.
    const second = await F.cleanScroll(page, BOX, { from: layout.startBottom + 4 - layout.clientHeight, prefer: 'low' });
    console.log('frame 2 scroll', JSON.stringify(second));
    if (!second || !second.clean) await page.evaluate(`(() => { const box = (${BOX})(); box.scrollTop = box.scrollHeight; })()`);
    await sleep(500);
    await park(page, 1430, 880);
    const startRects2 = await visibleRects();
    await F.shot(page, 'agent-start-scrolled.png');
    F.saveRects('agent-start-scrolled.png', startRects2);
    if (process.env.STEP === 'start') return;

    // Start: the app makes the project, opens the Agent dock and starts Claude Code.
    await F.clickWhere(page, () => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => x.textContent.trim() === 'Start with Claude Code');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    await waitFor(page, () => window.__E2E_TAURI__.calls.some((c) => c.cmd === 'abs_claude_start'), 60000);
    const spawnId = await page.evaluate(() => window.__E2E_TAURI__.calls.filter((c) => c.cmd === 'abs_claude_start').at(-1).args.args.spawnId);
    await waitFor(page, () => window.__E2E_TAURI__.calls.some((c) => c.cmd === 'abs_claude_send'), 30000);
    await waitFor(page, () => !![...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.trim() === 'Agent' && t.getAttribute('aria-selected') === 'true'), 30000);
    await page.waitForFunction('!!window.__osg && window.__osg.ready', { timeout: 60000, polling: 300 });
    await sleep(1500);

    // What the agent does, through the same design tools.
    const templates = await mcp(page, 'list_templates', { query: 'Droply' });
    const list = Array.isArray(templates) ? templates : templates.templates || templates.results || [];
    const droply = list.find((t) => /Droply Habits/i.test(t.name || t.title || ''));
    if (!droply) throw new Error('Droply Habits not found: ' + JSON.stringify(templates).slice(0, 300));
    const templateId = droply.id || droply.templateId;
    console.log('template', templateId);
    const refs = {};
    const upload = async (screen) => {
      const data = 'data:image/png;base64,' + fs.readFileSync(path.join(F.SCREENS, 'en', `${screen}.png`)).toString('base64');
      const asset = await mcp(page, 'upload_asset', { source: data, name: `${screen}.png` });
      refs[screen] = asset.ref || asset.reference || (asset.id ? `asset:${asset.id}` : asset);
    };
    for (const screen of FIRST) await upload(screen);
    const screenshots = [];
    const texts = [];
    for (const board of BOARDS) {
      for (const [elementId, screen] of Object.entries(board.phones)) if (refs[screen]) screenshots.push({ elementId, src: refs[screen] });
      texts.push({ elementId: board.id + '_headline', content: board.head.en });
    }
    const applied = await mcp(page, 'apply_template', { templateId, projectName: 'Juniper', screenshots, texts });
    console.log('applied', JSON.stringify(applied).slice(0, 300));
    for (const board of BOARDS) {
      await mcp(page, 'set_background', { artboardId: board.id, backgroundColor: board.bg });
      await mcp(page, 'update_element', { artboardId: board.id, elementId: board.id + '_headline', content: board.head.en, color: '#F6F2E9' });
    }
    await F.playClaude(page, spawnId, firstTurn({ templateId }));
    await waitFor(page, () => /send me your new habit and trophies screens/.test(document.querySelector('[data-agent-panel]')?.textContent || ''), 30000);
    await sleep(800);

    // The other two screens, from the dock's composer.
    const attach = await page.$('[data-agent-panel] input[type="file"][accept="image/*"]');
    if (!attach) throw new Error('no attach input in the Agent panel');
    await attach.uploadFile(...LATER.map((screen) => path.join(F.SCREENS, 'en', `${screen}.png`)));
    await waitFor(page, (n) => document.querySelectorAll('[data-agent-panel] img[alt$=".png"]').length >= n, 30000, LATER.length);
    await F.setValue(page, '[data-agent-panel] textarea[aria-label="Message the agent"]', FOLLOW_UP);
    await sleep(300);
    // The rename's toast sits over the composer.
    await F.clearToasts(page);
    const sends = await page.evaluate(() => window.__E2E_TAURI__.calls.filter((c) => c.cmd === 'abs_claude_send').length);
    await F.clickWhere(page, () => {
      const b = document.querySelector('[data-agent-panel] button[aria-label="Send"]');
      if (!b || b.disabled) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    await waitFor(page, (n) => window.__E2E_TAURI__.calls.filter((c) => c.cmd === 'abs_claude_send').length > n, 30000, sends);
    for (const screen of LATER) await upload(screen);
    await mcp(page, 'update_element', { artboardId: 'tpl_dr_ab3', elementId: 'tpl_dr_ab3_device', screenshotSrc: refs.add });
    await mcp(page, 'update_element', { artboardId: 'tpl_dr_ab5', elementId: 'tpl_dr_ab5_device_top', screenshotSrc: refs.trophies });
    await mcp(page, 'add_locales', { locales: Object.values(LANGS).filter(Boolean), autoFont: true, autoFit: true });
    const writes = [];
    for (const [lang, locale] of Object.entries(LANGS)) {
      if (!locale) continue;
      for (const board of BOARDS) writes.push({ elementId: board.id + '_headline', artboardId: board.id, locale, text: board.head[lang] });
    }
    await mcp(page, 'set_localized_texts', { writes });
    await F.settle(page, 1500);
    // The agent's own look at board 1, at a quarter size.
    const exported = await page.evaluate(
      (id) => window.__osg.mcp({ jsonrpc: '2.0', id: 77, method: 'tools/call', params: { name: 'export_png', arguments: { artboardId: id, scale: 0.25 } } }),
      BOARDS[0].id
    );
    const image = (exported?.result?.content || []).find((block) => block.type === 'image');
    if (!image) throw new Error('export_png gave no image: ' + JSON.stringify(exported).slice(0, 300));
    const thumb = image.data || image.source?.data;
    const name = await page.evaluate(() => document.querySelector('[title="Double-click to rename project"]')?.textContent?.trim());
    console.log('project name', name);
    if (name !== 'Juniper') await F.setProjectName(page, 'Juniper');

    // The rest of the chat, as Claude Code prints it.
    await F.playClaude(page, spawnId, secondTurn({ thumb }));
    await waitFor(page, (final) => (document.querySelector('[data-agent-panel]')?.textContent || '').includes(final), 30000, FINAL);
    await sleep(1200);

    // The whole set in view beside the dock: the zoom that fits all five boards.
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Escape');
    await sleep(300);
    if (process.env.FOLD === '1') {
      await page.keyboard.down('Control');
      await page.keyboard.press('KeyB');
      await page.keyboard.up('Control');
      await sleep(900);
    }
    const fitCanvas = async () => {
      for (let i = 0; i < 16; i++) {
        const state = await page.evaluate(() => {
          const area = document.querySelector('[data-canvas-area]').getBoundingClientRect();
          const boards = [...document.querySelectorAll('[data-artboard-dom-id]')].map((n) => n.getBoundingClientRect());
          const left = Math.min(...boards.map((r) => r.left));
          const right = Math.max(...boards.map((r) => r.right));
          const top = Math.min(...boards.map((r) => r.top));
          const bottom = Math.max(...boards.map((r) => r.bottom));
          const w = right - left;
          const h = bottom - top;
          return { tooBig: w > area.width - 48 || h > area.height - 120, roomy: w * 1.2 < area.width - 48 && h * 1.2 < area.height - 120, area: { w: area.width, h: area.height }, set: { w, h } };
        });
        if (state.tooBig) await page.evaluate(() => document.querySelector('button[title="Zoom Out"]').click());
        else if (state.roomy) await page.evaluate(() => document.querySelector('button[title="Zoom In"]').click());
        else return state;
        await sleep(400);
      }
      return null;
    };
    console.log('canvas', JSON.stringify(await fitCanvas()));
    await F.settle(page, 2000);
    await F.clearToasts(page);
    // The chat from the second message to the summary, nothing cut at its edges.
    const CHAT = `() => document.querySelector('[data-agent-panel] .overflow-y-auto')`;
    await page.evaluate(`(() => { const box = (${CHAT})(); box.scrollTop = box.scrollHeight; })()`);
    await sleep(600);
    // The end of the chat in view; the top edge between two lines (a step list may be cut there,
    // as it is in any chat scrolled to its end).
    // The summary at the bottom is what matters, so the box stays within the last few pixels of
    // its end, where the bottom edge is in the padding under the summary.
    const chatMax = await page.evaluate(`(() => { const box = (${CHAT})(); return box.scrollHeight - box.clientHeight; })()`);
    let chatFit = await F.cleanScroll(page, CHAT, { from: chatMax - 11, prefer: 'high', atoms: 'p,li,img,button,.rounded-2xl', slack: 6 });
    if (!chatFit || !chatFit.clean) {
      await page.evaluate(`(() => { const box = (${CHAT})(); box.scrollTop = box.scrollHeight; })()`);
      chatFit = { scrollTop: chatMax, clean: false };
    }
    console.log('chat scroll', JSON.stringify(chatFit));
    await sleep(400);
    await park(page, 1240, 22);
    const chatRects = await F.measure(
      page,
      {
        'chat-panel': `() => document.querySelector('[data-agent-panel]')`,
        'last-message': `() => { const rows = document.querySelector('[data-agent-panel] .space-y-3'); return rows ? rows.lastElementChild : null; }`,
        'follow-up-message': `() => [...document.querySelectorAll('[data-agent-panel] .space-y-3 > div')].filter((d) => d.textContent.includes('Here are the other two screens')).pop()`,
        'first-message': `() => { const rows = document.querySelector('[data-agent-panel] .space-y-3'); return rows ? rows.firstElementChild : null; }`,
        'result-thumbnail': `() => document.querySelector('[data-agent-panel] img[alt="The artboard as the agent saw it"]')`,
        canvas: `() => document.querySelector('[data-canvas-area]')`,
        'juniper-set': `() => { const boards = [...document.querySelectorAll('[data-artboard-dom-id]')].map((n) => n.getBoundingClientRect()); const left = Math.min(...boards.map((r) => r.left)); const top = Math.min(...boards.map((r) => r.top)); return { x: left, y: top, w: Math.max(...boards.map((r) => r.right)) - left, h: Math.max(...boards.map((r) => r.bottom)) - top }; }`,
        'agent-tab': `() => [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.trim() === 'Agent')`,
        'project-tab': `() => [...document.querySelectorAll('[data-project-tabs] [role="tab"]')].find((t) => t.textContent.includes('Juniper'))`,
      },
      { clip: CHAT }
    );
    await F.shot(page, 'agent-chat.png');
    F.saveRects('agent-chat.png', chatRects);
  } catch (e) {
    console.error(e);
    await F.shot(page, '_error-agent.png').catch(() => {});
    process.exitCode = 1;
  } finally {
    await close();
  }
})();

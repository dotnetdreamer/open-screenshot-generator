// Verifies the Claude Code agent end to end on the DESKTOP app: a real `claude`
// process on the signed-in Claude plan, the app's MCP server, and the Agent
// panel in the dock.
//
// Prerequisites:
//   - Claude Code installed and signed in (`claude auth status` says loggedIn).
//   - The app running with WebView2's inspector port open, for example
//       WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333 npm run tauri:dev
// Then, from the repo root:
//   node .claude/skills/app-screenshots/scripts/verify-claude-agent-desktop.js
//
// It spends real usage on the plan, so it asks for Haiku and small jobs.
// AGENT_MODEL=sonnet (or opus, fable, default) picks another model.
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PORT = process.env.WEBVIEW_PORT || 9333;
const MODEL = process.env.AGENT_MODEL || 'haiku';
const OUT = process.env.OUT_DIR || path.join(process.env.TEMP || '/tmp', 'claude-agent-verify');
const SCREENSHOT = path.resolve(__dirname, '../../../../public/data/projects/amoura-dating-screen-1.png');
const TURN_TIMEOUT = Number(process.env.TURN_TIMEOUT_MS || 6 * 60_000);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MODEL_LABELS = { default: 'Your default model', fable: 'Fable', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' };

(async () => {
  const failures = [];
  const check = (name, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
    if (!ok) failures.push(name);
  };

  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null });
  const pages = await browser.pages();
  const page = pages.find((p) => !p.url().includes('panel=') && !p.url().includes('splash') && /localhost|tauri/.test(p.url()));
  if (!page) {
    console.log('FAIL  no editor webview on port', PORT);
    process.exit(1);
  }
  page.on('pageerror', (e) => console.log('      [pageerror]', String(e).slice(0, 2500)));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('      [console.error]', m.text().slice(0, 300));
  });

  const shot = async (name) => {
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file });
    console.log('      screenshot', file);
  };
  const clickText = (selector, text) =>
    page.evaluate(
      ({ selector, text }) => {
        const el = [...document.querySelectorAll(selector)].find((node) => (node.textContent || '').trim().includes(text));
        if (el) el.click();
        return !!el;
      },
      { selector, text }
    );
  const mouseClick = async (handle) => {
    // The window is small and the dialog scrolls: a click at a box below the
    // fold lands on the overlay and dismisses the dialog.
    await handle.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await sleep(200);
    const box = await handle.boundingBox();
    if (!box) return false;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    return true;
  };
  const agentPanel = () => page.$('[data-agent-panel]');
  const panelText = () => page.evaluate(() => document.querySelector('[data-agent-panel]')?.innerText ?? '');
  const waitForTurn = async (label) => {
    const started = Date.now();
    let last = '';
    while (Date.now() - started < TURN_TIMEOUT) {
      const state = await page.evaluate(() => {
        const panel = document.querySelector('[data-agent-panel]');
        if (!panel) return { present: false };
        const busy = [...panel.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === 'Stop');
        const steps = [...panel.querySelectorAll('li')].map((li) => (li.textContent || '').trim()).slice(-1)[0] || '';
        return { present: true, busy, steps };
      });
      if (state.present && state.steps && state.steps !== last) {
        last = state.steps;
        console.log(`      ${label}: ${last.slice(0, 100)}`);
      }
      if (state.present && !state.busy) return Date.now() - started;
      await sleep(1500);
    }
    return null;
  };

  try {
    check('the editor is running inside Tauri', await page.evaluate(() => '__TAURI_INTERNALS__' in window));

    // A clean chat, and no tips dialog in the way.
    await page.evaluate(() => {
      localStorage.removeItem('osg-claude-agent-v1');
      localStorage.setItem('open-screenshot-generator.show-startup-tips', '0');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction('document.querySelector("[role=dialog]") || document.querySelector("[data-artboard-dom-id]")', { polling: 500, timeout: 60_000 });
    await sleep(1500);

    // Into the agent screen, from wherever the editor is.
    if (!(await page.evaluate(() => !!document.querySelector('[role="dialog"]')))) {
      await page.evaluate(() => document.querySelector('button[title="Select Template"]')?.click());
      await sleep(1000);
    }
    check('the start dialog has the agent entry', await clickText('button', 'Start with the AI agent'));
    await page.waitForFunction('[...document.querySelectorAll("[role=tab]")].some(t => t.textContent.trim() === "Claude Code")', { polling: 500, timeout: 20_000 });
    const firstTab = await page.evaluate(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.textContent.includes('Design with the AI agent'));
      const tab = dialog?.querySelector('[role="tab"]');
      return { text: tab?.textContent.trim(), selected: tab?.getAttribute('aria-selected'), logo: !!tab?.querySelector('svg') };
    });
    check('Claude Code is the first tab, selected, with its logo', firstTab.text === 'Claude Code' && firstTab.selected === 'true' && firstTab.logo, JSON.stringify(firstTab));

    await page.waitForFunction('document.body.innerText.includes("is ready") || document.body.innerText.includes("not installed") || document.body.innerText.includes("not signed in")', { polling: 500, timeout: 60_000 });
    const ready = await page.evaluate(() => (document.body.innerText.match(/Claude Code [\d.]+ is ready/) || [null])[0]);
    check('Claude Code is detected and signed in', !!ready, ready || '');
    await shot('01-agent-tab');
    if (!ready) throw new Error('Claude Code is not ready on this machine');

    // Model: Radix Select wants a real pointer.
    const trigger = await page.$('#claude-code-model');
    await mouseClick(trigger);
    await sleep(500);
    const option = await page.evaluateHandle((label) => [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent.trim() === label), MODEL_LABELS[MODEL] || MODEL);
    if (option.asElement()) await mouseClick(option.asElement());
    await sleep(300);

    // One screenshot and an instruction. WebView2 does not raise a file chooser
    // over CDP for a scripted click, so the file goes straight onto the input.
    const fileInput = await page.$('[role="dialog"] input[type="file"]');
    check('the screenshot uploader is there', !!fileInput);
    if (fileInput) await fileInput.uploadFile(SCREENSHOT);
    await page.waitForFunction('document.querySelectorAll("[role=dialog] img").length > 0', { polling: 500, timeout: 20_000 }).catch(() => {});
    await page.type('#agent-instruction', 'One App Store screenshot for a dating app called Amoura: a soft pink gradient background, a short headline at the top and my screenshot in an iPhone frame. Keep it to one artboard.');
    await sleep(300);

    const before = Date.now();
    check('Start with Claude Code is clickable', await clickText('button', 'Start with Claude Code'));
    await page.waitForFunction('!document.body.innerText.includes("Design with the AI agent")', { polling: 500, timeout: 60_000 });
    check('the dialog closed onto a project', await page.evaluate(() => document.querySelectorAll('[data-artboard-dom-id]').length >= 1));
    await page.waitForFunction('!!document.querySelector("[data-agent-panel]")', { polling: 500, timeout: 20_000 });
    const agentTabSelected = await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.trim() === 'Agent')?.getAttribute('aria-selected'));
    check('the Agent tab opened in the dock', agentTabSelected === 'true');
    await shot('02-agent-started');

    const took = await waitForTurn('turn 1');
    check('the first turn finished', took !== null, took ? `${Math.round(took / 1000)}s` : 'timed out');
    const afterFirst = await page.evaluate(() => ({
      elements: document.querySelectorAll('[data-element-id]').length,
      boards: document.querySelectorAll('[data-artboard-dom-id]').length,
    }));
    check('the agent put elements on the canvas', afterFirst.elements >= 2, JSON.stringify(afterFirst));
    const transcript = await panelText();
    check('the transcript shows tool steps', /Added|Applied|Edited|Changed|Looked at/.test(transcript));
    check('no error notice in the transcript', !/Claude Code stopped|not signed in|could not reach the design tools/i.test(transcript));
    console.log('      --- transcript ---\n' + transcript.split('\n').map((l) => '      | ' + l).join('\n'));
    await shot('03-first-design');

    // A follow-up, with the artboard as context.
    const backgroundOf = () =>
      page.evaluate(() => {
        const board = document.querySelector('[data-artboard-dom-id]');
        if (!board) return null;
        const style = getComputedStyle(board);
        return `${style.backgroundColor} ${style.backgroundImage}`.slice(0, 200);
      });
    const bgBefore = await backgroundOf();
    await page.type('textarea[aria-label="Message the agent"]', 'Make the background a dark navy blue, solid, no gradient.');
    await page.keyboard.press('Enter');
    await sleep(1500);
    const took2 = await waitForTurn('turn 2');
    check('the follow-up finished', took2 !== null, took2 ? `${Math.round(took2 / 1000)}s` : 'timed out');
    const bgAfter = await backgroundOf();
    check('the follow-up changed the background', bgAfter !== bgBefore, `${bgBefore} -> ${bgAfter}`);
    await shot('04-follow-up');

    // Stop in the middle of a turn.
    await page.type('textarea[aria-label="Message the agent"]', 'Duplicate this artboard three times and write a different headline on each copy.');
    await page.keyboard.press('Enter');
    await sleep(6000);
    const stopped = await clickText('[data-agent-panel] button', 'Stop');
    check('Stop is offered while it works', stopped);
    if (stopped) {
      await page.waitForFunction('[...document.querySelectorAll("[data-agent-panel] button")].some(b => b.getAttribute("aria-label") === "Send")', { polling: 500, timeout: 30_000 }).catch(() => {});
      const afterStop = await panelText();
      check('the turn ends as Stopped', /\bStopped\b/.test(afterStop));
    }
    await shot('05-stopped');

    // A new chat empties the panel.
    await page.evaluate(() => document.querySelector('[data-agent-panel] button[aria-label="Start a new chat"]')?.click());
    await sleep(1000);
    check('a new chat empties the panel', /Talk to the agent/.test(await panelText()));
    console.log(`      total ${Math.round((Date.now() - before) / 1000)}s`);
  } catch (error) {
    console.log('FAIL  crashed:', error && error.message);
    failures.push('crash');
    await shot('99-crash').catch(() => {});
  } finally {
    browser.disconnect();
  }

  console.log(failures.length ? `\n${failures.length} check(s) failed: ${failures.join(', ')}` : '\nall checks passed');
  process.exit(failures.length ? 1 : 0);
})();

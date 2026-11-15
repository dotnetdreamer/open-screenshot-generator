// Growth footage for the feature reel's third chapter, "see how your app is
// doing": Juniper's overview, the new screenshots' verdict, Competitors and a
// rival's new screenshots, Keywords, the review inbox, an AI reply and the
// review summary. One seeded session runs the shots asked for, in order.
//
//   node capture.cjs                      every shot
//   node capture.cjs overview keywords    some of them
// Shots: overview impact competitors alert keywords reviews reply summary
const path = require('path');
const url = require('url');
const g = require('./glib.cjs');

const ALL = ['overview', 'impact', 'competitors', 'alert', 'keywords', 'reviews', 'reply', 'summary'];
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const runs = (name) => wanted.includes(name);

const REPLY =
  'Thank you for telling us, and sorry for the trouble! Version 2.5 fixes the crash on launch and keeps every streak safe, and it is with Apple for review now';

(async () => {
  const { buildSeed, DAYLINE, SETS, REVIEW_KINDS } = await import(url.pathToFileURL(path.join(__dirname, 'seed.mjs')).href);
  const seed = await buildSeed();
  const { browser, page, blocked, profile } = await g.openEditor({ rules: seed.rules });
  try {
    await g.seedAndReload(page, seed);
    await g.openGrowth(page);
    await g.sleep(1500);

    // --- 1 and 2: the overview, and the verdict on the new screenshots ---------------------
    if (runs('overview') || runs('impact')) {
      await g.goSection(page, 'Overview');
      await page.waitForSelector('[data-testid="growth-impact"]', { visible: true, timeout: 30000 });
      await g.pickSelect(page, 'Date range', process.env.RANGE || 'Last 28 days');
      await g.clickReal(page, 'button', 'Download rate', { scope: '[data-testid="growth-view"] main' });
      await page.waitForFunction(() => (document.querySelector('[data-testid="growth-view"] main')?.textContent || '').includes('Download rate by day'), { timeout: 15000, polling: 300 });
      await page.mouse.move(1430, 890);
      await g.settleImages(page, 2500);
      await g.clearToasts(page);
      const tiles = await overviewTileRects(page);
      const impact = await impactRects(page);
      if (runs('overview')) {
        await g.shot(page, 'overview.png');
        g.saveRects('overview.png', {
          ...tiles,
          chart: await g.rectOf(page, () => [...document.querySelectorAll('[data-testid="growth-view"] main h3, [data-testid="growth-view"] main p')].find((el) => /by day$/.test((el.textContent || '').trim()))?.closest('.rounded-lg, .rounded-xl, section, div[class*="border"]')),
          'chart-plot': await g.rectOf(page, () => document.querySelector('[data-testid="growth-view"] main .recharts-wrapper')),
          'impact-card': impact['impact-card'],
          'range-select': await g.rectOf(page, () => document.querySelector('[data-testid="growth-view"] [aria-label="Date range"]')),
          'app-picker': await g.rectOf(page, () => document.querySelector('[data-testid="growth-view"] [aria-label="App"]')),
          'nav-overview': await g.rectOf(page, () => [...document.querySelectorAll('[data-testid="growth-view"] nav[aria-label="Growth sections"] button')].find((b) => (b.textContent || '').trim().startsWith('Overview'))),
        });
      }
      if (runs('impact')) {
        await g.shot(page, 'impact.png');
        g.saveRects('impact.png', impact);
      }
    }

    // --- 3 and 4: Competitors, then a rival's new screenshots between two checks -------------
    if (runs('competitors') || runs('alert')) {
      await g.goSection(page, 'Competitors');
      await page.waitForSelector('[data-testid="growth-competitors"]', { visible: true, timeout: 30000 });
      // Opening a list that is due checks it: five countries, about three seconds apart.
      await page.waitForFunction(() => /Checked (just now|\d+ (second|minute))/.test(document.querySelector('[data-testid="growth-competitors-checked"]')?.textContent || ''), { timeout: 90000, polling: 500 });
      await g.sleep(1000);
      if (runs('competitors')) {
        await g.settleImages(page, 1500);
        await g.clearToasts(page);
        // The four apps' rows, whole: scroll the compare panel to the top of the view when it does not fit.
        await alignCompare(page);
        await g.settleImages(page, 800);
        await g.shot(page, 'competitors.png');
        g.saveRects('competitors.png', await competitorRects(page));
      }
      if (runs('alert')) {
        // Dayline ships a new version with a whole new screenshot set.
        const fresh = { version: '3.13.0', currentVersionReleaseDate: `${seed.today}T06:10:00Z`, releaseNotes: 'A fresh new look and goals you can share with a friend', screenshotUrls: SETS.daylineNew };
        await page.evaluate((rules) => {
          window.__E2E_TAURI__.config.http = rules;
        }, seed.lookupRules({ [DAYLINE]: fresh }));
        await page.evaluate(() => document.querySelector('[data-testid="growth-view"] main').scrollTo({ top: 0 }));
        await g.clickReal(page, 'button', 'Check now');
        await page.mouse.move(1430, 890);
        await page.evaluate(() => document.activeElement?.blur());
        await page.waitForFunction(() => [...document.querySelectorAll('[data-rival-change]')].some((card) => /changed its iPhone screenshots/.test(card.textContent || '')), { timeout: 90000, polling: 500 });
        await page.waitForFunction(() => !document.querySelector('[data-testid="growth-competitors"] [role="status"]'), { timeout: 90000, polling: 500 });
        await g.sleep(1200);
        await g.settleImages(page, 1500);
        await g.clearToasts(page);
        await alignChange(page);
        await g.settleImages(page, 800);
        await g.shot(page, 'competitors-alert.png');
        g.saveRects('competitors-alert.png', await alertRects(page));
      }
    }

    // --- 5: Keywords ---------------------------------------------------------------------------
    if (runs('keywords')) {
      await g.goSection(page, 'Keywords');
      await page.waitForSelector('[data-testid="growth-keyword-table"]', { visible: true, timeout: 30000 });
      await g.clickReal(page, '[role="group"][aria-label="Change over"] button', 'Week', { exact: true });
      await g.clickReal(page, 'tr[data-keyword="habit app"] button', 'habit app', { exact: true });
      await page.waitForFunction(() => (document.querySelector('[data-testid="growth-keyword-detail"]')?.textContent || '').includes('"habit app"'), { timeout: 15000, polling: 300 });
      await page.mouse.move(1430, 890);
      await g.settleImages(page, 1200);
      await alignKeywords(page);
      await g.settleImages(page, 1200);
      await g.clearToasts(page);
      await g.shot(page, 'keywords.png');
      g.saveRects('keywords.png', await keywordRects(page));
    }

    // --- 6 and 7: the review inbox, and an AI reply to a crash review --------------------------
    if (runs('reviews') || runs('reply')) {
      await g.goSection(page, 'Reviews');
      await page.waitForSelector('[data-testid="growth-reviews"] [data-review-id]', { visible: true, timeout: 30000 });
      await page.mouse.move(1430, 890);
      await g.settleImages(page, 1500);
      await g.clearToasts(page);
      if (runs('reviews')) {
        await g.shot(page, 'reviews.png');
        g.saveRects('reviews.png', await reviewRects(page));
      }
      if (runs('reply')) {
        const card = '[data-review-id]:first-of-type';
        const first = await page.evaluate(() => {
          const card = [...document.querySelectorAll('[data-review-id]')].find((el) => (el.textContent || '').includes('Crashes on launch'));
          return card?.getAttribute('data-review-id');
        });
        const scope = `[data-review-id="${first}"]`;
        await g.clickReal(page, 'button', 'Reply', { scope, exact: true });
        await page.waitForSelector(`${scope} textarea[aria-label="Reply"]`, { visible: true });
        const suggestButton = await g.rectOf(page, (scope) => [...document.querySelectorAll(`${scope} button`)].find((b) => (b.textContent || '').includes('Suggest a reply')), scope);
        // The moment before the click: the reply box open and empty, "Suggest a reply" waiting.
        await page.mouse.move(1430, 890);
        await g.sleep(600);
        await g.clearToasts(page);
        await g.shot(page, 'reply-open.png', { blur: false });
        g.saveRects('reply-open.png', { ...(await replyRects(page, scope)), 'suggest-button': suggestButton });
        await page.evaluate((reply) => {
          window.__osgPromptDelay = 1200;
          window.__osgPrompt = () => reply;
        }, REPLY);
        await g.clickReal(page, 'button', 'Suggest a reply', { scope });
        await page.waitForFunction((scope, reply) => document.querySelector(`${scope} textarea[aria-label="Reply"]`)?.value === reply, { timeout: 20000, polling: 200 }, scope, REPLY);
        await page.evaluate((scope) => document.querySelector(`${scope} textarea`).blur(), scope);
        await page.mouse.move(1430, 890);
        await g.sleep(800);
        await g.clearToasts(page);
        await g.shot(page, 'reply.png');
        g.saveRects('reply.png', {
          ...(await replyRects(page, scope)),
          // The AI button Suggest a reply was, labelled Write from notes now that the box has text.
          'ai-button': await g.rectOf(page, (scope) => [...document.querySelectorAll(`${scope} button`)].find((b) => (b.textContent || '').trim() === 'Write from notes'), scope),
        });
      }
    }

    // --- 8: the review summary -------------------------------------------------------------------
    if (runs('summary')) {
      await g.goSection(page, 'Review summary');
      await page.waitForSelector('[data-testid="growth-review-summary"]', { visible: true, timeout: 30000 });
      await page.evaluate(installSummaryAnswer, REVIEW_KINDS);
      // The moment before the click: no summary yet, Write summary waiting.
      await page.mouse.move(1430, 890);
      await g.sleep(800);
      await g.clearToasts(page);
      await g.shot(page, 'review-summary-empty.png');
      g.saveRects('review-summary-empty.png', {
        'write-button': await g.rectOf(page, () => [...document.querySelectorAll('[data-testid="growth-review-summary"] button')].find((b) => (b.textContent || '').trim() === 'Write summary')),
        controls: await g.rectOf(page, () => document.querySelector('[data-testid="growth-review-summary"] [aria-label="App to summarize"]')?.closest('.rounded-lg')),
        'nav-review-summary': await g.rectOf(page, () => [...document.querySelectorAll('[data-testid="growth-view"] nav[aria-label="Growth sections"] button')].find((b) => (b.textContent || '').trim().startsWith('Review summary'))),
      });
      await g.clickReal(page, 'button', 'Write summary', { scope: '[data-testid="growth-review-summary"]' });
      await page.waitForSelector('[data-testid="growth-review-summary-card"]', { visible: true, timeout: 30000 });
      await page.mouse.move(1430, 890);
      await g.sleep(1500);
      await g.clearToasts(page);
      await g.shot(page, 'review-summary.png');
      g.saveRects('review-summary.png', {
        ...(await summaryRects(page)),
        // Write a new summary now, where Write summary was before the click.
        'write-button': await g.rectOf(page, () => [...document.querySelectorAll('[data-testid="growth-review-summary"] button')].find((b) => /Write (a new )?summary/.test((b.textContent || '').trim()))),
      });
    }

    const http = await page.evaluate(() => window.__E2E_TAURI__.httpRequests.map((r) => `${r.method} ${r.url}`));
    const unanswered = http.filter((line) => !/itunes\.apple\.com\/(lookup|search)|api\.appstoreconnect\.apple\.com\/v1\/apps\?/.test(line));
    console.log('tauri http:', http.length, 'requests; outside the rules:', unanswered.slice(0, 20));
    console.log('blocked page requests:', [...blocked].slice(0, 30));
    console.log('unhandled tauri commands:', await page.evaluate(() => [...new Set(window.__E2E_TAURI__.unhandled)]));
  } catch (error) {
    console.error(error);
    await g.shot(page, '_error.png').catch(() => {});
  } finally {
    await g.closeBrowser(browser, profile);
  }
})();

// --- the summary's AI answer: themes built from the reviews the prompt lists -------------------

/**
 * Claude Code's answer to the summary prompt, worked out from the reviews the
 * prompt lists: each review's topic is known from the seed (`kinds`, by text),
 * so every theme names exactly the reviews about it, English ones and the
 * newest first, as an AI picking its best examples would.
 */
function installSummaryAnswer(kinds) {
  const THEMES = {
    liked: [
      { kind: 'streak', theme: 'Streaks that keep you going', detail: 'People say watching a streak grow is what brings them back every day' },
      { kind: 'remind', theme: 'Gentle, well timed reminders', detail: 'Reminders arrive at the right moment and never feel pushy' },
      { kind: 'design', theme: 'Simple, clean design', detail: 'A calm layout, home screen widgets and no ads in the way' },
    ],
    disliked: [
      { kind: 'crash', theme: 'Crashes since the last update', detail: 'The app closes on launch, on the stats tab or when adding a habit' },
      { kind: 'price', theme: 'Subscription price', detail: 'Some feel the subscription costs too much for what it adds' },
      { kind: 'sync', theme: 'Sync and lost history', detail: 'Checks that never reach the iPad, and a restore that wiped the history' },
    ],
    requests: [
      { kind: 'pause', theme: 'Pause a habit', detail: 'A way to keep a streak safe on holiday or on a sick day' },
      { kind: 'weekly', theme: 'Weekly goals', detail: 'Some habits fit a weekly target better than a daily one' },
      { kind: 'export', theme: 'Export and a watch version', detail: 'A spreadsheet export and a version for the watch' },
    ],
  };
  const ENGLISH = /United States|United Kingdom|Canada|Australia|India/;
  window.__osgPromptDelay = 2600;
  window.__osgPrompt = (args) => {
    const text = String(args.prompt || '');
    const reviews = [];
    for (const block of text.split(/\n(?=\[r\d+\])/)) {
      const head = /\[(r(\d+))\],\s*(\d) of 5,\s*([^,\n]*)/.exec(block);
      if (!head) continue;
      const kind = Object.entries(kinds).find(([body]) => block.includes(body))?.[1] ?? null;
      reviews.push({ id: head[1], order: Number(head[2]), rating: Number(head[3]), english: ENGLISH.test(head[4]), kind });
    }
    const pick = (group, theme) =>
      reviews
        .filter((review) => review.kind === theme.kind && (group === 'liked' ? review.rating >= 4 : group === 'disliked' ? review.rating <= 3 : true))
        .sort((a, b) => Number(b.english) - Number(a.english) || a.order - b.order)
        .map((review) => review.id);
    const group = (name) =>
      THEMES[name].map((theme) => ({ theme: theme.theme, detail: theme.detail, reviews: pick(name, theme) })).filter((theme) => theme.reviews.length > 0);
    return JSON.stringify({
      headline: 'People love the streaks and gentle reminders, and the last update crashes for some on launch',
      liked: group('liked'),
      disliked: group('disliked'),
      requests: group('requests'),
      ideas: ['Streaks that keep you going', 'Reminders that never nag', 'Calm design and no ads'],
    });
  };
}

// --- framing --------------------------------------------------------------------------------------

/** Scroll Growth's main column so the side by side panel starts at its top, when the panel does not fit below the title. */
async function alignCompare(page) {
  await page.evaluate(() => {
    const main = document.querySelector('[data-testid="growth-view"] main');
    const panel = document.querySelector('[data-testid="growth-competitor-compare"]');
    if (!main || !panel) return;
    main.scrollTo({ top: 0 });
    const room = main.getBoundingClientRect().bottom;
    const box = panel.getBoundingClientRect();
    if (box.bottom > room - 8) main.scrollTo({ top: box.top - main.getBoundingClientRect().top - 16 + main.scrollTop });
  });
  await g.sleep(500);
}

/**
 * Keywords: when the keyword's card on the right does not fit, scroll past the
 * screen's title so the country tabs sit at the top and the card's "Add to
 * keywords" shows whole.
 */
async function alignKeywords(page) {
  await page.evaluate(() => {
    const main = document.querySelector('[data-testid="growth-view"] main');
    const tabs = document.querySelector('[data-testid="growth-keywords"] [role="tablist"][aria-label="Country"]');
    const add = [...document.querySelectorAll('[data-testid="growth-keyword-store-page"] button')].find((b) => (b.textContent || '').trim() === 'Add to keywords');
    if (!main || !tabs || !add) return;
    main.scrollTo({ top: 0 });
    if (add.getBoundingClientRect().bottom <= main.getBoundingClientRect().bottom - 16) return;
    main.scrollTo({ top: tabs.getBoundingClientRect().top - main.getBoundingClientRect().top - 16 });
  });
  await g.sleep(500);
}

/** The new screenshots card whole, from its top. */
async function alignChange(page) {
  await page.evaluate(() => {
    const main = document.querySelector('[data-testid="growth-view"] main');
    const card = [...document.querySelectorAll('[data-rival-change]')].find((el) => /changed its iPhone screenshots/.test(el.textContent || ''));
    if (!main || !card) return;
    main.scrollTo({ top: 0 });
    const room = main.getBoundingClientRect().bottom;
    const box = card.getBoundingClientRect();
    if (box.bottom > room - 8) {
      const panel = card.closest('[data-testid="growth-competitor-changes"]') || card;
      main.scrollTo({ top: panel.getBoundingClientRect().top - main.getBoundingClientRect().top - 16 + main.scrollTop });
    }
  });
  await g.sleep(500);
}

// --- rects ----------------------------------------------------------------------------------------

async function overviewTileRects(page) {
  const names = { 'Times seen': 'tile-times-seen', 'Page visits': 'tile-page-visits', 'Download rate': 'tile-download-rate', 'New downloads': 'tile-new-downloads', Earnings: 'tile-earnings', Rating: 'tile-rating' };
  const out = {};
  for (const [label, key] of Object.entries(names)) {
    out[key] = await g.rectOf(
      page,
      (label) => [...document.querySelectorAll('[data-testid="growth-view"] main button')].find((b) => (b.querySelector('p')?.textContent || '').trim() === label),
      label
    );
  }
  return out;
}

async function impactRects(page) {
  const inCard = (finder) => g.rectOf(page, finder);
  return {
    'impact-card': await inCard(() => document.querySelector('[data-testid="growth-impact"]')),
    question: await inCard(() => [...document.querySelectorAll('[data-testid="growth-impact"] p')].find((p) => (p.textContent || '').trim() === 'Did the new screenshots work?')),
    verdict: await inCard(() => [...document.querySelectorAll('[data-testid="growth-impact"] span')].find((s) => ['Up', 'Down', 'About the same', 'Not sure yet'].includes((s.textContent || '').trim()))),
    before: await inCard(() => [...document.querySelectorAll('[data-testid="growth-impact"] p')].find((p) => (p.textContent || '').trim() === 'Before')?.parentElement),
    after: await inCard(() => [...document.querySelectorAll('[data-testid="growth-impact"] p')].find((p) => (p.textContent || '').trim() === 'After')?.parentElement),
    change: await inCard(() => [...document.querySelectorAll('[data-testid="growth-impact"] p')].find((p) => /^(download rate|downloads per day)$/.test((p.textContent || '').trim()))?.parentElement),
    'days-measured': await inCard(() => [...document.querySelectorAll('[data-testid="growth-impact"] p')].find((p) => /of 14 days measured/.test(p.textContent || ''))),
    'upload-line': await inCard(() => [...document.querySelectorAll('[data-testid="growth-impact"] p')].find((p) => /Uploaded/.test(p.textContent || ''))),
  };
}

async function competitorRects(page) {
  const row = (name) => g.rectOf(page, (name) => document.querySelector(`[data-testid="growth-competitor-row"][data-app-name="${name}"]`), name);
  return {
    compare: await g.rectOf(page, () => document.querySelector('[data-testid="growth-competitor-compare"]')),
    'row-juniper': await row('Juniper: Habit Tracker'),
    'row-dayline': await row('Dayline: Habit Goals'),
    'row-tally': await row('Tally: Daily Routines'),
    'row-brightly': await row('Brightly Habit Tracker'),
    'juniper-shots': await g.rectOf(page, () => document.querySelector('[data-testid="growth-competitor-row"][data-app-name="Juniper: Habit Tracker"] .mt-2.grid')),
    'dayline-shots': await g.rectOf(page, () => document.querySelector('[data-testid="growth-competitor-row"][data-app-name="Dayline: Habit Goals"] .mt-2.grid')),
    'layout-toggle': await g.rectOf(page, () => document.querySelector('[data-testid="growth-competitor-compare"] [role="group"][aria-label="Show"]')),
    'check-now': await g.rectOf(page, () => [...document.querySelectorAll('[data-testid="growth-competitors"] button')].find((b) => (b.textContent || '').trim() === 'Check now')),
    'nav-competitors': await g.rectOf(page, () => [...document.querySelectorAll('[data-testid="growth-view"] nav[aria-label="Growth sections"] button')].find((b) => (b.textContent || '').trim().startsWith('Competitors'))),
  };
}

async function alertRects(page) {
  const card = () => [...document.querySelectorAll('[data-rival-change]')].find((el) => /changed its iPhone screenshots/.test(el.textContent || ''));
  return {
    'changes-panel': await g.rectOf(page, () => document.querySelector('[data-testid="growth-competitor-changes"]')),
    'change-card': await g.rectOf(page, card),
    'change-title': await g.rectOf(page, () => [...document.querySelectorAll('[data-rival-change] p')].find((p) => /changed its iPhone screenshots/.test(p.textContent || ''))),
    'new-badge': await g.rectOf(page, () => [...document.querySelectorAll('[data-rival-change]')].find((el) => /changed its iPhone screenshots/.test(el.textContent || ''))?.querySelector('[data-testid="growth-change-new"]')),
    before: await g.rectOf(page, () => [...document.querySelectorAll('[data-rival-change] p')].find((p) => (p.textContent || '').trim() === 'Before')?.parentElement),
    now: await g.rectOf(page, () => [...document.querySelectorAll('[data-rival-change] p')].find((p) => (p.textContent || '').trim() === 'Now')?.parentElement),
    'compare-with-yours': await g.rectOf(page, () => [...document.querySelectorAll('[data-rival-change] button')].find((b) => (b.textContent || '').trim() === 'Compare with yours')),
    'check-now': await g.rectOf(page, () => [...document.querySelectorAll('[data-testid="growth-competitors"] button')].find((b) => (b.textContent || '').trim() === 'Check now')),
  };
}

async function keywordRects(page) {
  return {
    table: await g.rectOf(page, () => document.querySelector('[data-testid="growth-keyword-table"] table')),
    'table-panel': await g.rectOf(page, () => document.querySelector('[data-testid="growth-keyword-table"]')),
    'row-habit-app': await g.rectOf(page, () => document.querySelector('tr[data-keyword="habit app"]')),
    'row-habit-tracker': await g.rectOf(page, () => document.querySelector('tr[data-keyword="habit tracker"]')),
    'row-streak': await g.rectOf(page, () => document.querySelector('tr[data-keyword="streak"]')),
    'habit-app-change': await g.rectOf(page, () => document.querySelector('tr[data-keyword="habit app"] td:nth-child(3)')),
    'habit-app-rank': await g.rectOf(page, () => document.querySelector('tr[data-keyword="habit app"] td:nth-child(2)')),
    detail: await g.rectOf(page, () => document.querySelector('[data-testid="growth-keyword-detail"]')),
    'rank-chart': await g.rectOf(page, () => document.querySelector('[data-testid="growth-keyword-detail"] [role="img"]')),
    'add-to-keywords': await g.rectOf(page, () => [...document.querySelectorAll('[data-testid="growth-keyword-store-page"] button')].find((b) => (b.textContent || '').trim() === 'Add to keywords')),
    summary: await g.rectOf(page, () => document.querySelector('[data-testid="growth-keyword-summary"]')),
    'country-tabs': await g.rectOf(page, () => document.querySelector('[data-testid="growth-keywords"] [role="tablist"][aria-label="Country"]')),
    'change-over': await g.rectOf(page, () => document.querySelector('[data-testid="growth-keywords"] [role="group"][aria-label="Change over"]')),
    'nav-keywords': await g.rectOf(page, () => [...document.querySelectorAll('[data-testid="growth-view"] nav[aria-label="Growth sections"] button')].find((b) => (b.textContent || '').trim().startsWith('Keywords'))),
  };
}

async function reviewRects(page) {
  const card = (title) => g.rectOf(page, (title) => [...document.querySelectorAll('[data-review-id]')].find((el) => (el.textContent || '').includes(title)), title);
  return {
    'status-tabs': await g.rectOf(page, () => document.querySelector('[data-testid="growth-reviews"] [role="group"][aria-label="Show reviews"]')),
    'todo-tab': await g.rectOf(page, () => [...document.querySelectorAll('[data-testid="growth-reviews"] [aria-label="Show reviews"] button')].find((b) => (b.textContent || '').trim().startsWith('To do'))),
    filters: await g.rectOf(page, () => document.querySelector('[data-testid="growth-reviews"] [aria-label="Search reviews"]')?.closest('.flex.flex-wrap')),
    'review-crashes-on-launch': await card('Crashes on launch'),
    'review-keeps-crashing': await card('Keeps crashing'),
    'reply-button': await g.rectOf(page, () => {
      const card = [...document.querySelectorAll('[data-review-id]')].find((el) => (el.textContent || '').includes('Crashes on launch'));
      return card ? [...card.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Reply') : null;
    }),
    'nav-reviews': await g.rectOf(page, () => [...document.querySelectorAll('[data-testid="growth-view"] nav[aria-label="Growth sections"] button')].find((b) => (b.textContent || '').trim().startsWith('Reviews'))),
  };
}

async function replyRects(page, scope) {
  return {
    'review-card': await g.rectOf(page, (scope) => document.querySelector(scope), scope),
    'review-text': await g.rectOf(page, (scope) => document.querySelector(`${scope} p.whitespace-pre-line`), scope),
    'reply-box': await g.rectOf(page, (scope) => document.querySelector(`${scope} textarea[aria-label="Reply"]`), scope),
    composer: await g.rectOf(page, (scope) => document.querySelector(`${scope} textarea[aria-label="Reply"]`)?.parentElement, scope),
    'send-button': await g.rectOf(page, (scope) => [...document.querySelectorAll(`${scope} button`)].find((b) => (b.textContent || '').trim() === 'Send reply'), scope),
  };
}

async function summaryRects(page) {
  const group = (name) => g.rectOf(page, (name) => document.querySelector(`[data-summary-group="${name}"]`), name);
  return {
    'summary-card': await g.rectOf(page, () => document.querySelector('[data-testid="growth-review-summary-card"]')),
    headline: await g.rectOf(page, () => document.querySelector('[data-testid="growth-review-summary-card"] p.text-base')),
    liked: await group('liked'),
    disliked: await group('disliked'),
    requests: await group('requests'),
    'theme-crashes': await g.rectOf(page, () => document.querySelector('[data-summary-theme="Crashes since the last update"]')),
    ideas: await g.rectOf(page, () => [...document.querySelectorAll('[data-testid="growth-review-summary-card"] p')].find((p) => (p.textContent || '').trim() === 'Lines for your screenshots')?.parentElement),
  };
}

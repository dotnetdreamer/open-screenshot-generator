// The Website view for Juniper: the intro, the site Claude Code wrote (home, support and privacy
// pages in the preview), then the site online at sam-builds.github.io/juniper.
//
//   website-start.png      the intro, with the home page drafted from the screenshots
//   website-home.png       after the AI wrote the site: its answer in Ask AI, the home page
//   website-support.png    the support page, the Support page form beside it
//   website-privacy.png    the privacy policy, the privacy questions beside it
//   website-published.png  published: Online, the three links, the home page at its address
//
// Claude Code's answer is canned (abs_claude_prompt), GitHub answers through the IPC mock's http
// rules, as tests/e2e/specs/website.spec.ts stages them. Nothing reaches GitHub.
//
//   node cap-website.cjs
const fs = require('fs');
const path = require('path');
const F = require('./flows-lib.cjs');
const { sleep } = F;

const WEBSITE = "Website: your app's home, support and privacy pages";
const ICON = path.resolve(__dirname, '..', 'growth', 'assets', 'icon-juniper.png');
const EMAIL = 'hello@juniper.example';

// What Claude Code writes, in the JSON the Website view asks for (src/lib/website/ai.ts).
const SITE = {
  headline: 'Small habits, kept every day',
  subhead: 'Juniper helps you build habits that stick, with a quick check in each day and streaks that keep you going',
  features: [
    { title: 'Your day at a glance', body: 'See every habit for today and tick each one off with a tap', shot: 1 },
    { title: 'Watch your streak grow', body: 'Every day you keep a habit adds to your run, and Juniper shows your longest one so far', shot: 2 },
    { title: 'Reminders right on time', body: 'Pick the days and the times for each habit, and Juniper reminds you then', shot: 3 },
    { title: 'Your week in one view', body: 'See how many habits you finished each day and which days went best', shot: 4 },
    { title: 'A trophy for every run', body: 'Earn trophies as your streaks grow and keep them all in one place', shot: 5 },
  ],
  galleryTitle: 'A look inside Juniper',
  ctaTitle: 'Start your first streak today',
  ctaBody: 'Get Juniper on your iPhone and start with one small habit',
  supportIntro: 'Questions about Juniper? We read every email and write back as soon as we can',
  contactNote: 'Tell us which phone you use and what you were trying to do',
  faqs: [
    { question: 'How do I add a habit?', answer: 'Tap Add habit, give it a name, pick an icon and choose how often you want to do it' },
    { question: 'Can Juniper remind me?', answer: 'Yes, each habit can remind you on the days and at the times you choose' },
    { question: 'Where do I see how my week went?', answer: 'Open Stats to see how many habits you finished on each day of the week' },
    { question: 'Does Juniper collect my data?', answer: "No, Juniper doesn't collect any personal data" },
    { question: "Something isn't working, what can I do?", answer: `Write to ${EMAIL} and tell us what happened` },
  ],
  description: 'Juniper is a calm habit tracker with daily check ins, streaks, reminders and a view of your week',
};

const LOGIN = 'sam-builds';
const REPO = `https://api\\.github\\.com/repos/${LOGIN}/juniper`;
const json = (body, status = 200, headers = {}) => ({ status, body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });
const GITHUB = [
  { match: '^POST https://github\\.com/login/device/code$', ...json({ device_code: 'dev-1', user_code: 'JNPR-4821', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 1 }) },
  { match: '^POST https://github\\.com/login/oauth/access_token$', ...json({ access_token: 'gho_flows_capture', token_type: 'bearer', scope: 'gist,public_repo' }) },
  { match: '^GET https://api\\.github\\.com/user$', ...json({ id: 7, login: LOGIN, name: 'Sam' }, 200, { 'x-oauth-scopes': 'gist, public_repo' }) },
  { match: `^GET ${REPO}$`, ...json({ message: 'Not Found' }, 404) },
  { match: '^POST https://api\\.github\\.com/user/repos$', ...json({ default_branch: 'main', private: false }, 201) },
  { match: `^GET ${REPO}/git/ref/heads/main$`, ...json({ object: { sha: 'head1' } }) },
  { match: `^GET ${REPO}/git/commits/head1$`, ...json({ tree: { sha: 'tree1' } }) },
  { match: `^GET ${REPO}/git/trees/tree1\\?recursive=1$`, ...json({ tree: [{ path: 'README.md', type: 'blob', mode: '100644', sha: 'r1' }] }) },
  { match: `^POST ${REPO}/git/blobs$`, ...json({ sha: 'blob1' }, 201) },
  { match: `^POST ${REPO}/git/trees$`, ...json({ sha: 'tree2' }, 201) },
  { match: `^POST ${REPO}/git/commits$`, ...json({ sha: 'commit2' }, 201) },
  { match: `^PATCH ${REPO}/git/refs/heads/main$`, ...json({ object: { sha: 'commit2' } }) },
  { match: `^GET ${REPO}/pages$`, ...json({ message: 'Not Found' }, 404) },
  { match: `^POST ${REPO}/pages$`, ...json({ html_url: `https://${LOGIN}.github.io/juniper/` }, 201) },
];

async function waitFor(page, fn, timeout = 30000, ...args) {
  await page.waitForFunction(fn, { timeout, polling: 300 }, ...args);
}

async function park(page) {
  await page.mouse.move(1436, 640);
  await sleep(300);
}

/** Click a button in a scope by its exact text (or aria-label). */
async function press(page, scope, text) {
  await F.clickWhere(
    page,
    (scope, text) => {
      const root = document.querySelector(scope) || document;
      const b = [...root.querySelectorAll('button')].find((x) => x.textContent.trim() === text || x.getAttribute('aria-label') === text);
      if (!b) return null;
      b.scrollIntoView({ block: 'nearest' });
      const r = b.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    },
    scope,
    text
  );
  await sleep(400);
}

async function section(page, label) {
  await F.clickWhere(page, (label) => {
    const nav = document.querySelector('nav[aria-label="Website sections"]');
    const b = nav && [...nav.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(label));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, label);
  await sleep(600);
}

async function previewPage(page, label) {
  await F.clickWhere(page, (label) => {
    const group = document.querySelector('[data-testid="website-view"] [role="group"][aria-label="Page"]');
    const b = group && [...group.querySelectorAll('button')].find((x) => x.textContent.trim() === label);
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, label);
  await sleep(800);
}

/** The preview has drawn its page and is not busy. */
async function previewReady(page, h1) {
  await waitFor(page, () => !document.querySelector('[data-testid="website-preview"] [role="status"]'), 60000);
  await waitFor(
    page,
    (h1) => {
      const frame = document.querySelector('[data-testid="website-preview"] iframe');
      const doc = frame?.contentDocument;
      if (!doc?.body) return false;
      if (h1 && !(doc.querySelector('h1')?.textContent || '').includes(h1)) return false;
      // The pictures in view of the frame have arrived; the ones further down load as it scrolls.
      const view = doc.defaultView.innerHeight;
      return [...doc.images].filter((img) => img.getBoundingClientRect().top < view).every((img) => img.complete && img.naturalWidth > 0);
    },
    60000,
    h1 || ''
  ).catch(async (error) => {
    const missing = await page.evaluate(() => {
      const doc = document.querySelector('[data-testid="website-preview"] iframe')?.contentDocument;
      return doc ? [...doc.images].filter((img) => !(img.complete && img.naturalWidth > 0)).map((img) => img.src.slice(0, 80)) : ['no frame'];
    });
    console.log('  !! preview not ready:', String(error.message).slice(0, 80), JSON.stringify(missing).slice(0, 400));
  });
  await page.evaluate(async () => {
    const doc = document.querySelector('[data-testid="website-preview"] iframe').contentDocument;
    await doc.fonts?.ready;
  });
  await sleep(1200);
}

const ASIDE = `() => document.querySelector('[data-testid="website-view"] aside[aria-label="Edit the website"] > div.overflow-y-auto')`;

/** Open a section, scrolled so no line is cut at the edges; the AI chat when there is no such place. */
async function sectionClean(page, label, { maxShift = 400 } = {}) {
  await section(page, label);
  const fit = await F.cleanScroll(page, ASIDE, { from: 0, to: maxShift, prefer: 'low' });
  console.log(`  ${label} panel scroll`, JSON.stringify(fit));
  if (fit && !fit.clean) {
    await section(page, 'Ask AI');
    return 'Ask AI';
  }
  return label;
}

const RECTS = {
  'preview-frame': `() => document.querySelector('[data-testid="website-preview"] > div')`,
  address: `() => document.querySelector('[data-testid="website-preview-address"]')`,
  'page-switcher': `() => document.querySelector('[data-testid="website-view"] [role="group"][aria-label="Page"]')`,
  'publish-button': `() => [...document.querySelectorAll('[data-testid="website-view"] header button')].find((b) => /^Publish/.test(b.textContent.trim()))`,
  'sections-nav': `() => document.querySelector('nav[aria-label="Website sections"]')`,
  'side-panel': `() => document.querySelector('[data-testid="website-view"] aside[aria-label="Edit the website"]')`,
};

(async () => {
  const { page, close } = await F.openFlows({
    responses: { abs_claude_prompt: JSON.stringify(SITE) },
    http: GITHUB,
  });
  try {
    await F.openTemplate(page, 'Droply Habits');
    await F.juniper.buildJuniper(page);
    await F.settle(page, 2000);
    await F.clearToasts(page);

    // The intro.
    await F.openView(page, WEBSITE);
    await waitFor(page, () => !!document.querySelector('[data-testid="website-welcome"]'), 30000);
    await previewReady(page);
    await park(page);
    const startRects = await F.measure(page, {
      'preview-frame': RECTS['preview-frame'],
      address: RECTS.address,
      'make-my-website': `() => [...document.querySelectorAll('[data-testid="website-welcome"] button')].find((b) => b.textContent.trim() === 'Make my website')`,
      intro: `() => document.querySelector('[data-testid="website-welcome"] h2')?.parentElement?.parentElement`,
    });
    await F.shot(page, 'website-start.png');
    F.saveRects('website-start.png', startRects);

    // Make my website: three steps, the AI writes the words.
    await press(page, '[data-testid="website-welcome"]', 'Make my website');
    await waitFor(page, () => !!document.querySelector('[data-testid="website-setup"]'));
    await sleep(600);
    const name = await page.evaluate(() => document.querySelector('#setup-name').value);
    if (name !== 'Juniper') await F.setValue(page, '#setup-name', 'Juniper');
    await F.setValue(page, '#setup-tagline', 'A calm habit tracker for small daily wins');
    await F.setValue(page, '#setup-email', EMAIL);
    await F.setValue(page, '#setup-developer', 'Sam Builds');
    await sleep(300);
    await press(page, '[data-testid="website-setup"]', 'Next');
    await F.clickWhere(page, () => {
      const dialog = document.querySelector('[data-testid="website-setup"]');
      const el = [...dialog.querySelectorAll('label, span, p, button')].find((n) => n.textContent.trim() === 'Nothing');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    await sleep(400);
    await press(page, '[data-testid="website-setup"]', 'Next');
    // English only: the site's other languages would need their words translated first.
    for (const lang of ['Deutsch', '日本語', 'العربية']) {
      const on = await page.evaluate((lang) => {
        const b = [...document.querySelectorAll('[data-testid="website-setup"] button[aria-pressed]')].find((x) => x.textContent.trim() === lang);
        return b ? b.getAttribute('aria-pressed') : null;
      }, lang);
      if (on === 'true') await press(page, '[data-testid="website-setup"]', lang);
    }
    await F.setValue(page, 'textarea[aria-label="Anything the AI should know"]', 'Juniper is for people who want a calm way to build small habits, one day at a time');
    await sleep(300);
    await press(page, '[data-testid="website-setup"] [class*="DialogFooter"], [data-testid="website-setup"]', 'Make my website');
    await waitFor(page, () => !document.querySelector('[data-testid="website-setup"]'), 30000);
    await waitFor(page, () => [...document.querySelectorAll('[data-testid="site-chat-answer"]')].some((n) => /I wrote the home and support pages/.test(n.textContent || '')), 60000);
    await previewReady(page, SITE.headline);

    // The app icon, under Your app.
    if (fs.existsSync(ICON)) {
      await section(page, 'Your app');
      const input = await page.$('[data-testid="website-view"] input[type="file"][accept^="image/png"]');
      if (input) {
        await input.uploadFile(ICON);
        await waitFor(page, () => !!document.querySelector('[data-testid="website-view"] header img'), 20000);
        await sleep(800);
      } else console.log('  !! no icon input');
    } else console.log('  !! no icon file at', ICON);

    // GitHub, so the preview shows the site's own address.
    await section(page, 'Publish');
    await press(page, '[data-testid="website-view"] aside', 'Sign in with GitHub');
    await waitFor(page, (login) => (document.querySelector('[data-testid="website-view"] aside')?.textContent || '').includes(`github.com/${login}`), 30000, LOGIN);
    await sleep(800);

    // Home, with the AI's answer.
    await section(page, 'Ask AI');
    await previewPage(page, 'Home');
    await previewReady(page, SITE.headline);
    await F.clearToasts(page);
    await park(page);
    const homeRects = await F.measure(page, {
      ...RECTS,
      'ai-answer': `() => [...document.querySelectorAll('[data-testid="site-chat-answer"]')].pop()`,
    });
    await F.shot(page, 'website-home.png');
    F.saveRects('website-home.png', homeRects);

    // Support.
    console.log('support panel:', await sectionClean(page, 'Support page'));
    await previewPage(page, 'Support');
    await previewReady(page);
    await park(page);
    await F.shot(page, 'website-support.png');
    F.saveRects('website-support.png', await F.measure(page, RECTS, { clip: ASIDE }));

    // Privacy policy.
    console.log('privacy panel:', await sectionClean(page, 'Privacy policy'));
    await previewPage(page, 'Privacy policy');
    await previewReady(page);
    await park(page);
    await F.shot(page, 'website-privacy.png');
    F.saveRects('website-privacy.png', await F.measure(page, RECTS, { clip: ASIDE }));

    // Publish: one commit, Pages on, then the site answers with this build.
    await section(page, 'Publish');
    await press(page, '[data-testid="website-view"] aside', 'Publish the website');
    await waitFor(
      page,
      () => window.__E2E_TAURI__.httpRequests.some((r) => r.method === 'POST' && /\/git\/trees$/.test(r.url)),
      120000
    );
    const build = await page.evaluate(() => {
      const request = window.__E2E_TAURI__.httpRequests.find((r) => r.method === 'POST' && /\/git\/trees$/.test(r.url));
      const tree = JSON.parse(request.body);
      return JSON.parse(tree.tree.find((entry) => entry.path === 'osg-site.json').content).build;
    });
    await page.evaluate(
      (login, build) =>
        window.__E2E_TAURI__.config.http.unshift({
          match: `^GET https://${login}\\.github\\.io/juniper/osg-site\\.json\\?look=\\d+$`,
          status: 200,
          body: JSON.stringify({ build }),
          headers: { 'content-type': 'application/json' },
        }),
      LOGIN,
      build
    );
    await waitFor(page, () => (document.querySelector('[data-testid="website-status"]')?.textContent || '').trim() === 'Online', 90000);
    await waitFor(page, () => /Your website is online/.test(document.querySelector('[data-testid="website-view"] aside')?.textContent || ''), 30000);
    await previewPage(page, 'Home');
    await previewReady(page, SITE.headline);
    // The links at the top, and nothing cut at the bottom edge.
    const fit = await F.cleanScroll(page, ASIDE, { from: 0, to: 80, prefer: 'low' });
    console.log('published panel scroll', JSON.stringify(fit));
    await F.clearToasts(page);
    await park(page);
    const requests = await page.evaluate(() => window.__E2E_TAURI__.httpRequests.map((r) => r.method + ' ' + r.url));
    console.log('github requests', requests.length, requests.filter((u) => !/blobs$/.test(u)).join('\n  '));
    const publishedRects = await F.measure(page, {
      ...RECTS,
      'site-links': `() => document.querySelector('[data-testid="site-links"]')`,
      'online-status': `() => document.querySelector('[data-testid="website-status"]')`,
      'open-the-site': `() => [...document.querySelectorAll('[data-testid="website-view"] header button')].find((b) => b.textContent.trim() === 'Open the site')`,
      // "Your website is online", its line under it and the three links.
      'online-panel': `() => { const links = document.querySelector('[data-testid="site-links"]'); const title = links?.closest('section')?.querySelector('h2'); if (!links || !title) return null; const a = title.getBoundingClientRect(); const b = links.getBoundingClientRect(); return { x: b.left, y: a.top, w: b.width, h: b.bottom - a.top }; }`,
    }, { clip: ASIDE });
    await F.shot(page, 'website-published.png');
    F.saveRects('website-published.png', publishedRects);
  } catch (e) {
    console.error(e);
    await F.shot(page, '_error-website.png').catch(() => {});
    process.exitCode = 1;
  } finally {
    await close();
  }
})();

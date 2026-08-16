#!/usr/bin/env node
// Seed the community feed with the official showcase posts.
//
//   node infra/vps/seed/seed-showcase.mjs --url https://pb.openscrgen.app
//
// It publishes the bundled templates as posts under ONE account that is openly
// the product's own: @openscreenshot, carrying the verified check, with a bio
// that says what it is. Every post links back to the real template, so "Use as
// template" on one of them opens the actual project rather than a picture of
// one.
//
// ## Why this exists at all
//
// A feed that opens empty asks every visitor to be the first person to post,
// which almost nobody is. The alternative that was NOT taken is worth naming:
// the mock feed this replaced invented two dozen people — names, handles, bios,
// follower counts, and captions written in the first person — and seeding those
// as real records would have put fabricated strangers in a public product.
//
// So there is exactly one seeded account, it is the product, and it says so.
// Nothing here writes a like, a view or a follower count: the counters start at
// zero and the first real number in this feed is a real one.
//
// ## What it needs
//
// The PocketBase superuser, because every collection in this stack is locked to
// superusers and seeding goes in through the record API rather than the public
// routes. Pass it in the environment, never on the command line — an argument
// is visible in `ps` to every user on the box and lands in your shell history:
//
//   OPENSCREENGEN_PB_EMAIL=admin@... OPENSCREENGEN_PB_PASSWORD=... node infra/vps/seed/seed-showcase.mjs
//
// Re-running is safe. Posts are matched by their template id, so a second run
// updates the text of the ones it already made and adds any template that has
// appeared since. It never touches a post anybody else wrote.

import { readFile, readdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const PROJECTS_DIR = join(REPO_ROOT, 'public', 'data', 'projects');

/** Mirrors TEMPLATE_CATEGORIES in src/lib/templateCategories.ts. */
const SURFACE_BY_PREFIX = [
  { surface: 'apple-watch', test: (name) => name.startsWith('watch-') },
  { surface: 'mac', test: (name) => name.startsWith('mac-') },
  { surface: 'app-preview', test: (name) => name.startsWith('pv-') },
  { surface: 'play-feature-graphic', test: (name) => name.startsWith('fg-') },
];

const OFFICIAL = {
  handle: 'openscreenshot',
  name: 'Open Screenshot Generator',
  bio: 'Official account. These are the built-in templates, open any of them as a starting point',
};

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    url: process.env.OPENSCREENGEN_PB_URL || 'http://127.0.0.1:8090',
    perSurface: 6,
    all: false,
    dryRun: false,
    only: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--url') args.url = argv[++i];
    else if (flag === '--per-surface') args.perSurface = Number(argv[++i]);
    else if (flag === '--all') args.all = true;
    else if (flag === '--only') args.only = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (flag === '--dry-run') args.dryRun = true;
    else if (flag === '--help' || flag === '-h') args.help = true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`
Seed the official showcase posts.

  --url <base>          PocketBase base URL (default $OPENSCREENGEN_PB_URL or http://127.0.0.1:8090)
  --per-surface <n>     How many templates per surface to post (default 6)
  --all                 Post every bundled template instead of a spread
  --only <slug,slug>    Post exactly these templates (filename without .json), skipping the spread
  --dry-run             Say what would be posted and change nothing

Credentials come from OPENSCREENGEN_PB_EMAIL and OPENSCREENGEN_PB_PASSWORD, never from a flag.
`);
  process.exit(0);
}

const BASE = String(args.url).replace(/\/+$/, '');

// ---------------------------------------------------------------------------
// PocketBase, over plain fetch
// ---------------------------------------------------------------------------

let token = '';

async function pb(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(token ? { Authorization: token } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} -> ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function authenticate() {
  const identity = process.env.OPENSCREENGEN_PB_EMAIL;
  const password = process.env.OPENSCREENGEN_PB_PASSWORD;
  if (!identity || !password) {
    throw new Error(
      'Set OPENSCREENGEN_PB_EMAIL and OPENSCREENGEN_PB_PASSWORD (the PocketBase superuser). They are read from the environment on purpose: a password in an argument is visible in ps and lands in your shell history.'
    );
  }
  const auth = await pb('/api/collections/_superusers/auth-with-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity, password }),
  });
  token = auth.token;
}

// ---------------------------------------------------------------------------
// The templates
// ---------------------------------------------------------------------------

function surfaceOf(fileName) {
  const match = SURFACE_BY_PREFIX.find((entry) => entry.test(fileName));
  return match ? match.surface : 'screenshots';
}

/**
 * Tags from what the template actually is.
 *
 * Deliberately narrow: the surface, plus whatever the name and description
 * genuinely say. Inventing a taxonomy here would put words on the filter chips
 * that describe nothing anybody made.
 */
/*
 * Word boundaries on every short stem, and they are not decoration.
 *
 * A bare `/eat/` matches "br-eat-hing", "b-eat-forge" and "gr-eat", so the
 * breathing template came out tagged #food and the audio one did too. `/play/`
 * matches "dis-play" and "play-store", which tagged an expense tracker #games.
 * These strings become the filter chips a stranger browses by, so a wrong one
 * is not cosmetic — it is a category that lies about what is in it.
 *
 * `\b` on the left and `\w*` on the right where a real suffix exists
 * ("shopping", "learning"), and a plain `\b...\b` where one does not.
 */
const TAG_RULES = [
  { tag: 'fitness', test: /\b(fitness|workout|yoga|gym|runn?ing|coach\w*|macro\w*|calorie\w*|health\w*)\b/i },
  { tag: 'finance', test: /\b(finance|financial|budget\w*|wallet|bank\w*|expense\w*|invoice\w*|money)\b/i },
  { tag: 'crypto', test: /\b(crypto\w*|coin\w*|token\w*|trading|invest\w*|portfolio)\b/i },
  { tag: 'ai', test: /\b(ai|assistant|answers?|smart|mindful\w*)\b/i },
  { tag: 'social', test: /\b(social|chat\w*|community|messag\w*|friends?|threads?)\b/i },
  { tag: 'music', test: /\b(music|audio|podcast\w*|beats?|listen\w*|sound\w*)\b/i },
  { tag: 'video', test: /\b(video\w*|stream\w*|movies?|binge|flix)\b/i },
  { tag: 'productivity', test: /\b(tasks?|todo|focus|habits?|notes?|planner|desk|work)\b/i },
  { tag: 'travel', test: /\b(travel\w*|trips?|explore|voyage|maps?|tour\w*)\b/i },
  { tag: 'food', test: /\b(food|recipes?|delivery|meals?|eating|feast|nutrition\w*)\b/i },
  { tag: 'shopping', test: /\b(shop\w*|fashion|sneakers?|beauty|glam|luxe|cart)\b/i },
  { tag: 'education', test: /\b(learn\w*|study\w*|students?|books?|reading|lessons?|language\w*|lingua)\b/i },
  { tag: 'wellness', test: /\b(calm|breath\w*|sleep\w*|zen|sereno|lotus|wellness|meditat\w*)\b/i },
  { tag: 'games', test: /\b(games?|puzzles?|arcade|quiz\w*)\b/i },
  { tag: 'darkmode', test: /\b(dark|midnight|black|night)\b/i },
  { tag: 'gradient', test: /\b(gradients?|sunset|aurora|glow\w*)\b/i },
  { tag: 'pastel', test: /\b(pastels?|cream|soft|lavender|beige)\b/i },
  { tag: 'bold', test: /\b(bold|punchy|chunky|heavy)\b/i },
  { tag: 'minimal', test: /\b(minimal\w*|clean|simple)\b/i },
  { tag: '3d', test: /\b(3d|isometric|tilted|mockups?)\b/i },
];

const SURFACE_TAG = {
  screenshots: 'appstore',
  'apple-watch': 'applewatch',
  mac: 'mac',
  'app-preview': 'appreview',
  'play-feature-graphic': 'playstore',
};

function tagsFor(project, surface) {
  // Every description opens with the same boilerplate ("App Store & Play Store
  // screenshots for ..."), and matching against it tagged three quarters of the
  // catalog #shopping off the word "Store". Only the part after "for" describes
  // the app.
  const description = project.description ?? '';
  const meaningful = description.includes(' for ')
    ? description.slice(description.indexOf(' for ') + 5)
    : description;
  const haystack = `${project.name} ${meaningful}`;
  const matched = TAG_RULES.filter((rule) => rule.test.test(haystack)).map((rule) => rule.tag);
  return [...new Set([SURFACE_TAG[surface], ...matched])].slice(0, 5);
}

/**
 * The caption, which is the one place this could have lied and does not.
 *
 * It says what the template is and that it is built in. No first person, no
 * "spent the weekend on this", nothing that reads as a person describing their
 * own work — this account is a product, and the copy has to sound like one.
 */
function captionFor(project) {
  const description = (project.description ?? '').trim();
  const first = description.split(/(?<=[.!?])\s+/)[0] ?? '';
  const lines = ['A built-in template. Open it as a starting point and change anything'];
  if (first && first.length < 220) lines.push(first.replace(/\.$/, ''));
  return lines.join('. ');
}

async function loadTemplates() {
  const files = (await readdir(PROJECTS_DIR)).filter((file) => file.endsWith('.json'));
  const out = [];
  for (const file of files) {
    let project;
    try {
      project = JSON.parse(await readFile(join(PROJECTS_DIR, file), 'utf8'));
    } catch (error) {
      console.warn(`skipping ${file}: ${error.message}`);
      continue;
    }
    const preview = project.previewImage;
    // No preview means no post: a card with no image is worse than one fewer
    // card, and every bundled template has one today.
    if (!preview || preview.includes('placehold.co')) continue;

    const previewPath = join(REPO_ROOT, 'public', preview.replace(/^\//, ''));
    const surface = surfaceOf(file);
    out.push({
      file,
      surface,
      previewPath,
      /*
       * The id the EDITOR knows this template by, which it builds from the
       * filename and not from the `id` field inside the file:
       *
       *   id: `template_${baseName}`   // src/services/projectService.ts
       *
       * Those two strings disagree for 89 of the 96 bundled templates —
       * `fg-alertlab.json` declares `template_alertlab` and the editor calls it
       * `template_fg-alertlab` — and posting the file's own id is what made
       * "Use as template" answer "that design is not available" on every
       * seeded post. The file's id is kept as `legacyId` only so a re-run can
       * find the posts that already went out carrying it.
       */
      id: `template_${file.replace(/\.json$/, '')}`,
      legacyId: project.id,
      name: project.name,
      screens: Array.isArray(project.projectData) ? project.projectData.length : 1,
      title: project.name,
      caption: captionFor(project),
      tags: tagsFor(project, surface),
    });
  }
  return out;
}

/** A spread across every surface rather than 96 posts from one account. */
function curate(templates, perSurface) {
  const bySurface = new Map();
  for (const template of templates) {
    const list = bySurface.get(template.surface) ?? [];
    list.push(template);
    bySurface.set(template.surface, list);
  }
  const out = [];
  for (const [, list] of bySurface) {
    // Sorted by name so a re-run picks the same ones rather than reshuffling
    // the feed every time somebody runs this.
    list.sort((a, b) => a.file.localeCompare(b.file));
    out.push(...list.slice(0, perSurface));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

async function ensureOfficialAccount() {
  const existing = await pb(
    `/api/collections/users/records?perPage=1&filter=${encodeURIComponent(`handle="${OFFICIAL.handle}"`)}`
  );
  if (existing.items?.length) return existing.items[0];

  // The email is never delivered to and never shown; the collection requires
  // one. `emailVisibility` stays false, and no route returns it regardless.
  const password = `seed-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  return pb('/api/collections/users/records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `${OFFICIAL.handle}@openscrgen.app`,
      emailVisibility: false,
      password,
      passwordConfirm: password,
      verified: true,
      handle: OFFICIAL.handle,
      display_name: OFFICIAL.name,
      bio: OFFICIAL.bio,
      // The check on this account is the point: it is what tells a reader that
      // this one is the product and every other one is a person.
      verified_badge: true,
      banned: false,
      followers: 0,
      post_count: 0,
    }),
  });
}

/**
 * The post for this template, under either id it may have been filed under.
 *
 * `legacyId` is checked second and is what makes the id correction a repair
 * rather than a duplication: a re-run finds the post that went out with the
 * file's own id and PATCHes it to the one the editor uses, instead of leaving
 * the broken one in the feed and adding a working twin beside it.
 */
async function findExistingPost(authorId, templateId, legacyId) {
  for (const id of legacyId && legacyId !== templateId ? [templateId, legacyId] : [templateId]) {
    const filter = `author="${authorId}" && template_project_id="${id}"`;
    const found = await pb(
      `/api/collections/posts/records?perPage=1&filter=${encodeURIComponent(filter)}`
    );
    if (found.items?.[0]) return found.items[0];
  }
  return null;
}

async function seedPost(author, template) {
  const existing = await findExistingPost(author.id, template.id, template.legacyId);

  const tagsText = template.tags.length ? `|${template.tags.join('|')}|` : '';
  const searchText = [
    template.title,
    template.caption,
    template.name,
    template.tags.join(' '),
    OFFICIAL.name,
    OFFICIAL.handle,
  ]
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);

  // The preview is a single wide strip of the template's screens, which is
  // exactly the shape a post cover is, so it goes in as the one image with the
  // aspect ratio the template gallery already renders it at.
  const imageMeta = [
    {
      aspect: template.surface === 'play-feature-graphic' ? '1024 / 500' : '3 / 1',
      fit: template.surface === 'play-feature-graphic' ? 'cover' : 'contain',
      label: template.name,
    },
  ];

  const form = new FormData();
  form.set('author', author.id);
  form.set('title', template.title);
  form.set('caption', template.caption);
  form.set('surface', template.surface);
  form.set('app_name', template.name);
  form.set('screens', String(template.screens));
  form.set('template_project_id', template.id);
  form.set('tags', JSON.stringify(template.tags));
  form.set('tags_text', tagsText);
  form.set('search_text', searchText);
  form.set('image_meta', JSON.stringify(imageMeta));
  form.set('hidden', 'false');

  if (existing) {
    // The text is refreshed; the image is left alone. Re-uploading it on every
    // run would orphan the old file, change the URL, and break any link
    // anybody had to it, all to replace a picture with the same picture.
    await pb(`/api/collections/posts/records/${existing.id}`, { method: 'PATCH', body: form });
    return 'updated';
  }

  const bytes = await readFile(template.previewPath);
  form.append('images', new Blob([bytes], { type: 'image/png' }), basename(template.previewPath));
  // Counters start at zero and stay there. Nothing in this feed's numbers is
  // invented.
  form.set('likes', '0');
  form.set('comments', '0');
  form.set('views', '0');
  form.set('remixes', '0');
  await pb('/api/collections/posts/records', { method: 'POST', body: form });
  return 'created';
}

async function main() {
  const templates = await loadTemplates();
  let chosen;
  if (args.only) {
    chosen = templates.filter((t) => args.only.includes(t.file.replace(/\.json$/, '')));
    const missing = args.only.filter((slug) => !chosen.some((t) => t.file === `${slug}.json`));
    // A slug that resolves to nothing is a typo or a template with no preview;
    // either way silence would look like success.
    if (missing.length) {
      throw new Error(`--only names not found on disk (or missing a real previewImage): ${missing.join(', ')}`);
    }
  } else {
    chosen = args.all ? templates : curate(templates, args.perSurface);
  }

  console.log(`${templates.length} templates on disk, ${chosen.length} to post`);
  const bySurface = chosen.reduce((acc, t) => ({ ...acc, [t.surface]: (acc[t.surface] ?? 0) + 1 }), {});
  for (const [surface, count] of Object.entries(bySurface)) {
    console.log(`  ${surface.padEnd(22)} ${count}`);
  }
  if (!args.all && !args.only && templates.length > chosen.length) {
    // Never a silent cap: say what was left out and how to include it.
    console.log(
      `  (${templates.length - chosen.length} left out by --per-surface ${args.perSurface}; pass --all to post everything)`
    );
  }

  if (args.dryRun) {
    for (const template of chosen) {
      console.log(`would post: ${template.title}  [${template.surface}]  #${template.tags.join(' #')}`);
    }
    return;
  }

  await authenticate();
  const author = await ensureOfficialAccount();
  console.log(`posting as @${author.handle} (${author.id})`);

  let created = 0;
  let updated = 0;
  for (const template of chosen) {
    try {
      const result = await seedPost(author, template);
      if (result === 'created') created += 1;
      else updated += 1;
      process.stdout.write(result === 'created' ? '+' : '.');
    } catch (error) {
      process.stdout.write('!');
      console.error(`\n  ${template.file}: ${error.message}`);
    }
  }
  console.log(`\n${created} created, ${updated} updated`);

  // The denormalized count on the account, made to agree with reality rather
  // than incremented per post: a re-run must not treat an update as a new post.
  const mine = await pb(
    `/api/collections/posts/records?perPage=1&filter=${encodeURIComponent(`author="${author.id}"`)}`
  );
  await pb(`/api/collections/users/records/${author.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ post_count: mine.totalItems ?? 0 }),
  });
  console.log(`@${author.handle} now has ${mine.totalItems ?? 0} posts`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

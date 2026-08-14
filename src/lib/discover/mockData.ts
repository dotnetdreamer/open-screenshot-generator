// Mock feed data.
//
// The feed seeds itself from the template catalog the app already loads for the
// "Start a New Project" picker, so every post has a real preview image, a real
// screen count, and a real project behind its "Use as template" button. Nothing
// here is fetched, and nothing here is authored twice: add a template and it
// shows up in Discover as somebody's post.
//
// Everything is derived from a seeded PRNG keyed on the template id, so the
// same template always gets the same author, caption, tags and counters. That
// matters more than it sounds: a feed that reshuffles itself on every render
// makes likes land on the wrong card and makes the whole thing feel broken.
//
// When the backend lands, this file is the part that goes away. api.ts keeps
// its shape.

import type { Project } from '@/types/artboard';
import type {
  DiscoverAuthor,
  DiscoverComment,
  DiscoverPost,
  DiscoverSurface,
} from '@/types/discover';
import { TEMPLATE_CATEGORIES } from '@/lib/templateCategories';

// ---------------------------------------------------------------------------
// Seeded randomness
// ---------------------------------------------------------------------------

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** mulberry32: tiny, fast, and stable across browsers. */
function rngFrom(seed: string): () => number {
  let state = hashString(seed) || 1;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length) % items.length];
}

function intBetween(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

interface AuthorSeed {
  handle: string;
  name: string;
  bio: string;
  followers: number;
  verified?: boolean;
}

// Invented indie developers and small studios. Handles are deliberately
// generic so none of them reads as a real account.
const AUTHOR_SEEDS: AuthorSeed[] = [
  { handle: 'pixelmara', name: 'Mara Ellis', bio: 'Solo dev shipping small apps', followers: 4820, verified: true },
  { handle: 'devkoto', name: 'Koto Arai', bio: 'iOS engineer, design on the side', followers: 2140 },
  { handle: 'studionorth', name: 'Studio North', bio: 'Two people, a lot of app icons', followers: 9310, verified: true },
  { handle: 'sam.builds', name: 'Sam Okafor', bio: 'Building in public since 2021', followers: 1580 },
  { handle: 'lenaux', name: 'Lena Vogt', bio: 'Product designer, mobile first', followers: 6470, verified: true },
  { handle: 'ninebyten', name: 'Nine by Ten', bio: 'Design studio for app founders', followers: 3890 },
  { handle: 'raulcodes', name: 'Raul Medina', bio: 'Flutter, coffee, App Store screenshots', followers: 970 },
  { handle: 'harperux', name: 'Harper Quinn', bio: 'ASO and store listings', followers: 5230 },
  { handle: 'tiny.thunder', name: 'Tiny Thunder', bio: 'Games for short attention spans', followers: 12400, verified: true },
  { handle: 'anyaships', name: 'Anya Petrova', bio: 'Shipping weekly, mostly on time', followers: 2760 },
  { handle: 'joonmakes', name: 'Joon Park', bio: 'Indie apps and side quests', followers: 1840 },
  { handle: 'clarastudio', name: 'Clara Bennett', bio: 'Brand and store visuals', followers: 7120 },
  { handle: 'devon.hq', name: 'Devon Reyes', bio: 'Android dev, reluctant designer', followers: 640 },
  { handle: 'nourdesign', name: 'Nour Haddad', bio: 'Interfaces for calm apps', followers: 4410 },
  { handle: 'bitmoss', name: 'Bitmoss Labs', bio: 'Utilities and small tools', followers: 2280 },
  { handle: 'kaiwrites', name: 'Kai Lindberg', bio: 'Writes the copy, fixes the kerning', followers: 1320 },
  { handle: 'mintlayer', name: 'Mint Layer', bio: 'Design systems for tiny teams', followers: 8050, verified: true },
  { handle: 'priyabuilds', name: 'Priya Nair', bio: 'Fintech apps, lots of charts', followers: 3410 },
  { handle: 'oakandcode', name: 'Oak and Code', bio: 'Studio for health and wellness apps', followers: 5680 },
  { handle: 'tomsketch', name: 'Tom Adeyemi', bio: 'Sketching before coding', followers: 1190 },
  { handle: 'yuzuapps', name: 'Yuzu Apps', bio: 'Small apps, bright colors', followers: 6890 },
  { handle: 'marcoships', name: 'Marco Ferrari', bio: 'Two apps, one cat', followers: 880 },
  { handle: 'sable.studio', name: 'Sable Studio', bio: 'Store graphics on retainer', followers: 4030 },
  { handle: 'ellaux', name: 'Ella Novak', bio: 'Motion and mockups', followers: 2590 },
];

export const MOCK_AUTHORS: DiscoverAuthor[] = AUTHOR_SEEDS.map((seed) => ({
  id: `author_${seed.handle}`,
  handle: seed.handle,
  name: seed.name,
  bio: seed.bio,
  followers: seed.followers,
  verified: seed.verified,
}));

export function findMockAuthor(id: string): DiscoverAuthor | undefined {
  return MOCK_AUTHORS.find((author) => author.id === id);
}

// ---------------------------------------------------------------------------
// Copy generation
// ---------------------------------------------------------------------------

// Tags come from words already in a template's name and description, so they
// describe the design rather than a made up taxonomy. First match wins per
// group, and the surface always contributes one tag.
const TAG_RULES: { tag: string; test: RegExp }[] = [
  { tag: 'fitness', test: /fitness|workout|yoga|gym|run|coach|macro|calorie|health/i },
  { tag: 'finance', test: /finance|budget|wallet|bank|expense|invoice|money/i },
  { tag: 'crypto', test: /crypto|coin|token|trading|invest|portfolio/i },
  { tag: 'ai', test: /\bai\b|assistant|answer|smart|mind|search/i },
  { tag: 'social', test: /social|chat|community|message|friend|thread/i },
  { tag: 'music', test: /music|audio|podcast|beat|listen|sound/i },
  { tag: 'video', test: /video|stream|movie|binge|watch party|flix/i },
  { tag: 'productivity', test: /task|todo|focus|habit|note|plan|desk|work/i },
  { tag: 'travel', test: /travel|trip|explore|voyage|map|tour/i },
  { tag: 'food', test: /food|recipe|delivery|meal|eat|feast|nutri/i },
  { tag: 'shopping', test: /shop|fashion|sneaker|beauty|glam|luxe|cart/i },
  { tag: 'education', test: /learn|study|student|book|read|lesson|language|lingua/i },
  { tag: 'kids', test: /kid|child|parent|story|family/i },
  { tag: 'wellness', test: /calm|breath|mind|sleep|zen|sereno|lotus|wellness/i },
  { tag: 'games', test: /game|puzzle|play|arcade|quiz/i },
  { tag: 'darkmode', test: /dark|midnight|black|night/i },
  { tag: 'gradient', test: /gradient|sunset|aurora|glow/i },
  { tag: 'pastel', test: /pastel|cream|soft|lavender|beige/i },
  { tag: 'bold', test: /bold|punchy|chunky|heavy|big/i },
  { tag: 'minimal', test: /minimal|clean|simple|light/i },
  { tag: '3d', test: /3d|isometric|tilted|mockup/i },
];

const SURFACE_TAG: Record<DiscoverSurface, string> = {
  screenshots: 'appstore',
  'apple-watch': 'applewatch',
  mac: 'mac',
  'app-preview': 'appreview',
  'play-feature-graphic': 'playstore',
};

const TITLE_PATTERNS: Record<DiscoverSurface, string[]> = {
  screenshots: [
    'New store set for {app}',
    '{app} screenshots, second pass',
    'Finally shipped the {app} listing',
    '{app} App Store shots',
    'Redid the whole {app} gallery',
  ],
  'apple-watch': [
    '{app} on the watch',
    'Watch screenshots for {app}',
    '{app} Apple Watch listing',
    'Tiny screens, big headlines: {app}',
  ],
  mac: [
    '{app} for the Mac App Store',
    'Desktop listing for {app}',
    '{app} Mac shots are live',
    'Brought {app} to the Mac',
  ],
  'app-preview': [
    'Preview video frames for {app}',
    '{app} app preview, first cut',
    'Motion pass on the {app} preview',
    '{app} 30 second preview',
  ],
  'play-feature-graphic': [
    'Feature graphic for {app}',
    '{app} Play Store banner',
    'New banner for {app}',
    '{app} feature graphic, take three',
  ],
};

// A wide pool on purpose: with a post per template, a short list puts the same
// sentence on two cards sitting next to each other in the grid.
const CAPTION_OPENERS = [
  'Spent the weekend on this one and it finally clicks',
  'Third version, first one I actually like',
  'Rewrote every headline until they fit on one line',
  'Went brighter than usual and installs went up',
  'Kept the copy short so the screens do the talking',
  'Started from a template and changed almost everything',
  'Tried to make the first screen work on its own',
  'Same layout in nine languages, that part took the longest',
  'Cut it down from seven screens to five and it reads better',
  'Client wanted calm, so calm it is',
  'Small update, mostly type and spacing',
  'This started as a rough idea in a notebook',
  'Two weeks of nudging things three pixels at a time',
  'Threw out the stock photos and it improved immediately',
  'Turns out the old set was the reason nobody installed',
  'Picked the colors off the app icon and stopped fighting it',
  'My designer friend fixed the spacing in ten minutes',
  'Wrote the headlines first, laid it out after',
  'Fourth attempt, and the only one my partner liked',
  'Shipped it before I could talk myself out of it',
  'Half the work was deciding what to leave out',
  'Aiming for something that still reads at thumbnail size',
  'Redid this after watching a friend scroll past the old one',
  'Went with one idea per screen and stuck to it',
];

const CAPTION_CLOSERS = [
  'Feedback welcome, especially on the first screen',
  'Would love to hear what the headline says to you',
  'Open to swaps if anyone wants to trade critiques',
  'Happy to share how the gradient was built',
  'Numbers so far look good, will report back',
  'Next up is the tablet set',
  'Localized versions are coming this week',
  'Still deciding on the last screen',
];

const COMMENT_BODIES = [
  'The type on screen two is doing a lot of work. Nice',
  'That gradient is lovely, what angle did you use',
  'Stealing this layout for my next listing, thank you',
  'First screen sells it on its own, which is the whole trick',
  'How did conversion move after the change',
  'The spacing between the phone and the headline is perfect',
  'Would try one more with a darker background for contrast',
  'This is the cleanest set I have seen this week',
  'Love the color pairing, very easy on the eyes',
  'Did you export at 3x or let the store scale it',
  'Headlines are short and that makes all the difference',
  'The badge in the corner is a nice touch',
  'Looks great on a small screen too, checked on my phone',
  'What font is that on the third screen',
  'This makes me want to redo mine',
  'Good use of white space, nothing feels crowded',
];

/** "App Store screenshots for a calorie tracker" -> "a calorie tracker". */
function subjectFromDescription(description: string): string | null {
  const match = description.match(/for (an?|the) ([^.,:;]{4,60})/i);
  if (!match) return null;
  return `${match[1].toLowerCase()} ${match[2].trim().toLowerCase()}`;
}

/** The style sentence of a template description, trimmed to a caption line. */
function styleFromDescription(description: string): string | null {
  const sentences = description
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const styleSentence = sentences.find(
    (s, index) => index > 0 && !/swap|drop|replace|placeholder|select/i.test(s)
  );
  if (!styleSentence) return null;
  const cleaned = styleSentence.replace(/\.$/, '');
  return cleaned.length > 150 ? `${cleaned.slice(0, 147).trimEnd()}...` : cleaned;
}

function buildTags(project: Project, surface: DiscoverSurface, rng: () => number): string[] {
  // Every template description opens with the same boilerplate ("App Store &
  // Play Store screenshots for ..."), and matching against it tagged three
  // quarters of the feed #shopping off the word "Store". Only the part that
  // describes the app and its style is a real signal.
  const description = project.description ?? '';
  const meaningful = description.includes(' for ')
    ? description.slice(description.indexOf(' for ') + 5)
    : description;
  const haystack = `${project.name} ${meaningful}`;
  const matched = TAG_RULES.filter((rule) => rule.test.test(haystack)).map((rule) => rule.tag);
  const tags = [SURFACE_TAG[surface], ...matched];
  // Keep the list short enough to fit one row on a card, but not identical for
  // every template in a category.
  const limit = intBetween(rng, 3, 5);
  return Array.from(new Set(tags)).slice(0, limit);
}

function buildCaption(project: Project, rng: () => number): string {
  const opener = pick(rng, CAPTION_OPENERS);
  const subject = subjectFromDescription(project.description ?? '');
  const style = styleFromDescription(project.description ?? '');
  const lines: string[] = [];
  lines.push(subject ? `${opener}. Store set for ${subject}` : opener);
  if (style && rng() > 0.25) lines.push(style);
  if (rng() > 0.55) lines.push(pick(rng, CAPTION_CLOSERS));
  return lines.join('. ');
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

function surfaceOf(project: Project): DiscoverSurface {
  const category = TEMPLATE_CATEGORIES.find((c) => c.id === project.category);
  return (category?.id ?? 'screenshots') as DiscoverSurface;
}

function imageShapeOf(surface: DiscoverSurface): { aspect: string; fit: 'cover' | 'contain' } {
  const category = TEMPLATE_CATEGORIES.find((c) => c.id === surface);
  return {
    aspect: category?.previewAspect ?? '3 / 1',
    fit: category?.previewFit ?? 'contain',
  };
}

/**
 * One post per bundled template.
 *
 * `now` is passed in rather than read here so the whole feed shares a single
 * clock: relative timestamps are computed against it, and a post published by
 * the viewer lands at the top of "Newest" without a race against Date.now().
 */
export function buildSeedPosts(templates: Project[], now: number): DiscoverPost[] {
  return templates
    .filter((project) => !!project.previewImage && !project.previewImage.includes('placehold.co'))
    .map((project) => {
      const rng = rngFrom(project.id);
      const surface = surfaceOf(project);
      const shape = imageShapeOf(surface);
      const author = MOCK_AUTHORS[hashString(project.id) % MOCK_AUTHORS.length];

      // Ages are squared so most of the feed is recent and the tail stretches
      // back a few months, which is roughly how a real feed sits.
      const ageDays = Math.round(Math.pow(rng(), 2) * 150) + rng() * 0.9;
      const createdAt = new Date(now - ageDays * DAY_MS).toISOString();

      // Older posts have had longer to collect views; likes track quality more
      // than age, so they get their own roll.
      const views = intBetween(rng, 240, 9000) + Math.round(ageDays * intBetween(rng, 5, 60));
      const likes = Math.round(views * (0.03 + rng() * 0.12));
      const comments = Math.max(0, Math.round(likes * (rng() * 0.14)));
      const remixes = Math.max(0, Math.round(likes * (rng() * 0.3)));

      return {
        id: `post_${project.id}`,
        author,
        title: pick(rng, TITLE_PATTERNS[surface]).replace('{app}', project.name),
        caption: buildCaption(project, rng),
        tags: buildTags(project, surface, rng),
        surface,
        images: [
          {
            id: `${project.id}_cover`,
            src: project.previewImage as string,
            aspect: shape.aspect,
            fit: shape.fit,
            label: project.name,
          },
        ],
        screens: project.projectData?.length ?? 1,
        createdAt,
        stats: { likes, comments, views, remixes },
        templateProjectId: project.id,
        appName: project.name,
      } satisfies DiscoverPost;
    });
}

/**
 * Comments for a seeded post. Generated on demand (the feed never needs them)
 * and stable per post, so reopening a post shows the same thread.
 */
export function buildSeedComments(post: DiscoverPost, now: number): DiscoverComment[] {
  const rng = rngFrom(`${post.id}_comments`);
  const count = Math.min(post.stats.comments, intBetween(rng, 0, 5));
  const postedAt = Date.parse(post.createdAt);
  const bodies = [...COMMENT_BODIES];

  return Array.from({ length: count }, (_, index) => {
    const author = MOCK_AUTHORS[(hashString(`${post.id}_${index}`) + index) % MOCK_AUTHORS.length];
    const bodyIndex = hashString(`${post.id}_body_${index}`) % bodies.length;
    const [body] = bodies.splice(bodyIndex, 1);
    // Comments trickle in after the post and before now.
    const at = postedAt + (now - postedAt) * (0.05 + rng() * 0.85);
    return {
      id: `comment_${post.id}_${index}`,
      postId: post.id,
      author: author.id === post.author.id ? MOCK_AUTHORS[(index + 3) % MOCK_AUTHORS.length] : author,
      body: body ?? COMMENT_BODIES[index % COMMENT_BODIES.length],
      createdAt: new Date(at).toISOString(),
      likes: intBetween(rng, 0, 24),
    } satisfies DiscoverComment;
  }).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

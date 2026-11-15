// Juniper's Growth data for the captures: the e2e sample app
// (tests/fixtures/growthSample.ts, bundled here with esbuild from the repo's
// node_modules) under an App Store id of its own, so Competitors and Keywords
// treat it as a real App Store app, plus everything those two screens and the
// review inbox read: three fictional rivals, eight tracked keywords with four
// weeks of daily ranks, and reviews rewritten so no sentence ends on a period.
//
//   const { buildSeed } = await import('./seed.mjs');
//   const seed = await buildSeed();   // { storage, rows, rules, ... }
import { createRequire } from 'node:module';
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const REPO = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const require = createRequire(REPO + '/package.json');
const here = path.dirname(url.fileURLToPath(import.meta.url));

export const JUNIPER = '6741203958';
export const DAYLINE = '6502418877';
export const TALLY = '1590264413';
export const BRIGHTLY = '6448120936';
const SAMPLE_ID = 'sample-app';

// --- the store's image addresses, answered from local files by the capture script ----------

export function shotUrl(name) {
  return `https://is1-ssl.mzstatic.com/image/thumb/PurpleSource221/v4/osg/${name}.png/392x696bb.png`;
}
export function iconUrl(name) {
  return `https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/osg/icon-${name}.png/512x512bb.jpg`;
}
const shots = (prefix) => [1, 2, 3, 4, 5].map((n) => shotUrl(`${prefix}-${n}`));

export const SETS = {
  juniperEn: shots('juniper-en'),
  juniperDe: shots('juniper-de'),
  dayline: shots('dayline'),
  daylineNew: shots('dayline-new'),
  tally: shots('tally'),
  brightly: shots('brightly'),
};

// --- an App Store Connect key shaped like Apple's .p8 (tests/e2e/helpers/growth.ts) ---------

function derLength(length) {
  if (length < 0x80) return Buffer.from([length]);
  if (length < 0x100) return Buffer.from([0x81, length]);
  return Buffer.from([0x82, length >> 8, length & 0xff]);
}
const der = (tag, body) => Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
function readDer(bytes) {
  const out = [];
  let at = 0;
  while (at < bytes.length) {
    const tag = bytes[at];
    let length = bytes[at + 1];
    let header = 2;
    if (length & 0x80) {
      const count = length & 0x7f;
      length = 0;
      for (let i = 0; i < count; i += 1) length = (length << 8) | bytes[at + 2 + i];
      header += count;
    }
    out.push({ tag, body: bytes.subarray(at + header, at + header + length), raw: bytes.subarray(at, at + header + length) });
    at += header + length;
  }
  return out;
}
function appleShapedKey() {
  const P256 = der(0xa0, der(0x06, Buffer.from('2a8648ce3d030107', 'hex')));
  const pem = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const [outer] = readDer(Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64'));
  const [version, algorithm, wrapped] = readDer(outer.body);
  const [ecPrivateKey] = readDer(wrapped.body);
  const [ecVersion, privateKey, ...rest] = readDer(ecPrivateKey.body);
  const body = Buffer.concat([ecVersion.raw, privateKey.raw, P256, ...rest.map((e) => e.raw)]);
  const shaped = der(0x30, Buffer.concat([version.raw, algorithm.raw, der(0x04, der(0x30, body))]));
  const lines = shaped.toString('base64').match(/.{1,64}/g) ?? [];
  return ['-----BEGIN PRIVATE KEY-----', ...lines, '-----END PRIVATE KEY-----', ''].join('\n');
}

// --- the fixture ---------------------------------------------------------------------------

async function loadSample() {
  const esbuild = require('esbuild');
  const out = path.join(here, '.growthSample.mjs');
  await esbuild.build({
    entryPoints: [REPO + '/tests/fixtures/growthSample.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: out,
    logLevel: 'error',
    absWorkingDir: REPO,
    tsconfig: REPO + '/tsconfig.json',
  });
  return import(url.pathToFileURL(out).href + '?t=' + Date.now());
}

/** The fixture's rows under Juniper's App Store id. */
const remap = (rows) => JSON.parse(JSON.stringify(rows).split(SAMPLE_ID).join(JUNIPER));

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Reviews, as people write them: no sentence ends on a period, no dashes. Each
// text once, so no quote shows up twice. `kind` is what the review is about,
// which the staged summary sorts by (capture.cjs installSummaryAnswer).
const OLDER_REVIEWS = [
  // Streaks
  { kind: 'streak', rating: 5, title: 'Finally a habit app I stick with', body: 'The streak view keeps me honest, three months in and still going', territory: 'US' },
  { kind: 'streak', rating: 5, title: 'Helped me quit smoking', body: 'Day 94 without a cigarette and the streak counter got me through the hard days', territory: 'US' },
  { kind: 'streak', rating: 5, title: 'Streaks work on me', body: 'I did not think a streak could make me drink more water but here we are, 60 days', territory: 'CA' },
  { kind: 'streak', rating: 4, title: 'Love the streak calendar', body: 'Seeing the whole month fill up with my streak is so satisfying, would love more colours', territory: 'AU' },
  { kind: 'streak', rating: 5, title: 'Best motivation', body: 'Watching my streak grow is the reason I get up and stretch every morning', territory: 'US' },
  { kind: 'streak', rating: 5, title: 'Meine Serie wächst', body: 'Die Serien motivieren mich jeden Tag, endlich bleibe ich beim Lesen dran', territory: 'DE' },
  { kind: 'streak', rating: 5, title: 'Ma série continue', body: 'Les séries me motivent vraiment, 45 jours de méditation sans interruption', territory: 'FR' },
  { kind: 'streak', rating: 5, title: 'Small wins every day', body: 'Ticking off a habit and seeing the streak go up never gets old', territory: 'US' },
  { kind: 'streak', rating: 4, title: 'Keeps me going', body: 'The streaks keep me going even on lazy days, a small thing that really works', territory: 'GB' },
  { kind: 'streak', rating: 5, title: '200 days of reading', body: 'My reading streak just hit 200 days, this app made it a habit', territory: 'IN' },
  { kind: 'streak', rating: 5, title: 'Minha sequência', body: 'Adoro ver minha sequência crescer todos os dias', territory: 'BR' },
  { kind: 'streak', rating: 5, title: 'One streak at a time', body: 'I built a morning routine one streak at a time, nothing else worked for me', territory: 'US' },
  // Reminders
  { kind: 'remind', rating: 5, title: 'Gentle reminders', body: 'The reminders are gentle and come at just the right time', territory: 'US' },
  { kind: 'remind', rating: 5, title: 'Helt perfekt', body: 'Påminnelserna kommer precis i rätt tid', territory: 'SE' },
  { kind: 'remind', rating: 4, title: 'Handige herinneringen', body: 'De herinneringen helpen me elke avond om te lezen', territory: 'NL' },
  { kind: 'remind', rating: 5, title: 'Not naggy', body: 'Reminders that nudge instead of nag, exactly what I needed', territory: 'GB' },
  { kind: 'remind', rating: 5, title: 'Parfait', body: "Je l'utilise tous les jours et les rappels sont vraiment utiles", territory: 'FR' },
  { kind: 'remind', rating: 4, title: 'Good reminders', body: 'I like that each habit gets its own reminder time', territory: 'US' },
  // Design
  { kind: 'design', rating: 5, title: 'Love the widgets', body: 'Ticking off a habit right from the home screen widget is the best part', territory: 'GB' },
  { kind: 'design', rating: 5, title: 'Super App', body: 'Schönes Design und ohne Werbung, genau so muss eine App sein', territory: 'DE' },
  { kind: 'design', rating: 4, title: 'Nice and clean', body: 'Clean design and the dark mode looks great', territory: 'IN' },
  { kind: 'design', rating: 5, title: 'Me encanta', body: 'El diseño es bonito y muy fácil de usar', territory: 'MX' },
  { kind: 'design', rating: 5, title: 'No ads, ever', body: 'Tried five others and this is the only clean one without ads', territory: 'US' },
  { kind: 'design', rating: 5, title: '使いやすい', body: 'シンプルなデザインで毎日使いやすいです', territory: 'JP' },
  // Praise
  { kind: 'praise', rating: 5, title: 'Daily driver', body: 'Opens fast and never gets in the way, exactly what I wanted', territory: 'US' },
  { kind: 'praise', rating: 5, title: 'Perfetta', body: 'App perfetta per le abitudini quotidiane, la consiglio a tutti', territory: 'IT' },
  { kind: 'praise', rating: 5, title: 'Worth every cent', body: 'My partner and I both use it now and we keep each other on track', territory: 'AU' },
  { kind: 'praise', rating: 4, title: 'Really good', body: 'Does what it says and helped me drink more water', territory: 'CA' },
  { kind: 'praise', rating: 5, title: 'Changed my mornings', body: 'I meditate every morning now, something I tried for years', territory: 'US' },
  { kind: 'praise', rating: 5, title: 'Brilliant', body: 'My whole family uses it to keep track of chores and walks', territory: 'GB' },
  { kind: 'praise', rating: 4, title: 'Sehr gut', body: 'Macht genau was es soll und hilft mir jeden Tag', territory: 'DE' },
  // Price
  { kind: 'price', rating: 2, title: 'Too pricey', body: 'The subscription price went up and I do not see what I get for it', territory: 'GB' },
  { kind: 'price', rating: 2, title: 'Abo zu teuer', body: 'Die App ist gut, aber das Abo ist für das, was es bietet, zu teuer', territory: 'DE' },
  { kind: 'price', rating: 3, title: 'Subscription for basics', body: 'Wish the basic features were not behind a subscription', territory: 'US' },
  { kind: 'price', rating: 2, title: 'Trop cher', body: "L'abonnement est trop cher pour ce qu'il apporte", territory: 'FR' },
  // Sync
  { kind: 'sync', rating: 3, title: 'Good but sync is flaky', body: 'Sometimes my iPad does not show what I checked off on my phone, please fix the sync', territory: 'AU' },
  { kind: 'sync', rating: 1, title: 'Lost my history', body: 'After restoring my phone all my history was gone, losing data like that is not okay', territory: 'US' },
  { kind: 'sync', rating: 2, title: 'Sync issues', body: 'Habits I tick on my iPad take hours to show up on my phone', territory: 'CA' },
  // Older crashes
  { kind: 'crash', rating: 2, title: 'Froze once', body: 'The app froze when I opened my stats and only a restart fixed it', territory: 'US' },
  { kind: 'crash', rating: 1, title: 'Crashed after restore', body: 'It crashed every time I opened it until I reinstalled', territory: 'GB' },
  // Requests
  { kind: 'pause', rating: 3, title: 'Okay', body: 'It is fine but I miss a way to pause a habit while I am on holiday', territory: 'US' },
  { kind: 'pause', rating: 4, title: 'Pause Funktion fehlt', body: 'Ich wünsche mir eine Pause Funktion für den Urlaub', territory: 'DE' },
  { kind: 'pause', rating: 4, title: 'Sick days', body: 'When I am sick I want to pause a habit instead of losing my progress', territory: 'CA' },
  { kind: 'pause', rating: 4, title: 'Holiday mode please', body: 'A holiday mode that pauses everything would make this perfect', territory: 'GB' },
  { kind: 'pause', rating: 3, title: 'Travel', body: 'I travel a lot and need to pause my habits for a few days', territory: 'AU' },
  { kind: 'weekly', rating: 4, title: 'Great, one wish', body: 'Would love a weekly goal instead of a daily one for some habits', territory: 'CA' },
  { kind: 'weekly', rating: 4, title: 'Weekly targets', body: 'Some habits like the gym need a weekly target, not a daily one', territory: 'US' },
  { kind: 'weekly', rating: 4, title: 'Wekelijkse doelen', body: 'Graag wekelijkse doelen voor sport', territory: 'NL' },
  { kind: 'weekly', rating: 3, title: 'Almost there', body: 'Without weekly goals I keep breaking my gym habit on rest days', territory: 'US' },
  { kind: 'export', rating: 4, title: 'Fijne app', body: 'Werkt goed, alleen mis ik een export naar een spreadsheet', territory: 'NL' },
  { kind: 'export', rating: 4, title: 'Muito bom', body: 'Ótimo app para criar hábitos, só falta uma versão para o relógio', territory: 'BR' },
  // Mixed
  { kind: 'mixed', rating: 3, title: 'Fine for now', body: 'Does the job, nothing special yet', territory: 'US' },
  { kind: 'mixed', rating: 3, title: 'Decent', body: 'Good app but the charts could show more detail', territory: 'IN' },
];

// The last two weeks, newest first: the update that crashes, between happier reviews.
const RECENT_REVIEWS = [
  { back: 1, kind: 'crash', rating: 1, title: 'Crashes on launch', body: 'Since the last update the app crashes every time I open it, please fix this', territory: 'US' },
  { back: 2, kind: 'streak', rating: 5, title: 'My streak is my favorite thing', body: 'Seeing the streak grow every morning makes me want to keep it alive', territory: 'US' },
  { back: 3, kind: 'crash', rating: 1, title: 'Keeps crashing', body: 'It crashes when I open the stats tab and I have a 200 day streak in here, please fix it', territory: 'GB' },
  { back: 4, kind: 'crash', rating: 2, title: 'Stürzt ab', body: 'Seit dem Update stürzt die App beim Öffnen der Statistik ab', territory: 'DE' },
  { back: 5, kind: 'remind', rating: 5, title: 'Reminders that actually help', body: 'The reminders come right when I need them and never feel pushy', territory: 'CA' },
  { back: 6, kind: 'crash', rating: 1, title: 'Crash after update', body: 'The app crashes when I try to add a new habit, it worked perfectly before the update', territory: 'CA' },
  { back: 8, kind: 'crash', rating: 1, title: 'Closes by itself', body: 'Adding a reminder makes the app close by itself since the update', territory: 'AU' },
  { back: 9, kind: 'pause', rating: 4, title: 'Please add a pause button', body: 'Love it, but when I am sick I want to pause my streak instead of losing it', territory: 'AU' },
  { back: 10, kind: 'crash', rating: 2, title: 'Se cierra sola', body: 'Desde la última versión la app se cierra al abrir las estadísticas', territory: 'MX' },
  { back: 12, kind: 'crash', rating: 1, title: 'Lost a 90 day run to a crash', body: 'The app crashed while saving and my 90 day run reset to zero', territory: 'US' },
  { back: 13, kind: 'streak', rating: 5, title: 'Trophies are a nice touch', body: 'Getting a trophy for a 30 day run made my week, small thing but it works', territory: 'GB' },
];

const REPLY_LOW = 'Thank you for telling us! We looked into this and a fix is on its way';
const REPLY_HIGH = 'Thank you for the kind words! Stories like yours are why we build Juniper';

function reviews(addDays, end) {
  const random = mulberry32(0xbeef);
  const out = [];
  let id = 0;
  // Spread over days 15 to 160 back, the kinds shuffled together.
  const order = OLDER_REVIEWS.map((text, index) => ({ text, key: random() + (index % 2) * 0.0001 })).sort((a, b) => a.key - b.key);
  order.forEach(({ text }, index) => {
    const back = 15 + Math.round((index / (order.length - 1)) * 145 + (random() - 0.5) * 4);
    id += 1;
    const answered = random() < (text.rating <= 2 ? 0.6 : 0.3);
    out.push({
      id: `juniper-review-${id}`,
      appId: JUNIPER,
      rating: text.rating,
      title: text.title,
      body: text.body,
      nickname: `user${(id * 7919) % 9973}`,
      createdDate: `${addDays(end, -back)}T${String(8 + (id % 12)).padStart(2, '0')}:14:00Z`,
      territory: text.territory,
      response: answered
        ? { id: `juniper-response-${id}`, body: text.rating <= 2 ? REPLY_LOW : REPLY_HIGH, lastModified: `${addDays(end, -back + 1)}T10:00:00Z`, state: 'PUBLISHED' }
        : undefined,
    });
  });
  RECENT_REVIEWS.forEach((text, index) => {
    id += 1;
    out.push({
      id: `juniper-review-${id}`,
      appId: JUNIPER,
      rating: text.rating,
      title: text.title,
      body: text.body,
      nickname: `user${(id * 7919) % 9973}`,
      createdDate: `${addDays(end, -(text.back - 1))}T${String(9 + (index % 10)).padStart(2, '0')}:40:00Z`,
      territory: text.territory,
    });
  });
  return out.sort((a, b) => b.createdDate.localeCompare(a.createdDate));
}

/** What each review is about, by its text: for checking the staged summary's counts. */
export const REVIEW_KINDS = Object.fromEntries([...OLDER_REVIEWS, ...RECENT_REVIEWS].map((text) => [text.body, text.kind]));

// --- the rivals, as Apple's lookup answers in each country ----------------------------------

export const COUNTRIES = ['US', 'GB', 'DE', 'CA', 'AU'];
const PRICE = { US: ['Free', 'USD'], GB: ['Free', 'GBP'], DE: ['Gratis', 'EUR'], CA: ['Free', 'CAD'], AU: ['Free', 'AUD'] };

const APPS = {
  [JUNIPER]: {
    name: 'Juniper: Habit Tracker',
    developer: 'Juniper Apps',
    icon: 'juniper',
    version: '2.4',
    released: -21,
    notes: 'A fresh look for the store, weekly goals and calmer reminders',
    ratings: { US: [4.6, 2310], GB: [4.5, 640], DE: [4.3, 410], CA: [4.6, 350], AU: [4.7, 220] },
    shots: (country) => (country === 'DE' ? SETS.juniperDe : SETS.juniperEn),
    slug: 'juniper-habit-tracker',
  },
  [DAYLINE]: {
    name: 'Dayline: Habit Goals',
    developer: 'Dayline Labs',
    icon: 'dayline',
    version: '3.12.1',
    released: -12,
    notes: 'Small fixes and smoother charts',
    ratings: { US: [4.7, 18240], GB: [4.6, 3120], DE: [4.5, 1980], CA: [4.7, 1450], AU: [4.8, 990] },
    shots: () => SETS.dayline,
    slug: 'dayline-habit-goals',
  },
  [TALLY]: {
    name: 'Tally: Daily Routines',
    developer: 'Tally Apps',
    icon: 'tally',
    version: '5.4',
    released: -18,
    notes: 'New badges for long runs',
    ratings: { US: [4.4, 6210], GB: [4.3, 1408], DE: [4.4, 2210], CA: [4.5, 640], AU: [4.3, 395] },
    shots: () => SETS.tally,
    slug: 'tally-daily-routines',
  },
  [BRIGHTLY]: {
    name: 'Brightly Habit Tracker',
    developer: 'Brightly Studio',
    icon: 'brightly',
    version: '2.19.0',
    released: -7,
    notes: 'Insights now show your best time of day',
    ratings: { US: [4.5, 27310], GB: [4.6, 5120], DE: [4.4, 1630], CA: [4.5, 2210], AU: [4.6, 1180] },
    shots: () => SETS.brightly,
    slug: 'brightly-habit-tracker',
  },
};

/** The lookup row of one app in one country; `override` changes what the store shows. */
export function lookupRow(id, country, day, override = {}) {
  const app = APPS[id];
  const [rating, count] = app.ratings[country];
  const [label, currency] = PRICE[country];
  return {
    kind: 'software',
    wrapperType: 'software',
    trackId: Number(id),
    trackName: app.name,
    artistName: app.developer,
    sellerName: app.developer,
    primaryGenreName: 'Health & Fitness',
    version: app.version,
    currentVersionReleaseDate: `${day(app.released)}T07:00:00Z`,
    releaseNotes: app.notes,
    averageUserRating: rating,
    userRatingCount: count,
    price: 0,
    formattedPrice: label,
    currency,
    screenshotUrls: app.shots(country),
    ipadScreenshotUrls: [],
    artworkUrl512: iconUrl(app.icon),
    artworkUrl100: iconUrl(app.icon),
    trackViewUrl: `https://apps.apple.com/${country.toLowerCase()}/app/${app.slug}/id${id}`,
    ...override,
  };
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Tauri HTTP rules for Apple's lookup in every country, each answering every app sold there. */
export function lookupRules(day, overrides = {}) {
  const answer = (rows) => JSON.stringify({ resultCount: rows.length, results: rows });
  const ids = [JUNIPER, DAYLINE, TALLY, BRIGHTLY];
  const rules = COUNTRIES.map((country) => ({
    match: `^GET https://itunes\\.apple\\.com/lookup\\?id=[^&]*&country=${escape(country.toLowerCase())}&`,
    headers: { 'content-type': 'text/javascript; charset=utf-8' },
    body: answer(ids.map((id) => lookupRow(id, country, day, overrides[id] ?? {}))),
  }));
  rules.push({ match: '^GET https://itunes\\.apple\\.com/lookup\\?', headers: { 'content-type': 'text/javascript; charset=utf-8' }, body: answer([]) });
  rules.push({
    match: '^GET https://itunes\\.apple\\.com/search\\?',
    headers: { 'content-type': 'text/javascript; charset=utf-8' },
    body: answer([DAYLINE, TALLY, BRIGHTLY].map((id) => lookupRow(id, 'US', day))),
  });
  return rules;
}

// --- keywords --------------------------------------------------------------------------------

export const KEYWORDS = ['habit tracker', 'habit app', 'daily habits', 'streak', 'routine', 'goal tracker', 'water reminder', 'self care'];
export const KEYWORD_COUNTRIES = ['US', 'GB', 'AU'];

// Where Juniper ranks 27 days ago and today in the United States. Null: not found.
const RANKS = {
  'habit tracker': [19, 5],
  'habit app': [34, 8],
  'daily habits': [15, 6],
  streak: [52, 21],
  routine: [66, 63],
  'goal tracker': [24, 27],
  'water reminder': [null, null],
  'self care': [92, 71],
};
// The rivals' steady places for each search (Dayline, Tally, Brightly), and who comes first.
const RIVAL_PLACES = {
  'habit tracker': { [DAYLINE]: 3, [TALLY]: 7, [BRIGHTLY]: 1 },
  'habit app': { [DAYLINE]: 1, [TALLY]: 5, [BRIGHTLY]: 3 },
  'daily habits': { [DAYLINE]: 4, [TALLY]: 1, [BRIGHTLY]: 9 },
  streak: { [DAYLINE]: 9, [TALLY]: 14, [BRIGHTLY]: 6 },
  routine: { [DAYLINE]: 12, [TALLY]: 2, [BRIGHTLY]: 25 },
  'goal tracker': { [DAYLINE]: 1, [TALLY]: 11, [BRIGHTLY]: 4 },
  'water reminder': { [DAYLINE]: 18, [TALLY]: null, [BRIGHTLY]: 41 },
  'self care': { [DAYLINE]: 33, [TALLY]: 21, [BRIGHTLY]: 15 },
};
const FILLERS = [
  { id: '6450011201', name: 'Wrenly: Daily Habits', developer: 'Wrenly Studio', icon: 'wrenly' },
  { id: '6450011202', name: 'Nimbo Streak Counter', developer: 'Nimbo Apps', icon: 'nimbo' },
  { id: '6450011203', name: 'Kindleaf Routine Planner', developer: 'Kindleaf', icon: 'kindleaf' },
  { id: '6450011204', name: 'Driplet: Water Reminder', developer: 'Driplet Labs', icon: 'driplet' },
  { id: '6450011205', name: 'Petalpath Self Care', developer: 'Petalpath', icon: 'petalpath' },
  { id: '6450011206', name: 'Orbly Goal Planner', developer: 'Orbly', icon: 'orbly' },
  { id: '6450011207', name: 'Mossy Mood Journal', developer: 'Mossy Apps', icon: 'mossy' },
  { id: '6450011208', name: 'Quillby Daily Planner', developer: 'Quillby', icon: 'quillby' },
  { id: '6450011209', name: 'Sundew Fasting Timer', developer: 'Sundew Health', icon: 'sundew' },
  { id: '6450011210', name: 'Lumo Sleep Sounds', developer: 'Lumo Audio', icon: 'lumo' },
];
// The filler that comes first where no rival does, by search.
const FIRST_FILLER = { streak: '6450011202', routine: '6450011203', 'water reminder': '6450011204', 'self care': '6450011205' };

function searchApp(id, country, day) {
  if (APPS[id]) {
    const app = APPS[id];
    const [rating, count] = app.ratings[country] ?? app.ratings.US;
    return {
      id,
      name: app.name,
      developer: app.developer,
      iconUrl: iconUrl(app.icon),
      rating,
      ratingCount: count,
      priceLabel: (PRICE[country] ?? PRICE.US)[0],
      genre: 'Health & Fitness',
      screenshots: app.shots(country).slice(0, 3),
    };
  }
  const filler = FILLERS.find((entry) => entry.id === id);
  const seed = Number(id.slice(-2));
  return {
    id,
    name: filler.name,
    developer: filler.developer,
    iconUrl: iconUrl(filler.icon),
    rating: 4.1 + ((seed * 7) % 8) / 10,
    ratingCount: 900 + seed * 1311,
    priceLabel: (PRICE[country] ?? PRICE.US)[0],
    genre: 'Health & Fitness',
    screenshots: [],
  };
}

function keywordData(addDays, todayDay, now) {
  const random = mulberry32(0x6b6579);
  const days = [];
  const searches = [];
  const DAYS = 24;
  const shift = { US: 0, GB: 3, AU: 5 };
  for (const country of KEYWORD_COUNTRIES) {
    for (const term of KEYWORDS) {
      const [start, end] = RANKS[term];
      let last = null;
      for (let back = DAYS - 1; back >= 0; back -= 1) {
        const date = addDays(todayDay, -back);
        const progress = (DAYS - 1 - back) / (DAYS - 1);
        let rank = null;
        if (start !== null) {
          // Flat for the first days, then the climb (or slide) to today's place,
          // steepest in the last two weeks, as the new screenshots' release day sits 20 days back.
          const eased = progress < 0.2 ? 0 : (progress - 0.2) / 0.8;
          const curve = Math.pow(eased, 1.2);
          const base = start + (end - start) * curve + shift[country];
          const wobble = Math.round((random() - 0.5) * Math.max(1, Math.abs(start - end) * 0.1 + 1));
          rank = Math.max(1, Math.round(base) + (back <= 2 ? 0 : wobble));
          if (back <= 2) rank = Math.max(1, end + shift[country] + Math.round(back * Math.sign(start - end) * Math.min(1, Math.abs(start - end) / 10)));
        }
        const rivals = {};
        const taken = new Set(rank === null ? [] : [rank]);
        for (const [id, place] of Object.entries(RIVAL_PLACES[term])) {
          if (place === null) {
            rivals[id] = null;
            continue;
          }
          let value = place + (country === 'US' ? 0 : Math.round(random() * 2));
          if (back !== 0 && random() < 0.25) value += random() < 0.5 ? -1 : 1;
          value = Math.max(1, value);
          while (taken.has(value)) value += 1;
          taken.add(value);
          rivals[id] = value;
        }
        const at = back === 0 ? now - 50 * 60_000 : Date.parse(`${date}T09:30:00Z`);
        days.push({ key: `${JUNIPER}|${country}|${term}|${date}`, appId: JUNIPER, term, country, date, rank, total: 180 + Math.round(random() * 20), rivals, at });
        last = { rank, rivals, at };
      }
      // Today's search, as the check kept it: who comes first, and every app's place.
      const total = 190;
      const ids = new Array(total).fill(null);
      if (last.rank !== null) ids[last.rank - 1] = JUNIPER;
      for (const [id, place] of Object.entries(last.rivals)) if (place !== null && place <= total) ids[place - 1] = id;
      const first = FIRST_FILLER[term];
      if (first && ids[0] === null) ids[0] = first;
      const pool = FILLERS.map((entry) => entry.id).filter((id) => !ids.includes(id));
      let filler = 1000;
      for (let index = 0; index < total; index += 1) {
        if (ids[index] !== null) continue;
        ids[index] = index < 12 && pool.length ? pool.shift() : String(6400000000 + filler++ * 37 + KEYWORDS.indexOf(term) * 7 + index);
      }
      const top = ids.slice(0, 10).map((id) => (APPS[id] || FILLERS.some((entry) => entry.id === id) ? searchApp(id, country) : null)).filter(Boolean);
      searches.push({ key: `keywords:search:${country}:${term}`, value: { term, country, at: last.at, ids, top } });
    }
  }
  return { days, searches };
}

// --- the whole seed ------------------------------------------------------------------------------

export async function buildSeed() {
  const sample = await loadSample();
  return compose(sample);
}

function compose(sample) {
  const now = Date.now();
  const todayDay = new Date(now).toISOString().slice(0, 10);
  const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const end = addDays(todayDay, -1);
  const day = (n) => addDays(todayDay, n);

  const records = remap(sample.sampleRecords());
  const ratings = remap(sample.sampleRatings());
  const events = remap(sample.sampleEvents()).map((event) => {
    if (event.kind === 'campaign') return { ...event, title: 'Spring promo in stories', detail: 'One week of story ads in the US and Brazil' };
    if (event.kind === 'screenshots') {
      return {
        ...event,
        title: 'New screenshots uploaded',
        detail: '20 screenshots in 4 languages, from "Juniper"',
        projectName: 'Juniper',
        locales: ['en-US', 'de-DE', 'ja', 'ar-SA'],
        screenshotCount: 20,
      };
    }
    return event;
  });
  const listing = remap(sample.sampleListing());
  const german = listing.locales.find((entry) => entry.locale === 'de-DE');
  if (german) {
    german.screenshotCounts = { APP_IPHONE_67: 5 };
    german.description =
      `Juniper hilft dir, die Gewohnheiten aufzubauen, die du schon lange anfangen willst, mit einem kleinen Haken pro Tag. Wasser trinken, lesen, ein Spaziergang, Meditation: Juniper zählt deine Serien, erinnert dich im richtigen Moment und zeigt dir, wie weit du gekommen bist.

Sanfte Erinnerungen für jede Gewohnheit, Widgets für Home und Sperrbildschirm, iCloud Sync zwischen iPhone und iPad und keine Werbung.

Juniper Plus schaltet unbegrenzte Gewohnheiten, Statistiken und Themen frei.`;
  }
  listing.locales.push(
    {
      locale: 'ja',
      name: 'Juniper: 習慣トラッカー',
      subtitle: '続く習慣をつくろう',
      keywords: '習慣,ルーティン,記録,目標,リマインダー',
      promotionalText: '',
      description:
        `Juniperは、小さなチェックを毎日つづけて習慣を育てるアプリです。水を飲む、本を読む、散歩する、瞑想する。どんな習慣も記録でき、連続記録とカレンダーで進み具合がひと目でわかります。

・習慣ごとに選べるやさしいリマインダー
・ホーム画面とロック画面のウィジェット
・iPhoneとiPadのあいだでiCloud同期
・広告はありません

Juniper Plusでは習慣の数が無制限になり、詳しい統計とテーマが使えます。

朝の散歩、夜の読書、一日八杯の水。続けたいことを一つずつ登録して、毎日チェックするだけで大丈夫です。連続記録が伸びるたびにトロフィーがもらえるので、忙しい週でも続ける理由が見つかります。週ごとのグラフでは、どの曜日にどの習慣がよく続いたかがわかり、無理のないペースを見つけられます。`,
      whatsNew: '週ごとの目標を追加しました',
      screenshotCounts: { APP_IPHONE_67: 5 },
    },
    {
      locale: 'ar-SA',
      name: 'Juniper: متتبع العادات',
      subtitle: 'عادات تدوم معك',
      keywords: 'روتين,أهداف,تذكير,يومي,صحة,تأمل',
      promotionalText: '',
      description:
        `يساعدك Juniper على بناء العادات التي تريد أن تبدأها، خطوة صغيرة كل يوم. تابع شرب الماء والقراءة والمشي والتأمل، واحتفظ بسلسلتك، وشاهد تقدمك في التقويم والإحصاءات.

تذكيرات لطيفة لكل عادة، وأدوات للشاشة الرئيسية وشاشة القفل، ومزامنة عبر iCloud بين iPhone وiPad، ومن دون إعلانات.

يفتح Juniper Plus عددا غير محدود من العادات والإحصاءات المفصلة والسمات.`,
      whatsNew: 'أهداف أسبوعية جديدة',
      screenshotCounts: { APP_IPHONE_67: 5 },
    }
  );
  const reviewRows = reviews(addDays, end);
  const keywords = keywordData(addDays, todayDay, now);

  const rivalEntry = (id, addedAt) => ({ id, name: APPS[id].name, developer: APPS[id].developer, iconUrl: iconUrl(APPS[id].icon), addedAt });
  const meta = [
    { key: `sync:last:${JUNIPER}`, value: now - 25 * 60_000 },
    {
      key: `app:live:${JUNIPER}`,
      value: {
        version: '2.4',
        releaseDate: `${day(-21)}T07:00:00Z`,
        screenshotUrls: SETS.juniperEn,
        ipadScreenshotUrls: [],
        storeUrl: `https://apps.apple.com/us/app/juniper-habit-tracker/id${JUNIPER}`,
        iconUrl: iconUrl('juniper'),
        checkedAt: now - 25 * 60_000,
      },
    },
    // Followed for a while, and due a check, so opening Competitors looks every app up.
    {
      key: `rivals:list:${JUNIPER}`,
      value: {
        owner: JUNIPER,
        rivals: [rivalEntry(DAYLINE, now - 40 * 86_400_000), rivalEntry(TALLY, now - 40 * 86_400_000 + 60_000), rivalEntry(BRIGHTLY, now - 40 * 86_400_000 + 120_000)],
        countries: COUNTRIES,
      },
    },
    {
      key: `keywords:list:${JUNIPER}`,
      value: {
        owner: JUNIPER,
        keywords: KEYWORDS.map((term, index) => ({ term, addedAt: now - 28 * 86_400_000 + index * 60_000, source: 'typed' })),
        countries: KEYWORD_COUNTRIES,
        checkedAt: now - 50 * 60_000,
      },
    },
    ...keywords.searches,
  ];

  const issuerId = '69a6de70-0000-47e3-e053-5b8c7c11a4d1';
  const keyId = 'ABCD123456';
  const storage = {
    'open-screenshot-generator.store-credentials': JSON.stringify({ appstore: { issuerId, keyId, privateKey: appleShapedKey() } }),
    'open-screenshot-generator.growth': JSON.stringify({ appId: JUNIPER, vendorNumber: '85012345' }),
  };
  const rows = {
    days: records,
    reviews: reviewRows,
    ratings,
    events,
    listings: [listing],
    meta,
    keywordDays: keywords.days,
  };
  const ascRule = {
    match: '^GET https://api\\.appstoreconnect\\.apple\\.com/v1/apps\\?',
    body: JSON.stringify({
      data: [{ type: 'apps', id: JUNIPER, attributes: { name: 'Juniper: Habit Tracker', bundleId: 'com.example.juniper', sku: 'JUNIPER', primaryLocale: 'en-US' } }],
    }),
  };
  return {
    now,
    today: todayDay,
    day,
    storage,
    rows,
    ascRule,
    rules: [ascRule, ...lookupRules(day)],
    lookupRules: (overrides) => [ascRule, ...lookupRules(day, overrides)],
    reviews: reviewRows,
  };
}

if (process.argv[1] && url.pathToFileURL(process.argv[1]).href === import.meta.url) {
  const seed = await buildSeed();
  const sizes = Object.fromEntries(Object.entries(seed.rows).map(([name, list]) => [name, list.length]));
  console.log('today', seed.today, sizes);
  const crash = seed.reviews.slice(0, 5).map((r) => `${r.createdDate.slice(0, 10)} ${r.rating} ${r.title}`);
  console.log(crash);
  fs.writeFileSync(path.join(here, '.seed-preview.json'), JSON.stringify({ keywordDays: seed.rows.keywordDays.filter((r) => r.country === 'US' && r.term === 'habit app') }, null, 1));
}

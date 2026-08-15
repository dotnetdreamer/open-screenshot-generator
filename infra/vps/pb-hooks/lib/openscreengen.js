/// <reference path="../../pb-data/types.d.ts" />

/**
 * Everything the routes share: settings, body reading, clamping, the viewer,
 * and the two shapes a post and a comment go back to the client as.
 *
 * ## Not named `*.pb.js`, deliberately
 *
 * That suffix is what PocketBase globs for when it loads hooks. A library named
 * with it would be executed as a hook in its own right — every `routerAdd` in
 * the tree registered twice, and this file's top level run once per worker for
 * no reason. It is a plain module, reached with `require`.
 *
 * ## The one thing that will bite you
 *
 * **PocketBase runs every hook handler in its own isolated VM.** A `const` at
 * the top of a `*.pb.js` file is not visible inside a handler in that same file:
 * the handler sees an undefined variable, at runtime, on the first request, and
 * the route answers a bare 400 with no hint of what happened. That is why every
 * handler in `pb-hooks/` opens with
 *
 *     const openscreengen = require(`${__hooks}/lib/openscreengen.js`);
 *
 * as its **first statement**, and why nothing else is shared between them. It is
 * the single easiest way to write a broken PocketBase hook.
 */

// ---------- constants ----------

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A JSON body larger than this is refused unread. */
const MAX_BODY_CHARS = 64 * 1024;

/** Mirrors DiscoverSurface in src/types/discover.ts. */
const SURFACES = ['screenshots', 'apple-watch', 'mac', 'app-preview', 'play-feature-graphic'];

/** Mirrors the caps in the share form and in the `posts` collection. */
const MAX_TITLE = 90;
const MAX_CAPTION = 600;
const MAX_APP_NAME = 60;
const MAX_COMMENT = 500;
const MAX_TAGS = 6;
const MAX_TAG_CHARS = 24;
const MAX_HANDLE = 30;
const MAX_DISPLAY_NAME = 40;
const MAX_BIO = 160;

/** PocketBase record ids are always exactly this. Checked before every lookup. */
const RECORD_ID_RE = /^[a-z0-9]{15}$/;

const GOOGLE_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo?access_token=';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const GITHUB_USER_URL = 'https://api.github.com/user';

/** What an avatar may be, and how big. Anything else is dropped silently. */
const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_AVATAR_BYTES = 512 * 1024;

/**
 * Every settings key, with the value the box uses when the row is missing,
 * blank or unreadable.
 *
 * The type of the default is what decides how the row is parsed — a number
 * default parses the row as a number, a boolean as a boolean — so adding a key
 * here is the whole of adding a setting.
 */
const DEFAULTS = {
  enabled: true,
  writes_enabled: true,
  signin_enabled: true,
  google_client_ids: '',
  github_client_ids: '',
  github_allow_pat: false,
  avatar_fetch_enabled: true,
  feed_page_size: 12,
  feed_max_page_size: 48,
  feed_rank_window: 400,
  feed_max_following: 200,
  max_posts_per_day: 10,
  max_comments_per_hour: 30,
  max_images_per_post: 6,
  max_image_bytes: 4 * 1024 * 1024,
  official_handle: 'openscreenshot',
  moderation_note: '',
};

/**
 * The two booleans that default OFF and only the exact word `true` turns on.
 *
 * The opposite polarity to every other switch here, and they earn it. Every
 * other boolean defaults ON and reads anything that is not an explicit "false"
 * as on, so a blank row leaves a working feature working. `github_allow_pat`
 * widens who may sign in, so a blank row, a typo or a half-finished edit must
 * leave it shut rather than open.
 */
const STRICT_BOOLEANS = ['github_allow_pat'];

// ---------- settings ----------

let cache = null;
let cachedAt = 0;
/** Per hook VM, so a dashboard edit can take up to this long to show. */
const CACHE_MS = 30 * SECOND;

/**
 * Every tunable, as one object, cached briefly.
 *
 * A row whose key is not in DEFAULTS is left alone rather than picked up: the
 * dashboard is a place people write notes, and a stray row should not become a
 * setting. A row that cannot be parsed falls back to the default with a warning
 * rather than to zero, which is the difference between "somebody typed `ten`"
 * and "the feed now allows no posts at all".
 */
function settings(app) {
  const now = Date.now();
  if (cache && now - cachedAt < CACHE_MS) return cache;

  const config = Object.assign({}, DEFAULTS);
  try {
    const rows = app.findAllRecords('settings');
    for (const row of rows) {
      const key = row.getString('key');
      if (!(key in DEFAULTS)) continue;
      const raw = (row.getString('value') || '').trim();
      if (STRICT_BOOLEANS.indexOf(key) !== -1) {
        config[key] = raw === 'true' || raw === '1';
        continue;
      }
      const fallback = DEFAULTS[key];
      if (typeof fallback === 'boolean') {
        config[key] = !(raw === 'false' || raw === '0');
      } else if (typeof fallback === 'number') {
        const parsed = Number(raw);
        if (isFinite(parsed) && parsed >= 0) config[key] = parsed;
        else console.warn(`openscreengen: settings.${key} is not a number, using ${fallback}`);
      } else {
        // `unset` is the placeholder the migration seeds, because
        // `settings.value` is required and a row cannot be created blank. It is
        // not a value, and letting it through would turn "nobody configured this
        // box" into "your token has the wrong audience".
        config[key] = raw === 'unset' ? '' : raw;
      }
    }
  } catch (err) {
    console.warn('openscreengen: could not read settings, using defaults —', err);
  }

  cache = config;
  cachedAt = now;
  return config;
}

/** A comma separated settings row as a clean list. */
function idList(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry !== 'unset');
}

// ---------- requests ----------

function readerToString(reader) {
  return toString(reader);
}

/** The JSON body, or null when there is not one worth parsing. */
function readBody(e) {
  try {
    const type = (e.request.header.get('Content-Type') || '').toLowerCase();
    if (type.indexOf('json') !== -1) {
      const info = e.requestInfo();
      if (info && info.body && typeof info.body === 'object') return info.body;
    }
  } catch {
    // fall through to the raw read
  }
  let raw = '';
  try {
    raw = readerToString(e.request.body);
  } catch (err) {
    console.warn('openscreengen: could not read request body —', err);
    return null;
  }
  if (!raw || raw.length > MAX_BODY_CHARS) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The query string as a plain `{ key: 'value' }` object.
 *
 * `e.request.url.query()` is Go's `url.Values`, which is a map of key to
 * **array** — so `query.sort` there is `['newest']` and every read needs an
 * index. `requestInfo().query` is PocketBase's own flattened copy, documented as
 * holding only the first value per key, which is the shape every caller here
 * wants. Returns `{}` rather than throwing on a request that has no parseable
 * one.
 */
function queryOf(e) {
  try {
    const info = e.requestInfo();
    if (info && info.query && typeof info.query === 'object') return info.query;
  } catch (err) {
    console.warn('openscreengen: could not read the query string —', err);
  }
  return {};
}

/** One query parameter, always a string, never undefined. */
function queryValue(query, key, fallback) {
  const raw = query[key];
  if (raw === null || raw === undefined) return fallback || '';
  return String(raw);
}

/**
 * One multipart form value.
 *
 * `e.request.parseMultipartForm` has already been run by the time
 * `findUploadedFiles` is called, so the text fields are sitting in the same
 * form and this is only a safe read of one of them.
 */
function formValue(e, key) {
  try {
    return String(e.request.formValue(key) || '');
  } catch {
    return '';
  }
}

/** Trim, collapse whitespace, cap. Anything that is not a string becomes ''. */
function clampText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Same, but newlines survive: a caption and a comment are allowed paragraphs. */
function clampMultiline(value, max) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

/**
 * A JSON column, back as a real Array.
 *
 * `record.get()` on a JSON field hands back a Go []byte, which JavaScript sees
 * as an Array **of numbers** — so `Array.isArray` passes and the value quietly
 * becomes the character codes of its own JSON. The neighbouring project mangled
 * nine accounts this way before anybody noticed. Parse it, never trust it.
 */
function jsonArray(record, field) {
  let raw = null;
  try {
    raw = record.get(field);
  } catch {
    return [];
  }
  if (raw === null || raw === undefined) return [];
  try {
    const text = typeof raw === 'string' ? raw : toString(raw);
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return Array.isArray(raw) && typeof raw[0] !== 'number' ? raw : [];
  }
}

/** Tags, cleaned the same way the client's parseTags does. */
function normalizeTags(input) {
  const source = Array.isArray(input) ? input : String(input || '').split(/[,\s]+/);
  const seen = {};
  const out = [];
  for (const raw of source) {
    const tag = String(raw || '')
      .trim()
      .replace(/^#+/, '')
      .toLowerCase()
      .slice(0, MAX_TAG_CHARS);
    // Letters, digits and dashes. A tag is a filter chip and a URL fragment, not
    // a place to put punctuation.
    if (!/^[a-z0-9][a-z0-9-]*$/.test(tag)) continue;
    if (seen[tag]) continue;
    seen[tag] = true;
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

// ---------- the viewer ----------

/**
 * Who is asking, from the Authorization header.
 *
 * Returns `{ user }` or `{ fail }`. Never throws, so a caller can decide
 * whether being signed out is an error (every write) or simply means fewer
 * fields in the answer (every read).
 */
function authUser(app, e) {
  let raw = '';
  try {
    raw = String(e.request.header.get('Authorization') || '');
  } catch {
    raw = '';
  }
  raw = raw.replace(/^Bearer\s+/i, '').trim();
  if (!raw) return { fail: { status: 401, error: 'sign in required' } };

  let user = null;
  try {
    user = app.findAuthRecordByToken(raw, 'auth');
  } catch {
    return { fail: { status: 401, error: 'bad token' } };
  }
  if (!user) return { fail: { status: 401, error: 'bad token' } };

  try {
    if (user.collection().name !== 'users') return { fail: { status: 401, error: 'bad token' } };
  } catch {
    return { fail: { status: 401, error: 'bad token' } };
  }

  // Checked on every request rather than at sign-in, so a token minted before
  // the flag was set stops working the moment the flag is set.
  if (user.getBool('banned')) return { fail: { status: 403, error: 'banned' } };
  return { user: user };
}

/**
 * The same, for a route that works signed out.
 *
 * Returns the user or null. A bad or expired token is treated as signed out
 * rather than as an error: the feed is public, and somebody whose session
 * lapsed in a background tab should see posts, not a red banner.
 */
function optionalUser(app, e) {
  const result = authUser(app, e);
  return result.user || null;
}

// ---------- serialization ----------

/**
 * The public half of an account.
 *
 * This function is the entire reason `users` is locked: it names the seven
 * fields a stranger may see, so `email`, `google_sub`, `github_id`, `banned` and
 * anything added later cannot leak by being on the same record. Matches
 * DiscoverAuthor in src/types/discover.ts.
 */
function authorOf(app, user, viewerId) {
  if (!user) {
    // A post whose author row has gone. Cascade delete makes this
    // unreachable in practice, and the feed still must not 500 over it.
    return { id: '', handle: 'unknown', name: 'Unknown', followers: 0 };
  }
  const avatar = user.getString('avatar');
  return {
    id: user.id,
    handle: user.getString('handle') || 'user',
    name: user.getString('display_name') || user.getString('handle') || 'Someone',
    bio: user.getString('bio') || undefined,
    // A path, not a URL: the client joins it to its own base, so the same
    // record works against a local box and the live one without rewriting.
    avatarUrl: avatar ? `/api/files/users/${user.id}/${avatar}?thumb=96x96` : undefined,
    verified: user.getBool('verified_badge') || undefined,
    followers: user.getInt('followers') || 0,
    isViewer: viewerId && user.id === viewerId ? true : undefined,
  };
}

/** Matches DiscoverPost. `viewer` may be null: guests get the post minus flags. */
function postOf(app, post, viewer, extras) {
  const info = extras || {};
  const meta = jsonArray(post, 'image_meta');
  const files = [];
  const rawFiles = post.get('images');
  if (rawFiles) {
    for (let i = 0; i < rawFiles.length; i += 1) files.push(String(rawFiles[i]));
  }

  return {
    id: post.id,
    author: info.author || authorOf(app, info.authorRecord, viewer ? viewer.id : ''),
    title: post.getString('title'),
    caption: post.getString('caption'),
    tags: jsonArray(post, 'tags').map((tag) => String(tag)),
    surface: post.getString('surface'),
    screens: post.getInt('screens') || 0,
    createdAt: post.getDateTime('created').string(),
    stats: {
      likes: post.getInt('likes') || 0,
      comments: post.getInt('comments') || 0,
      views: post.getInt('views') || 0,
      remixes: post.getInt('remixes') || 0,
    },
    templateProjectId: post.getString('template_project_id') || undefined,
    appName: post.getString('app_name') || undefined,
    isMine: viewer && post.getString('author') === viewer.id ? true : undefined,
    likedByViewer: info.liked || false,
    savedByViewer: info.saved || false,
    images: files.map((file, index) => {
      const entry = meta[index] && typeof meta[index] === 'object' ? meta[index] : {};
      return {
        id: `${post.id}_${index}`,
        src: `/api/files/posts/${post.id}/${file}`,
        aspect: String(entry.aspect || '3 / 1'),
        fit: entry.fit === 'cover' ? 'cover' : 'contain',
        label: entry.label ? String(entry.label) : undefined,
      };
    }),
  };
}

/** Matches DiscoverComment. */
function commentOf(app, comment, viewer, authorRecord) {
  return {
    id: comment.id,
    postId: comment.getString('post'),
    author: authorOf(app, authorRecord, viewer ? viewer.id : ''),
    body: comment.getString('body'),
    createdAt: comment.getDateTime('created').string(),
    likes: comment.getInt('likes') || 0,
    isMine: viewer && comment.getString('author') === viewer.id ? true : undefined,
  };
}

// ---------- the feed ----------

/**
 * `hidden != true`, spelled out.
 *
 * A bool field that was never written is NULL rather than false in SQLite, and
 * `hidden = false` does not match NULL — so the obvious filter silently returns
 * an empty feed for every post created before moderation existed. Every query in
 * this stack uses this constant instead of writing it out again.
 */
const VISIBLE = '(hidden = false || hidden = null)';

/**
 * Engagement decayed by age, so a week-old hit does not pin the top forever.
 *
 * The same curve the feed used while it ran on sample data, so the tabs behave
 * as they did. "For you" is this plus a light personalization pass: it is not a
 * recommender and is not meant to be one.
 */
function scoreOf(post, now, sort, affinity, followed, viewer) {
  let created = now;
  try {
    created = Date.parse(post.getDateTime('created').string()) || now;
  } catch {
    created = now;
  }
  const ageHours = Math.max(1, (now - created) / 3600000);
  const engagement =
    (post.getInt('likes') || 0) +
    (post.getInt('comments') || 0) * 3 +
    (post.getInt('remixes') || 0) * 2;
  let score = engagement / Math.pow(ageHours + 12, 0.6);

  if (sort === 'trending') return score;

  if (followed[post.getString('author')]) score *= 3;
  for (const tag of jsonArray(post, 'tags')) {
    if (affinity[String(tag)]) {
      score *= 1.6;
      break;
    }
  }
  if (viewer && post.getString('author') === viewer.id) score *= 1.2;
  return score;
}

/**
 * Turn a page of records into the JSON the client expects.
 *
 * Two things it exists to avoid. Authors are fetched once per distinct id
 * rather than once per post, because a page of twelve posts by three people is
 * three reads and not twelve. The viewer's likes and saves are fetched as two
 * queries over the whole page rather than two per card, which is the N+1 that
 * would otherwise arrive with the second page of traffic.
 */
function decorate(app, posts, viewer) {
  if (!posts.length) return [];

  const authors = {};
  const ids = [];
  for (const post of posts) {
    ids.push(post.id);
    const authorId = post.getString('author');
    if (authorId && !(authorId in authors)) {
      authors[authorId] = findRecord(app, 'users', authorId);
    }
  }

  const liked = {};
  const saved = {};
  if (viewer) {
    const ors = [];
    const params = { u: viewer.id };
    ids.forEach((id, index) => {
      ors.push(`post = {:p${index}}`);
      params[`p${index}`] = id;
    });
    const scopeFilter = `user = {:u} && (${ors.join(' || ')})`;
    try {
      for (const row of app.findRecordsByFilter('post_likes', scopeFilter, '', 200, 0, params)) {
        liked[row.getString('post')] = true;
      }
      for (const row of app.findRecordsByFilter('post_saves', scopeFilter, '', 200, 0, params)) {
        saved[row.getString('post')] = true;
      }
    } catch (err) {
      // The feed is worth more than the heart being filled in. A failure here
      // shows every post as unliked rather than showing no posts.
      console.warn('openscreengen: could not read viewer flags —', err);
    }
  }

  const out = [];
  for (const post of posts) {
    out.push(
      postOf(app, post, viewer, {
        authorRecord: authors[post.getString('author')],
        liked: !!liked[post.id],
        saved: !!saved[post.id],
      })
    );
  }
  return out;
}

/**
 * What the search box actually matches against.
 *
 * The author's name and handle are in here, which is why a rename has to
 * rewrite every one of their posts — see the reindex hook in
 * 050_discover.pb.js.
 */
function searchTextOf(post, tags, author) {
  return [
    post.getString('title'),
    post.getString('caption'),
    post.getString('app_name'),
    tags.join(' '),
    author ? author.getString('display_name') : '',
    author ? author.getString('handle') : '',
  ]
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);
}

/**
 * Write `tags`, `tags_text` and `search_text` together.
 *
 * One function, called from every place a post's text or its author's name can
 * change, because three columns describing the same thing are three columns
 * that drift the moment two places write them.
 */
function writeTagColumns(post, tags, author) {
  post.set('tags', tags);
  // The pipes are what make a tag filter exact: `|app|` cannot match `|apple|`.
  post.set('tags_text', tags.length ? `|${tags.join('|')}|` : '');
  post.set('search_text', searchTextOf(post, tags, author));
}

/**
 * Like, save and comment-like are one function with three sets of names.
 *
 * The row is written FIRST and the counter is bumped only when the row was
 * genuinely new or genuinely removed. That order is what makes a double tap
 * free: the unique index refuses the second row, nothing changed, and the
 * counter is left alone. The other order — bump, then try to write — inflates
 * the number every time somebody taps twice.
 */
function toggle(app, e, spec) {
  const config = settings(app);
  if (!config.enabled) return e.json(503, { error: 'the community feed is switched off' });
  if (!config.writes_enabled) return e.json(503, { error: 'the feed is read only right now' });

  const auth = authUser(app, e);
  if (auth.fail) return e.json(auth.fail.status, { error: auth.fail.error });

  const target = findRecord(app, spec.targetCollection, e.request.pathValue('id'));
  if (!target || target.getBool('hidden')) return e.json(404, { error: spec.missing });

  const body = readBody(e) || {};
  // Absent means on. A client that sends nothing is asking to like something,
  // not to un-like it.
  const on = body.on !== false;

  let existing = null;
  try {
    existing = app.findFirstRecordByFilter(
      spec.joinCollection,
      `user = {:u} && ${spec.targetField} = {:t}`,
      { u: auth.user.id, t: target.id }
    );
  } catch {
    existing = null;
  }

  let changed = false;
  if (on && !existing) {
    const row = new Record(app.findCollectionByNameOrId(spec.joinCollection));
    row.set('user', auth.user.id);
    row.set(spec.targetField, target.id);
    try {
      app.save(row);
      changed = true;
    } catch (err) {
      // Almost always the unique index doing its job under a double tap, which
      // is a success from the caller's point of view: the row they wanted
      // exists. Warned rather than returned, because the alternative is an
      // error toast for tapping a heart twice.
      console.warn(`openscreengen: could not write a ${spec.joinCollection} row —`, err);
    }
  } else if (!on && existing) {
    try {
      app.delete(existing);
      changed = true;
    } catch (err) {
      console.warn(`openscreengen: could not remove a ${spec.joinCollection} row —`, err);
    }
  }

  if (changed && spec.counter) {
    try {
      bump(target, spec.counter, on ? 1 : -1);
      app.save(target);
    } catch (err) {
      console.warn('openscreengen: could not bump a counter —', err);
    }
  }

  return e.json(200, {
    on: on,
    count: spec.counter ? target.getInt(spec.counter) || 0 : undefined,
  });
}

/**
 * Find or create the account behind a verified provider identity, then mint the
 * session.
 *
 * Shared by both sign-in doors, because everything after "the provider says
 * this is person X" is identical. `identity.key` has already been established
 * by the caller against the provider itself; nothing in here re-checks it and
 * nothing in here reads the request body.
 */
function upsertAccount(app, e, identity) {
  let user = null;
  try {
    user = app.findFirstRecordByFilter('users', `${identity.field} = {:key}`, { key: identity.key });
  } catch {
    user = null;
  }

  // Checked before anything is written, so a banned account cannot refresh its
  // own display name by signing in again.
  if (user && user.getBool('banned')) return e.json(403, { error: 'banned' });

  const isNew = !user;
  if (isNew) {
    user = new Record(app.findCollectionByNameOrId('users'));
    user.set(identity.field, identity.key);
    user.set('handle', freeHandle(app, identity.handleSeed));
    user.set('display_name', identity.name || 'Someone');
    user.set('banned', false);
    user.set('followers', 0);
    user.set('post_count', 0);
    /*
     * A password is a required field on a PocketBase auth collection, so one is
     * generated and immediately forgotten. Nobody — including this person —
     * ever learns it, and `authRule` is null anyway, so there is no endpoint it
     * could be used at.
     */
    user.setPassword($security.randomString(40));
    user.setVerified(true);
  }

  user.set('email', identity.email);
  // Never in any answer this box gives. `authorOf` above does not name it
  // either; this is the belt to that braces.
  user.set('emailVisibility', false);

  // A name somebody set for themselves is never overwritten by a later sign-in,
  // which is what makes the profile editable at all.
  if (!user.getString('display_name') && identity.name) {
    user.set('display_name', identity.name);
  }

  // Fetched on first sign-in only. Re-fetching every time would be a request to
  // a CDN per login for a picture that almost never changes.
  if (isNew && identity.pictureUrl) {
    const avatar = fetchAvatar(identity.pictureUrl);
    if (avatar) user.set('avatar', avatar);
  }

  try {
    app.save(user);
  } catch (err) {
    console.warn('openscreengen: could not save an account —', err);
    return e.json(500, { error: 'could not save your account' });
  }

  /*
   * The session.
   *
   * `newAuthToken()` mints against the collection's own duration and hands back
   * nothing else, which is what lets the answer below be exactly the fields the
   * client wants rather than a serialized record with an email in it.
   */
  let token = '';
  try {
    token = user.newAuthToken();
  } catch (err) {
    console.warn('openscreengen: newAuthToken failed —', err);
    return e.json(500, { error: 'could not start a session' });
  }

  return e.json(200, { token: token, record: authorOf(app, user, user.id) });
}

// ---------- odds and ends ----------

/** A record by id, or null. Never throws, and never queries on a junk id. */
function findRecord(app, collection, id) {
  if (!RECORD_ID_RE.test(String(id || ''))) return null;
  try {
    return app.findRecordById(collection, id);
  } catch {
    return null;
  }
}

/**
 * Bump a stored counter, floored at zero.
 *
 * Floored because these are denormalized: a counter that has drifted below the
 * truth would otherwise go negative and render as "-1 likes" forever.
 */
function bump(record, field, delta) {
  const next = (record.getInt(field) || 0) + delta;
  record.set(field, next < 0 ? 0 : next);
}

/**
 * A free handle derived from whatever the provider calls this person.
 *
 * Collisions are real — two GitHub accounts can have the same display name, and
 * `handle` carries a unique index — so a taken one gets a numeric suffix rather
 * than failing the sign-in. Falls back to a random one, because a person whose
 * name is entirely non-ASCII still needs an account.
 */
function freeHandle(app, preferred) {
  let base = String(preferred || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, MAX_HANDLE - 4);
  if (base.length < 2) base = 'maker';

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}${attempt + 1}`;
    let taken = null;
    try {
      taken = app.findFirstRecordByFilter('users', 'handle = {:h}', { h: candidate });
    } catch {
      taken = null;
    }
    if (!taken) return candidate;
  }
  return `maker${$security.randomStringWithAlphabet(8, '0123456789')}`;
}

/**
 * Download a provider avatar into a PocketBase file.
 *
 * Returns a `filesystem.File` or null, and null is a perfectly good answer: the
 * UI draws an initials chip for everybody without a picture, so a fetch that
 * fails or comes back as something that is not a small image costs nothing.
 * Never throws — a sign-in must not fail because a CDN was slow.
 */
function fetchAvatar(url) {
  try {
    const clean = String(url || '');
    // An allowlist rather than "any https": this runs server side with the
    // box's own network position, so an arbitrary URL here would make the
    // sign-in route a request forwarder pointed at anything the caller names.
    // The caller cannot name it today (both URLs come from the provider's own
    // answer), and this is what keeps that true if the shape of that answer
    // ever changes.
    if (!/^https:\/\/([a-z0-9-]+\.)*(googleusercontent\.com|githubusercontent\.com)\//i.test(clean)) {
      return null;
    }
    const res = $http.send({ url: clean, method: 'GET', timeout: 8 });
    if (res.statusCode !== 200) return null;

    const header = res.headers['Content-Type'] || res.headers['content-type'] || '';
    const type = String(Array.isArray(header) ? header[0] : header)
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (AVATAR_TYPES.indexOf(type) === -1) return null;

    const bytes = res.body;
    if (!bytes || !bytes.length || bytes.length > MAX_AVATAR_BYTES) return null;

    const extension = type === 'image/jpeg' ? 'jpg' : type.split('/')[1];
    return $filesystem.fileFromBytes(bytes, `avatar.${extension}`);
  } catch (err) {
    console.warn('openscreengen: could not fetch an avatar —', err);
    return null;
  }
}

/**
 * How many rows this account has written to `collection` since `sinceMs`.
 *
 * The rate limits are all one shape, so they are all one function. Counted
 * rather than stored on the account, because a stored counter needs a rollover
 * and a rollover needs a clock nobody is watching; this reads an index.
 */
function countSince(app, collection, field, userId, sinceMs) {
  try {
    const since = new DateTime(new Date(Date.now() - sinceMs).toISOString().replace('T', ' ').replace('Z', ''));
    const rows = app.findRecordsByFilter(
      collection,
      `${field} = {:u} && created >= {:since}`,
      '',
      500,
      0,
      { u: userId, since: since }
    );
    return rows.length;
  } catch (err) {
    console.warn(`openscreengen: could not count ${collection} —`, err);
    // Fail OPEN on a counting error rather than locking somebody out of their
    // own feature because a query broke. The caps are anti-flood, not security.
    return 0;
  }
}

module.exports = {
  SECOND,
  MINUTE,
  HOUR,
  DAY,
  MAX_BODY_CHARS,
  SURFACES,
  MAX_TITLE,
  MAX_CAPTION,
  MAX_APP_NAME,
  MAX_COMMENT,
  MAX_TAGS,
  MAX_HANDLE,
  MAX_DISPLAY_NAME,
  MAX_BIO,
  MAX_AVATAR_BYTES,
  RECORD_ID_RE,
  GOOGLE_TOKENINFO_URL,
  GOOGLE_USERINFO_URL,
  GITHUB_USER_URL,
  DEFAULTS,
  settings,
  idList,
  readBody,
  queryOf,
  queryValue,
  formValue,
  clampText,
  clampMultiline,
  jsonArray,
  normalizeTags,
  authUser,
  optionalUser,
  authorOf,
  postOf,
  commentOf,
  VISIBLE,
  scoreOf,
  decorate,
  searchTextOf,
  writeTagColumns,
  toggle,
  upsertAccount,
  findRecord,
  bump,
  freeHandle,
  fetchAvatar,
  countSince,
};

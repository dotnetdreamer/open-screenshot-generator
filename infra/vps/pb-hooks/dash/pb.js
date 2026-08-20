/**
 * The PocketBase client for Open Screenshot Generator Control, hand written.
 *
 * The official SDK would do all of this, but it is a bundle to vendor and keep
 * in step with the box, and the only handful of things this dashboard needs from
 * it are a list call, a superuser login, a file URL and the realtime protocol.
 * There is no build step here, nothing is fetched from a CDN, and the page has
 * to work on a machine with no outbound network, so a dependency is not a
 * convenience, it is a liability.
 *
 * Three parts of this file have a surprise in them and each is worth stating
 * once, at the top, because every one of them has cost somebody an afternoon on
 * a project shaped exactly like this one:
 *
 *  1. **Realtime.** A browser cannot put an Authorization header on an
 *     EventSource. So PocketBase's protocol is "connect anonymously, read your
 *     clientId out of the first PB_CONNECT event, then POST the subscription
 *     list WITH your token". The token on that POST is what the subscriptions
 *     are evaluated as, which is how a superuser gets a feed of collections
 *     whose list rules are all null. See the Realtime class at the bottom for
 *     the two rules that fall out of it.
 *
 *  2. **Files.** PocketBase serves a record's files at
 *     /api/files/{collection}/{record}/{filename} regardless of the
 *     collection's rules, UNLESS the file field is marked `protected`. In this
 *     project `users.avatar` and `posts.images` are public on purpose (the feed
 *     in the app shows them to signed out visitors) while `cloud_projects.doc`
 *     and `cloud_project_assets.file` are protected, because an unguessable URL
 *     is not a permission and a link that has been revoked has to actually stop
 *     working. Protected files want a short lived FILE token, which is a
 *     different thing from the session token. See `fileUrl`.
 *
 *  3. **401 and 403.** Both mean sign in again and neither is ever retried. The
 *     dashboard's own routes therefore answer 400 for a validation failure and
 *     never 403, because a 403 here ejects the operator to the sign in gate
 *     instead of showing them what they got wrong.
 *
 * Every collection on this box is superuser only (all five rules null), so there
 * is no read in this file that works without a session.
 */

/*
 * Storage keys carry the `osg-` prefix the rest of the project moved to during
 * the rename. They are namespaced rather than bare because this dashboard is
 * served from the same origin as the API, and the API's own admin UI lives one
 * path up: two things writing `token` into the same localStorage is how an
 * operator ends up signed out of one by using the other.
 */
const LS_URL = 'osg-dash-url';
const LS_TOKEN = 'osg-dash-token';
const LS_EMAIL = 'osg-dash-email';

/** localStorage is optional here for the same reason it is optional in the app. */
function readLS(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLS(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode, or storage disabled: this session only, which still works */
  }
}

/**
 * The session, as one live object rather than a getter.
 *
 * Views read `auth.url` to build file URLs and `auth.email` to print who is
 * signed in. It is mutated in place on sign in so a module that imported it at
 * load time sees the new value without re-importing anything.
 */
export const auth = {
  url: readLS(LS_URL) || location.origin,
  token: readLS(LS_TOKEN) || '',
  email: readLS(LS_EMAIL) || '',
  admin: null,
};

/** Fired when a call comes back 401/403 so the shell can put the door back up. */
const expiredHandlers = new Set();

export function onExpired(fn) {
  expiredHandlers.add(fn);
  return () => expiredHandlers.delete(fn);
}

/**
 * Everything this module throws.
 *
 * `message` is what `ui.errorState` prints, so it has to be readable on its own:
 * PocketBase puts the useful sentence in `message`, the hook routes in this
 * project put it in `error`, and a transport failure has neither, which is why
 * there is a third fallback. No dashes in it, it reaches the screen.
 */
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || body?.error || `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Query strings, with the empties dropped.
 *
 * `new URLSearchParams({ measure: undefined })` serialises the STRING
 * "undefined", which the storage route would then read as a truthy request to
 * walk the disk. Anything null, undefined or empty is simply not a parameter.
 */
function qs(params) {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value === null || value === undefined || value === '') continue;
    out.set(key, String(value));
  }
  return out.toString();
}

const base = () => auth.url.replace(/\/$/, '');

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(base() + path, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        // Raw, with no Bearer prefix. PocketBase reads the header verbatim and a
        // prefixed token is silently treated as no token at all, which presents
        // as "signed in but everything is 401".
        ...(auth.token ? { Authorization: auth.token } : {}),
        ...(options.headers || {}),
      },
    });
  } catch (err) {
    /*
     * A network failure, a CORS refusal, or an aborted request. It is given a
     * status of 0 rather than being re-thrown raw so that every caller in this
     * dashboard can assume one error shape: `err.status` and `err.message`.
     * Status 0 is deliberately NOT in the sign-out branch below, because the box
     * being unreachable for ten seconds is not a reason to throw away a token
     * that is still perfectly good.
     */
    throw new ApiError(0, { message: 'Could not reach the server' });
  }

  if (res.status === 204) return null;

  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    /*
     * 401 is an expired or missing token. 403 on a superuser-only route means
     * the token belongs to somebody who is not an admin. Both mean "sign in
     * again", and neither is retried: a retry loop against a dead session is how
     * a dashboard rate limits itself out of a box.
     *
     * This is also the reason the dashboard's own routes in `100_dash.pb.js`
     * answer 400 and never 403 for a validation problem. A moderation call with
     * a bad action would otherwise sign the operator out rather than tell them
     * which action was bad.
     */
    if ((res.status === 401 || res.status === 403) && auth.token) {
      signOut();
      for (const fn of expiredHandlers) fn();
    }
    throw new ApiError(res.status, body);
  }
  return body;
}

// ---------------------------------------------------------------- session ---

export async function signIn(url, identity, password) {
  auth.url = String(url || '').replace(/\/$/, '');
  auth.token = '';
  const body = await request('/api/collections/_superusers/auth-with-password', {
    method: 'POST',
    body: JSON.stringify({ identity, password }),
  });
  auth.token = body.token;
  auth.admin = body.record;
  auth.email = body.record?.email || identity;
  writeLS(LS_URL, auth.url);
  writeLS(LS_TOKEN, auth.token);
  writeLS(LS_EMAIL, auth.email);
  // Awaited rather than fired and forgotten, so that the first view to render
  // after the gate closes already has a file token to put in an `<img>`. It is
  // one fast same-origin POST and it swallows its own failure.
  await ensureFileToken(true).catch(() => {});
  startFileTokenTimer();
  return body.record;
}

/**
 * Turns a stored token back into a session, or answers false.
 *
 * A superuser token is valid for a fortnight by default, so this is what makes
 * "open the tab and it is already signed in" work. Refreshing on every load
 * rather than merely trusting the stored string is also what keeps a tab left
 * open across a week from expiring in the middle of a look at the feed.
 */
export async function resume() {
  if (!auth.token) return false;
  try {
    const body = await request('/api/collections/_superusers/auth-refresh', { method: 'POST' });
    auth.token = body.token;
    auth.admin = body.record;
    auth.email = body.record?.email || auth.email;
    writeLS(LS_TOKEN, auth.token);
    await ensureFileToken(true).catch(() => {});
    startFileTokenTimer();
    return true;
  } catch {
    return false;
  }
}

export function signOut() {
  auth.token = '';
  auth.admin = null;
  writeLS(LS_TOKEN, null);
  // The file token outlives nothing. Leaving it behind would mean a signed out
  // tab still had a live handle on protected project blobs for three minutes.
  fileToken = '';
  fileTokenAt = 0;
  fileTokenInFlight = null;
  stopFileTokenTimer();
  realtime.disconnect();
}

// ---------------------------------------------------------------- records ---

/**
 * A page of records.
 *
 * `fields` is worth using on almost everything here. `posts` carries a 1200
 * character `search_text` column that exists only so the app's feed can match on
 * it, and `cloud_projects` carries byte counters and a file handle that a list
 * view showing a name and an owner has no business pulling across the wire. A
 * table of fifty projects with `fields` set is a few kilobytes; without it, it is
 * whatever the widest column happens to be times fifty.
 *
 * `signal` is not in the documented option list but is honoured: the router
 * calls a view's cleanup before mounting the next one, and a fetch that resolves
 * into a view that is already gone is a whole class of bug that costs nothing to
 * prevent here.
 */
export function list(collection, opts = {}) {
  const query = qs({
    page: opts.page || 1,
    perPage: opts.perPage || 50,
    sort: opts.sort,
    filter: opts.filter,
    expand: opts.expand,
    fields: opts.fields,
    skipTotal: opts.skipTotal ? '1' : '',
  });
  return request(`/api/collections/${encodeURIComponent(collection)}/records?${query}`, {
    signal: opts.signal,
  });
}

export function one(collection, id, opts = {}) {
  const query = qs({ expand: opts.expand, fields: opts.fields });
  return request(
    `/api/collections/${encodeURIComponent(collection)}/records/${encodeURIComponent(id)}?${query}`,
    { signal: opts.signal }
  );
}

export function update(collection, id, patch) {
  return request(`/api/collections/${encodeURIComponent(collection)}/records/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function create(collection, body) {
  return request(`/api/collections/${encodeURIComponent(collection)}/records`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Delete one row through the record API.
 *
 * Content moderation does NOT come through here, it goes through
 * `moderate()`. Deleting a post has to decrement its author's `post_count` and
 * deleting a comment has to decrement its post's `comments`, and those two
 * columns are not touched by a cascade. A raw DELETE on a record therefore
 * leaves a counter one too high, which is precisely the drift the Integrity page
 * exists to find. This is here for the raw table browser and for rows that carry
 * no denormalized counter at all.
 */
export function remove(collection, id) {
  return request(`/api/collections/${encodeURIComponent(collection)}/records/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/** How many rows match, without pulling any. */
export async function count(collection, filter) {
  const page = await list(collection, { perPage: 1, filter, fields: 'id' });
  return page.totalItems;
}

/** The live collection list, so the raw table browser is never a hard coded menu. */
export async function collections() {
  const page = await request('/api/collections?perPage=200&sort=name');
  return page.items || [];
}

// ------------------------------------------------------------- file access ---

/*
 * ## Why there is a second token in this file
 *
 * A protected file wants proof, and an `<img src>` cannot carry a header. The
 * obvious shortcut is to put the superuser session token in the query string.
 * Do not do that, ever:
 *
 *   - It lands in the browser's history, where it survives the tab.
 *   - It lands in any screenshot of this dashboard, and a screenshot of an
 *     operator console is a thing people paste into chat without thinking.
 *   - It is valid for a fortnight and it is a full admin credential, so a leak
 *     of it is a leak of the whole box rather than of one picture.
 *
 * PocketBase has a purpose built answer: POST /api/files/token under any
 * authenticated session mints a token that is scoped to file reads and is short
 * lived. That is what goes in the URL.
 *
 * Three minutes is short enough that this cannot be minted once per session and
 * forgotten, so there is a timer below that keeps a fresh one in hand while the
 * tab is visible, a last resort retry that re-mints when an image actually
 * fails, and a click handler that refreshes a download link's token at the
 * moment it is used rather than at the moment it was drawn.
 */
let fileToken = '';
let fileTokenAt = 0;
let fileTokenInFlight = null;
let fileTokenTimer = null;

/*
 * How old a held token is allowed to get before it is replaced.
 *
 * The lifetime is 180 seconds on 0.39.9, measured rather than taken from the
 * docs: POST /api/files/token, decode the payload, and its `exp` is 180 seconds
 * ahead of the clock it was minted against. There is no `iat` claim to subtract,
 * so it is read against the box's own Date header. An earlier version of this
 * comment said "about 120 seconds" and another said "roughly two minutes", and
 * both were guesses that happened to be safe. They are corrected here because
 * the refresh interval below is justified against this number:
 * 75 is well under half of 180, which leaves room for a slow box, for the clock
 * skew between it and this machine, and for a render that happens right at the
 * end of an interval.
 */
const FILE_TOKEN_LIFETIME_MS = 180 * 1000;
const FILE_TOKEN_TTL_MS = Math.min(75 * 1000, FILE_TOKEN_LIFETIME_MS / 2);

/**
 * The collections whose file fields are marked `protected` in the migrations,
 * and therefore the only ones whose URLs need a token on them.
 *
 * Deliberately NOT "put a token on everything". A token in the query string is
 * part of the URL, so every rotation of it is a fresh URL and a guaranteed cache
 * miss. Avatars are the most repeated image in this dashboard, one per row on
 * every table; making them re-download every seventy five seconds because a
 * project blob somewhere else needs a credential would be a visible flicker paid
 * for nothing.
 *
 * The set is seeded from what the migrations say today and can grow at runtime,
 * see `onFileError` at the bottom of this section: if adding a token turns a
 * broken image into a working one, then that collection needed a token and this
 * client has just learned something the hard coded list did not know. That is
 * what covers a caller passing a raw collection ID rather than a name, and a
 * future migration that protects a field nobody remembered to add here.
 */
const PROTECTED_FILE_COLLECTIONS = new Set(['cloud_projects', 'cloud_project_assets']);

async function mintFileToken() {
  const body = await request('/api/files/token', { method: 'POST' });
  fileToken = body?.token || '';
  fileTokenAt = Date.now();
  return fileToken;
}

/**
 * A file token that is good right now, minting one if there is not.
 *
 * Concurrent callers share one in-flight request. Twenty broken thumbnails in a
 * project drawer all firing their error handler in the same tick must cost one
 * POST, not twenty.
 */
export function ensureFileToken(force = false) {
  if (!auth.token) return Promise.resolve('');
  const fresh = fileToken && Date.now() - fileTokenAt < FILE_TOKEN_TTL_MS;
  if (fresh && !force) return Promise.resolve(fileToken);
  if (fileTokenInFlight) return fileTokenInFlight;
  fileTokenInFlight = mintFileToken()
    .catch((err) => {
      // A box that cannot mint one is a box where protected blobs will not load.
      // That is a broken thumbnail, not a broken dashboard, so it is a warning
      // and an empty string rather than a throw.
      console.warn('openscreengen dash: could not mint a file token', err);
      return '';
    })
    .finally(() => {
      fileTokenInFlight = null;
    });
  return fileTokenInFlight;
}

/** Force a new one. Exported for anything that knows its URLs have gone stale. */
export const refreshFileToken = () => ensureFileToken(true);

/*
 * The timer, rather than minting lazily inside `fileUrl`.
 *
 * `fileUrl` is synchronous because it is called from inside HTML template
 * strings, dozens of times per render, and an async URL builder would turn every
 * view into a two pass render. So the token has to already be in hand by the
 * time markup is built, which means something has to keep it fresh in the
 * background. It is paused while the tab is hidden because a dashboard left open
 * on a second monitor overnight should not be POSTing to the box every seventy
 * five seconds until morning.
 */
function startFileTokenTimer() {
  stopFileTokenTimer();
  fileTokenTimer = setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    ensureFileToken(true).catch(() => {});
  }, FILE_TOKEN_TTL_MS);
}

function stopFileTokenTimer() {
  if (fileTokenTimer) clearInterval(fileTokenTimer);
  fileTokenTimer = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (!auth.token) return;
  // Coming back to a tab that has been hidden for an hour: the held token is
  // long dead and the next render would build URLs around it.
  ensureFileToken().catch(() => {});
});

/**
 * An absolute URL for one file on a record.
 *
 * `thumb` takes either a string, which is the common case and matches the
 * documented signature, or an options object for the two rarer needs:
 *
 *   fileUrl('posts', id, name, '640x0')
 *   fileUrl('cloud_projects', id, name, { download: true })
 *   fileUrl(someCollectionId, id, name, { thumb: '96x96', token: true })
 *
 * Only the thumb sizes declared in the migrations exist: `96x96` for
 * `users.avatar`, `640x0` and `1280x0` for `posts.images`. Ask for one of those
 * or ask for none.
 *
 * Returns an empty string when any part is missing, so a caller can write
 * `const src = fileUrl(...); if (src) ...` rather than building a URL that ends
 * in `/undefined`.
 *
 * The token baked in here is the one that was in hand at render time. For an
 * `<a href>` that is not good enough on its own, because a drawer outlives it;
 * `onFileLinkClick` at the bottom of this section brings it up to date when the
 * link is actually clicked, and a caller has nothing to do about that.
 */
export function fileUrl(collectionIdOrName, recordId, filename, thumb) {
  if (!collectionIdOrName || !recordId || !filename) return '';

  const opts = typeof thumb === 'object' && thumb !== null ? thumb : { thumb };
  const path =
    `/api/files/${encodeURIComponent(collectionIdOrName)}` +
    `/${encodeURIComponent(recordId)}/${encodeURIComponent(filename)}`;

  const params = { thumb: opts.thumb, download: opts.download ? '1' : '' };

  const wantsToken =
    opts.token === true ||
    (opts.token !== false && PROTECTED_FILE_COLLECTIONS.has(String(collectionIdOrName)));
  if (wantsToken && fileToken) params.token = fileToken;

  const query = qs(params);
  return base() + path + (query ? `?${query}` : '');
}

/**
 * One stored file, as a Blob, for the caller that needs the BYTES rather than a
 * URL to hand an `<img>` or an `<a>`.
 *
 * The one caller today is the project drawer's importable export, which has to
 * base64 every asset into a single JSON file. That cannot be done with a URL:
 * the whole point is to read the blob and re-encode it.
 *
 * Async on purpose, unlike `fileUrl`. There is no template string to satisfy
 * here, so it can wait for a token instead of relying on one already being in
 * hand, and it retries ONCE with a forced token. That retry is not belt and
 * braces: a drawer can sit open for longer than a file token lives (180 seconds
 * on 0.39.9), and the export is exactly the action somebody takes after reading
 * the page for a while.
 *
 * A 404 is not retried, because a fresh token cannot conjure a missing file, and
 * retrying it would double the requests for a project whose blobs never finished
 * uploading. That case is real: the manifest lists what the document references,
 * and an interrupted save leaves a row behind without its file.
 */
export async function fileBlob(collectionIdOrName, recordId, filename) {
  if (!collectionIdOrName || !recordId || !filename) {
    throw new Error('fileBlob needs a collection, a record and a filename');
  }

  const fetchOnce = async (token) => {
    const path =
      `/api/files/${encodeURIComponent(collectionIdOrName)}` +
      `/${encodeURIComponent(recordId)}/${encodeURIComponent(filename)}`;
    const query = qs({ token: token || '' });
    const res = await fetch(base() + path + (query ? `?${query}` : ''));
    return res;
  };

  let res = await fetchOnce(await ensureFileToken());
  if (res.status === 401 || res.status === 403) {
    res = await fetchOnce(await ensureFileToken(true));
  }
  if (!res.ok) throw new ApiError(res.status, { message: `${filename} could not be read` });
  return res.blob();
}

/**
 * The last resort: an image that failed, retried once with a fresh token.
 *
 * This is a capture phase listener on the document because `error` does not
 * bubble from an `<img>`. One listener for the whole page rather than a handler
 * per image, because images here are built inside HTML strings and threading a
 * callback into every one of them is exactly the kind of ceremony that gets
 * skipped in the twentieth view.
 *
 * It fires for any failure, including a genuinely missing file, so it does not
 * assume the cause. It retries once, and it only writes the collection into
 * `PROTECTED_FILE_COLLECTIONS` if the retry actually LOADS. A 404 therefore
 * costs one wasted request and teaches this client nothing false, while a real
 * 403 from a protected field teaches it permanently for the rest of the session.
 */
function onFileError(ev) {
  const img = ev.target;
  if (!img || img.tagName !== 'IMG' || !auth.token) return;
  const src = img.getAttribute('src') || '';
  if (!src.includes('/api/files/')) return;
  if (img.dataset.pbRetried) return;
  img.dataset.pbRetried = '1';

  ensureFileToken(true).then((token) => {
    if (!token || !img.isConnected) return;
    let url;
    try {
      url = new URL(src, location.href);
    } catch {
      return;
    }
    url.searchParams.set('token', token);

    // Only remember the lesson if the lesson was true. `once` matters: this
    // image may be re-rendered later and we do not want a stale listener from a
    // detached render deciding what the protected set contains.
    img.addEventListener(
      'load',
      () => {
        const parts = url.pathname.split('/');
        const collection = parts[3];
        if (collection) PROTECTED_FILE_COLLECTIONS.add(decodeURIComponent(collection));
      },
      { once: true }
    );
    img.src = url.toString();
  });
}

document.addEventListener('error', onFileError, true);

/**
 * The other half of that arrangement, for links rather than images.
 *
 * `onFileError` above can only rescue an `<img>`: it is bound to the `error`
 * event, and a dead `<a href>` does not raise one. It returns early on anything
 * that is not an IMG, so a Download button was never retried and never
 * rewritten. Measured on a project drawer: the href worked at 0 seconds and
 * answered 404 at 195 seconds, unchanged on the page, with nothing on screen
 * saying so. A drawer that has been open for three minutes while an operator
 * reads the asset list is not an edge case, it is the normal way that panel is
 * used.
 *
 * `fileUrl` is synchronous because it is called from inside HTML template
 * strings, so the token in a link is always the one that was in hand when the
 * markup was built. The fix is therefore not in `fileUrl`, it is here: the
 * token is brought up to date at the moment the link is used.
 *
 * Two paths, and the fast one is the one that almost always runs:
 *
 *   - The held token is young. Rewrite the href in place and do not touch the
 *     event at all, so the browser downloads exactly as it would have. This is
 *     synchronous, which is the whole reason it is worth having: no navigation
 *     is deferred and no popup blocker is involved.
 *   - The held token is old, which happens when the tab has been in the
 *     background and the refresh timer was paused. Hold the click, mint, then
 *     re-dispatch it. `data-pb-minting` is how the re-dispatched click is
 *     recognised on the way back through, since this listener is in the capture
 *     phase and would otherwise catch its own synthetic click forever.
 *
 * A middle click or a modifier click is left alone beyond the rewrite: it opens
 * a tab, and a synthetic `click()` cannot reproduce that intent.
 */
function onFileLinkClick(ev) {
  if (ev.defaultPrevented || !auth.token) return;
  const link = ev.target?.closest?.('a[href]');
  if (!link) return;

  const href = link.getAttribute('href') || '';
  if (!href.includes('/api/files/')) return;

  let url;
  try {
    url = new URL(href, location.href);
  } catch {
    return;
  }

  // /api/files/{collection}/{record}/{filename}, so the collection is the
  // fourth segment of a path that starts with an empty one.
  const collection = decodeURIComponent(url.pathname.split('/')[3] || '');
  if (!url.searchParams.has('token') && !PROTECTED_FILE_COLLECTIONS.has(collection)) return;

  if (link.dataset.pbMinting) {
    delete link.dataset.pbMinting;
    return;
  }

  const young = fileToken && Date.now() - fileTokenAt < FILE_TOKEN_TTL_MS;
  const plainClick = ev.button === 0 && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey && !ev.altKey;

  if (young || !plainClick) {
    if (fileToken && url.searchParams.get('token') !== fileToken) {
      url.searchParams.set('token', fileToken);
      link.setAttribute('href', url.toString());
    }
    return;
  }

  ev.preventDefault();
  link.dataset.pbMinting = '1';
  ensureFileToken(true).then((token) => {
    if (token) {
      url.searchParams.set('token', token);
      link.setAttribute('href', url.toString());
    }
    if (!link.isConnected) {
      delete link.dataset.pbMinting;
      return;
    }
    // Best effort even when the mint failed: the old URL may still be inside its
    // 180 seconds, and a 404 the operator can see beats a button that does
    // nothing at all when they press it.
    link.click();
  });
}

document.addEventListener('click', onFileLinkClick, true);

// ------------------------------------------------- the aggregate routes ---

/*
 * Everything below is a hook route in `100_dash.pb.js` rather than a list call,
 * and the reason is the same for all of them: counting rows is the server's job.
 * Twenty list calls pulling records so the browser can call `.length` on them is
 * fine for ten posts and completely wrong for a hundred thousand likes, and
 * `post_likes` is a table that only ever grows.
 *
 * They all go through `request` so they get URL normalisation, the raw
 * Authorization header, the JSON content type, and the sign out on a dead
 * session, exactly like the record calls above.
 */

/** The overview numbers: accounts, posts, comments, engagement, projects, tables. */
export const stats = () => request('/api/openscreengen/dash/stats');

/** Bucketed counts for the charts. `params` is `{ hours: 24 }` or `{ days: 30 }`. */
export const series = (params) => request(`/api/openscreengen/dash/series?${qs(params)}`);

/** Grouped search over accounts, posts and projects. Under two characters is empty. */
export const search = (q) => request(`/api/openscreengen/dash/search?${qs({ q })}`);

/** Everything the box knows about one account, in one request. */
export const account = (id) => request(`/api/openscreengen/dash/account?${qs({ id })}`);

/** One post with its comments, its likers and its counter drift. */
export const post = (id) => request(`/api/openscreengen/dash/post?${qs({ id })}`);

/** One cloud project with its asset list and its byte totals. */
export const project = (id) => request(`/api/openscreengen/dash/project?${qs({ id })}`);

/** Every integrity finding. Leads, not verdicts, and the page says so. */
export const risk = () => request('/api/openscreengen/dash/risk');

/**
 * Row counts and byte totals, and optionally a bounded walk of the storage
 * directory. `params` is `{}` for the cheap half or `{ measure: 1 }` for the
 * walk, which is opt in because it touches the filesystem.
 */
export const storage = (params) => {
  const query = qs(params);
  return request(`/api/openscreengen/dash/storage${query ? `?${query}` : ''}`);
};

/**
 * The one route here that changes what a user sees.
 *
 * `payload` is `{ target, id, action, ref }`. `ref` is minted in the browser by
 * `ui.newRef()` and passed in rather than made fresh on the way out, because it
 * is an idempotency key: it has to survive a retry of the SAME composed action,
 * and a key generated inside this function would be different on the retry,
 * which is the one thing it must not be.
 */
export const moderate = (payload) =>
  request('/api/openscreengen/dash/moderate', { method: 'POST', body: JSON.stringify(payload) });

/**
 * Rebuild the denormalized counters from the join tables.
 *
 * `payload` is `{ scope, limit }`. Bounded on the server, which is why the
 * answer carries `remaining` as well as `fixed`: the page can say plainly
 * whether another pass is needed rather than pretending one call is the whole
 * repair. No idempotency key, because running it twice is the point of it.
 */
export const recount = (payload) =>
  request('/api/openscreengen/dash/recount', { method: 'POST', body: JSON.stringify(payload) });

/** PocketBase's own liveness endpoint, for the services panel on Pulse. */
export const health = () => request('/api/health');

// --------------------------------------------------------------- realtime ---

/**
 * The live feed.
 *
 * One EventSource for the whole dashboard, with a set of topics that views add
 * to and drop from as they mount and unmount. Four things this has to get right,
 * and the first two are the ones that look like a quiet night rather than a bug:
 *
 * 1. **Re-subscribe on every PB_CONNECT, not only the first.** EventSource
 *    reconnects by itself after a network blip and PocketBase issues a NEW
 *    clientId when it does. A client that only subscribed once comes back
 *    connected and silent. The pill says live, the feed says nothing happened,
 *    and nobody finds out until somebody checks the Feed page by hand.
 *
 * 2. **Debounce the subscribe POST.** Mounting Pulse adds two topics in one
 *    tick, and each POST REPLACES the whole subscription list rather than adding
 *    to it, so firing one per topic would leave only the last one live.
 *
 * 3. **Rebuild the socket when the browser has given up on it.** EventSource
 *    retries on its own only when the connection dropped. If the server answered
 *    with a non 2xx, which is exactly what a reverse proxy in front of a
 *    restarting box returns, readyState goes to CLOSED and it never tries again.
 *    Without the reconnect below, one 502 during a deploy leaves the feed dead
 *    until somebody reloads the page.
 *
 * 4. **Do not tear down a socket that is merely reconnecting.** Closing it here
 *    and building another is how a page ends up with two, both delivering, and
 *    every row rendering twice.
 */
class Realtime {
  constructor() {
    this.es = null;
    this.clientId = '';
    this.topics = new Map(); // topic -> Set<fn>
    this.bound = new Set(); // topics with an EventSource listener attached
    this.status = 'idle';
    this.statusHandlers = new Set();
    this.syncTimer = null;
    this.retryTimer = null;
    this.retryAt = 0;
  }

  onStatus(fn) {
    this.statusHandlers.add(fn);
    fn(this.status);
    return () => this.statusHandlers.delete(fn);
  }

  setStatus(next) {
    if (this.status === next) return;
    this.status = next;
    for (const fn of this.statusHandlers) fn(next);
  }

  connect() {
    if (!auth.token) return;
    // A CLOSED socket is a dead one: the browser will not reopen it, so this is
    // the one case where an existing `es` still means "build a new one".
    if (this.es && this.es.readyState !== EventSource.CLOSED) return;
    if (this.es) this.teardown();

    this.setStatus('connecting');
    const es = new EventSource(base() + '/api/realtime');
    this.es = es;

    es.addEventListener('PB_CONNECT', (ev) => {
      try {
        this.clientId = JSON.parse(ev.data).clientId;
      } catch {
        this.clientId = '';
      }
      // A connect that got this far is a healthy one, so the backoff starts
      // over. Otherwise a single bad afternoon would leave every later reconnect
      // waiting thirty seconds for no reason.
      this.retryAt = 0;
      this.scheduleSync();
    });

    es.onerror = () => {
      if (this.es !== es) return; // a socket we have already replaced
      this.setStatus('down');
      if (es.readyState === EventSource.CLOSED) this.scheduleReconnect();
    };

    for (const topic of this.topics.keys()) this.bind(topic);
  }

  teardown() {
    if (this.es) this.es.close();
    this.es = null;
    this.clientId = '';
    // The listeners lived on the socket that just went away, so every topic has
    // to be bound again on the next one. Forgetting this is a feed that connects
    // fine and delivers nothing.
    this.bound.clear();
  }

  disconnect() {
    clearTimeout(this.retryTimer);
    clearTimeout(this.syncTimer);
    this.retryTimer = null;
    this.teardown();
    this.setStatus('idle');
  }

  scheduleReconnect() {
    if (this.retryTimer) return;
    // 2s, 4s, 8s, 16s, then a flat 30. Long enough that a box coming back up is
    // not being hammered, short enough that an operator watching a deploy sees
    // the pill go green without touching anything.
    this.retryAt = this.retryAt ? Math.min(this.retryAt * 2, 30000) : 2000;
    const wait = this.retryAt;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!auth.token) return;
      this.connect();
    }, wait);
  }

  bind(topic) {
    if (!this.es || this.bound.has(topic)) return;
    this.bound.add(topic);
    this.es.addEventListener(topic, (ev) => {
      let payload = null;
      try {
        payload = JSON.parse(ev.data);
      } catch {
        return;
      }
      const handlers = this.topics.get(topic);
      if (!handlers) return;
      // A copy, because a handler is allowed to unsubscribe itself and mutating
      // the Set while iterating it is how one of a pair of handlers gets skipped.
      for (const fn of [...handlers]) {
        try {
          fn(payload);
        } catch (err) {
          console.warn('openscreengen dash: realtime handler threw', err);
        }
      }
    });
  }

  scheduleSync() {
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => this.sync(), 30);
  }

  async sync() {
    if (!this.clientId) return;
    const subscriptions = [...this.topics.keys()];
    try {
      await request('/api/realtime', {
        method: 'POST',
        body: JSON.stringify({ clientId: this.clientId, subscriptions }),
      });
      /*
       * "live" is about the STREAM, not about the topic count. A view with
       * nothing to subscribe to, Accounts or Tables, still has a healthy
       * connection, and a pill that read "idle" there would look to an operator
       * exactly like the feed had dropped.
       */
      this.setStatus('live');
    } catch {
      this.setStatus('down');
    }
  }

  /**
   * Listen to a topic. Returns the unsubscribe function.
   *
   * Topic is `collection` for everything in it, or `collection/id` for one row.
   * The returned function is what a view hands back from `render()` as its
   * cleanup, and it is the reason a subscription from a page you have left stops
   * updating rows that are no longer on screen.
   */
  subscribe(topic, fn) {
    let handlers = this.topics.get(topic);
    if (!handlers) {
      handlers = new Set();
      this.topics.set(topic, handlers);
      this.bind(topic);
      this.scheduleSync();
    }
    handlers.add(fn);
    return () => {
      handlers.delete(fn);
      if (handlers.size === 0) {
        this.topics.delete(topic);
        this.scheduleSync();
      }
    };
  }
}

export const realtime = new Realtime();

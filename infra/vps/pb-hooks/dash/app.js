/**
 * The shell: the door, the rail, the hash router, the one search box and the
 * theme switch.
 *
 * Views are modules with `render(root)` that return an optional cleanup. The
 * router calls the cleanup BEFORE mounting the next one, which is what stops a
 * realtime subscription from a view you have left carrying on updating rows
 * that are no longer on screen. A cleanup that throws is warned about and
 * stepped over: a broken teardown must never be able to stop the next page
 * from mounting, or one bad view takes the whole dashboard with it.
 *
 * Nothing in a view touches `location`, and nothing in a view imports this
 * file. They go through `window.__dash` instead. That is not squeamishness
 * about globals: this module imports every view, so a view importing it back
 * is a cycle, and cycles in ES modules resolve to a half-initialised namespace
 * whose failure mode is an `undefined is not a function` at the exact moment
 * an operator clicks something. One window handle costs nothing and the shape
 * of the dependency stays a tree.
 */

import * as pb from './pb.js';
import * as theme from './theme.js';
import { $, esc, toast, closeDrawer, ago, nameOf, handleOf, chip, skeleton, errorState } from './ui.js';

// ---------- the icon set ----------

/**
 * Eleven hand drawn marks on one 20x20 grid, stroked and never filled.
 *
 * They are written out here rather than pulled from an icon package for the
 * same reason nothing else in this directory is vendored: the box may have no
 * outbound network, and a rail whose icons are missing is a rail nobody can
 * scan. Drawing them by hand also buys the one thing a package cannot, which
 * is a consistent optical weight. Every path lives inside roughly 2.6 to 17.4,
 * every corner is a 2 to 2.2 radius, and every mark is drawn with the same
 * 1.5 stroke, so no item in the rail looks bolder than its neighbours.
 *
 * The pairings are deliberate. Feed is a picture card because a post here is
 * screenshots before it is text. Cloud projects is two stacked boards, the
 * documents themselves, while Storage is a database cylinder, the disk they
 * sit on: the two pages count the same rows from opposite ends and the icons
 * should say which end you are at. Integrity is a shield with a dot under it
 * rather than a warning triangle, because the page reports leads and not
 * verdicts and a triangle is a verdict.
 */
const ICON = {
  pulse: '<path d="M2.6 10h3.4l2-5.6 3.4 11.2L13.4 10h4"/>',
  feed: '<rect x="2.8" y="3.8" width="14.4" height="12.4" rx="2.4"/><circle cx="7.2" cy="8.2" r="1.3"/><path d="M3.2 14.6 7.4 10.6l2.8 2.6 3-2.6 3.8 3.4"/>',
  comments:
    '<path d="M4.6 3.4h10.8a2 2 0 0 1 2 2v6.2a2 2 0 0 1-2 2H8.4l-3.4 2.6v-2.6h-.4a2 2 0 0 1-2-2V5.4a2 2 0 0 1 2-2z"/><path d="M6 7.2h7.4M6 10h4.6"/>',
  accounts:
    '<circle cx="7.6" cy="7" r="2.9"/><path d="M2.8 16.8a4.8 4.8 0 0 1 9.6 0"/><path d="M13.4 4.9a2.7 2.7 0 0 1 0 5.2"/><path d="M14.3 12a4.7 4.7 0 0 1 3.1 4.2"/>',
  projects:
    '<rect x="2.6" y="6" width="10.6" height="10.6" rx="2.2"/><path d="M6.4 6V4.6a2 2 0 0 1 2-2h6.8a2 2 0 0 1 2 2v6.8a2 2 0 0 1-2 2h-2"/>',
  growth: '<path d="M3.2 3v13.8h13.8"/><path d="M5.8 13.4 8.8 10l2.4 2.2 5.2-5.4"/><path d="M12.8 6.8h3.6v3.6"/>',
  tags:
    '<path d="M2.8 6.4a2.2 2.2 0 0 1 2.2-2.2h5.9a2.2 2.2 0 0 1 1.63.72l3.83 4.2a1.3 1.3 0 0 1 0 1.76l-3.83 4.2a2.2 2.2 0 0 1-1.63.72H5a2.2 2.2 0 0 1-2.2-2.2z"/><circle cx="6.5" cy="10" r="1.2"/>',
  storage:
    '<ellipse cx="10" cy="5.4" rx="6.6" ry="2.6"/><path d="M3.4 5.4v8.6c0 1.44 2.96 2.6 6.6 2.6s6.6-1.16 6.6-2.6V5.4"/><path d="M16.6 9.8c0 1.44-2.96 2.6-6.6 2.6S3.4 11.24 3.4 9.8"/>',
  risk: '<path d="M10 2.6 3.4 5.2v5c0 3.5 2.72 6.1 6.6 7 3.88-.9 6.6-3.5 6.6-7v-5z"/><path d="M10 7.4v3.2M10 13.3v.1"/>',
  // Sliders and not the usual cog, for two reasons. The Settings page is 28
  // tunables and a row of sliders says that; and a cog is a circle wearing
  // rays, which at 17px is the same mark as the sun on the theme switch two
  // inches away in the same topbar. Two icons that mean nothing alike must not
  // look alike on one screen.
  settings: '<path d="M2.8 7h8.5M15.5 7h1.7M2.8 13h1.7M8.7 13h8.5"/><circle cx="13.4" cy="7" r="2.1"/><circle cx="6.6" cy="13" r="2.1"/>',
  tables:
    '<rect x="2.6" y="3.4" width="14.8" height="13.2" rx="2.2"/><path d="M2.6 8h14.8M2.6 12.3h14.8M7.6 8v8.6M12.4 8v8.6"/>',
};

/**
 * What the Shift+D toast says about each mode.
 *
 * Whole sentences rather than the bare mode name, because `system` is the one
 * an operator is most likely to land on by accident and "Theme: system" does
 * not tell them what it is now going to do.
 */
const THEME_SAID = {
  light: 'Theme: light',
  system: 'Theme now follows the system',
  dark: 'Theme: dark',
};

// ---------- routes ----------

/**
 * Rail order is the order an operator works in, not alphabetical and not the
 * order the routes were written.
 *
 * Pulse first because it answers "is anything happening". Then the three
 * moderation surfaces in the order a report travels through them, Feed to
 * Comments to Accounts, then Cloud projects because that is the same content
 * from the disk's side. Growth, Tags and surfaces and Storage are the reading
 * pages, and Integrity, Settings and Tables sit at the bottom because they are
 * the ones you go to on purpose rather than the ones you land on.
 *
 * `badge` names what the rail count on that row means. Only three rows have
 * one, and the label is here rather than in `setRailCount` so the number in
 * the rail can carry a tooltip that says what it is counting: a bare "12" next
 * to Feed is a number an operator has to guess at.
 */
const ROUTES = [
  { id: 'pulse', label: 'Pulse', load: () => import('./views/pulse.js') },
  { id: 'feed', label: 'Feed', badge: 'hidden posts', load: () => import('./views/feed.js') },
  { id: 'comments', label: 'Comments', badge: 'hidden comments', load: () => import('./views/comments.js') },
  { id: 'accounts', label: 'Accounts', load: () => import('./views/accounts.js') },
  { id: 'projects', label: 'Cloud projects', load: () => import('./views/projects.js') },
  { id: 'growth', label: 'Growth', load: () => import('./views/growth.js') },
  { id: 'tags', label: 'Tags and surfaces', load: () => import('./views/tags.js') },
  { id: 'storage', label: 'Storage', load: () => import('./views/storage.js') },
  { id: 'risk', label: 'Integrity', badge: 'findings', load: () => import('./views/risk.js') },
  { id: 'settings', label: 'Settings', load: () => import('./views/settings.js') },
  { id: 'tables', label: 'Tables', load: () => import('./views/tables.js') },
];

/**
 * The three detail routes.
 *
 * Each one rides ON TOP of whichever list view is underneath, so a pasted
 * `#/post/<id>` link works on a cold load exactly as it does from a click: the
 * router mounts `under` first when there is nothing mounted yet, then opens the
 * drawer over it. Without the fallback a shared link would open a drawer over
 * an empty page and closing it would leave the operator staring at nothing.
 *
 * The imports are lazy and each one is its own literal `import()`, because a
 * computed specifier is not something a plain ES module loader can resolve and
 * because the account drawer is a big module nobody browsing Growth should be
 * made to download. `openProject` is a named export of the LIST view rather
 * than a detail module of its own: the project drawer is small enough that
 * splitting it would cost a file and buy nothing.
 */
const DETAIL = {
  post: { under: 'feed', open: () => import('./views/postDetail.js').then((m) => m.openPost) },
  account: { under: 'accounts', open: () => import('./views/accountDetail.js').then((m) => m.openAccount) },
  project: { under: 'projects', open: () => import('./views/projects.js').then((m) => m.openProject) },
};

let cleanup = null;
let currentRoute = '';

/**
 * Bumped by every mount, and compared after every await inside one.
 *
 * Mounting is asynchronous twice over: the module has to be imported and then
 * its `render` has to finish. Two clicks in quick succession therefore have two
 * mounts in flight, and without this the slower one wins the last write. The
 * visible half of that is a page that flickers to the wrong view. The invisible
 * half is worse: the losing view's cleanup gets overwritten by the winner's and
 * is never called, which leaves exactly the orphaned realtime subscription this
 * whole router was shaped to prevent.
 */
let mountToken = 0;

/**
 * Bumped at the top of EVERY `mount()`, including the ones that do not remount
 * the view, and checked once before the detail dispatch at the bottom.
 *
 * `mountToken` above is not enough on its own, because it is only bumped inside
 * the "the route actually changed" branch. A detail route on the SAME underlying
 * list skips that branch entirely and so never touches it, which left this hole:
 *
 *   1. boot mounts Pulse and sits awaiting its dynamic import and its render.
 *   2. a pasted `#/project/<id>` arrives. `currentRoute` is already `pulse`, so
 *      this second mount skips the whole block, reaches the bottom, and opens
 *      the drawer. Correct, and visible on screen.
 *   3. the FIRST mount finally resumes, reaches the same bottom with its own
 *      `params` of `{}`, and runs the `else` branch: `closeDrawer()`.
 *
 * The drawer opened and then shut by itself about a second later, with nothing
 * in the console. Measured at 1s open, 2s gone. That is the whole promise of a
 * pasted deep link broken by a race between two mounts of the same view.
 *
 * A hash comparison would have fixed this particular case and introduced a
 * worse one: `views/tables.js` writes its collection into the hash with
 * `history.replaceState` while it renders, so a mount that compared hashes
 * would bail on a legitimate route change and leave a drawer open over the new
 * page. A counter cannot be fooled by anybody else's `replaceState`.
 */
let mountCall = 0;

/**
 * The mount that is currently in flight, as a promise that settles when its
 * `render` has returned, or null when nothing is mounting.
 *
 * This exists for one bug, which is worth writing down in full because the
 * guards it broke look correct.
 *
 * Every list view protects itself with a generation check after each await:
 * feed.js compares `loadToken`, comments.js checks an `alive` flag, accounts.js
 * compares its own token. All three are flipped by the CLEANUP the router calls,
 * and that is the hole: during a view's FIRST load, `render()` has not returned
 * yet, so there IS no cleanup for the router to call, so nothing flips. Signing
 * out at that moment ran `endSession()`, which emptied `#view` out from under
 * the in-flight load, and the load's own error path then did
 * `root.querySelector('#feed-total').textContent = ''` on an element that no
 * longer existed. Measured: "TypeError: Cannot set properties of null (setting
 * 'textContent')" from feed.js, accounts.js and comments.js, every time.
 *
 * The fix is to invalidate the mount first and empty `#view` only once nothing
 * is still rendering into it. The in-flight load then finishes writing into its
 * own markup, harmlessly, behind the sign-in gate that is already up; `mount()`
 * sees the stale token, runs the cleanup it was handed, and from that moment the
 * views' own guards work exactly as their authors wrote them.
 *
 * A route change has the same shape and is deliberately NOT deferred: the whole
 * point of a navigation is that the next page paints at once, and the departing
 * view's rejection lands inside `mount()`'s own try, which owns it.
 */
let mountInFlight = null;

// ---------- the rail ----------

function buildRail() {
  const nav = $('#rail-nav');
  nav.innerHTML = ROUTES.map(
    (route) => `<a class="nav-item" href="#/${route.id}" data-route="${route.id}">
      <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.5"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[route.id]}</svg>
      <span>${esc(route.label)}</span>
      <span class="nav-count" data-count="${route.id}" data-label="${esc(route.badge || '')}" hidden></span>
    </a>`
  ).join('');

  // Under 1000px the rail is a drawer over the page, so following a link has to
  // put it away again. It is one listener on the nav rather than one per item
  // because the rail is rebuilt on nothing and eleven listeners for one job is
  // eleven chances to leak one.
  nav.addEventListener('click', () => setRailOpen(false));
}

/**
 * Open or close the rail, and keep the keyboard in step with where it is.
 *
 * Below the sheet's breakpoint the rail stops being a column and becomes a
 * drawer over the page, moved off screen with a transform. A transform moves
 * pixels and nothing else: its eleven nav links and Sign out stayed focusable
 * and stayed in the accessibility tree, so at 412px the first twelve Tab stops
 * were all at x=-204, off the left edge of the screen, before the operator
 * reached the first control they could actually see. Twelve invisible stops is
 * not a rough edge, it is a keyboard operator being unable to reach the page.
 *
 * `inert` rather than a style, because the sheet is not this file's to change
 * and because the two must not be able to disagree: `inert` takes the subtree
 * out of the tab order and out of the accessibility tree together, and it is
 * one attribute either way.
 *
 * Whether the rail is off screen is read from the rail's own computed
 * `position` rather than from a `matchMedia` copy of the breakpoint. The number
 * lives in `styles.css`; duplicating it here would mean a sheet that moved the
 * breakpoint left this file quietly wrong, with no symptom until somebody
 * tabbed. `fixed` is what the narrow rule switches it to, and it is the same
 * fact the transform depends on.
 */
function railIsOverlay() {
  const rail = document.querySelector('.rail');
  if (!rail) return false;
  return getComputedStyle(rail).position === 'fixed';
}

function syncRailInert() {
  const rail = document.querySelector('.rail');
  if (!rail) return;
  const closed = !$('#app').classList.contains('rail-open');
  if (closed && railIsOverlay()) rail.setAttribute('inert', '');
  else rail.removeAttribute('inert');
}

function setRailOpen(open) {
  $('#app').classList.toggle('rail-open', open);
  syncRailInert();
}

/**
 * The live counts worth carrying in the rail.
 *
 * Three rows have one: hidden posts on Feed, hidden comments on Comments, and
 * open findings on Integrity. All three are queues, and a queue that is only
 * visible once you are already looking at it is a queue nobody reads.
 *
 * Passing `null` hides the badge, and zero is deliberately passed as `null` by
 * every caller. A rail full of zeroes teaches the eye to skip the badges, and
 * then the one that says 4 gets skipped too.
 *
 * Views call this through `window.__dash.setRailCount` after they moderate
 * something, so the number stays honest without a refetch, and they clear it in
 * their cleanup so a stale count does not outlive the page that knew it.
 */
export function setRailCount(id, value) {
  const badge = $(`[data-count="${id}"]`);
  if (!badge) return;
  if (value === null || value === undefined) {
    badge.hidden = true;
    badge.removeAttribute('title');
    badge.textContent = '';
    return;
  }
  badge.hidden = false;
  badge.textContent = String(value);
  const label = badge.dataset.label || '';
  if (label) badge.title = `${value} ${label}`;
}

/**
 * How many findings the Integrity page would show.
 *
 * Counted here rather than read from a field, because the risk route answers
 * with one array per check and a check that could not run is simply absent.
 * Summing the arrays we recognise means a route that grows a new check does not
 * need this list updated to keep working, it just does not badge the new one
 * until somebody adds the key.
 *
 * Two deliberate exclusions. `unlinked_accounts` is a plain number and is not a
 * defect: an account with neither provider linked is a legacy row or a token
 * sign-in, not something anybody needs to go and fix. And the orphan buckets
 * are counted as ONE finding each rather than by their row counts, because
 * "post_likes: 4180" is one broken cascade, not four thousand problems.
 *
 * The route caps most lists at 40 rows, so this is a floor and not a total.
 * That is fine for a badge, whose job is to say "there is something here".
 */
const FINDING_KEYS = [
  'post_like_drift',
  'post_comment_drift',
  'comment_like_drift',
  'author_count_drift',
  'follower_drift',
  'self_follows',
  'duplicate_handles',
  'slug_collisions',
  'empty_posts',
  'burst_posters',
  'burst_commenters',
  'heavy_owners',
  'over_quota_projects',
  'banned_with_content',
];

function countFindings(risk) {
  if (!risk) return 0;
  let total = 0;
  for (const key of FINDING_KEYS) {
    const rows = risk[key];
    if (Array.isArray(rows)) total += rows.length;
  }
  const orphans = risk.orphans || {};
  for (const key of Object.keys(orphans)) {
    if (Number(orphans[key]) > 0) total += 1;
  }
  return total;
}

/**
 * Fill the three rail badges.
 *
 * Once on boot and again with the refresh button, never on a route change. Two
 * aggregate calls on every navigation would double the traffic of the whole
 * dashboard to keep three numbers warm, and neither number moves fast enough to
 * be worth it: hidden posts change when an operator hides one, and the operator
 * doing that is the same person looking at the badge.
 *
 * Each half is caught on its own. The risk route runs fifteen separate queries
 * and is the likeliest thing here to be slow or unhappy on a box mid migration,
 * and it must not be able to take the two cheap counts down with it. Nothing
 * toasts: a badge that could not be fetched is a badge that stays as it was,
 * and an operator who came here to read the Feed does not need a red box about
 * it. An expired session is handled by `pb.js`, which signs out and raises
 * `onExpired`, so there is nothing to do here for a 401.
 */
async function refreshBadges() {
  if (!pb.auth.token) return;

  try {
    const stats = await pb.stats();
    setRailCount('feed', stats?.posts?.hidden || null);
    setRailCount('comments', stats?.comments?.hidden || null);
  } catch (err) {
    console.warn('rail badges: stats did not answer', err);
  }

  try {
    const risk = await pb.risk();
    setRailCount('risk', countFindings(risk) || null);
  } catch (err) {
    console.warn('rail badges: risk did not answer', err);
  }
}

// ---------- the router ----------

/**
 * Run the current view's cleanup and forget it.
 *
 * Also called on sign out and on an expired session, not only between routes.
 * A view whose realtime handler is still attached while the door is back up
 * would keep writing rows into a page the operator can no longer see, and the
 * first thing they would see after signing in again is the previous session's
 * table.
 */
function runCleanup(fn) {
  if (typeof fn !== 'function') return;
  try {
    fn();
  } catch (err) {
    // Warned and stepped over. A teardown that throws is a bug in that view,
    // and making it also block the next mount would turn one broken page into
    // a dashboard that cannot navigate.
    console.warn('view cleanup threw', err);
  }
}

function teardownView() {
  const fn = cleanup;
  // Cleared before it runs, not after, so a cleanup that throws still empties
  // the slot and cannot be called a second time by the next teardown.
  cleanup = null;
  runCleanup(fn);
}

async function mount(routeId, params) {
  const route = ROUTES.find((r) => r.id === routeId) || ROUTES[0];
  const view = $('#view');
  const call = ++mountCall;

  if (currentRoute !== route.id) {
    teardownView();
    currentRoute = route.id;
    const token = ++mountToken;

    // The skeleton rather than a spinner, and rather than leaving the old view
    // up: a dynamic import off a cold cache is long enough to notice, and the
    // shape of what is coming is more use than an animation that says nothing.
    view.innerHTML = skeleton('rows', 5);

    document.querySelectorAll('.nav-item').forEach((item) => {
      const active = item.dataset.route === route.id;
      item.classList.toggle('is-active', active);
      if (active) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });

    // A middle dot and not a dash, and the section first, because a tab strip
    // truncates from the right and the section is the half worth keeping.
    document.title = `${route.label} · Open Screenshot Generator Control`;

    // Published before the first await, so anything that tears the session down
    // while this is running can find out that a render is still in progress.
    let settle;
    const ours = new Promise((resolve) => {
      settle = resolve;
    });
    mountInFlight = ours;

    try {
      const module = await route.load();
      if (token !== mountToken) return;

      const result = await module.render(view);
      // A view that returns anything other than a function is treated as a view
      // with no cleanup. Calling a returned object later would throw inside the
      // teardown, which is the one place an error is most expensive.
      const teardown = typeof result === 'function' ? result : null;

      if (token !== mountToken) {
        // A newer navigation landed while this one was rendering, so its markup
        // is already gone from the page. The cleanup it handed back is the one
        // thing that still matters: run it here rather than dropping it, or the
        // subscription it was holding outlives every trace of the view.
        runCleanup(teardown);
        return;
      }
      cleanup = teardown;
    } catch (err) {
      console.error(err);
      if (token !== mountToken) return;
      cleanup = null;
      // The message goes in the view area, never to a blank page. Nine times
      // out of ten it is the message from the route that failed, and that is
      // the fastest thing an operator can hand back to whoever is on the box.
      view.innerHTML = errorState('That view did not load', err);
    } finally {
      // In a `finally` because half the branches above return from the middle
      // of the try, and a promise nobody ever resolves is a sign out that never
      // gets to empty the page.
      settle();
      if (mountInFlight === ours) mountInFlight = null;
    }

    view.focus({ preventScroll: true });
  }

  // Everything above may have awaited. If another mount started meanwhile it has
  // already run the dispatch below with fresher params, and this one would undo
  // it. See the note on `mountCall`.
  if (call !== mountCall) return;

  if (params.detail) {
    const spec = DETAIL[params.detail];
    // The hash is re-read after the import for the same reason the mount token
    // exists: the account drawer is a big module, and an operator who clicked
    // through two rows before it arrived should get the second one, not have
    // the first open over the top of it.
    const wanted = location.hash;
    try {
      const open = await spec.open();
      if (location.hash !== wanted) return;
      await open(params.id);
    } catch (err) {
      console.error(err);
      toast(err.message || 'Could not open that record', 'bad');
    }
  } else {
    closeDrawer();
  }
}

/**
 * The hash is the whole of the router's state, which is what makes every page
 * in this dashboard a link somebody can paste into a chat.
 *
 * Extra segments after a route id belong to the view, not to the router. Tables
 * uses one to name the collection, and the router deliberately ignores it so
 * that switching collections does not tear the page down and rebuild it.
 *
 * The id in a detail route is passed through unvalidated. The server checks it
 * against the 15 character record id shape and answers 400 with a message when
 * it is junk, and one honest error in the drawer beats a second opinion in the
 * router that has to be kept in step with PocketBase's id rules.
 */
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const bits = raw.split('/').filter(Boolean);
  if (!bits.length) return { route: 'pulse', params: {} };

  const detail = DETAIL[bits[0]];
  if (detail && bits[1]) {
    return { route: currentRoute || detail.under, params: { detail: bits[0], id: bits[1] } };
  }
  return { route: bits[0], params: {} };
}

function onRoute() {
  const { route, params } = parseHash();
  mount(route, params);
}

/**
 * Navigation, for views. Setting the same hash fires no `hashchange`, so the
 * same-hash case is routed by hand: that is what makes "close the drawer and
 * go back to the list underneath" work when the list is already the route.
 */
export function go(hash) {
  if (location.hash === hash) onRoute();
  else location.hash = hash;
}

/**
 * Rebuild the page that is on screen.
 *
 * The hash is parsed BEFORE `currentRoute` is cleared, because a detail route
 * resolves its underlying list view from `currentRoute` and clearing first
 * would drop an operator refreshing `#/post/<id>` onto the Feed no matter which
 * page they had opened the post from.
 */
function remount() {
  const { route, params } = parseHash();
  currentRoute = '';
  mount(route, params);
  refreshBadges();
}

// ---------- search ----------

/**
 * One box over accounts, posts and projects.
 *
 * Everything about it is built around the fact that an operator arrives here
 * with an id, a handle or half a title pasted from somewhere else and wants to
 * be on that record in one motion:
 *
 * - 220ms debounce and a two character floor, because the route runs three
 *   LIKE queries and a single typed character matches most of the table.
 * - A sequence number on every request. A slow answer for "ab" arriving after a
 *   fast answer for "abcd" would otherwise repaint the panel with the wrong
 *   results and there is no way for the operator to tell.
 * - `mousedown` and not `click` on the results. The input loses focus on
 *   mousedown, the blur closes the panel, and a click handler would then fire
 *   on an element that is already gone. This is the single most common way a
 *   hand written combo box ends up feeling broken.
 * - Up, Down, Enter, Escape, `/` to focus from anywhere, and Ctrl+K or Cmd+K to
 *   open it. Escape stops there rather than bubbling when the panel is open, so
 *   one press peels one layer and a drawer underneath survives it.
 */
function wireSearch() {
  const input = $('#search-input');
  const panel = $('#search-results');
  let timer = null;
  let seq = 0;
  let hits = [];
  let active = -1;

  /*
   * The roles that make this a combobox rather than a box with a div under it.
   *
   * It had `aria-expanded` and `aria-controls` on a bare `input type="search"`,
   * whose implicit role is `searchbox`, and `aria-expanded` is not supported
   * there: it was being written and ignored. `aria-activedescendant` was already
   * tracking correctly and `aria-selected` was never set on anything, so the
   * keyboard cursor was visible to the eye and invisible to a screen reader,
   * which is the exact combination that leaves somebody pressing Enter on a row
   * they were never told about.
   *
   * `role="combobox"` on the input is what makes `aria-expanded`,
   * `aria-controls` and `aria-activedescendant` mean something, and
   * `aria-autocomplete="list"` says the panel is filled from what was typed
   * rather than from a fixed set.
   */
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  panel.setAttribute('role', 'listbox');
  panel.setAttribute('aria-label', 'Search results');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', panel.id);

  const hide = () => {
    panel.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    hits = [];
    active = -1;
  };

  const show = (html) => {
    panel.innerHTML = html;
    panel.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    hits = [...panel.querySelectorAll('.search-hit')];
    active = -1;
    input.removeAttribute('aria-activedescendant');
  };

  const highlight = (next) => {
    if (!hits.length) return;
    if (active >= 0) {
      hits[active].classList.remove('is-active');
      hits[active].setAttribute('aria-selected', 'false');
    }
    active = (next + hits.length) % hits.length;
    const el = hits[active];
    el.classList.add('is-active');
    // The pair, always. `.is-active` is what the eye follows and `aria-selected`
    // is what is read out, and a cursor that only does one of the two is a
    // cursor half the operators cannot see.
    el.setAttribute('aria-selected', 'true');
    el.scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-activedescendant', el.id);
  };

  const choose = (el) => {
    if (!el) return;
    const target = el.dataset.go;
    input.value = '';
    hide();
    input.blur();
    go(target);
  };

  // One row shape for all three groups. A search panel where accounts and posts
  // line their text up differently is one the eye has to re-learn per group,
  // and the meta column is right aligned by `.search-hit .muted` so the times
  // and the counts form a column of their own.
  const hit = (index, hash, main, meta, tail) =>
    `<div class="search-hit" id="search-hit-${index}" role="option" aria-selected="false" data-go="${esc(hash)}" tabindex="-1">
      <span class="truncate">${main}</span>
      ${meta ? `<span class="dim tiny truncate">${meta}</span>` : ''}
      ${tail ? `<span class="muted tiny nowrap">${tail}</span>` : ''}
    </div>`;

  /*
   * The group headings are marked presentational.
   *
   * A `listbox` is supposed to contain options and nothing else, and these are
   * three words of chrome that sit between them. Left with no role they are a
   * stray child of the list; as presentation they are still on screen for the
   * eye, still styled by `.search-group`, and out of the way of the option count
   * a screen reader reports. The same goes for the one line messages below,
   * which are not choices either.
   */
  const group = (label) => `<div class="search-group" role="presentation">${esc(label)}</div>`;

  const run = async () => {
    const q = input.value.trim();
    if (q.length < 2) return hide();

    const mine = ++seq;
    let result;
    try {
      result = await pb.search(q);
    } catch (err) {
      if (mine !== seq) return;
      show(`<div class="search-group" role="presentation">${esc(err.message || 'Search did not answer')}</div>`);
      return;
    }
    if (mine !== seq) return;

    const accounts = result.accounts || [];
    const posts = result.posts || [];
    const projects = result.projects || [];
    if (!accounts.length && !posts.length && !projects.length) {
      /*
       * "No match" on its own hid a real limit of the route rather than
       * reporting it. `share_slug` is matched EXACTLY and never by substring,
       * deliberately, because a 22 character slug is the whole permission to
       * read a private project and a fragment of a reported link must not be
       * enough to find it. An operator who pasted half a link therefore got the
       * same two words as an operator who typed nonsense, and no way to tell
       * which of the two had happened. So the box says what it looks at.
       *
       * The sentence is a paragraph rather than another `.search-group`, whose
       * uppercase small caps are for a three word heading and unreadable at this
       * length. It carries its own padding because `.search-results` pads to 6px
       * and the headings above it sit at 9, and one declaration here is cheaper
       * to follow than a class in the sheet that exists for one string.
       */
      show(
        '<div class="search-group" role="presentation">No match</div>' +
          '<p class="muted tiny" role="presentation" style="margin:0;padding:0 9px 8px;line-height:1.45">' +
          'This looks at names, handles, emails and ids for accounts, titles, app names and tags for posts, ' +
          'and names and ids for projects. A share link has to be pasted whole, since half of one matches nothing' +
          '</p>'
      );
      return;
    }

    // One running index across the groups, because keyboard navigation walks
    // the panel top to bottom and does not care that the rows are grouped.
    let index = 0;
    let html = '';

    if (accounts.length) {
      html += group('Accounts');
      html += accounts
        .map((account) => {
          /*
           * The chip words are the ones the rest of the dashboard uses, and
           * they were not. "verified" was this panel's own invention for the
           * `verified_badge` column, which every other surface calls a badge,
           * and two words for one column is two things for an operator to learn
           * and one of them to doubt.
           */
          const marks = [
            account.banned ? chip('banned', 'bad') : '',
            account.verified_badge ? chip('badge', 'good') : '',
          ].join('');
          return hit(
            index++,
            `#/account/${account.id}`,
            esc(nameOf(account)),
            esc(handleOf(account) || account.email || ''),
            marks
          );
        })
        .join('');
    }

    if (posts.length) {
      html += group('Posts');
      html += posts
        .map((post) =>
          hit(
            index++,
            `#/post/${post.id}`,
            esc(post.title || 'Untitled'),
            esc([post.surface || '', post.author_name || ''].filter(Boolean).join(' · ')),
            (post.hidden ? chip('hidden', 'warn') : '') + `<span>${esc(ago(post.created))}</span>`
          )
        )
        .join('');
    }

    if (projects.length) {
      html += group('Projects');
      html += projects
        .map((project) =>
          hit(
            index++,
            `#/project/${project.id}`,
            esc(project.name || 'Untitled project'),
            esc(project.owner_name || ''),
            // The full phrase, the same as the project drawer and the projects
            // table. "shared" on its own does not say shared with whom, and the
            // answer, anybody holding the link, is the half that matters.
            project.visibility === 'link' ? chip('shared by link', 'accent') : ''
          )
        )
        .join('');
    }

    show(html);
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(run, 220);
  });

  // Coming back to a box that still has a query in it should show its results
  // again rather than making the operator type a character to wake it up.
  input.addEventListener('focus', () => {
    if (input.value.trim().length >= 2) run();
  });

  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      if (panel.hidden) return run();
      highlight(active + 1);
      return;
    }
    if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      highlight(active - 1);
      return;
    }
    if (ev.key === 'Enter') {
      // Enter with nothing highlighted takes the first hit, which is what an
      // operator who pasted an id and hit return is asking for.
      if (panel.hidden || !hits.length) return;
      ev.preventDefault();
      choose(active >= 0 ? hits[active] : hits[0]);
      return;
    }
    if (ev.key === 'Escape') {
      if (!panel.hidden) ev.stopPropagation();
      input.value = '';
      hide();
      input.blur();
    }
  });

  panel.addEventListener('mousedown', (ev) => {
    const el = ev.target.closest('[data-go]');
    if (!el) return;
    ev.preventDefault(); // hold the focus so the blur does not close the panel first
    choose(el);
  });

  panel.addEventListener('mousemove', (ev) => {
    const el = ev.target.closest('.search-hit');
    if (!el) return;
    const index = hits.indexOf(el);
    if (index >= 0 && index !== active) highlight(index);
  });

  document.addEventListener('click', (ev) => {
    if (!ev.target.closest('.search')) hide();
  });

  document.addEventListener('keydown', (ev) => {
    const typing = isTyping();
    if (ev.key === '/' && !typing) {
      ev.preventDefault();
      input.focus();
      input.select();
      return;
    }
    if ((ev.key === 'k' || ev.key === 'K') && (ev.metaKey || ev.ctrlKey)) {
      // Ctrl+K is Chrome's address bar and Cmd+K is Safari's, and taking it
      // here is the convention every operator already has in their hands.
      ev.preventDefault();
      input.focus();
      input.select();
      if (input.value.trim().length >= 2) run();
    }
  });
}

/** True when the keystroke belongs to whatever the operator is typing into. */
function isTyping() {
  const el = document.activeElement;
  if (!el) return false;
  if (el.isContentEditable) return true;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || '');
}

// ---------- theme ----------

/**
 * The three way switch: light, follow the system, dark.
 *
 * The division of labour here is deliberate and is written down in all three
 * files that touch it. `index.html` owns the markup, because a control that is
 * part of the page's chrome should be in the page and not conjured by script
 * after first paint. `theme.js` owns the state and writes `aria-pressed` from
 * its own `apply`, so the control is correct however the theme moved: a click,
 * the keyboard shortcut, another tab writing localStorage, or the OS flipping
 * under a `system` choice. This file owns nothing but the clicks and the
 * shortcut, which is why there is no repainting code below.
 *
 * `system` is the default and it stamps nothing on `<html>`, which is what lets
 * `prefers-color-scheme` keep deciding live. That is the whole reason this is
 * three states and not a toggle: an operator whose machine flips to dark at
 * sunset should not have to come back here and flip it too.
 *
 * The control is optional as far as this function is concerned. Shift+D is
 * bound whether or not the topbar has one, so the theme is never unreachable.
 */
function wireTheme() {
  const host = $('#theme-switch');
  if (host) {
    // Delegated, so the click lands whether the operator hit the button or the
    // icon inside it. `data-theme-set` is the contract theme.js documents.
    host.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-theme-set]');
      if (!btn) return;
      theme.setTheme(btn.dataset.themeSet);
    });
  }

  document.addEventListener('keydown', (ev) => {
    if (!ev.shiftKey || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key !== 'D' && ev.key !== 'd') return;
    // Shift+D in a filter box is somebody typing a capital D.
    if (isTyping()) return;
    ev.preventDefault();
    const next = theme.cycleTheme();
    // Toasted because the shortcut is invisible: the control in the topbar
    // moves too, but the eye is on the page and not up there when it happens.
    toast(THEME_SAID[next] || 'Theme changed');
  });
}

// ---------- the door ----------

/**
 * The third state of the door: neither signed in nor asked to sign in.
 *
 * `boot()` used to be `if (await pb.resume()) showApp(); else showGate(null)`
 * with nothing between the two, and `#gate` ships visible in `index.html`, so
 * the whole of that await was spent showing a sign-in form. On a fast box that
 * is 40ms and invisible. On a box where the first request stalls, which is
 * exactly what the EventSource leak above used to cause on every sixth load, it
 * was up to 25 seconds of a form with the email already filled in, inviting an
 * operator to type a superuser password into a session that was about to come
 * back by itself. Passwords typed under that impression are how a credential
 * ends up in a chat window ten minutes later.
 *
 * Nothing is painted for the first fifth of a second. A resume that answers in
 * 40ms should look like a page that was simply already signed in, not like a
 * panel that flashed, and a delay is the only way to have both this state and
 * that. The markup borrows `.gate` and `.gate-card` rather than inventing
 * classes, so it inherits the door's own centring and card in both themes.
 */
const CHECKING_DELAY_MS = 200;
let checkingTimer = null;

function showChecking() {
  $('#gate').hidden = true;
  $('#app').hidden = true;
  clearTimeout(checkingTimer);
  checkingTimer = setTimeout(() => {
    if ($('#dash-checking')) return;
    const host = document.createElement('div');
    host.className = 'gate';
    host.id = 'dash-checking';
    host.dataset.checking = '';
    host.innerHTML =
      '<div class="gate-card">' +
      '<h1>Open Screenshot Generator Control</h1>' +
      '<p class="gate-sub" role="status">Checking your session</p>' +
      '</div>';
    document.body.append(host);
  }, CHECKING_DELAY_MS);
}

function hideChecking() {
  clearTimeout(checkingTimer);
  checkingTimer = null;
  $('#dash-checking')?.remove();
}

function showGate(message) {
  hideChecking();
  $('#app').hidden = true;
  $('#gate').hidden = false;
  $('#gate-url').value = pb.auth.url;
  $('#gate-email').value = pb.auth.email;
  const error = $('#gate-error');
  if (message) {
    error.textContent = message;
    error.hidden = false;
  } else {
    error.hidden = true;
  }
  ($('#gate-email').value ? $('#gate-pass') : $('#gate-email')).focus();
}

function showApp() {
  hideChecking();
  $('#gate').hidden = true;
  $('#app').hidden = false;
  $('#rail-who').textContent = pb.auth.email || 'superuser';
  pb.realtime.connect();
  onRoute();
  // Started after the route, never awaited. The first view's own fetch is the
  // one the operator is actually waiting on, and two aggregate calls in front
  // of it would put a second on the first paint to fill three small badges.
  refreshBadges();
}

function wireGate() {
  const form = $('#gate-form');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const button = $('#gate-go');
    button.disabled = true;
    button.textContent = 'Signing in';
    try {
      await pb.signIn($('#gate-url').value.trim(), $('#gate-email').value.trim(), $('#gate-pass').value);
      $('#gate-pass').value = '';
      showApp();
    } catch (err) {
      // Each status gets the sentence that tells the operator what to change.
      // "Failed to fetch" on its own has sent people to check a password when
      // the address was wrong, which is the one thing this screen can prevent.
      const message =
        err.status === 400
          ? 'Wrong email or password'
          : err.status === 404
            ? 'That server has no superuser API. Check the address'
            : err.message || 'Could not reach the server';
      showGate(message);
    } finally {
      button.disabled = false;
      button.textContent = 'Sign in';
    }
  });

  $('#sign-out').addEventListener('click', () => {
    pb.realtime.disconnect();
    pb.signOut();
    endSession();
    showGate(null);
  });

  pb.onExpired(() => {
    pb.realtime.disconnect();
    endSession();
    showGate('That session expired. Sign in again');
  });
}

/**
 * Put the session down cleanly.
 *
 * `currentRoute` is reset because the router treats a repeat of the route it is
 * already on as a no-op. Without this, signing out and back in again would land
 * on the same hash, skip the mount, and leave the previous session's rows on
 * screen with none of their handlers attached.
 */
function endSession() {
  teardownView();
  currentRoute = '';
  // Bumped so a mount that was still in flight when the session ended cannot
  // come back and paint a page over the top of the sign-in gate. This is also
  // the invalidation `clearView` waits on: see `mountInFlight`.
  const dying = ++mountToken;
  closeDrawer();
  clearView(dying);
  for (const route of ROUTES) setRailCount(route.id, null);
}

/**
 * Empty `#view`, but never out from under a render that is still running.
 *
 * The previous session's rows must not sit in the document behind the gate, so
 * this does happen; it just waits for the in-flight mount first, which is at
 * most one request long. `token` is re-checked afterwards because signing back
 * in during that window starts a new mount, and emptying the page then would
 * wipe the view the operator is looking at.
 */
function clearView(token) {
  const pending = mountInFlight;
  if (!pending) {
    $('#view').innerHTML = '';
    return;
  }
  pending.then(() => {
    if (token !== mountToken) return;
    $('#view').innerHTML = '';
  });
}

// ---------- live pill ----------

function wireLive() {
  const pill = $('#live-pill');
  const text = pill.querySelector('.live-text');
  pb.realtime.onStatus((status) => {
    pill.dataset.state = status;
    // "reconnecting" rather than "down", because EventSource retries by itself
    // and the honest word for that second is not "broken".
    text.textContent =
      status === 'live' ? 'live' : status === 'down' ? 'reconnecting' : status === 'connecting' ? 'connecting' : 'idle';
  });
}

// ---------- boot ----------

function wireChrome() {
  $('#rail-toggle').addEventListener('click', () => setRailOpen(!$('#app').classList.contains('rail-open')));

  /*
   * The rail crosses the breakpoint when the window is resized, and a rail that
   * became a column while still marked inert would be a dashboard with no
   * navigation at all. Fired on the resize itself rather than debounced: it is
   * two reads and an attribute, and being briefly wrong here is worse than being
   * cheap.
   */
  window.addEventListener('resize', syncRailInert);
  syncRailInert();
  $('#refresh').addEventListener('click', () => {
    remount();
    toast('Refreshed');
  });
  window.addEventListener('hashchange', onRoute);

  /**
   * Escape closes the rail drawer on a narrow screen.
   *
   * It acts only when the rail is actually open, which is the whole guard it
   * needs. There is no `stopPropagation` here on purpose: `ui.js` binds its own
   * Escape on `document` as well and it is registered first, so stopping
   * propagation between two listeners on the SAME element would achieve
   * nothing anyway. The search box can peel one layer at a time because its
   * listener is on the input, a descendant, and so runs before either of these.
   */
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    setRailOpen(false);
  });

  /**
   * A tab left open all night comes back to a socket the OS quietly closed
   * while the machine was asleep, and EventSource does not always notice. The
   * pill would say live and nothing would ever arrive again, which is the worst
   * failure this dashboard can have: it looks like a quiet night.
   *
   * `connect()` is a no-op when the stream is genuinely up, so calling it on
   * every return to the tab is cheap and self healing.
   */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !$('#app').hidden) {
      pb.realtime.connect();
    }
  });

  /**
   * Close the realtime stream when the page goes away.
   *
   * Without this there was no unload handling anywhere in `dash/` at all, and
   * `realtime.disconnect()` was reachable only from Sign out and from an expired
   * session. A page that was navigated away from or reloaded therefore kept its
   * EventSource, the browser allows six live connections per host, and the
   * SEVENTH cold load had none left: its very first request, the POST to
   * auth-refresh, sat in the queue behind them. Measured across nine consecutive
   * cold loads, the stall landed on load 6 exactly, every time, and lasted up to
   * 25 seconds; with /api/realtime blocked outright there were zero stalls in
   * 36 loads.
   *
   * `pagehide` and not `unload`. `unload` is deprecated, several browsers no
   * longer fire it reliably, and registering one opts the page out of the
   * back/forward cache, which would trade this bug for a slower Back button.
   * `pagehide` fires in every case `unload` did and also when the page is frozen
   * into the bfcache. If it is later restored from there, `pageshow` fires with
   * `persisted` set and the stream, which the browser did not keep, is rebuilt.
   */
  window.addEventListener('pagehide', () => {
    pb.realtime.disconnect();
  });

  window.addEventListener('pageshow', (ev) => {
    if (!ev.persisted) return;
    if (!$('#app').hidden) pb.realtime.connect();
  });
}

async function boot() {
  buildRail();
  wireGate();
  wireSearch();
  wireTheme();
  wireLive();
  wireChrome();

  // A superuser token lasts a fortnight, so most loads land straight in the
  // app. `resume` refreshes it as it goes, which is what keeps a tab that has
  // been open for a week from expiring in the middle of a moderation queue.
  //
  // With no stored token there is nothing to check and the door goes straight
  // up. With one, the screen says so while the box is asked: see `showChecking`
  // for why a sign-in form must not be what is on screen during that await.
  if (!pb.auth.token) {
    showGate(null);
    return;
  }
  showChecking();
  if (await pb.resume()) showApp();
  else showGate(null);
}

boot();

/**
 * The handle every view uses.
 *
 * `go` for navigation, `setRailCount` for the queue badges, and the whole theme
 * module so a chart can ask which palette it is drawing on and repaint itself
 * when that changes, without importing this file and closing the cycle.
 */
window.__dash = { go, setRailCount, theme };

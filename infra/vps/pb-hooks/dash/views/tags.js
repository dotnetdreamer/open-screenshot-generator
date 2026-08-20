/**
 * Tags and surfaces — what people are actually making.
 *
 * Every other page in this dashboard is about the box: how many rows, how much
 * disk, which counter drifted. This one is about the CONTENT, and the questions
 * it answers are the ones that decide what gets built next. Which tags do people
 * reach for. Which surface is worth another template. Which template keeps
 * coming back, and which one shipped and was never touched again. And, the
 * unglamorous one that nothing else surfaces: which posts carry no tags at all,
 * because those are invisible to the feed's tag filter and their author has no
 * way of knowing that.
 *
 * ## Where every number on this page comes from, and why it is not one place
 *
 * The box can answer two of these questions in SQL and cannot answer the other
 * three, and pretending otherwise would be the easiest lie on the page to tell.
 *
 *   - `stats.top_tags` is a real `GROUP BY` over `json_each(posts.tags)`, fixed
 *     at the last 30 days, every post including the hidden ones, top 14.
 *   - `stats.posts.by_surface` is a real `GROUP BY` over every post on the box,
 *     all time, hidden included.
 *   - There is NO aggregate anywhere for `app_name`, none for
 *     `template_project_id`, and none for "posts with no tags". The record API
 *     has no GROUP BY, so the first two have to be counted here, in the browser,
 *     over a bounded page of posts.
 *
 * So the page reads the server's exact answer whenever the chosen window is the
 * one the server actually computed, and counts from a bounded sample otherwise,
 * and **each card says in its own subtitle which of the two it is looking at**.
 * That sentence is not decoration. A ranking counted over the newest 500 posts
 * of eighty thousand is a floor, not a total, and a reader who thinks it is a
 * total will draw a conclusion about the long tail that the data cannot support.
 * The gap is written up in the report that came with this file: three small
 * aggregates on the stats route would let all five panels be exact.
 *
 * ## `json_ok`, and the two blanks that mean opposite things
 *
 * `stats.json_ok` is the route's probe for whether this SQLite build has the
 * JSON1 functions. Without them `json_each` does not exist, the tag query cannot
 * run, and `top_tags` comes back as `[]`. An empty bar list drawn from that says
 * "nobody on this box uses tags" when the truth is "this check could not run",
 * and those two look identical on screen while meaning the opposite thing. So
 * when the probe is false this page says so in words, in the card, above
 * whatever it managed to count for itself.
 *
 * ## Why the untagged panel matches on `tags_text` rather than on `tags`
 *
 * Because that is the column the real feed filters on. `050_discover.pb.js`
 * pushes `tags_text ~ {:tag}` for a tag query, so a post whose `tags_text` is
 * empty cannot match any tag filter no matter what its `tags` JSON says. The
 * question this panel answers is "who is invisible to the tag filter", and the
 * only honest way to answer it is with the same column the filter uses.
 */

import * as pb from '../pb.js';
import { barList, donut } from '../charts.js';
import {
  esc,
  n,
  compact,
  pct,
  ago,
  stamp,
  nameOf,
  handleOf,
  avatar,
  emptyState,
  errorState,
  skeleton,
  chip,
  node,
} from '../ui.js';

/**
 * The windows this page offers.
 *
 * 30 days is the default because it is the one window the server can answer
 * exactly: `stats.top_tags` is hardcoded to 30 days in `100_dash.pb.js`, so the
 * page opens on the state where its headline panel is a real database
 * aggregate rather than a count of whatever the browser could carry.
 *
 * "All time" is here for the same reason, one panel down: `by_surface` is an
 * all time group, so the surface split is exact in exactly that position.
 */
const RANGES = [
  { id: '7d', label: '7 days', days: 7 },
  { id: '30d', label: '30 days', days: 30 },
  { id: '90d', label: '90 days', days: 90 },
  { id: 'all', label: 'All time', days: 0 },
];

/**
 * Hidden posts count or they do not, and the answer is genuinely different per
 * question.
 *
 * "What are people making" wants every post, because hiding one is a decision
 * about the feed and not about what somebody built. "Who is invisible to the
 * tag filter" wants the visible ones, because a hidden post is already
 * invisible and its missing tags cost nobody anything. Rather than guess which
 * reading the operator wants, the page asks.
 *
 * All posts is the default so that the page opens on the state the server's own
 * aggregates were computed in: both of them include hidden posts, and defaulting
 * to visible only would mean the exact answer is never the one on screen.
 */
const SCOPES = [
  { id: 'all', label: 'All posts' },
  { id: 'visible', label: 'Visible only' },
];

/**
 * How many posts the browser is willing to pull to count what SQL will not.
 *
 * 500 is PocketBase's own ceiling for a single list page and it is also about
 * where this stops being defensible: with `fields` pinned to the eight columns
 * this page reads it is a small response, and one request beats five pages of
 * pagination that would still be a floor at the end of it. The number is shown
 * to the operator rather than hidden, and every panel built from it says it was
 * built from it.
 */
const SAMPLE_CAP = 500;

/**
 * The columns this page reads, and not one more.
 *
 * `posts` carries a 1200 character `search_text` and a `caption` up to 600, both
 * of which exist for the app's feed and neither of which this page looks at.
 * Five hundred rows of those is most of a megabyte across the wire to render a
 * bar chart of tag names. `images` is left out for the same reason: this page
 * never draws a thumbnail.
 */
const SAMPLE_FIELDS = 'id,title,tags,surface,app_name,template_project_id,hidden,created,author';

/** How many rows each of the browser counted tables shows before it stops. */
const TABLE_ROWS = 12;

/** How many untagged posts to list. The exact total is shown beside them. */
const UNTAGGED_ROWS = 12;

/**
 * A millisecond timestamp in the text shape PocketBase stores dates in.
 *
 * `YYYY-MM-DD HH:MM:SS.sssZ`, which is an ISO string with the T replaced by a
 * space. That is not cosmetic: every date column on this box is TEXT, so a
 * window is a string comparison, and a string comparison against a value with a
 * T in it silently matches nothing at all rather than erroring. `lib/dash.js`
 * has the same function for the server side, and the two have to agree.
 */
function pbDate(ms) {
  return new Date(ms).toISOString().replace('T', ' ');
}

/**
 * The filter for the chosen window and scope, as PocketBase filter syntax.
 *
 * Returns '' for "all time, all posts", which `pb.list` drops rather than
 * sending as an empty filter parameter.
 */
function windowFilter(range, scope) {
  const clauses = [];
  if (range.days) clauses.push(`created >= "${pbDate(Date.now() - range.days * 86400000)}"`);
  if (scope === 'visible') clauses.push('hidden = false');
  return clauses.join(' && ');
}

/**
 * The tags on one post, normalised the way the server normalises them.
 *
 * The server's query is `lower(trim(t.value))` over `json_each(posts.tags)`, so
 * this does exactly that and nothing more: no de-duplication within a post,
 * because `COUNT(*)` over `json_each` counts a repeated tag twice and a client
 * that quietly folded it would disagree with the exact panel sitting one range
 * button away, with no way for the reader to tell which one was lying.
 *
 * `tags` arrives from the record API already parsed into an array, and from
 * `100_dash.pb.js` the same way, but the string form is handled too. A JSON
 * column is the one place on this box where the wire shape depends on which
 * route answered, and a column that is text on one path and an array on another
 * is not something to find out about from a blank panel.
 */
function tagsOf(post) {
  let raw = post?.tags;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      // A tags column that is not valid JSON is a post the server's own query
      // skips too, via its `CASE WHEN json_valid(...)` guard. Same answer here.
      raw = [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const tag of raw) {
    const text = String(tag === null || tag === undefined ? '' : tag)
      .trim()
      .toLowerCase();
    if (text) out.push(text);
  }
  return out;
}

/**
 * Tag uses across a page of posts, ranked, in the shape `barList` speaks.
 *
 * `{ k, n }` rather than `{ label, value }` because that is the wire shape every
 * aggregate on this box uses and `barList` accepts it directly. Ties break on
 * the tag name so the order is stable between two renders of the same data:
 * a list that reshuffles its ties on every range change looks like the numbers
 * moved when they did not.
 */
function countTags(posts, limit) {
  const seen = new Map();
  for (const post of posts) {
    for (const tag of tagsOf(post)) seen.set(tag, (seen.get(tag) || 0) + 1);
  }
  return [...seen.entries()]
    .map(([k, count]) => ({ k, n: count }))
    .sort((a, b) => b.n - a.n || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
    .slice(0, limit);
}

/**
 * Posts per surface, in the same shape and with the same fallback the server
 * uses.
 *
 * `COALESCE(NULLIF(surface, ''), 'unknown')` on the server, so an empty surface
 * files itself under 'unknown' here too. Without the fallback such a row becomes
 * a nameless slice of the donut, which reads as a rendering bug rather than as
 * the data problem it actually is.
 */
function countSurfaces(posts) {
  const seen = new Map();
  for (const post of posts) {
    const key = String(post?.surface || '').trim() || 'unknown';
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  return [...seen.entries()]
    .map(([k, count]) => ({ k, n: count }))
    .sort((a, b) => b.n - a.n || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
}

/**
 * When each surface was last posted to, from the sample.
 *
 * This is the column that stops the surface table from being the donut's legend
 * printed a second time. The ring and its legend already carry the name, the
 * count and the share, so a table repeating those three would be three copies of
 * one fact on one card. "Last posted" is the thing neither of them can say, and
 * on this page it is the more actionable half: a surface holding a fifth of the
 * feed that nobody has posted to in six weeks is a different situation from one
 * holding a fifth and growing, and the ring draws those two identically.
 *
 * The posts arrive newest first, so the first time a surface is seen is its most
 * recent post and nothing needs comparing.
 */
function lastPostedBySurface(posts) {
  const seen = new Map();
  for (const post of posts) {
    const key = String(post?.surface || '').trim() || 'unknown';
    if (!seen.has(key)) seen.set(key, post?.created || '');
  }
  return seen;
}

/**
 * App names, folded case insensitively.
 *
 * `app_name` is free text somebody typed into a field, so "Ledger", "ledger"
 * and " Ledger " are one app to every human being who will ever read this page
 * and three rows to a naive `Map`. They are folded on a lowercased, trimmed key
 * and displayed with the spelling from the NEWEST post that used it, because
 * the posts arrive newest first and the most recent spelling is the one the
 * author has settled on.
 *
 * The click through still uses the displayed spelling: the Feed's text search
 * is a `LIKE` on this box and case does not change what it matches.
 */
function countApps(posts, limit) {
  const seen = new Map();
  let unnamed = 0;
  for (const post of posts) {
    const label = String(post?.app_name || '').trim();
    if (!label) {
      unnamed++;
      continue;
    }
    const key = label.toLowerCase();
    const row = seen.get(key);
    if (row) {
      row.n++;
    } else {
      seen.set(key, { key, label, n: 1, last: post?.created || '' });
    }
  }
  const rows = [...seen.values()].sort(
    (a, b) => b.n - a.n || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );
  return { rows: rows.slice(0, limit), total: rows.length, unnamed };
}

/**
 * Template reuse, which is the panel this page was worth building for.
 *
 * `template_project_id` is stamped on a post that was exported from a template,
 * so counting it says which templates are actually load bearing. The AUTHORS
 * column is the part that matters and the reason this is not just a count: one
 * person posting eight times from the same template is a person with a habit,
 * and eight different people posting once each is a template worth keeping.
 * Those two are the same number in the posts column and completely different
 * facts, so the distinct author count sits right beside it.
 *
 * No case folding on the id, unlike app names. This is an identifier the editor
 * writes, not a label a person types, and two ids that differ by case are two
 * ids.
 */
function countTemplates(posts, limit) {
  const seen = new Map();
  let none = 0;
  for (const post of posts) {
    const id = String(post?.template_project_id || '').trim();
    if (!id) {
      none++;
      continue;
    }
    let row = seen.get(id);
    if (!row) {
      row = { id, n: 0, authors: new Set(), last: post?.created || '' };
      seen.set(id, row);
    }
    row.n++;
    if (post?.author) row.authors.add(post.author);
  }
  const rows = [...seen.values()]
    .map((row) => ({ id: row.id, n: row.n, authors: row.authors.size, last: row.last }))
    .sort((a, b) => b.n - a.n || b.authors - a.authors || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { rows: rows.slice(0, limit), total: rows.length, none };
}

/**
 * The five surface slugs the Feed can actually filter to.
 *
 * Copied rather than imported, and that is the lesser of two evils: the list
 * lives as a module-private `SURFACES` const inside feed.js, importing that
 * module would pull the whole Feed view in as a side effect of drawing a table
 * on this page, and reaching into another view's internals is worse coupling
 * than a five line list with a note on it. If a sixth surface ships, it goes in
 * both places, and the worst a stale copy here does is leave a row unlinked.
 */
const FEED_SURFACES = new Set([
  'screenshots',
  'apple-watch',
  'mac',
  'app-preview',
  'play-feature-graphic',
]);

/**
 * The hash a row navigates to, in a shape the Feed's own hash reader accepts.
 *
 * Path segments rather than a query string, and that is forced rather than
 * chosen: the router in `app.js` splits the hash on `/` and matches the FIRST
 * segment against a route id, so `#/feed?tag=ios` matches nothing and drops the
 * operator on Pulse. `#/feed/tag/ios` matches `feed` and the router deliberately
 * ignores the rest, exactly as it does for the collection name Tables puts
 * there.
 *
 * ## Two of the four kinds used to be silently ignored
 *
 * This file emitted `#/feed/<kind>/<value>` for all four of its clickable row
 * kinds, and `applyHash` in feed.js accepts a much narrower set: a bare surface
 * slug, a bare visibility, the word "all", or one of `tag`, `q`, `app` and
 * `search` followed by a tail. So `tag` and `app` worked, and `surface` and
 * `template` matched nothing at all. Reproduced by clicking all four and reading
 * the Feed's own controls back: both of the broken ones left every filter blank
 * and dropped the operator on an unfiltered Feed that LOOKED like a working
 * answer, which is the expensive kind of wrong.
 *
 * The mapping happens here rather than being widened in feed.js, because the
 * Feed's reader is the contract and this page is the caller. A surface is a
 * filter the Feed already has, so it becomes the bare slug. A template id is not
 * a filter the Feed has at all, but the search route matches
 * `template_project_id LIKE`, so it becomes a query, which is a real answer
 * rather than a link that quietly does nothing.
 *
 * A surface the Feed cannot filter to gets an EMPTY string back, not a link to
 * nowhere. Callers test the result and leave the row as plain text, which is the
 * honest rendering of "there is no Feed view of this".
 *
 * One floor to know about, deliberately not guarded here: feed.js drops a query
 * shorter than two characters, so a one letter tag or app name would arrive as a
 * link and land on an unfiltered Feed. Nothing on this box can produce one (the
 * shortest tag in the catalogue is three letters and a template id is a slug),
 * and the guard would have to be answered at four call sites, so it is written
 * down rather than coded. If a one character tag ever becomes possible, this is
 * where it gets handled.
 *
 * `encodeURIComponent` is not optional here. Tags, app names and template ids
 * are all user supplied, and a `#` in one of them would end the hash and take
 * everything after it with it, while a `/` would look like another segment.
 */
function feedLink(kind, value) {
  const text = String(value);

  // A bare slug. `#/feed/mac` sets the surface filter; `#/feed/surface/mac` sets
  // nothing, because "surface" is not a slug, a visibility, "all", or one of the
  // four query heads.
  if (kind === 'surface') return FEED_SURFACES.has(text) ? `#/feed/${encodeURIComponent(text)}` : '';

  // A search, because there is no template filter on the Feed. The search route
  // ORs `template_project_id LIKE` in with the title and tag columns, so a full
  // id finds exactly the posts built from that template. `q` rather than
  // `search`: feed.js accepts both, and `q` is the one its own copy uses.
  if (kind === 'template') return `#/feed/q/${encodeURIComponent(text)}`;

  // `tag` and `app`, which feed.js reads as query heads and always did.
  return `#/feed/${kind}/${encodeURIComponent(text)}`;
}

/**
 * A cell whose contents are a real anchor.
 *
 * The row around it is clickable for the mouse, but a `<tr>` with a click
 * handler is unreachable from a keyboard and invisible to a screen reader, so
 * every navigable row carries an actual link in its first cell. That is the
 * whole keyboard story for the tables on this page: Tab reaches the link, Enter
 * follows it, and the browser's own focus ring shows where you are.
 */
function cellLink(hash, text) {
  return `<a href="${esc(hash)}">${esc(text)}</a>`;
}

/**
 * Give a donut's `<svg>` a name, and take its inner text out of the reading
 * order.
 *
 * The bug this fixes: `donut()` draws each slice's share as a bare `<text>` on
 * the ring and the total as another one in the hole, with no `aria-hidden` and
 * no name anywhere on the SVG. The surface ring on this page therefore read out
 * as "35% 20% 20% 15% 10%" and then "20 total", six numbers with nothing to say
 * what any of them was of. The sparklines in the KPI tiles are marked
 * `aria-hidden` and get this right; the big charts were never done.
 *
 * `role="img"` rather than `aria-hidden`, because the picture should still be
 * announced, just as ONE named thing instead of as a spray of loose
 * percentages: an element with `role="img"` has its whole subtree treated as
 * presentational, so the ring's own labels stop being read while the name given
 * here is read in their place. The label closes by pointing at the figures in
 * words, because the surface TABLE under the ring carries every row with its
 * name, its count and its date, and the table is what a screen reader should be
 * spending its time on.
 *
 * Safe from a call site, and only for the donut: `donut()` paints once,
 * synchronously, into a container it never touches again. Everything else in
 * charts.js goes through `responsive()`, which REPLACES the whole `<svg>`
 * element on every ResizeObserver fire, so an attribute set on one of those from
 * out here is gone the first time somebody drags the window.
 *
 * Duplicated in storage.js on purpose. It is nine lines, ui.js belongs to a
 * different part of this build, and one shared helper for two call sites is not
 * worth widening that file's surface for.
 */
function nameChart(host, label) {
  const svg = host.querySelector('svg');
  if (!svg) return;
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  // Legacy Edge and IE made an SVG a Tab stop by default, and an unlabelled
  // graphic that swallows a Tab press is worse than one that is merely quiet.
  svg.setAttribute('focusable', 'false');
}

export async function render(root) {
  let range = RANGES[1];
  let scope = SCOPES[0].id;

  /*
   * Two guards against a load that finishes after it stopped mattering.
   *
   * `dead` is set by the cleanup the router calls before it mounts the next
   * view, and `token` is bumped by every load so that two loads in flight (a
   * fast click from 7 days to 90 days) cannot have the slower one paint last.
   * Without the token the page can settle on the range that is no longer
   * pressed, which is a bug an operator reads as the numbers being wrong rather
   * than as the page being wrong.
   */
  let dead = false;
  let token = 0;
  let inflight = null;
  let painted = false;

  /*
   * `stats` is fetched once per mount and reused across range changes, because
   * nothing in it depends on the range: `top_tags` is hardcoded to 30 days and
   * `by_surface` is all time. Refetching it on every button press would cost the
   * box a dozen aggregate queries to redraw a subtitle. The refresh button in
   * the topbar remounts the whole view, which is what makes it fresh again.
   */
  let statsOnce = null;
  let statsError = null;

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Tags and surfaces</h2>
        <div class="sub">What people are actually making: the tags they reach for, the surfaces they build for, and which templates keep coming back</div>
      </div>
    </div>

    <div class="filter-row">
      <div class="segmented" id="tags-range" role="group" aria-label="Time range">
        ${RANGES.map(
          (r) =>
            `<button type="button" data-range="${esc(r.id)}" aria-pressed="${r.id === range.id}">${esc(r.label)}</button>`
        ).join('')}
      </div>
      <div class="segmented" id="tags-scope" role="group" aria-label="Which posts to count">
        ${SCOPES.map(
          (s) =>
            `<button type="button" data-scope="${esc(s.id)}" aria-pressed="${s.id === scope}">${esc(s.label)}</button>`
        ).join('')}
      </div>
      <span class="muted tiny" id="tags-coverage" role="status"></span>
    </div>

    <div id="tags-panels">
      <div class="grid grid-kpi" id="tags-kpis">${skeleton('tiles', 5)}</div>

      <div class="section-title">Tags</div>
      <div class="grid grid-2 grid-top">
        <div class="card">
          <div class="card-head">
            <div><h3>Top tags</h3><div class="sub" id="tags-top-sub">Counting</div></div>
          </div>
          <div class="card-body" id="tags-top">${skeleton('rows', 6)}</div>
        </div>
        <div class="card">
          <div class="card-head">
            <div><h3>Posts with no tags</h3>
              <div class="sub">A post with an empty tags column never matches a tag filter in the feed, so nobody browsing by tag will ever reach it</div></div>
            <span class="spacer"></span>
            <span id="tags-untagged-count"></span>
          </div>
          <div class="card-body" id="tags-untagged">${skeleton('rows', 5)}</div>
        </div>
      </div>

      <div class="section-title">Surfaces</div>
      <div class="grid grid-2 grid-top">
        <div class="card">
          <div class="card-head">
            <div><h3>Surface split</h3><div class="sub" id="tags-surface-sub">Counting</div></div>
          </div>
          <div class="card-body" id="tags-surface">${skeleton('rows', 5)}</div>
        </div>
        <div class="card">
          <div class="card-head">
            <div><h3>App names</h3>
              <div class="sub" id="tags-apps-sub">Whose apps these screenshots are of, folded so that one spelling of a name is one app</div></div>
          </div>
          <div class="card-body" id="tags-apps">${skeleton('rows', 6)}</div>
        </div>
      </div>

      <div class="section-title">Template reuse</div>
      <div class="card">
        <div class="card-head">
          <div><h3>Templates behind these posts</h3>
            <div class="sub" id="tags-templates-sub">Eight posts from one person and eight from eight people are the same count and different facts, so the author column sits beside it</div></div>
        </div>
        <div class="card-body" id="tags-templates">${skeleton('rows', 6)}</div>
      </div>
    </div>`;

  const panels = root.querySelector('#tags-panels');
  const hosts = {
    kpis: root.querySelector('#tags-kpis'),
    coverage: root.querySelector('#tags-coverage'),
    top: root.querySelector('#tags-top'),
    topSub: root.querySelector('#tags-top-sub'),
    untagged: root.querySelector('#tags-untagged'),
    untaggedCount: root.querySelector('#tags-untagged-count'),
    surface: root.querySelector('#tags-surface'),
    surfaceSub: root.querySelector('#tags-surface-sub'),
    apps: root.querySelector('#tags-apps'),
    appsSub: root.querySelector('#tags-apps-sub'),
    templates: root.querySelector('#tags-templates'),
    templatesSub: root.querySelector('#tags-templates-sub'),
  };

  // ---------- navigation, wired once ----------

  /*
   * Delegated, and attached to the card body rather than to the table, because
   * every load replaces the table and a listener on it would go with it. The
   * body survives `replaceChildren`, so this is wired once for the life of the
   * view instead of once per render, which is also what stops a fast operator
   * from stacking five identical listeners on the same card.
   */
  function wireRows(host) {
    host.addEventListener('click', (ev) => {
      // The anchor in the first cell navigates by itself. Without this the row
      // handler fires too and the same hash is routed twice, which remounts the
      // Feed on top of itself for no reason.
      if (ev.target.closest('a')) return;
      const row = ev.target.closest('tr[data-go]');
      if (row) window.__dash.go(row.dataset.go);
    });
  }
  wireRows(hosts.untagged);
  wireRows(hosts.surface);
  wireRows(hosts.apps);
  wireRows(hosts.templates);

  /*
   * `barList` builds its own rows and knows nothing about navigation, so the
   * click through is added here afterwards rather than by changing a shared
   * chart component for one caller. The sheet already has a
   * `.barlist-row.clickable` rule with a hover state, so this is the usage it
   * was written for.
   *
   * The tag itself is read back out of the row's label with `textContent`,
   * which un-escapes whatever `barList` escaped on the way in and hands back
   * the exact string the server grouped on. Keyboard reachability is the
   * `tabindex` plus the Enter and Space handler: a div with a click listener is
   * a wall to anybody not using a mouse, and this page is a page of links.
   */
  function linkifyBars(host, kind) {
    for (const row of host.querySelectorAll('.barlist-row')) {
      const label = row.querySelector('.truncate')?.textContent || '';
      if (!label) continue;
      const value = row.querySelector('.barlist-val')?.textContent || '';
      row.classList.add('clickable');
      row.tabIndex = 0;
      row.setAttribute('role', 'link');
      row.dataset.go = feedLink(kind, label);
      // The row already carries a `title` with the count and the share in it.
      // An aria-label replaces that for a screen reader rather than adding to
      // it, so it has to repeat the number as well as say where the row goes.
      row.setAttribute('aria-label', `${label}, ${value}. Opens the Feed filtered to this tag`);
    }
  }
  hosts.top.addEventListener('click', (ev) => {
    const row = ev.target.closest('.barlist-row[data-go]');
    if (row) window.__dash.go(row.dataset.go);
  });
  hosts.top.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const row = ev.target.closest('.barlist-row[data-go]');
    if (!row) return;
    // Space scrolls the page by default, which on a keyboard operated list is
    // the opposite of activating the thing under the cursor.
    ev.preventDefault();
    window.__dash.go(row.dataset.go);
  });

  // ---------- the fetches ----------

  /**
   * One bounded page of posts, newest first, carrying only the columns this
   * page counts.
   *
   * `skipTotal` is deliberately NOT set: `totalItems` is what lets the coverage
   * line say "the newest 500 of 1,284" instead of quietly implying the sample
   * is the whole window, and that sentence is the only thing standing between a
   * floor and a reader who thinks they are looking at a total.
   */
  function loadSample(signal) {
    return pb.list('posts', {
      perPage: SAMPLE_CAP,
      sort: '-created',
      filter: windowFilter(range, scope),
      fields: SAMPLE_FIELDS,
      signal,
    });
  }

  /**
   * The untagged posts, counted by the server rather than by the sample.
   *
   * This one does not need a GROUP BY, so it does not need the sample: a filter
   * on `tags_text` answers it exactly, at any size of box, and `totalItems`
   * carries the true count even though only a dozen rows come back. It is the
   * one browser counted panel on this page that is not a floor, which is worth
   * it given that this is the panel somebody would act on.
   *
   * `expand=author` with a projected field list rather than a second lookup:
   * the users collection is superuser only, and the token this dashboard holds
   * is a superuser token, so the expand resolves. The projection is what keeps
   * the password hash and the token key off the wire, which a bare expand would
   * not.
   */
  function loadUntagged(signal) {
    const clauses = [windowFilter(range, scope), 'tags_text = ""'].filter(Boolean);
    return pb.list('posts', {
      perPage: UNTAGGED_ROWS,
      sort: '-created',
      filter: clauses.join(' && '),
      expand: 'author',
      fields:
        'id,title,surface,app_name,hidden,created,author,' +
        'expand.author.id,expand.author.name,expand.author.display_name,expand.author.handle,expand.author.avatar,expand.author.email',
      signal,
    });
  }

  // ---------- the panels ----------

  /**
   * The five headline numbers.
   *
   * Three of them are floors when the sample did not cover the window, and
   * saying so once in the coverage line above is better than repeating it in
   * five tile captions, which would leave no room for the caption each tile
   * actually needs.
   */
  function paintKpis(sample, counts, untaggedTotal) {
    const loaded = sample.items.length;
    const windowTotal = sample.totalItems;
    const tiles = [
      {
        label: 'Posts in this window',
        value: compact(windowTotal),
        meta: loaded === windowTotal ? 'all of them counted below' : `${n(loaded)} of them counted below`,
      },
      {
        label: 'Distinct tags',
        value: compact(counts.tagKinds),
        meta: `${n(counts.tagUses)} tag uses across ${n(counts.taggedPosts)} posts`,
      },
      {
        /*
         * `null` here means the count failed, and it is deliberately not
         * rendered as a zero. `compact(null)` answers '0', and a confident 0
         * under the caption "the count could not be read" is a contradiction the
         * eye resolves in favour of the big number every time.
         */
        label: 'Posts with no tags',
        value: untaggedTotal === null ? 'unknown' : compact(untaggedTotal),
        meta:
          untaggedTotal === null
            ? 'the count could not be read, see the panel below'
            : `${pct(untaggedTotal, windowTotal)} of this window`,
      },
      {
        label: 'App names',
        value: compact(counts.appKinds),
        meta: `${n(counts.unnamed)} posts named no app`,
      },
      {
        label: 'Made from a template',
        value: compact(counts.fromTemplate),
        meta: `${n(counts.templateKinds)} distinct templates`,
      },
    ];
    hosts.kpis.innerHTML = tiles
      .map(
        (tile) => `<div class="kpi">
          <div class="kpi-label">${esc(tile.label)}</div>
          <div class="kpi-value">${esc(tile.value)}</div>
          <div class="kpi-meta">${esc(tile.meta)}</div>
        </div>`
      )
      .join('');
  }

  /**
   * The tag ranking, from whichever of the two sources can answer the window
   * that is actually selected.
   *
   * The server's list wins when the selection matches what it computed, which
   * is 30 days over every post including the hidden ones. Anything else is
   * counted from the sample. Both paths say which they are in the subtitle,
   * because the difference between them is the difference between a total and a
   * floor and there is nothing on screen that would otherwise reveal it.
   */
  function paintTags(sample, sampleRows) {
    const serverCanAnswer = range.id === '30d' && scope === 'all' && statsOnce && statsOnce.json_ok !== false;
    const rows = serverCanAnswer ? statsOnce.top_tags || [] : sampleRows;

    /*
     * Both branches name the POPULATION in the same words, because that is the
     * one fact a reader needs to line this ranking up against the donut on Pulse
     * that is built from the same aggregate. The route was changed to count
     * hidden posts specifically so the two would agree, and a panel that does
     * not say so leaves the reader to assume the ordinary thing, which is that a
     * hidden post is not counted.
     *
     * The browser branch used to stop at "the N posts loaded for this window",
     * which is true and does not answer the question: whether those N included
     * the hidden ones depends on the scope control two inches above it, and
     * nobody reads a filter strip as part of a sentence. It says it outright now.
     */
    const population = scope === 'all' ? 'hidden posts included' : 'hidden posts excluded';
    hosts.topSub.textContent = serverCanAnswer
      ? 'Counted by the database over every post published in the last 30 days, hidden posts included'
      : `Counted in the browser from the ${n(sample.items.length)} posts loaded for this window, ${population}`;

    /*
     * The JSON1 notice. This is the case the whole panel is arranged around: a
     * box whose SQLite cannot read inside a JSON column returns an empty
     * `top_tags`, and an empty bar list is indistinguishable from a box where
     * nobody has ever used a tag. So it is said in words, and the browser
     * counted list is offered underneath rather than instead, because that list
     * is genuinely correct as far as it goes and hiding it would trade one kind
     * of silence for another.
     */
    const pieces = [];
    if (statsOnce && statsOnce.json_ok === false) {
      pieces.push(
        node(
          errorState(
            'The database cannot answer this',
            'The SQLite build on this box has no JSON1 functions, so the server cannot look inside the tags column and its own ranking came back with nothing in it. That is not the same as there being no tags. Anything below this line was counted in the browser instead'
          )
        )
      );
    }

    if (rows.length) {
      const list = barList(rows);
      linkifyBars(list, 'tag');
      pieces.push(list);
    } else if (!pieces.length) {
      pieces.push(
        node(
          emptyState(
            'No tags in this window',
            'A tag is counted when somebody publishes a post with the tag field filled in, so widening the range or waiting for the next post is what fills this'
          )
        )
      );
    }

    // `.stack` is the sheet's own 14px grid, which is what keeps the notice off
    // the first bar without an inline margin.
    const shell = document.createElement('div');
    shell.className = 'stack';
    shell.append(...pieces);
    hosts.top.replaceChildren(shell);
  }

  /**
   * The surface split: the ring, and under it the rows that go somewhere.
   *
   * The donut carries its own legend with every label, value and share in it, so
   * the table under it deliberately does NOT repeat those: it is the surface
   * name as a real link, the count, and the one fact the ring cannot draw, which
   * is when anybody last posted to that surface. The ring is the picture, the
   * table is the interface, and neither says the same thing twice.
   *
   * An 'unknown' surface gets no link. It is not a value the Feed can filter on,
   * it is the placeholder for a row whose surface column is empty, and a link
   * that lands on an unfiltered Feed would be a promise nobody kept.
   */
  function paintSurfaces(sample, rows, lastSeen) {
    const serverCanAnswer = range.id === 'all' && scope === 'all' && statsOnce;
    const use = serverCanAnswer ? statsOnce.posts?.by_surface || [] : rows;

    // The same two-branch sentence as the tag panel above, and for the same
    // reason: the population is what makes a count comparable to anything else.
    hosts.surfaceSub.textContent = serverCanAnswer
      ? 'Counted by the database over every post on the box, hidden posts included'
      : `Counted in the browser from the ${n(sample.items.length)} posts loaded for this window, ${
          scope === 'all' ? 'hidden posts included' : 'hidden posts excluded'
        }`;

    if (!use.length) {
      hosts.surface.innerHTML = emptyState(
        'No posts in this window',
        'Every post carries a surface, so this fills as soon as there is one post inside the range'
      );
      return;
    }

    const shell = document.createElement('div');
    shell.className = 'stack';

    const ring = donut({ rows: use });
    // See `nameChart`. Without this the ring reads out as five bare percentages
    // and a total, and the table under it is where the answer actually is.
    nameChart(
      ring,
      `Posts by surface, ${n(use.reduce((sum, row) => sum + (Number(row.n) || 0), 0))} in this window. ` +
        'Every surface is listed with its own count in the table under the ring'
    );
    shell.append(ring);

    const table = document.createElement('div');
    table.className = 'table-wrap';
    table.innerHTML = `<table class="data">
      <thead><tr><th>Surface</th><th class="num">Posts</th><th>Last posted</th></tr></thead>
      <tbody>${use
        .map((row) => {
          const key = String(row.k || 'unknown');
          /*
           * Linkable is now decided by the LINK, not by the label.
           *
           * It used to be `key !== 'unknown'`, which asked the wrong question:
           * "unknown" is one value the Feed cannot filter to and every surface
           * slug the Feed's list has not heard of is another. Both used to get a
           * clickable row that landed on an unfiltered Feed. `feedLink` answers
           * an empty string for anything it cannot route, so the test is simply
           * whether there is a destination.
           */
          const hash = feedLink('surface', key);
          const known = !!hash;
          /*
           * The counts can come from the server while "last posted" can only
           * come from the sample, so a surface whose most recent post fell
           * outside the loaded page has no date to show. It says that in words
           * rather than showing an empty cell, which would read as "never".
           */
          const last = lastSeen.get(key) || '';
          return `<tr${known ? ` class="clickable" data-go="${esc(hash)}"` : ''}>
            <td>${
              known
                ? cellLink(hash, key)
                : `<span class="muted" title="${esc(
                    `The Feed has no filter for ${key}, so there is nowhere for this row to go`
                  )}">${esc(key)}</span>`
            }</td>
            <td class="num">${esc(n(row.n))}</td>
            <td class="nowrap muted tiny"${last ? ` title="${esc(stamp(last))}"` : ''}>${
              last ? esc(ago(last)) : 'not in the counted posts'
            }</td>
          </tr>`;
        })
        .join('')}</tbody></table>`;
    shell.append(table);
    hosts.surface.replaceChildren(shell);
  }

  /** App names, always from the sample because there is no aggregate for it. */
  function paintApps(sample, apps) {
    const loaded = sample.items.length;
    hosts.appsSub.textContent =
      `Counted in the browser from the ${n(loaded)} posts loaded for this window, folded so that one spelling of a name is one app`;

    if (!apps.rows.length) {
      hosts.apps.innerHTML = emptyState(
        'No app names in this window',
        `The app name is optional when a post is published and ${n(apps.unnamed)} of the posts counted here left it empty`
      );
      return;
    }

    const shown = apps.rows.length;
    const note =
      apps.total > shown
        ? `<div class="muted tiny">Top ${n(shown)} of ${n(apps.total)} names</div>`
        : '';
    hosts.apps.innerHTML = `<div class="stack">
      <div class="table-wrap"><table class="data">
        <thead><tr><th>App name</th><th class="num">Posts</th><th class="num">Share</th><th>Last posted</th></tr></thead>
        <tbody>${apps.rows
          .map((row) => {
            const hash = feedLink('app', row.label);
            return `<tr class="clickable" data-go="${esc(hash)}">
              <td class="truncate">${cellLink(hash, row.label)}</td>
              <td class="num">${esc(n(row.n))}</td>
              <td class="num muted">${esc(pct(row.n, loaded))}</td>
              <td class="nowrap muted tiny" title="${esc(stamp(row.last))}">${esc(ago(row.last))}</td>
            </tr>`;
          })
          .join('')}</tbody>
      </table></div>
      ${note}
    </div>`;
  }

  /** Template reuse, also from the sample, for the same reason. */
  function paintTemplates(sample, templates) {
    const loaded = sample.items.length;
    hosts.templatesSub.textContent =
      `Counted in the browser from the ${n(loaded)} posts loaded for this window. ` +
      'Eight posts from one person and eight from eight people are the same count and different facts, so the author column sits beside it';

    if (!templates.rows.length) {
      hosts.templates.innerHTML = emptyState(
        'No template was recorded on any of these posts',
        'A post carries a template id when it was exported from a template in the editor, so this fills as those are published'
      );
      return;
    }

    const shown = templates.rows.length;
    const note = [];
    if (templates.total > shown) note.push(`Top ${n(shown)} of ${n(templates.total)} templates`);
    note.push(`${n(templates.none)} of the posts counted here recorded no template`);
    // The Feed has no template filter, so a template row opens a Feed SEARCH on
    // the id instead. That search is capped at twenty posts by the route, and an
    // operator who clicks a row showing 40 posts and lands on 20 deserves to
    // have been told which of the two numbers is the incomplete one.
    note.push('A template id opens the Feed as a search, which answers the newest 20 posts built from it');

    hosts.templates.innerHTML = `<div class="stack">
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Template</th><th class="num">Posts</th><th class="num">Authors</th><th class="num">Share</th><th>Last used</th></tr></thead>
        <tbody>${templates.rows
          .map((row) => {
            const hash = feedLink('template', row.id);
            /*
             * The authors column wears a chip when a template has been reused by
             * more than one person, because that is the signal the panel exists
             * for and a bare number in the fourth column of a table is not
             * something anybody notices at a glance. One author is left plain
             * rather than chipped in a warning colour: a personal habit is not a
             * problem, it is just a different fact.
             */
            const reach =
              row.authors > 1 ? chip(`${n(row.authors)} people`, 'good') : `<span class="muted">${esc(n(row.authors))}</span>`;
            return `<tr class="clickable" data-go="${esc(hash)}">
              <td><span class="code-tag">${cellLink(hash, row.id)}</span></td>
              <td class="num">${esc(n(row.n))}</td>
              <td class="num">${reach}</td>
              <td class="num muted">${esc(pct(row.n, loaded))}</td>
              <td class="nowrap muted tiny" title="${esc(stamp(row.last))}">${esc(ago(row.last))}</td>
            </tr>`;
          })
          .join('')}</tbody>
      </table></div>
      <div class="muted tiny">${esc(note.join('. '))}</div>
    </div>`;
  }

  /**
   * The untagged list.
   *
   * Rows go to the post drawer rather than to a filtered Feed, because there is
   * nothing to filter on: the whole point of these posts is that they carry no
   * tag. The thing an operator wants from this list is to open one and see what
   * it is, which is `#/post/<id>`.
   */
  function paintUntagged(page) {
    const total = page.totalItems;
    hosts.untaggedCount.innerHTML = chip(
      total ? `${n(total)} in this window` : 'none in this window',
      total ? 'warn' : 'good'
    );

    if (!page.items.length) {
      hosts.untagged.innerHTML = emptyState(
        'Every post in this window carries a tag',
        'A post published with the tag field left empty lands here, because the feed matches a tag filter against the tags column and an empty one never matches'
      );
      return;
    }

    const note =
      total > page.items.length
        ? `<div class="muted tiny">Showing the ${n(page.items.length)} newest of ${n(total)}</div>`
        : '';

    hosts.untagged.innerHTML = `<div class="stack">
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Post</th><th>Author</th><th>Surface</th><th>Published</th></tr></thead>
        <tbody>${page.items
          .map((post) => {
            const author = post.expand?.author || null;
            const hash = `#/post/${encodeURIComponent(post.id)}`;
            const handle = author ? handleOf(author) : '';
            return `<tr class="clickable" data-go="${esc(hash)}">
              <td class="truncate">${cellLink(hash, post.title || 'Untitled')}${
                post.hidden ? ` ${chip('hidden', 'warn')}` : ''
              }</td>
              <td>${
                author
                  ? `<span class="identity">${avatar(author, 'sm')}<span class="muted tiny">${esc(nameOf(author))}${handle ? ` ${esc(handle)}` : ''}</span></span>`
                  : '<span class="muted tiny">account deleted</span>'
              }</td>
              <td><span class="surface-chip">${esc(post.surface || 'unknown')}</span></td>
              <td class="nowrap muted tiny" title="${esc(stamp(post.created))}">${esc(ago(post.created))}</td>
            </tr>`;
          })
          .join('')}</tbody>
      </table></div>
      ${note}
    </div>`;
  }

  // ---------- the load ----------

  /**
   * One pass: fetch, count, paint.
   *
   * Every fetch is caught on its own and every panel it feeds fails on its own.
   * The untagged panel is a different query against a different filter from the
   * sample, so a box that cannot answer one of them can very often still answer
   * the other, and losing the whole page to the weaker half would be throwing
   * away the answer that did arrive.
   */
  async function load() {
    const mine = ++token;
    if (inflight) inflight.abort();
    const controller = new AbortController();
    inflight = controller;

    // `is-stale` rather than a re-skeleton on a refetch: the previous answer
    // stays on screen at reduced opacity while the next one is fetched, so the
    // page does not collapse and spring back every time a range button is
    // pressed. The first paint has skeletons in place already and does not want
    // them dimmed on top of that.
    if (painted) panels.classList.add('is-stale');

    // Fetched once per mount and remembered. `statsError` is remembered too,
    // because a failure here is not fatal to the page and the panels need to
    // know they are on their own rather than retrying it four times.
    if (!statsOnce && !statsError) {
      try {
        statsOnce = await pb.stats();
      } catch (err) {
        statsError = err;
      }
      if (dead || mine !== token) return;
    }

    const [sampleResult, untaggedResult] = await Promise.all([
      loadSample(controller.signal).then(
        (value) => ({ value }),
        (error) => ({ error })
      ),
      loadUntagged(controller.signal).then(
        (value) => ({ value }),
        (error) => ({ error })
      ),
    ]);

    // Every early return past this point is a load that was superseded or a view
    // that has been unmounted. An aborted request comes back through `pb.js` as
    // a plain status 0 error, indistinguishable from the box being unreachable,
    // which is exactly why the token and not the error shape is what decides
    // whether anything gets painted.
    if (dead || mine !== token) return;
    inflight = null;

    if (sampleResult.error) {
      const message = errorState('Could not read the posts in this window', sampleResult.error);
      /*
       * The tile strip is cleared rather than filled with a sixth copy of the
       * same red box. A `.grid-kpi` column is 200px wide, so an error state
       * dropped into it renders as a cramped card that says less than the
       * coverage line does, and the five panels below are already each carrying
       * the message in a box wide enough to read it.
       */
      hosts.kpis.innerHTML = '';
      hosts.top.innerHTML = message;
      hosts.surface.innerHTML = message;
      hosts.apps.innerHTML = message;
      hosts.templates.innerHTML = message;
      hosts.coverage.textContent = 'The post list could not be read, so nothing below it could be counted';
      // The subtitles name a source, and after a failure there is no source. A
      // card head still reading "Counting" over a body that has already given up
      // is the kind of small lie that makes an operator distrust the rest.
      hosts.topSub.textContent = 'Nothing could be counted for this window';
      hosts.surfaceSub.textContent = 'Nothing could be counted for this window';
      hosts.appsSub.textContent = 'Nothing could be counted for this window';
      hosts.templatesSub.textContent = 'Nothing could be counted for this window';
    } else {
      const sample = { items: sampleResult.value.items || [], totalItems: sampleResult.value.totalItems || 0 };
      const loaded = sample.items.length;
      const scopeWord = scope === 'visible' ? 'visible posts' : 'posts';

      /*
       * The one sentence on this page that keeps the rest of it honest. It says
       * how many posts the window holds and how many of them were actually
       * counted, and it says outright that the distinct counts are a floor when
       * those two numbers differ. Everything below is derived from this sample,
       * so if this line is missing the page is a set of confident totals that
       * are not totals.
       */
      hosts.coverage.textContent =
        loaded >= sample.totalItems
          ? `All ${n(sample.totalItems)} ${scopeWord} in this window were counted`
          : `The newest ${n(loaded)} of ${n(sample.totalItems)} ${scopeWord} in this window were counted, so every count below is a floor`;

      const tagRows = countTags(sample.items, 14);
      const surfaceRows = countSurfaces(sample.items);
      const surfaceLast = lastPostedBySurface(sample.items);
      const apps = countApps(sample.items, TABLE_ROWS);
      const templates = countTemplates(sample.items, TABLE_ROWS);

      let tagUses = 0;
      let taggedPosts = 0;
      const tagKinds = new Set();
      for (const post of sample.items) {
        const tags = tagsOf(post);
        if (tags.length) taggedPosts++;
        tagUses += tags.length;
        for (const tag of tags) tagKinds.add(tag);
      }

      paintKpis(
        sample,
        {
          tagKinds: tagKinds.size,
          tagUses,
          taggedPosts,
          appKinds: apps.total,
          unnamed: apps.unnamed,
          fromTemplate: loaded - templates.none,
          templateKinds: templates.total,
        },
        untaggedResult.error ? null : untaggedResult.value.totalItems || 0
      );
      paintTags(sample, tagRows);
      paintSurfaces(sample, surfaceRows, surfaceLast);
      paintApps(sample, apps);
      paintTemplates(sample, templates);
    }

    if (untaggedResult.error) {
      hosts.untaggedCount.innerHTML = '';
      hosts.untagged.innerHTML = errorState('Could not count the untagged posts', untaggedResult.error);
    } else {
      paintUntagged({
        items: untaggedResult.value.items || [],
        totalItems: untaggedResult.value.totalItems || 0,
      });
    }

    /*
     * The stats failure is reported inside the tag panel rather than at the top
     * of the page, because that is the only place it changes anything: without
     * `stats` the exact 30 day ranking is unavailable and the browser counted
     * one is used instead, which is a smaller fact than the banner it would
     * otherwise get. The count itself is still on screen.
     */
    if (statsError && !sampleResult.error) {
      hosts.topSub.textContent =
        `The database ranking could not be read (${statsError.message || 'no detail was returned'}), so this is counted in the browser from the ${n(
          sampleResult.value.items?.length || 0
        )} posts loaded for this window`;
    }

    painted = true;
    panels.classList.remove('is-stale');
  }

  // ---------- the filter row ----------

  /*
   * One delegated listener on the row rather than one per button, and the
   * pressed state is written from the click rather than from a re-render, so a
   * range change never rebuilds the control the operator's finger is still on.
   */
  root.querySelector('.filter-row').addEventListener('click', (ev) => {
    const button = ev.target.closest('button[data-range], button[data-scope]');
    if (!button) return;

    if (button.dataset.range) {
      const next = RANGES.find((r) => r.id === button.dataset.range);
      if (!next || next.id === range.id) return;
      range = next;
      for (const other of root.querySelectorAll('#tags-range button')) {
        other.setAttribute('aria-pressed', String(other === button));
      }
    } else {
      if (button.dataset.scope === scope) return;
      scope = button.dataset.scope;
      for (const other of root.querySelectorAll('#tags-scope button')) {
        other.setAttribute('aria-pressed', String(other === button));
      }
    }

    // Caught rather than left to reject: `load` paints its own error states, so
    // anything that escapes it is a bug in this file and belongs in the console
    // rather than as an unhandled rejection with no context attached.
    load().catch((err) => console.warn('tags: load failed', err));
  });

  await load().catch((err) => console.warn('tags: first load failed', err));

  /*
   * The cleanup the router calls before it mounts the next view. Nothing here
   * subscribes to realtime and nothing here runs a timer, so this is only about
   * the two requests that may still be in the air: the flag stops them painting
   * into a view that is gone, and the abort stops them being carried at all.
   */
  return () => {
    dead = true;
    if (inflight) inflight.abort();
  };
}

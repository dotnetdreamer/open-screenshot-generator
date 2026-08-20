/// <reference path="../pb-data/types.d.ts" />

/**
 * Open Screenshot Generator Control: the static mount, eight read-only
 * aggregate routes, and two that write.
 *
 * The page itself is `pb_hooks/dash/`, a plain ES module app with no build step
 * and no dependency, served by this box at `/dash/`. This file is everything it
 * cannot ask the record API for.
 *
 * ## Why the aggregates exist at all
 *
 * Everything the dashboard shows is already reachable through the record API
 * with a `_superusers` token, and the obvious first version does exactly that:
 * twenty list calls, each pulling rows across the wire so the browser can count
 * them. That is fine for ten posts and wrong for a hundred thousand likes. The
 * numbers a report leads with are COUNT and SUM, and the only place those are
 * cheap is next to the data. These routes are SQL over `$app.db()`, they return
 * numbers rather than rows, and the whole overview lands in one request.
 *
 * The record API still does all the browsing: the Tables view, the settings
 * editor, and every paged list in the Feed and Accounts views. This file is
 * aggregates, joins across tables the record API cannot join, and the two
 * actions that need a transaction.
 *
 * ## Every handler's first line is a require, and that is not style
 *
 * **PocketBase runs each handler in its own VM**, so a helper declared at the
 * top level of THIS file is invisible inside the handlers below. It fails at
 * runtime, on the first request, as a bare 400 with nothing in
 * `docker compose logs` to say so. `050_discover.pb.js` carries the same warning
 * in its header because it was written the obvious way first and every route in
 * it broke exactly that way, and the sibling project's dashboard shipped with
 * `superuser()` at the top level and answered 400 on all five routes.
 *
 * So everything shared lives in `lib/dash.js` and arrives through `require()`.
 * The static mount and the redirect are the two exceptions and neither breaks
 * the rule: `$apis.static(...)` is evaluated at REGISTRATION time in the main
 * VM, and the redirect handler closes over nothing at all.
 *
 * ## Two rules that the whole file obeys
 *
 * 1. **Never 403.** `dash/pb.js` force-signs-out on 401 AND on 403, so a
 *    validation error answered 403 ejects the operator to the sign-in gate
 *    instead of showing them what they typed wrong. 401 is for a genuine
 *    non-superuser, 400 for a bad argument, 404 for a record that is not there,
 *    and nothing here ever answers 403.
 * 2. **A failed panel is a panel, not a page.** `dash.scalar` and `dash.rows`
 *    are wrapped, so a column a future migration renames costs one tile and
 *    logs the SQL. There is deliberately no top level try/catch around a whole
 *    response: half a report is more useful than none, and it is honest about
 *    which half.
 */

// ---------- the page ----------

/**
 * The dashboard itself, served from `pb_hooks/dash/`.
 *
 * Same origin as the API on purpose. The realtime feed is Server-Sent Events on
 * `/api/realtime` and a browser cannot put an Authorization header on an
 * EventSource, so PocketBase's protocol is "connect anonymously, then POST the
 * subscription list with your token". Same origin means that POST carries no
 * preflight and no CORS question at all.
 *
 * `indexFallback` is true, which is what lets `#/post/abc` deep link: any path
 * that is not a real file serves index.html and the hash router takes it from
 * there. Without it a cold load of a pasted link is a 404 from the file server.
 *
 * **That fallback also means a MISSING file answers 200.** A mistyped view
 * name, or one that failed to upload, does not 404: `/dash/views/pusle.js`
 * serves index.html with `Content-Type: text/html`, the dynamic `import()` in
 * the router refuses it, and the console says something like "Expected a
 * JavaScript module but the server responded with a MIME type of text/html".
 * That message names the symptom and never the cause, and the cause is always
 * the same one: the file is not there under that name. Keep the fallback, it is
 * what makes deep links work; this note is here so the next person to lose an
 * hour to that error does not have to.
 *
 * Wrapped because `$os.dirFS` throws on a missing directory and this file is
 * evaluated while the router is being built: a dashboard that failed to upload
 * should cost the dashboard, not the feed, the sign in routes and every cloud
 * project on the box.
 *
 * Nothing under `dash/` or `lib/` is ever loaded as a hook. PocketBase globs
 * `pb_hooks/*.pb.js` at the TOP LEVEL only, which is why both directories are
 * safe places to keep plain modules.
 */
try {
  routerAdd('GET', '/dash/{path...}', $apis.static($os.dirFS(`${__hooks}/dash`), true));
} catch (err) {
  console.warn('openscreengen dash: static mount skipped —', err);
}

// Bare /dash, so a typed URL without the slash still lands. Relative asset paths
// in index.html resolve against the directory, and without the trailing slash
// that directory is `/`.
routerAdd('GET', '/dash', (e) => e.redirect(302, '/dash/'));

// ---------- GET /api/openscreengen/dash/stats ----------

/**
 * Every headline number on the box, in one request.
 *
 * This is the query behind the Pulse page and the rail badges, so it is the one
 * that runs most often and the one most worth keeping to a single round trip.
 *
 * ## Windows
 *
 * `today` is UTC midnight rather than a rolling 24 hours, because "today" on a
 * dashboard means the calendar day and an operator comparing it to yesterday
 * expects two boxes of the same shape. `d7` and `d30` ARE rolling, because a
 * trend does not care where midnight fell. Both kinds are string comparisons
 * against the stored `YYYY-MM-DD HH:MM:SS.sssZ` text, so both use the index.
 *
 * ## `verified` here means the badge
 *
 * `users` carries two things that could be called verified: PocketBase's own
 * `verified` column, which is about a confirmation email nothing on this box
 * ever sends, and `verified_badge`, which is the check mark an operator sets by
 * hand. Only the second one means anything here, and the label on the tile says
 * badge for that reason.
 */
routerAdd('GET', '/api/openscreengen/dash/stats', (e) => {
  const dash = require(`${__hooks}/lib/dash.js`);
  if (!dash.superuser(e)) return e.json(401, { error: 'superuser only' });

  const now = Date.now();
  const today = new Date(now);
  const midnight = dash.pbDate(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  );
  const weekAgo = dash.pbDate(now - 7 * 86400000);
  const monthAgo = dash.pbDate(now - 30 * 86400000);

  const scalar = (sql, params, fallback) => dash.scalar($app, sql, params, fallback);
  const rows = (sql, params, model) => dash.rows($app, sql, params, model);

  /*
   * Whether this SQLite build has the JSON1 functions.
   *
   * `top_tags` below is the only thing here that needs them, and without the
   * probe an empty tag list would read as "nobody uses tags" when the truth is
   * "this check could not run". The Tags panel is told which it is looking at.
   */
  const jsonOk = scalar("SELECT json_valid('[]') AS n", null, 0) === 1;

  // The display name expression, once. `display_name` is what somebody chose,
  // `name` is PocketBase's own column and is what an account that never set one
  // still has, and the trailing '' is what keeps a LEFT JOIN miss out of the
  // text slot as a NULL.
  const NAME = "COALESCE(NULLIF(u.display_name, ''), NULLIF(u.name, ''), '')";

  /*
   * The seven switches that change what a visitor gets, as the RAW strings in
   * the table. Not parsed: the Settings view shows the operator what is
   * actually stored, and a reader that quietly repaired `treu` to `true` would
   * hide the one row worth looking at.
   *
   * ## Every key is emitted, whether or not there is a row for it
   *
   * The obvious version is one `SELECT ... WHERE key IN (...)` and whatever
   * comes back, and it has a hole in it that only shows up on the day it
   * matters: **a deleted row simply vanishes from the strip**. Every hook on
   * this box carries its own default for every key (`DEFAULTS` in
   * lib/openscreengen.js) so a missing row is not an outage, it is the hook
   * default quietly in force. But on the one panel whose entire job is to say
   * what is switched on, "missing" then looks exactly like "off": the same
   * absence of a green chip, with no way to tell that the box is behaving as
   * `enabled = true` while the table has nothing to say about it.
   *
   * So the keys are the list below, the query only fills in the values, and a
   * key with no row comes back with `absent: true` and an empty `v` for the
   * view to render as the hook default rather than as a value.
   *
   * The list is interpolated into the SQL rather than bound. Every element is a
   * literal in this file and nothing a caller sends comes anywhere near it,
   * which is the only condition under which that is not a hole. Sorted, because
   * that is the order the `ORDER BY key` this replaced produced and the strip
   * should not reshuffle itself.
   */
  const SWITCH_KEYS = [
    'avatar_fetch_enabled',
    'cloud_projects_enabled',
    'enabled',
    'github_allow_pat',
    'moderation_note',
    'signin_enabled',
    'writes_enabled',
  ];
  const stored = {};
  for (const row of rows(
    `SELECT key AS k, value AS v FROM settings
      WHERE key IN (${SWITCH_KEYS.map((key) => `'${key}'`).join(',')})`,
    null,
    { k: '', v: '' }
  )) {
    stored[row.k] = row.v;
  }
  const switches = SWITCH_KEYS.map((key) => {
    const has = Object.prototype.hasOwnProperty.call(stored, key);
    return { k: key, v: has ? stored[key] : '', absent: !has };
  });

  /*
   * Row counts per collection, which is the only "how big is this getting"
   * signal that does not need shell access to the box.
   *
   * ONE union for the ten collections that have always been there, at the cost
   * of all or nothing: a table a future migration renames empties this whole
   * panel instead of one row of it. That trade was fine while every table in it
   * arrived in the same migration as the feed itself.
   *
   * **`mod_log` is counted separately, and that is not tidiness.** It arrives in
   * `1786400000_openscreengen_control.js` while this file arrives in `pb-hooks`,
   * and docker-compose binds `./pb-migrations` and `./pb-hooks` as two
   * independent mounts: syncing the hooks without the migrations is an ordinary
   * deploy slip rather than an exotic one. Inside the union, that slip costs the
   * entire services panel on Pulse and the entire row count table on Storage.
   * Outside it, it costs one row of each. One extra round trip, no coupling.
   *
   * `-1` as the fallback rather than 0 so that "the table is not there" and "the
   * table is empty" stay different answers: a failed count is left out of the
   * list entirely, because a `mod_log 0` row would be a lie about a box that has
   * no `mod_log` at all.
   *
   * The identical pair is in the /storage route. They have to stay in step, and
   * they are duplicated rather than shared because hook VM isolation means a
   * shared constant would have to live in lib/dash.js, where a list of this
   * box's collection names does not belong.
   */
  const tables = rows(
    `SELECT 'users' AS k, COUNT(*) AS n FROM users
     UNION ALL SELECT 'posts', COUNT(*) FROM posts
     UNION ALL SELECT 'comments', COUNT(*) FROM comments
     UNION ALL SELECT 'post_likes', COUNT(*) FROM post_likes
     UNION ALL SELECT 'post_saves', COUNT(*) FROM post_saves
     UNION ALL SELECT 'comment_likes', COUNT(*) FROM comment_likes
     UNION ALL SELECT 'follows', COUNT(*) FROM follows
     UNION ALL SELECT 'cloud_projects', COUNT(*) FROM cloud_projects
     UNION ALL SELECT 'cloud_project_assets', COUNT(*) FROM cloud_project_assets
     UNION ALL SELECT 'settings', COUNT(*) FROM settings`,
    null,
    { k: '', n: 0 }
  );
  const logRows = scalar('SELECT COUNT(*) AS n FROM mod_log', null, -1);
  if (logRows >= 0) tables.push({ k: 'mod_log', n: logRows });

  return e.json(200, {
    now: now,

    switches: switches,

    accounts: {
      total: scalar('SELECT COUNT(*) AS n FROM users'),
      new_today: scalar('SELECT COUNT(*) AS n FROM users WHERE created >= {:from}', { from: midnight }),
      new_7d: scalar('SELECT COUNT(*) AS n FROM users WHERE created >= {:from}', { from: weekAgo }),
      new_30d: scalar('SELECT COUNT(*) AS n FROM users WHERE created >= {:from}', { from: monthAgo }),
      banned: scalar('SELECT COUNT(*) AS n FROM users WHERE banned = TRUE'),
      verified: scalar('SELECT COUNT(*) AS n FROM users WHERE verified_badge = TRUE'),
      /*
       * Two different questions that look like one. `with_posts` reads the
       * denormalized counter, which is what the accounts table shows and what
       * can drift; the Integrity page is where the counter is checked against
       * the rows. `authors_7d` counts the rows directly, so the pair is also a
       * cheap sanity check on each other.
       */
      with_posts: scalar('SELECT COUNT(*) AS n FROM users WHERE post_count > 0'),
      with_projects: scalar('SELECT COUNT(DISTINCT owner) AS n FROM cloud_projects'),
      google: scalar("SELECT COUNT(*) AS n FROM users WHERE google_sub != ''"),
      github: scalar("SELECT COUNT(*) AS n FROM users WHERE github_id != ''"),
      /*
       * Neither provider key set. Every account on this box is created by one of
       * the two token exchange routes, so this should be zero: a number here is
       * an account made by hand in the PocketBase admin, or a sign-in route that
       * saved the row and then failed before writing the key. Worth a tile
       * rather than a page, which is why the Integrity view carries the same
       * number with the explanation attached.
       */
      unlinked: scalar("SELECT COUNT(*) AS n FROM users WHERE google_sub = '' AND github_id = ''"),
      authors_7d: scalar('SELECT COUNT(DISTINCT author) AS n FROM posts WHERE created >= {:from}', {
        from: weekAgo,
      }),
    },

    posts: {
      total: scalar('SELECT COUNT(*) AS n FROM posts'),
      visible: scalar('SELECT COUNT(*) AS n FROM posts WHERE hidden = FALSE'),
      hidden: scalar('SELECT COUNT(*) AS n FROM posts WHERE hidden = TRUE'),
      featured: scalar('SELECT COUNT(*) AS n FROM posts WHERE featured = TRUE'),
      today: scalar('SELECT COUNT(*) AS n FROM posts WHERE created >= {:from}', { from: midnight }),
      d7: scalar('SELECT COUNT(*) AS n FROM posts WHERE created >= {:from}', { from: weekAgo }),
      d30: scalar('SELECT COUNT(*) AS n FROM posts WHERE created >= {:from}', { from: monthAgo }),
      /*
       * Five ungrouped SUMs, and every one of them COALESCEd.
       *
       * An ungrouped aggregate emits exactly one row whatever happens, including
       * one row of nothing, and over zero rows `SUM()` is NULL rather than 0. A
       * NULL scanned into the `n: 0` slot of a DynamicModel throws, `scalar`
       * catches it, and the tile reads 0 anyway - but it logs `converting NULL
       * to int64 is unsupported` on every request for as long as the table is
       * empty, which is exactly the day somebody is watching the log. See the
       * long note in lib/dash.js: grouped aggregates are safe, these are not.
       */
      screens: scalar('SELECT COALESCE(SUM(screens), 0) AS n FROM posts'),
      views: scalar('SELECT COALESCE(SUM(views), 0) AS n FROM posts'),
      likes: scalar('SELECT COALESCE(SUM(likes), 0) AS n FROM posts'),
      comments: scalar('SELECT COALESCE(SUM(comments), 0) AS n FROM posts'),
      remixes: scalar('SELECT COALESCE(SUM(remixes), 0) AS n FROM posts'),
      /*
       * Visible posts nobody has touched. The number that says whether the feed
       * is a feed yet, and the one the freshness boost in
       * 1786200000_openscreengen_freshness.js exists to move.
       */
      silent: scalar(
        'SELECT COUNT(*) AS n FROM posts WHERE hidden = FALSE AND likes = 0 AND comments = 0'
      ),
      /*
       * COALESCE(NULLIF(...)) even though `surface` is required by the
       * collection: a row written before the field existed, or one edited by
       * hand in the admin, would otherwise file itself under an empty string and
       * render as a nameless slice of the donut.
       *
       * ## Which posts this counts, and why `top_tags` now counts the same ones
       *
       * EVERY post, hidden included. That was already true here and was not true
       * of `top_tags` below, which excluded hidden posts, and the two render
       * side by side on Pulse: one panel described the box and the other
       * described the feed, neither said which, and any reader adding them up
       * got a discrepancy with no explanation attached.
       *
       * They agree now, on this side, because the sum of these slices is
       * `posts.total` from the tile directly above them. That identity is the
       * thing that makes the panel readable without a caption: donut adds up to
       * the headline count, both are every post on the box, and `visible` and
       * `hidden` are right there for the split. Making the donut visible-only
       * instead would have left it summing to a number nothing else on the page
       * shows, and it would have hidden exactly the rows an operator hid, on the
       * one page they go to see what is on the box.
       */
      by_surface: rows(
        `SELECT COALESCE(NULLIF(surface, ''), 'unknown') AS k, COUNT(*) AS n
           FROM posts GROUP BY k ORDER BY n DESC`,
        null,
        { k: '', n: 0 }
      ),
    },

    comments: {
      total: scalar('SELECT COUNT(*) AS n FROM comments'),
      hidden: scalar('SELECT COUNT(*) AS n FROM comments WHERE hidden = TRUE'),
      today: scalar('SELECT COUNT(*) AS n FROM comments WHERE created >= {:from}', { from: midnight }),
      d7: scalar('SELECT COUNT(*) AS n FROM comments WHERE created >= {:from}', { from: weekAgo }),
    },

    /*
     * The join tables, counted directly rather than summed off the posts.
     *
     * These are the TRUTH. `posts.likes` is a cache of `post_likes` and the two
     * can disagree, which is the whole subject of the Integrity page: a cascade
     * delete removes the join rows and does not touch the counter. Reporting
     * both, from different tables, is what makes the disagreement visible on the
     * overview rather than only in the drift checks.
     */
    engagement: {
      likes: scalar('SELECT COUNT(*) AS n FROM post_likes'),
      saves: scalar('SELECT COUNT(*) AS n FROM post_saves'),
      follows: scalar('SELECT COUNT(*) AS n FROM follows'),
      comment_likes: scalar('SELECT COUNT(*) AS n FROM comment_likes'),
      likes_today: scalar('SELECT COUNT(*) AS n FROM post_likes WHERE created >= {:from}', {
        from: midnight,
      }),
      follows_today: scalar('SELECT COUNT(*) AS n FROM follows WHERE created >= {:from}', {
        from: midnight,
      }),
      saves_today: scalar('SELECT COUNT(*) AS n FROM post_saves WHERE created >= {:from}', {
        from: midnight,
      }),
    },

    projects: {
      total: scalar('SELECT COUNT(*) AS n FROM cloud_projects'),
      hidden: scalar('SELECT COUNT(*) AS n FROM cloud_projects WHERE hidden = TRUE'),
      shared: scalar("SELECT COUNT(*) AS n FROM cloud_projects WHERE visibility = 'link'"),
      owners: scalar('SELECT COUNT(DISTINCT owner) AS n FROM cloud_projects'),
      today: scalar('SELECT COUNT(*) AS n FROM cloud_projects WHERE created >= {:from}', {
        from: midnight,
      }),
      d7: scalar('SELECT COUNT(*) AS n FROM cloud_projects WHERE created >= {:from}', {
        from: weekAgo,
      }),
      boards: scalar('SELECT COALESCE(SUM(boards), 0) AS n FROM cloud_projects'),
      doc_bytes: scalar('SELECT COALESCE(SUM(doc_bytes), 0) AS n FROM cloud_projects'),
      /*
       * The same quantity twice, from the two places that record it.
       *
       * `asset_bytes` is the column the save route maintains on the project row;
       * `asset_bytes_rows` sums the actual asset records. They should match, and
       * when they do not it is the project column that is wrong, because the
       * rows are the files. The Storage page shows both side by side for exactly
       * that reason.
       */
      asset_bytes: scalar('SELECT COALESCE(SUM(asset_bytes), 0) AS n FROM cloud_projects'),
      assets: scalar('SELECT COUNT(*) AS n FROM cloud_project_assets'),
      asset_bytes_rows: scalar('SELECT COALESCE(SUM(size), 0) AS n FROM cloud_project_assets'),
    },

    // See the long note where `tables` is built above: nine collections in one
    // union, and `mod_log` counted on its own so a hooks-without-migrations
    // deploy costs one row rather than the panel.
    tables: tables,

    json_ok: jsonOk,

    /*
     * The tags people are actually using, over thirty days.
     *
     * `posts.tags` is a JSON array, so this needs `json_each`, and `json_each`
     * on a malformed value does not skip the row: it aborts the whole query. The
     * CASE is what keeps one hand-edited post from emptying the panel.
     *
     * **Hidden posts are counted here**, which they were not before, and the
     * reason is `by_surface` above: the two panels sit side by side on Pulse and
     * used to describe different populations without either of them saying so.
     * They both count every post on the box now. It is also the better answer
     * for the question this panel is actually asked, on the Tags page whose
     * subject is what people are making rather than what survived moderation: a
     * run of hidden posts all carrying one tag is a thing an operator wants to
     * see in a tag list, not a thing to filter out of it. The window, thirty
     * days, is the only scope this list has and the page says it.
     *
     * `[]` rather than a broken query when JSON1 is missing, with `json_ok`
     * beside it, so the panel can say "could not run" instead of "no tags".
     */
    top_tags: jsonOk
      ? rows(
          `SELECT lower(trim(t.value)) AS k, COUNT(*) AS n
             FROM posts p, json_each(CASE WHEN json_valid(p.tags) THEN p.tags ELSE '[]' END) t
            WHERE p.created >= {:from} AND trim(t.value) != ''
            GROUP BY k ORDER BY n DESC, k LIMIT 14`,
          { from: monthAgo },
          { k: '', n: 0 }
        )
      : [],

    /*
     * Who is carrying the feed this month. Grouped, so the SUMs cannot be NULL,
     * and COALESCEd anyway so that every aggregate in this file reads the same
     * way and nobody has to work out which kind they are looking at.
     */
    top_authors: rows(
      `SELECT p.author AS u, ${NAME} AS name, COALESCE(u.handle, '') AS handle,
              COUNT(*) AS posts,
              COALESCE(SUM(p.likes), 0) AS likes,
              COALESCE(SUM(p.views), 0) AS views
         FROM posts p LEFT JOIN users u ON u.id = p.author
        WHERE p.created >= {:from}
        GROUP BY p.author
        ORDER BY posts DESC, likes DESC LIMIT 8`,
      { from: monthAgo },
      { u: '', name: '', handle: '', posts: 0, likes: 0, views: 0 }
    ),
  });
});

// ---------- GET /api/openscreengen/dash/series ----------

/**
 * The time series behind every chart, bucketed in SQL.
 *
 * `hours=N` picks hourly buckets over that many hours, `days=N` daily buckets
 * over that many days. Both are clamped, because the bucket count is what the
 * chart draws and an unbounded one returns a megabyte of points nobody can read.
 *
 * Buckets are UTC, taken with `substr` on the stored timestamp rather than with
 * a date function, so they cost the same index scan the counts do. 13 characters
 * is `YYYY-MM-DD HH` and 10 is `YYYY-MM-DD`.
 *
 * **The CLIENT fills the gaps.** SQL returns only buckets that HAVE rows, and a
 * chart that silently omits the quiet hours lies about the shape: four posts on
 * Monday and four on Friday would draw as a flat line rather than as two spikes
 * with a dead week between them. `fillBuckets` in `dash/charts.js` is the other
 * half of this contract.
 */
routerAdd('GET', '/api/openscreengen/dash/series', (e) => {
  const dash = require(`${__hooks}/lib/dash.js`);
  if (!dash.superuser(e)) return e.json(401, { error: 'superuser only' });

  /*
   * The query string, read the way every other route on this box reads one, and
   * wrapped the way every other route on this box wraps it.
   *
   * `requestInfo().query` rather than reaching into the Go request, because it
   * hands back a plain object with one value per key rather than Go's map of
   * key to array. And in a try/catch because **`requestInfo()` can throw**: it
   * parses the request, and a malformed query string or a body it cannot make
   * sense of surfaces here rather than at the router. `lib/openscreengen.js`
   * carries a `queryOf(e)` helper that exists for exactly this and every feed
   * route goes through it; the dashboard's read routes were calling it bare,
   * which turns a mistyped URL into a 500 on a file whose stated rule is that a
   * failed panel is a panel and not a page.
   *
   * An unreadable query string means no parameters, which means the defaults,
   * which is a chart of the last 14 days: the right thing to answer somebody
   * whose URL did not survive the trip.
   *
   * The five other read routes below wrap it the same way and point back here.
   */
  let query = {};
  try {
    query = e.requestInfo().query || {};
  } catch (err) {
    console.warn('openscreengen dash: could not read the query string, using the defaults:', err);
    query = {};
  }

  const hoursRaw = parseInt(query.hours, 10);
  const daysRaw = parseInt(query.days, 10);
  const hourly = isFinite(hoursRaw) && hoursRaw > 0;
  const span = hourly
    ? Math.min(hoursRaw, 168)
    : Math.min(isFinite(daysRaw) && daysRaw > 0 ? daysRaw : 14, 120);

  const now = Date.now();
  const from = dash.pbDate(now - span * (hourly ? 3600000 : 86400000));
  const cut = hourly ? 13 : 10;
  const bucket = (column) => `substr(${column}, 1, ${cut})`;
  const rows = (sql, model) => dash.rows($app, sql, { from: from }, model);

  return e.json(200, {
    now: now,
    unit: hourly ? 'hour' : 'day',
    span: span,
    from: from,

    posts: rows(
      `SELECT ${bucket('created')} AS b, COUNT(*) AS n FROM posts
        WHERE created >= {:from} GROUP BY b ORDER BY b`,
      { b: '', n: 0 }
    ),
    signups: rows(
      `SELECT ${bucket('created')} AS b, COUNT(*) AS n FROM users
        WHERE created >= {:from} GROUP BY b ORDER BY b`,
      { b: '', n: 0 }
    ),
    comments: rows(
      `SELECT ${bucket('created')} AS b, COUNT(*) AS n FROM comments
        WHERE created >= {:from} GROUP BY b ORDER BY b`,
      { b: '', n: 0 }
    ),
    /*
     * The three engagement series come off the JOIN TABLES, not off the
     * counters. `posts.likes` has no history in it at all: it is one number that
     * is rewritten, so it can say how many likes a post has and never when they
     * arrived. `post_likes.created` is the only record of when.
     */
    likes: rows(
      `SELECT ${bucket('created')} AS b, COUNT(*) AS n FROM post_likes
        WHERE created >= {:from} GROUP BY b ORDER BY b`,
      { b: '', n: 0 }
    ),
    saves: rows(
      `SELECT ${bucket('created')} AS b, COUNT(*) AS n FROM post_saves
        WHERE created >= {:from} GROUP BY b ORDER BY b`,
      { b: '', n: 0 }
    ),
    follows: rows(
      `SELECT ${bucket('created')} AS b, COUNT(*) AS n FROM follows
        WHERE created >= {:from} GROUP BY b ORDER BY b`,
      { b: '', n: 0 }
    ),
    /*
     * Accounts that PUBLISHED in the bucket, which is the honest proxy for
     * "active makers": there is no session table on this box and nothing records
     * a visit, so the only activity it can see is a row being written. The label
     * on the chart says posted rather than active for that reason.
     */
    authors: rows(
      `SELECT ${bucket('created')} AS b, COUNT(DISTINCT author) AS n FROM posts
        WHERE created >= {:from} GROUP BY b ORDER BY b`,
      { b: '', n: 0 }
    ),
    /*
     * Projects saved, and the bytes that arrived with them. Grouped, so the SUM
     * has at least one row to chew on and cannot be NULL, and COALESCEd anyway.
     * The bytes are what the project row records rather than what is on the
     * disk: see /storage for the difference and the measure button.
     */
    projects: rows(
      `SELECT ${bucket('created')} AS b, COUNT(*) AS n,
              COALESCE(SUM(doc_bytes + asset_bytes), 0) AS bytes
         FROM cloud_projects WHERE created >= {:from} GROUP BY b ORDER BY b`,
      { b: '', n: 0, bytes: 0 }
    ),
  });
});

// ---------- GET /api/openscreengen/dash/search ----------

/**
 * One box, three kinds of answer: an account, a post, a cloud project.
 *
 * Superuser only, which is the only thing that makes a substring search
 * acceptable here at all. The app's own feed search is deliberately narrower and
 * stays that way; nothing about this route is reachable with a user token.
 *
 * ## The escape is not optional
 *
 * `%` and `_` are LIKE wildcards, so an operator typing `100%` into the box
 * would otherwise match every row in three tables and hand back sixty results
 * that have nothing to do with anything. Escaping them and declaring
 * `ESCAPE '\'` makes a typed `%` a literal `%`. The backslash itself is escaped
 * too, or a needle ending in one would swallow the closing quote of the pattern.
 */
routerAdd('GET', '/api/openscreengen/dash/search', (e) => {
  const dash = require(`${__hooks}/lib/dash.js`);
  if (!dash.superuser(e)) return e.json(401, { error: 'superuser only' });

  // Wrapped, for the reason set out in /series: `requestInfo()` parses the
  // request and can throw, and a search box that answers 500 to a URL the
  // parser did not like is worse than one that answers an empty result.
  let query = {};
  try {
    query = e.requestInfo().query || {};
  } catch (err) {
    console.warn('openscreengen dash: could not read the query string, searching for nothing:', err);
    query = {};
  }

  const raw = String(query.q || '').trim();
  // One character matches most of the table and is never what somebody meant.
  // The client enforces the same minimum; this is the half that is true.
  if (raw.length < 2) return e.json(200, { q: raw, accounts: [], posts: [], projects: [] });

  const like = `%${raw.replace(/[%_\\]/g, '\\$&')}%`;
  const NAME = "COALESCE(NULLIF(u.display_name, ''), NULLIF(u.name, ''), '')";
  const rows = (sql, model) => dash.rows($app, sql, { like: like, raw: raw }, model);

  /*
   * A file column back as a real array.
   *
   * PocketBase stores a multi-file field as JSON text, so `images` arrives here
   * as `["a.png","b.png"]` rather than as a list, and the card in the browser
   * wants the first filename to build a thumbnail URL. Parsed here rather than
   * there so that every post object this file hands out has the same shape: an
   * array, always, even when the column is empty or was edited by hand into
   * something that is not JSON at all.
   */
  const listOf = (value) => {
    try {
      const parsed = JSON.parse(String(value || '[]'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const posts = rows(
    `SELECT p.id AS id, p.title AS title, p.author AS author, ${NAME} AS author_name,
            COALESCE(u.handle, '') AS author_handle, p.surface AS surface,
            p.hidden AS hidden, p.featured AS featured, p.likes AS likes,
            p.comments AS comments, p.views AS views, p.created AS created,
            COALESCE(p.images, '[]') AS images
       FROM posts p LEFT JOIN users u ON u.id = p.author
      WHERE p.id = {:raw}
         OR p.title LIKE {:like} ESCAPE '\\'
         OR p.app_name LIKE {:like} ESCAPE '\\'
         OR p.tags_text LIKE {:like} ESCAPE '\\'
         OR p.search_text LIKE {:like} ESCAPE '\\'
         OR p.template_project_id LIKE {:like} ESCAPE '\\'
      ORDER BY p.created DESC LIMIT 20`,
    {
      id: '', title: '', author: '', author_name: '', author_handle: '', surface: '',
      hidden: false, featured: false, likes: 0, comments: 0, views: 0, created: '', images: '',
    }
  );
  for (const post of posts) post.images = listOf(post.images);

  return e.json(200, {
    q: raw,
    /*
     * Named columns, never `SELECT *`.
     *
     * `users` is an auth collection and carries `password` and `tokenKey`. A
     * star here would put a bcrypt hash and a token secret into a search
     * response, and it would keep doing it silently after every future field is
     * added. Every query in this file that touches `users` names its columns for
     * that reason, and this is the rule to break last.
     */
    accounts: rows(
      `SELECT u.id AS id, ${NAME} AS name, COALESCE(u.handle, '') AS handle,
              COALESCE(u.email, '') AS email, COALESCE(u.avatar, '') AS avatar,
              u.banned AS banned, u.verified_badge AS verified_badge,
              u.post_count AS post_count, u.followers AS followers, u.created AS created
         FROM users u
        WHERE u.id = {:raw}
           OR u.display_name LIKE {:like} ESCAPE '\\'
           OR u.name LIKE {:like} ESCAPE '\\'
           OR u.email LIKE {:like} ESCAPE '\\'
           OR u.handle LIKE {:like} ESCAPE '\\'
        ORDER BY u.created DESC LIMIT 20`,
      {
        id: '', name: '', handle: '', email: '', avatar: '', banned: false,
        verified_badge: false, post_count: 0, followers: 0, created: '',
      }
    ),
    posts: posts,
    /*
     * `share_slug` is matched exactly rather than by substring, because it is a
     * credential: a 22 character slug is the whole permission to read a private
     * project, and a substring search over it would let somebody find a project
     * from a fragment of a link. Exact is also what an operator pasting a
     * reported link actually wants.
     */
    projects: rows(
      `SELECT p.id AS id, COALESCE(p.name, '') AS name, p.project_id AS project_id,
              p.owner AS owner, ${NAME} AS owner_name,
              COALESCE(p.visibility, '') AS visibility, COALESCE(p.share_slug, '') AS share_slug,
              p.boards AS boards, p.doc_bytes AS doc_bytes, p.asset_bytes AS asset_bytes,
              p.hidden AS hidden, p.updated AS updated
         FROM cloud_projects p LEFT JOIN users u ON u.id = p.owner
        WHERE p.id = {:raw}
           OR p.share_slug = {:raw}
           OR p.name LIKE {:like} ESCAPE '\\'
           OR p.project_id LIKE {:like} ESCAPE '\\'
        ORDER BY p.updated DESC LIMIT 20`,
      {
        id: '', name: '', project_id: '', owner: '', owner_name: '', visibility: '',
        share_slug: '', boards: 0, doc_bytes: 0, asset_bytes: 0, hidden: false, updated: '',
      }
    ),
  });
});

// ---------- GET /api/openscreengen/dash/account ----------

/**
 * Everything this box knows about one account, in one request.
 *
 * The account drawer used to be six record API calls and a lot of counting in
 * the browser. This is those six calls as SQL, plus the two things the record
 * API cannot answer at all: what the join tables say the counters SHOULD be, and
 * how much disk this person is using.
 *
 * ## The drift block is the point of the page
 *
 * `users.post_count` and `users.followers` are denormalized caches of `posts`
 * and `follows`. A cascade delete removes the rows and leaves the counters
 * exactly where they were, so deleting one account silently leaves everybody
 * they followed reading one follower too many. `drift` puts the stored number
 * beside the counted one so the drawer can show both and offer Recount.
 */
routerAdd('GET', '/api/openscreengen/dash/account', (e) => {
  const dash = require(`${__hooks}/lib/dash.js`);
  if (!dash.superuser(e)) return e.json(401, { error: 'superuser only' });

  // Wrapped, for the reason set out in /series. A query string this cannot read
  // leaves `id` empty, and the next line answers that as the bad argument it is
  // rather than as a 500 from the parser.
  let query = {};
  try {
    query = e.requestInfo().query || {};
  } catch (err) {
    console.warn('openscreengen dash: could not read the query string, no account id to look up:', err);
    query = {};
  }

  const id = String(query.id || '').trim();
  // 400 rather than 404 for a malformed id: nothing was looked up, so this is a
  // bad argument. Never 403, on any path in this file: the browser client signs
  // out on 401 and 403 alike.
  if (!dash.RECORD_ID_RE.test(id)) return e.json(400, { error: 'that is not a record id' });

  const scalar = (sql, params, fallback) => dash.scalar($app, sql, params, fallback);
  const rows = (sql, params, model) => dash.rows($app, sql, params, model);
  const of = (sql) => scalar(sql, { id: id }, 0);

  const NAME = "COALESCE(NULLIF(u.display_name, ''), NULLIF(u.name, ''), '')";

  const account = rows(
    `SELECT u.id AS id, COALESCE(u.email, '') AS email, COALESCE(u.name, '') AS name,
            COALESCE(u.display_name, '') AS display_name, COALESCE(u.handle, '') AS handle,
            COALESCE(u.bio, '') AS bio, COALESCE(u.avatar, '') AS avatar,
            u.verified_badge AS verified_badge, u.banned AS banned,
            u.followers AS followers, u.post_count AS post_count,
            COALESCE(u.google_sub, '') AS google_sub, COALESCE(u.github_id, '') AS github_id,
            u.created AS created, u.updated AS updated
       FROM users u WHERE u.id = {:id}`,
    { id: id },
    {
      id: '', email: '', name: '', display_name: '', handle: '', bio: '', avatar: '',
      verified_badge: false, banned: false, followers: 0, post_count: 0,
      google_sub: '', github_id: '', created: '', updated: '',
    }
  );
  // 404 rather than 400: the id was well formed and there is simply nobody
  // there, which is what a pasted link to a deleted account looks like. The
  // record routes on this box answer the same way and the client shows the
  // message rather than signing out.
  if (!account.length) return e.json(404, { error: 'no such account' });

  const postsActual = of('SELECT COUNT(*) AS n FROM posts WHERE author = {:id}');
  const followersActual = of('SELECT COUNT(*) AS n FROM follows WHERE author = {:id}');

  const listOf = (value) => {
    try {
      const parsed = JSON.parse(String(value || '[]'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const posts = rows(
    `SELECT id, title, surface, hidden, featured, likes, comments, views, remixes,
            screens, created, COALESCE(images, '[]') AS images
       FROM posts WHERE author = {:id} ORDER BY created DESC LIMIT 24`,
    { id: id },
    {
      id: '', title: '', surface: '', hidden: false, featured: false, likes: 0,
      comments: 0, views: 0, remixes: 0, screens: 0, created: '', images: '',
    }
  );
  for (const post of posts) post.images = listOf(post.images);

  return e.json(200, {
    id: id,
    account: account[0],

    counts: {
      posts: postsActual,
      hidden_posts: of('SELECT COUNT(*) AS n FROM posts WHERE author = {:id} AND hidden = TRUE'),
      featured_posts: of('SELECT COUNT(*) AS n FROM posts WHERE author = {:id} AND featured = TRUE'),
      comments: of('SELECT COUNT(*) AS n FROM comments WHERE author = {:id}'),
      hidden_comments: of('SELECT COUNT(*) AS n FROM comments WHERE author = {:id} AND hidden = TRUE'),
      // Given, not received. Four different tables and four different
      // directions, so each one names which end it is counting.
      likes_given: of('SELECT COUNT(*) AS n FROM post_likes WHERE user = {:id}'),
      saves: of('SELECT COUNT(*) AS n FROM post_saves WHERE user = {:id}'),
      comment_likes_given: of('SELECT COUNT(*) AS n FROM comment_likes WHERE user = {:id}'),
      following: of('SELECT COUNT(*) AS n FROM follows WHERE follower = {:id}'),
      followers_actual: followersActual,
      projects: of('SELECT COUNT(*) AS n FROM cloud_projects WHERE owner = {:id}'),
      shared_projects: of(
        "SELECT COUNT(*) AS n FROM cloud_projects WHERE owner = {:id} AND visibility = 'link'"
      ),
      // Ungrouped SUM over a WHERE that matches nothing is the exact case that
      // returns NULL rather than 0, and an account with no projects is the
      // common case. COALESCE.
      project_bytes: of(
        'SELECT COALESCE(SUM(doc_bytes + asset_bytes), 0) AS n FROM cloud_projects WHERE owner = {:id}'
      ),
      assets: of('SELECT COUNT(*) AS n FROM cloud_project_assets WHERE owner = {:id}'),
      // Received, off the post counters. These are the cached numbers rather
      // than the join tables on purpose: they are what the feed shows this
      // person, and the drift checks are where the two are compared.
      received_likes: of('SELECT COALESCE(SUM(likes), 0) AS n FROM posts WHERE author = {:id}'),
      received_comments: of('SELECT COALESCE(SUM(comments), 0) AS n FROM posts WHERE author = {:id}'),
      views: of('SELECT COALESCE(SUM(views), 0) AS n FROM posts WHERE author = {:id}'),
    },

    drift: {
      post_count_stored: account[0].post_count,
      post_count_actual: postsActual,
      followers_stored: account[0].followers,
      followers_actual: followersActual,
    },

    posts: posts,

    /*
     * The comments carry the title of the post they are on, because a comment
     * body on its own is unreadable out of context and the drawer has to be able
     * to link through. LEFT JOIN rather than JOIN: a comment whose post has gone
     * should still show up here as evidence rather than vanish, and if the
     * cascade is working there will never be one.
     */
    comments: rows(
      `SELECT c.id AS id, c.body AS body, c.hidden AS hidden, c.likes AS likes,
              c.created AS created, c.post AS post, COALESCE(p.title, '') AS post_title
         FROM comments c LEFT JOIN posts p ON p.id = c.post
        WHERE c.author = {:id} ORDER BY c.created DESC LIMIT 24`,
      { id: id },
      { id: '', body: '', hidden: false, likes: 0, created: '', post: '', post_title: '' }
    ),

    projects: rows(
      `SELECT id, COALESCE(name, '') AS name, project_id, boards, doc_bytes, asset_bytes,
              COALESCE(visibility, '') AS visibility, COALESCE(share_slug, '') AS share_slug,
              hidden, format_version, created, updated
         FROM cloud_projects WHERE owner = {:id} ORDER BY updated DESC LIMIT 24`,
      { id: id },
      {
        id: '', name: '', project_id: '', boards: 0, doc_bytes: 0, asset_bytes: 0,
        visibility: '', share_slug: '', hidden: false, format_version: 0, created: '', updated: '',
      }
    ),
  });
});

// ---------- GET /api/openscreengen/dash/post ----------

/**
 * One post, its author, its thread, and who liked it.
 *
 * ## The client builds the image URLs
 *
 * `images` comes back as the raw array of filenames and `images_collection` as
 * the collection id, because PocketBase serves files at
 * `/api/files/{collection}/{record}/{filename}` and the browser already has a
 * `fileUrl` helper that knows about thumbs and file tokens. Building absolute
 * URLs here would mean this route deciding the thumbnail size, which is a layout
 * question it has no business answering.
 *
 * ## Drift again
 *
 * `likes_stored` versus `likes_actual` is the same story as the account route:
 * the counter is a cache of `post_likes` and a cascade delete does not touch it.
 * The drawer calls it out only when the two disagree, because a number that
 * always shows is a number nobody reads.
 */
routerAdd('GET', '/api/openscreengen/dash/post', (e) => {
  const dash = require(`${__hooks}/lib/dash.js`);
  if (!dash.superuser(e)) return e.json(401, { error: 'superuser only' });

  // Wrapped, for the reason set out in /series.
  let query = {};
  try {
    query = e.requestInfo().query || {};
  } catch (err) {
    console.warn('openscreengen dash: could not read the query string, no post id to look up:', err);
    query = {};
  }

  const id = String(query.id || '').trim();
  if (!dash.RECORD_ID_RE.test(id)) return e.json(400, { error: 'that is not a record id' });

  const scalar = (sql, params, fallback) => dash.scalar($app, sql, params, fallback);
  const rows = (sql, params, model) => dash.rows($app, sql, params, model);
  const NAME = "COALESCE(NULLIF(u.display_name, ''), NULLIF(u.name, ''), '')";

  const found = rows(
    `SELECT id, created, updated, author, title, COALESCE(caption, '') AS caption,
            COALESCE(tags, '[]') AS tags, COALESCE(tags_text, '') AS tags_text,
            COALESCE(search_text, '') AS search_text, COALESCE(surface, '') AS surface,
            COALESCE(app_name, '') AS app_name, screens,
            COALESCE(template_project_id, '') AS template_project_id,
            COALESCE(images, '[]') AS images, COALESCE(image_meta, '[]') AS image_meta,
            likes, comments, views, remixes, hidden, featured
       FROM posts WHERE id = {:id}`,
    { id: id },
    {
      id: '', created: '', updated: '', author: '', title: '', caption: '', tags: '',
      tags_text: '', search_text: '', surface: '', app_name: '', screens: 0,
      template_project_id: '', images: '', image_meta: '', likes: 0, comments: 0,
      views: 0, remixes: 0, hidden: false, featured: false,
    }
  );
  if (!found.length) return e.json(404, { error: 'no such post' });
  const post = found[0];

  /*
   * The three JSON columns, parsed here rather than in the browser.
   *
   * `record.get()` on a JSON field hands back a Go []byte, which JavaScript sees
   * as an Array OF NUMBERS, so `Array.isArray` passes and the value quietly
   * becomes the character codes of its own JSON. That is the trap
   * `lib/openscreengen.js` documents at `jsonArray`, and nine accounts in the
   * sibling project were mangled by it. Reading these as text through SQL and
   * parsing the text sidesteps it entirely: what comes out of a DynamicModel
   * text slot is a real string.
   */
  const listOf = (value) => {
    try {
      const parsed = JSON.parse(String(value || '[]'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  post.images = listOf(post.images);
  post.image_meta = listOf(post.image_meta);
  post.tags = listOf(post.tags);

  /*
   * The collection id for the file URLs. By id rather than by the name `posts`
   * because a collection can be renamed and its id cannot, and a thumbnail that
   * silently 404s after a rename is a bug nobody connects to the rename.
   * Wrapped, with the name as the fallback, since `/api/files` accepts either.
   */
  let imagesCollection = 'posts';
  try {
    imagesCollection = $app.findCollectionByNameOrId('posts').id || 'posts';
  } catch (err) {
    console.warn('openscreengen dash: could not resolve the posts collection id —', err);
  }

  const author = rows(
    `SELECT u.id AS id, COALESCE(u.email, '') AS email, COALESCE(u.name, '') AS name,
            COALESCE(u.display_name, '') AS display_name, COALESCE(u.handle, '') AS handle,
            COALESCE(u.avatar, '') AS avatar, u.verified_badge AS verified_badge,
            u.banned AS banned, u.followers AS followers, u.post_count AS post_count,
            u.created AS created
       FROM users u WHERE u.id = {:author}`,
    { author: post.author },
    {
      id: '', email: '', name: '', display_name: '', handle: '', avatar: '',
      verified_badge: false, banned: false, followers: 0, post_count: 0, created: '',
    }
  );

  return e.json(200, {
    id: id,
    post: post,
    images_collection: imagesCollection,
    // Null rather than an empty object when the author has gone: the drawer has
    // to be able to say so, and an empty object renders as a nameless row that
    // looks like a rendering bug rather than a missing account.
    author: author.length ? author[0] : null,

    // Oldest first, which is how a thread reads and what `idx_comments_post`
    // orders by, so this comes straight off the index.
    comments: rows(
      `SELECT c.id AS id, c.body AS body, c.likes AS likes, c.hidden AS hidden,
              c.created AS created, c.author AS author, ${NAME} AS author_name,
              COALESCE(u.handle, '') AS author_handle, COALESCE(u.avatar, '') AS author_avatar
         FROM comments c LEFT JOIN users u ON u.id = c.author
        WHERE c.post = {:id} ORDER BY c.created LIMIT 50`,
      { id: id },
      {
        id: '', body: '', likes: 0, hidden: false, created: '', author: '',
        author_name: '', author_handle: '', author_avatar: '',
      }
    ),

    likers: rows(
      `SELECT l.user AS u, ${NAME} AS name, COALESCE(u.handle, '') AS handle,
              COALESCE(u.avatar, '') AS avatar, l.created AS created
         FROM post_likes l LEFT JOIN users u ON u.id = l.user
        WHERE l.post = {:id} ORDER BY l.created DESC LIMIT 40`,
      { id: id },
      { u: '', name: '', handle: '', avatar: '', created: '' }
    ),

    /*
     * Savers is a NUMBER, not a list, and that is deliberate. A save is private:
     * the app never shows anybody who saved a post, and a dashboard that listed
     * them would be reading something no user has ever agreed to publish. The
     * count is enough to answer the only operator question there is, which is
     * whether a post is being kept.
     */
    savers: scalar('SELECT COUNT(*) AS n FROM post_saves WHERE post = {:id}', { id: id }, 0),

    drift: {
      likes_stored: post.likes,
      likes_actual: scalar('SELECT COUNT(*) AS n FROM post_likes WHERE post = {:id}', { id: id }, 0),
      comments_stored: post.comments,
      comments_actual: scalar('SELECT COUNT(*) AS n FROM comments WHERE post = {:id}', { id: id }, 0),
    },
  });
});

// ---------- GET /api/openscreengen/dash/project ----------

/**
 * One cloud project, its owner, and every asset hanging off it.
 *
 * This is the disk, per project. `cloud_projects.asset_bytes` is a column the
 * save route maintains and `totals.asset_bytes` is the sum of the actual asset
 * rows; the two disagreeing means the column is stale, because the rows are the
 * files. The drawer shows both.
 *
 * 200 assets is the cap, which is well past anything the editor produces for one
 * project. A project that hits it is worth looking at in the Tables view rather
 * than worth a bigger response.
 */
routerAdd('GET', '/api/openscreengen/dash/project', (e) => {
  const dash = require(`${__hooks}/lib/dash.js`);
  if (!dash.superuser(e)) return e.json(401, { error: 'superuser only' });

  // Wrapped, for the reason set out in /series.
  let query = {};
  try {
    query = e.requestInfo().query || {};
  } catch (err) {
    console.warn('openscreengen dash: could not read the query string, no project id to look up:', err);
    query = {};
  }

  const id = String(query.id || '').trim();
  if (!dash.RECORD_ID_RE.test(id)) return e.json(400, { error: 'that is not a record id' });

  const scalar = (sql, params, fallback) => dash.scalar($app, sql, params, fallback);
  const rows = (sql, params, model) => dash.rows($app, sql, params, model);

  const found = rows(
    `SELECT id, created, updated, owner, project_id, COALESCE(name, '') AS name,
            COALESCE(doc, '') AS doc, COALESCE(doc_encoding, '') AS doc_encoding,
            doc_bytes, asset_bytes, boards, format_version,
            COALESCE(visibility, '') AS visibility, COALESCE(share_slug, '') AS share_slug,
            hidden
       FROM cloud_projects WHERE id = {:id}`,
    { id: id },
    {
      id: '', created: '', updated: '', owner: '', project_id: '', name: '', doc: '',
      doc_encoding: '', doc_bytes: 0, asset_bytes: 0, boards: 0, format_version: 0,
      visibility: '', share_slug: '', hidden: false,
    }
  );
  if (!found.length) return e.json(404, { error: 'no such project' });
  const project = found[0];

  const owner = rows(
    `SELECT u.id AS id, COALESCE(u.email, '') AS email, COALESCE(u.name, '') AS name,
            COALESCE(u.display_name, '') AS display_name, COALESCE(u.handle, '') AS handle,
            COALESCE(u.avatar, '') AS avatar, u.banned AS banned, u.created AS created
       FROM users u WHERE u.id = {:owner}`,
    { owner: project.owner },
    { id: '', email: '', name: '', display_name: '', handle: '', avatar: '', banned: false, created: '' }
  );

  const assets = rows(
    `SELECT id, asset_id, COALESCE(kind, '') AS kind, size,
            COALESCE(meta, '{}') AS meta, created, COALESCE(file, '') AS file
       FROM cloud_project_assets WHERE project = {:id} ORDER BY created DESC LIMIT 200`,
    { id: id },
    { id: '', asset_id: '', kind: '', size: 0, meta: '', created: '', file: '' }
  );
  /*
   * `meta` is the JSON that rebuilds the editor's IndexedDB row: mimeType, name,
   * width, height and duration for media, family and format for a font. Parsed
   * to an object so the drawer can print the dimensions of a recording rather
   * than a wall of escaped JSON. An unparseable value becomes `{}` rather than
   * throwing, because one hand-edited row must not empty the asset list.
   */
  for (const asset of assets) {
    try {
      const parsed = JSON.parse(String(asset.meta || '{}'));
      asset.meta = parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      asset.meta = {};
    }
  }

  return e.json(200, {
    id: id,
    project: project,
    owner: owner.length ? owner[0] : null,
    assets: assets,
    totals: {
      // Counted, not `assets.length`: the list is capped at 200 and the total
      // has to be true even when the list is not the whole story.
      assets: scalar('SELECT COUNT(*) AS n FROM cloud_project_assets WHERE project = {:id}', { id: id }, 0),
      asset_bytes: scalar(
        'SELECT COALESCE(SUM(size), 0) AS n FROM cloud_project_assets WHERE project = {:id}',
        { id: id },
        0
      ),
      doc_bytes: project.doc_bytes,
    },
  });
});

// ---------- GET /api/openscreengen/dash/risk ----------

/**
 * The integrity scan: every question this schema can actually answer, as SQL.
 *
 * Each finding is its own wrapped query, so a check that cannot run costs that
 * check and nothing else. A card that comes back empty because it found nothing
 * and a card that comes back empty because the query failed have to look
 * different on the page, which is why the Integrity view collapses a clean check
 * to a "clear" line rather than hiding it.
 *
 * ## The counter drift story, which is the spine of this route
 *
 * `posts.likes`, `posts.comments`, `comments.likes`, `users.followers` and
 * `users.post_count` are denormalized caches of the join tables, and the
 * migration that created them argues the case at length: a feed page is twelve
 * cards, every card shows two counters, and every sort except newest orders BY
 * them, so counting them per request is the query that makes a feed slow before
 * anything else does.
 *
 * The cost is drift. Every relation on this box cascades, so deleting an account
 * removes its likes, saves, follows and comments as ROWS, and touches none of
 * the counters that were summarising them. Nothing is corrupted and nothing is
 * lost; the numbers on other people's posts are simply now too high. That is not
 * a bug to hide, it is the thing this page exists to surface and Recount exists
 * to repair.
 *
 * ## Nothing here is a verdict
 *
 * A burst of posts is a launch day as often as it is a flood. Two accounts with
 * the same handle is a partial index that did its job in a way nobody expected.
 * These are leads, the copy on the page says so, and every card carries a line
 * saying what it does NOT mean.
 */
routerAdd('GET', '/api/openscreengen/dash/risk', (e) => {
  const dash = require(`${__hooks}/lib/dash.js`);
  if (!dash.superuser(e)) return e.json(401, { error: 'superuser only' });

  const now = Date.now();
  const scalar = (sql, params, fallback) => dash.scalar($app, sql, params, fallback);
  const rows = (sql, params, model) => dash.rows($app, sql, params, model);

  const jsonOk = scalar("SELECT json_valid('[]') AS n", null, 0) === 1;
  const NAME = "COALESCE(NULLIF(u.display_name, ''), NULLIF(u.name, ''), '')";

  /*
   * The four thresholds, read from the same rows the hooks enforce.
   *
   * Hard coding them here would mean the page flagging accounts the box is
   * perfectly happy with, ten minutes after somebody raised a limit. The
   * fallbacks are the values in `DEFAULTS` in lib/openscreengen.js, which is
   * what the box does when a row is missing, so a deleted row makes this page
   * agree with the hooks rather than with zero.
   */
  const maxPostsPerDay = dash.num($app, 'max_posts_per_day', 10);
  const maxCommentsPerHour = dash.num($app, 'max_comments_per_hour', 30);
  const maxUserBytes = dash.num($app, 'max_cloud_user_bytes', 1073741824);
  const maxProjectBytes = dash.num($app, 'max_cloud_project_bytes', 268435456);

  const dayAgo = dash.pbDate(now - 86400000);
  const hourAgo = dash.pbDate(now - 3600000);

  /*
   * What is switched on right now, raw.
   *
   * The loud one is `enabled`: while it is anything other than the literal word
   * "false" the whole feed is live, and `writes_enabled` is the one to reach for
   * while moderating, because it leaves the feed readable and refuses every
   * write.
   *
   * Every key is emitted whether or not the table has a row for it, with
   * `absent: true` on the ones it does not, for the reason set out at length
   * over `switches` in /stats: a deleted row is the HOOK DEFAULT in force, not
   * an off switch, and on the strip that exists to say what is on, a key that
   * simply disappears is indistinguishable from one that is off.
   *
   * The same seven keys and the same shape as `switches`, written out again
   * rather than shared, because each handler runs in its own VM and a constant
   * at this file's top level is invisible in here. The two lists have to stay in
   * step; they are two panels of the same posture.
   */
  const POSTURE_KEYS = [
    'avatar_fetch_enabled',
    'cloud_projects_enabled',
    'enabled',
    'github_allow_pat',
    'moderation_note',
    'signin_enabled',
    'writes_enabled',
  ];
  const stored = {};
  for (const row of rows(
    `SELECT key AS k, value AS v FROM settings
      WHERE key IN (${POSTURE_KEYS.map((key) => `'${key}'`).join(',')})`,
    null,
    { k: '', v: '' }
  )) {
    stored[row.k] = row.v;
  }
  const posture = POSTURE_KEYS.map((key) => {
    const has = Object.prototype.hasOwnProperty.call(stored, key);
    return { k: key, v: has ? stored[key] : '', absent: !has };
  });

  return e.json(200, {
    now: now,
    json_ok: jsonOk,

    posture: posture,

    /*
     * The five drift checks, all the same shape: compute the counted value in a
     * subselect, then filter the wrapper on the two disagreeing.
     *
     * Written as `SELECT * FROM (...) WHERE stored != actual` rather than with
     * the subquery repeated in the WHERE, because SQLite will not let a WHERE
     * refer to a column alias defined in the same SELECT and the alternative is
     * the same correlated COUNT written out three times per query. The planner
     * flattens this into the same work either way.
     *
     * The star is over a DERIVED table whose four columns are named right there,
     * not over `users`. That distinction is the difference between four aliases
     * and a password hash: a `SELECT *` on an auth collection is how one leaves
     * the box, and the two checks below select from `users` by name for exactly
     * that reason.
     */
    post_like_drift: rows(
      `SELECT * FROM (
         SELECT p.id AS id, COALESCE(p.title, '') AS title, p.likes AS stored,
                (SELECT COUNT(*) FROM post_likes l WHERE l.post = p.id) AS actual
           FROM posts p
       ) WHERE stored != actual ORDER BY actual DESC LIMIT 40`,
      null,
      { id: '', title: '', stored: 0, actual: 0 }
    ),
    post_comment_drift: rows(
      `SELECT * FROM (
         SELECT p.id AS id, COALESCE(p.title, '') AS title, p.comments AS stored,
                (SELECT COUNT(*) FROM comments c WHERE c.post = p.id) AS actual
           FROM posts p
       ) WHERE stored != actual ORDER BY actual DESC LIMIT 40`,
      null,
      { id: '', title: '', stored: 0, actual: 0 }
    ),
    comment_like_drift: rows(
      `SELECT * FROM (
         SELECT c.id AS id, c.body AS body, c.likes AS stored,
                (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment = c.id) AS actual
           FROM comments c
       ) WHERE stored != actual ORDER BY actual DESC LIMIT 40`,
      null,
      { id: '', body: '', stored: 0, actual: 0 }
    ),
    author_count_drift: rows(
      `SELECT * FROM (
         SELECT u.id AS u, ${NAME} AS name, COALESCE(u.handle, '') AS handle,
                u.post_count AS stored,
                (SELECT COUNT(*) FROM posts p WHERE p.author = u.id) AS actual
           FROM users u
       ) WHERE stored != actual ORDER BY actual DESC LIMIT 40`,
      null,
      { u: '', name: '', handle: '', stored: 0, actual: 0 }
    ),
    follower_drift: rows(
      `SELECT * FROM (
         SELECT u.id AS u, ${NAME} AS name, COALESCE(u.handle, '') AS handle,
                u.followers AS stored,
                (SELECT COUNT(*) FROM follows f WHERE f.author = u.id) AS actual
           FROM users u
       ) WHERE stored != actual ORDER BY actual DESC LIMIT 40`,
      null,
      { u: '', name: '', handle: '', stored: 0, actual: 0 }
    ),

    /*
     * Following yourself. The follow route refuses it, so a row here is either a
     * record created by hand in the admin or a bug in that refusal, and it
     * inflates the account's own follower count either way.
     */
    self_follows: rows(
      `SELECT f.follower AS u, ${NAME} AS name
         FROM follows f LEFT JOIN users u ON u.id = f.follower
        WHERE f.follower = f.author LIMIT 40`,
      null,
      { u: '', name: '' }
    ),

    /*
     * Two accounts on one handle, which `idx_users_handle` is supposed to make
     * impossible. It is a PARTIAL unique index, `WHERE handle != ''`, so the one
     * thing it deliberately allows is any number of accounts with a blank
     * handle. The `!= ''` here matches that, so a hundred handle-less accounts
     * do not report as one enormous collision.
     */
    duplicate_handles: rows(
      `SELECT handle AS handle, COUNT(*) AS n FROM users
        WHERE handle != '' GROUP BY handle HAVING COUNT(*) > 1 ORDER BY n DESC LIMIT 40`,
      null,
      { handle: '', n: 0 }
    ),
    // The same shape for share slugs, and the same partial index behind it. A
    // collision here would mean two projects answering one link, which is the
    // one bug in this feature that leaks somebody's work to a stranger.
    slug_collisions: rows(
      `SELECT share_slug AS slug, COUNT(*) AS n FROM cloud_projects
        WHERE share_slug != '' GROUP BY share_slug HAVING COUNT(*) > 1 ORDER BY n DESC LIMIT 40`,
      null,
      { slug: '', n: 0 }
    ),

    /*
     * A post with no screens on it. The share route refuses one, so this is a
     * post whose upload half failed, or one whose files were removed from the
     * disk without the record going with them. It renders in the feed as an
     * empty card, which is the visible symptom nobody can otherwise explain.
     *
     * Tested as text rather than with `json_array_length`, so the check works on
     * a SQLite without JSON1: an empty file column is stored as `[]` or as the
     * empty string depending on how the row was written.
     */
    empty_posts: rows(
      `SELECT p.id AS id, COALESCE(p.title, '') AS title, ${NAME} AS author_name,
              p.created AS created
         FROM posts p LEFT JOIN users u ON u.id = p.author
        WHERE p.images IS NULL OR p.images = '' OR p.images = '[]'
        ORDER BY p.created DESC LIMIT 40`,
      null,
      { id: '', title: '', author_name: '', created: '' }
    ),

    /*
     * Over the rate limits in the last window. These are the two settings that
     * bound flooding, and an account ABOVE its own limit means the limit was
     * raised since, or the count that enforces it did not see these rows. Either
     * is worth knowing; neither is proof of anything.
     */
    burst_posters: rows(
      `SELECT p.author AS u, ${NAME} AS name, COALESCE(u.handle, '') AS handle, COUNT(*) AS n
         FROM posts p LEFT JOIN users u ON u.id = p.author
        WHERE p.created >= {:from}
        GROUP BY p.author HAVING COUNT(*) > {:cap}
        ORDER BY n DESC LIMIT 40`,
      { from: dayAgo, cap: maxPostsPerDay },
      { u: '', name: '', handle: '', n: 0 }
    ),
    burst_commenters: rows(
      `SELECT c.author AS u, ${NAME} AS name, COALESCE(u.handle, '') AS handle, COUNT(*) AS n
         FROM comments c LEFT JOIN users u ON u.id = c.author
        WHERE c.created >= {:from}
        GROUP BY c.author HAVING COUNT(*) > {:cap}
        ORDER BY n DESC LIMIT 40`,
      { from: hourAgo, cap: maxCommentsPerHour },
      { u: '', name: '', handle: '', n: 0 }
    ),

    /*
     * Disk, per account and per project. `max_cloud_user_bytes` is the real
     * limit on this box and it is checked before each asset upload, so an
     * account over it is one that grew past the line before the line moved, or
     * one whose project rows are stale. Both are answered by looking, not by
     * assuming.
     */
    heavy_owners: rows(
      `SELECT p.owner AS u, ${NAME} AS name, COALESCE(u.handle, '') AS handle,
              COALESCE(SUM(p.doc_bytes + p.asset_bytes), 0) AS bytes, COUNT(*) AS projects
         FROM cloud_projects p LEFT JOIN users u ON u.id = p.owner
        GROUP BY p.owner
       HAVING COALESCE(SUM(p.doc_bytes + p.asset_bytes), 0) > {:cap}
        ORDER BY bytes DESC LIMIT 40`,
      { cap: maxUserBytes },
      { u: '', name: '', handle: '', bytes: 0, projects: 0 }
    ),
    over_quota_projects: rows(
      `SELECT p.id AS id, COALESCE(p.name, '') AS name, ${NAME} AS owner_name,
              (p.doc_bytes + p.asset_bytes) AS bytes
         FROM cloud_projects p LEFT JOIN users u ON u.id = p.owner
        WHERE (p.doc_bytes + p.asset_bytes) > {:cap}
        ORDER BY bytes DESC LIMIT 40`,
      { cap: maxProjectBytes },
      { id: '', name: '', owner_name: '', bytes: 0 }
    ),

    /*
     * Banned accounts whose work is still in the feed. Banning stops the token
     * and nothing else, deliberately: it is reversible and it destroys nothing.
     * So this is the list of decisions that were half made, and the drawer is
     * where the other half is either finished or undone.
     */
    banned_with_content: rows(
      `SELECT u.id AS u, ${NAME} AS name,
              (SELECT COUNT(*) FROM posts p WHERE p.author = u.id) AS posts,
              (SELECT COUNT(*) FROM comments c WHERE c.author = u.id) AS comments
         FROM users u
        WHERE u.banned = TRUE
          AND ((SELECT COUNT(*) FROM posts p WHERE p.author = u.id) > 0
               OR (SELECT COUNT(*) FROM comments c WHERE c.author = u.id) > 0)
        ORDER BY posts DESC LIMIT 40`,
      null,
      { u: '', name: '', posts: 0, comments: 0 }
    ),

    unlinked_accounts: scalar(
      "SELECT COUNT(*) AS n FROM users WHERE google_sub = '' AND github_id = ''",
      null,
      0
    ),

    /*
     * Rows pointing at something that is not there.
     *
     * Every one of these should be zero, because every relation in the
     * migrations is `cascadeDelete: true`. A number here means a cascade did not
     * fire, which is a much bigger deal than a drifted counter: a counter is
     * cosmetic and rebuildable, an orphaned asset row is a file on the disk that
     * nothing will ever delete.
     *
     * Both ends of each join are checked, because a like has two parents and
     * either could be the one that went.
     */
    orphans: {
      post_likes: scalar(
        `SELECT COUNT(*) AS n FROM post_likes l
          WHERE NOT EXISTS (SELECT 1 FROM posts p WHERE p.id = l.post)
             OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = l.user)`,
        null,
        0
      ),
      post_saves: scalar(
        `SELECT COUNT(*) AS n FROM post_saves s
          WHERE NOT EXISTS (SELECT 1 FROM posts p WHERE p.id = s.post)
             OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = s.user)`,
        null,
        0
      ),
      comment_likes: scalar(
        `SELECT COUNT(*) AS n FROM comment_likes cl
          WHERE NOT EXISTS (SELECT 1 FROM comments c WHERE c.id = cl.comment)
             OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = cl.user)`,
        null,
        0
      ),
      follows: scalar(
        `SELECT COUNT(*) AS n FROM follows f
          WHERE NOT EXISTS (SELECT 1 FROM users a WHERE a.id = f.follower)
             OR NOT EXISTS (SELECT 1 FROM users b WHERE b.id = f.author)`,
        null,
        0
      ),
      comments: scalar(
        `SELECT COUNT(*) AS n FROM comments c
          WHERE NOT EXISTS (SELECT 1 FROM posts p WHERE p.id = c.post)
             OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = c.author)`,
        null,
        0
      ),
      assets: scalar(
        `SELECT COUNT(*) AS n FROM cloud_project_assets a
          WHERE NOT EXISTS (SELECT 1 FROM cloud_projects p WHERE p.id = a.project)
             OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = a.owner)`,
        null,
        0
      ),
    },

    // Echoed back so the page can print the threshold beside the finding. A
    // list of accounts "over the limit" with the limit missing is unreadable.
    limits: {
      max_posts_per_day: maxPostsPerDay,
      max_comments_per_hour: maxCommentsPerHour,
      max_cloud_user_bytes: maxUserBytes,
      max_cloud_project_bytes: maxProjectBytes,
    },
  });
});

// ---------- GET /api/openscreengen/dash/storage ----------

/**
 * Is the disk filling, and what is on it.
 *
 * ## Two halves, and only one of them is free
 *
 * The database half is cheap: row counts, the project byte columns, the biggest
 * projects and the heaviest owners. It runs on every load.
 *
 * The disk half walks the filesystem and is **opt in via `?measure=1`**, because
 * `pb_data/storage` holds every uploaded screenshot, avatar, project document
 * and screen recording on the box, and stat-ing all of it is real work on a
 * spinning disk. A dashboard that did it on every refresh would be the heaviest
 * thing running on the server.
 *
 * ## Why the walk exists at all
 *
 * **Post images have no byte column anywhere in this schema.** `posts.images` is
 * a list of filenames and `image_meta` carries aspect, fit and label but not
 * size, so the database genuinely cannot answer how much disk the feed is using.
 * Cloud projects can, because the save route records `doc_bytes` and
 * `asset_bytes`. The measure button is the only way to see the other half, and
 * the page says so in as many words.
 *
 * ## The walk is bounded, wrapped, and honest about stopping
 *
 * 20000 files and 4000 directories, iteratively rather than recursively so a
 * deep tree cannot blow the stack, and `truncated: true` when either cap is hit
 * so the number is never presented as complete when it is not. The whole thing
 * is wrapped: a filesystem this process cannot read answers `disk: null` and the
 * page says the walk could not run. It never answers 500, because the database
 * half of this response is still perfectly good.
 */
routerAdd('GET', '/api/openscreengen/dash/storage', (e) => {
  const dash = require(`${__hooks}/lib/dash.js`);
  if (!dash.superuser(e)) return e.json(401, { error: 'superuser only' });

  // Wrapped, for the reason set out in /series. A query string this cannot read
  // means no `measure=1`, which means the cheap half of this page and no disk
  // walk: the safe way round to get that wrong.
  let query = {};
  try {
    query = e.requestInfo().query || {};
  } catch (err) {
    console.warn('openscreengen dash: could not read the query string, skipping the disk walk:', err);
    query = {};
  }

  const measure = String(query.measure || '') === '1';

  const scalar = (sql, params, fallback) => dash.scalar($app, sql, params, fallback);
  const rows = (sql, params, model) => dash.rows($app, sql, params, model);
  const NAME = "COALESCE(NULLIF(u.display_name, ''), NULLIF(u.name, ''), '')";

  /*
   * The bounded walk.
   *
   * `$os.readDir` hands back Go DirEntry values whose `name()`, `isDir()` and
   * `info()` are method CALLS rather than properties, and any of them can throw
   * on a file that was deleted between the listing and the stat. Each one is
   * therefore wrapped individually: one unreadable file costs its own bytes, not
   * the whole measurement.
   *
   * `entry.info()` first and `$os.stat` only as a fallback, because the first
   * usually answers from data the directory read already had and the second is
   * a syscall per file.
   */
  const walk = () => {
    const startedAt = Date.now();
    const MAX_FILES = 20000;
    const MAX_DIRS = 4000;

    /*
     * Where the data actually lives. `$app.dataDir()` is the honest answer and
     * `pb_data` is what the docker compose file mounts, so the fallback is right
     * on this box and wrong nowhere that matters. Guarded because the name of
     * this accessor has moved between PocketBase versions and a throw here would
     * cost the whole panel rather than the path.
     */
    let dataDir = 'pb_data';
    try {
      dataDir = String($app.dataDir() || 'pb_data');
    } catch (err) {
      console.warn('openscreengen dash: could not read the data dir, assuming pb_data —', err);
    }
    const root = `${dataDir}/storage`;

    let files = 0;
    let dirs = 0;
    let bytes = 0;
    let truncated = false;
    const stack = [root];

    while (stack.length > 0) {
      if (dirs >= MAX_DIRS || files >= MAX_FILES) {
        truncated = true;
        break;
      }
      const dir = stack.pop();
      dirs += 1;

      let entries = null;
      try {
        entries = $os.readDir(dir);
      } catch {
        // A directory that cannot be listed is skipped rather than fatal: it is
        // one collection's folder, and the rest of the tree is still worth
        // counting.
        continue;
      }
      if (!entries) continue;

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        let name = '';
        try {
          name = String(entry.name() || '');
        } catch {
          continue;
        }
        if (!name) continue;
        const path = `${dir}/${name}`;

        let isDir = false;
        try {
          isDir = entry.isDir();
        } catch {
          isDir = false;
        }
        if (isDir) {
          stack.push(path);
          continue;
        }

        if (files >= MAX_FILES) {
          truncated = true;
          break;
        }
        files += 1;

        let size = 0;
        try {
          size = Number(entry.info().size()) || 0;
        } catch {
          try {
            size = Number($os.stat(path).size()) || 0;
          } catch {
            size = 0;
          }
        }
        bytes += size;
      }
    }

    return {
      path: root,
      bytes: bytes,
      files: files,
      dirs: dirs,
      truncated: truncated,
      ms: Date.now() - startedAt,
    };
  };

  let disk = null;
  if (measure) {
    try {
      disk = walk();
    } catch (err) {
      // Null, never a 500. The database half of this response is fine and the
      // page can say the walk could not run.
      console.warn('openscreengen dash: the disk walk failed —', err);
      disk = null;
    }
  }

  /*
   * The same pair as /stats, and it has to stay in step with it. See the long
   * note there for why `mod_log` is counted on its own: it ships in a migration
   * while this file ships in the hooks, docker-compose binds those as two
   * separate mounts, and a hooks-only sync must not empty the whole row count
   * table. `-1` keeps "no such table" out of the list rather than reporting it
   * as an empty one.
   */
  const tables = rows(
    `SELECT 'users' AS k, COUNT(*) AS n FROM users
     UNION ALL SELECT 'posts', COUNT(*) FROM posts
     UNION ALL SELECT 'comments', COUNT(*) FROM comments
     UNION ALL SELECT 'post_likes', COUNT(*) FROM post_likes
     UNION ALL SELECT 'post_saves', COUNT(*) FROM post_saves
     UNION ALL SELECT 'comment_likes', COUNT(*) FROM comment_likes
     UNION ALL SELECT 'follows', COUNT(*) FROM follows
     UNION ALL SELECT 'cloud_projects', COUNT(*) FROM cloud_projects
     UNION ALL SELECT 'cloud_project_assets', COUNT(*) FROM cloud_project_assets
     UNION ALL SELECT 'settings', COUNT(*) FROM settings`,
    null,
    { k: '', n: 0 }
  );
  const logRows = scalar('SELECT COUNT(*) AS n FROM mod_log', null, -1);
  if (logRows >= 0) tables.push({ k: 'mod_log', n: logRows });

  return e.json(200, {
    now: Date.now(),

    tables: tables,

    projects: {
      projects: scalar('SELECT COUNT(*) AS n FROM cloud_projects'),
      doc_bytes: scalar('SELECT COALESCE(SUM(doc_bytes), 0) AS n FROM cloud_projects'),
      asset_bytes: scalar('SELECT COALESCE(SUM(asset_bytes), 0) AS n FROM cloud_projects'),
      assets: scalar('SELECT COUNT(*) AS n FROM cloud_project_assets'),
      // The sum of the asset ROWS, which is the truth. Beside `asset_bytes`,
      // which is the cache the save route maintains on the project.
      asset_size_sum: scalar('SELECT COALESCE(SUM(size), 0) AS n FROM cloud_project_assets'),
      shared: scalar("SELECT COUNT(*) AS n FROM cloud_projects WHERE visibility = 'link'"),
      hidden: scalar('SELECT COUNT(*) AS n FROM cloud_projects WHERE hidden = TRUE'),
    },

    by_owner: rows(
      `SELECT p.owner AS u, ${NAME} AS name, COALESCE(u.handle, '') AS handle,
              COUNT(*) AS projects,
              COALESCE(SUM(p.doc_bytes + p.asset_bytes), 0) AS bytes,
              (SELECT COUNT(*) FROM cloud_project_assets a WHERE a.owner = p.owner) AS assets
         FROM cloud_projects p LEFT JOIN users u ON u.id = p.owner
        GROUP BY p.owner ORDER BY bytes DESC LIMIT 25`,
      null,
      { u: '', name: '', handle: '', projects: 0, bytes: 0, assets: 0 }
    ),

    biggest: rows(
      `SELECT p.id AS id, COALESCE(p.name, '') AS name, ${NAME} AS owner_name,
              (p.doc_bytes + p.asset_bytes) AS bytes, p.boards AS boards, p.updated AS updated
         FROM cloud_projects p LEFT JOIN users u ON u.id = p.owner
        ORDER BY bytes DESC LIMIT 25`,
      null,
      { id: '', name: '', owner_name: '', bytes: 0, boards: 0, updated: '' }
    ),

    /*
     * Counts only, and this is the honest limit of the database half.
     *
     * `posts` is the number of posts that actually carry a file, and `screens`
     * is the sum of the `screens` column, which is what the share form reported
     * rather than what is on the disk. Neither is a byte count and there is no
     * byte count to be had: no column in this schema records the size of an
     * uploaded screenshot. That is exactly why the measure button exists.
     */
    post_images: {
      posts: scalar(
        "SELECT COUNT(*) AS n FROM posts WHERE images IS NOT NULL AND images != '' AND images != '[]'"
      ),
      screens: scalar('SELECT COALESCE(SUM(screens), 0) AS n FROM posts'),
    },

    disk: disk,
  });
});

// ---------- POST /api/openscreengen/dash/moderate ----------

/**
 * The one route in this file that writes to content.
 *
 * Hide, unhide, feature, unfeature, ban, verify, revoke a link, and delete, for
 * the four things this box holds. Everything here is reachable through the
 * record API with the same token; what this route adds is the bookkeeping that
 * the record API cannot do, and the audit line.
 *
 * ## Hiding is not deleting, and it must not touch a counter
 *
 * A hidden post still exists, its images are still on the disk, and its likes
 * are still real: somebody genuinely liked it and the row saying so has not
 * moved. So hiding writes one boolean and nothing else. A mistake is one click
 * to undo and an abuse report still has its evidence attached when somebody asks
 * about it a week later. That reasoning is the migration's, not this route's.
 *
 * ## Deleting has to fix the two things the cascade cannot
 *
 * Every relation in the schema is `cascadeDelete: true`, so deleting a post
 * takes its comments, likes and saves with it, and deleting an account takes
 * everything. What a cascade does NOT do is touch a denormalized counter on a
 * row it did not delete:
 *
 *  - Deleting a post leaves `users.post_count` on its author one too high.
 *  - Deleting a comment leaves `posts.comments` on its post one too high.
 *
 * Both are decremented here, clamped at zero, inside the same transaction as the
 * delete. Deleting an ACCOUNT is the one that cannot be fixed inline: it removes
 * likes and follows scattered across every other account's rows, and walking
 * them would be an unbounded number of writes inside one transaction. The
 * response says so in words and points at Recount, which is the bounded way to
 * repair it.
 *
 * ## Never 403
 *
 * `dash/pb.js` force-signs-out on 401 and on 403 alike, so a mistyped action
 * answered 403 would eject the operator to the sign-in gate instead of telling
 * them what was wrong with it. 400 names the problem, 404 means it is not there,
 * and 401 is only ever a genuine non-superuser.
 */
routerAdd('POST', '/api/openscreengen/dash/moderate', (e) => {
  // Both requires inside the handler, and that is not style: hook VM isolation
  // means a helper at this file's top level is invisible in here, and the
  // failure is a bare 400 with nothing in any log.
  const dash = require(`${__hooks}/lib/dash.js`);
  const openscreengen = require(`${__hooks}/lib/openscreengen.js`);

  if (!dash.superuser(e)) return e.json(401, { error: 'superuser only' });

  const body = openscreengen.readBody(e);
  if (!body) return e.json(400, { error: 'unreadable body' });

  /*
   * The allowed actions per target, as data rather than as a switch.
   *
   * It is the whole authorisation surface of this route: an action that is not
   * in this table cannot reach a write, whatever the browser sends. Kept beside
   * the collection names it maps to so that adding a target means adding two
   * lines in one place.
   */
  const ACTIONS = {
    post: ['hide', 'unhide', 'feature', 'unfeature', 'delete'],
    comment: ['hide', 'unhide', 'delete'],
    account: ['ban', 'unban', 'verify', 'unverify', 'delete'],
    project: ['unshare', 'hide', 'unhide', 'delete'],
  };
  const COLLECTIONS = {
    post: 'posts',
    comment: 'comments',
    account: 'users',
    project: 'cloud_projects',
  };

  const target = String(body.target || '');
  const action = String(body.action || '');
  const id = String(body.id || '');

  if (!ACTIONS[target]) return e.json(400, { error: 'that is not something this can act on' });
  if (ACTIONS[target].indexOf(action) === -1) {
    return e.json(400, { error: `${action || 'that'} is not an action for a ${target}` });
  }
  if (!dash.RECORD_ID_RE.test(id)) return e.json(400, { error: 'that is not a record id' });

  /*
   * The idempotency ref, checked only for shape.
   *
   * Minted in the browser by `newRef()` and reused verbatim on a retry. Nothing
   * on this route is keyed on it, because none of these actions is a payment and
   * hiding an already hidden post is harmless. It is validated anyway so that a
   * client sending junk is told, and it is written into `mod_log.ref` at the
   * bottom of this handler, which is what lets a duplicate action be recognised
   * as one afterwards instead of read as two clicks.
   */
  const ref = String(body.ref || '');
  if (ref && !/^dash_[a-z0-9]{6,40}$/.test(ref)) return e.json(400, { error: 'bad ref' });

  /*
   * Whitespace collapsed, control characters out, length clamped.
   *
   * `label` is a post title, a comment body or somebody's display name, all of
   * which end up in a table view where a newline breaks the row and a tab is
   * invisible. Control characters go for the same reason they go out of every
   * other stored string in this project. The slice is last, because collapsing
   * first is what stops a run of spaces eating the budget. Same treatment as
   * `clean` in lib/dash.js, which is where the log row used to be built.
   */
  const clamp = (value, max) =>
    String(value === null || value === undefined ? '' : value)
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max);

  let missing = false;
  let label = '';
  let note = '';
  let failed = '';

  try {
    /*
     * ONE transaction, and every read and write inside it goes through `txApp`.
     *
     * Using `$app` inside the callback would run that statement on a different
     * connection, outside the transaction: it would not see the uncommitted
     * writes, it would not roll back with them, and on SQLite it can sit and
     * wait for the very transaction it is inside to finish. The delete paths are
     * where it matters, because each of them is a counter write and a delete
     * that have to land together or not at all.
     */
    $app.runInTransaction((txApp) => {
      /*
       * A flag flip written as SQL rather than as a record save, so that
       * `updated` does not move.
       *
       * `txApp.save(record)` fires the collection's `updated` autodate, and on
       * these two tables that column is load bearing:
       *
       *  - **`cloud_projects.updated` is the owner's concurrency stamp.** The
       *    editor keeps the last value it saw (`remoteUpdated` in
       *    src/lib/cloud/links.ts) and refuses to save when the server's differs,
       *    on the assumption that another device wrote the project. So hiding a
       *    project or revoking its link would put an "another device changed
       *    this, overwrite?" prompt in front of somebody saving their own work,
       *    over a change they cannot see and did not make. It is also the second
       *    column of `idx_cloud_projects_owner`, which is the order their own
       *    project list is served in, so the row would jump to the top of that
       *    list too.
       *  - **`posts.updated` is what "last edited" means on a post**, and a
       *    moderator hiding one did not edit it.
       *
       * The recount route already avoids exactly this with a raw UPDATE and
       * argues the case there: a repair that changes what the feed looks like is
       * not a repair. Same reasoning, same shape.
       *
       * `comments` and `users` deliberately keep the record path. Nothing on
       * this box sorts or stamps by their `updated`, and `users` carries an
       * `onRecordAfterUpdateSuccess` hook in 050_discover.pb.js that reindexes
       * an author's posts after a rename, which only a real record save fires.
       *
       * The table and column names come from the literals above and nothing a
       * caller sends reaches them; the id and the value are bound. 1 and 0
       * rather than true and false because that is how SQLite holds a PocketBase
       * bool and how every WHERE clause in this file reads one.
       */
      const setFlag = (table, column, on) => {
        txApp
          .db()
          .newQuery(`UPDATE ${table} SET ${column} = {:on} WHERE id = {:id}`)
          .bind({ on: on ? 1 : 0, id: id })
          .execute();
      };

      let record = null;
      try {
        record = txApp.findRecordById(COLLECTIONS[target], id);
      } catch {
        record = null;
      }
      if (!record) {
        // Returning rather than throwing: there is nothing to roll back and a
        // thrown error here would be indistinguishable from a failed write.
        missing = true;
        return;
      }

      if (target === 'post') {
        label = clamp(record.getString('title'), 160);

        if (action === 'hide' || action === 'unhide') {
          setFlag('posts', 'hidden', action === 'hide');
          note =
            action === 'hide'
              ? 'out of every feed, tag count and author page. The row and its images are untouched'
              : 'back in the feed';
        } else if (action === 'feature' || action === 'unfeature') {
          setFlag('posts', 'featured', action === 'feature');
          note =
            action === 'feature'
              ? 'featured, so it carries the badge and the ranking boost'
              : 'no longer featured';
        } else {
          const comments = dash.scalar(
            txApp,
            'SELECT COUNT(*) AS n FROM comments WHERE post = {:id}',
            { id: id },
            0
          );
          const likes = dash.scalar(
            txApp,
            'SELECT COUNT(*) AS n FROM post_likes WHERE post = {:id}',
            { id: id },
            0
          );

          /*
           * The author's post count, decremented and clamped.
           *
           * The cascade removes the comments and the likes as rows and leaves
           * this column exactly where it was, so without these four lines every
           * deletion here quietly adds one to the drift the Integrity page then
           * reports. Clamped at zero because the column is denormalized and one
           * that has already drifted low would otherwise go negative and render
           * as "-1 posts" forever, which is the reasoning `bump` in
           * lib/openscreengen.js carries.
           */
          let before = 0;
          let after = 0;
          let author = null;
          try {
            author = txApp.findRecordById('users', record.getString('author'));
          } catch {
            author = null;
          }
          if (author) {
            before = author.getInt('post_count') || 0;
            after = before > 0 ? before - 1 : 0;
            author.set('post_count', after);
            txApp.save(author);
          }

          txApp.delete(record);
          note = author
            ? `deleted with ${comments} comments and ${likes} likes, the author's post count went from ${before} to ${after}`
            : `deleted with ${comments} comments and ${likes} likes, the author was already gone`;
        }
      } else if (target === 'comment') {
        label = clamp(record.getString('body'), 160);

        if (action === 'hide' || action === 'unhide') {
          record.set('hidden', action === 'hide');
          txApp.save(record);
          note =
            action === 'hide'
              ? 'out of the thread. Nothing was deleted and no counter moved'
              : 'back in the thread';
        } else {
          // The same story one level down: `posts.comments` is a cache of this
          // table and deleting a row here does not touch it.
          let before = 0;
          let after = 0;
          let post = null;
          try {
            post = txApp.findRecordById('posts', record.getString('post'));
          } catch {
            post = null;
          }
          if (post) {
            before = post.getInt('comments') || 0;
            after = before > 0 ? before - 1 : 0;
            post.set('comments', after);
            txApp.save(post);
          }

          txApp.delete(record);
          note = post
            ? `deleted, the post comment count went from ${before} to ${after}`
            : 'deleted, the post it was on was already gone';
        }
      } else if (target === 'account') {
        label = clamp(
          record.getString('display_name') || record.getString('name') || record.getString('email'),
          160
        );

        if (action === 'ban' || action === 'unban') {
          record.set('banned', action === 'ban');
          txApp.save(record);
          /*
           * `banned` is checked on every authenticated request rather than only
           * at sign-in, which is what the accounts migration says and what makes
           * this take effect immediately: a token minted before the flag was set
           * stops working on the next request rather than at expiry.
           */
          note =
            action === 'ban'
              ? 'banned, every token they hold stops working on their next request. Their posts are still in the feed'
              : 'unbanned, their tokens work again';
        } else if (action === 'verify' || action === 'unverify') {
          record.set('verified_badge', action === 'verify');
          txApp.save(record);
          note = action === 'verify' ? 'verified badge on' : 'verified badge off';
        } else {
          const posts = dash.scalar(
            txApp,
            'SELECT COUNT(*) AS n FROM posts WHERE author = {:id}',
            { id: id },
            0
          );
          const comments = dash.scalar(
            txApp,
            'SELECT COUNT(*) AS n FROM comments WHERE author = {:id}',
            { id: id },
            0
          );
          const projects = dash.scalar(
            txApp,
            'SELECT COUNT(*) AS n FROM cloud_projects WHERE owner = {:id}',
            { id: id },
            0
          );

          /*
           * One delete, and the schema does the rest: every relation pointing at
           * `users` is `cascadeDelete: true`, so the posts go with their images,
           * the comments go, the cloud projects go with every uploaded blob, and
           * every like, save and follow in either direction goes.
           *
           * What it cannot do is fix the counters on rows it did not touch. The
           * follows this person made were somebody else's follower count, and
           * the likes they gave were somebody else's like count. Walking them
           * would be an unbounded number of writes inside this transaction, on
           * an account that could have liked ten thousand posts, so it is not
           * done here. The note says so and Recount is the bounded repair.
           */
          txApp.delete(record);
          note =
            `deleted with ${posts} posts, ${comments} comments and ${projects} cloud projects, ` +
            'plus every uploaded file. Their likes and follows went by cascade, so like and follower ' +
            'counts on other rows may now read high. Run Recount to rebuild them';
        }
      } else {
        label = clamp(record.getString('name') || record.getString('project_id'), 160);

        if (action === 'unshare') {
          /*
           * Both halves, and the slug goes rather than being kept.
           *
           * The slug IS the credential: 22 characters of base36 is the entire
           * permission to read that project. Clearing it is what makes a link
           * that has been passed around dead, and the save route mints a new one
           * whenever sharing is turned back on, so revoking is final rather than
           * a pause. Leaving the slug in place while flipping visibility would
           * make an old URL start working again the moment somebody re-shared.
           *
           * Written as SQL for the reason `setFlag` carries: this is the exact
           * action that would otherwise restamp `updated` and hand the owner a
           * false "another device changed this" prompt on their next save.
           */
          txApp
            .db()
            .newQuery(
              "UPDATE cloud_projects SET visibility = 'private', share_slug = '' WHERE id = {:id}"
            )
            .bind({ id: id })
            .execute();
          note = 'link revoked. The slug is cleared, so the URL that was passed around is dead';
        } else if (action === 'hide' || action === 'unhide') {
          setFlag('cloud_projects', 'hidden', action === 'hide');
          note =
            action === 'hide'
              ? 'hidden, the share link stops resolving and the owner still has the project'
              : 'visible again';
        } else {
          const assets = dash.scalar(
            txApp,
            'SELECT COUNT(*) AS n FROM cloud_project_assets WHERE project = {:id}',
            { id: id },
            0
          );
          txApp.delete(record);
          note = `deleted with ${assets} assets and every file they held`;
        }
      }
    });
  } catch (err) {
    console.warn(`openscreengen dash: ${action} on ${target} ${id} failed —`, err);
    failed = 'that could not be done';
  }

  if (missing) return e.json(404, { error: `no such ${target}` });
  // 400 rather than 500 on purpose: the operator can retry this and the client
  // shows the message, where a 500 reads as "the box is broken" for what is
  // usually a row that changed underneath.
  if (failed) return e.json(400, { error: failed });

  /*
   * The audit line, written AFTER the commit and with `$app` rather than
   * `txApp`.
   *
   * Deliberate in both directions: an action that rolled back leaves no line
   * claiming it happened, and a line that cannot be written cannot roll back the
   * action it describes. Wrapped, so it never throws: by the time this runs the
   * post is already hidden or the account is already gone, and an error answered
   * to the browser about something that definitely happened is an error the
   * operator will react to by doing it again. A `mod_log` that is missing costs
   * a warning in the container log and nothing else. The remaining cost is that
   * a process killed between the commit and this call loses the line for an
   * action that landed, which is the right way round to lose one.
   *
   * ## Why the row is built here rather than by `dash.writeLog`
   *
   * One column: `ref`. `dash.writeLog` writes the five fields every caller of it
   * shares, and the recount route below is the other caller and has no ref of
   * its own to write. This one does: `ref` is the idempotency key the browser
   * minted, reused verbatim when the operator retries, and it is the only thing
   * that can tell two identical audit lines a second apart from one action
   * logged twice. Validated for shape above and empty when the client sent none,
   * which is legal and reads as "no ref" rather than as a retry.
   *
   * `target`, `action` and `id` go in unclamped on purpose: `target` and
   * `action` are values out of the ACTIONS table above and `id` has already
   * matched `RECORD_ID_RE`, so all three are known-good literals by this point,
   * while `label` and `note` carry whatever somebody typed into a post.
   */
  try {
    const row = new Record($app.findCollectionByNameOrId('mod_log'));
    row.set('actor', clamp(dash.actor(e), 128));
    row.set('target', target);
    row.set('target_id', id);
    row.set('action', action);
    row.set('label', clamp(label, 160));
    row.set('note', clamp(note, 512));
    row.set('ref', ref);
    $app.save(row);
  } catch (err) {
    console.warn('openscreengen dash: could not write the mod_log row:', err);
  }

  return e.json(200, {
    ok: true,
    target: target,
    id: id,
    action: action,
    note: note,
    label: label,
  });
});

// ---------- POST /api/openscreengen/dash/recount ----------

/**
 * Rebuild the denormalized counters from the join tables.
 *
 * The repair half of the Integrity page. Five counters are caches of four join
 * tables, cascade deletes move the rows and leave the caches, and this is the
 * only thing on the box that puts them back.
 *
 * ## Only the wrong rows are written
 *
 * Every scope is one `UPDATE ... WHERE x != (SELECT COUNT(*) ...)`, so a table
 * where nothing has drifted is a read and no writes at all. That matters more
 * than it looks: `posts.updated` is an autodate that fires on every save, and an
 * UPDATE that rewrote every row with the value it already had would restamp the
 * entire feed and reorder anything sorting by `updated`. A repair that changes
 * what the feed looks like is not a repair.
 *
 * ## Bounded, and it says whether another pass is needed
 *
 * At most 2000 rows across the whole call, 500 per scope by default. A
 * transaction that rewrites a hundred thousand rows holds a write lock on
 * SQLite for as long as it takes, and every feed read on the box waits behind
 * it. So the call does a bounded amount of work and answers with `remaining`,
 * and the page says "run it again" rather than pretending it finished.
 *
 * ## Why the counts are taken twice rather than reading rowsAffected
 *
 * The driver does expose an affected-row count, but its shape has moved between
 * bindings and a wrong read here would report a number of repairs that did not
 * happen, which is worse than no number at all. Counting the drift before and
 * after is two cheap reads, it cannot lie, and `remaining` falls out of the
 * second one for free.
 */
routerAdd('POST', '/api/openscreengen/dash/recount', (e) => {
  const dash = require(`${__hooks}/lib/dash.js`);
  const openscreengen = require(`${__hooks}/lib/openscreengen.js`);

  if (!dash.superuser(e)) return e.json(401, { error: 'superuser only' });

  const body = openscreengen.readBody(e);
  if (!body) return e.json(400, { error: 'unreadable body' });

  /*
   * The five scopes, each as the pair of statements that describes and repairs
   * one counter.
   *
   * The alias in the inner subquery is load bearing. `UPDATE posts SET likes =
   * (...) WHERE id IN (SELECT id FROM posts WHERE ...)` has two `posts` in
   * scope, and an unqualified `posts.id` inside the inner query binds to the
   * INNER one, which turns the correlated count into an uncorrelated one and
   * writes the same number to every row. Aliasing the inner table `p` and the
   * inner join table `l2` makes each reference unambiguous.
   *
   * Hidden rows are counted like any other, because hiding never touched these
   * counters in the first place: `posts.comments` is bumped when a comment is
   * written and decremented when it is deleted, and the hide flag is not part of
   * that arithmetic. Rebuilding to a count that excluded hidden rows would not
   * be a repair, it would be a different definition.
   */
  const SCOPES = {
    post_likes: {
      drift: `SELECT COUNT(*) AS n FROM posts p
               WHERE p.likes != (SELECT COUNT(*) FROM post_likes l WHERE l.post = p.id)`,
      fix: `UPDATE posts SET likes = (SELECT COUNT(*) FROM post_likes l WHERE l.post = posts.id)
             WHERE id IN (SELECT p.id FROM posts p
                           WHERE p.likes != (SELECT COUNT(*) FROM post_likes l2 WHERE l2.post = p.id)
                           LIMIT {:limit})`,
    },
    post_comments: {
      drift: `SELECT COUNT(*) AS n FROM posts p
               WHERE p.comments != (SELECT COUNT(*) FROM comments c WHERE c.post = p.id)`,
      fix: `UPDATE posts SET comments = (SELECT COUNT(*) FROM comments c WHERE c.post = posts.id)
             WHERE id IN (SELECT p.id FROM posts p
                           WHERE p.comments != (SELECT COUNT(*) FROM comments c2 WHERE c2.post = p.id)
                           LIMIT {:limit})`,
    },
    comment_likes: {
      drift: `SELECT COUNT(*) AS n FROM comments c
               WHERE c.likes != (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment = c.id)`,
      fix: `UPDATE comments SET likes = (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment = comments.id)
             WHERE id IN (SELECT c.id FROM comments c
                           WHERE c.likes != (SELECT COUNT(*) FROM comment_likes cl2 WHERE cl2.comment = c.id)
                           LIMIT {:limit})`,
    },
    post_count: {
      drift: `SELECT COUNT(*) AS n FROM users u
               WHERE u.post_count != (SELECT COUNT(*) FROM posts p WHERE p.author = u.id)`,
      fix: `UPDATE users SET post_count = (SELECT COUNT(*) FROM posts p WHERE p.author = users.id)
             WHERE id IN (SELECT u.id FROM users u
                           WHERE u.post_count != (SELECT COUNT(*) FROM posts p2 WHERE p2.author = u.id)
                           LIMIT {:limit})`,
    },
    followers: {
      drift: `SELECT COUNT(*) AS n FROM users u
               WHERE u.followers != (SELECT COUNT(*) FROM follows f WHERE f.author = u.id)`,
      fix: `UPDATE users SET followers = (SELECT COUNT(*) FROM follows f WHERE f.author = users.id)
             WHERE id IN (SELECT u.id FROM users u
                           WHERE u.followers != (SELECT COUNT(*) FROM follows f2 WHERE f2.author = u.id)
                           LIMIT {:limit})`,
    },
  };

  const scope = String(body.scope || '');
  const names = scope === 'all' ? Object.keys(SCOPES) : [scope];
  for (const name of names) {
    if (!SCOPES[name]) return e.json(400, { error: 'that is not something this can recount' });
  }

  // Per scope, and floored at 1 so a client sending 0 does no work rather than
  // silently rebuilding nothing and reporting success.
  const requested = parseInt(body.limit, 10);
  const limit = Math.max(1, Math.min(isFinite(requested) && requested > 0 ? requested : 500, 2000));
  // Across the whole call, which is what actually bounds how long the write lock
  // is held when `scope` is `all`.
  let budget = 2000;

  const fixed = {};
  const remaining = {};

  try {
    $app.runInTransaction((txApp) => {
      for (const name of names) {
        const spec = SCOPES[name];
        const before = dash.scalar(txApp, spec.drift, null, 0);
        const allowance = Math.min(limit, budget);

        if (before > 0 && allowance > 0) {
          try {
            txApp.db().newQuery(spec.fix).bind({ limit: allowance }).execute();
          } catch (err) {
            /*
             * One scope's UPDATE failing must not roll back the four that
             * worked. Caught here rather than letting it reach the transaction
             * wrapper, and the honest consequence is that `fixed` reads 0 for
             * this scope while `remaining` still reports the drift, which is
             * exactly what happened.
             */
            console.warn(`openscreengen dash: recount ${name} could not run —`, err);
          }
        }

        const after = dash.scalar(txApp, spec.drift, null, before);
        fixed[name] = before > after ? before - after : 0;
        remaining[name] = after;
        budget -= fixed[name];
      }
    });
  } catch (err) {
    console.warn('openscreengen dash: recount failed —', err);
    return e.json(400, { error: 'the recount could not be completed' });
  }

  let total = 0;
  let left = 0;
  for (const name of names) {
    total += fixed[name] || 0;
    left += remaining[name] || 0;
  }

  /*
   * One log line for the call rather than one per scope. The row records the
   * scope in `target_id`, so `idx_mod_log_target` groups every recount of a
   * given counter together, which is the question anybody asks of this table:
   * how often has this one drifted.
   */
  dash.writeLog($app, e, {
    target: 'recount',
    target_id: scope,
    action: 'recount',
    label: names.join(' '),
    note: left > 0
      ? `rebuilt ${total} counters, ${left} rows still drift. Run it again`
      : `rebuilt ${total} counters, nothing is drifting now`,
  });

  return e.json(200, { ok: true, fixed: fixed, remaining: remaining });
});

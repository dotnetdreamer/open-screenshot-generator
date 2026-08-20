/**
 * Helpers for the control dashboard's routes.
 *
 * **This file exists because of hook VM isolation.** PocketBase runs each
 * handler registered by a `*.pb.js` file in its OWN VM, so a function declared
 * at the top level of that file is not visible inside the handler: the call
 * throws a ReferenceError at runtime and the route answers a bare 400 with
 * nothing in `docker compose logs` to say why. Every route in
 * `050_discover.pb.js` and `060_projects.pb.js` already carries a `require` on
 * its first line for exactly this reason, and the header of `050_discover.pb.js`
 * records that the file was written the obvious way first and every route in it
 * broke that way.
 *
 * So anything a handler in `100_dash.pb.js` calls has to arrive through
 * `require()`, and this file is not named `*.pb.js` because that suffix is what
 * PocketBase globs for at the top level of `pb_hooks` - a lib named that way
 * would be loaded as a hook and evaluated on its own.
 *
 * Runtime globals - `$app`, `arrayOf`, `DynamicModel`, `Record` - DO reach a
 * required module: `require` loads into the same goja runtime, which is what
 * `lib/openscreengen.js` already depends on. The `app` handle is still passed in
 * explicitly rather than read off `$app`, matching every function in
 * `lib/openscreengen.js`, so nothing here depends on which VM it is called from
 * and so the moderate and recount routes can hand in a transaction's `txApp`
 * instead.
 *
 * ## Why this is a second library rather than more of `lib/openscreengen.js`
 *
 * That file is the app's own vocabulary: it parses settings into the types the
 * feed needs, it clamps text the way the share form does, it decides what a post
 * looks like to a viewer. The dashboard wants none of that. It wants the RAW
 * settings strings, because the operator is editing them and a value the reader
 * has already coerced to a boolean cannot be shown back to them as what they
 * typed. Keeping the two readers separate means a change to the feed's parsing
 * rules cannot silently change what the dashboard displays.
 *
 * See infra/vps/README.md for the operator-facing half.
 */

/** PocketBase record ids are always exactly this. Checked before every lookup. */
const RECORD_ID_RE = /^[a-z0-9]{15}$/;

/**
 * A timestamp in the shape the database stores.
 *
 * PocketBase writes dates as `YYYY-MM-DD HH:MM:SS.sssZ` TEXT, so every window in
 * these routes is a string comparison rather than a date function.
 * Lexicographic order is chronological order for that format, which is the whole
 * trick: `created >= '2026-08-13 00:00:00.000Z'` can use the index on `created`,
 * and `date(created) >= date('now', '-7 days')` cannot.
 */
function pbDate(ms) {
  return new Date(ms).toISOString().replace('T', ' ');
}

/**
 * Superuser, asked two ways and catching both.
 *
 * Deliberately NOT `$apis.requireSuperuserAuth()` as middleware. The name and
 * the shape of that helper have moved between PocketBase versions, and a hook
 * file that throws while the router is being built is a box that does not come
 * up at all - the same failure mode the migrations in this repo are all written
 * to avoid. The worst case here is a 401 on a dashboard; the worst case the
 * other way is the feed, the sign in routes and every cloud project offline.
 *
 * Both probes are wrapped independently so that a version where the first one
 * does not exist still gets the second one tried.
 */
function superuser(e) {
  try {
    if (typeof e.hasSuperuserAuth === 'function' && e.hasSuperuserAuth()) return true;
  } catch {
    // a different shape on this version, fall through to the second probe
  }
  try {
    const auth = e.auth;
    if (auth && auth.collection && auth.collection().name === '_superusers') return true;
  } catch {
    // no auth on the request at all
  }
  return false;
}

/**
 * Who is doing this, for the `mod_log` row that records it.
 *
 * Its own try/catch for the same reason `superuser` has two: the auth record's
 * shape has moved between versions, and a throw in here would cost a moderation
 * action rather than a name. An empty string is therefore a legal answer and
 * means "could not be read", never "nobody sent it" - `superuser` has already
 * refused a request with no auth on it by the time this is called.
 */
function actor(e) {
  try {
    const auth = e.auth;
    if (auth) return String(auth.getString('email') || auth.id || '');
  } catch {
    // a shape this version does not have, which costs a name and nothing else
  }
  return '';
}

/**
 * One number.
 *
 * Wrapped, and that is the design rather than caution: a column a future
 * migration renames must cost ONE tile on ONE panel, not the whole overview. A
 * broken query renders as an honest 0 beside twenty correct figures, and the
 * warning names the SQL.
 *
 * ## NULL is the trap, and it is not "always"
 *
 * `SUM()` over no rows is NULL, not 0, and a NULL scanned into the `n: 0` slot
 * of a `DynamicModel` throws rather than arriving as zero. So every ungrouped
 * aggregate in the routes has to `COALESCE`.
 *
 * **An aggregate with a GROUP BY is safe and one without it is not.** Grouping
 * only emits a row where there was at least one row to group, so a `SUM` or a
 * `MAX` inside a group always has something to chew on. An ungrouped aggregate
 * emits exactly one row no matter what, including one row of nothing, and that
 * is the row where `SUM()` is NULL. `COUNT(*)` is the exception either way: over
 * no rows it is 0.
 *
 * That distinction is worth spelling out because "always COALESCE" is the rule
 * people follow until they are reading a query that plainly does not need it,
 * and then they stop trusting the rule. In the sibling project the one aggregate
 * without a GROUP BY was the only one missing its COALESCE, and it logged
 * `converting NULL to int64 is unsupported` on every lookup of a device that had
 * never been in a room - for as long as it was live.
 *
 * Everything ungrouped in `100_dash.pb.js` therefore COALESCEs, including the
 * grouped ones where it costs nothing, so that the shape is uniform and a reader
 * does not have to work out which kind they are looking at.
 */
function scalar(app, sql, params, fallback) {
  try {
    const row = new DynamicModel({ n: 0 });
    const query = app.db().newQuery(sql);
    if (params) query.bind(params);
    query.one(row);
    return row.n;
  } catch (err) {
    console.warn('openscreengen dash: scalar failed —', sql, err);
    return fallback === undefined ? 0 : fallback;
  }
}

/**
 * Many rows, shaped by `model`. Returns `[]` and warns when the query cannot
 * run, for the reason `scalar` returns a fallback: one panel, not the page.
 *
 * The `model` doubles as the type declaration for the scan. A column that comes
 * back as text has to be declared as `''` and one that comes back as a number as
 * `0`; getting it the wrong way round is where the NULL problem above bites,
 * because a text NULL scans as an empty string and a numeric one throws.
 */
function rows(app, sql, params, model) {
  try {
    const out = arrayOf(new DynamicModel(model));
    const query = app.db().newQuery(sql);
    if (params) query.bind(params);
    query.all(out);
    /*
     * Copied out of the DynamicModel wrappers into plain objects before they
     * leave. Handing the wrappers straight to `e.json` serialises whatever the
     * binding decides to expose rather than the columns that were asked for,
     * which on an auth collection is the difference between a name and a
     * password hash.
     */
    const plain = [];
    for (let i = 0; i < out.length; i++) {
      const item = {};
      for (const key in model) item[key] = out[i][key];
      plain.push(item);
    }
    return plain;
  } catch (err) {
    console.warn('openscreengen dash: rows failed —', sql, err);
    return [];
  }
}

// ---------- settings ----------

let cache = null;
let cachedAt = 0;
/**
 * Short on purpose, and per hook VM.
 *
 * Every handler runs in its own VM and therefore holds its own copy of this
 * module and its own cache, so an edit made in the Settings view can take up to
 * this long to show on a page served by a different route. Fifteen seconds is
 * the compromise: long enough that the Pulse page reloading every minute does
 * not re-read the table on every tile, short enough that an operator who changes
 * a switch and clicks Refresh sees it. `lib/openscreengen.js` uses thirty for
 * the same trade on the app's side.
 */
const CACHE_MS = 15 * 1000;

/**
 * The whole `settings` collection as a plain object of key to string.
 *
 * **Raw strings, deliberately.** `lib/openscreengen.js` has a settings reader
 * already and this is not it: that one coerces each row to the type its
 * `DEFAULTS` entry declares, substitutes the seeded placeholder `unset` for an
 * empty string, and falls back to a working default when a row is missing or
 * unparseable. All three are right for the feed and all three are wrong here.
 * The dashboard shows the operator what is actually in the table, including the
 * typo that is making a limit behave as its default, and a reader that quietly
 * repaired it would hide the one thing worth seeing.
 *
 * A key that is not in the app's `DEFAULTS` is kept rather than dropped, for the
 * same reason: an operator who has typed a row that no hook reads should be able
 * to see that they have.
 *
 * On a read failure the PREVIOUS cache is returned rather than an empty object.
 * A momentarily unreadable table showing slightly stale switch states is better
 * than a Posture strip that reports every switch as missing, which reads as "the
 * feed is off" to somebody scanning it.
 */
function settings(app) {
  const now = Date.now();
  if (cache && now - cachedAt < CACHE_MS) return cache;

  const out = {};
  try {
    const all = app.findAllRecords('settings');
    for (const row of all) {
      const key = row.getString('key');
      if (!key) continue;
      out[key] = row.getString('value') || '';
    }
  } catch (err) {
    console.warn('openscreengen dash: could not read settings —', err);
    return cache || {};
  }

  cache = out;
  cachedAt = now;
  return out;
}

/**
 * One settings row as an integer.
 *
 * Used by the risk route for the four limits it compares against
 * (`max_posts_per_day`, `max_comments_per_hour`, `max_cloud_user_bytes`,
 * `max_cloud_project_bytes`), which have to be the numbers the hooks actually
 * enforce or the findings are noise. A missing, blank or unparseable row falls
 * back to the value passed in, which the caller takes from the same `DEFAULTS`
 * the hooks carry - so an operator who deletes a row sees the box's real
 * behaviour rather than a threshold of zero that flags every account.
 *
 * Negative is refused rather than accepted, because every one of these keys is a
 * ceiling and a negative ceiling would flag the entire table.
 */
function num(app, key, fallback) {
  const raw = settings(app)[key];
  const parsed = parseInt(String(raw === null || raw === undefined ? '' : raw).trim(), 10);
  if (isFinite(parsed) && parsed >= 0) return parsed;
  return fallback;
}

// ---------- the audit line ----------

/**
 * Whitespace collapsed and length clamped, for the two free text columns.
 *
 * `label` is frequently a comment body and `note` is written by the route, but
 * both end up in a table view where a newline breaks the row and a tab is
 * invisible. Control characters go for the same reason they go out of every
 * other stored string in this project. The slice is the last step, because
 * collapsing first is what stops a run of spaces eating the budget.
 */
function clean(value, max) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * Append one row to `mod_log`.
 *
 * **Wrapped, and it never throws.** A failed audit line must not cost the
 * moderation action it describes: by the time this is called the post is already
 * hidden or the account is already gone, and rethrowing here would answer the
 * browser with an error about something that definitely happened. The operator
 * would then do it again. So a failure is a warning in the container log and a
 * `false` return, and the route carries on.
 *
 * Called AFTER the transaction has committed, with `$app` rather than the
 * transaction's `txApp`, and that is deliberate in both directions: an action
 * that rolled back leaves no line claiming it happened, and a line that cannot
 * be written cannot roll back the action. The cost is that a process killed
 * between the commit and this call loses the line for an action that landed,
 * which is the right way round to lose one.
 *
 * `entry` is `{ target, target_id, action, label, note }`. `target` is a select
 * column, so a value outside the migration's list is refused by the collection
 * and lands here as a caught warning - which is why the route validates the
 * target before it does the work rather than trusting this to notice.
 */
function writeLog(app, e, entry) {
  try {
    const row = new Record(app.findCollectionByNameOrId('mod_log'));
    row.set('actor', clean(actor(e), 128));
    row.set('target', clean(entry && entry.target, 40));
    row.set('target_id', clean(entry && entry.target_id, 40));
    row.set('action', clean(entry && entry.action, 40));
    row.set('label', clean(entry && entry.label, 160));
    row.set('note', clean(entry && entry.note, 512));
    app.save(row);
    return true;
  } catch (err) {
    console.warn('openscreengen dash: could not write the mod_log row —', err);
    return false;
  }
}

module.exports = {
  RECORD_ID_RE,
  pbDate,
  superuser,
  actor,
  scalar,
  rows,
  settings,
  num,
  writeLog,
};

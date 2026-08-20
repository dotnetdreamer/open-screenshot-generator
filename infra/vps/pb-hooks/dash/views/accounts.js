/**
 * Accounts — every person on the box, what they have made, and what state they
 * are in.
 *
 * ## What this page is for
 *
 * The Feed answers "what is in front of users", the Integrity page answers "what
 * is wrong with the numbers", and this one answers "who are these people". It is
 * the page an operator lands on with a name or a handle in their hand, from a
 * support mail or from a report, and it has to end with the account drawer open
 * on the right row in as few gestures as possible. Everything below serves that:
 * the search box, the six filters, the three sortable columns and the row click.
 *
 * ## Two data paths, on purpose
 *
 * BROWSE mode is the record API: PocketBase filters, sorts and pages the `users`
 * collection and this file renders whatever came back. That is the mode that has
 * a real total and a real pager.
 *
 * SEARCH mode is the `dash/search` route. It is used rather than a hand rolled
 * `name ~ "..."` filter for one reason that matters: the needle is text an
 * operator typed, and building a PocketBase filter string out of it means
 * escaping quotes, `%`, `_` and backslashes correctly in the browser, forever.
 * The route already does that server side with an `ESCAPE '\'` clause, so the
 * typed text never becomes part of a filter expression here at all. The cost is
 * that search answers at most 20 accounts and has no paging, and the page says
 * so rather than pretending the twentieth row is the last account on the box.
 *
 * ## Why search results get a second request
 *
 * The search route's account rows carry
 * `id,name,handle,email,avatar,banned,verified_badge,post_count,followers,created`
 * and no provider keys, so a table rendered straight off them would have to
 * either drop the Provider column in search mode or guess at it. Guessing is the
 * dangerous half: an account with a Google key would render as "no provider",
 * which is exactly the sort of thing somebody screenshots into a bug report. So
 * the hits are re-read from the record API by id, in ONE call, and any row that
 * did not come back is rendered with the provider cell reading "unknown" instead
 * of a lie. See `hydrated` below.
 *
 * ## The Projects column is a page scoped join
 *
 * There is no `project_count` column on `users`, and there is no route that
 * returns one per account. It is counted the way `players.js` in the Ludo
 * dashboard counts wallets: one extra list call per PAGE with an OR chain over
 * the ids on screen, so fifty accounts cost two requests rather than fifty one.
 * That has a ceiling, and the ceiling is honest on screen: see PROJECT_JOIN_CAP.
 *
 * ## The one label that must never be wrong
 *
 * `verified_badge` is the badge the app draws beside a name. PocketBase's own
 * `verified` column on an auth collection means "this email address was
 * confirmed" and is a completely different fact that nothing on this box uses.
 * They are one keystroke apart in the schema and one word apart on screen, so
 * this page never says "verified email" and never says a bare "verified": the
 * chip, the filter and the bulk action all say "badge".
 *
 * ## Banning is not deleting
 *
 * The two live in different places on purpose. A ban is here, on a row and in
 * the bulk bar, because it is reversible: it sets one boolean, the account's
 * token stops working on its next request rather than at expiry, and every post,
 * comment, like, follow and cloud project it owns stays exactly where it is. A
 * delete is NOT here. It lives one click further in, in the account drawer,
 * because it takes the posts, the comments, the likes, the follows, the projects
 * and every uploaded blob with it and leaves counters on other people's rows
 * reading high. A bulk delete button on a table of fifty ticked rows is a
 * mistake waiting for a tired afternoon, so there is not one.
 */

import * as pb from '../pb.js';
import {
  esc,
  n,
  ago,
  stamp,
  dayStamp,
  avatar,
  nameOf,
  handleOf,
  chip,
  emptyState,
  errorState,
  skeleton,
  toast,
  confirmAction,
  newRef,
} from '../ui.js';

/** Rows per page in browse mode. Fifty is what the record API pages happily. */
const PER_PAGE = 50;

/** Under this many characters the search route answers empty, so do not call it. */
const SEARCH_MIN = 2;

/**
 * How many `cloud_projects` rows the per page join will pull.
 *
 * PocketBase clamps `perPage` at 500 anyway, so this is the real ceiling rather
 * than a preference. Fifty accounts who between them own more than 500 projects
 * would produce counts that are a floor, and the page says so under the table
 * rather than showing a wrong number silently. That case does not exist on any
 * box this dashboard has been pointed at yet, but the day it does, the operator
 * should read "these are a floor" instead of quietly trusting a five.
 */
const PROJECT_JOIN_CAP = 500;

/** Exactly the columns this table draws. Never `*` on an auth collection. */
const LIST_FIELDS =
  'id,name,display_name,handle,email,avatar,banned,verified_badge,followers,post_count,google_sub,github_id,created';

/** How many columns the table has, for the `colspan` on every full width cell. */
const COLUMNS = 10;

/**
 * `user = "a" || user = "b" || …` — how you say `IN` in a PocketBase filter.
 *
 * The ids are re-checked against the record id shape before they are pasted into
 * the expression even though every one of them came from this same box seconds
 * earlier. That is not distrust of the server, it is the rule that a string
 * going into an expression gets validated at the point it goes in: the day
 * somebody calls this with an id typed into a box, the check is already here.
 */
const RECORD_ID_RE = /^[a-z0-9]{15}$/;
const orIds = (field, ids) =>
  ids
    .filter((id) => RECORD_ID_RE.test(String(id || '')))
    .map((id) => `${field} = "${id}"`)
    .join(' || ');

/**
 * The six filters, as ONE table with both halves of each rule in it.
 *
 * `filter` is the PocketBase expression browse mode sends to the server.
 * `test` is the same rule expressed in JavaScript, used only in search mode
 * where the rows arrive from the search route already chosen and the server
 * cannot narrow them.
 *
 * The two halves have to say the same thing, which is precisely why they are
 * written side by side here rather than in two places three hundred lines apart.
 * Change one, change the other, and the pair is readable as a pair in review.
 *
 * `test` takes the row, whether that row was hydrated from the record API, and
 * the page's project counts, because two of the six rules can be UNANSWERABLE
 * rather than false and both of them then keep the row.
 *
 * 'unlinked' cannot be answered from a search hit: the search route does not
 * return the provider keys, so `!row.google_sub` there means "not asked", not
 * "not linked". 'projects' cannot be answered when the per page join failed,
 * for the same shape of reason. In both cases the row stays. Showing a row that
 * might not match is a small annoyance; hiding the account somebody is looking
 * for is the failure that matters.
 *
 * 'projects' leans on PocketBase's back relation filter,
 * `cloud_projects_via_owner.id != ""`, which is exact and costs the server one
 * join. Verified against the fixture box: it answers the same 8 accounts that
 * `stats.accounts.with_projects` counts with `COUNT(DISTINCT owner)`.
 */
const FILTERS = [
  {
    value: '',
    label: 'All',
    filter: '',
    test: () => true,
    empty: {
      title: 'No accounts yet',
      note: 'An account appears here the first time somebody signs in with Google or GitHub in the app',
    },
  },
  {
    value: 'banned',
    label: 'Banned',
    filter: 'banned = true',
    test: (row) => !!row.banned,
    empty: {
      title: 'Nobody is banned',
      note: 'Ticking rows here and pressing Ban puts them in this list, and a ban can be lifted again from the same place',
    },
  },
  {
    value: 'badge',
    label: 'Badge',
    filter: 'verified_badge = true',
    test: (row) => !!row.verified_badge,
    empty: {
      title: 'Nobody carries the badge',
      note: 'The badge is the mark the app draws beside a name, and it is given from this page or from the account drawer',
    },
  },
  {
    value: 'posts',
    label: 'Has posts',
    filter: 'post_count > 0',
    test: (row) => Number(row.post_count || 0) > 0,
    empty: {
      title: 'Nobody has posted',
      note: 'This reads the stored post count on the account, which the Integrity page checks against the posts themselves',
    },
  },
  {
    value: 'projects',
    label: 'Has projects',
    filter: 'cloud_projects_via_owner.id != ""',
    test: (row, known, ctx) => (ctx.failed ? true : (ctx.projects.get(row.id) || 0) > 0),
    empty: {
      title: 'Nobody has saved a cloud project',
      note: 'A project lands here when somebody turns on cloud saving in the app and their editor uploads a document',
    },
  },
  {
    value: 'unlinked',
    label: 'No provider',
    filter: 'google_sub = "" && github_id = ""',
    test: (row, known) => (known ? !row.google_sub && !row.github_id : true),
    empty: {
      title: 'Every account has a provider linked',
      note: 'An account with neither Google nor GitHub is usually one made by hand in the PocketBase admin, which is worth knowing rather than worth fixing',
    },
  },
];

/**
 * The sortable columns, and the reason there are only three.
 *
 * Posts and Followers are the two numeric columns the record API can order by,
 * and Joined is the default because a list of people is nearly always read
 * newest first. Projects is deliberately NOT sortable: it is counted in the
 * browser from a per page join, so sorting by it would sort the fifty rows that
 * happened to be on screen and call the result "the accounts with the most
 * projects", which is a different and much more confident sentence than the data
 * supports. Storage is the page that answers that question properly.
 *
 * `id` is appended to every server sort as a tiebreaker. Without it, two
 * accounts with the same post count can swap places between page 1 and page 2 of
 * the same query and a row is either shown twice or never, which is the classic
 * unstable pagination bug and it is free to avoid.
 */
const SORTS = {
  created: { label: 'Joined', column: 'created' },
  post_count: { label: 'Posts', column: 'post_count' },
  followers: { label: 'Followers', column: 'followers' },
};

/**
 * The bulk actions, and the sentence each one shows before it runs.
 *
 * Every body here is written to answer "and what does that actually do to them",
 * because the four verbs are not equally reversible and the operator should not
 * have to remember which is which. The ban copy in particular exists to draw the
 * line between this page and the delete that lives in the drawer.
 *
 * `body` is HTML and `confirmAction` does NOT escape it, so anything from the
 * wire that goes in is escaped at the call site. The names are.
 *
 * `running` is the word the progress line uses while the loop is going and
 * `past` is the word the summary uses afterwards. They live beside each other
 * here for the reason `feed.js` gives for the same table: a button that says
 * Remove badge over a progress line that says "unverifying" over a toast that
 * says "unstarred" is three names for one write, and the operator ends up
 * unsure which of them actually ran.
 */
const BULK = {
  ban: {
    label: 'Ban',
    confirmLabel: 'Ban',
    danger: true,
    past: 'banned',
    running: 'Banning',
    title: (count) => `Ban ${count} account${count === 1 ? '' : 's'}?`,
    body:
      '<p>A ban is reversible and it is not a delete. Every token these accounts hold stops working ' +
      'on their next request, so they are signed out of the app straight away.</p>' +
      '<p>Their posts, comments, likes, follows and cloud projects all stay exactly where they are. ' +
      'Nothing is removed from the feed by this</p>',
  },
  unban: {
    label: 'Unban',
    confirmLabel: 'Unban',
    danger: false,
    past: 'unbanned',
    running: 'Unbanning',
    title: (count) => `Unban ${count} account${count === 1 ? '' : 's'}?`,
    body: '<p>Their tokens start working again on the next request and they can sign back in</p>',
  },
  verify: {
    label: 'Verify badge',
    confirmLabel: 'Give the badge',
    danger: false,
    past: 'given the badge',
    running: 'Giving the badge to',
    title: (count) => `Give the badge to ${count} account${count === 1 ? '' : 's'}?`,
    body:
      '<p>This is the badge the app draws beside a name in the feed. It is not the email verified ' +
      'column, which nothing on this box reads</p>',
  },
  unverify: {
    label: 'Remove badge',
    confirmLabel: 'Remove the badge',
    danger: true,
    past: 'had the badge removed',
    running: 'Removing the badge from',
    title: (count) => `Remove the badge from ${count} account${count === 1 ? '' : 's'}?`,
    body: '<p>The mark beside their name in the feed goes. Nothing else about the account changes</p>',
  },
};

/** How many names the confirm lists before it starts counting instead. */
const NAMES_IN_CONFIRM = 8;

export async function render(root) {
  /*
   * Every piece of view state lives in this closure, which is what makes leaving
   * the page and coming back a clean slate. That is deliberate for `picked`
   * above all: a set of ticked rows that survived a navigation would be a set of
   * accounts somebody is about to ban without having looked at them.
   */
  let page = 1;
  let total = 0;
  let query = '';
  let only = '';
  let sortKey = 'created';
  let sortDir = -1;

  /** The rows currently painted, and how they were obtained. */
  let items = [];
  /** id to project count, for the rows on screen only. */
  let projects = new Map();
  /** ids whose full record came back, so the Provider cell can be trusted. */
  let hydrated = new Set();
  /** True when the project join hit its cap, so the counts are a floor. */
  let projectsPartial = false;
  /** True when the project join failed outright, so the counts are not counts. */
  let projectsFailed = false;
  /** True while a bulk run is in flight, so the bar cannot be fired twice. */
  let busy = false;

  /**
   * Ticked rows, id to name.
   *
   * The name rides along so the confirm can say who is about to be banned
   * without a second fetch, and so a tick made before a filter change still has
   * a name after the row itself has left the table.
   *
   * There is no "select everything matching this filter" anywhere on this page,
   * and the header tick reaches the rows on screen and no further. A filter is a
   * query and a ban is a decision, and the two must not be the same gesture.
   */
  const picked = new Map();

  /*
   * Guards a slow response from painting over a fast one. An operator typing in
   * the search box fires a request per keystroke burst, and the network does not
   * promise to answer them in order: without this, "mar" can land after "marina"
   * and the table shows results for a query that is no longer in the box.
   */
  let loadToken = 0;

  /** Which account the drawer is open on, so its row can be marked. */
  let openId = '';

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Accounts</h2>
        <div class="sub">Who has signed up, what they have made, and which of them are banned or carry the badge</div>
      </div>
      <div class="page-tools"><span class="muted tiny" id="accounts-total" role="status"></span></div>
    </div>

    <div class="filter-row">
      <input id="accounts-q" type="search" placeholder="Name, handle or email" spellcheck="false"
        autocapitalize="off" autocorrect="off" aria-label="Search accounts" />
      <div class="segmented" data-filter="only" role="group" aria-label="Filter accounts">
        ${FILTERS.map(
          (entry, i) =>
            `<button type="button" data-value="${esc(entry.value)}" aria-pressed="${i === 0}">${esc(entry.label)}</button>`
        ).join('')}
      </div>
    </div>

    <div class="bulk-bar" id="accounts-bulk" hidden role="group" aria-label="Actions on the selected accounts">
      <span><strong id="accounts-bulk-count">0</strong> selected</span>
      <span class="muted tiny">Deleting an account is in the drawer, not here</span>
      <span class="tiny" id="accounts-bulk-progress" hidden></span>
      <span class="spacer"></span>
      <button class="btn btn-sm" data-bulk="clear" type="button">Clear</button>
      <button class="btn btn-sm" data-bulk="unban" type="button">Unban</button>
      <button class="btn btn-sm" data-bulk="verify" type="button">Verify badge</button>
      <button class="btn btn-sm" data-bulk="unverify" type="button">Remove badge</button>
      <button class="btn btn-sm btn-danger" data-bulk="ban" type="button">Ban</button>
    </div>

    <div class="card">
      <div class="table-wrap"><table class="data">
        <thead><tr>
          <th class="check"><input type="checkbox" data-pick-page aria-label="Select the accounts on this page" /></th>
          <th>Account</th>
          <th>Handle</th>
          <th>Email</th>
          <th>Provider</th>
          <th class="num sortable" data-sort="post_count" tabindex="0" role="columnheader" aria-sort="none"
            title="The post count stored on the account row">Posts<span class="arrow" aria-hidden="true"></span></th>
          <th class="num sortable" data-sort="followers" tabindex="0" role="columnheader" aria-sort="none"
            title="The follower count stored on the account row">Followers<span class="arrow" aria-hidden="true"></span></th>
          <th class="num" title="Cloud projects owned, counted for the accounts on this page only">Projects</th>
          <th class="sortable" data-sort="created" tabindex="0" role="columnheader" aria-sort="none">Joined<span class="arrow" aria-hidden="true"></span></th>
          <th>Status</th>
        </tr></thead>
        <tbody id="accounts-body"></tbody>
      </table></div>
      <div class="card-body" style="--card-body-top:0">
        <div class="pager" id="accounts-pager"></div>
        <p class="muted tiny" id="accounts-note" hidden></p>
      </div>
    </div>`;

  const card = root.querySelector('.card');
  const body = root.querySelector('#accounts-body');
  const bulk = root.querySelector('#accounts-bulk');
  const note = root.querySelector('#accounts-note');

  /*
   * The rest of what this view writes into, held once rather than looked up on
   * every paint.
   *
   * That is the second half of the crash fix described on `mounted` below: once
   * the shell has emptied `#view` these `root.querySelector` calls all answer
   * null, and a `.textContent =` on null throws. A reference captured while the
   * markup was still on the page goes on pointing at a real object after it is
   * detached, so a late write lands nowhere quietly instead of taking the
   * handler down with it.
   */
  const totalLabel = root.querySelector('#accounts-total');
  const pagerHost = root.querySelector('#accounts-pager');
  const bulkCount = root.querySelector('#accounts-bulk-count');
  const bulkProgress = root.querySelector('#accounts-bulk-progress');
  const pageTick = root.querySelector('[data-pick-page]');

  /**
   * Is this view still the one on screen, with a session still behind it.
   *
   * THE BUG. Signing out while the first page was still in the air threw
   * `Cannot set properties of null` out of the catch in `load` below, on
   * the `#accounts-total` line. Reproduced every time on the fixture box:
   * open Accounts cold, press Sign out before it paints. `loadToken` could
   * not stop it and never could: it is flipped by the cleanup the router
   * calls, and on a FIRST load `render()` has not returned that cleanup
   * yet, so the shell has nothing to call. `endSession()` emptied `#view`
   * regardless, and the handler then wrote into markup that no longer
   * existed.
   *
   * `app.js` now holds that emptying back until the in-flight render has
   * settled, which is the half of the fix that removes the null: the markup is
   * still there to be written into. This is the other half, and it answers what
   * the shell cannot answer from outside: an answer that lands after the session
   * has ended must not go on painting a page behind the sign-in gate, and above
   * all must not push a number into a rail badge the shell has just cleared.
   * Measured before this: sign out during a cold Comments load and the rail came
   * back reading 13 over the top of the gate.
   *
   * Two conditions, because they fail in different situations.
   *
   * `mark` is the first element this view put into `#view`, so it stops being
   * connected the moment the shell empties or refills `#view`: a navigation, the
   * Refresh button, or that deferred clear once it finally runs. It cannot be
   * `root.isConnected`, because `root` IS `#view`, and `#view` survives being
   * emptied perfectly happily. That is the trap the original guard fell into.
   *
   * `pb.auth.token` is the session itself. It is empty the instant somebody
   * signs out, and `pb.js` turns a 401 into the same call, so one read covers
   * both ways a session can end. It is read rather than taken as a flag handed
   * over by the shell because it is the one piece of state both sides already
   * share, and `app.js` guards its own badge refresh with exactly this.
   */
  // Taken AFTER the markup above is written, never before: `root` IS `#view`,
  // and until that assignment runs it is still holding the router's loading
  // skeleton. A reference from any earlier would point at an element this view
  // is about to detach, and `mounted()` would then answer false for the whole
  // life of the page. Two of the six views in this directory were written that
  // way by accident and painted nothing at all.
  const mark = root.firstElementChild;
  const mounted = () => !!mark && mark.isConnected && !!pb.auth.token;

  // ------------------------------------------------------------- loading ---

  /**
   * Fetch whatever the current mode asks for and paint it.
   *
   * `is-stale` rather than a skeleton on a refetch. The first load has nothing
   * to hold, so it gets the skeleton; every load after it already has a table on
   * screen and replacing that with placeholder bars on every filter click is a
   * page that flickers its way through a working session. Dimming the real rows
   * says "this is the previous answer, a new one is coming" and keeps the layout
   * still.
   */
  async function load() {
    const token = ++loadToken;
    if (!items.length) body.innerHTML = `<tr><td colspan="${COLUMNS}">${skeleton('rows', 8)}</td></tr>`;
    card.classList.add('is-stale');

    try {
      const searching = query.length >= SEARCH_MIN;
      const page1 = searching ? await loadSearch() : await loadBrowse();
      if (token !== loadToken) return;

      items = page1.items;
      hydrated = page1.hydrated;
      total = page1.total;

      // The project join runs after the rows are known, because it needs their
      // ids. One request for the whole page, never one per row.
      const counts = await countProjects(items.map((row) => row.id));
      if (token !== loadToken) return;
      projects = counts.byOwner;
      projectsPartial = counts.partial;
      projectsFailed = counts.failed;

      paint(searching);
    } catch (err) {
      if (token !== loadToken || !mounted()) return;
      /*
       * The message goes on screen, not to the console. `errorState` prints what
       * `pb.js` put in `message`, which for a hook route is the sentence the
       * route wrote, and for a 404 is "no such account". A card that said
       * "something went wrong" would cost somebody a trip to devtools to find
       * out that a column was renamed.
       */
      items = [];
      body.innerHTML = `<tr><td colspan="${COLUMNS}">${errorState('Could not load accounts', err)}</td></tr>`;
      // Held references, and still checked. `mounted()` has just answered yes,
      // but the one handler whose job is to report an error must not be the one
      // that throws a second one on top of it.
      if (totalLabel) totalLabel.textContent = '';
      if (pagerHost) pagerHost.innerHTML = '';
      note.hidden = true;
    } finally {
      if (token === loadToken) card.classList.remove('is-stale');
    }
  }

  /** Browse mode: the record API filters, sorts and pages for us. */
  async function loadBrowse() {
    const chosen = FILTERS.find((entry) => entry.value === only) || FILTERS[0];
    const column = (SORTS[sortKey] || SORTS.created).column;
    const result = await pb.list('users', {
      page,
      perPage: PER_PAGE,
      sort: `${sortDir < 0 ? '-' : ''}${column},id`,
      filter: chosen.filter,
      fields: LIST_FIELDS,
    });
    const rows = result.items || [];
    // Everything here came from the record API, so every provider cell is real.
    return { items: rows, total: result.totalItems, hydrated: new Set(rows.map((row) => row.id)) };
  }

  /**
   * Search mode: the route picks the rows, the record API fills them in, and
   * the filter and the sort are applied here because the server cannot.
   *
   * The route's order is relevance and it is thrown away by the sort, which is
   * the right trade: an operator who has clicked a column header has said what
   * order they want more recently than they said what they were looking for.
   */
  async function loadSearch() {
    const found = await pb.search(query);
    const hits = found.accounts || [];
    if (!hits.length) return { items: [], total: 0, hydrated: new Set() };

    const ids = hits.map((row) => row.id);
    const full = await pb.list('users', {
      perPage: Math.max(1, ids.length),
      filter: orIds('id', ids),
      fields: LIST_FIELDS,
      skipTotal: true,
    });
    const byId = new Map((full.items || []).map((row) => [row.id, row]));

    // The search hit is the fallback rather than a dropped row. An account that
    // vanished between the two calls, or one the record API declined to return,
    // is still worth showing with the columns we do have.
    const rows = hits.map((hit) => byId.get(hit.id) || hit);
    return { items: rows, total: rows.length, hydrated: new Set(byId.keys()) };
  }

  /**
   * Cloud projects owned by the accounts on screen, counted in the browser.
   *
   * `fields: 'owner'` is doing real work here: a `cloud_projects` row carries a
   * file handle, byte counters, a share slug and a name, and this needs one 15
   * character column from each. Without it a page of fifty accounts who own two
   * hundred projects between them pulls a few hundred kilobytes to produce
   * eight small numbers.
   */
  async function countProjects(ids) {
    const byOwner = new Map();
    const filter = orIds('owner', ids);
    if (!filter) return { byOwner, partial: false, failed: false };

    try {
      const result = await pb.list('cloud_projects', {
        perPage: PROJECT_JOIN_CAP,
        filter,
        fields: 'owner',
      });
      const rows = result.items || [];
      rows.forEach((row) => byOwner.set(row.owner, (byOwner.get(row.owner) || 0) + 1));
      return { byOwner, partial: result.totalItems > rows.length, failed: false };
    } catch (err) {
      /*
       * Swallowed on purpose, because this is one column on a table whose
       * subject is accounts: a failure counting projects must cost the Projects
       * column and nothing else, certainly not the twelve rows that already
       * loaded fine.
       *
       * What it must not do is answer zero. An empty map and a failed request
       * are indistinguishable to the renderer, and "0 projects" for every row on
       * the page is a confident wrong answer where "not counted" is a true one.
       * That is what the flag is for.
       */
      console.warn('accounts: could not count cloud projects for this page', err);
      return { byOwner, partial: false, failed: true };
    }
  }

  // ------------------------------------------------------------ painting ---

  function paint(searching) {
    const chosen = FILTERS.find((entry) => entry.value === only) || FILTERS[0];

    /*
     * In browse mode the server already applied the filter and the sort. In
     * search mode neither has happened yet, so both are applied here, over at
     * most twenty rows.
     */
    const ctx = { projects, failed: projectsFailed };
    const rows = searching
      ? sortRows(items.filter((row) => chosen.test(row, hydrated.has(row.id), ctx)))
      : items;

    if (!rows.length) {
      const copy = searching
        ? { title: 'Nothing matched', note: 'Search looks at the name, the handle and the email address, and it wants at least two characters' }
        : chosen.empty;
      body.innerHTML = `<tr><td colspan="${COLUMNS}">${emptyState(copy.title, copy.note)}</td></tr>`;
    } else {
      body.innerHTML = rows.map(rowHtml).join('');
    }

    paintTotal(searching, rows.length);
    paintPager(searching);
    paintSort();
    paintBulk();
    markOpenRow();

    note.hidden = !projectsPartial;
    if (projectsPartial) {
      note.textContent =
        'These accounts own more cloud projects than one page can count, so the Projects column is a floor. Storage has the real totals';
    }
  }

  /** One table row. Everything interpolated here came off the wire. */
  function rowHtml(row) {
    const name = nameOf(row);
    const handle = handleOf(row);
    const known = hydrated.has(row.id);
    const owned = projects.get(row.id);

    const providers = [];
    if (row.google_sub) providers.push(chip('Google'));
    if (row.github_id) providers.push(chip('GitHub'));

    /*
     * Three states in this cell, and the third is the one worth getting right.
     * A hydrated row with neither key really has no provider, which is a legacy
     * row or one made in the admin. A row we could not hydrate simply was not
     * asked, and saying "no provider" for it would be a claim this page cannot
     * back up.
     */
    const providerCell = providers.length
      ? `<span class="chip-row">${providers.join('')}</span>`
      : known
        ? `<span title="Neither a Google nor a GitHub key is stored on this row, which usually means it was made by hand in the PocketBase admin">${chip(
            'no provider',
            'warn'
          )}</span>`
        : '<span class="muted tiny" title="This row came from the search route, which does not return the provider keys">unknown</span>';

    const status = [
      row.banned ? chip('banned', 'bad') : '',
      row.verified_badge ? chip('badge', 'good') : '',
    ].filter(Boolean);

    /*
     * A focusable row needs a role and a name, and until this it had neither.
     *
     * THE BUG. `tr.clickable` carried `tabindex="0"` and a click handler and
     * nothing else, so a screen reader announced it as "row" and then read the
     * whole concatenated line, avatar alt and all, as its accessible name.
     * Nothing said the row could be activated, and Space did what Space does on
     * any unclaimed element, which is scroll the page.
     *
     * `tags.js` had already solved this on the same kind of element: `role=link`
     * plus a real `aria-label`, with Enter and Space both wired. This is that
     * pattern. `link` and not `button` because that is what it does: it changes
     * the URL to `#/account/<id>`, which is a real address somebody can paste.
     * `link` is also not one of the roles whose children are presentational, so
     * the checkbox in the first cell stays reachable inside it.
     *
     * The label leads with the identity and ends with what pressing it does,
     * because a screen reader user tabbing a fifty row table hears the first
     * words of fifty labels and needs those words to be the name.
     */
    const marks = [row.banned ? 'banned' : '', row.verified_badge ? 'badge' : ''].filter(Boolean).join(', ');
    const rowLabel = `${name}${handle ? `, ${handle}` : ''}${marks ? `, ${marks}` : ''}. Opens the account drawer`;

    return `<tr class="clickable" data-account="${esc(row.id)}" tabindex="0" role="link"
      aria-label="${esc(rowLabel)}">
      <td class="check" data-pick-cell>
        <input type="checkbox" data-pick="${esc(row.id)}" data-pick-name="${esc(name)}"
          ${picked.has(row.id) ? 'checked' : ''} aria-label="Select ${esc(name)}" />
      </td>
      <td>
        <div class="identity">
          ${avatar(row, 'sm', pb.auth.url)}
          <span class="truncate" style="--truncate-cap:190px">${esc(name)}</span>
        </div>
      </td>
      <td class="tiny">${handle ? `<span class="code-tag">${esc(handle)}</span>` : '<span class="muted">no handle</span>'}</td>
      <td class="tiny truncate" style="--truncate-cap:210px" title="${esc(row.email || '')}">${esc(row.email || '')}</td>
      <td>${providerCell}</td>
      <td class="num">${n(row.post_count || 0)}</td>
      <td class="num">${n(row.followers || 0)}</td>
      <td class="num">${projectsFailed ? '<span class="muted tiny">not counted</span>' : n(owned || 0)}</td>
      <td class="nowrap tiny" title="${esc(stamp(row.created))}">
        ${esc(dayStamp(row.created))}
        <div class="muted tiny">${esc(ago(row.created))}</div>
      </td>
      <td>${status.length ? `<span class="chip-row">${status.join('')}</span>` : '<span class="muted tiny">none</span>'}</td>
    </tr>`;
  }

  /**
   * The count beside the page title.
   *
   * Browse mode has a real total from the record API. Search mode has "how many
   * came back", which is a different fact and is labelled as one: twenty results
   * out of a route that caps at twenty means there are probably more, and a bare
   * "20 accounts" there would read as the whole answer.
   */
  function paintTotal(searching, shown) {
    const label = searching
      ? `${n(shown)} of at most 20 matches`
      : `${n(total)} account${total === 1 ? '' : 's'}`;
    /*
     * `#accounts-total` carries `role="status"`, which makes it a polite live
     * region. Until it did, this page changed its answer in silence: typing in
     * the search box took fourteen rows down to one and nothing announced it,
     * and neither did pressing one of the six filters. `tags.js` had already
     * settled the pattern with its coverage line, so this is that pattern
     * rather than a second one. Polite and not assertive, because a row count
     * is not an emergency and should wait for a gap.
     */
    if (totalLabel) totalLabel.textContent = label;
  }

  function paintPager(searching) {
    if (searching) {
      // No pager, and a sentence saying why rather than an empty strip that
      // looks like the end of the list.
      pagerHost.innerHTML =
        '<span class="muted">Search shows the closest 20 accounts. Clear the box to page through all of them</span>';
      return;
    }
    const pages = Math.max(1, Math.ceil(total / PER_PAGE));
    pagerHost.innerHTML = `
      <button class="btn btn-sm" data-page="prev" type="button" ${page <= 1 ? 'disabled' : ''}>Previous</button>
      <span>Page ${n(page)} of ${n(pages)}</span>
      <button class="btn btn-sm" data-page="next" type="button" ${page >= pages ? 'disabled' : ''}>Next</button>
      <span class="spacer"></span><span>${n(total)} rows</span>`;
  }

  /**
   * The arrow and the `aria-sort` on the three sortable headers.
   *
   * `aria-sort` is not decoration: a screen reader announces a column header
   * with no sort state as an ordinary header, so an operator who cannot see the
   * arrow has no way to tell which column the table is ordered by, or that the
   * headers do anything at all.
   */
  function paintSort() {
    root.querySelectorAll('[data-sort]').forEach((th) => {
      const active = th.dataset.sort === sortKey;
      th.setAttribute('aria-sort', active ? (sortDir < 0 ? 'descending' : 'ascending') : 'none');
      const arrow = th.querySelector('.arrow');
      if (arrow) arrow.textContent = active ? (sortDir < 0 ? '↓' : '↑') : '';
    });
  }

  /**
   * Search mode's sort, which has to match what the server does in browse mode.
   *
   * `created` compares as a string. PocketBase stores it as
   * `2026-08-20 11:15:30.735Z`, a fixed width format whose lexical order IS its
   * chronological order, so parsing every row into a Date to compare two of them
   * would be work for the same answer.
   */
  function sortRows(rows) {
    const column = (SORTS[sortKey] || SORTS.created).column;
    return [...rows].sort((a, b) => {
      const left = column === 'created' ? String(a[column] || '') : Number(a[column] || 0);
      const right = column === 'created' ? String(b[column] || '') : Number(b[column] || 0);
      if (left < right) return -sortDir;
      if (left > right) return sortDir;
      // The same tiebreaker the server sort uses, for the same reason.
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }

  /**
   * The bulk bar, and the header tick's three states.
   *
   * `hidden` as a property rather than a class, because `[hidden]` is what every
   * visibility toggle in this dashboard rests on. `indeterminate` is the state
   * that matters: with two of fifty ticked, a header box reading "checked" would
   * invite a click that unticked them both.
   */
  function paintBulk() {
    bulkCount.textContent = n(picked.size);
    bulk.hidden = picked.size === 0;

    const boxes = [...root.querySelectorAll('[data-pick]')];
    const here = boxes.filter((box) => picked.has(box.dataset.pick)).length;
    pageTick.checked = boxes.length > 0 && here === boxes.length;
    pageTick.indeterminate = here > 0 && here < boxes.length;
  }

  /** Keep the row whose drawer is open tinted, so it is findable after a scroll. */
  function markOpenRow() {
    root.querySelectorAll('[data-account]').forEach((tr) => {
      tr.classList.toggle('is-open', tr.dataset.account === openId);
    });
  }

  // --------------------------------------------------------------- wiring ---

  const openAccount = (id) => {
    /*
     * The marker is set here rather than left to `hashchange`.
     *
     * Reopening the row that is ALREADY in the hash fires no `hashchange` at
     * all: the shell's `go` spots the same-hash case and routes it by hand. So
     * without this, a row opened, dismissed with Escape and then opened again
     * would never get its tint back, because `onHash` is the only other thing
     * that sets `openId`.
     */
    openId = id;
    markOpenRow();
    window.__dash.go(`#/account/${id}`);
  };

  /*
   * The tick cell sits inside the clickable row, so both handlers have to let it
   * through first. Without that line every tick also opens the drawer, which is
   * the one bug a checkbox column in a clickable table always has.
   *
   * Enter AND Space on a focused row both do what a click does. Enter alone was
   * a real gap: the row is `role="link"` and reachable with Tab, and somebody
   * told "link" reaches for Space as readily as Enter. On this table Space used
   * to scroll the page and do nothing else, while on Projects the same gesture
   * on the same kind of row opened the drawer. One dashboard giving two answers
   * to one key is worse than either answer.
   */
  body.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-pick-cell]')) return;
    const row = ev.target.closest('[data-account]');
    if (row) openAccount(row.dataset.account);
  });
  body.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    // The checkbox keeps Space for itself. It is the one control in the row
    // whose own default for that key is the thing the operator wanted.
    if (ev.target.closest('[data-pick-cell]')) return;
    const row = ev.target.closest('[data-account]');
    if (!row) return;
    // Space scrolls the page by default, which on a keyboard operated table is
    // the opposite of activating the row under the cursor.
    ev.preventDefault();
    openAccount(row.dataset.account);
  });

  body.addEventListener('change', (ev) => {
    const box = ev.target.closest('[data-pick]');
    if (!box) return;
    if (box.checked) picked.set(box.dataset.pick, box.dataset.pickName || box.dataset.pick);
    else picked.delete(box.dataset.pick);
    paintBulk();
  });

  root.querySelector('[data-pick-page]').addEventListener('change', (ev) => {
    const on = ev.target.checked;
    root.querySelectorAll('[data-pick]').forEach((box) => {
      box.checked = on;
      if (on) picked.set(box.dataset.pick, box.dataset.pickName || box.dataset.pick);
      else picked.delete(box.dataset.pick);
    });
    paintBulk();
  });

  /*
   * Sorting is on the header cell rather than a button inside it. A `<th>` with
   * `tabindex="0"` picks up the sheet's global focus ring and keeps the sticky
   * header's layout, and Enter and Space are wired by hand because a `<th>` does
   * not activate on a key press the way a `<button>` does. Space is prevented
   * from its default so the table does not scroll a page while somebody is
   * choosing a column.
   */
  function toggleSort(key) {
    if (!SORTS[key]) return;
    if (sortKey === key) sortDir = -sortDir;
    else {
      sortKey = key;
      // A numeric column opens on its largest value and a date column on its
      // newest, which is the same direction and is what somebody clicking
      // "Posts" is asking for. Nobody has ever wanted the accounts with the
      // fewest posts first on the first click.
      sortDir = -1;
    }
    page = 1;
    load();
  }

  const thead = root.querySelector('table.data thead');
  thead.addEventListener('click', (ev) => {
    const th = ev.target.closest('[data-sort]');
    if (th) toggleSort(th.dataset.sort);
  });
  thead.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const th = ev.target.closest('[data-sort]');
    if (!th) return;
    ev.preventDefault();
    toggleSort(th.dataset.sort);
  });

  root.querySelector('.filter-row').addEventListener('click', (ev) => {
    const button = ev.target.closest('[data-value]');
    if (!button) return;
    const group = button.closest('[data-filter]');
    group.querySelectorAll('[data-value]').forEach((other) => {
      other.setAttribute('aria-pressed', String(other === button));
    });
    only = button.dataset.value;
    page = 1;
    load();
  });

  let debounce = null;
  root.querySelector('#accounts-q').addEventListener('input', (ev) => {
    clearTimeout(debounce);
    query = ev.target.value.trim();
    debounce = setTimeout(() => {
      page = 1;
      load();
    }, 260);
  });

  root.querySelector('#accounts-pager').addEventListener('click', (ev) => {
    const button = ev.target.closest('[data-page]');
    if (!button) return;
    page += button.dataset.page === 'next' ? 1 : -1;
    load();
  });

  // ---------------------------------------------------------- bulk actions ---

  /**
   * Run one bulk verb over the ticked rows, one request at a time.
   *
   * Sequential rather than `Promise.all`, for two reasons. Every `moderate` call
   * opens a transaction on a SQLite file, and fifty of them fired at once is how
   * a box starts answering "database is locked" to work that would have
   * succeeded a millisecond apart. And a partial failure has to be readable:
   * done in order, "12 succeeded and this one failed" is a sentence, where a
   * scattered set of results is a puzzle.
   *
   * The bar is disabled for the duration. A second press while the first run is
   * halfway through would double every remaining row, and ban is not an
   * operation anybody wants applied twice with two different audit lines.
   */
  async function runBulk(action) {
    const plan = BULK[action];
    if (!plan || busy || !picked.size) return;

    const rows = [...picked].map(([id, name]) => ({ id, name }));
    const shown = rows.slice(0, NAMES_IN_CONFIRM).map((row) => esc(row.name)).join(', ');
    const extra = rows.length - NAMES_IN_CONFIRM;

    const ok = await confirmAction({
      title: plan.title(rows.length),
      body: `${plan.body}<p class="muted tiny">${shown}${extra > 0 ? `, and ${n(extra)} more` : ''}</p>`,
      confirmLabel: plan.confirmLabel,
      danger: plan.danger,
    });
    if (!ok) return;

    busy = true;
    bulk.querySelectorAll('button').forEach((button) => {
      button.disabled = true;
    });
    bulkProgress.hidden = false;

    let done = 0;
    let lastNote = '';
    const failures = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      // Written before the call and not after it, so the number on screen is the
      // row currently being written rather than the last one that finished.
      bulkProgress.textContent = `${plan.running} ${n(i + 1)} of ${n(rows.length)}`;
      try {
        /*
         * `ref` is an idempotency key and it is minted per row, not per run: it
         * identifies THIS account being banned, so a retry of the same row is
         * recognisable as the same action while the row beside it is not.
         */
        const answer = await pb.moderate({ target: 'account', id: row.id, action, ref: newRef() });
        // Dropped from the selection ONLY on success. See the summary below.
        picked.delete(row.id);
        done += 1;
        lastNote = (answer && answer.note) || '';
      } catch (err) {
        console.warn(`accounts: ${action} failed on ${row.id}`, err);
        failures.push({ row, message: err?.message || 'no detail was returned' });
      }
    }

    busy = false;
    bulk.querySelectorAll('button').forEach((button) => {
      button.disabled = false;
    });

    // Nothing below this line has a page to write on if the session ended part
    // way through. The writes that landed are landed and the server holds the
    // audit lines for them; only the reporting of them is dropped, and there is
    // nobody left to read it.
    if (!mounted()) return;

    /*
     * THE BUG THIS REPLACES, twice over.
     *
     * `picked.clear()` used to run at the end of every run, successes and
     * failures alike, so a run where three of fifty rows failed cleared all
     * fifty ticks and left the operator to find those three by hand in a table
     * they had just been looking at. `feed.js` and `comments.js` both keep their
     * failures ticked precisely so a retry is one click, and this page is now
     * the third that does.
     *
     * And when EVERY row failed, `done` was zero and `rows.length` was not one,
     * so NEITHER summary toast fired: the operator got a single error message
     * about one account, a cleared selection, and no statement at all of what
     * had happened to the other forty nine. Every run now ends with a sentence
     * saying what actually landed.
     *
     * One row still shows the server's own sentence, because the route writes
     * `note` for a person and it says more than this page knows: "banned, every
     * token they hold stops working on their next request. Their posts are still
     * in the feed". Many rows get a count instead, because `toast` caps the
     * stack at four and fifty individual notes would be a column of messages
     * taller than the table they describe.
     */
    if (!failures.length) {
      bulkProgress.hidden = true;
      bulkProgress.textContent = '';
      if (rows.length === 1 && lastNote) toast(lastNote, 'good');
      else toast(`${n(done)} of ${n(rows.length)} accounts ${plan.past}`, 'good');
    } else {
      /*
       * The detail stays on screen, in the bar, beside the rows it is about. A
       * toast is gone in three and a half seconds and this is the one message
       * somebody may need to copy into a bug report. The failed rows are still
       * ticked, so the bar it is written into is still open.
       *
       * `textContent` and not `innerHTML`: the message is a server string, and
       * this is the one place in this file where wire text reaches the DOM
       * without going past `esc`, because it never becomes markup at all.
       */
      const first = failures[0];
      bulkProgress.hidden = false;
      bulkProgress.textContent =
        `${n(failures.length)} failed and stayed selected. First: ${first.row.name}: ${first.message}`;
      toast(`${n(done)} of ${n(rows.length)} accounts ${plan.past}, ${n(failures.length)} failed`, 'bad');
    }

    paintBulk();
    // Reloaded rather than repainted, so the Status column shows what was just
    // written rather than what this page believed a moment ago.
    await load();
  }

  bulk.addEventListener('click', (ev) => {
    const button = ev.target.closest('[data-bulk]');
    if (!button) return;
    if (button.dataset.bulk === 'clear') {
      picked.clear();
      // Clearing the selection clears the report about it too. A failure line
      // left standing above rows that are no longer ticked is how somebody comes
      // to think the failure is about the next thing they select.
      bulkProgress.hidden = true;
      bulkProgress.textContent = '';
      root.querySelectorAll('[data-pick]').forEach((box) => {
        box.checked = false;
      });
      paintBulk();
      return;
    }
    runBulk(button.dataset.bulk);
  });

  // -------------------------------------------------------- drawer tracking ---

  /**
   * Follow the hash so the table and the drawer agree.
   *
   * `#/account/<id>` rides on top of this view rather than replacing it, which
   * is what makes a pasted link work and what stops the router tearing the table
   * down every time a row is clicked. The catch is that the drawer can ban, give
   * a badge or DELETE the account underneath, and this page would happily go on
   * showing the row as it was.
   *
   * So: mark the open row while the drawer is open, and reload once when it
   * closes. That is one extra request for an operator who opened a drawer and
   * changed nothing, which is a fair price for never showing a row that says
   * "none" beside an account that was banned thirty seconds ago.
   */
  function onHash() {
    const match = location.hash.match(/^#\/account\/([^/?]+)/);
    const next = match ? match[1] : '';
    const wasOpen = openId;
    openId = next;
    if (wasOpen && !next) {
      load();
      return;
    }
    markOpenRow();
  }
  window.addEventListener('hashchange', onHash);

  /**
   * The marker comes off when the drawer closes, whatever closed it.
   *
   * THE BUG. `is-open` was cleared by `onHash` and by nothing else, on the
   * assumption that dismissing the drawer puts the hash back to `#/accounts`.
   * `postDetail.js` and `projects.js` both do exactly that with a
   * `dash:drawer-close` watcher of their own; the account drawer does not, so
   * pressing Escape left the row wearing its accent ground indefinitely.
   * Reproduced on the fixture box: open a row, press Escape, wait, and the row
   * is still tinted. Opening a second row then MOVED the marker rather than
   * clearing it, which reads as "this is the open one" about a drawer that is
   * shut.
   *
   * `ui.closeDrawer` fires `dash:drawer-close` for the close button, the scrim
   * and Escape alike, so listening for it covers every way out. Another agent is
   * giving the account drawer a hash watcher of its own, and this stays correct
   * either way: this listener is registered when the VIEW mounts, so it runs
   * before the one the drawer registers when it OPENS. By the time any hash
   * restore lands, `openId` is already empty and `onHash` finds nothing to do,
   * so the table reloads once and not twice.
   */
  const onDrawerClose = () => {
    if (!openId) return;
    openId = '';
    markOpenRow();
    // The same reload `onHash` does, for the same reason: the drawer can ban,
    // badge or delete the account underneath, and the row must not go on showing
    // what this page believed before it was opened.
    load();
  };
  document.addEventListener('dash:drawer-close', onDrawerClose);

  await load();
  // Read once after the first paint, so a cold load straight onto
  // `#/account/<id>` marks the right row instead of waiting for a navigation.
  onHash();

  return () => {
    clearTimeout(debounce);
    window.removeEventListener('hashchange', onHash);
    document.removeEventListener('dash:drawer-close', onDrawerClose);
    // Bumped so a request that is still in flight cannot paint into a view the
    // router has already replaced.
    loadToken += 1;
  };
}

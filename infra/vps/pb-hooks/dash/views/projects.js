/**
 * Cloud projects: the page about the disk.
 *
 * Every other page here counts rows. This one counts bytes, because
 * `cloud_projects` and `cloud_project_assets` are the only two collections on
 * this box whose size is bounded by what people upload rather than by what they
 * type. A post carries at most four images; a project carries a document plus
 * however many screen recordings, photographs and font files somebody dragged
 * into the editor, and it stays there until the owner deletes it or somebody on
 * this page does. So the columns that matter are `doc_bytes`, `asset_bytes` and
 * the sum of the two, and the header strip exists to answer one question before
 * the table is even read: is anything already past the ceilings the save route
 * is supposed to enforce.
 *
 * ## The share slug is a credential, and this page treats it as one
 *
 * `share_slug` is 22 characters of lowercase base36 and it is the ENTIRE
 * permission to read a project. There is no second check: hold the slug, open
 * the project. That has three consequences, all of them visible in this file:
 *
 *   1. It is shown, and it is copyable, because an operator handling a report
 *      about a leaked link has to be able to see which slug they are revoking
 *      and hand it to whoever is asking. Masking it would make this page
 *      useless for the one job it has around sharing.
 *   2. It never goes through `toast`. `ui.copyText` says "Copied" and does not
 *      echo the value, which is exactly why the copy buttons here call it
 *      rather than rolling their own confirmation: a toast sits in the corner
 *      for three and a half seconds, on top of whatever is being screen shared.
 *   3. Revoking is FINAL and the confirm says so in those words. The save route
 *      mints a fresh slug whenever sharing is turned back on, so there is no
 *      "pause sharing" here even though the button looks like there might be:
 *      an old URL cannot start working again, ever, and an operator who thinks
 *      otherwise will revoke a link expecting to be able to hand it back.
 *
 * ## Why the size sort is done in the browser
 *
 * PocketBase's `sort` takes column names, not expressions, and the number this
 * page is about is `doc_bytes + asset_bytes`, which is not a column. There is no
 * server side ordering by it and no route that provides one. The honest options
 * were to sort by `asset_bytes` alone and call it "size" (a lie in exactly the
 * case that matters, a project whose document is enormous), or to pull a bounded
 * window and rank it here. This does the second, and it says on the page when
 * the window was not the whole table, because a ranking that quietly covers 500
 * of 900 rows is a wrong answer wearing a right answer's clothes.
 *
 * The scan is ordered by `asset_bytes` on the SERVER first, in the same
 * direction the operator asked for. That is what makes the truncation
 * survivable: `asset_bytes` dominates the total on any project big enough to
 * care about, so the rows the cap throws away are the ones that were never going
 * to be near the top of a "largest" list anyway.
 *
 * ## What this page does not have
 *
 * No search box, deliberately. The shell's global search already covers projects
 * by name, by `project_id` and by exact slug, and it lands on `#/project/<id>`,
 * which is this file's drawer. A second box scoped to one table would be a
 * second thing to keep in step for no reach the first one does not have.
 *
 * No bulk bar either. Feed and Comments have one because moderation there is a
 * queue you work through; three of the four actions here destroy a link or a
 * project, and "delete the eleven things I ticked" is not a gesture this page
 * should make easy.
 */

import * as pb from '../pb.js';
import {
  esc,
  n,
  bytes,
  pct,
  ago,
  stamp,
  avatar,
  nameOf,
  handleOf,
  chip,
  emptyState,
  errorState,
  skeleton,
  openDrawer,
  closeDrawer,
  confirmAction,
  toast,
  copyText,
  newRef,
  rawJson,
} from '../ui.js';

/** Rows per page in the table. */
const PER_PAGE = 25;

/**
 * How many rows the size sort is allowed to pull in one go.
 *
 * 500 is PocketBase's documented `perPage` ceiling, so this is one request and
 * not a loop: a paging loop over a table that only ever grows is how a
 * dashboard page turns into a denial of service against its own box the day
 * somebody opens it on a busy install. When the cap is hit the table says so.
 */
const SIZE_SCAN = 500;

/** How many columns the table has, for the one-cell states that span it. */
const COLUMNS = 9;

/**
 * The columns the list actually needs.
 *
 * `doc` is left out on purpose even though it is only a filename: it is the
 * handle to the project document, this table has no use for it, and the drawer
 * fetches the full row anyway. `expand.owner.email` is pulled because
 * `ui.nameOf` falls back to the local part of the address when an account has
 * neither a display name nor a provider name, which is the normal shape of a
 * row created by a token sign in. It is never printed on this page.
 */
const LIST_FIELDS = [
  'id',
  'name',
  'project_id',
  'owner',
  'boards',
  'doc_bytes',
  'asset_bytes',
  'format_version',
  'visibility',
  'share_slug',
  'hidden',
  'created',
  'updated',
  'expand.owner.id',
  'expand.owner.name',
  'expand.owner.display_name',
  'expand.owner.handle',
  'expand.owner.avatar',
  'expand.owner.email',
  'expand.owner.banned',
].join(',');

/**
 * The four ways to narrow the table, and what each one's nothing means.
 *
 * `empty` is a pair rather than a single string because an empty state has to
 * say what would make it non-empty, and that sentence is different for every
 * one of these: no shared projects is a fact about how people are using the
 * feature, and no hidden projects is a fact about how much moderating has been
 * done. "No results" would have said neither.
 *
 * `all` deliberately includes the hidden ones. This is the operator's dashboard
 * and hiding something here must never be a way of losing it: the Hidden filter
 * is a shortcut to a subset, not the only door to it.
 */
const FILTERS = [
  {
    id: 'all',
    label: 'All',
    filter: '',
    empty: [
      'No cloud projects yet',
      'A row lands here the first time somebody signs in and saves a project to the cloud, and nothing on this box has done that yet',
    ],
  },
  {
    id: 'shared',
    label: 'Shared',
    filter: 'visibility = "link"',
    empty: [
      'Nothing is shared by link',
      'Turning on sharing for a project in the editor mints a slug and puts the project here',
    ],
  },
  {
    id: 'private',
    label: 'Private',
    filter: 'visibility = "private"',
    empty: [
      'Every project is shared by link',
      'A project that has never been shared, or one whose link has been revoked, shows up here',
    ],
  },
  {
    id: 'hidden',
    label: 'Hidden',
    filter: 'hidden = true',
    empty: [
      'Nothing is hidden',
      'Hiding a project from its drawer stops its share link resolving and puts it here, and the owner keeps the project either way',
    ],
  },
];

/**
 * The four orderings.
 *
 * Two are the server's and two are this file's. A `server` sort is passed
 * straight through and pages normally against a real total; a `dir` sort is
 * ranked here over the bounded scan described in the file header. `scan` is the
 * column the server orders the scan by, chosen so that a truncated window keeps
 * the end of the table the operator asked to look at.
 */
const SORTS = [
  { id: 'newest', label: 'Newest', server: '-updated' },
  { id: 'oldest', label: 'Oldest', server: 'updated' },
  { id: 'largest', label: 'Largest', dir: -1, scan: '-asset_bytes' },
  { id: 'smallest', label: 'Smallest', dir: 1, scan: 'asset_bytes' },
];

/**
 * The ceilings, cached between the list and the drawer.
 *
 * `render` reads them from the Integrity route, which is where the same numbers
 * the save route enforces are already gathered and where the two "who is over"
 * checks live. The drawer wants one of them to say what share of the per project
 * ceiling the project it is showing takes up, and re-fetching a fifteen query
 * route to read one integer would be an absurd price for one sentence. Null
 * until the first successful load, and the drawer simply omits the sentence
 * while it is, rather than printing a share of an unknown whole.
 */
let cachedLimits = null;

/**
 * How the drawer asks the list to reload itself.
 *
 * Set by `render`, cleared by its cleanup, so it is null exactly when there is
 * no list on the page to reload: `openProject` is also reachable from a pasted
 * `#/project/<id>` on a cold load, and from the shell's global search, and in
 * both of those the drawer must not assume a table exists underneath it.
 */
let reloadList = null;

/**
 * The one shot listener that takes the hash back to the list when the drawer
 * closes.
 *
 * `ui.closeDrawer` fires `dash:drawer-close` and does not touch the hash, which
 * is right: it does not know what route the drawer was opened from. The shell
 * does not listen for it either. So without this, closing the project drawer by
 * clicking the scrim leaves the address bar on `#/project/<id>` while the drawer
 * is gone, and the next Refresh reopens a drawer the operator already dismissed.
 *
 * Kept at module scope so a second `openProject` can drop the first one's
 * listener rather than stacking them.
 */
let dropHashOnClose = null;

/**
 * Bumped by every `openProject` call, and compared after every await inside one.
 *
 * ## The bug this fixes
 *
 * `openProject` used to be `data = await pb.project(id);` then `paint()`, with
 * nothing comparing that answer against a newer call. The router imports this
 * module lazily and awaits `openProject`, and every detail view in this
 * dashboard paints into the SAME `#drawer` element, so clicking two rows 250ms
 * apart put two of these in flight over one surface and the slower answer
 * painted last. Reproduced by holding the first request for two seconds and
 * clicking project A then project B: the hash read `#/project/B` and the drawer
 * showed A, down to A's byte counts, A's owner and A's asset list.
 *
 * The buttons stayed consistent with what was painted, because `act` reads the
 * same `data` the paint came from, so this was never a wrong-record delete. The
 * damage is quieter: the operator is reading a record they did not click, under
 * a URL naming the one they did, and a URL copied out of the address bar at
 * that moment names the wrong project.
 *
 * `accountDetail.js` already had this counter and is the model for it. A
 * counter rather than an AbortController, because there is more than one await
 * per open (the first load, and the re-read after every action) and all of them
 * have to lose to a newer open rather than only the first fetch.
 */
let session = 0;

// ------------------------------------------------------------- helpers ---

/*
 * ## The download links, and the token that used to die under them
 *
 * `cloud_projects.doc` and `cloud_project_assets.file` are both PROTECTED file
 * fields, so their URLs need a file token, and a file token minted by
 * PocketBase lives for about 120 seconds. `pb.fileUrl` is synchronous because
 * it is called from inside HTML template strings, so the token it bakes in is
 * whichever one was in hand when the markup was built, and a drawer outlives
 * that: two minutes with a project open while the owner and the byte counts are
 * read is completely ordinary, and every Download link on the page was dead by
 * the time anybody reached for one. The failure had no useful shape either,
 * just a 403 or a 404 for a file that is plainly listed, which reads as a
 * permissions bug on the box.
 *
 * The fix is NOT in this file. `pb.js` grew `onFileLinkClick`, a capture phase
 * click listener on the document that recognises any `<a href>` pointing at
 * `/api/files/`, rewrites its token in place when the held one is young, and
 * holds the click to mint a new one when it is not. It is the sibling of the
 * `onFileError` retry that already covered `<img>`, and covering links there
 * rather than here means every view gets it, including the ones that have not
 * been written yet.
 *
 * So these two call sites deliberately do the simple render-time thing and do
 * NOT wire click handlers of their own. An earlier draft of this change did
 * exactly that, minting per anchor before re-clicking it, and it has been taken
 * back out: two mechanisms both calling `preventDefault` and re-dispatching a
 * synthetic click on the same anchor is a loop waiting to be discovered, and
 * the one in `pb.js` is the one that is tested and shared. If a download here
 * ever goes stale again, the bug is in `onFileLinkClick`, not in this file.
 */

/** A wire number that cannot be NaN. Every byte column is summed through this. */
function asInt(value) {
  const x = Number(value);
  return Number.isFinite(x) ? x : 0;
}

/**
 * What this page means by the size of a project.
 *
 * The document plus its assets, which is the number both ceilings are checked
 * against on the server (`p.doc_bytes + p.asset_bytes` in the Integrity route's
 * quota queries). Kept in one function so the table, the sort and the drawer
 * cannot drift apart on what "total" means.
 */
const sizeOf = (row) => asInt(row?.doc_bytes) + asInt(row?.asset_bytes);

/** The expanded owner record, or null when the relation could not be resolved. */
const ownerOf = (row) => row?.expand?.owner || null;

/**
 * The name to show for a project.
 *
 * `name` is free text the owner typed in the editor and it is allowed to be
 * empty, so there has to be a fallback. `project_id` is not used as one: it is
 * a machine identifier that already has its own line under the name, and
 * printing it twice would make an unnamed project look like a named one.
 */
const titleOf = (row) => (String(row?.name || '').trim() ? String(row.name) : 'Untitled project');

/**
 * The sharing cell, and the two things it is really watching for.
 *
 * Beyond the obvious private-or-shared, two states are worth a warning chip
 * because each one means a write went half way:
 *
 *   - `visibility = link` with no slug is a project the app thinks is shared
 *     and that nothing can actually open.
 *   - `visibility = private` with a slug still set is the dangerous one. The
 *     moderate route clears both together in a single statement precisely so
 *     this cannot happen, so a row in this state was written by something else,
 *     and the slug sitting in it is a live credential for a project whose owner
 *     believes it is private.
 *
 * Neither is a verdict. Both are worth an operator's eye, which is what a chip
 * with a word in it is for.
 */
function sharingChips(row) {
  const shared = row.visibility === 'link';
  const slug = String(row.share_slug || '');
  const chips = [shared ? chip('shared by link', 'accent') : chip('private')];
  if (row.hidden) chips.push(chip('hidden', 'warn'));
  if (shared && !slug) chips.push(chip('no slug', 'warn'));
  if (!shared && slug) chips.push(chip('slug still set', 'warn'));
  return `<div class="chip-row">${chips.join('')}</div>`;
}

/**
 * The slug itself, with the button that copies it.
 *
 * `data-slug` carries the value so the click handler does not have to read it
 * back out of the rendered text, where a `truncate` or a future ellipsis would
 * silently start copying a shortened credential. The label names the project
 * because a table of these has one button per row and "Copy" on its own tells a
 * screen reader nothing about which one it landed on.
 */
function slugLine(row) {
  const slug = String(row.share_slug || '');
  if (!slug) return '';
  return (
    '<div class="chip-row">' +
    `<code class="code-tag mono">${esc(slug)}</code>` +
    `<button class="btn btn-sm" type="button" data-slug="${esc(slug)}" ` +
    `aria-label="Copy the share slug for ${esc(titleOf(row))}">Copy slug</button>` +
    '</div>'
  );
}

/**
 * A one line description of what an asset actually is.
 *
 * `meta` is the JSON that rebuilds the editor's IndexedDB row and the server
 * never interprets it, so this reads the keys it knows and prints nothing for
 * the rest rather than guessing at a shape. A middle dot between the parts and
 * not a dash, per the house rule. The raw object is one disclosure away at the
 * bottom of the drawer for anything this does not cover.
 */
function assetDetail(meta) {
  if (!meta || typeof meta !== 'object') return '';
  const parts = [];
  const type = meta.mimeType || meta.type || '';
  if (type) parts.push(String(type));
  if (meta.width && meta.height) parts.push(`${asInt(meta.width)} by ${asInt(meta.height)}`);
  if (meta.duration) parts.push(`${(Number(meta.duration) || 0).toFixed(1)}s`);
  if (meta.family) parts.push(String(meta.family));
  if (meta.format) parts.push(String(meta.format));
  if (meta.name) parts.push(String(meta.name));
  return parts.join(' · ');
}

/**
 * The owner cell, which has to survive the owner being gone.
 *
 * `cloud_projects.owner` cascade deletes, so a null expand here means either
 * that the cascade did not fire (which the Integrity page counts as an orphan)
 * or that the relation was never set. Either way the row is real and has to
 * render, and it says which of the two it is by printing the id it could not
 * resolve rather than an empty cell.
 */
function ownerCell(row) {
  const owner = ownerOf(row);
  if (!owner) {
    return (
      '<span class="muted tiny">no owner row</span>' +
      (row.owner ? `<div class="muted tiny mono truncate">${esc(row.owner)}</div>` : '')
    );
  }
  const handle = handleOf(owner);
  return (
    '<div class="identity">' +
    avatar(owner, 'sm', pb.auth.url) +
    '<span class="truncate">' +
    `${esc(nameOf(owner))}${owner.banned ? ` ${chip('banned', 'bad')}` : ''}` +
    (handle ? `<div class="muted tiny truncate">${esc(handle)}</div>` : '') +
    '</span>' +
    '</div>'
  );
}

// ------------------------------------------------------- the header strip ---

/**
 * The six numbers that say how much disk this feature is using.
 *
 * All of them come from the `stats` route rather than from the rows on screen,
 * because a page of 25 projects out of 900 has nothing useful to say about the
 * total and a tile that silently means "on this page" is the kind of wrong
 * number an operator repeats in a meeting.
 */
function tilesHtml(projects) {
  const p = projects || {};
  const total = asInt(p.doc_bytes) + asInt(p.asset_bytes);
  const owners = asInt(p.owners);
  const rows = asInt(p.total);

  const tile = (label, value, meta) =>
    '<div class="kpi">' +
    `<div class="kpi-label">${esc(label)}</div>` +
    `<div class="kpi-value">${esc(value)}</div>` +
    `<div class="kpi-meta">${esc(meta)}</div>` +
    '</div>';

  return (
    tile('Projects', n(rows), `${n(p.shared)} shared by link, ${n(p.hidden)} hidden`) +
    tile('On disk', bytes(total), `documents ${bytes(p.doc_bytes)}, assets ${bytes(p.asset_bytes)}`) +
    tile(
      'Assets',
      n(p.assets),
      asInt(p.assets) ? `${bytes(asInt(p.asset_bytes_rows))} across every project` : 'nothing has been uploaded yet'
    ) +
    tile('Owners', n(owners), owners ? `${bytes(total / owners)} each on average` : 'nobody has saved one yet') +
    tile('Boards', n(p.boards), rows ? `${(asInt(p.boards) / rows).toFixed(1)} per project on average` : 'no projects to average') +
    tile('Saved in 7 days', n(p.d7), `${n(p.today)} of them today`)
  );
}

/**
 * The drift between the two ways of counting asset bytes.
 *
 * `cloud_projects.asset_bytes` is a counter the save route maintains;
 * `SUM(cloud_project_assets.size)` is what the asset rows actually add up to.
 * They are supposed to be equal and the stats route returns both precisely so
 * somebody can check. A difference means an upload or a delete updated one and
 * not the other, which makes every quota check on this page slightly wrong in a
 * direction the difference tells you.
 *
 * Returns an empty string when they agree, because a line that says "these two
 * numbers match" every single day is a line the eye stops reading, and then it
 * keeps not reading it on the day they stop matching.
 */
function driftNote(projects) {
  const stored = asInt(projects?.asset_bytes);
  const counted = asInt(projects?.asset_bytes_rows);
  if (stored === counted) return '';
  const gap = counted - stored;
  return (
    '<p class="muted tiny">' +
    `The project rows record ${esc(bytes(stored))} of assets, the asset rows themselves add up to ${esc(bytes(counted))}, ` +
    `a difference of ${esc(bytes(Math.abs(gap)))}. ` +
    'One of the two was not updated when an asset was added or removed, so every quota number on this page is out by that much' +
    '</p>'
  );
}

/**
 * The ceilings card: the two limits, and who is already past them.
 *
 * Built as a `finding` rather than a plain card on purpose. It is the same
 * check the Integrity page runs, drawn from the same route, and wearing the same
 * clothes here means an operator who has seen it on one page recognises it on
 * the other. A clean check collapses to the green line rather than disappearing,
 * for the reason the Integrity page collapses its cards: "we looked and it is
 * fine" and "we never looked" have to be distinguishable, and on this page they
 * are especially easy to confuse because an install with no projects on it
 * produces an empty list from both.
 */
function ceilingsHtml(risk) {
  const limits = risk?.limits || {};
  const heavy = Array.isArray(risk?.heavy_owners) ? risk.heavy_owners : [];
  const over = Array.isArray(risk?.over_quota_projects) ? risk.over_quota_projects : [];
  const perProject = asInt(limits.max_cloud_project_bytes);
  const perAccount = asInt(limits.max_cloud_user_bytes);
  const found = heavy.length + over.length;

  /* The offender lists are links, because the only useful next move from
     "this project is over the ceiling" is to open it. The route caps each list
     at 40 rows and the count says so when it is at the cap, so nobody reads a
     full list as the whole story. */
  const overList = over.length
    ? '<ul class="chip-row">' +
      over
        .map(
          (row) =>
            '<li>' +
            `<a class="chip chip-bad" href="#/project/${esc(row.id)}">` +
            `${esc(String(row.name || 'Untitled project'))} ${esc(bytes(row.bytes))}</a>` +
            '</li>'
        )
        .join('') +
      '</ul>'
    : '';

  const heavyList = heavy.length
    ? '<ul class="chip-row">' +
      heavy
        .map(
          (row) =>
            '<li>' +
            `<a class="chip chip-bad" href="#/account/${esc(row.u)}">` +
            `${esc(String(row.name || 'Someone'))} ${esc(bytes(row.bytes))} across ${esc(n(row.projects))}</a>` +
            '</li>'
        )
        .join('') +
      '</ul>'
    : '';

  return (
    `<div class="finding${found ? ' is-active' : ''}">` +
    '<div class="finding-head">' +
    '<div><h3>Against the ceilings</h3>' +
    '<div class="sub">The two limits the save route enforces before it accepts an upload, and anybody already past them. ' +
    'Same check the Integrity page runs, read from the same route</div></div>' +
    '<span class="spacer"></span>' +
    (found ? chip(`${found} over`, 'bad') : chip('clear', 'good')) +
    '</div>' +
    '<div class="finding-body"><div class="card-body">' +
    '<dl class="kv">' +
    '<dt>Per project</dt><dd>' +
    (perProject
      ? `<span class="strong">${esc(bytes(perProject))}</span> ` +
        (over.length
          ? `<span class="dim">${esc(n(over.length))} project${over.length === 1 ? ' is' : 's are'} over it</span>${overList}`
          : '<span class="dim">nothing is over it</span>')
      : '<span class="muted">not set on this box, so nothing is checked against it</span>') +
    '</dd>' +
    '<dt>Per account</dt><dd>' +
    (perAccount
      ? `<span class="strong">${esc(bytes(perAccount))}</span> ` +
        (heavy.length
          ? `<span class="dim">${esc(n(heavy.length))} account${heavy.length === 1 ? ' is' : 's are'} over it</span>${heavyList}`
          : '<span class="dim">nothing is over it</span>')
      : '<span class="muted">not set on this box, so nothing is checked against it</span>') +
    '</dd>' +
    '</dl>' +
    '<p class="muted tiny">These byte counts are the columns the save route wrote, not a measurement of the filesystem. ' +
    'Storage has the bounded disk walk, and post images are not in either of these totals</p>' +
    '</div></div>' +
    (found
      ? ''
      : '<div class="finding-clear">Both ceilings checked, nothing on this box is over either one</div>') +
    '</div>'
  );
}

// ------------------------------------------------------------- the view ---

export async function render(root) {
  let only = FILTERS[0];
  let order = SORTS[0];
  let page = 1;

  /** The real number of rows the current filter matches, from the server. */
  let total = 0;

  /**
   * The window a client side sort was ranked over, and whether it was the whole
   * table. `scanned` is only meaningful while `order.dir` is set.
   */
  let scanned = 0;

  /**
   * One controller for whatever list request is in flight.
   *
   * The filter buttons are three clicks apart and each one starts a request. The
   * old one is aborted rather than left to land, because two answers racing for
   * the same `<tbody>` is a table that shows the wrong filter's rows with the
   * right filter's button pressed, and there is no way for the reader to tell.
   * The cleanup aborts it too, so a view the router has already torn down does
   * not repaint a page that belongs to somebody else now.
   */
  let inFlight = null;

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Cloud projects</h2>
        <div class="sub">What every saved project costs the disk, who owns it, and which ones are open to anyone holding a link</div>
      </div>
      <div class="page-tools"><span class="muted tiny" id="projects-total"></span></div>
    </div>

    <div class="stack" id="projects-header">${skeleton('tiles', 6)}</div>

    <div class="section-title">Projects</div>

    <div class="filter-row">
      <div class="segmented" data-group="only" role="group" aria-label="Which projects to show">
        ${FILTERS.map(
          (f, i) =>
            `<button type="button" data-value="${esc(f.id)}" aria-pressed="${i === 0}">${esc(f.label)}</button>`
        ).join('')}
      </div>
      <div class="segmented" data-group="sort" role="group" aria-label="Sort by">
        ${SORTS.map(
          (s, i) =>
            `<button type="button" data-value="${esc(s.id)}" aria-pressed="${i === 0}">${esc(s.label)}</button>`
        ).join('')}
      </div>
      <span class="muted tiny" id="projects-scan"></span>
    </div>

    <div class="card" id="projects-card">
      <div class="table-wrap"><table class="data">
        <thead><tr>
          <th>Project</th>
          <th>Owner</th>
          <th class="num">Boards</th>
          <th class="num">Document</th>
          <th class="num">Assets</th>
          <th class="num">Total</th>
          <th>Sharing</th>
          <th>Format</th>
          <th>Updated</th>
        </tr></thead>
        <tbody id="projects-body"></tbody>
      </table></div>
      <div class="card-body"><div class="pager" id="projects-pager"></div></div>
    </div>`;

  const header = root.querySelector('#projects-header');
  const card = root.querySelector('#projects-card');
  const body = root.querySelector('#projects-body');
  const scanNote = root.querySelector('#projects-scan');
  const totalNote = root.querySelector('#projects-total');

  // -------------------------------------------------------- the header ---

  /**
   * The strip above the table: the totals from `stats`, the ceilings from
   * `risk`.
   *
   * Two routes and two `catch`es, because they fail for different reasons and
   * one must not be able to take the other down. `risk` runs fifteen separate
   * queries and is by far the likeliest thing on this box to be slow or unhappy
   * mid migration; losing it should cost the ceilings card and leave the six
   * tiles, which are the numbers most visits here are actually after.
   */
  async function loadHeader() {
    header.classList.add('is-stale');
    let tiles = '';
    let ceilings = '';

    try {
      const stats = await pb.stats();
      tiles = `<div class="grid grid-kpi">${tilesHtml(stats?.projects)}</div>${driftNote(stats?.projects)}`;
    } catch (err) {
      tiles = `<div class="card"><div class="card-body">${errorState('The totals did not load', err)}</div></div>`;
    }

    try {
      const risk = await pb.risk();
      // Cached for the drawer, which uses the per project ceiling to say what
      // share of it one project takes up. See the note on `cachedLimits`.
      cachedLimits = risk?.limits || null;
      ceilings = ceilingsHtml(risk);
    } catch (err) {
      ceilings = `<div class="card"><div class="card-body">${errorState('The ceiling check did not run', err)}</div></div>`;
    }

    header.innerHTML = tiles + ceilings;
    header.classList.remove('is-stale');
  }

  // --------------------------------------------------------- the table ---

  /**
   * One page of rows.
   *
   * The two sorts take different paths through this and the difference is
   * confined here so that `paint` never has to know which one it is drawing.
   */
  async function load() {
    if (inFlight) inFlight.abort();
    const controller = new AbortController();
    inFlight = controller;
    card.classList.add('is-stale');

    try {
      if (order.server) {
        const result = await pb.list('cloud_projects', {
          page,
          perPage: PER_PAGE,
          sort: order.server,
          filter: only.filter,
          expand: 'owner',
          fields: LIST_FIELDS,
          signal: controller.signal,
        });
        total = asInt(result.totalItems);
        scanned = 0;
        paint(result.items || []);
      } else {
        /*
         * The client side ranking. One request for the window, sorted here, then
         * sliced to the page the operator is on.
         *
         * The slice happens after the sort and not before for the obvious
         * reason, and `total` is still the server's real count so the page
         * counter does not start lying about how much there is; what changes is
         * `scanned`, which is what the note under the filter row reports when
         * the window was not everything.
         */
        const result = await pb.list('cloud_projects', {
          page: 1,
          perPage: SIZE_SCAN,
          sort: order.scan,
          filter: only.filter,
          expand: 'owner',
          fields: LIST_FIELDS,
          signal: controller.signal,
        });
        total = asInt(result.totalItems);
        const rows = (result.items || []).slice();
        scanned = rows.length;
        rows.sort((a, b) => (sizeOf(a) - sizeOf(b)) * order.dir);
        const from = (page - 1) * PER_PAGE;
        paint(rows.slice(from, from + PER_PAGE));
      }
    } catch (err) {
      // An abort is this view cancelling itself, not a failure, and it must not
      // paint an error over the rows the newer request is about to replace.
      if (err?.name === 'AbortError' || controller.signal.aborted) return;
      total = 0;
      scanned = 0;
      body.innerHTML = `<tr><td colspan="${COLUMNS}">${errorState('Could not load the project list', err)}</td></tr>`;
      totalNote.textContent = '';
      scanNote.textContent = '';
      paintPager();
    } finally {
      if (inFlight === controller) {
        inFlight = null;
        card.classList.remove('is-stale');
      }
    }
  }

  function paint(items) {
    if (!items.length) {
      const [title, note] = only.empty;
      body.innerHTML = `<tr><td colspan="${COLUMNS}">${emptyState(title, note)}</td></tr>`;
    } else {
      const ceiling = asInt(cachedLimits?.max_cloud_project_bytes);
      body.innerHTML = items
        .map((row) => {
          const size = sizeOf(row);
          /*
           * The quota chip on the Total column. Two thresholds rather than one,
           * because "this project is about to be refused its next upload" is a
           * different piece of news from "this project is already past the line",
           * and an operator wants to see the first one coming. Only drawn when a
           * ceiling is actually known: a share of an unknown whole is not a
           * number worth printing.
           */
          let quota = '';
          if (ceiling > 0 && size >= ceiling) quota = ` ${chip('over the ceiling', 'bad')}`;
          else if (ceiling > 0 && size >= ceiling * 0.8) quota = ` ${chip('near the ceiling', 'warn')}`;

          const version = asInt(row.format_version);

          return `<tr class="clickable" data-project="${esc(row.id)}" tabindex="0">
            <td>
              <div class="strong truncate">${esc(titleOf(row))}</div>
              <div class="muted tiny mono truncate">${esc(row.project_id || '')}</div>
            </td>
            <td>${ownerCell(row)}</td>
            <td class="num">${n(row.boards)}</td>
            <td class="num">${bytes(row.doc_bytes)}</td>
            <td class="num">${bytes(row.asset_bytes)}</td>
            <td class="num">${bytes(size)}${quota}</td>
            <td>${sharingChips(row)}${slugLine(row)}</td>
            <td>${
              version
                ? `<span class="surface-chip">v${n(version)}</span>`
                : '<span class="muted tiny">not set</span>'
            }</td>
            <td class="nowrap muted tiny" title="${esc(stamp(row.updated))}">${esc(ago(row.updated))}</td>
          </tr>`;
        })
        .join('');
    }

    totalNote.textContent = `${n(total)} project${total === 1 ? '' : 's'}`;

    /*
     * The honesty line under the sort control. It appears only when a size sort
     * could not see the whole table, and it names both numbers so the reader can
     * judge for themselves how much of a ranking they are looking at.
     *
     * "most" or "fewest" follows the direction, because the two sorts scan the
     * opposite ends of the table: Largest pulls the window with the most assets
     * in it and Smallest pulls the one with the fewest. Saying "the most" under
     * both would describe the wrong end of the table half the time, which on a
     * line whose entire purpose is to admit a limitation would be worse than
     * having no line at all.
     */
    scanNote.textContent =
      order.dir && total > scanned && scanned > 0
        ? `Ranked over the ${n(scanned)} projects with the ${order.dir < 0 ? 'most' : 'fewest'} assets, ` +
          `of ${n(total)}. Size is not a column the server can sort on`
        : '';

    paintPager();
  }

  /**
   * The pager.
   *
   * Its page count comes from `scanned` on a size sort and from `total` on a
   * date sort, because those are genuinely different things: a size sort can
   * only page through the window it ranked, and offering page 25 of a ranking
   * that stops at page 20 would be a button that answers with an empty table.
   */
  function paintPager() {
    const reach = order.dir && scanned > 0 ? Math.min(scanned, total) : total;
    const pages = Math.max(1, Math.ceil(reach / PER_PAGE));
    if (page > pages) page = pages;

    root.querySelector('#projects-pager').innerHTML =
      `<button class="btn btn-sm" data-page="prev" type="button"${page <= 1 ? ' disabled' : ''}>Previous</button>` +
      `<span>Page ${n(page)} of ${n(pages)}</span>` +
      `<button class="btn btn-sm" data-page="next" type="button"${page >= pages ? ' disabled' : ''}>Next</button>` +
      '<span class="spacer"></span>' +
      `<span>${n(reach)} row${reach === 1 ? '' : 's'} reachable${reach < total ? ` of ${n(total)}` : ''}</span>`;
  }

  // ------------------------------------------------------------ wiring ---

  /*
   * The copy button lives inside a clickable row, so both the click and the
   * keyboard handler have to let it through before they open the drawer. Miss
   * this and every attempt to copy a slug also opens the project, which is the
   * bug a button inside a clickable table row always has.
   */
  const openFrom = (target) => {
    if (target.closest('[data-slug]')) return false;
    const row = target.closest('[data-project]');
    if (!row) return false;
    window.__dash.go(`#/project/${row.dataset.project}`);
    return true;
  };

  body.addEventListener('click', (ev) => {
    const copy = ev.target.closest('[data-slug]');
    if (copy) {
      // `copyText` says "Copied" and does not echo the value. That is the whole
      // reason the slug goes through it rather than through a hand rolled toast:
      // see the credential note in the file header.
      copyText(copy.dataset.slug);
      return;
    }
    openFrom(ev.target);
  });

  body.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    if (ev.target.closest('[data-slug]')) return;
    // Space scrolls the page by default, and a row that is focusable has to
    // answer both keys or it is reachable by keyboard without being usable by
    // one.
    if (openFrom(ev.target)) ev.preventDefault();
  });

  root.querySelector('.filter-row').addEventListener('click', (ev) => {
    const button = ev.target.closest('[data-value]');
    if (!button) return;
    const group = button.closest('[data-group]');
    group.querySelectorAll('[data-value]').forEach((other) => {
      other.setAttribute('aria-pressed', String(other === button));
    });
    if (group.dataset.group === 'sort') {
      order = SORTS.find((s) => s.id === button.dataset.value) || SORTS[0];
    } else {
      only = FILTERS.find((f) => f.id === button.dataset.value) || FILTERS[0];
    }
    // Back to page one on either change. Staying on page 7 of a filter that now
    // matches four rows is an empty table that looks like a broken one.
    page = 1;
    load();
  });

  root.querySelector('#projects-pager').addEventListener('click', (ev) => {
    const button = ev.target.closest('[data-page]');
    if (!button) return;
    page += button.dataset.page === 'next' ? 1 : -1;
    if (page < 1) page = 1;
    load();
  });

  /*
   * The offender chips in the ceilings card are real links, so a plain click
   * already navigates. They are routed through `__dash.go` anyway for the one
   * case a bare href does not cover: clicking the link for the project whose
   * drawer is already open sets the same hash, fires no `hashchange`, and does
   * nothing at all. `go` routes the same-hash case by hand.
   */
  header.addEventListener('click', (ev) => {
    const link = ev.target.closest('a[href^="#/"]');
    if (!link) return;
    ev.preventDefault();
    window.__dash.go(link.getAttribute('href'));
  });

  // The drawer's handle back to this table. Set before the first load so an
  // action taken in a drawer opened from a pasted link still refreshes the rows
  // underneath it.
  reloadList = () => {
    load();
    loadHeader();
  };

  await Promise.all([loadHeader(), load()]);

  return () => {
    if (inFlight) inFlight.abort();
    inFlight = null;
    reloadList = null;
    if (dropHashOnClose) {
      document.removeEventListener('dash:drawer-close', dropHashOnClose);
      dropHashOnClose = null;
    }
  };
}

// ------------------------------------------------------------ the drawer ---

/**
 * One project, everything the box knows about it, and the four things that can
 * be done to it.
 *
 * A named export of the list view rather than a module of its own: the shell's
 * `DETAIL` table imports `openProject` from this file, and the drawer is small
 * enough that splitting it would cost a file and buy nothing.
 *
 * Never throws. The router catches and toasts, which would put the failure in
 * the corner of the screen and leave an empty drawer sitting in the middle of
 * it; an error belongs in the drawer that was opened to show the thing that
 * failed, where it can be read and where the close button is.
 */
export async function openProject(id) {
  const mine = ++session;

  const drawer = openDrawer(
    '<div class="drawer-head"><h3>Project</h3><span class="spacer"></span>' +
      '<button class="icon-btn" data-close type="button" aria-label="Close">✕</button></div>' +
      `<div class="drawer-body">${skeleton('rows', 4)}</div>`
  );
  if (!drawer) return;

  /*
   * Closing the drawer has to take the address bar back to the list. See the
   * note on `dropHashOnClose`: a previous listener is dropped rather than added
   * to, because opening a second project without closing the first (the shell's
   * search does exactly that) would otherwise leave two of them waiting.
   */
  if (dropHashOnClose) document.removeEventListener('dash:drawer-close', dropHashOnClose);
  dropHashOnClose = () => {
    document.removeEventListener('dash:drawer-close', dropHashOnClose);
    dropHashOnClose = null;
    // Only when the hash is still this drawer's. Navigating away by the rail
    // closes the drawer too, and hijacking that back to the project list would
    // undo the operator's own click.
    if (location.hash.startsWith('#/project/')) window.__dash.go('#/projects');
  };
  document.addEventListener('dash:drawer-close', dropHashOnClose);

  let data = null;
  try {
    /*
     * Assigned into a local first and only then into `data`, and the guard sits
     * between the two. A stale fetch that wrote `data` first and bailed second
     * would have already replaced the newer drawer's payload, and the next
     * repaint after an action would paint from it.
     */
    const answer = await pb.project(id);
    if (mine !== session) return;
    data = answer;
  } catch (err) {
    // 404 is a real answer here and reaches this branch rather than signing the
    // operator out: a project deleted while somebody had the link open, or a
    // pasted id that no longer exists.
    //
    // Guarded like the success path: a slow 404 for project A must not paint
    // its error state over project B, which is the same race wearing its most
    // confusing face, an error about a record that is plainly on screen and
    // working.
    if (mine !== session) return;
    const body = drawer.querySelector('.drawer-body');
    if (body) body.innerHTML = errorState('That project did not open', err);
    return;
  }

  paint();

  function paint() {
    // Guarded again here, even though every caller checks. This is the one
    // function that can put the wrong record on screen, and a future caller
    // should not have to remember that it can.
    if (mine !== session) return;
    drawer.innerHTML = drawerHtml(data);
    wire();
  }

  /**
   * Everything clickable inside the drawer, rebound after every repaint.
   *
   * A repaint replaces the whole subtree, so listeners bound to the old nodes go
   * with it. Rebinding wholesale rather than delegating from the drawer element
   * keeps `paint` a single call with no ordering to get wrong.
   */
  function wire() {
    drawer.querySelectorAll('[data-close]').forEach((button) => {
      button.addEventListener('click', () => closeDrawer());
    });

    drawer.querySelectorAll('a[href^="#/"]').forEach((link) => {
      link.addEventListener('click', (ev) => {
        ev.preventDefault();
        window.__dash.go(link.getAttribute('href'));
      });
    });

    drawer.querySelectorAll('[data-copy]').forEach((button) => {
      button.addEventListener('click', () => copyText(button.dataset.copy));
    });

    /*
     * The importable export.
     *
     * Through `once` like every other button here, even though it writes nothing:
     * it can be dozens of sequential file reads against the box, and two of those
     * running at once is the one way this read-only action could cost the server
     * something. The status line is a `role="status"` so the progress is
     * announced rather than only shown.
     */
    drawer.querySelectorAll('[data-export]').forEach((button) => {
      button.addEventListener('click', () =>
        once(async () => {
          const status = drawer.querySelector('[data-export-status]');
          const say = (message) => {
            if (status && status.isConnected) status.textContent = message;
          };
          const label = button.textContent;
          button.disabled = true;
          button.textContent = 'Packing…';
          try {
            const built = await buildImportableFile(data, say);
            saveJson(built.json, built.name);
            if (built.missing) {
              // Named rather than swallowed. A file that is quietly short of two
              // images is the exact failure this whole button exists to end.
              say(
                `${built.name} saved, without ${n(built.missing)} of ${n(built.total)} files. ` +
                  'Those blobs are not on the box, so the elements using them will be blank'
              );
              toast(`Saved, but ${n(built.missing)} files are missing from the box`, 'bad');
            } else {
              say(
                built.total
                  ? `${built.name} saved with all ${n(built.total)} files in it. Open a project, From a project file`
                  : `${built.name} saved. This project references no images or fonts`
              );
              toast('Saved, ready to import', 'good');
            }
          } catch (err) {
            say('');
            toast(err.message || 'That could not be packed', 'bad');
          } finally {
            if (button.isConnected) {
              button.disabled = false;
              button.textContent = label;
            }
          }
        })
      );
    });

    /*
     * Every write goes through `once`, and `once` wraps the CONFIRM as well as
     * the POST. Wrapping only the POST leaves the window in which two clicks
     * raise two dialogs, which is the bug the lock exists for.
     */
    drawer.querySelectorAll('[data-act]').forEach((button) => {
      button.addEventListener('click', () => once(() => act(button.dataset.act, button)));
    });
  }

  /*
   * One press at a time, across the whole drawer, with the confirm inside it.
   *
   * ## The bug this fixes
   *
   * `act` used to read `if (!(await confirmAction(ask))) return;` and only then
   * set `button.disabled = true`, so the lock did not exist until after the
   * dialog had been answered. Two clicks landing in one tick therefore raised
   * two dialogs, and confirming both sent two moderate POSTs carrying two
   * different refs, which the audit trail records as two separate actions
   * because nothing on that route is keyed on the ref.
   *
   * Disabling the pressed button is not a substitute even once the lock is in
   * the right place: a press is a confirm, then a write, then a re-read, and
   * `paint` throws that button away and rebuilds it in the middle of the
   * sequence, so the flag on it does not survive the thing it is guarding. And
   * a per-button flag could never cover pressing Delete while a Hide on the
   * same project is still in flight. `postDetail.js` was already right about
   * this and this is the same shape.
   *
   * `ui.js` refuses a second dialog while one is open, which stops the stacking
   * by itself, but this lock is what stops the second WRITE, so both belong.
   */
  let busy = false;
  async function once(run) {
    if (busy) return;
    busy = true;
    try {
      await run();
    } finally {
      busy = false;
    }
  }

  /**
   * The four writes, each behind its own confirm.
   *
   * All four ask, including Unhide, which restores rather than destroys. The
   * gate footer promises that everything which writes asks first, and a page
   * where three of four buttons are guarded teaches the hand to expect a dialog
   * and then punishes it on the fourth.
   *
   * ## Every title is a question
   *
   * These four used to be statements: "Revoke the share link", "Hide this
   * project", "Unhide this project", "Delete this project". A title that states
   * reads as a notification of something that has already happened, which is
   * the wrong shape for the one piece of copy in this dashboard that has to be
   * READ rather than skimmed, and it disagreed with every other confirm on the
   * box ("Hide this post?", "Delete this comment?", "Ban Priya Raman?"). Unhide
   * became "Put this project back?" rather than "Unhide this project?" for the
   * same reason `postDetail.js` says "Put this post back?": the negated verb is
   * the harder one to read at a glance.
   *
   * ## What `ref` actually is
   *
   * This comment used to claim that "`moderate` carries an idempotency key so a
   * genuine double submit resolves to one write". It does not. The route
   * validates the ref's shape, writes it into `mod_log.ref` and then acts,
   * unconditionally; nothing anywhere is keyed on it. What it buys is a marker
   * in the audit trail, so a human reading two identical lines a second apart
   * can tell one action logged twice from two genuine presses. The only thing
   * that stops a double submit is the `once` lock above, which is why that lock
   * has to cover the confirm and not just the POST.
   *
   * The button is disabled for the duration as well, for the visible feedback.
   */
  async function act(action, button) {
    const project = data.project;
    const label = esc(titleOf(project));
    const assets = asInt(data.totals?.assets);
    let ask = null;

    if (action === 'unshare') {
      ask = {
        title: 'Revoke the share link?',
        body:
          `<p>Anyone holding the link to <strong>${label}</strong> can open it right now, with no account and no other check. ` +
          'Revoking clears the slug, and the link stops resolving the moment this saves.</p>' +
          '<p><strong>This is final, not a pause.</strong> Turning sharing back on later mints a brand new slug, ' +
          'so the URL that was passed around cannot start working again</p>',
        confirmLabel: 'Revoke link',
        danger: true,
        from: 'shared by link',
        to: 'private, slug cleared',
      };
    } else if (action === 'hide') {
      ask = {
        title: 'Hide this project?',
        body:
          `<p>The share link for <strong>${label}</strong> stops resolving. The owner keeps the project and every asset in it, ` +
          'nothing is deleted, and unhiding puts it back exactly as it was</p>',
        confirmLabel: 'Hide',
        from: 'visible',
        to: 'hidden',
      };
    } else if (action === 'unhide') {
      ask = {
        title: 'Put this project back?',
        body:
          `<p><strong>${label}</strong> becomes visible again. If it is still shared by link, that link starts resolving again too</p>`,
        confirmLabel: 'Unhide',
        from: 'hidden',
        to: 'visible',
      };
    } else if (action === 'delete') {
      /*
       * The count is spelled out rather than implied, and the zero case gets its
       * own sentence. "and so do its 0 asset rows" is the kind of line a template
       * produces and a person never writes, and on a confirm dialog, which is the
       * one piece of copy in this dashboard that has to be read rather than
       * skimmed, a sentence that reads as machine output is a sentence that gets
       * skimmed.
       */
      ask = {
        title: 'Delete this project?',
        body:
          `<p><strong>${label}</strong> goes, and so does its project document. ` +
          (assets
            ? `Its ${esc(n(assets))} asset ${assets === 1 ? 'row goes' : 'rows go'} with it, ` +
              'and so does every file they hold: every image, recording and font uploaded into this project.</p>'
            : 'It has no assets, so the document is the whole of it.</p>') +
          '<p>The owner has no copy of this on the server afterwards. There is no undo and no bin</p>',
        confirmLabel: 'Delete project',
        danger: true,
        from: `${bytes(sizeOf(project))} on disk`,
        to: 'gone',
      };
    } else {
      return;
    }

    if (!(await confirmAction(ask))) return;
    // The operator can navigate while a dialog is open, and a write aimed at
    // the project they were reading a moment ago must not go out under a drawer
    // that is now showing a different one.
    if (mine !== session) return;

    button.disabled = true;
    let result = null;
    try {
      result = await pb.moderate({ target: 'project', id: project.id, action, ref: newRef() });
    } catch (err) {
      button.disabled = false;
      toast(err.message || 'That could not be done', 'bad');
      return;
    }

    // The server's own sentence, not one invented here. It is written for a
    // person and it knows things this page does not, such as how many assets
    // actually went with a delete.
    toast(result?.note || 'Done', 'good');

    if (reloadList) reloadList();

    if (action === 'delete') {
      // Nothing left to repaint. The hash listener takes the address bar back to
      // the list, so the operator lands on the table with the row already gone.
      closeDrawer();
      return;
    }

    /*
     * Re-read rather than patched in place. `unshare`, `hide` and `unhide` are
     * all written as raw SQL on the server precisely so they do not restamp
     * `updated`, which means a locally patched copy of this row would be right
     * about the flag and wrong about anything else that changed underneath. One
     * more request is a cheap price for a drawer that shows what is actually
     * stored.
     */
    try {
      const answer = await pb.project(project.id);
      // The same generation guard as the open path, for the same reason: a
      // re-read that lands after the operator has opened a different project
      // must not replace that project's payload or repaint over it.
      if (mine !== session) return;
      data = answer;
      paint();
    } catch (err) {
      if (mine !== session) return;
      const body = drawer.querySelector('.drawer-body');
      if (body) body.innerHTML = errorState('That worked, but the reload did not', err);
    }
  }
}

/* ============================ the importable export ============================
 *
 * The cloud stores a project as a document plus a pile of separate blobs. The
 * editor's own project file is ONE json with every blob base64'd inside it. Those
 * are two different shapes, and the gap between them is a trap rather than an
 * inconvenience:
 *
 *   `bundleFromJson` in src/lib/account/projectBundle.ts walks the manifest's
 *   `media` list and does `if (!encoded) continue` for anything with no payload.
 *
 * So the stored document, imported as it is, does not fail. It opens, it looks
 * broken, and nothing anywhere says why. That silent success is the whole reason
 * this button exists rather than a line of documentation telling somebody to
 * download the document.
 *
 * What is assembled here mirrors `fetchBundle` in src/lib/cloud/index.ts followed
 * by `bundleToJson`, deliberately, so a file from this dashboard and a file
 * exported by the editor are the same file:
 *
 *   - the manifest is the authority on what the document references, not the
 *     server's asset index. A blob with no manifest entry is not in the document
 *     and putting it in the file would resurrect something the user deleted.
 *   - a blob that will not download is SKIPPED, not fatal, matching both the
 *     editor's restore and its json import. One blank element beats no file.
 *   - `mediaData` and `fontData` are omitted entirely when empty, so a project on
 *     built in fonts produces the same bytes the editor would have written.
 */

/** A Blob to base64 with no `data:` prefix, the same shape `blobToBase64` produces. */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('That blob could not be read'));
    reader.readAsDataURL(blob);
  });
}

/**
 * The stored document as text, gunzipped when the row says it is gzipped.
 *
 * `doc_encoding` travels with the file rather than being guessed from the name,
 * because it is what the editor itself reads on the way back in. A box whose
 * browser had no `CompressionStream` at save time stored plain json and said so.
 */
async function readDoc(project) {
  const blob = await pb.fileBlob('cloud_projects', project.id, project.doc);
  if (String(project.doc_encoding || '') !== 'gzip') return blob.text();
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This document is gzipped and this browser cannot unzip it');
  }
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/**
 * Document plus blobs, back into the one file the editor imports.
 *
 * `onStep(message)` is called often enough to be worth watching: a project with
 * forty screens is forty sequential downloads, and sequential is on purpose. This
 * runs against the same box the feed is served from, and a burst of forty
 * parallel file reads to save an operator a few seconds is the wrong trade.
 *
 * Returns `{ json, name, missing, total }` so the caller can be honest about a
 * partial result instead of handing over a file that quietly lost something.
 */
async function buildImportableFile(data, onStep) {
  const project = data.project || {};
  if (!project.doc) throw new Error('There is no document file on this row');

  onStep('Reading the document');
  const manifest = JSON.parse(await readDoc(project));
  if (!Array.isArray(manifest.projectData)) {
    throw new Error('That document has no artboard data in it, so it is not a project');
  }

  // The asset index, by the id the DOCUMENT uses. `asset_id` is the Dexie row id
  // the elements point at, which is exactly why the migration keeps it verbatim.
  const byId = new Map();
  for (const asset of data.assets || []) byId.set(asset.asset_id, asset);

  const mediaMetas = Array.isArray(manifest.media) ? manifest.media : [];
  const fontMetas = Array.isArray(manifest.fonts) ? manifest.fonts : [];
  const total = mediaMetas.length + fontMetas.length;

  const mediaData = {};
  const fontData = {};
  const missing = [];
  let done = 0;

  const pull = async (meta, into, label) => {
    done += 1;
    onStep(`${label} ${done} of ${total}`);
    const asset = byId.get(meta.id);
    // No row at all means the upload never finished. The editor's own restore
    // treats that the same way, and the file is still worth having.
    if (!asset || !asset.file) {
      missing.push(meta.id);
      return;
    }
    try {
      into[meta.id] = await blobToBase64(
        await pb.fileBlob('cloud_project_assets', asset.id, asset.file)
      );
    } catch (err) {
      console.warn('openscreengen dash: could not read an asset for the export', meta.id, err);
      missing.push(meta.id);
    }
  };

  for (const meta of mediaMetas) await pull(meta, mediaData, 'Packing media');
  for (const meta of fontMetas) await pull(meta, fontData, 'Packing fonts');

  onStep('Writing the file');
  const file = Object.assign({}, manifest);
  if (Object.keys(mediaData).length) file.mediaData = mediaData;
  if (Object.keys(fontData).length) file.fontData = fontData;

  return {
    json: JSON.stringify(file, null, 2),
    name: fileNameFor(project, manifest),
    missing: missing.length,
    total,
  };
}

/**
 * A filename a person can find again.
 *
 * The project's own name, punctuation flattened, falling back to the manifest's
 * and then to the row id. `.json` rather than anything cleverer, because that is
 * what the editor's file picker filters on.
 */
function fileNameFor(project, manifest) {
  const raw = String(project.name || manifest.name || project.project_id || project.id || 'project');
  const slug =
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'project';
  return `${slug}.json`;
}

/**
 * Hand the file over.
 *
 * An object URL and a synthetic click, revoked on the next tick. This page is
 * served by PocketBase over ordinary http, not inside a sandboxed frame, so a
 * download started by script is allowed here in a way it would not be in an
 * embedded viewer.
 */
function saveJson(json, name) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * The drawer's markup.
 *
 * A plain function of the payload with no closure over anything, so it can be
 * called again after an action without any of the wiring having to be unwound
 * first.
 */
function drawerHtml(data) {
  const project = data.project || {};
  const owner = data.owner;
  const totals = data.totals || {};
  const assets = Array.isArray(data.assets) ? data.assets : [];
  const size = sizeOf(project);
  const shared = project.visibility === 'link';
  const slug = String(project.share_slug || '');
  const ceiling = asInt(cachedLimits?.max_cloud_project_bytes);

  /*
   * The one bar on this page. Only drawn when a ceiling is known, and clamped,
   * because a bar is a picture of a proportion and neither end of it can sit
   * outside the track: a project that IS over the ceiling fills it and stops
   * there, with the chip beside it carrying the fact that it went past.
   */
  const share = ceiling > 0 ? Math.max(0, Math.min(100, (size / ceiling) * 100)) : 0;
  const ceilingRow =
    ceiling > 0
      ? '<div class="barlist"><div class="barlist-row">' +
        '<span class="truncate">Per project ceiling</span>' +
        `<span class="barlist-track"><span class="barlist-fill" style="width:${share.toFixed(1)}%"></span></span>` +
        `<span class="barlist-val">${esc(pct(size, ceiling))} of ${esc(bytes(ceiling))}</span>` +
        '</div></div>'
      : '<p class="muted tiny">No per project ceiling is known on this box, so there is nothing to measure this against</p>';

  /*
   * The stored counter beside the counted one, for this project alone. Same
   * check the header strip runs across the whole table, and it is worth
   * repeating here because this is the row an operator is about to act on.
   */
  const storedAssets = asInt(project.asset_bytes);
  const countedAssets = asInt(totals.asset_bytes);
  const assetDrift =
    storedAssets === countedAssets
      ? ''
      : '<p class="muted tiny">The project row records ' +
        `${esc(bytes(storedAssets))} of assets and the asset rows add up to ${esc(bytes(countedAssets))}. ` +
        'The ceiling is checked against the first of those</p>';

  const ownerBlock = owner
    ? '<div class="identity">' +
      avatar(owner, 'md', pb.auth.url) +
      '<span class="identity-text">' +
      `<a href="#/account/${esc(owner.id)}" class="strong">${esc(nameOf(owner))}</a>` +
      (owner.banned ? ` ${chip('banned', 'bad')}` : '') +
      `<div class="muted tiny">${esc(handleOf(owner) || owner.email || '')}</div>` +
      '</span>' +
      '</div>'
    : emptyState(
        'The owner account is gone',
        'The relation cascades on delete, so a project whose owner row has vanished is one the cascade did not reach. Integrity counts these as orphans'
      );

  const assetRows = assets.length
    ? assets
        .map((asset) => {
          const detail = assetDetail(asset.meta);
          const href = pb.fileUrl('cloud_project_assets', asset.id, asset.file, { download: true });
          return `<tr>
            <td>${chip(String(asset.kind || 'unknown'), asset.kind === 'font' ? 'accent' : '')}</td>
            <td>
              <div class="mono tiny truncate">${esc(asset.asset_id || '')}</div>
              ${detail ? `<div class="muted tiny truncate">${esc(detail)}</div>` : ''}
            </td>
            <td class="num">${bytes(asset.size)}</td>
            <td class="nowrap muted tiny" title="${esc(stamp(asset.created))}">${esc(ago(asset.created))}</td>
            <td>${
              href
                ? `<a class="btn btn-sm" href="${esc(href)}" download>Download</a>`
                : '<span class="muted tiny">no file</span>'
            }</td>
          </tr>`;
        })
        .join('')
    : '';

  const assetCap =
    asInt(totals.assets) > assets.length
      ? `<span class="muted tiny">newest ${n(assets.length)} of ${n(totals.assets)} shown</span>`
      : '';

  const docHref = pb.fileUrl('cloud_projects', project.id, project.doc, { download: true });
  const gzipped = String(project.doc_encoding || '') === 'gzip';

  return (
    '<div class="drawer-head">' +
    `<div><h3>${esc(titleOf(project))}</h3>` +
    `<div class="sub mono">${esc(project.project_id || '')}</div></div>` +
    '<span class="spacer"></span>' +
    (project.hidden ? chip('hidden', 'warn') : '') +
    (shared ? chip('shared by link', 'accent') : chip('private')) +
    '<button class="icon-btn" data-close type="button" aria-label="Close">✕</button>' +
    '</div>' +
    '<div class="drawer-body">' +
    // ---- owner ----
    '<div class="card"><div class="card-head"><h3>Owner</h3></div>' +
    `<div class="card-body">${ownerBlock}</div></div>` +
    // ---- size ----
    '<div class="card">' +
    '<div class="card-head"><h3>Size</h3><span class="spacer"></span>' +
    `<span class="muted tiny">${esc(bytes(size))} in total</span></div>` +
    '<div class="card-body">' +
    '<dl class="kv">' +
    // `doc_encoding` is a select whose "no compression" member is literally the
    // string "none", and "stored none" is not English. The column is worth
    // showing because a document stored compressed and a document stored raw are
    // very different numbers in the byte column above it.
    `<dt>Document</dt><dd>${esc(bytes(project.doc_bytes))}<span class="muted tiny"> ${
      project.doc_encoding && project.doc_encoding !== 'none'
        ? `stored ${esc(String(project.doc_encoding))}`
        : 'stored uncompressed'
    }</span></dd>` +
    `<dt>Assets</dt><dd>${esc(bytes(countedAssets))} across ${esc(n(totals.assets))} ${asInt(totals.assets) === 1 ? 'file' : 'files'}</dd>` +
    `<dt>Boards</dt><dd>${esc(n(project.boards))}</dd>` +
    '</dl>' +
    ceilingRow +
    assetDrift +
    '</div></div>' +
    // ---- sharing ----
    '<div class="card">' +
    '<div class="card-head"><h3>Sharing</h3><span class="spacer"></span>' +
    (shared ? chip('shared by link', 'accent') : chip('private')) +
    '</div>' +
    '<div class="card-body">' +
    (slug
      ? '<div class="chip-row">' +
        `<code class="code-tag mono">${esc(slug)}</code>` +
        `<button class="btn btn-sm" type="button" data-copy="${esc(slug)}" aria-label="Copy the share slug">Copy slug</button>` +
        '</div>' +
        '<p class="muted tiny">This slug is the whole permission to read this project. Anyone holding it can open the project ' +
        'without an account, and revoking is the only thing that stops them</p>' +
        (shared
          ? ''
          : '<p class="muted tiny">The project is private and the slug is still set, which the revoke path clears in the same ' +
            'statement. Something other than this dashboard wrote this row</p>')
      : '<p class="muted tiny">No slug is set, so there is no link to this project and nothing to revoke</p>') +
    '</div></div>' +
    // ---- the row ----
    '<div class="card"><div class="card-head"><h3>The row</h3></div>' +
    '<div class="card-body"><dl class="kv">' +
    `<dt>Project id</dt><dd class="mono">${esc(project.project_id || '')}</dd>` +
    `<dt>Row id</dt><dd class="mono">${esc(project.id || '')}</dd>` +
    `<dt>Format version</dt><dd>${asInt(project.format_version) ? `v${n(project.format_version)}` : 'not set'}</dd>` +
    `<dt>Document</dt><dd>${
      docHref
        ? `<a href="${esc(docHref)}" class="mono" download>${esc(project.doc || '')}</a>` +
          `<div class="muted tiny">The stored file, exactly as it was uploaded${
            gzipped ? ', which on this row is gzipped' : ''
          }. It is the manifest only, so it will not carry the images. Use Download for the editor below</div>`
        : '<span class="muted">no document file on this row</span>'
    }</dd>` +
    `<dt>Created</dt><dd>${esc(stamp(project.created))} <span class="muted">${esc(ago(project.created))}</span></dd>` +
    `<dt>Updated</dt><dd>${esc(stamp(project.updated))} <span class="muted">${esc(ago(project.updated))}</span></dd>` +
    '</dl></div></div>' +
    // ---- assets ----
    '<div class="card">' +
    `<div class="card-head"><h3>Assets</h3><span class="spacer"></span>${assetCap}</div>` +
    (assetRows
      ? '<div class="table-wrap"><table class="data">' +
        '<thead><tr><th>Kind</th><th>Asset</th><th class="num">Size</th><th>Uploaded</th><th>File</th></tr></thead>' +
        `<tbody>${assetRows}</tbody></table></div>`
      : `<div class="card-body">${emptyState(
          'No assets on this project',
          'A project with no assets is one built entirely from templates and text, which is normal. Dropping a photo, a recording or a font into the editor puts a row here'
        )}</div>`) +
    '</div>' +
    // ---- download ----
    '<div class="card">' +
    '<div class="card-head"><div><h3>Download</h3>' +
    '<div class="sub">The stored document is the manifest on its own. This rebuilds the file the editor imports</div>' +
    '</div></div>' +
    '<div class="card-body">' +
    '<div class="btn-row">' +
    (project.doc
      ? '<button class="btn btn-sm btn-primary" type="button" data-export="bundle">Download for the editor</button>'
      : '<button class="btn btn-sm" type="button" disabled title="There is no document file on this row">Download for the editor</button>') +
    '</div>' +
    '<p data-export-status class="muted tiny" role="status"></p>' +
    '<p class="muted tiny">The cloud keeps the document and the blobs apart: the document lists what it references, the ' +
    'assets above are the bytes. Importing the raw document on its own succeeds and then silently drops every image ' +
    'and font, because the editor skips a reference with no payload. This puts them back together into one file, ' +
    'ungzipped, in the shape Open a project reads</p>' +
    '</div></div>' +
    // ---- actions ----
    '<div class="card"><div class="card-head"><h3>Actions</h3></div>' +
    '<div class="card-body">' +
    '<div class="btn-row">' +
    (shared || slug
      ? '<button class="btn btn-sm btn-danger" type="button" data-act="unshare">Revoke link</button>'
      : '<button class="btn btn-sm" type="button" disabled title="There is no link to revoke">Revoke link</button>') +
    (project.hidden
      ? '<button class="btn btn-sm" type="button" data-act="unhide">Unhide</button>'
      : '<button class="btn btn-sm" type="button" data-act="hide">Hide</button>') +
    '<button class="btn btn-sm btn-danger" type="button" data-act="delete">Delete project</button>' +
    `<button class="btn btn-sm" type="button" data-copy="${esc(project.id || '')}">Copy row id</button>` +
    '</div>' +
    '<p class="muted tiny">Hiding stops the share link resolving and touches nothing else. Revoking clears the slug and cannot be ' +
    'undone: sharing again mints a new one. Deleting takes the document and every asset file with it</p>' +
    '</div></div>' +
    rawJson('Project row', project) +
    '</div>'
  );
}

/**
 * Storage — is the disk filling, and how much of it can the database even see.
 *
 * ## The one thing this page exists to say
 *
 * **No column in this schema records the size of a post image.** `posts.images`
 * is a list of filenames and `image_meta` carries aspect, fit and label, and
 * that is the whole of it. So every byte total the database can produce comes
 * from exactly two columns, `cloud_projects.doc_bytes` and
 * `cloud_projects.asset_bytes`, both written by the cloud save route because
 * that route happened to know the size at the time. The feed's screenshots, the
 * avatars, and anything else that ever went through a file field are invisible
 * to all of it.
 *
 * That is not a number that is zero. It is a number that does not exist, and
 * those two read identically on a dashboard unless somebody writes the sentence
 * out. Which is why the sentence is the first thing on the page, above the
 * figures rather than in a footnote under them: an operator who reads
 * "1.6 MB of assets" and closes the tab has just been told the box is nearly
 * empty by a page that had no way of knowing.
 *
 * The Measure disk button is the only answer to that. It walks
 * `pb_data/storage` on the box and totals the files themselves, which is the
 * only place the post images are countable at all.
 *
 * ## `disk: null` means two completely different things
 *
 * The route answers `disk: null` when no walk was asked for, AND when the walk
 * was asked for and the filesystem could not be read. The wire cannot tell those
 * apart, and they are opposite facts: the first is "nobody has looked yet" and
 * the second is "we looked and the box would not let us". Rendering the same
 * "not measured" line for both would hide a broken data directory behind a
 * button that appears to do nothing when pressed.
 *
 * So this view keeps its own record of whether the painted response was fetched
 * with `measure=1` (`state.measured`), and reads the null against that. Client
 * side state is the only place that distinction can live, because the server
 * genuinely does not send it.
 *
 * ## The walk is bounded, so its numbers can be floors
 *
 * 20000 files and 4000 directories. Past either cap the route sets
 * `truncated: true` and stops. Every figure it returns is then a FLOOR and not a
 * total, and this page has to say "at least" in front of each one. Presenting a
 * capped walk as a measurement is how somebody concludes the disk is fine on a
 * box where the walk gave up a third of the way through it.
 */

import * as pb from '../pb.js';
import { barList, donut } from '../charts.js';
import {
  esc,
  n,
  bytes,
  pct,
  chip,
  ago,
  stamp,
  emptyState,
  errorState,
  skeleton,
  toast,
} from '../ui.js';

/**
 * The caps the route walks under, restated here only so the copy can name them.
 *
 * Deliberately not used for any arithmetic. The server owns these numbers and
 * this file cannot enforce them; if the route's caps ever move, the worst this
 * causes is a sentence quoting the old figures, rather than a page computing a
 * total from a limit it only thinks it knows.
 */
const CAP_FILES = 20000;
const CAP_DIRS = 4000;

/**
 * The two lists on this page that the ROUTE cuts short, and how each one is
 * caught doing it.
 *
 * `by_owner` and `biggest` both end in `LIMIT 25`. Nothing in the response says
 * so, this file carried no cap note at all, and on a box with more than 25 of
 * either the page showed 25 rows and read as the whole table. Every other capped
 * list in this build says which it is ("newest 24 of 61" on an account, "at most
 * 40 rows per check" on Integrity, "Top 12 of 31" on Tags), and this one was the
 * odd one out. The fixture has nine owners so nothing truncates on it today,
 * which is exactly why it went unnoticed.
 *
 * Neither helper computes anything FROM the number below. It is quoted in the
 * copy and nothing else, so if the route's LIMIT ever moves, the worst this
 * causes is a sentence naming the old figure rather than a page doing arithmetic
 * with a limit it only thinks it knows. The truncation itself is detected from
 * the payload:
 *
 *   - `biggest` is one row per project, so a shorter list than
 *     `projects.projects` IS the cut.
 *   - `by_owner` is grouped, so the owner count is not knowable, but each row
 *     carries its own project count and every project belongs to exactly one
 *     owner. Projects unaccounted for by the listed owners is therefore how much
 *     the cut hid, and it needs no second request.
 */
const LIST_CAP = 25;

/** Milliseconds, printed so a slow walk reads as slow rather than as a big number. */
function took(ms) {
  const value = Number(ms);
  if (!isFinite(value) || value < 0) return 'unknown';
  if (value < 1000) return `${n(Math.round(value))} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

/**
 * The owner's name for a bar label, and the honest fallback when there is none.
 *
 * `by_owner` LEFT JOINs `users`, so an owner whose account row is gone comes
 * back with an empty name and an empty handle rather than being dropped. That is
 * a real finding and not a rendering problem: `cloud_projects.owner` is a
 * cascadeDelete relation, so a project whose owner no longer exists is a cascade
 * that did not fire. The id is shown rather than a placeholder, because the id
 * is the only thing left that anybody can look the row up by.
 */
function ownerLabel(row) {
  if (row.name) return row.name;
  if (row.handle) return `@${row.handle}`;
  return row.u || 'no owner id';
}

const ownerIsOrphan = (row) => !row.name && !row.handle;

/**
 * Give a donut's `<svg>` a name, and take its inner text out of the reading
 * order.
 *
 * The bug this fixes: `donut()` draws the share of each slice as a bare
 * `<text>` on the ring and the total as another one in the hole, with no
 * `aria-hidden` and no name anywhere on the SVG. A screen reader walking this
 * page therefore heard "100%" and then "1.6 MB total", two numbers with nothing
 * whatsoever to say what they were of. The sparklines in the KPI tiles are
 * marked `aria-hidden` and get this right; the big charts were never done.
 *
 * `role="img"` is the fix rather than `aria-hidden`, because the picture should
 * still be announced, just as ONE thing with a name instead of as a spray of
 * loose percentages: an element with `role="img"` has its whole subtree treated
 * as presentational, so the ring's own labels stop being read while the name
 * given here is read in their place. The label ends by naming where the figures
 * are in words, because the legend beside the ring and the chart's own Table
 * view button are both outside the SVG and both survive this.
 *
 * Safe to do from a call site, and only for the donut: `donut()` paints once,
 * synchronously, into a container it never touches again. `columnChart()` and
 * the rest go through `responsive()`, which REPLACES the whole `<svg>` element
 * on every ResizeObserver fire, so an attribute set on one of those from out
 * here is gone the first time somebody drags the window. Those belong to
 * charts.js.
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

// --------------------------------------------------------------- the disk ---

/**
 * The disk card body, which is really three different panels wearing one name.
 *
 * `measured` is this view's own memory of what it asked for, not anything the
 * server said. See the header: it is the only way the two nulls can be told
 * apart, and telling them apart is most of what this panel is for.
 */
function diskPanel(disk, measured) {
  if (!measured) {
    return emptyState(
      'The disk has not been walked yet',
      `Nothing on this page has touched the filesystem. Measure disk walks the storage directory and totals every file on it, which is the only way to see the post images, the avatars and anything else the database has no size column for. It stops at ${n(
        CAP_FILES
      )} files or ${n(CAP_DIRS)} directories, whichever comes first`
    );
  }

  if (!disk) {
    /*
     * Measured, and still null. The route wraps the whole walk and answers null
     * rather than 500 when the filesystem cannot be read, precisely so the
     * database half of the response survives. That makes this an error state
     * with no error message attached to it, so the text has to supply the
     * meaning the wire could not: the walk ran and failed, and the figures
     * further down the page are unaffected by it.
     */
    return errorState(
      'The walk ran and could not read the filesystem',
      'The box answered with no disk figure at all, which means the storage directory could not be opened or the data directory is not where this process expects it. Everything below still holds: those numbers come from the database and never touch a file'
    );
  }

  const capped = disk.truncated === true;
  // One prefix, applied to every figure the walk produced, because when the walk
  // stopped early they are all floors and singling one out would imply the
  // others were complete.
  const floor = capped ? 'at least ' : '';

  const capNote = capped
    ? `<p class="note">${chip('capped', 'warn')}
        <span class="dim">The walk hit its bound of ${esc(n(CAP_FILES))} files or ${esc(
          n(CAP_DIRS)
        )} directories and stopped there, so every number in this panel is a floor and the real totals are larger. Nothing here is wrong, it is incomplete</span></p>`
    : '';

  return (
    `<dl class="kv">
      <dt>Path</dt><dd class="mono">${esc(disk.path || 'unknown')}</dd>
      <dt>Total on disk</dt><dd class="strong">${esc(floor)}${esc(bytes(disk.bytes))}</dd>
      <dt>Files</dt><dd>${esc(floor)}${esc(n(disk.files))}</dd>
      <dt>Directories</dt><dd>${esc(floor)}${esc(n(disk.dirs))}</dd>
      <dt>Walk took</dt><dd>${esc(took(disk.ms))}</dd>
    </dl>` + capNote
  );
}

/**
 * The gap between what is on the disk and what the database can account for.
 *
 * This is the payoff of the whole page: subtract the two byte columns from the
 * walk and what is left is the part no column records, which is overwhelmingly
 * post images. It is the only place on this box where that quantity is a number
 * rather than a shrug.
 *
 * Three cases, and the two awkward ones are the ones worth writing out. A capped
 * walk makes the difference a floor as well, since the exact half of the
 * subtraction is the small one. A NEGATIVE difference means the walk found less
 * than the database claims, which on a complete walk is a genuine contradiction
 * worth saying out loud and on a capped one is simply what a cap looks like.
 */
function diskGap(disk, tracked) {
  if (!disk) return '';
  const capped = disk.truncated === true;
  const gap = Number(disk.bytes || 0) - tracked;

  if (gap > 0) {
    return `<p class="note">${esc(capped ? 'At least ' : '')}${esc(
      bytes(gap)
    )} of what the walk found is not accounted for by any byte column: post images, avatars, and every other file uploaded through a field that does not record a size. The database half of this page cannot see any of it</p>`;
  }

  if (capped) {
    return `<p class="note">The capped walk totalled less than the database already accounts for, which is what a cap looks like rather than a problem: it stopped before it reached the cloud project files. There is nothing to read into the difference until a walk finishes without being cut short</p>`;
  }

  return `<p class="note">The walk completed and found ${esc(
    bytes(Math.abs(gap))
  )} less than the two byte columns claim. That is a contradiction: either files were deleted from the disk without their rows going with them, or a save recorded a size it never wrote. Integrity is the page that looks at drift like this</p>`;
}

// ------------------------------------------------------- the database half ---

/** The six figures the database can actually stand behind, and one it cannot. */
function kpis(data) {
  const projects = data.projects || {};
  const images = data.post_images || {};
  const tracked = Number(projects.doc_bytes || 0) + Number(projects.asset_bytes || 0);

  const tiles = [
    {
      label: 'Tracked bytes',
      value: bytes(tracked),
      meta: `documents and assets across ${n(projects.projects)} projects`,
    },
    {
      label: 'Project documents',
      value: bytes(projects.doc_bytes),
      meta: 'one project.json per row',
    },
    {
      label: 'Project assets',
      value: bytes(projects.asset_bytes),
      meta: `${n(projects.assets)} asset rows, ${pct(projects.asset_bytes, tracked)} of tracked`,
    },
    {
      label: 'Cloud projects',
      value: n(projects.projects),
      meta: `${n(projects.shared)} shared by link, ${n(projects.hidden)} hidden`,
    },
    {
      label: 'Posts carrying images',
      value: n(images.posts),
      meta: 'no size column exists for these',
    },
    {
      label: 'Screens declared',
      value: n(images.screens),
      meta: 'what the share form reported, summed over every post and not only the ones above',
    },
  ];

  return tiles
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
 * `asset_bytes` beside `asset_size_sum`, which is a drift check hiding in a
 * storage total.
 *
 * `cloud_projects.asset_bytes` is a cache the save route maintains on the
 * project row; `SUM(cloud_project_assets.size)` is what the asset rows actually
 * add up to. They are two answers to one question and the second is the one
 * that came from real files, so when they disagree the cache is what is stale.
 * Saying they AGREE is worth a line too: silence would leave an operator unable
 * to tell a check that passed from a check nobody ran.
 */
function assetDriftLine(projects) {
  const cached = Number(projects.asset_bytes || 0);
  const actual = Number(projects.asset_size_sum || 0);

  if (cached === actual) {
    return `<p class="note">${chip('agrees', 'good')}
      <span>The project rows and the asset rows both total ${esc(
        bytes(actual)
      )}, so the cached column is current</span></p>`;
  }

  return `<p class="note">${chip('disagrees', 'warn')}
    <span class="dim">The project rows total ${esc(bytes(cached))} in assets and the asset rows themselves total ${esc(
      bytes(actual)
    )}, a difference of ${esc(
      bytes(Math.abs(cached - actual))
    )}. The asset rows are the ones that came from real uploads, so the cached column on the project is the stale half</span></p>`;
}

// ----------------------------------------------------------------- the page ---

export async function render(root) {
  /*
   * Everything the paint depends on, in one place.
   *
   * `measured` is the load bearing one and it is deliberately NOT read off the
   * response: it records what this client asked for, which is the only thing
   * that gives `disk: null` a meaning. `error` is kept beside `data` rather than
   * replacing it so a failed refetch can show the message above the last good
   * render instead of blanking a page that was answering fine a second ago.
   */
  const state = { data: null, measured: false, error: null, loading: true };

  // Set by the cleanup. Every await below is followed by a check on it: an
  // operator who presses Measure disk and immediately navigates away leaves a
  // walk in flight, and the response for it must not be painted into a root that
  // the router has already detached, nor toast about a page nobody is on.
  let dead = false;

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Storage</h2>
        <div class="sub">What is on the disk, what the database can count, and the large part of it that no column records</div>
      </div>
    </div>

    <div class="finding is-active">
      <div class="finding-head">
        <div>
          <h3>Post images are not counted in anything below</h3>
          <div class="sub">Every byte total on this page comes from the two size columns a cloud project save writes. Nothing in this schema records the size of an uploaded post image</div>
        </div>
      </div>
      <div class="finding-body">
        <div class="card-body">
          <p class="note">
            <span class="mono">posts.images</span> is a list of filenames and <span class="mono">image_meta</span> carries aspect, fit and label. Neither one carries a size, and no other column on this box does either, so the database cannot answer how much disk the feed is using. It is not that the number is zero, it is that there is no number to read
          </p>
          <p class="note">
            Measure disk, below, walks the storage directory and totals the files themselves. That is the only way to see the post images, the avatars, and everything else uploaded through a file field
          </p>
        </div>
      </div>
    </div>

    <div id="st-body"></div>`;

  const body = root.querySelector('#st-body');

  /**
   * One listener on the view, bound once, for a button that is rebuilt on every
   * paint.
   *
   * `paint()` replaces the whole of `#st-body`, so any handler bound directly to
   * the Measure button would be pointing at a detached element the moment the
   * first result landed, and the second press would do nothing at all. Silent
   * dead controls are the worst kind, so the listener lives on the container
   * that survives instead. `data-measure` carries the intent, which is what lets
   * the retry button in the error state reuse the same path without asking for a
   * filesystem walk it has no reason to want.
   *
   * ## Named, so the cleanup can take it off again
   *
   * `root` is `#st-body`'s parent, which is `#view`, and `#view` is the SAME
   * element for every page in this dashboard. The router swaps its innerHTML on
   * the way to the next view and never the element itself, so a handler left
   * here survives the view that added it and one more of them accumulates on
   * every visit to Storage.
   *
   * That is not a tidiness point on this page, it is a second walk of the
   * filesystem. Reproduced: Storage, then Pulse, then Storage, then one press of
   * Measure disk, and the 20000 file walk ran on the box TWICE, because the dead
   * closure from the first visit still matched `[data-load]` and still held a
   * live `load`. The `state.loading` guard cannot help, since each closure has
   * its own `state`. `dead = true` cannot help either: it is checked after the
   * await, so it suppresses the paint and the toast and not the request that
   * cost the box the walk.
   */
  const onClick = (ev) => {
    const button = ev.target.closest('[data-load]');
    if (!button || state.loading) return;
    load(button.dataset.measure === '1', button);
  };
  root.addEventListener('click', onClick);

  /** A row that clicks through, without stealing the click from its own link. */
  function wireRows() {
    body.querySelectorAll('[data-project]').forEach((tr) => {
      tr.addEventListener('click', (ev) => {
        // The project name is a real anchor so a keyboard operator can reach it
        // by tabbing. Letting the row handler fire for a click on that anchor
        // would route the same hash twice, so the browser keeps the ones that
        // landed on the link and the row takes everything else.
        if (ev.target.closest('a')) return;
        window.__dash.go(`#/project/${tr.dataset.project}`);
      });
    });
  }

  function paint() {
    // The first load has nothing to hold, so it gets shapes rather than an empty
    // page. Every later load keeps the previous render and dims it, which is why
    // this branch tests for the absence of data and not for `loading`.
    if (!state.data) {
      body.innerHTML =
        (state.error ? errorState('Storage could not be read', state.error) : '') +
        (state.error
          ? '<div class="btn-row"><button class="btn" type="button" data-load data-measure="0">Try again</button></div>'
          : skeleton('tiles', 6) + skeleton('rows', 4));
      return;
    }

    const data = state.data;
    const projects = data.projects || {};
    const tracked = Number(projects.doc_bytes || 0) + Number(projects.asset_bytes || 0);
    const owners = data.by_owner || [];
    const biggest = data.biggest || [];
    const tables = data.tables || [];

    const orphaned = owners.filter(ownerIsOrphan).length;

    /*
     * How many projects the listed owners between them hold, which is the whole
     * table when the LIMIT did not bite and less than it when it did. See
     * LIST_CAP above.
     */
    const ownedShown = owners.reduce((sum, row) => sum + Number(row.projects || 0), 0);
    const ownedMissing = Math.max(0, Number(projects.projects || 0) - ownedShown);

    body.innerHTML = `
      ${state.error ? errorState('The last refresh failed, so these figures are the previous ones', state.error) : ''}

      <div class="section-title">Disk</div>
      <div class="card">
        <div class="card-head">
          <div>
            <h3>The storage directory</h3>
            <div class="sub">A bounded walk of every file PocketBase has written, run only when asked</div>
          </div>
          <div class="spacer"></div>
          <button class="btn btn-primary" type="button" data-load data-measure="1">
            ${state.measured ? 'Measure again' : 'Measure disk'}
          </button>
        </div>
        <div class="card-body">
          ${diskPanel(data.disk, state.measured)}
          ${diskGap(data.disk, tracked)}
        </div>
      </div>

      <div class="section-title">What the database counts</div>
      <div class="grid grid-kpi">${kpis(data)}</div>

      <div class="grid grid-2 grid-top">
        <div class="card">
          <div class="card-head">
            <div>
              <h3>Documents and assets</h3>
              <div class="sub">How the tracked bytes divide, from the two columns that carry them</div>
            </div>
          </div>
          <div class="card-body" id="st-split"></div>
        </div>
        <div class="card">
          <div class="card-head">
            <div>
              <h3>Rows per collection</h3>
              <div class="sub">Row counts, not bytes: a join table row is tiny and a screenshot is not</div>
            </div>
          </div>
          <div class="card-body" id="st-tables"></div>
        </div>
      </div>

      <div class="section-title">Who is holding it</div>
      <div class="card">
        <div class="card-head">
          <div>
            <h3>Top owners by bytes</h3>
            <div class="sub">Documents plus assets, per account, biggest first. Post images are not in these numbers either</div>
          </div>
        </div>
        <div class="card-body" id="st-owners"></div>
      </div>

      <div class="section-title">The biggest projects</div>
      <div class="card">
        <div class="table-wrap"><table class="data">
          <thead><tr>
            <th>Project</th><th>Owner</th><th class="num">Boards</th><th class="num">Size</th><th class="num">Updated</th>
          </tr></thead>
          <tbody>${
            biggest.length
              ? biggest
                  .map(
                    (row) => `<tr class="clickable" data-project="${esc(row.id)}">
                      <td><a href="#/project/${esc(row.id)}">${esc(row.name || 'no name')}</a></td>
                      <td class="truncate" style="--truncate-cap:180px">${
                        row.owner_name
                          ? esc(row.owner_name)
                          : '<span class="muted">no account row</span>'
                      }</td>
                      <td class="num">${esc(n(row.boards))}</td>
                      <td class="num">${esc(bytes(row.bytes))}</td>
                      <td class="num nowrap muted tiny" title="${esc(stamp(row.updated))}">${esc(ago(row.updated))}</td>
                    </tr>`
                  )
                  .join('')
              : `<tr><td colspan="5">${emptyState(
                  'No cloud projects have been saved',
                  'A save from the editor with cloud projects switched on puts the first row here'
                )}</td></tr>`
          }</tbody>
        </table></div>
        ${
          biggest.length
            ? `<div class="card-body"><div class="muted tiny">${esc(
                Number(projects.projects || 0) > biggest.length
                  ? `Top ${n(biggest.length)} of ${n(projects.projects)} projects by size. The route answers at most ${n(
                      LIST_CAP
                    )} and stops there`
                  : `All ${n(biggest.length)} ${
                      biggest.length === 1 ? 'project' : 'projects'
                    } on the box, biggest first. The route would answer at most ${n(LIST_CAP)}`
              )}</div></div>`
            : ''
        }
      </div>`;

    // ---------- the two chart hosts ----------

    const split = body.querySelector('#st-split');
    if (tracked > 0) {
      const ring = donut({
        rows: [
          { label: 'Documents', value: Number(projects.doc_bytes || 0) },
          { label: 'Assets', value: Number(projects.asset_bytes || 0) },
        ],
        total: tracked,
        format: bytes,
      });
      // See `nameChart`. Without this the ring reads out as "100%" and
      // "1.6 MB total" and nothing else at all.
      nameChart(
        ring,
        `Tracked bytes split between documents and assets, ${bytes(tracked)} in total. ` +
          'The same figures are listed beside the ring, and Table view under it gives every share'
      );
      split.replaceChildren(ring);
      split.insertAdjacentHTML('beforeend', assetDriftLine(projects));
    } else {
      split.innerHTML = emptyState(
        'Nothing has been saved to the cloud yet',
        'The first project saved from the editor records a document size and an asset size, and this is where they land'
      );
    }

    const tablesHost = body.querySelector('#st-tables');
    if (tables.length) {
      tablesHost.replaceChildren(barList(tables));
      /*
       * `mod_log` ships in a migration while the route that counts it ships in
       * the hooks, and docker-compose binds those as two separate mounts. The
       * route drops the row entirely rather than reporting zero when the table
       * is not there, so its ABSENCE from this list is the signal, and an
       * operator staring at a list that simply does not mention it would have no
       * way to know the audit trail is not being kept.
       */
      if (!tables.some((row) => row.k === 'mod_log')) {
        tablesHost.insertAdjacentHTML(
          'beforeend',
          `<p class="note">${chip('missing', 'warn')}
            <span class="dim">mod_log is not in this list, which means the collection is not on the box. Its migration has not run, so nothing any moderation action does is being written down</span></p>`
        );
      }
    } else {
      tablesHost.innerHTML = emptyState(
        'No row counts came back',
        'Every count in this panel is one UNION over the collections. An empty list means those queries could not run, which is a server problem rather than an empty box'
      );
    }

    const ownersHost = body.querySelector('#st-owners');
    if (owners.length) {
      ownersHost.replaceChildren(
        barList(
          owners.map((row) => ({ label: ownerLabel(row), value: Number(row.bytes || 0) })),
          { format: bytes }
        )
      );
      /*
       * Said on every render rather than only when it bites, because "the top
       * 25" and "all of them" are different facts and a line that appears only
       * in the truncated case leaves the untruncated one silently ambiguous.
       */
      ownersHost.insertAdjacentHTML(
        'beforeend',
        ownedMissing
          ? `<p class="note">${chip(`top ${n(LIST_CAP)}`, 'warn')}
              <span class="dim">${esc(
                `The route answers at most ${n(LIST_CAP)} owners and there are more than that on this box: ${n(
                  ownedMissing
                )} ${ownedMissing === 1 ? 'project belongs' : 'projects belong'} to owners below the cut and are not on this list`
              )}</span></p>`
          : `<p class="muted tiny">${esc(
              `Every owner on the box is on this list. The route would answer at most ${n(LIST_CAP)}`
            )}</p>`
      );

      if (orphaned) {
        ownersHost.insertAdjacentHTML(
          'beforeend',
          `<p class="note">${chip('no account', 'warn')}
            <span class="dim">${esc(
              orphaned === 1
                ? '1 owner in this list has no account row left, so its id is shown instead of a name'
                : `${n(orphaned)} owners in this list have no account row left, so their ids are shown instead of names`
            )}. The owner relation cascades on delete, so a project outliving its owner is a cascade that did not fire. Integrity counts these as orphans</span></p>`
        );
      }
    } else {
      ownersHost.innerHTML = emptyState(
        'Nobody is holding any cloud storage',
        'An account appears here as soon as it saves its first project from the editor'
      );
    }

    wireRows();
  }

  /**
   * Fetch, then paint.
   *
   * `measure` is passed rather than read from state because the two calls this
   * page makes are genuinely different requests: the cheap one runs on mount,
   * and the expensive one only when somebody presses the button. Once a walk has
   * been done, later refreshes keep asking for one, since a page that silently
   * dropped back to the cheap half would show the disk figures going stale under
   * a heading that still claims to be measuring.
   */
  async function load(measure, button) {
    state.loading = true;
    state.error = null;

    // Dim rather than blank, but only when there is a previous answer to dim.
    // The first load has skeletons in the container and those are already the
    // loading signal; putting them behind 55% opacity as well makes them nearly
    // invisible on a light ground, which reads as a page that failed to draw.
    if (state.data) body.classList.add('is-stale');
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      if (measure) button.textContent = 'Measuring the disk';
    }

    try {
      const data = await pb.storage(measure ? { measure: 1 } : {});
      if (dead) return;
      state.data = data;
      // Recorded from the REQUEST, not from the response, which is the whole
      // mechanism that lets `disk: null` mean two things. See the header.
      state.measured = measure;

      if (measure) {
        if (data.disk) {
          const capped = data.disk.truncated === true;
          toast(
            `Walked ${capped ? 'at least ' : ''}${n(data.disk.files)} files in ${took(data.disk.ms)}`,
            capped ? '' : 'good'
          );
        } else {
          toast('The disk walk could not read the filesystem', 'bad');
        }
      }
    } catch (err) {
      if (dead) return;
      state.error = err;
      // No toast here. The message is rendered in the page where it can be read
      // twice and copied, and a toast on top of it would be the same sentence
      // fading out of the corner while the operator is still reading it.
    } finally {
      if (!dead) {
        state.loading = false;
        body.classList.remove('is-stale');
        paint();
      }
    }
  }

  paint();
  await load(false, null);

  /*
   * Two things, and the listener is the one that used to be missed.
   *
   * `dead` stops a walk that is still in flight from painting into detached
   * markup or toasting at a page nobody is on. The `removeEventListener` is what
   * stops this view's click handler living on `#view` for the rest of the
   * session and running a second disk walk on the next visit; see the long note
   * beside `onClick`.
   */
  return () => {
    dead = true;
    root.removeEventListener('click', onClick);
  };
}

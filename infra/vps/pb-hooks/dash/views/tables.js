/**
 * Tables, the raw collection browser.
 *
 * Every other page in this dashboard is a shaped answer to a question somebody
 * asked in advance. This one exists for the question nobody asked: it puts the
 * record API on the screen, collection by collection, so that no row on this box
 * is unreachable from here. When Integrity reports drift in a join table, when a
 * `mod_log` entry needs reading back, when a migration lands a column no view
 * knows about yet, this is the page that can still see it.
 *
 * It is READ ONLY, and it says so on itself in two places. That is not a
 * limitation somebody forgot to lift: the two writes on this box that touch
 * content (`moderate` and `recount`) have to run through the hook routes,
 * because deleting a post has to decrement its author's `post_count` and
 * deleting a comment has to decrement its post's `comments`, and neither of
 * those columns is touched by a cascade. A `DELETE` typed here against the raw
 * record API would leave exactly the drift that the Integrity page exists to
 * find. So the raw browser reads, and the pages that write explain what they are
 * about to break before they do it.
 *
 * ## The collection list is fetched, never written down
 *
 * `pb.collections()` is the live list. A hard coded menu is a menu that is wrong
 * the first time somebody adds a migration, and being wrong silently is the
 * worst failure mode a page like this has: an operator who cannot see a
 * collection concludes it does not exist. Everything on this page comes off that
 * response, columns included.
 *
 * ## Two traps that a naive version of this page falls into, both real
 *
 * 1. **`settings` has no `created` column.** It carries `key`, `value`,
 *    `description` and an `updated` autodate, and that is all. A page that
 *    defaults every collection to `sort=-created` answers 400 the moment
 *    somebody picks `settings`, and PocketBase's 400 for an unknown sort column
 *    is the string "Something went wrong while processing your request", which
 *    names nothing and helps nobody. Confirmed against the box, not assumed.
 *    So the default sort is chosen from the collection's OWN field list, and the
 *    sortable headers are the ones that field list actually has. A sort that
 *    cannot be wrong cannot produce that message.
 *
 * 2. **The system collections come back from the same call.** `_superusers`,
 *    `_authOrigins`, `_externalAuths`, `_mfas` and `_otps` are all in the
 *    response with `system: true` and a leading underscore. They are hidden
 *    behind a toggle rather than filtered out, because `_superusers` is
 *    occasionally exactly what somebody needs to look at: who can get into this
 *    box is a fair question to ask of a dashboard about this box. Their secret
 *    columns are not a hazard here, `password` and `tokenKey` carry
 *    `hidden: true` in the schema and the record API never returns them, but
 *    this page still refuses to ask for them by name so that the request itself
 *    is clean in a proxy log.
 *
 * ## Wide columns are left out of the list request on purpose
 *
 * `posts` alone carries `search_text` at 1200 characters, `caption` at 600, and
 * three blob-ish columns (`tags`, `image_meta`, `images`). Fifty of those rows
 * is most of a megabyte across the wire so that a table can render the first
 * ninety characters of each. The `fields` parameter cuts that down to the
 * columns a table can actually show.
 *
 * The rule that follows from that is the important half: **the page says which
 * columns it left out**. Quietly dropping a column from a raw browser is worse
 * than a slow request, because it teaches an operator that the column is not
 * there. So the omitted names are printed under the table, opening a row fetches
 * the whole record and shows every column, and a toggle pulls the wide ones into
 * the list for anybody who wants them there.
 */

import * as pb from '../pb.js';
import {
  esc,
  n,
  ago,
  stamp,
  chip,
  emptyState,
  errorState,
  skeleton,
  rawJson,
  openDrawer,
  copyText,
  toast,
} from '../ui.js';

/**
 * Fifty rows a page.
 *
 * High enough that paging through a join table is not a chore, low enough that
 * fifty `users` rows with fifteen narrow columns each is still a small response.
 * The sticky table header carries the column names down the page, so a long page
 * stays readable, which is what lets this be fifty rather than twenty.
 */
const PER_PAGE = 50;

/**
 * How much of a text value fits in a cell before it is cut.
 *
 * A cell IS truncated, unlike a column, and the difference matters: a cut string
 * is visible as a cut string, it carries the whole value in its `title`, and the
 * row drawer has it complete. A missing column is invisible, which is why those
 * get named instead.
 *
 * Every text cell is also `nowrap`, which is the half of this that was found by
 * looking at the rendered page rather than by reasoning about it. With wrapping
 * left on, one `search_text` value in a twenty column table turns its row into a
 * paragraph two hundred pixels tall, and three of those fill the screen with
 * four rows. A raw browser is scanned down the id column far more often than it
 * is read across, so one line per row and a sideways scroll inside
 * `.table-wrap` is the right trade. 72 characters is about as much as is worth
 * carrying at that width, and the `title` and the drawer both hold the rest.
 */
const MAX_CELL = 72;

/**
 * What counts as a wide column, from the schema rather than from a list of
 * names, so a collection added next year is classified without touching this
 * file.
 *
 * `json`, `file` and `editor` are blob shaped by definition: an `images` value
 * is an array of six filenames, an `image_meta` value is a parallel array of
 * objects, and neither is readable in a table cell at any width.
 *
 * For plain text the line is the declared maximum. 512 is chosen against what is
 * actually on this box: it keeps `comments.body` (500), `mod_log.note` (512) and
 * `settings.description` (512), which are the columns somebody browsing those
 * tables came to read, and it drops `posts.search_text` (1200),
 * `posts.caption` (600) and `settings.value` (2048), which are the ones that
 * make the response heavy.
 *
 * A text field with `max: 0` is NOT wide. That is not an oversight: PocketBase's
 * own system fields (`collectionRef`, `recordRef`, `fingerprint`, `provider`)
 * declare no maximum at all, and treating "undeclared" as "unbounded" would
 * strip every column off every system collection and leave `_externalAuths`
 * showing nothing but its id.
 */
const WIDE_TYPES = new Set(['json', 'file', 'editor']);
const WIDE_TEXT_MAX = 512;

/** Types whose natural first click is descending, because recent and large are what people look for. */
const DATE_TYPES = new Set(['date', 'autodate']);

/** A PocketBase record id, so one can be rendered in the mono face without a schema lookup. */
const ID_SHAPE = /^[a-z0-9]{15}$/;

/**
 * Collections that have a real detail view elsewhere in this dashboard.
 *
 * The cross link is worth the six lines. Those routes ride on top of whatever
 * list view is underneath them (`app.js` keeps `currentRoute`), so opening a
 * post from here slides the post drawer over this table rather than navigating
 * away from it, and closing the drawer leaves the operator exactly where they
 * were in the row list.
 */
const DETAIL_ROUTE = {
  posts: { hash: 'post', label: 'Open in the post view' },
  users: { hash: 'account', label: 'Open in the account view' },
  cloud_projects: { hash: 'project', label: 'Open in the project view' },
};

/** A collection's fields, under either of the two names PocketBase has used for that key. */
const fieldsOf = (collection) => collection?.fields || collection?.schema || [];

/**
 * The fields worth naming in a request.
 *
 * `hidden: true` fields are dropped first. The API would not return them anyway,
 * so this changes nothing about what lands on screen, but it keeps the word
 * `password` out of the query string of every request this page makes, and a
 * query string is the part of an HTTP call that ends up in every access log
 * between here and the box.
 */
const listedFields = (collection) => fieldsOf(collection).filter((field) => !field.hidden);

const isSystem = (collection) => collection?.system === true || String(collection?.name || '').startsWith('_');

function isWide(field) {
  if (WIDE_TYPES.has(field.type)) return true;
  if (field.type === 'text' && Number(field.max) > WIDE_TEXT_MAX) return true;
  return false;
}

/**
 * Can the record API sort on this column in a way that means anything.
 *
 * Worth being precise about what "cannot" means here, because the box is more
 * permissive than it looks: `sort=-images` on `posts` answers 200, not 400.
 * PocketBase happily orders by the raw stored text of a JSON or file column. It
 * is simply meaningless, since it sorts posts by the alphabetical order of their
 * first filename, so those headers are inert and say why on hover rather than
 * offering an ordering nobody could interpret.
 *
 * A multi-value relation is the same case: the stored value is a JSON array and
 * ordering by its text is ordering by whichever id happens to be first.
 */
function isSortable(field) {
  if (WIDE_TYPES.has(field.type)) return false;
  if (field.type === 'relation' && Number(field.maxSelect) !== 1) return false;
  return true;
}

/**
 * The direction a first click should give.
 *
 * Dates and numbers descend: nobody clicks `created` wanting the oldest row, and
 * nobody clicks `likes` wanting the least liked. Everything else ascends,
 * because Z to A as the opening move on a name column reads as a bug.
 *
 * Tolerates a missing field for the same reason `directionWords` does: on the
 * fallback path the columns came from a row's keys and there is no schema entry
 * behind them, and a header that throws while it is being drawn takes the whole
 * table with it.
 */
const firstDirection = (field) => {
  const type = field?.type || 'text';
  return DATE_TYPES.has(type) || type === 'number' ? 'desc' : 'asc';
};

/**
 * How to say a sort direction out loud, in the words that column deserves.
 *
 * "Descending" is accurate and tells an operator nothing. "Newest first" on a
 * date and "largest first" on a count are the same fact in the reader's terms,
 * and this page is read by somebody who is already halfway through a different
 * problem.
 */
function directionWords(field, dir) {
  const type = field?.type || 'text';
  if (DATE_TYPES.has(type)) return dir === 'desc' ? 'newest first' : 'oldest first';
  if (type === 'number') return dir === 'desc' ? 'largest first' : 'smallest first';
  if (type === 'bool') return dir === 'desc' ? 'true first' : 'false first';
  return dir === 'desc' ? 'Z to A' : 'A to Z';
}

/** Cut a long value and say so with an ellipsis, never with a dash. */
const clip = (text) => (text.length > MAX_CELL ? `${text.slice(0, MAX_CELL)}…` : text);

/**
 * One cell.
 *
 * The field's declared type drives this rather than a guess at the value's
 * shape, which is what stops an empty text column and a false boolean from
 * rendering as the same nothing. `field` can be missing on the fallback path
 * below, where the columns came from the first row's keys instead of a schema,
 * so every branch here tolerates that.
 */
function cell(value, field) {
  const type = field?.type || '';

  if (value === null || value === undefined || value === '') {
    // Not a dash, the house rule forbids one anywhere a person reads. "not set"
    // is also the more honest word: an empty string in a text column and a
    // column that was never filled in are the same thing to the record API.
    return '<span class="muted tiny">not set</span>';
  }

  if (typeof value === 'boolean' || type === 'bool') {
    return value ? chip('yes', 'good') : '<span class="muted tiny">no</span>';
  }

  if (typeof value === 'number' || type === 'number') {
    return `<span class="num">${n(value)}</span>`;
  }

  if (Array.isArray(value) || (value && typeof value === 'object')) {
    const text = (() => {
      try {
        return JSON.stringify(value);
      } catch {
        // A value that will not stringify still has to render something, and
        // this is a browser for raw data: saying so is better than an empty cell
        // that reads as "this column is blank".
        return 'could not be shown here, open the row';
      }
    })();
    return `<span class="mono tiny nowrap" title="${esc(text)}">${esc(clip(text))}</span>`;
  }

  const text = String(value);

  if (DATE_TYPES.has(type) || (text.length > 15 && /^\d{4}-\d{2}-\d{2} /.test(text))) {
    // Relative in the cell and absolute in the tooltip. A table of "3d ago" is
    // scannable in a way that a column of identical looking timestamps is not,
    // and the exact value is one hover away for the moment it matters.
    return `<span class="nowrap muted tiny" title="${esc(stamp(text))}">${esc(ago(text))}</span>`;
  }

  if (ID_SHAPE.test(text)) return `<span class="mono tiny nowrap">${esc(text)}</span>`;

  return `<span class="nowrap" title="${esc(text)}">${esc(clip(text))}</span>`;
}

export async function render(root) {
  /*
   * Two guards that between them stop every stale paint this view can produce.
   *
   * `disposed` is set by the cleanup the router calls before it mounts the next
   * view. `seq` rises on every load, so an answer for `post_likes` that arrives
   * after the operator has already switched to `follows` is dropped rather than
   * painted over the newer table. Both are cheap and both are the difference
   * between a browser that can be clicked through quickly and one that flickers
   * between two collections.
   */
  let disposed = false;
  let seq = 0;

  /*
   * One controller for whatever request is in flight. `pb.list` and `pb.one`
   * both honour a `signal`, and aborting on teardown means a slow page of two
   * thousand join rows is not still being decoded after the view is gone.
   *
   * An aborted fetch throws through `pb.request` as `ApiError(0)`, which would
   * otherwise land in the error state of a table nobody is looking at. The `seq`
   * and `disposed` checks in the catch are what keep that off the screen.
   */
  let controller = null;

  /*
   * ## The page head goes up BEFORE the collection list is asked for
   *
   * This used to `await pb.collections()` as the first statement in the render
   * and write nothing at all until it answered. The router empties `#view` on
   * its way here, so for the whole of that request the operator had a blank
   * rectangle under the nav: no title, no "Tables", not even a skeleton, and
   * nothing to say which page they were on. Caught on the live box at NINE
   * seconds during a socket stall, and it is indistinguishable from a dashboard
   * that crashed. Every other view in this build puts its chrome up first and
   * fills it in afterwards.
   *
   * So the head is written now, and everything that genuinely needs the
   * collection list (the picker, the filter row, the card) goes into `#tb-boot`
   * once it arrives. The three outcomes of the request all land in that same
   * container, which is what keeps the heading standing over an error or an
   * empty list instead of the page blanking back to one sentence.
   */
  root.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Tables</h2>
        <div class="sub">Every collection on this box, row by row, exactly as the record API returns it. Read only, nothing on this page writes</div>
      </div>
      <div class="page-tools">
        ${chip('read only', 'accent')}
      </div>
    </div>

    <div id="tb-boot">${skeleton('rows', 6)}</div>`;

  const boot = root.querySelector('#tb-boot');

  let collections = [];
  try {
    collections = await pb.collections();
  } catch (err) {
    if (disposed) return;
    boot.innerHTML = errorState('Could not list the collections on this box', err);
    return;
  }
  if (disposed) return;

  if (!collections.length) {
    boot.innerHTML = emptyState(
      'No collections came back',
      'The record API answered with an empty list, which on a working box should never happen. Check that this token is a superuser token'
    );
    return;
  }

  /*
   * A pasted `#/tables/_superusers` has to work on a cold load, so the hash is
   * read before the toggle is decided and the toggle follows the hash rather
   * than the other way round. A link that lands on a hidden collection and then
   * hides it again would be a link that does not work, which defeats the point
   * of the route carrying the collection name at all.
   */
  const wanted = decodeURIComponent((location.hash.split('/')[2] || '').trim());
  let current =
    collections.find((c) => c.name === wanted) ||
    collections.find((c) => c.name === 'posts') ||
    collections.find((c) => !isSystem(c)) ||
    collections[0];

  let showSystem = isSystem(current);
  let showWide = false;
  let page = 1;
  let filter = '';
  let total = 0;
  let rows = [];
  let firstLoad = true;

  let sortCol = '';
  let sortDir = 'desc';

  /*
   * Into `#tb-boot`, replacing the skeleton, and NOT into `root`: the page head
   * written above is already on screen and rewriting `root` here would take it
   * down and put an identical one back, which is a flash for no reason. Every
   * `root.querySelector` below still finds what it is looking for, because the
   * boot container is inside `root`.
   */
  boot.innerHTML = `
    <!--
      Neither control below carries a width any more. The base form control rule
      is width 100%, which is right for a field stacked in a .field and wrong for
      one sitting in a .filter-row: as a flex item a 100% basis takes the entire
      row and pushes every other control onto its own line. That was the gap this
      file wrote up and worked around with two inline widths, and styles.css now
      closes it under .filter-row input and .filter-row select. The filter box
      keeps its wider measure because it is .mono and the sheet keys off that: a
      filter expression is a line of code and needs the room. The small screen
      block already sets flex none on .filter-row children, so both survive the
      responsive case unchanged.

      Note for anyone editing this block: it lives inside a template literal, so
      a backtick in here ends the string. That is exactly how this file shipped
      broken once, and node --check on a .js file did not catch it because the
      truncated remainder still parsed as a script.
    -->
    <div class="filter-row">
      <select id="tb-collection" aria-label="Collection"></select>
      <button class="chip chip-btn" id="tb-system" type="button" aria-pressed="false">System collections</button>
      <button class="chip chip-btn" id="tb-wide" type="button" aria-pressed="false">Wide columns</button>
      <input id="tb-filter" type="text" class="mono" spellcheck="false" aria-label="PocketBase filter"
             placeholder='Filter, for example hidden = true' />
      <button class="btn btn-sm" id="tb-run" type="button">Apply filter</button>
    </div>

    <div class="card" id="tb-card">
      <div class="card-head">
        <div>
          <h3 id="tb-title"></h3>
          <div class="sub" id="tb-sortnote"></div>
        </div>
        <span class="spacer"></span>
        <span class="muted tiny" id="tb-total"></span>
      </div>
      <div id="tb-slot"></div>
    </div>`;

  const card = root.querySelector('#tb-card');
  const slot = root.querySelector('#tb-slot');
  const picker = root.querySelector('#tb-collection');
  const filterInput = root.querySelector('#tb-filter');

  // ------------------------------------------------------------- columns ---

  /**
   * The columns this list will ask for, and the ones it will not.
   *
   * The fallback matters more than it looks. If a collection's field list came
   * back empty for any reason, a page that renders "no columns" is a page that
   * has lost the collection entirely, so it falls back to the keys of the first
   * row it actually received and says as much under the table. Nothing on this
   * box does that today, and this page's whole job is to still work on the day
   * something does.
   */
  function plan(sample) {
    const listed = listedFields(current);

    if (!listed.length) {
      const keys = Object.keys(sample || {}).filter((key) => key !== 'collectionId' && key !== 'collectionName');
      return { columns: keys, omitted: [], fields: '', fromSample: true };
    }

    const kept = listed.filter((field) => field.name === 'id' || showWide || !isWide(field));
    const omitted = listed.filter((field) => !kept.includes(field));
    return {
      columns: kept.map((field) => field.name),
      omitted: omitted.map((field) => field.name),
      // Named explicitly even when nothing is omitted, so the request this page
      // makes is always the request this page describes.
      fields: kept.map((field) => field.name).join(','),
      fromSample: false,
    };
  }

  const fieldByName = (name) => listedFields(current).find((field) => field.name === name) || null;

  /**
   * The default sort for a collection, decided from its own columns.
   *
   * `created` first because almost everything here is an event log of some kind
   * and the newest row is the one somebody came to see. `updated` second, for
   * the collections that only have that one. Nothing at all last, which is the
   * `settings` case and the case for any view collection a migration adds later:
   * no sort is a legitimate answer and the readout says so rather than pretending
   * the order means something.
   */
  function defaultSort() {
    const names = new Set(listedFields(current).map((field) => field.name));
    if (names.has('created')) return { col: 'created', dir: 'desc' };
    if (names.has('updated')) return { col: 'updated', dir: 'desc' };
    return { col: '', dir: 'desc' };
  }

  const sortParam = () => (sortCol ? `${sortDir === 'desc' ? '-' : ''}${sortCol}` : '');

  // ------------------------------------------------------------- chrome ----

  function paintPicker() {
    const app = collections.filter((c) => !isSystem(c));
    const system = collections.filter(isSystem);
    const option = (c) =>
      `<option value="${esc(c.name)}"${c.name === current.name ? ' selected' : ''}>${esc(c.name)}</option>`;

    picker.innerHTML =
      `<optgroup label="Collections">${app.map(option).join('')}</optgroup>` +
      (showSystem && system.length
        ? `<optgroup label="System, PocketBase's own">${system.map(option).join('')}</optgroup>`
        : '');

    const systemToggle = root.querySelector('#tb-system');
    systemToggle.setAttribute('aria-pressed', showSystem ? 'true' : 'false');
    systemToggle.classList.toggle('is-on', showSystem);

    const wideToggle = root.querySelector('#tb-wide');
    wideToggle.setAttribute('aria-pressed', showWide ? 'true' : 'false');
    wideToggle.classList.toggle('is-on', showWide);
  }

  function paintHead() {
    root.querySelector('#tb-title').textContent = current.name;

    const note = root.querySelector('#tb-sortnote');
    if (!sortCol) {
      note.textContent = `No sort, ${current.name} has no created or updated column so the box returns these in its own order`;
    } else {
      note.textContent = `Sorted by ${sortCol}, ${directionWords(fieldByName(sortCol), sortDir)}`;
    }
  }

  // -------------------------------------------------------------- loading --

  async function load() {
    const mine = ++seq;

    // Never a skeleton on a refetch. The first load has nothing to hold, so it
    // gets the loading shape; every load after that holds the previous answer at
    // reduced opacity, which says "this is last time's rows" without the page
    // jumping under a hand that is already reaching for the next control.
    if (firstLoad) slot.innerHTML = `<div class="card-body">${skeleton('rows', 8)}</div>`;
    else card.classList.add('is-stale');

    controller?.abort();
    controller = new AbortController();

    const shape = plan(rows[0]);

    try {
      const result = await pb.list(current.name, {
        page,
        perPage: PER_PAGE,
        sort: sortParam(),
        filter,
        fields: shape.fields,
        signal: controller.signal,
      });
      if (disposed || mine !== seq) return;

      total = result.totalItems || 0;
      rows = result.items || [];
      firstLoad = false;
      paintRows(plan(rows[0]));
    } catch (err) {
      if (disposed || mine !== seq) return;
      firstLoad = false;
      paintError(err);
    } finally {
      if (!disposed && mine === seq) card.classList.remove('is-stale');
    }
  }

  /**
   * The it-broke state, with a hint the server did not give.
   *
   * PocketBase answers a bad sort column and a bad filter with the same opaque
   * sentence, "Something went wrong while processing your request", and a status
   * of 400. Confirmed by asking the box for `sort=-created` on `settings`. That
   * message is true and useless, so the real message is shown as the house rules
   * require AND the two things it is nearly always about are named underneath.
   */
  function paintError(err) {
    const status = err && typeof err === 'object' ? err.status : 0;
    const hint =
      status === 400
        ? 'A 400 here is almost always the filter text or the sort column. The box does not say which, so try clearing the filter first'
        : status === 404
          ? 'That collection is not on this box any more. Reload the page to pick up the current list'
          : '';

    // A `div` and not a `p`, here and everywhere else on this page. The sheet
    // resets `h1` through `h4` and `body`, and nothing else, so a `p` still
    // carries the user agent's `margin: 1em 0` and would open a gap the layout
    // did not ask for, most visibly inside `.drawer-body`, which is a grid with
    // its own gap already.
    slot.innerHTML =
      `<div class="card-body">${errorState(`Could not read ${current.name}`, err)}` +
      (hint ? `<div class="muted tiny">${esc(hint)}</div>` : '') +
      '</div>';
    root.querySelector('#tb-total').textContent = '';
  }

  function paintRows(shape) {
    const { columns, omitted, fromSample } = shape;

    root.querySelector('#tb-total').textContent = `${n(total)} ${total === 1 ? 'row' : 'rows'}`;
    paintHead();

    if (!rows.length) {
      slot.innerHTML = `<div class="card-body">${
        filter
          ? emptyState(
              'Nothing matched that filter',
              'Clear the filter to see every row again, or check the names in it against the column headers'
            )
          : emptyState(
              `Nothing in ${current.name} yet`,
              'This collection fills as the app writes to it, so an empty one usually means the feature behind it has not been used on this box'
            )
      }</div>`;
      return;
    }

    /*
     * The header cells.
     *
     * `th.sortable` plus `tabindex="0"` rather than a `<button>` inside the
     * header. The sheet draws the affordance on the `th` itself (cursor, hover
     * ink, and a `.arrow` slot), and a nested button would inherit the sticky
     * header's uppercase 10.5px run while overriding its size and weight, which
     * comes out looking like a different control in every column.
     *
     * `aria-sort` is what carries the state to a screen reader, and the tabindex
     * is what makes the header reachable without a mouse. Enter and Space are
     * handled below, so the keyboard path and the pointer path do the same
     * thing.
     */
    const head = columns
      .map((name) => {
        const field = fieldByName(name);
        const numeric = field?.type === 'number';
        const classes = ['sortable'];
        if (numeric) classes.push('num');

        if (field && !isSortable(field)) {
          return `<th${numeric ? ' class="num"' : ''} title="${esc(
            `${name} is a ${field.type} column. The box would order it by its raw stored text, which would not mean anything`
          )}">${esc(name)}</th>`;
        }

        const active = sortCol === name;
        const ariaSort = active ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none';
        /*
         * `aria-hidden` on the arrow, which accounts.js already writes on its
         * three and this file did not.
         *
         * Without it the glyph is part of the header's accessible NAME, so the
         * sorted column announces as "created" plus whatever the screen reader
         * decides to call U+25BE, which on the boxes that read it at all comes
         * out as "created down-pointing small triangle". The state is already
         * carried properly by `aria-sort` right beside it, so the arrow has
         * nothing to add for a reader who cannot see it: it is the same fact,
         * said worse, glued onto the column name.
         */
        const arrow = active
          ? `<span class="arrow" aria-hidden="true">${sortDir === 'desc' ? '▾' : '▴'}</span>`
          : '';
        // The tooltip says what the NEXT click does, not what the column is,
        // because the answer changes once the column is already the sorted one
        // and "Sort by created" on a column that is plainly sorted by created
        // reads as a control that has stopped working.
        const hint = active
          ? `Sort by ${name}, ${directionWords(field, sortDir === 'desc' ? 'asc' : 'desc')}`
          : `Sort by ${name}, ${directionWords(field, firstDirection(field))}`;
        return `<th class="${classes.join(' ')}" tabindex="0" role="columnheader" aria-sort="${ariaSort}"
          data-sort="${esc(name)}" title="${esc(hint)}">${esc(name)}${arrow}</th>`;
      })
      .join('');

    const body = rows
      .map((row, index) => {
        const cells = columns
          .map((name) => {
            const field = fieldByName(name);
            const numeric = field?.type === 'number';
            return `<td${numeric ? ' class="num"' : ''}>${cell(row[name], field)}</td>`;
          })
          .join('');
        // The Open button is not decoration next to the clickable row: it is the
        // keyboard path. A `<tr>` with a tabindex reads as a control to a screen
        // reader and stops reading as a row, so the row stays a row and the
        // button is the thing that takes focus.
        return `<tr class="clickable" data-row="${index}">${cells}
          <td><button class="btn btn-ghost btn-sm" type="button" data-row="${index}">Open</button></td></tr>`;
      })
      .join('');

    const pages = Math.max(1, Math.ceil(total / PER_PAGE));

    slot.innerHTML = `
      <div class="table-wrap">
        <table class="data">
          <thead><tr>${head}<th scope="col">Row</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      <div class="card-body">
        <div class="muted tiny">${esc(omittedNote(omitted, fromSample))}</div>
        <div class="pager">
          <button class="btn btn-sm" type="button" data-page="prev"${page <= 1 ? ' disabled' : ''}>Previous</button>
          <span>Page ${n(page)} of ${n(pages)}</span>
          <button class="btn btn-sm" type="button" data-page="next"${page >= pages ? ' disabled' : ''}>Next</button>
          <span class="spacer"></span>
          <span>${n(rows.length)} of ${n(total)} shown</span>
        </div>
      </div>`;
  }

  /**
   * The sentence that keeps this page honest.
   *
   * Whatever was left out of the request is named here, every time, including
   * the case where nothing was. "All of them are here" and "three of them are
   * not" have to be different sentences, or an operator has no way to tell a
   * narrow collection from a trimmed one.
   */
  function omittedNote(omitted, fromSample) {
    if (fromSample) {
      return 'This collection returned no field list, so these columns are the keys of the first row. Open a row to see everything it holds';
    }
    if (showWide) {
      return 'Every column is being requested, wide ones included. Turn Wide columns off if the list feels slow';
    }
    if (!omitted.length) {
      return 'Every column on this collection fits in a table, so all of them are here';
    }
    const one = omitted.length === 1;
    return (
      `Left out of this list to keep the request small: ${omitted.join(', ')}. ` +
      `Open a row to read ${one ? 'it' : 'them'} whole, or turn on Wide columns to pull ${one ? 'it' : 'them'} into the table`
    );
  }

  // --------------------------------------------------------------- drawer --

  /**
   * One row, complete, as formatted JSON.
   *
   * The row already in hand is not what gets shown. The list was fetched with a
   * `fields` list, so the row in memory is missing exactly the columns somebody
   * opening it is most likely to be after, and showing a trimmed record under a
   * heading that says "the whole row" would be a lie the page told itself. So the
   * drawer opens immediately with a loading shape and fetches the record on its
   * own, which is one request against a primary key.
   *
   * When that fetch fails, the trimmed row is shown rather than nothing, clearly
   * labelled as the trimmed one. A record that was deleted between the list and
   * the click is a real case on a box being moderated, and half an answer with a
   * reason beats an empty drawer.
   */
  let drawerSeq = 0;
  async function openRow(index) {
    const listed = rows[index];
    if (!listed) return;

    const mine = ++drawerSeq;
    const id = String(listed.id || '');
    const detail = DETAIL_ROUTE[current.name];

    const drawer = openDrawer(`
      <div class="drawer-head">
        <div>
          <h3>${esc(current.name)}</h3>
          <div class="sub mono">${esc(id || 'no id on this row')}</div>
        </div>
        <span class="spacer"></span>
        <button class="icon-btn" type="button" data-close aria-label="Close">✕</button>
      </div>
      <div class="drawer-body" id="tb-drawer-body">${skeleton('rows', 3)}</div>`);
    if (!drawer) return;

    const paint = (record, note, kind) => {
      const body = drawer.querySelector('#tb-drawer-body');
      if (!body) return;
      const columnCount = Object.keys(record || {}).length;
      body.innerHTML = `
        <div class="chip-row">
          ${chip('read only', 'accent')}
          ${chip(`${columnCount} ${columnCount === 1 ? 'column' : 'columns'}`)}
          ${kind === 'bad' ? chip('trimmed row', 'warn') : ''}
        </div>
        <div class="muted tiny">${esc(note)}</div>
        ${rawJson('Row', record)}
        <div class="btn-row">
          <button class="btn btn-sm" type="button" data-copy="json">Copy JSON</button>
          ${id ? '<button class="btn btn-sm" type="button" data-copy="id">Copy id</button>' : ''}
          ${detail && id ? `<button class="btn btn-sm" type="button" data-detail="1">${esc(detail.label)}</button>` : ''}
        </div>`;

      // Open by default. The drawer exists to show the JSON, so leaving the
      // disclosure shut would cost every single visit an extra click for
      // nothing.
      body.querySelector('details.raw')?.setAttribute('open', '');

      body.querySelector('[data-copy="json"]')?.addEventListener('click', () => {
        try {
          copyText(JSON.stringify(record, null, 2));
        } catch {
          toast('That row could not be turned into JSON', 'bad');
        }
      });
      body.querySelector('[data-copy="id"]')?.addEventListener('click', () => copyText(id));
      body.querySelector('[data-detail]')?.addEventListener('click', () => {
        window.__dash.go(`#/${detail.hash}/${id}`);
      });
    };

    if (!id) {
      // No primary key to refetch by, which should not happen and is survivable.
      paint(listed, 'This row came back without an id, so it is shown exactly as the list returned it', 'bad');
      return;
    }

    try {
      const record = await pb.one(current.name, id);
      if (disposed || mine !== drawerSeq) return;
      paint(record, `Every column on this record, straight from the record API. ${current.name} is not editable from this page`, '');
    } catch (err) {
      if (disposed || mine !== drawerSeq) return;
      const body = drawer.querySelector('#tb-drawer-body');
      if (!body) return;
      const message = err?.message || 'No detail was returned';
      paint(
        listed,
        `The full record could not be fetched, so this is the trimmed row from the list. The box said: ${message}`,
        'bad'
      );
    }
  }

  // --------------------------------------------------------------- events --

  /**
   * One delegated click handler on the card.
   *
   * The table markup is rebuilt on every load, so anything bound to a `<th>` or
   * a `<tr>` directly would be bound to elements that no longer exist by the
   * second page. Delegation on the card survives every repaint and is one
   * listener rather than one per row.
   */
  card.addEventListener('click', (ev) => {
    const sortHeader = ev.target.closest('th[data-sort]');
    if (sortHeader) {
      applySort(sortHeader.dataset.sort).catch(() => {});
      return;
    }

    const pageButton = ev.target.closest('[data-page]');
    if (pageButton) {
      page += pageButton.dataset.page === 'next' ? 1 : -1;
      if (page < 1) page = 1;
      load();
      return;
    }

    const rowTarget = ev.target.closest('[data-row]');
    if (rowTarget) openRow(Number(rowTarget.dataset.row));
  });

  /*
   * Enter and Space on a focused header, so the sort is reachable without a
   * pointer. Space is prevented because its default on a focusable element is a
   * page scroll, and scrolling the table out from under the header somebody just
   * pressed is a small betrayal.
   */
  card.addEventListener('keydown', (ev) => {
    const sortHeader = ev.target.closest?.('th[data-sort]');
    if (!sortHeader) return;
    if (ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar') return;
    ev.preventDefault();
    applySort(sortHeader.dataset.sort).catch(() => {});
  });

  /**
   * Sorting rules, which are the ordinary ones and worth stating anyway: a new
   * column takes its natural first direction, the column already sorted flips.
   * Page goes back to one, because page four of the old ordering is a different
   * set of rows from page four of the new one and staying there looks like the
   * sort did nothing.
   *
   * ## Why this is async, and why it puts focus back
   *
   * The bug: Tab to a `th.sortable`, press Enter, and the sort worked, the
   * `aria-sort` updated, the rows reordered, and FOCUS went to `<body>`.
   * Reaching the next header then meant tabbing in from the top of the document,
   * which on the `posts` table is seventeen stops away, so sorting two columns
   * from the keyboard cost about thirty-five keypresses.
   *
   * The cause is that `paintRows` rewrites the whole table, `<thead>` included,
   * so the element that had focus is detached mid-keystroke and the browser has
   * nowhere to put it but the document. accounts.js does the same operation and
   * does not lose focus, purely because it re-renders its `<tbody>` and leaves
   * its three headers standing. Rebuilding the head here is not wrong (the
   * columns genuinely change with the collection), so the fix is to put focus
   * back on the header that has just been rebuilt.
   *
   * Three guards, because a focus call is a rude thing to get wrong:
   *
   *   - it only restores focus if focus was ON a sortable header to begin with,
   *     so a sort triggered any other way cannot yank the caret out of the
   *     filter box;
   *   - it checks `sortCol` still names this column, which is how a second,
   *     faster click that superseded this load leaves the restore alone;
   *   - `preventScroll`, because `.data thead th` is sticky. Without it the
   *     browser scrolls the header's UNSTUCK position into view, which throws
   *     the page back to the top of a table the operator had scrolled down.
   *
   * The header is found by scanning `data-sort` rather than with a selector, so
   * a column name is never concatenated into CSS. PocketBase field names are
   * tame today; a selector built from data is a habit that stops being safe
   * quietly.
   */
  async function applySort(name) {
    const field = fieldByName(name);
    if (field && !isSortable(field)) return;

    if (sortCol === name) sortDir = sortDir === 'desc' ? 'asc' : 'desc';
    else {
      sortCol = name;
      sortDir = field ? firstDirection(field) : 'desc';
    }
    page = 1;

    const fromHeader = !!document.activeElement?.closest?.('th[data-sort]');
    await load();
    if (disposed || !fromHeader || sortCol !== name) return;

    const th = [...card.querySelectorAll('th[data-sort]')].find((cell) => cell.dataset.sort === name);
    th?.focus({ preventScroll: true });
  }

  /**
   * Switching collection resets everything that was about the old one.
   *
   * The filter especially. A filter written against `posts` is almost certainly
   * a 400 against `follows`, and carrying it across would greet the operator
   * with an error on a collection they have not typed anything about yet.
   */
  picker.addEventListener('change', () => {
    const next = collections.find((c) => c.name === picker.value);
    if (!next) return;
    current = next;
    page = 1;
    filter = '';
    rows = [];
    firstLoad = true;
    filterInput.value = '';
    const preferred = defaultSort();
    sortCol = preferred.col;
    sortDir = preferred.dir;

    // `replaceState` rather than assigning the hash: the router treats extra
    // segments after a route id as the view's business and ignores them, so
    // this keeps the URL pasteable without tearing the page down and rebuilding
    // it on every change of collection.
    history.replaceState(null, '', `#/tables/${encodeURIComponent(current.name)}`);
    paintPicker();
    paintHead();
    load();
  });

  root.querySelector('#tb-system').addEventListener('click', () => {
    showSystem = !showSystem;
    // Turning the toggle off while a system collection is open would leave the
    // page showing rows from a collection that is no longer in its own menu, so
    // the selection falls back to the first ordinary one.
    if (!showSystem && isSystem(current)) {
      current = collections.find((c) => !isSystem(c)) || current;
      page = 1;
      filter = '';
      rows = [];
      firstLoad = true;
      filterInput.value = '';
      const preferred = defaultSort();
      sortCol = preferred.col;
      sortDir = preferred.dir;
      history.replaceState(null, '', `#/tables/${encodeURIComponent(current.name)}`);
      paintPicker();
      paintHead();
      load();
      return;
    }
    paintPicker();
  });

  root.querySelector('#tb-wide').addEventListener('click', () => {
    showWide = !showWide;
    page = 1;
    paintPicker();
    load();
  });

  const runFilter = () => {
    filter = filterInput.value.trim();
    page = 1;
    load();
  };
  root.querySelector('#tb-run').addEventListener('click', runFilter);
  filterInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') runFilter();
  });

  // ----------------------------------------------------------- first paint --

  /*
   * Deliberately no `replaceState` here, only on a change the operator made.
   *
   * The refresh button remounts whatever route is on screen, and a detail route
   * rides on top of this one: refreshing while `#/post/<id>` is open runs this
   * render with that hash still in the bar, and the shell then checks the hash
   * is unchanged before it opens the post drawer. Rewriting the URL to
   * `#/tables/posts` on the way in would fail that check and swallow the drawer,
   * which presents as the refresh button quietly closing whatever was open.
   */
  const preferred = defaultSort();
  sortCol = preferred.col;
  sortDir = preferred.dir;
  paintPicker();
  paintHead();
  await load();

  /*
   * The cleanup. The router runs this before it mounts the next view.
   *
   * Aborting the in flight request is the point of it: this page is the one
   * somebody clicks away from mid load, because a two thousand row join table is
   * the slowest thing in the dashboard and the reason they came was probably to
   * check one id.
   */
  return () => {
    disposed = true;
    controller?.abort();
  };
}

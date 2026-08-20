/**
 * Comments — the moderation queue, and the page that resolves the rail badge.
 *
 * ## Why this page exists at all when the post drawer already lists comments
 *
 * A comment is only visible from the post it hangs off, so without this page the
 * only way to find a bad one is to already know which post it is on. That is the
 * wrong way round: the operator arrives knowing that *something* was reported or
 * that thirteen things are hidden, and not which posts they belong to. So this
 * is the one view that reads the `comments` collection as a flat list, newest
 * first, across every post on the box.
 *
 * ## The rail badge is resolved here, and nowhere else
 *
 * `app.js` fills the three rail badges from `stats` on boot and after a
 * navigation, which is fine for a number that only has to say "there is
 * something here". It is not fine after an operator hides four comments on this
 * page: the badge would keep claiming the old number until they navigated away
 * and back. So every load here recomputes the hidden count with its own small
 * `count` call and pushes it into `window.__dash.setRailCount('comments', …)`.
 * That is deliberately a SECOND source for the same number rather than a reuse
 * of `stats`: `stats` is one wide aggregate over eleven tables and this page
 * needs one integer, and asking for the wide one on every hide would make the
 * cheapest action on the page the most expensive request in the dashboard.
 *
 * The same count also labels the Hidden filter, so the queue says how much work
 * is in it before you switch to it. A filter tab that has to be pressed to find
 * out whether it is empty is a filter tab nobody presses.
 *
 * ## Hide and delete are not two strengths of the same action
 *
 * Hiding sets one boolean. The row stays, its likes stay real, and
 * `posts.comments` does not move, because a hidden comment still exists and the
 * thread it is in is still that long. Deleting removes the row AND decrements
 * `posts.comments` on the post it was on, which is the half a raw record delete
 * would miss and exactly the drift the Integrity page hunts for. That is why
 * neither action goes through `pb.remove` or `pb.update` here: both go through
 * `pb.moderate`, which does the counter work inside a transaction and writes the
 * audit line. See the `moderate` route in `100_dash.pb.js`.
 *
 * The server writes the sentence that describes what it did, in `note`, and this
 * page shows that sentence rather than inventing its own. "deleted, the post
 * comment count went from 4 to 3" is a fact about what happened; anything this
 * file could say instead would be a guess about what it expected to happen.
 *
 * ## No realtime subscription, on purpose
 *
 * `pulse.js` subscribes to `comments` and that is the right place for it: a feed
 * of arrivals is something you watch. A queue is something you work, and a queue
 * that reorders itself under a selection is how the wrong row gets deleted. Two
 * ticks made on page one, a new comment lands, the page reflows, and the third
 * tick is now on a different comment than the eye was on. So this view is
 * fetched, and the topbar refresh button remounts it when the operator wants a
 * newer answer. The only thing handed back as cleanup is the debounce timer, the
 * hash listener and the liveness flag.
 */

import * as pb from '../pb.js';
import {
  esc,
  n,
  ago,
  stamp,
  avatar,
  nameOf,
  handleOf,
  chip,
  toast,
  confirmAction,
  emptyState,
  errorState,
  skeleton,
  newRef,
} from '../ui.js';

/**
 * Thirty a page, matching the other moderation surface in this dashboard rather
 * than the fifty used by the flat account table. A queue row is two lines of
 * free text plus four buttons, so thirty of them is already a long scroll, and
 * the bulk bar is sticky precisely because reaching the bottom of one page is a
 * journey.
 */
const PER_PAGE = 30;

/** Columns in the table, so an empty or error row can span the whole width. */
const COLUMNS = 7;

/**
 * How much of a body goes in the cell.
 *
 * `comments.body` is 500 characters and almost all of them are one short line,
 * but the long ones exist and a table cell is not where they get to be long. The
 * full text is always on the row's `title` attribute, which is what the brief
 * asks for and what makes the truncation lossless: hover, or focus the row with
 * a keyboard, and the whole thing is there.
 *
 * Truncation is done here in JavaScript rather than with `.truncate` and a fixed
 * pixel width, because a `white-space: nowrap` cell inside `.table-wrap` widens
 * the table until it scrolls sideways, and a queue whose Delete button has
 * scrolled off the right edge is worse than a body that wraps to two lines.
 */
const BODY_LIMIT = 96;

/** Same idea one column over, where a post title only has to be recognisable. */
const TITLE_LIMIT = 44;

/**
 * The three filters, as PocketBase filter expressions.
 *
 * '' is the default and sends no filter at all rather than `hidden = true ||
 * hidden = false`, which would be the same rows and a needless scan.
 *
 * The keys double as the deep link segment: `#/comments/hidden` is a pastable
 * link to the hidden queue. `app.js` `parseHash` treats anything after a route
 * id as belonging to the view and does not remount on it, which is what lets the
 * filter live in the URL without tearing the table down every time it changes.
 */
const FILTERS = {
  visible: 'hidden = false',
  hidden: 'hidden = true',
};

/**
 * The fields pulled per row, including the two expansions.
 *
 * Named explicitly rather than taking the default, because the default on a
 * relation expansion is the WHOLE related record: `expand.post` would arrive
 * carrying `search_text` (1200 characters), `image_meta`, `tags_text` and the
 * image filename array for every one of thirty rows, to render a title. Asking
 * for three columns of it instead is the difference between a page of this queue
 * costing a few kilobytes and costing most of a megabyte on a busy board.
 *
 * `expand.author.banned` is here because a banned author's comments are still in
 * the thread: banning stops them writing, it does not retract what they wrote.
 * Seeing the chip in this list is how an operator notices there is a second job
 * to do. `expand.post.hidden` is here for the same reason in the other
 * direction: a comment on a hidden post is already invisible to everyone, so
 * hiding it too is work nobody needed.
 */
const FIELDS = [
  'id',
  'body',
  'likes',
  'hidden',
  'created',
  'post',
  'author',
  'expand.author.id',
  'expand.author.name',
  'expand.author.display_name',
  'expand.author.handle',
  'expand.author.avatar',
  'expand.author.banned',
  'expand.post.id',
  'expand.post.title',
  'expand.post.hidden',
].join(',');

/**
 * A PocketBase record id, checked before it is pasted into a filter string.
 *
 * The gap-fill lookups below build `id = "…" || id = "…"` by hand, and the ids
 * going into it came off the wire. Nothing on this box can currently put a quote
 * in a relation column, but "currently" is doing a lot of work in that sentence
 * and a filter string is the one place in this file where a stray character
 * stops being a display bug and starts being a query somebody else wrote.
 */
const SAFE_ID = /^[a-z0-9]{15}$/;

/** `id = "a" || id = "b"`, which is how PocketBase spells `IN`. */
const orIds = (ids) => ids.map((id) => `id = "${id}"`).join(' || ');

/** 'comment' or 'comments', so no string in this file reads "1 comments". */
const plural = (count, word) => (count === 1 ? word : `${word}s`);

/**
 * One line of free text, fit for a table cell.
 *
 * Whitespace is collapsed before the length is measured, and that ordering is
 * the point: a body that opens with six blank lines would otherwise spend its
 * whole budget on nothing and truncate to an empty string, which reads on screen
 * as a comment with no text in it. The ellipsis is a real ellipsis character
 * rather than three periods so it cannot be mistaken for part of the sentence.
 */
function clampText(value, limit) {
  const text = String(value === null || value === undefined ? '' : value)
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}

export async function render(root) {
  let page = 1;
  let total = 0;
  let hiddenTotal = null;
  let only = filterFromHash();
  let firstPaint = true;

  /*
   * Set false by the cleanup the router calls before mounting the next view.
   *
   * Every await in this file is followed by a check on it, because a fetch that
   * resolves into a view that is no longer on screen will happily write its rows
   * into a detached element and, worse, push a stale number into the rail badge
   * of a page the operator has already left.
   */
  let alive = true;

  /*
   * Which load is the current one.
   *
   * A generation counter rather than an `AbortController` alone, because
   * `pb.js` turns an aborted fetch into `ApiError(0, 'Could not reach the
   * server')`, exactly the same shape a real network failure gets. Aborting a
   * superseded request and then rendering its error would tell the operator the
   * box was down when all that happened was that they pressed a second filter.
   * The controller is still used, to stop the wire work; this counter decides
   * who is allowed to paint.
   */
  let generation = 0;
  let inFlight = null;

  /*
   * Who is ticked, and enough about them to write an honest confirm.
   *
   * Explicit selection only. There is no "select everything matching this
   * filter" anywhere on this page: a filter is a query and a delete is a
   * decision, and the two must not be the same gesture. Even the header tick
   * reaches no further than the rows on screen.
   *
   * The body and the hidden flag ride along so the confirm can name what is
   * about to happen without a second fetch, and so a tick made on page one still
   * has a name after paging to page three. The Map lives in this closure, so
   * leaving the view clears it: a selection that survived a navigation would be
   * a selection made against rows nobody can see.
   */
  const picked = new Map();

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Comments</h2>
        <div class="sub">Every comment on the box, newest first, with the hidden ones one click away</div>
      </div>
      <div class="page-tools"><span class="muted tiny" data-total role="status"></span></div>
    </div>

    <div class="filter-row">
      <div class="segmented" data-filter role="group" aria-label="Which comments to show">
        <button type="button" data-value="" aria-pressed="true">All</button>
        <button type="button" data-value="visible" aria-pressed="false">Visible</button>
        <button type="button" data-value="hidden" aria-pressed="false">Hidden <span data-hidden-count></span></button>
      </div>
    </div>

    <div class="bulk-bar" data-bulk-bar hidden>
      <span><strong data-bulk-count>0</strong> selected</span>
      <span class="spacer"></span>
      <button class="btn btn-sm btn-ghost" data-bulk="clear" type="button">Clear</button>
      <button class="btn btn-sm" data-bulk="unhide" type="button">Unhide</button>
      <button class="btn btn-sm" data-bulk="hide" type="button">Hide</button>
      <button class="btn btn-sm btn-danger" data-bulk="delete" type="button">Delete</button>
    </div>

    <div class="card" data-card>
      <div class="card-head">
        <div>
          <h3>The queue</h3>
          <div class="sub">Hiding takes a comment out of its thread and leaves its likes alone. Deleting also drops the comment count on the post it was on</div>
        </div>
      </div>

      <div data-skeleton>${skeleton('rows', 8)}</div>

      <div class="table-wrap" data-table hidden><table class="data">
        <thead><tr>
          <th class="check"><input type="checkbox" data-pick-page aria-label="Select every comment on this page" /></th>
          <th>Comment</th>
          <th>Author</th>
          <th>On post</th>
          <th class="num">Likes</th>
          <th>When</th>
          <th class="nowrap">Actions</th>
        </tr></thead>
        <tbody data-body></tbody>
      </table></div>

      <div class="card-body" data-pager-wrap hidden><div class="pager" data-pager></div></div>
    </div>`;

  const card = root.querySelector('[data-card]');
  const body = root.querySelector('[data-body]');
  const bulkBar = root.querySelector('[data-bulk-bar]');

  /*
   * Every other element this view writes into, held once instead of looked up
   * again each time.
   *
   * That is not a micro optimisation, it is the second half of the crash fix
   * described on `mounted` below: once the shell has emptied `#view`, every one
   * of these `root.querySelector` calls answers null, and a `.hidden =` or a
   * `.textContent =` on null is a thrown TypeError. A reference captured while
   * the markup was still on the page keeps pointing at a real object after it is
   * detached, so the write goes nowhere quietly instead of taking the handler
   * down with it.
   */
  const skeletonBox = root.querySelector('[data-skeleton]');
  const tableWrap = root.querySelector('[data-table]');
  const pagerWrap = root.querySelector('[data-pager-wrap]');
  const pagerBox = root.querySelector('[data-pager]');
  const totalLabel = root.querySelector('[data-total]');
  const hiddenCountEl = root.querySelector('[data-hidden-count]');
  const bulkCount = root.querySelector('[data-bulk-count]');
  const pageTick = root.querySelector('[data-pick-page]');

  /**
   * Is this view still the one on screen, with a session still behind it.
   *
   * THE BUG. Signing out while the first page was still in the air threw
   * `Cannot set properties of null` out of the catch in `load` below, on
   * the `[data-pager-wrap]` line. Reproduced every time on the fixture box:
   * open Comments cold, press Sign out before it paints. The `alive` flag
   * could not stop it and never could: it is flipped by the cleanup the
   * router calls, and on a FIRST load `render()` has not returned that
   * cleanup yet, so the shell has nothing to call. `endSession()` emptied
   * `#view` regardless, and the handler then wrote into markup that no
   * longer existed.
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
  const live = () => alive && mounted();

  /**
   * True while a bulk run is going.
   *
   * THE BUG. `actMany` had no lock of any kind. The confirm covers the first
   * press and nothing covered the rest: a sequential run over thirty rows takes
   * seconds, the bulk bar stayed fully enabled throughout, and a second verb
   * pressed during it started a second interleaved loop over the same `picked`
   * map the first one is deleting from as it goes. Rows landed in both
   * snapshots, took their write twice, and the second run reported the 404s from
   * the rows the first had already deleted as failures. The operator was told a
   * delete had failed when it had in fact succeeded, twice.
   *
   * `feed.js` has `setBusy` and `accounts.js` has `busy`; this is the same idea
   * with the same shape, so the three moderation surfaces behave alike.
   */
  let busy = false;

  /**
   * Lock everything that would start a second write or move the rows under the
   * run that is going.
   *
   * The pager and the per row action buttons are disabled on the way IN and
   * deliberately not re-enabled on the way out, because the reload that follows
   * a run rebuilds both of them with the state the writes left behind.
   * Re-enabling the old ones here would briefly offer a Next that may no longer
   * exist and a Hide on a row that has just been deleted. Until the reload
   * lands, the `busy` guards in the handlers are what hold the line.
   */
  function setBusy(on) {
    busy = on;
    bulkBar.querySelectorAll('button').forEach((button) => {
      button.disabled = on;
    });
    root.querySelectorAll('[data-filter] button').forEach((button) => {
      button.disabled = on;
    });
    if (on) {
      root.querySelectorAll('[data-pager] button, [data-act]').forEach((button) => {
        button.disabled = true;
      });
    }
    card.setAttribute('aria-busy', on ? 'true' : 'false');
  }

  /**
   * Read the filter out of the hash, so a pasted `#/comments/hidden` works on a
   * cold load and so the browser Back button walks the filters.
   *
   * Anything after the route id that is not one of the two named filters falls
   * back to All rather than to an error. A hash is a thing people edit by hand
   * and a typo in one should show the operator the whole queue, not an empty
   * table that looks like a box with no comments on it.
   */
  function filterFromHash() {
    const bits = String(location.hash || '')
      .replace(/^#\/?/, '')
      .split('/')
      .filter(Boolean);
    if (bits[0] !== 'comments') return '';
    return FILTERS[bits[1]] ? bits[1] : '';
  }

  /**
   * Paint the segmented control from `only`.
   *
   * `aria-pressed` and not a class, because the control is three buttons rather
   * than a radio group and the pressed state is the only thing telling a screen
   * reader which of the three is in force. The stylesheet hangs the visual
   * treatment off the same attribute, so there is exactly one source of truth.
   */
  function paintFilter() {
    root.querySelectorAll('[data-filter] [data-value]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.value === only));
    });
  }

  // ------------------------------------------------------------- loading ---

  /**
   * The two expansions, filled in by hand for any row the server did not expand.
   *
   * `expand` was checked against a running box before this file was written and
   * it does work on these locked collections when the caller is a superuser, so
   * in the normal case this function issues zero requests and returns. It exists
   * for the two cases where it does not:
   *
   *  1. A relation whose target row has gone. Both relations cascade, so a
   *     deleted post takes its comments with it and this should be impossible,
   *     but "should be impossible" is the description of every orphan the
   *     Integrity page counts, and that page exists because cascades have been
   *     known not to fire.
   *  2. A future rule change, or a PocketBase release, that stops expanding a
   *     collection whose list rule is null. The queue would then render thirty
   *     rows of raw ids and look broken, when one extra request per page brings
   *     the names back.
   *
   * Anything still unresolved after this is left unresolved on purpose. The row
   * renderer distinguishes "there is an id and we could not resolve it" from
   * "there is no id at all", and printing the id is more use to whoever has to
   * work out why than a second guess dressed up as a name.
   */
  async function fillGaps(items, signal) {
    const wantAuthors = new Set();
    const wantPosts = new Set();
    for (const row of items) {
      if (row.author && !row.expand?.author && SAFE_ID.test(row.author)) wantAuthors.add(row.author);
      if (row.post && !row.expand?.post && SAFE_ID.test(row.post)) wantPosts.add(row.post);
    }
    if (!wantAuthors.size && !wantPosts.size) return;

    /*
     * Swallowed rather than propagated. A gap fill that fails must not take the
     * whole queue down with it: the rows are already in hand and a table of
     * comments with an id where a name should be is a working moderation queue,
     * while an error card in place of it is not.
     */
    const lookup = async (collection, ids, fields) => {
      if (!ids.size) return new Map();
      try {
        const result = await pb.list(collection, {
          perPage: ids.size,
          filter: orIds([...ids]),
          fields,
          skipTotal: true,
          signal,
        });
        return new Map((result.items || []).map((item) => [item.id, item]));
      } catch (err) {
        console.warn(`openscreengen dash: comments could not resolve ${collection} names`, err);
        return new Map();
      }
    };

    const [authors, posts] = await Promise.all([
      lookup('users', wantAuthors, 'id,name,display_name,handle,avatar,banned'),
      lookup('posts', wantPosts, 'id,title,hidden'),
    ]);

    for (const row of items) {
      if (!row.expand) row.expand = {};
      if (!row.expand.author && authors.has(row.author)) row.expand.author = authors.get(row.author);
      if (!row.expand.post && posts.has(row.post)) row.expand.post = posts.get(row.post);
    }
  }

  /**
   * Fetch a page of the queue, plus the hidden count that feeds the rail badge.
   *
   * The two go out together rather than one after the other, because they are
   * independent questions and answering them in series would put a round trip
   * between pressing Hide and seeing the badge move.
   *
   * The count is wrapped so it cannot fail the page. It is a label on a filter
   * tab and a number on a rail: worth having, never worth an error card in place
   * of thirty rows of work. When it fails the last known value is kept, which is
   * the honest thing to hold: it was true a moment ago.
   */
  async function load(afterRepair = false) {
    const mine = ++generation;
    if (inFlight) inFlight.abort();
    const controller = new AbortController();
    inFlight = controller;

    /*
     * `is-stale` and not a skeleton, on every load but the first. Replacing a
     * table that is already on screen with placeholder bars for 200ms reads as
     * a flicker, and it throws away the answer the operator is still reading.
     * Holding the last render at reduced opacity says "this is the previous
     * answer" without moving a single row.
     */
    if (!firstPaint) card.classList.add('is-stale');

    try {
      const [result, hiddenCount] = await Promise.all([
        pb.list('comments', {
          page,
          perPage: PER_PAGE,
          sort: '-created',
          filter: FILTERS[only] || '',
          expand: 'post,author',
          fields: FIELDS,
          signal: controller.signal,
        }),
        pb.count('comments', 'hidden = true').catch((err) => {
          console.warn('openscreengen dash: comments could not count the hidden ones', err);
          return null;
        }),
      ]);
      if (!live() || mine !== generation) return;

      const items = result.items || [];
      await fillGaps(items, controller.signal);
      if (!live() || mine !== generation) return;

      total = result.totalItems;
      if (hiddenCount !== null) hiddenTotal = hiddenCount;

      /*
       * Deleting the last row of the last page leaves the operator looking at an
       * empty page four with a pager that says there are three. Stepping back
       * once, and only once, is the difference between that and a queue that
       * quietly follows the work down. `afterRepair` is what stops it looping if
       * the arithmetic and the server ever disagree.
       */
      if (!items.length && page > 1 && total > 0 && !afterRepair) {
        page = Math.max(1, Math.ceil(total / PER_PAGE));
        await load(true);
        return;
      }

      paint(items);
      paintTotals();
      pushBadge();
    } catch (err) {
      if (!live() || mine !== generation) return;
      /*
       * The message, not a shrug. A 404 from a record that moved and a 400 from
       * a filter this collection will not accept are different problems with
       * different fixes, and the only place the difference is written down is in
       * the sentence the server sent.
       */
      body.innerHTML = `<tr><td colspan="${COLUMNS}">${errorState('Could not load the comment queue', err)}</td></tr>`;
      revealTable();
      pagerWrap.hidden = true;
    } finally {
      if (mine === generation) {
        card.classList.remove('is-stale');
        inFlight = null;
      }
    }
  }

  /**
   * Swap the skeleton out for the table, once.
   *
   * The skeleton is a sibling of the table rather than a row inside it, because
   * `.skel-row` is already padded and ruled to the exact height of a
   * `table.data` row around a 26px avatar. Nesting it in a `td` would add the
   * cell's own padding on top and make the loading state taller than the loaded
   * one, which is the jump the skeleton exists to prevent.
   */
  function revealTable() {
    if (!firstPaint) return;
    firstPaint = false;
    skeletonBox.hidden = true;
    tableWrap.hidden = false;
  }

  // ------------------------------------------------------------ rendering ---

  /**
   * What an empty table should say, which depends entirely on which filter is on.
   *
   * "No comments" is a fact the absence of rows already stated. What an operator
   * can act on is what would put something here, and that sentence is different
   * for each of the three: an empty All means nobody has commented, an empty
   * Visible means every comment on the box is currently hidden, and an empty
   * Hidden means the queue is clear.
   */
  function emptyForFilter() {
    if (only === 'hidden') {
      return emptyState(
        'Nothing is hidden',
        'Hiding a comment from this page, or from the comment list inside a post, puts it here'
      );
    }
    if (only === 'visible') {
      return emptyState(
        'Nothing is visible',
        'Every comment on the box is hidden right now. Switch to Hidden to see them'
      );
    }
    return emptyState(
      'No comments yet',
      'A comment written under any post in the community feed lands here within seconds'
    );
  }

  /** The author cell: a face, a name, a handle, and the ban chip if there is one. */
  function authorCell(row) {
    const user = row.expand?.author;
    if (!user) {
      // Two different states, told apart on purpose. An id we could not resolve
      // is a lead; an empty relation is a comment with nobody attached to it,
      // which should not exist and is worth seeing as itself.
      return row.author
        ? `<span class="mono muted tiny" title="This account id did not resolve">${esc(row.author)}</span>`
        : '<span class="muted tiny">no account</span>';
    }
    const label = nameOf(user);
    const handle = handleOf(user);
    return (
      '<div class="identity">' +
      avatar(user, 'sm', pb.auth.url) +
      '<span class="identity-text">' +
      `<span class="strong">${esc(label)}</span>` +
      (handle ? `<span class="muted tiny"> ${esc(handle)}</span>` : '') +
      (user.banned ? ` ${chip('banned', 'bad')}` : '') +
      '</span>' +
      '</div>'
    );
  }

  /**
   * The post cell, which is the way out of this page.
   *
   * A real `<a href>` and not a clickable `<td>`: it is keyboard reachable
   * without a `tabindex`, it can be middle clicked into a new tab, and its
   * target is visible in the status bar before it is pressed. The click is still
   * intercepted so navigation goes through the router's `go`, which handles the
   * case where the drawer for that post is already the current hash.
   *
   * The whole ROW is deliberately not clickable. A row here is a comment, and a
   * row that navigates to the post it is on would be a control that does not do
   * what the thing it is attached to is about.
   */
  function postCell(row) {
    const post = row.expand?.post;
    if (!post && !row.post) return '<span class="muted tiny">no post</span>';

    const id = post?.id || row.post;
    const title = post ? clampText(post.title, TITLE_LIMIT) : '';
    const label = title || (post ? 'Untitled post' : id);
    const marks = post?.hidden ? ` ${chip('post hidden', 'warn')}` : '';
    const full = post ? post.title || 'Untitled post' : id;
    return `<a href="#/post/${esc(id)}" data-post="${esc(id)}" title="${esc(full)}">${esc(label)}</a>${marks}`;
  }

  /** One row. Everything in it came off the wire, so everything in it is escaped. */
  function rowHtml(row) {
    const text = clampText(row.body, BODY_LIMIT);
    const label = nameOf(row.expand?.author);
    const ticked = picked.has(row.id);

    /*
     * The full body goes on the ROW, not on the body cell. Hovering anywhere in
     * the row that has not claimed a tooltip of its own reads the whole comment,
     * which is the gesture an operator makes when a truncated line looks like it
     * might matter. The When cell and the post link each carry their own `title`
     * and win inside their own boxes, which is exactly right: the nearest
     * tooltip is the one about the thing under the pointer.
     */
    return `<tr data-comment="${esc(row.id)}" title="${esc(row.body || '')}">
      <td class="check" data-pick-cell>
        <input type="checkbox" data-pick="${esc(row.id)}" ${ticked ? 'checked' : ''}
          aria-label="Select the comment by ${esc(label)}" />
      </td>
      <td>
        ${text ? esc(text) : '<span class="muted tiny">no text</span>'}
        ${row.hidden ? `<div class="chip-row">${chip('hidden', 'warn')}</div>` : ''}
      </td>
      <td>${authorCell(row)}</td>
      <td>${postCell(row)}</td>
      <td class="num">${n(row.likes)}</td>
      <td class="nowrap muted tiny" title="${esc(stamp(row.created))}">${esc(ago(row.created))}</td>
      <td><span class="row-actions">
        <button class="btn btn-sm" type="button" data-act="${row.hidden ? 'unhide' : 'hide'}" data-id="${esc(row.id)}"
          aria-label="${row.hidden ? 'Unhide' : 'Hide'} the comment by ${esc(label)}">${row.hidden ? 'Unhide' : 'Hide'}</button>
        <button class="btn btn-sm btn-danger" type="button" data-act="delete" data-id="${esc(row.id)}"
          aria-label="Delete the comment by ${esc(label)}">Delete</button>
      </span></td>
    </tr>`;
  }

  function paint(items) {
    body.innerHTML = items.length
      ? items.map(rowHtml).join('')
      : `<tr><td colspan="${COLUMNS}">${emptyForFilter()}</td></tr>`;

    /*
     * The bodies of the rows on screen are folded into the selection as they are
     * painted, so a row ticked on page one still has its text when the confirm
     * for a bulk delete is written three pages later. Only rows that are already
     * ticked are touched: this is a refresh of what is known about a selection,
     * never an addition to it.
     */
    for (const row of items) {
      if (picked.has(row.id)) {
        picked.set(row.id, { body: clampText(row.body, BODY_LIMIT), hidden: !!row.hidden });
      }
    }

    revealTable();
    paintPager();
    paintBulk();
  }

  /**
   * The counts beside the page title, and the number on the Hidden tab.
   *
   * `total` is the count for the filter that is on, which is the number the
   * pager below is about. Saying "61 comments, 13 hidden" while Visible is
   * selected would invite the reader to add them up to 74 and get the right
   * answer for the wrong reason, so the word in front of the number changes with
   * the filter and the hidden figure is only repeated when it is extra
   * information rather than the same figure twice.
   */
  function paintTotals() {
    let label;
    if (only === 'hidden') label = `${n(total)} hidden`;
    else if (only === 'visible') label = `${n(total)} visible`;
    else label = `${n(total)} ${plural(total, 'comment')}`;

    const extra = only === 'hidden' || hiddenTotal === null ? '' : `, ${n(hiddenTotal)} hidden`;
    /*
     * `[data-total]` carries `role="status"`, which makes it a polite live
     * region. Until it did, changing the filter was completely silent: the table
     * went from sixty one rows to thirteen and the only thing that said so was
     * the table itself. `tags.js` had already settled this pattern with its
     * coverage line, so this is that pattern and not a second one.
     */
    totalLabel.textContent = `${label}${extra}`;
    hiddenCountEl.textContent = hiddenTotal ? String(hiddenTotal) : '';
  }

  /**
   * Push the hidden count at the rail.
   *
   * Zero is passed as null on purpose, which is what `setRailCount` wants: a
   * rail full of zeroes teaches the eye to skip the badges, and the badge that
   * matters is the one that is only there when there is something behind it.
   *
   * Guarded because this module can be imported and exercised outside the shell,
   * and a view that throws on a missing global is a view that cannot be tested
   * on its own.
   */
  function pushBadge() {
    if (hiddenTotal === null) return;
    window.__dash?.setRailCount?.('comments', hiddenTotal || null);
  }

  function paintPager() {
    const pages = Math.max(1, Math.ceil(total / PER_PAGE));
    pagerWrap.hidden = total === 0;
    pagerBox.innerHTML = `
      <button class="btn btn-sm" type="button" data-page="prev" ${page <= 1 ? 'disabled' : ''}>Previous</button>
      <span>Page ${n(page)} of ${n(pages)}</span>
      <button class="btn btn-sm" type="button" data-page="next" ${page >= pages ? 'disabled' : ''}>Next</button>
      <span class="spacer"></span><span>${n(total)} ${plural(total, 'row')}</span>`;
  }

  /**
   * The bulk bar, and the header tick's three states.
   *
   * `hidden` as a property rather than a class, because
   * `[hidden] { display: none !important }` is what every visibility toggle in
   * this dashboard rests on. `indeterminate` is the state that matters: with two
   * of thirty ticked, a header box that read "checked" would invite a click that
   * unticked them both.
   */
  function paintBulk() {
    bulkCount.textContent = n(picked.size);
    bulkBar.hidden = picked.size === 0;

    const boxes = [...root.querySelectorAll('[data-pick]')];
    const here = boxes.filter((box) => picked.has(box.dataset.pick)).length;
    pageTick.checked = boxes.length > 0 && here === boxes.length;
    pageTick.indeterminate = here > 0 && here < boxes.length;
  }

  // -------------------------------------------------------------- actions ---

  /**
   * How each action reads once it has happened, for the summary after a bulk.
   *
   * A single row reports the server's own `note` instead, because the server
   * knows things this page does not: which post the comment was on and what its
   * count went from and to. A bulk cannot do that without stacking thirty
   * sentences in the corner, so it gets one line and a number.
   */
  const DONE = {
    hide: 'hidden',
    unhide: 'back in their threads',
    delete: 'deleted',
  };

  /**
   * One moderation call.
   *
   * `ref` is passed in rather than minted here so a bulk can send ONE ref across
   * every row it touches. Nothing on the server is keyed on it, but it is
   * written into `mod_log`, and a batch that shares a ref reads afterwards as
   * the single gesture it was rather than as thirty unrelated decisions made in
   * the same second.
   */
  const callModerate = (id, action, ref) =>
    pb.moderate({ target: 'comment', id, action, ref });

  /** The confirm for a single row, which names the comment it is about. */
  async function confirmOne(action, row) {
    const quoted = `<p class="dim">“${esc(clampText(row.body, 160) || 'no text')}”</p>`;

    if (action === 'hide') {
      return confirmAction({
        title: 'Hide this comment?',
        confirmLabel: 'Hide',
        from: 'In the thread',
        to: 'Hidden',
        body:
          quoted +
          '<p>It comes out of the thread for everyone. Nothing is deleted, its likes stay real, ' +
          'and the comment count on the post does not move.</p>',
      });
    }

    if (action === 'unhide') {
      return confirmAction({
        title: 'Unhide this comment?',
        confirmLabel: 'Unhide',
        from: 'Hidden',
        to: 'In the thread',
        body: quoted + '<p>It goes back into its thread exactly as it was.</p>',
      });
    }

    return confirmAction({
      title: 'Delete this comment?',
      confirmLabel: 'Delete',
      danger: true,
      body:
        quoted +
        '<p>The row goes, the likes on it go with it, and the post it was on has its comment ' +
        'count dropped by one.</p>' +
        '<p class="dim">This cannot be undone. Hiding is the reversible one.</p>',
    });
  }

  /** The confirm for a bulk, which always names the count. */
  async function confirmMany(action, chosen) {
    const count = chosen.length;
    const already = chosen.filter((item) => (action === 'hide' ? item.hidden : !item.hidden)).length;
    const word = plural(count, 'comment');

    /*
     * The first few bodies, listed. A count on its own is a number, and a number
     * is easy to agree with; three of the actual sentences that are about to be
     * deleted is a question that has to be read. Three and not thirty, because a
     * dialog that scrolls is a dialog whose buttons are off screen.
     */
    const sample = chosen
      .slice(0, 3)
      .map((item) => `<li>“${esc(item.body || 'no text')}”</li>`)
      .join('');
    const rest = count > 3 ? `<p class="dim">and ${n(count - 3)} more</p>` : '';
    const listed = `<ul>${sample}</ul>${rest}`;

    if (action === 'hide') {
      return confirmAction({
        title: `Hide ${n(count)} ${word}?`,
        confirmLabel: `Hide ${n(count)}`,
        body:
          `<p>They come out of their threads for everyone. Nothing is deleted, their likes stay ` +
          `real, and no post's comment count moves.</p>` +
          (already ? `<p class="dim">${n(already)} of them ${already === 1 ? 'is' : 'are'} already hidden, so nothing changes there.</p>` : '') +
          listed,
      });
    }

    if (action === 'unhide') {
      return confirmAction({
        title: `Unhide ${n(count)} ${word}?`,
        confirmLabel: `Unhide ${n(count)}`,
        body:
          '<p>They go back into their threads exactly as they were.</p>' +
          (already ? `<p class="dim">${n(already)} of them ${already === 1 ? 'is' : 'are'} already visible, so nothing changes there.</p>` : '') +
          listed,
      });
    }

    return confirmAction({
      title: `Delete ${n(count)} ${word}?`,
      confirmLabel: `Delete ${n(count)}`,
      danger: true,
      body:
        `<p>Each row goes, the likes on it go with it, and every post involved has its comment ` +
        `count dropped by one.</p>` +
        '<p class="dim">This cannot be undone. Hiding is the reversible one.</p>' +
        listed,
    });
  }

  /** Hide, unhide or delete one row, from the buttons in its Actions cell. */
  async function actOne(id, action) {
    // A row button during a bulk run is the same hazard as a second bulk verb:
    // it writes to a row the loop may be about to write to, and the reload at
    // the end of the run would then repaint over whichever answer landed second.
    // The buttons are disabled by `setBusy` as well; this is the guard for the
    // press that was already in flight when the run started.
    if (busy) return;
    const row = { id, ...(picked.get(id) || {}) };
    if (row.body === undefined) {
      // The button was pressed on a row that was never ticked, so the selection
      // has nothing about it. Read the body back off the row's `title` rather
      // than fetching it again: it is already on screen, it is the untruncated
      // text, and it is the same text the operator is looking at, which is the
      // text the confirm has to quote back at them.
      const tr = root.querySelector(`[data-comment="${CSS.escape(id)}"]`);
      row.body = tr ? tr.getAttribute('title') || '' : '';
    }

    if (!(await confirmOne(action, row))) return;
    if (!live() || busy) return;

    try {
      const answer = await callModerate(id, action, newRef());
      /*
       * The server's sentence, not one made up here. It carries the numbers this
       * page cannot know: which post it was on and what its comment count went
       * from and to. See note 12 in the view notes.
       */
      toast(`Comment ${answer?.note || DONE[action]}`, 'good');
      picked.delete(id);
    } catch (err) {
      toast(err.message || 'That could not be done', 'bad');
    }
    if (!live()) return;
    paintBulk();
    await load();
  }

  /**
   * Hide, unhide or delete everything that is ticked.
   *
   * ## One at a time, and why that is not laziness
   *
   * Deleting a comment is a read of `posts.comments`, a subtraction, and a
   * write, done inside a transaction on the server. Two deletes on comments that
   * happen to be on the SAME post, in flight together, are the textbook shape of
   * a lost update: both read four, both write three, and the post is left
   * claiming one more comment than it has. That is precisely the drift the
   * Integrity page exists to find, and a moderation tool that manufactures it
   * thirty rows at a time would be the largest single source of it on the box.
   * Serialising the calls costs a few hundred milliseconds and removes the
   * question entirely.
   *
   * ## The loop finishes even if the view does not
   *
   * `alive` is not checked between calls. The operator confirmed "delete twelve
   * comments" and twelve is what they get; abandoning the batch half way because
   * they clicked another rail item would leave them with no idea which six had
   * gone. What IS guarded is the painting: the summary toast lives outside the
   * view root and still fires, and nothing is written into a detached table.
   *
   * ## And only one loop at a time
   *
   * See `busy` at the top of this view for the bug that bought the lock. It is
   * taken AFTER the confirm rather than before it, because a confirm is modal
   * and cannot be raced, and taking it earlier would leave the bar dead if the
   * operator answered Cancel.
   */
  async function actMany(action) {
    if (busy) return;
    const chosen = [...picked.entries()].map(([id, meta]) => ({ id, ...meta }));
    if (!chosen.length) return;
    if (!(await confirmMany(action, chosen))) return;
    // Re-checked after the await. The confirm is modal to the mouse and the
    // keyboard, but this function is also reachable from a handler that fired
    // before the dialog opened, and `busy` is the only thing that knows.
    if (busy) return;

    setBusy(true);
    const ref = newRef();
    let done = 0;
    let firstError = '';

    for (const item of chosen) {
      try {
        await callModerate(item.id, action, ref);
        picked.delete(item.id);
        done++;
      } catch (err) {
        // The failures stay ticked. Whatever went wrong, the rows it went wrong
        // on are the ones worth trying again, and hunting for them by hand in a
        // thirty row table is a job nobody should be given.
        if (!firstError) firstError = err.message || 'that could not be done';
      }
    }

    setBusy(false);

    if (done) toast(`${n(done)} ${plural(done, 'comment')} ${DONE[action]}`, 'good');
    if (firstError) {
      const failed = chosen.length - done;
      toast(`${n(failed)} could not be done: ${firstError}`, 'bad');
    }

    if (!live()) return;
    paintBulk();
    await load();
  }

  // --------------------------------------------------------------- wiring ---

  root.querySelector('[data-filter]').addEventListener('click', (ev) => {
    const button = ev.target.closest('[data-value]');
    if (!button || busy) return;
    /*
     * The hash is set and nothing else happens here. The listener below is the
     * single place a filter is applied, so a press of a tab, a paste of a deep
     * link and the browser Back button all take exactly the same path. Two paths
     * into one piece of state is how a control ends up disagreeing with the URL
     * above it.
     */
    const value = button.dataset.value;
    window.__dash?.go?.(value ? `#/comments/${value}` : '#/comments');
  });

  const onHash = () => {
    const next = filterFromHash();
    if (next === only) return;
    only = next;
    page = 1;
    paintFilter();
    /*
     * The state moves even during a bulk run, the FETCH does not. Repainting
     * the table under a running loop would swap the rows the operator is
     * watching the progress of. The tabs are disabled while a run is going, so
     * the only way to get here mid run is the browser Back button, and updating
     * `only` anyway is what stops the URL and the pressed tab from disagreeing
     * for the rest of the session. The reload at the end of `actMany` picks the
     * new filter up.
     */
    if (busy) return;
    load();
  };
  window.addEventListener('hashchange', onHash);

  root.querySelector('[data-pager]').addEventListener('click', (ev) => {
    const button = ev.target.closest('[data-page]');
    if (!button || busy) return;
    page += button.dataset.page === 'next' ? 1 : -1;
    if (page < 1) page = 1;
    load();
  });

  /*
   * The tick cell sits inside a row that also carries a link and two buttons, so
   * the handlers below each claim only what belongs to them. `closest` on the
   * exact hook rather than a hit test on the row is what keeps a click on Delete
   * from also toggling a checkbox six pixels to the left of it.
   */
  body.addEventListener('change', (ev) => {
    const box = ev.target.closest('[data-pick]');
    if (!box) return;
    const id = box.dataset.pick;
    if (box.checked) {
      const row = box.closest('[data-comment]');
      picked.set(id, {
        // The row's `title` is the whole body, and the Unhide button is the only
        // thing on screen that says whether this one is currently hidden. Both
        // are read off the DOM rather than kept in a parallel array of the last
        // fetch, so a tick can never describe a row other than the one under it.
        body: clampText(row ? row.getAttribute('title') : '', BODY_LIMIT),
        hidden: !!row?.querySelector('[data-act="unhide"]'),
      });
    } else {
      picked.delete(id);
    }
    paintBulk();
  });

  body.addEventListener('click', (ev) => {
    const link = ev.target.closest('[data-post]');
    if (link) {
      // The anchor keeps its `href` so it is a real link with a real target in
      // the status bar and a real middle click. The press itself goes through
      // the router, which knows how to reopen a drawer that is already the
      // current hash and would otherwise fire no `hashchange` at all.
      ev.preventDefault();
      window.__dash?.go?.(`#/post/${link.dataset.post}`);
      return;
    }
    const button = ev.target.closest('[data-act]');
    if (button && !busy) actOne(button.dataset.id, button.dataset.act);
  });

  /*
   * The header tick reaches the rows ON SCREEN and no further. It is not "select
   * every comment matching this filter" and there is no such control anywhere on
   * this page, on purpose: see the note on `picked`.
   */
  root.querySelector('[data-pick-page]').addEventListener('change', (ev) => {
    const on = ev.target.checked;
    root.querySelectorAll('[data-pick]').forEach((box) => {
      box.checked = on;
      // Dispatched rather than duplicated, so there is one piece of code that
      // knows what a tick means and it is the one above.
      box.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });

  bulkBar.addEventListener('click', (ev) => {
    const button = ev.target.closest('[data-bulk]');
    if (!button || busy) return;
    if (button.dataset.bulk === 'clear') {
      picked.clear();
      root.querySelectorAll('[data-pick]').forEach((box) => {
        box.checked = false;
      });
      paintBulk();
      return;
    }
    actMany(button.dataset.bulk);
  });

  paintFilter();
  await load();

  return () => {
    alive = false;
    window.removeEventListener('hashchange', onHash);
    // The request itself is dropped as well as ignored. It is a superuser call
    // against a collection with no list rule, and there is no reason to leave
    // the box building a page of rows for a table that has already been thrown
    // away.
    if (inFlight) inFlight.abort();
  };
}

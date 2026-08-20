/**
 * Feed — every post on the box, and the surface most of the moderation happens on.
 *
 * This is the page an operator lands on when somebody says "there is something
 * wrong in the community tab". It has to answer three questions without a
 * second click: what is in the feed right now, what has already been hidden or
 * featured, and where is the one post being complained about. Hence four
 * controls above the grid (surface, visibility, sort, search) and nothing else.
 *
 * ## Two modes, one grid
 *
 * With an empty search box this is a paged list call against the `posts`
 * collection: the server filters, the server sorts, and `totalItems` is a real
 * total, so the pager is honest. Type two characters and it becomes the
 * `/dash/search` route instead, which matches title, app name, tags, the
 * generated search text, the template id and the raw record id, and answers at
 * most twenty rows with no total and no filter of its own. Those twenty are
 * then filtered and sorted in the browser, and the pager is replaced by a line
 * that says plainly that this is a top twenty and not a page. Pretending a
 * capped search was page one of a hundred is the single most misleading thing
 * this view could do, so it does not.
 *
 * ## Why `fields` is not optional here
 *
 * `posts` carries a 1200 character `search_text` column that exists so the app's
 * own feed can match on it. A grid of 24 cards showing a title and an author has
 * no use for it, and pulling it anyway is 28KB of wire per page that nobody
 * reads. Everything this view asks for is named, and the author comes through
 * `expand` rather than through 24 follow-up requests.
 *
 * ## Why the bulk runner is a `for` loop and not `Promise.all`
 *
 * Every one of these is a write against one SQLite file behind one hook VM.
 * Twenty-four parallel writes buy nothing (they queue on the same lock anyway)
 * and cost the one thing that matters when a write fails: knowing WHICH one.
 * `Promise.all` rejects on the first failure with no way to say what happened to
 * the other twenty-three, and `allSettled` gives an array an operator then has
 * to decode. Sequential, with a counter on screen and an honest summary at the
 * end, is slower by a second and worth it every time.
 *
 * ## The card comes from `postDetail.js`
 *
 * A post has to look the same on Pulse and here, and the moment there are two
 * card builders one of them starts lying about `featured`. That module owns the
 * markup, the thumbnail URL, the author in whichever of three shapes it arrived
 * in, and the click that opens the drawer. This view owns everything around it:
 * which posts, in what order, which ones are ticked, and what happens to them.
 *
 * Its contract is worth knowing before reading the paint below, because it
 * decides the shape of this file:
 *
 *   - `postCard(post, opts)` returns an HTML STRING, so a page of 24 is one
 *     `innerHTML` assignment and not 24 DOM insertions.
 *   - `opts.select` draws the selection checkbox this page's bulk bar needs, and
 *     `opts.selected` starts it ticked. There is no need to inject one.
 *   - `wirePostCards(container)` is delegated and idempotent, so the container
 *     is wired ONCE and refilled as often as the filters change. It also leaves
 *     clicks on an input or a label alone, which is what stops a tick from also
 *     opening the drawer.
 *   - The card's keyboard path is a real anchor on the title rather than a
 *     focusable card, deliberately: a checkbox cannot live inside a
 *     `role="button"` and still be reachable. So nothing here adds a tabindex.
 */

import * as pb from '../pb.js';
import {
  esc,
  n,
  node,
  toast,
  confirmAction,
  emptyState,
  errorState,
  skeleton,
  newRef,
} from '../ui.js';
import { postCard, wirePostCards } from './postDetail.js';

/** 24 a page: three, four or six across at every column count `.grid-cards` produces. */
const PER_PAGE = 24;

/** The server refuses a shorter needle, and so does the box below it. */
const MIN_QUERY = 2;

/**
 * Named columns, and the author in the same request.
 *
 * `caption` is in the list even though the tile is mostly title and author: the
 * card is shared with Pulse and may show a line of it, and 600 characters times
 * 24 is a rounding error next to the `search_text` this list exists to leave
 * behind. `search_text`, `tags_text` and `template_project_id` are deliberately
 * absent: the drawer fetches the whole post anyway when one is opened.
 */
const FIELDS = [
  'id,title,caption,surface,hidden,featured,likes,comments,views,remixes,screens',
  'app_name,created,images,tags,author',
  'expand.author.id,expand.author.name,expand.author.display_name,expand.author.handle,expand.author.avatar',
].join(',');

/**
 * The five surfaces, plus everything.
 *
 * The labels are the human names and the stored values are the slugs the schema
 * uses. Both are worth having on screen: the operator picks by label and the
 * card's surface chip shows the raw value, so the mapping between the two is
 * never a thing anybody has to hold in their head.
 */
const SURFACES = [
  { value: '', label: 'All surfaces' },
  { value: 'screenshots', label: 'App Store screenshots' },
  { value: 'apple-watch', label: 'Apple Watch' },
  { value: 'mac', label: 'Mac' },
  { value: 'app-preview', label: 'App preview' },
  { value: 'play-feature-graphic', label: 'Play feature graphic' },
];

/**
 * Visibility, which is three states and a fourth thing that is not one.
 *
 * Featured is a ranking flag rather than a visibility, and a post can be both
 * featured and hidden (that pair is worth finding, which is the other reason it
 * sits in this group rather than in a corner of its own). The filter answers
 * "show me the featured ones" and makes no claim beyond that.
 */
const VISIBILITY = [
  { value: '', label: 'All', filter: '', match: () => true },
  { value: 'visible', label: 'Visible', filter: 'hidden = false', match: (p) => !p.hidden },
  { value: 'hidden', label: 'Hidden', filter: 'hidden = true', match: (p) => !!p.hidden },
  { value: 'featured', label: 'Featured', filter: 'featured = true', match: (p) => !!p.featured },
];

/**
 * Sorts. `key` is the same column the server sorts on, and it is here so the
 * search branch can put its twenty rows in the same order by hand rather than
 * showing a different ordering under the same pressed button.
 */
const SORTS = [
  { value: '-created', label: 'Newest', key: 'created' },
  { value: '-likes', label: 'Most liked', key: 'likes' },
  { value: '-views', label: 'Most viewed', key: 'views' },
  { value: '-comments', label: 'Most commented', key: 'comments' },
];

/**
 * The five bulk actions, with the words each one needs in each of the four
 * places it appears: the button, the confirm, the progress line and the toast.
 *
 * Kept in one table because they have to agree. A button that says Unfeature
 * over a confirm that says "remove the boost" over a toast that says "unstarred"
 * is three names for one write, and the operator ends up unsure which of them
 * actually ran.
 */
const BULK_ACTIONS = {
  hide: {
    label: 'Hide',
    confirmLabel: 'Hide',
    running: 'Hiding',
    past: 'Hid',
    danger: false,
    body:
      '<p>They stop appearing in the feed straight away. Nothing is deleted: the images, ' +
      'the comments and the likes stay exactly as they are.</p>' +
      '<p>No counter is touched by this. A hidden post still has its likes, and they are ' +
      'still real. Unhide puts it back as it was.</p>',
  },
  unhide: {
    label: 'Unhide',
    confirmLabel: 'Unhide',
    running: 'Unhiding',
    past: 'Unhid',
    danger: false,
    body: '<p>They go back into the feed straight away, with the likes and comments they already had.</p>',
  },
  feature: {
    label: 'Feature',
    confirmLabel: 'Feature',
    running: 'Featuring',
    past: 'Featured',
    danger: false,
    body:
      '<p>They get the featured boost in the feed ranking. How strong that boost is comes ' +
      'from <strong>feed_featured_boost</strong> on the Settings page, so this is louder on ' +
      'some boxes than on others.</p>',
  },
  unfeature: {
    label: 'Unfeature',
    confirmLabel: 'Unfeature',
    running: 'Unfeaturing',
    past: 'Unfeatured',
    danger: false,
    body: '<p>They stay in the feed and keep their likes. They just stop getting the featured boost.</p>',
  },
  delete: {
    label: 'Delete',
    confirmLabel: 'Delete',
    running: 'Deleting',
    past: 'Deleted',
    danger: true,
    body:
      '<p><strong>This cannot be undone.</strong> The posts go, and their images, comments, ' +
      'likes and saves go with them.</p>' +
      '<p>Each author has their post count corrected as each one goes, so no account is left ' +
      'reading one too high. If you only want them out of the feed, Hide does that and is ' +
      'reversible.</p>',
  },
};

/** '1 post' or '12 posts'. Used in every confirm title, so it lives in one place. */
const countWord = (count) => (count === 1 ? '1 post' : `${n(count)} posts`);

/** Bulk stops rather than grinding on once the box is clearly the problem. */
const FAILURE_STREAK = 3;

export async function render(root) {
  /* ---------------------------------------------------------- view state --- */

  let page = 1;
  let total = 0;
  let query = '';
  let surface = '';
  let visibility = '';
  let sort = '-created';

  /** True while the grid is showing search results rather than a page. */
  let searched = false;

  /** How many rows the search route matched before the client side filters ran. */
  let searchedRaw = 0;

  /** The rows currently drawn, so the header tick and the confirms have titles. */
  let shown = [];

  /**
   * Who is ticked, and what they are called.
   *
   * Explicit selection only. There is no "select everything matching this
   * filter" control anywhere on this page and there should not be: a filter is a
   * query and a delete is a decision, and one gesture must not be both. Even the
   * header tick reaches no further than the cards on screen.
   *
   * The title rides along so a confirm can name what is about to be hidden
   * without a second fetch, and so a tick made on page 1 still has a name after
   * paging to page 3. The map lives in this closure, so leaving the view and
   * coming back clears it: a selection that outlives the page that made it is
   * how the wrong posts get deleted.
   */
  const picked = new Map();

  /**
   * Guards against an answer landing in a page that has moved on.
   *
   * Two of them because they solve different halves. `loadToken` is checked
   * after every await, so a slow response for filter A cannot repaint a grid
   * that is now showing filter B. `inflight` aborts the request itself, so the
   * slow one stops costing anything at all. `pb.search` takes no signal, which
   * is exactly why the token exists as well as the controller.
   */
  let loadToken = 0;
  let inflight = null;

  /** True while a bulk run is going. Locks the controls that would move the rows. */
  let busy = false;

  let debounce = null;
  let firstPaint = true;

  /*
   * Neither control in the filter row carries a width any more. `styles.css`
   * gives every text input and every select `width: 100%`, which is right inside
   * a form column and wrong inside a wrapping flex row: without a width each of
   * these takes a line of its own and the four controls become four rows. That
   * used to be worked around with an inline width here; the sheet now sizes them
   * itself under `.filter-row input` and `.filter-row select`, so the search box
   * matches the one on Accounts and Settings and the menu grows to its longest
   * option instead of clipping it at whatever number this file guessed.
   *
   * Two things in the markup below are there for a screen reader and are easy to
   * delete by accident, so they are written down here.
   *
   * `#feed-total` carries `role="status"`. It is the only element on this page
   * that says how big the answer is, and until it was a live region a filter
   * change was completely silent: the grid went from twenty four cards to three
   * and nothing announced it, so somebody not watching the cards had no way to
   * know the page had answered a different question. `tags.js` had already
   * solved this with a `role="status"` span in its filter row, and this is the
   * same pattern rather than a second one. It is `status` and not `alert`
   * because a count is not an emergency: polite means it waits for a gap instead
   * of interrupting whatever is being read.
   *
   * The `<h3>Posts</h3>` above the grid closes a heading gap. `postCard` in
   * `postDetail.js` titles every card with an `h4`, so this page went `h2` Feed
   * straight to twenty four `h4`s with no `h3` anywhere between them, and a
   * heading list, which is how a screen reader user skims a page, had a hole in
   * it. Every other view in this directory is clean on this. The card's `h4` is
   * not this file's to change, so the level is closed from the side that is.
   */
  root.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Feed</h2>
        <div class="sub">Every post on the box, and the place hiding, featuring and deleting happens</div>
      </div>
      <div class="page-tools"><span class="muted tiny" id="feed-total" role="status"></span></div>
    </div>

    <div class="filter-row" id="feed-filters">
      <input id="feed-q" class="input" type="search" spellcheck="false" autocomplete="off"
             placeholder="Title, tag, app name or post id" aria-label="Search posts" />
      <select id="feed-surface" aria-label="Surface">
        ${SURFACES.map((item) => `<option value="${esc(item.value)}">${esc(item.label)}</option>`).join('')}
      </select>
      <div class="segmented" data-filter="visibility" role="group" aria-label="Visibility">
        ${VISIBILITY.map(
          (item, i) =>
            `<button type="button" data-value="${esc(item.value)}" aria-pressed="${i === 0}">${esc(item.label)}</button>`
        ).join('')}
      </div>
      <div class="segmented" data-filter="sort" role="group" aria-label="Sort">
        ${SORTS.map(
          (item, i) =>
            `<button type="button" data-value="${esc(item.value)}" aria-pressed="${i === 0}">${esc(item.label)}</button>`
        ).join('')}
      </div>
      <label class="check-inline tiny" title="Ticks every post on this page, and nothing beyond it">
        <input type="checkbox" data-pick-page aria-label="Select every post on this page" />
        Select page
      </label>
    </div>

    <div class="bulk-bar" id="feed-bulk" hidden role="group" aria-label="Actions on the selected posts">
      <span><strong id="feed-bulk-count">0</strong> selected</span>
      <span class="tiny" id="feed-bulk-progress" hidden></span>
      <span class="spacer"></span>
      <button class="btn btn-sm" type="button" data-bulk="clear">Clear</button>
      <button class="btn btn-sm" type="button" data-bulk="hide">Hide</button>
      <button class="btn btn-sm" type="button" data-bulk="unhide">Unhide</button>
      <button class="btn btn-sm" type="button" data-bulk="feature">Feature</button>
      <button class="btn btn-sm" type="button" data-bulk="unfeature">Unfeature</button>
      <button class="btn btn-sm btn-danger" type="button" data-bulk="delete">Delete</button>
    </div>

    <h3 class="section-title">Posts</h3>
    <div id="feed-list"></div>
    <div class="pager" id="feed-pager"></div>`;

  const box = root.querySelector('#feed-list');
  const pager = root.querySelector('#feed-pager');
  const bulkBar = root.querySelector('#feed-bulk');
  const progress = root.querySelector('#feed-bulk-progress');
  const queryInput = root.querySelector('#feed-q');
  const surfaceSelect = root.querySelector('#feed-surface');
  const pageTick = root.querySelector('[data-pick-page]');
  /*
   * Held rather than re-queried. See `mounted` below: after the shell has
   * emptied `#view`, `root.querySelector('#feed-total')` answers null, and the
   * crash this file used to produce was a `.textContent =` on that null.
   */
  const totalLabel = root.querySelector('#feed-total');

  /**
   * Is this view still the one on screen, with a session still behind it.
   *
   * THE BUG. Signing out while the first page was still in the air threw
   * `Cannot set properties of null` out of the catch in `load` below, on
   * the `#feed-total` line. Reproduced every time on the fixture box: open
   * Feed cold, press Sign out before it paints. `loadToken` could not stop
   * it and never could: it is flipped by the cleanup the router calls, and
   * on a FIRST load `render()` has not returned that cleanup yet, so the
   * shell has nothing to call. `endSession()` emptied `#view` regardless,
   * and the handler then wrote into markup that no longer existed.
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

  /**
   * The card container, built once and refilled for the life of the view.
   *
   * It is not in the markup above because it comes and goes: a skeleton, an
   * empty state and an error state each take the whole of `#feed-list`, and this
   * element is put back when there are cards again. Holding it in a variable
   * rather than re-querying it is what lets it keep the delegated card wiring
   * and the three listeners below across every one of those swaps.
   */
  const grid = node('<div class="grid grid-cards"></div>');

  /*
   * The card wiring, once, from the module that owns the card. It skips clicks
   * on an input or a label itself, so ticking a card does not also open it and
   * this view does not need a guard of its own.
   */
  const detachCards = wirePostCards(grid);

  grid.addEventListener('change', (ev) => {
    const tick = ev.target.closest('[data-pick]');
    if (!tick) return;
    const id = tick.dataset.pick;
    // The title comes from the row that is on screen, and is remembered with the
    // tick so a confirm can name it after paging away. See the note on `picked`.
    const post = shown.find((row) => row.id === id);
    if (tick.checked) picked.set(id, post?.title || id);
    else picked.delete(id);
    const card = tick.closest('.post-card');
    if (card) card.classList.toggle('is-on', tick.checked);
    paintBulk();
  });

  // `error` and `load` do not bubble, so these have to be capture listeners on
  // an ancestor. One pair for the whole grid rather than a handler per image,
  // for the same reason `pb.js` puts its token retry on the document.
  grid.addEventListener('error', onThumbError, true);
  grid.addEventListener('load', onThumbLoad, true);

  /* ------------------------------------------------------------- fetching --- */

  /**
   * The filter expression for the list call.
   *
   * Nothing user typed ever reaches this string. `surface` and `visibility` can
   * only hold a value that came out of the two tables at the top of this file,
   * and the search needle goes to the search route instead, which parameterises
   * it and escapes the LIKE wildcards server side. That is the only reason there
   * is no quoting dance here.
   */
  function buildFilter() {
    const clauses = [];
    if (surface) clauses.push(`surface = "${surface}"`);
    const vis = VISIBILITY.find((item) => item.value === visibility);
    if (vis && vis.filter) clauses.push(vis.filter);
    return clauses.join(' && ');
  }

  /** Does a search result survive the surface and visibility filters. */
  function matchesFilters(post) {
    if (surface && post.surface !== surface) return false;
    const vis = VISIBILITY.find((item) => item.value === visibility);
    return vis ? vis.match(post) : true;
  }

  /**
   * The same order the server would have put them in.
   *
   * `created` is a PocketBase timestamp string in a fixed width format, so a
   * plain string compare sorts it correctly and there is no need to parse 20
   * dates to decide which is newer.
   */
  function bySort(a, b) {
    const key = (SORTS.find((item) => item.value === sort) || SORTS[0]).key;
    if (key === 'created') return String(b.created || '').localeCompare(String(a.created || ''));
    const delta = (Number(b[key]) || 0) - (Number(a[key]) || 0);
    if (delta) return delta;
    return String(b.created || '').localeCompare(String(a.created || ''));
  }

  /*
   * Nothing here normalises the author.
   *
   * The list call nests it as `expand.author` and the search route flattens it
   * into `author_name` and `author_handle`, and it is tempting to fold the two
   * together before drawing. `postCard` already does exactly that, for four
   * shapes rather than two, and it is the only place that should: a second
   * normaliser here would be a second opinion about what an author is, and the
   * two would drift the first time a route grew a column.
   */

  async function fetchRows(mine) {
    if (query.length >= MIN_QUERY) {
      const found = await pb.search(query);
      if (mine !== loadToken) return null;
      const rows = Array.isArray(found?.posts) ? found.posts : [];
      const items = rows.filter(matchesFilters).sort(bySort);
      // `raw` is what the route matched before the two client side filters ran.
      // Kept because it is the difference between "that needle matched nothing"
      // and "it matched five and your filters excluded all five", which are two
      // different things to do next.
      return { items, total: items.length, searched: true, raw: rows.length };
    }

    inflight = new AbortController();
    const result = await pb.list('posts', {
      page,
      perPage: PER_PAGE,
      sort,
      filter: buildFilter(),
      fields: FIELDS,
      expand: 'author',
      signal: inflight.signal,
    });
    if (mine !== loadToken) return null;
    return { items: result.items || [], total: result.totalItems || 0, searched: false, raw: 0 };
  }

  /**
   * Fetch and draw.
   *
   * The first pass puts a card skeleton in the box, because there is nothing to
   * hold the layout yet. Every pass after that leaves the last grid on screen at
   * reduced opacity instead: an operator who changes the sort should see the
   * posts reorder, not watch the page empty itself and fill back up. That is
   * what `.is-stale` is for and it is the difference between a page that feels
   * like a tool and one that feels like a website.
   */
  async function load() {
    const mine = ++loadToken;
    if (inflight) {
      // The previous request is now answering a question nobody is asking.
      inflight.abort();
      inflight = null;
    }

    if (firstPaint) box.innerHTML = skeleton('cards', PER_PAGE);
    else box.classList.add('is-stale');

    try {
      const result = await fetchRows(mine);
      if (!result || mine !== loadToken) return;

      /*
       * Deleting the last four posts on page 3 leaves page 3 empty and the
       * operator staring at an empty state that reads like the filter is wrong.
       * Step back instead. This terminates: `page` strictly decreases and the
       * branch is gated on `page > 1`.
       */
      if (!result.searched && !result.items.length && page > 1) {
        page -= 1;
        return load();
      }

      searched = result.searched;
      searchedRaw = result.raw || 0;
      total = result.total;
      shown = result.items;
      firstPaint = false;
      paint();
    } catch (err) {
      if (err?.name === 'AbortError' || mine !== loadToken || !mounted()) return;
      firstPaint = false;
      shown = [];
      box.innerHTML = errorState('Could not load the feed', err);
      pager.innerHTML = '';
      // Guarded even though `mounted()` has just answered yes. A held reference
      // to a detached node is a write nobody sees; a null is a thrown error in
      // the one handler whose job is to report an error.
      if (totalLabel) totalLabel.textContent = '';
    } finally {
      if (mine === loadToken) box.classList.remove('is-stale');
    }
  }

  /* ------------------------------------------------------------- painting --- */

  /**
   * A thumbnail that will not load says so, instead of showing a broken frame.
   *
   * `postCard` builds the URL and deliberately attaches no error handler of its
   * own, and `pb.js` listens for the same error at the document and retries the
   * URL once with a fresh file token, which is what makes a protected file work
   * at all. This is the third and last part of that arrangement, and it is
   * written to get in the way of neither.
   *
   * So it is emphatically NOT "swap the img for a placeholder": an img taken out
   * of the DOM is an img that retry can never fix. The element stays exactly
   * where it is and is merely hidden, the placeholder goes in beside it, and the
   * `load` handler puts the picture back if the retry lands. Verified against
   * the fixture box by pointing a card at a filename that does not exist: the
   * placeholder appears, `pb.js` retries with a token, the retry 404s too, and
   * the placeholder stays.
   *
   * A post with no images at all never reaches here. The card draws its own
   * `.empty` box for that, which is a different fact and reads as one.
   */
  function onThumbError(ev) {
    const img = ev.target;
    if (!img || img.tagName !== 'IMG') return;
    const thumb = img.closest('.post-thumb');
    if (!thumb) return;
    img.hidden = true;
    if (!thumb.querySelector('[data-thumb-fallback]')) {
      thumb.appendChild(node('<div class="empty" data-thumb-fallback>Image did not load</div>'));
    }
  }

  function onThumbLoad(ev) {
    const img = ev.target;
    if (!img || img.tagName !== 'IMG') return;
    const thumb = img.closest('.post-thumb');
    if (!thumb) return;
    const placeholder = thumb.querySelector('[data-thumb-fallback]');
    if (placeholder) placeholder.remove();
    img.hidden = false;
  }

  /**
   * Draw the grid.
   *
   * One string, one assignment, into a container that was built and wired once
   * when the view mounted. That is what `postCard` and `wirePostCards` are
   * shaped for: the cards are replaceable and the listener on the container is
   * not, so changing a filter costs an `innerHTML` and re-wires nothing. Calling
   * `wirePostCards` after every render would stack a handler per render and open
   * the drawer twice, then three times, and it guards against that, but the
   * cheaper fix is not to ask.
   *
   * The empty and error states replace the container entirely rather than
   * emptying it. `grid` is held in a variable through all of that, so it comes
   * back with its wiring and its listeners intact.
   */
  function paint() {
    const label = totalLabel;

    if (!shown.length) {
      box.innerHTML = emptyBox();
      pager.innerHTML = '';
      if (label) label.textContent = '';
      paintBulk();
      return;
    }

    grid.innerHTML = shown
      .map((post) => postCard(post, { select: true, selected: picked.has(post.id) }))
      .join('');

    if (grid.parentNode !== box) {
      box.innerHTML = '';
      box.appendChild(grid);
    }

    if (label) {
      label.textContent = searched
        ? `${countWord(shown.length)} found`
        : `${countWord(total)}${describeScope()}`;
    }

    paintPager();
    paintBulk();
  }

  /**
   * ', Mac, hidden' and so on, so the total says what it is a total of.
   *
   * Worth the few lines: "35 posts" beside a surface filter is a number an
   * operator will quote at somebody, and quoting the count of one surface as the
   * count of the whole feed is the kind of wrong that survives for weeks. The
   * surface keeps its capitals (they are product names) and the visibility does
   * not (it is a state).
   */
  function describeScope() {
    const bits = [];
    const item = SURFACES.find((s) => s.value === surface);
    if (item && item.value) bits.push(item.label);
    const vis = VISIBILITY.find((v) => v.value === visibility);
    if (vis && vis.value) bits.push(vis.label.toLowerCase());
    return bits.length ? `, ${bits.join(', ')}` : '';
  }

  /**
   * The nothing-here card, which has to say which kind of nothing this is.
   *
   * Three different facts share one blank grid: the search found nothing, the
   * filters excluded everything, and the box has no posts on it yet. Only the
   * last of those is about the server, and an operator who cannot tell them
   * apart goes looking in the wrong place.
   */
  function emptyBox() {
    if (searched && searchedRaw && (surface || visibility)) {
      // The needle DID match, and the two client side filters then took
      // everything out. Saying "no posts match that search" here would send the
      // operator to retype a search that was working.
      return emptyState(
        `That search matched ${n(searchedRaw)}, and the filters excluded all of them`,
        'Set the surface or the visibility filter back to All to see what it found'
      );
    }
    if (searched) {
      return emptyState(
        'No posts match that search',
        'The box matches on title, tag, app name, template id and the post id itself. Two characters is the minimum'
      );
    }
    if (surface || visibility) {
      return emptyState(
        'No posts match these filters',
        'Widen the surface or the visibility filter above, or set both back to All'
      );
    }
    return emptyState(
      'No posts yet',
      'A post lands here when somebody shares a board from the editor to the community feed'
    );
  }

  /**
   * The pager, or the line that says why there is not one.
   *
   * In search mode there is no total to page through: the route answers a top
   * twenty and stops. Showing Previous and Next under it would invent
   * pages that do not exist, so the buttons are replaced by a sentence saying
   * what the twenty are.
   */
  function paintPager() {
    if (searched) {
      pager.innerHTML =
        '<span class="muted">Search shows up to 20 posts from the whole table, newest first. ' +
        'Clear the search to page through everything</span>';
      return;
    }

    const pages = Math.max(1, Math.ceil(total / PER_PAGE));
    pager.innerHTML =
      `<button class="btn btn-sm" type="button" data-page="prev" ${page <= 1 ? 'disabled' : ''}>Previous</button>` +
      `<span>Page ${n(page)} of ${n(pages)}</span>` +
      `<button class="btn btn-sm" type="button" data-page="next" ${page >= pages ? 'disabled' : ''}>Next</button>` +
      `<span class="spacer"></span><span>${n(total)} in this view</span>`;
  }

  /**
   * The bar, the count, and the header tick's three states.
   *
   * `hidden` as a property rather than a class, because
   * `[hidden] { display: none !important }` is what every visibility toggle in
   * this dashboard rests on. `indeterminate` is the state that matters: with two
   * of twenty-four ticked, a header box reading "checked" invites a click that
   * unticks them both.
   */
  function paintBulk() {
    const count = root.querySelector('#feed-bulk-count');
    if (count) count.textContent = n(picked.size);
    bulkBar.hidden = picked.size === 0;

    const boxes = [...root.querySelectorAll('[data-pick]')];
    const here = boxes.filter((tick) => picked.has(tick.dataset.pick)).length;
    pageTick.checked = boxes.length > 0 && here === boxes.length;
    pageTick.indeterminate = here > 0 && here < boxes.length;
  }

  /* ------------------------------------------------------------- the bulk --- */

  /**
   * Lock the controls that would move the ground during a run.
   *
   * A sort change halfway through hiding twelve posts would repaint the grid
   * under the loop, and the progress line would then be counting rows that are
   * no longer on screen. Cheaper to say no for the two seconds it takes.
   */
  function setBusy(on) {
    busy = on;
    bulkBar.querySelectorAll('button').forEach((button) => {
      button.disabled = on;
    });
    root.querySelectorAll('#feed-filters input, #feed-filters select, #feed-filters button').forEach((control) => {
      control.disabled = on;
    });
    /*
     * The pager is disabled on the way in and deliberately not re-enabled on the
     * way out. The reload that follows a bulk run rebuilds it from scratch with
     * the page count the deletes left behind, and until it does, the `busy`
     * guard in its click handler is what holds the line. Re-enabling the old
     * buttons here would briefly offer a Next that may no longer exist.
     */
    if (on) {
      pager.querySelectorAll('button').forEach((button) => {
        button.disabled = true;
      });
    }

    box.setAttribute('aria-busy', on ? 'true' : 'false');
    // Shown on the way in; what it says on the way out is the caller's to
    // decide, because a run that failed leaves its report in here.
    if (on) progress.hidden = false;
  }

  /**
   * The confirm in front of every bulk action.
   *
   * It names the action, the count and, up to six of them, the posts themselves.
   * Six because a list long enough to scroll stops being read, and the count in
   * the title is the number that actually matters. Delete says it cannot be
   * undone in the first sentence rather than the last.
   */
  function confirmBulk(action, targets) {
    const spec = BULK_ACTIONS[action];
    const listed = targets
      .slice(0, 6)
      .map((row) => `<li>${esc(row.title || row.id)}</li>`)
      .join('');
    const more = targets.length > 6 ? `<p class="muted">and ${n(targets.length - 6)} more</p>` : '';

    return confirmAction({
      title: `${spec.label} ${countWord(targets.length)}?`,
      confirmLabel: `${spec.confirmLabel} ${countWord(targets.length)}`,
      danger: spec.danger,
      body: `${spec.body}<ul>${listed}</ul>${more}`,
    });
  }

  /**
   * Run one action over the selection, one row at a time.
   *
   * Sequential for the reason in the file header: these are writes against one
   * SQLite file and the operator has to be told which one failed. The counter is
   * updated before each call rather than after, so the number on screen is the
   * row currently being written and not the last one that finished.
   *
   * Failures do not stop the run, because nine times out of ten one row is
   * unusual and the other twenty-three are fine. Three failures in a row do stop
   * it: at that point it is the box and not the row, and grinding through
   * twenty more requests to prove it helps nobody. Whatever happened, the
   * summary at the end reports what actually landed rather than assuming the
   * happy path.
   *
   * The successes are dropped from the selection and the failures are kept, so
   * a second attempt at exactly the ones that did not work is one more click.
   */
  async function runBulk(action) {
    const spec = BULK_ACTIONS[action];
    const targets = [...picked].map(([id, title]) => ({ id, title }));
    if (!targets.length) return;

    const ok = await confirmBulk(action, targets);
    if (!ok) return;

    setBusy(true);
    let done = 0;
    let streak = 0;
    let stopped = false;
    let lastNote = '';
    const failures = [];

    for (let i = 0; i < targets.length; i++) {
      const row = targets[i];
      progress.textContent = `${spec.running} ${n(i + 1)} of ${n(targets.length)}`;
      try {
        /*
         * A fresh ref per row. The ref is an idempotency key for one composed
         * action, and hiding post A is not the same action as hiding post B:
         * sharing one key across the run would, on any box that ever starts
         * deduplicating on it, silently drop everything after the first write.
         * It is also written into `mod_log.ref`, so one key per row keeps that
         * audit line pointing at exactly one thing.
         */
        const answer = await pb.moderate({ target: 'post', id: row.id, action, ref: newRef() });
        if (answer && answer.note) lastNote = answer.note;
        picked.delete(row.id);
        done += 1;
        streak = 0;
      } catch (err) {
        console.warn(`feed: ${action} failed on ${row.id}`, err);
        failures.push({ row, message: err?.message || 'no detail was returned' });
        streak += 1;
        if (streak >= FAILURE_STREAK && i < targets.length - 1) {
          stopped = true;
          break;
        }
      }
    }

    setBusy(false);

    /*
     * The session can end in the middle of a run: twenty four sequential writes
     * take seconds, and Sign out is one click away throughout. Everything below
     * this line writes a report onto a page and reloads it, and there is no page
     * to write on any more. The writes that already landed are landed and the
     * server has the audit lines for them; what is dropped here is only the
     * reporting of them, which is the honest thing to drop when there is nobody
     * left to read it.
     */
    if (!mounted()) return;

    /*
     * The summary, which says what happened rather than what was asked for.
     * `note` comes from the server and is written for a person (it says things
     * like how many comments went with a deleted post and what the author's post
     * count went from and to), so when a single row succeeded it is better copy
     * than anything invented here.
     */
    if (!failures.length) {
      progress.hidden = true;
      progress.textContent = '';
      toast(targets.length === 1 && lastNote ? lastNote : `${spec.past} ${countWord(done)}`, 'good');
    } else {
      const first = failures[0];
      const tail = stopped ? `, and it stopped after ${n(FAILURE_STREAK)} failures in a row` : '';

      /*
       * The detail stays on screen, in the bar, beside the rows it is about.
       * A toast is gone in three and a half seconds and this is the one message
       * on the page somebody may need to copy into a bug report. The failed rows
       * are still ticked, so the bar this is written into is still open.
       *
       * `textContent`, not `innerHTML`: the message is a server string and this
       * is the one place in the file where wire text is written to the DOM
       * without going past `esc`, because it never becomes markup at all.
       */
      progress.hidden = false;
      progress.textContent =
        `${n(failures.length)} failed and stayed selected${tail}. ` +
        `First: ${first.row.title || first.row.id}: ${first.message}`;

      toast(`${spec.past} ${n(done)} of ${n(targets.length)}, ${n(failures.length)} failed`, 'bad');
    }

    paintBulk();
    await load();
    await refreshHiddenBadge();
  }

  /**
   * Keep the rail's hidden count honest after a hide or an unhide.
   *
   * One request with `perPage: 1`, so it costs a row count and not a page of
   * posts. Deliberately not cleared on teardown: the number belongs to the box
   * rather than to this view, the rail carries it on every page, and blanking it
   * on the way out would hide a fact until something happened to refetch it.
   */
  async function refreshHiddenBadge() {
    try {
      const hidden = await pb.count('posts', 'hidden = true');
      // Not pushed into a rail this view no longer belongs to. A count that
      // lands after a sign out would put a badge back on a rail the shell has
      // just cleared, on top of the sign-in gate.
      if (!mounted()) return;
      window.__dash.setRailCount('feed', hidden || null);
    } catch (err) {
      console.warn('feed: could not refresh the hidden count', err);
    }
  }

  /* -------------------------------------------------------------- wiring --- */

  pageTick.addEventListener('change', (ev) => {
    // Reaches the cards ON SCREEN and no further. See the note on `picked`.
    const on = ev.target.checked;
    root.querySelectorAll('[data-pick]').forEach((tick) => {
      tick.checked = on;
      const id = tick.dataset.pick;
      const post = shown.find((row) => row.id === id);
      if (on) picked.set(id, post?.title || id);
      else picked.delete(id);
      const card = tick.closest('.post-card');
      if (card) card.classList.toggle('is-on', on);
    });
    paintBulk();
  });

  bulkBar.addEventListener('click', (ev) => {
    const button = ev.target.closest('[data-bulk]');
    if (!button || busy) return;
    const action = button.dataset.bulk;

    if (action === 'clear') {
      picked.clear();
      // Clearing the selection clears the report about it too. Leaving a failure
      // line above rows that are no longer ticked is how somebody comes to think
      // the failure is about the next thing they select.
      progress.hidden = true;
      progress.textContent = '';
      root.querySelectorAll('[data-pick]').forEach((tick) => {
        tick.checked = false;
        const card = tick.closest('.post-card');
        if (card) card.classList.remove('is-on');
      });
      paintBulk();
      return;
    }

    if (BULK_ACTIONS[action]) runBulk(action);
  });

  root.querySelector('#feed-filters').addEventListener('click', (ev) => {
    const button = ev.target.closest('[data-value]');
    if (!button || busy) return;
    const group = button.closest('[data-filter]');
    group.querySelectorAll('[data-value]').forEach((other) => {
      other.setAttribute('aria-pressed', String(other === button));
    });
    if (group.dataset.filter === 'sort') sort = button.dataset.value;
    else visibility = button.dataset.value;
    page = 1;
    load();
  });

  surfaceSelect.addEventListener('change', () => {
    surface = surfaceSelect.value;
    page = 1;
    load();
  });

  queryInput.addEventListener('input', () => {
    clearTimeout(debounce);
    const typed = queryInput.value.trim();
    debounce = setTimeout(() => {
      /*
       * One character is not a search, it is most of the table, and both this
       * box and the route agree on that. Falling back to an empty string rather
       * than to "no change" matters: deleting the last character has to put the
       * paged list back, not leave the last search on screen.
       */
      query = typed.length >= MIN_QUERY ? typed : '';
      page = 1;
      load();
    }, 240);
  });

  pager.addEventListener('click', (ev) => {
    const button = ev.target.closest('[data-page]');
    if (!button || busy) return;
    page = Math.max(1, page + (button.dataset.page === 'next' ? 1 : -1));
    load();
  });

  /* ------------------------------------------------- links from other pages --- */

  /**
   * Filters that arrive in the hash, so another page can link to a slice of this
   * one.
   *
   * The router treats anything after the route id as belonging to the view, and
   * Tags and surfaces is the page that wants it: a row there should be able to
   * say "show me these in the Feed". Every shape it might reasonably use is
   * accepted, because the two pages were written in the same pass and guessing
   * generously is cheaper than a link that silently does nothing:
   *
   *   #/feed/mac                a surface slug
   *   #/feed/hidden             a visibility
   *   #/feed/tag/ios            a tag, which the search route matches through tags_text
   *   #/feed/q/nimbus           anything else, straight into the search box
   *
   * Anything unrecognised is ignored rather than treated as an error. A link
   * that lands on an unfiltered Feed is a small disappointment; one that lands
   * on a red box is a bug report.
   */
  function applyHash() {
    const bits = String(location.hash || '')
      .replace(/^#\/?/, '')
      .split('/')
      .filter(Boolean);

    // A detail route rides on top of this view, so `#/post/<id>` must leave the
    // list underneath exactly as the operator left it.
    if (bits[0] !== 'feed') return false;

    let decoded = [];
    try {
      decoded = bits.slice(1).map(decodeURIComponent);
    } catch {
      // A hash somebody hand edited into something that is not valid percent
      // encoding. Not worth a message, and certainly not worth throwing inside
      // a hashchange handler.
      decoded = bits.slice(1);
    }
    if (!decoded.length) return false;

    const head = decoded[0].toLowerCase();
    const tail = decoded.slice(1).join(' ').trim();

    /*
     * A link is a destination, not an adjustment.
     *
     * Whatever the link names, everything it does not name is cleared first.
     * Found the hard way against the fixture box: with "invoice" still in the
     * search box, a link to `#/feed/featured` set the visibility, kept the
     * needle, found nothing, and told the operator that no posts matched their
     * search, which was true and was not the question they had asked. Sort is
     * left alone on purpose. It is a reading preference rather than a filter,
     * and resetting it would be the same mistake in the other direction.
     */
    const point = (next) => {
      surface = '';
      visibility = '';
      query = '';
      next();
      return true;
    };

    let changed = false;

    if (SURFACES.some((item) => item.value && item.value === head)) {
      changed = point(() => {
        surface = head;
      });
    } else if (VISIBILITY.some((item) => item.value && item.value === head)) {
      changed = point(() => {
        visibility = head;
      });
    } else if (head === 'all') {
      changed = point(() => {});
    } else if ((head === 'tag' || head === 'q' || head === 'app' || head === 'search') && tail) {
      changed = point(() => {
        query = tail.length >= MIN_QUERY ? tail : '';
      });
    }

    if (changed) {
      page = 1;
      paintFilters();
    }
    return changed;
  }

  /** Push the state back into the controls, so a hash link looks like a click. */
  function paintFilters() {
    queryInput.value = query;
    surfaceSelect.value = surface;
    root.querySelectorAll('[data-filter="visibility"] [data-value]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.value === visibility));
    });
    root.querySelectorAll('[data-filter="sort"] [data-value]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.value === sort));
    });
  }

  /*
   * The router does not remount a view when only the tail of the hash changed,
   * which is what makes `#/feed/mac` from the Tags page a no-op without this
   * listener. Removed in the cleanup below, or a second visit to this page ends
   * up with two of them reloading the grid twice on every link.
   */
  const onHash = () => {
    if (busy) return;
    if (applyHash()) load();
  };
  window.addEventListener('hashchange', onHash);

  applyHash();
  await load();
  refreshHiddenBadge();

  return () => {
    window.removeEventListener('hashchange', onHash);
    clearTimeout(debounce);
    // Stops the in-flight page from resolving into a view that is already gone,
    // and stops its answer from being drawn into markup that has been replaced.
    loadToken++;
    if (inflight) inflight.abort();
    // The grid is about to be dropped with the rest of the view, so this is
    // belt and braces. It costs one call and it means the card wiring is not
    // holding a reference to a detached tree if anything else ever does.
    detachCards();
  };
}

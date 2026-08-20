/**
 * One post: the card that Feed and Pulse both draw, and the drawer you get when
 * you open one.
 *
 * This file is two things on purpose, and the second one is the reason for the
 * first. The drawer is where a post is moderated, so it has to show everything
 * the box knows: every screenshot, the caption somebody typed, the tags, the
 * comments under it, who liked it, and the counters, INCLUDING the places where
 * the stored counter and the join table disagree. The card is the doorway to it
 * from two different pages, and if each of those pages drew its own card there
 * would be two answers to "what does a post look like", two places to fix a
 * thumbnail that 403s, and two chances to forget `esc` on a title somebody
 * typed. So the card lives here, beside the thing it opens.
 *
 * ## The card is a contract
 *
 * `feed.js` and `pulse.js` both import `postCard` and `wirePostCards`, and the
 * three of us are written at the same time by different hands. So:
 *
 *  - **Every option is optional.** `postCard(post)` with nothing else has to
 *    render, because the realtime feed on Pulse hands over a raw `posts` record
 *    with an author id and no author row behind it.
 *  - **Every shape of `post` this box produces is accepted.** A record from the
 *    record API, a row from the `search` route (flat `author_name`), a row from
 *    the `account` route, and a realtime message record all arrive here, and
 *    they carry the author three different ways. `authorOf` is the one place
 *    that knows all three.
 *  - **Everything is escaped.** A title, a caption, a handle and a tag are all
 *    text somebody typed into the app. None of it has been near a React layer
 *    and all of it is being concatenated into an HTML string.
 *  - **The markup uses only classes that exist in `styles.css`.** The sheet was
 *    written knowing about this card: `.post-card`, `.post-thumb`,
 *    `.post-card-body`, `.post-meta`, `.post-engage`, `.surface-chip` and
 *    `.post-thumb-strip` are all in it, with the reasoning attached.
 *
 * ## Why the card is not `role="button"`
 *
 * The obvious shape for a clickable card is `role="button" tabindex="0"`, and
 * it is wrong here for two reasons. Feed needs a selection checkbox on the card
 * for its bulk bar, and ARIA forbids interactive descendants inside a button
 * role: a checkbox inside one is unreachable to a screen reader user, who is
 * told the whole card is a single button. And a `role="button"` card cannot be
 * middle-clicked, copied as a link, or opened in a second tab, which is exactly
 * what an operator working through a moderation queue wants to do with it.
 *
 * So the title is a real `<a href="#/post/<id>">`, the checkbox is its own
 * control beside it, and `wirePostCards` makes the rest of the card's surface
 * clickable on top of that. The keyboard path is the anchor, which is focusable
 * and fires a click on Enter without a single line of key handling.
 *
 * ## After an action, refetch. Do not patch the DOM
 *
 * Every write in the drawer goes through `pb.moderate` and is followed by
 * another `pb.post(id)`. Patching the DOM instead would be faster and would be
 * lying: hiding a post writes one boolean, deleting a comment writes a counter
 * on the post as well, and deleting the post decrements a column on an account
 * this drawer is not even showing. What is on screen after an action has to be
 * what is stored, or the drift readout at the top of the drawer is reporting on
 * a copy of the record that is one write out of date, which is the one number
 * on this page nobody can afford to have be a guess.
 */

import * as pb from '../pb.js';
import {
  $,
  $$,
  ago,
  asJson,
  avatar,
  chip,
  closeDrawer,
  confirmAction,
  copyText,
  emptyState,
  errorState,
  esc,
  handleOf,
  n,
  nameOf,
  newRef,
  openDrawer,
  rawJson,
  skeleton,
  stamp,
  toast,
} from '../ui.js';

/*
 * The two thumb sizes that exist.
 *
 * `posts.images` declares `640x0` and `1280x0` in the discover migration and
 * nothing else, and PocketBase answers an undeclared size by serving the
 * ORIGINAL rather than by erroring, so asking for `400x0` here would quietly
 * push a 4MB screenshot down the wire for every card on a 24 card page and
 * nothing on screen would look wrong.
 *
 * The card gets 640: its box is capped at 260px tall by `.post-thumb`, so 640
 * across is already more than two device pixels per CSS pixel on any column
 * width `.grid-cards` produces. The drawer strip gets 1280, because
 * `.post-thumb-strip img` is 300px TALL with the width free, and a landscape
 * Play feature graphic scaled to 300 tall is about 615 CSS pixels wide, where a
 * 640 wide source is a hair over 1x and visibly soft on a retina screen.
 */
const CARD_THUMB = '640x0';
const STRIP_THUMB = '1280x0';

/*
 * Where Close goes back to.
 *
 * `#/post/<id>` is a real route, so dismissing the drawer has to take the hash
 * back to the list underneath or the URL keeps naming a record that is no
 * longer on screen. The router is the only thing that knows which list that was,
 * and it does not expose it, so the card remembers: `wirePostCards` writes the
 * hash it was looking at just before it navigates. A pasted link has no such
 * memory and falls back to Feed, which is where `app.js` mounts a cold
 * `#/post/<id>` anyway.
 */
let cameFrom = '';

/** Detaches the `dash:drawer-close` listener the open drawer registered. */
let releaseClose = null;

/**
 * Bumped by every `openPost` call, and compared after every await inside one.
 *
 * ## The bug this fixes
 *
 * `openPost` used to be `data = await pb.post(id); paint();` with nothing
 * comparing the answer against a newer call. The router imports this module
 * lazily and awaits `openPost`, and every detail view paints into the SAME
 * `#drawer` element, so two clicks 250ms apart put two of these in flight over
 * one surface and the slower answer painted last. Reproduced by holding the
 * first request for two seconds and clicking post A then post B: the hash read
 * `#/post/B` and the drawer showed A.
 *
 * The buttons stayed consistent with the drawer's own content, because `wire`
 * closes over the same `data` it painted from, so this was never a wrong-record
 * delete. It was worse in a quieter way: the operator was reading a record they
 * did not click, under a URL naming the one they did, and if they then copied
 * that URL out into a ticket it named the wrong post.
 *
 * `accountDetail.js` already had this counter and was the model for it. A
 * counter rather than an AbortController because there is more than one await
 * per open (the first load and every `refresh` after an action) and they all
 * have to lose to a newer open, not just the fetch.
 */
let session = 0;

const FALLBACK_LIST = '#/feed';

// ------------------------------------------------------------ wire shapes ---

/**
 * The filenames on a post, whatever shape they arrived in.
 *
 * Confirmed against the running box: the `post`, `search` and `account` routes
 * all parse this column and hand back a real array. The record API and the
 * realtime feed hand back an array too. The string branch is here for the one
 * case none of those covers, a `fields=` projection that flattens it, and
 * because a single `JSON.parse` in a helper is cheaper than the day somebody
 * has to work out why a card is blank.
 */
function imagesOf(post) {
  const raw = post?.images;
  if (Array.isArray(raw)) return raw.filter(Boolean);
  const parsed = asJson(raw);
  return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
}

/** `tags`, same story, same reasons. */
function tagsOf(post) {
  const raw = post?.tags;
  if (Array.isArray(raw)) return raw.filter(Boolean);
  const parsed = asJson(raw);
  return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
}

/**
 * The author, from whichever of the three places this caller's post keeps it.
 *
 * 1. `opts.author` wins, because a caller that has already fetched the row knows
 *    more than anything that can be guessed from the post.
 * 2. `expand.author`, which is what `pb.list('posts', { expand: 'author' })`
 *    produces.
 * 3. The flat `author_name` / `author_handle` / `author_avatar` columns, which
 *    is the shape `search` and `account.posts` return: the SQL joins the row and
 *    projects three columns off it rather than nesting an object.
 *
 * Answers null when the post carries nothing but an id, and the card says so
 * rather than drawing a nameless avatar chip. A nameless chip reads as a
 * rendering fault; "author not loaded, here is the id" reads as what it is.
 *
 * `avatar` is deliberately carried through, because `ui.avatar` builds its own
 * URL from `id` + `avatar` and needs both or it falls back to initials, which is
 * the correct outcome and not an error.
 */
function authorOf(post, opts = {}) {
  if (opts.author) return opts.author;
  if (post?.expand?.author) return post.expand.author;

  const id = post?.author || '';
  const name = post?.author_name || '';
  const handle = post?.author_handle || '';
  if (!name && !handle) return null;
  return { id, name, handle, avatar: post?.author_avatar || '' };
}

/** The chips a post carries about itself. Words, never colour alone. */
function stateChips(post, images) {
  let out = '';
  if (post?.hidden) out += chip('hidden', 'warn');
  if (post?.featured) out += chip('featured', 'accent');
  // Worth a chip of its own: a post with no image is almost always an upload
  // that failed halfway, and the Integrity page lists them for that reason.
  if (!images.length) out += chip('no images', 'bad');
  return out;
}

// ----------------------------------------------------------------- the card ---

/**
 * One post as a card.
 *
 * ```
 * postCard(post, {
 *   collection : 'posts',   // the file collection for the thumbnail. Only pass
 *                           // it when you have `images_collection` from the
 *                           // post route; every other shape uses the default
 *   author     : null,      // the author row, when the caller already has it
 *   thumb      : '640x0',   // '640x0' or '1280x0'. Nothing else is generated
 *   select     : false,     // draw a selection checkbox, for a bulk bar
 *   selected   : false,     // and whether it starts ticked
 *   note       : '',        // one extra muted line, for a live feed's "just now"
 *   fresh      : false,     // add `is-new`, for a row that just arrived
 * })
 * ```
 *
 * Returns an HTML STRING, not an element, so a grid of two dozen of them is one
 * `innerHTML` assignment rather than 24 DOM insertions. Wire the container once
 * afterwards with `wirePostCards`.
 *
 * The selection checkbox carries `data-pick="<id>"` and nothing else: this file
 * does not own what selection means, only that ticking one must not also open
 * the drawer. `wirePostCards` handles that half.
 */
export function postCard(post, opts = {}) {
  const id = post?.id || '';
  const images = imagesOf(post);
  const author = authorOf(post, opts);
  const title = post?.title || 'Untitled';

  /*
   * The thumbnail, or an honest gap.
   *
   * No `onerror` handler. `pb.js` listens for image errors across the whole
   * document and retries once with a fresh file token, and a handler here would
   * be racing it for ownership of the same node. A file that is genuinely gone
   * leaves the alt text in a `.post-thumb` box, which is what that rule's
   * comment in the stylesheet is for.
   */
  const src = images.length
    ? pb.fileUrl(opts.collection || post?.images_collection || 'posts', id, images[0], opts.thumb || CARD_THUMB)
    : '';

  const thumb = src
    ? `<img src="${esc(src)}" alt="${esc(title)}" loading="lazy" decoding="async" />`
    : '<div class="empty">No image on this post</div>';

  const pick = opts.select
    ? `<input type="checkbox" data-pick="${esc(id)}"${opts.selected ? ' checked' : ''} ` +
      `aria-label="Select ${esc(title)}" />`
    : '';

  /*
   * Who made it.
   *
   * Three outcomes, and each of them says something different: a real account, a
   * post whose author column is filled in but whose row was not fetched, and a
   * post with no author at all. The third is not hypothetical, it is what a row
   * looks like after the account behind it was deleted and the cascade has not
   * been believed.
   */
  let who;
  if (author) {
    const handle = handleOf(author);
    who =
      avatar(author, 'sm', pb.auth.url) +
      `<span class="truncate">${esc(nameOf(author))}</span>` +
      (handle ? `<span class="muted truncate">${esc(handle)}</span>` : '');
  } else if (post?.author) {
    who = `<span class="muted">by</span><span class="mono truncate">${esc(post.author)}</span>`;
  } else {
    who = chip('no author', 'bad');
  }

  const surface = post?.surface
    ? `<span class="surface-chip">${esc(post.surface)}</span>`
    : '';
  const chips = surface + stateChips(post, images);

  return (
    `<article class="post-card${opts.selected ? ' is-on' : ''}${opts.fresh ? ' is-new' : ''}" data-post="${esc(id)}">` +
    `<div class="post-thumb">${thumb}</div>` +
    '<div class="post-card-body">' +
    `<h4><a href="#/post/${esc(id)}">${esc(title)}</a></h4>` +
    `<div class="post-meta">${pick}${who}</div>` +
    (chips ? `<div class="chip-row">${chips}</div>` : '') +
    (opts.note ? `<p class="tiny muted truncate">${esc(opts.note)}</p>` : '') +
    '<div class="post-engage">' +
    `<span>${n(post?.likes)} likes</span>` +
    `<span>${n(post?.comments)} comments</span>` +
    `<span>${n(post?.views)} views</span>` +
    '<span class="spacer"></span>' +
    `<span class="nowrap" title="${esc(stamp(post?.created))}">${esc(ago(post?.created))}</span>` +
    '</div>' +
    '</div>' +
    '</article>'
  );
}

/**
 * Make a container full of cards clickable, once.
 *
 * Delegated, so a grid can be re-rendered as many times as its filters change
 * without re-wiring anything: the listener is on the container and the cards
 * inside it are replaceable. Which is also the trap, and why the flag on the
 * dataset is here. A view that calls this after every render would otherwise
 * stack a listener per render and navigate twice, then three times, then four,
 * and the visible symptom is a drawer that will not close because the second
 * handler reopens it.
 *
 * Returns a detach function for a caller that wants one. Calling it again on an
 * already wired container is a no-op that returns a no-op, so it is safe to put
 * in a render path.
 */
export function wirePostCards(root) {
  if (!root || root.dataset.postCardsWired === '1') return () => {};
  root.dataset.postCardsWired = '1';

  const onClick = (ev) => {
    /*
     * Anything that is a control in its own right keeps its click.
     *
     * The selection checkbox is the reason this exists: ticking a card to hide
     * it in bulk must not also open it. A `<label>` counts, because clicking a
     * label is how a checkbox gets ticked by anyone who does not aim at a 13px
     * square, and a `<button>` counts because a future card may grow one.
     */
    if (ev.target.closest('input, button, label, select, textarea')) return;

    const card = ev.target.closest('[data-post]');
    if (!card || !root.contains(card)) return;

    const id = card.dataset.post;
    if (!id) return;

    /*
     * The anchor's own navigation is cancelled and re-issued through the shell.
     *
     * Letting the browser set the hash would work, and it would be the only
     * navigation in this dashboard that does not go through `go()`. That
     * function exists because assigning a hash that is already current fires no
     * `hashchange` at all, which is the case that matters here: reopening the
     * post you just closed is a very ordinary thing to do.
     *
     * A modified click is left alone on purpose. Ctrl, Cmd, Shift and a middle
     * click all mean "somewhere other than here", and the anchor already knows
     * how to do that.
     */
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
    ev.preventDefault();

    // Remembered before navigating, never after: one line later the hash is
    // already `#/post/<id>` and the answer to "where was I" is gone.
    const here = location.hash;
    if (here && !here.startsWith('#/post/')) cameFrom = here;

    window.__dash.go(`#/post/${id}`);
  };

  root.addEventListener('click', onClick);

  return () => {
    root.removeEventListener('click', onClick);
    delete root.dataset.postCardsWired;
  };
}

// --------------------------------------------------------------- the drawer ---

/** The list route Close should return to, given what the card remembered. */
function returnRoute() {
  return cameFrom && !cameFrom.startsWith('#/post/') ? cameFrom : FALLBACK_LIST;
}

/**
 * Put the hash back when the drawer is dismissed without a Close button.
 *
 * `ui.closeDrawer` fires `dash:drawer-close` for exactly this, and it is fired
 * by the scrim and by Escape as well as by the button, which is the whole point:
 * Escape is how a keyboard user closes this drawer and it must leave the URL
 * naming the page that is actually on screen.
 *
 * The guard is what makes it safe to keep one of these registered. The same
 * event fires when the ROUTER closes the drawer on its way to another page, and
 * by then the hash is already that other page, so this stands down rather than
 * dragging the operator back to Feed. It also releases itself either way, so a
 * drawer that has been closed is not still holding a listener that names a
 * record nobody is looking at.
 */
function watchClose(id) {
  release();
  const target = returnRoute();

  const onClose = () => {
    release();
    if (location.hash !== `#/post/${id}`) return;
    window.__dash.go(target);
  };

  document.addEventListener('dash:drawer-close', onClose);
  releaseClose = () => document.removeEventListener('dash:drawer-close', onClose);
}

function release() {
  const off = releaseClose;
  releaseClose = null;
  if (off) off();
}

/**
 * Open the post drawer. Called by the router for `#/post/<id>`.
 *
 * Awaited by `app.js`, so everything slow is inside it and the shell is drawn
 * first: the drawer is on screen with its skeleton before the request goes out,
 * which is the difference between a click that does nothing for 300ms and a
 * click that opens something.
 */
export async function openPost(id) {
  const mine = ++session;
  release();

  const drawer = openDrawer(shell(skeleton('rows', 5)));
  // `openDrawer` answers null when the host elements are missing, which only
  // happens if this module is exercised outside the page. Nothing below can run
  // without them and none of it is worth a stack trace in the console.
  if (!drawer) return;

  /*
   * Registered here, before the fetch, and not after the first paint.
   *
   * It used to be the last line of this function, which left a hole the size of
   * one request. The skeleton is on screen and closeable the whole time that
   * request is out, deliberately, so Escape during it is an ordinary thing to
   * do; with no watcher yet registered it closed the drawer and left the
   * address bar on `#/post/<id>`, which is the same failure finding 1 described
   * on the account drawer, only narrower. Measured against a request held for
   * four seconds: Escape at 600ms left the hash naming the post with nothing on
   * screen, and it stayed that way after the answer landed.
   *
   * It also covers the error path below, which returns early and never reached
   * the old call site at all, so a 404 drawer could not be dismissed back to the
   * list by Escape or by the scrim either.
   */
  watchClose(id);

  let data = null;

  /*
   * The answer is assigned only if this open is still the current one. Written
   * as `const answer = await ...` and then a check, rather than assigning
   * straight into `data`, because the check has to happen before the write: a
   * stale fetch that assigned first and bailed second would have already
   * replaced the newer drawer's payload, and the next `refresh` would repaint
   * from it.
   */
  const load = async () => {
    const answer = await pb.post(id);
    if (mine !== session) return false;
    data = answer;
    return true;
  };

  try {
    if (!(await load())) return;
  } catch (err) {
    /*
     * 404 lands here, and it should. `pb.js` signs the operator out on 401 and
     * 403 only, so a record that is not there reaches this catch with its
     * message intact and belongs on screen rather than in the console. It is the
     * ordinary case for a pasted link to a post that has since been deleted.
     *
     * Guarded like the success path. A slow 404 for post A must not paint its
     * error state over post B, which is the same race in its most confusing
     * form: an error message about a record the operator can plainly see is on
     * screen and working.
     */
    if (mine !== session) return;
    drawer.innerHTML = shell(errorState('That post did not open', err));
    wireChrome(drawer, id);
    return;
  }

  /**
   * Redraw everything from `data`.
   *
   * The whole drawer, not a patch. `paint` throws away every listener the last
   * pass attached, which is why `wire` runs immediately after it every time and
   * why nothing in here caches an element across a repaint.
   */
  const paint = () => {
    // Every path into `paint` is already guarded, and it is guarded again here
    // because this is the one function that can put the wrong record on screen
    // and a future caller should not have to remember that.
    if (mine !== session) return;
    drawer.innerHTML = render(data, id);
    wire();
  };

  /**
   * Refetch and repaint, holding the last answer at reduced opacity.
   *
   * `is-stale` rather than the skeleton, because this runs after every action
   * and a drawer that blanks itself to grey bars each time you hide a comment is
   * one you lose your place in. The old content stays put, dimmed, and is
   * replaced in one frame when the answer lands.
   */
  const refresh = async () => {
    const body = $('.drawer-body', drawer);
    if (body) body.classList.add('is-stale');
    try {
      if (!(await load())) return;
    } catch (err) {
      // Another open has taken the drawer, so this toast would be about a post
      // that is no longer on screen, and `body` belongs to markup that has
      // already been replaced.
      if (mine !== session) return;
      if (body) body.classList.remove('is-stale');
      toast(err.message || 'Could not reload that post', 'bad');
      return;
    }
    paint();
  };

  /*
   * One press at a time, across the whole drawer.
   *
   * Disabling the button that was pressed is not enough on its own. A press is
   * a confirm, then a write, then a refetch, and the button is thrown away and
   * rebuilt by the repaint in the middle of that: re-enabling it when the write
   * returns leaves a round trip in which a second click fires a second write,
   * and re-enabling it only on failure leaves it dead forever if the REFETCH is
   * what failed. A flag around the whole sequence has neither problem, and it
   * covers the case a per-button flag never could, which is pressing Delete on
   * a comment while the Hide on the post is still in flight.
   */
  let busy = false;
  const once = async (run) => {
    if (busy) return;
    busy = true;
    try {
      await run();
    } finally {
      busy = false;
    }
  };

  /**
   * One moderation call, from anywhere in this drawer.
   *
   * `ref` is minted per press, and it is a MARKER IN THE AUDIT TRAIL rather
   * than a lock. Nothing on the moderate route is keyed on it: the route
   * checks its shape, writes it into `mod_log.ref` and then acts, every time.
   * What it buys is that a human reading two identical audit lines a second
   * apart can tell one action logged twice from two genuine presses, which is
   * why it is minted here at the point of the action rather than inside
   * `pb.moderate`: two operators hiding the same post get two refs and two
   * audit lines, which is correct, and one operator whose request timed out and
   * pressed again gets the same ref back from the same closure, which is also
   * correct. It does NOT deduplicate a double submit. `once` below is the only
   * thing that does that, and it is why `once` has to wrap the confirm too.
   *
   * The toast says what the SERVER said. Every action on this route composes its
   * own note out of what it actually did, counts included: "deleted with 3
   * comments and 2 likes, the author's post count went from 5 to 4" is worth
   * more than any sentence that can be written here, and it cannot go out of
   * step with the route the way a locally invented one can.
   */
  const moderate = async (target, targetId, action, button) => {
    if (button) button.disabled = true;
    try {
      const reply = await pb.moderate({ target, id: targetId, action, ref: newRef() });
      toast(reply?.note || `${target} ${action}`, 'good');
      return reply;
    } catch (err) {
      toast(err.message || 'That could not be done', 'bad');
      return null;
    } finally {
      // Re-enabled even though the repaint below usually replaces the button:
      // the failure path does not repaint, and a button left disabled after a
      // failure is one the operator cannot retry with.
      if (button && button.isConnected) button.disabled = false;
    }
  };

  const wire = () => wireDrawer(drawer, data, id, { refresh, moderate, once });

  paint();
}

/**
 * The drawer's outer shell: a head that can always be closed, and one slot.
 *
 * Used for the skeleton and for the error state, both of which need a working
 * Close button before there is any post to put a title on. The real render
 * builds its own head, because by then there is a title and a surface to put in
 * it.
 */
function shell(inner) {
  return (
    '<div class="drawer-head">' +
    '<h3>Post</h3>' +
    '<span class="spacer"></span>' +
    '<button class="icon-btn" data-close type="button" aria-label="Close">&#10005;</button>' +
    '</div>' +
    `<div class="drawer-body">${inner}</div>`
  );
}

// ------------------------------------------------------------------ render ---

function render(data, id) {
  const post = data?.post || {};
  const images = imagesOf(post);
  const collection = data?.images_collection || 'posts';

  return (
    renderHead(post, images) +
    '<div class="drawer-body">' +
    renderImages(post, images, collection) +
    renderFacts(post, images) +
    renderActions(post, id) +
    renderEngagement(post, data) +
    renderAuthor(post, data?.author) +
    renderComments(data?.comments) +
    renderLikers(data?.likers, data?.savers) +
    renderRaw(post) +
    '</div>'
  );
}

/**
 * The sticky head.
 *
 * Both halves are truncated. `.drawer-head` is a flex row that does not wrap, so
 * a 90 character title with nothing holding it back pushes the Close button off
 * the right edge of the drawer, and there is no other way out of a drawer with a
 * mouse. `.truncate` carries `overflow: hidden`, which is also what lets the
 * wrapper shrink below its content in a flex row: a flex item's automatic
 * minimum size only applies while its overflow is visible.
 */
function renderHead(post, images) {
  const bits = [];
  if (post.surface) bits.push(post.surface);
  bits.push(`${n(images.length)} ${images.length === 1 ? 'image' : 'images'}`);
  bits.push(ago(post.created));

  return (
    '<div class="drawer-head">' +
    '<div class="truncate">' +
    `<h3 class="truncate">${esc(post.title || 'Untitled')}</h3>` +
    `<div class="sub truncate">${esc(bits.join(' · '))}</div>` +
    '</div>' +
    '<span class="spacer"></span>' +
    '<button class="icon-btn" data-close type="button" aria-label="Close">&#10005;</button>' +
    '</div>'
  );
}

/**
 * Every screenshot, side by side, scrolling inside its own box.
 *
 * ## Why the strip is NOT inside a card
 *
 * This is the one piece of layout in this file that had to be measured rather
 * than reasoned about, and it went the other way from the obvious answer.
 *
 * `.drawer-body` is a grid with no explicit columns, so its single implicit
 * column is `auto`, and the automatic MINIMUM of an `auto` track is the
 * min-content size of the items in it. A `.card` has `overflow: visible`, so its
 * min-content size is its contents' min-content size, and the strip is a flex
 * row of `flex: none` images: its min-content is the SUM of four screenshots,
 * about 2600px. Put the strip inside a card and that 2600px becomes the
 * minimum of the grid column, every other card in the drawer stretches to match
 * it, and the drawer scrolls sideways as a whole instead of the strip scrolling
 * inside itself. Measured in Edge: `.drawer` 719px wide with a scrollWidth of
 * 2655.
 *
 * A grid ITEM with a non-visible overflow has an automatic minimum size of zero,
 * which is the escape hatch. `.post-thumb-strip` sets `overflow-x: auto`, so
 * making the strip a direct child of `.drawer-body` rather than a grandchild of
 * it inside a card fixes the whole thing with no stylesheet change: the strip
 * gets the column's width, keeps its 2600px of content, and scrolls. Verified at
 * 1280px and at 420px, where the drawer is the full viewport.
 *
 * It also looks right, which is the part that stops this reading as a
 * workaround. `.post-thumb-strip` already carries its own border, radius,
 * padding and ground, so a card around it was a box inside a box.
 *
 * `tabindex="0"` on the strip is not decoration. A scrollable region that cannot
 * be focused cannot be scrolled with the arrow keys, so a keyboard user reaches
 * image one and stops. With it, Tab lands on the strip and Left and Right pan it.
 *
 * The label goes in `alt` and the filename in `title`, rather than under each
 * image as a caption, because `.post-thumb-strip img` styles the IMG as the flex
 * child. Wrapping each one in a `<figure>` to hold a caption would put an
 * unstyled div in that slot, and an unstyled flex child with no `flex: none` on
 * it shrinks: the strip would compress every screenshot to a sliver instead of
 * scrolling. The stored labels are also just "Screen 1", "Screen 2" on every
 * post this box has, so the caption would have bought nothing.
 */
function renderImages(post, images, collection) {
  if (!images.length) {
    return (
      '<div class="card"><div class="card-body">' +
      emptyState(
        'No images on this post',
        'A post with no images is almost always an upload that failed halfway. The Integrity page lists them under empty posts'
      ) +
      '</div></div>'
    );
  }

  const meta = Array.isArray(post.image_meta) ? post.image_meta : asJson(post.image_meta) || [];

  const strip = images
    .map((file, index) => {
      const label = meta[index]?.label || `Screen ${index + 1}`;
      const src = pb.fileUrl(collection, post.id, file, STRIP_THUMB);
      return (
        `<img src="${esc(src)}" alt="${esc(label)}" title="${esc(`${label}: ${file}`)}" ` +
        'loading="lazy" decoding="async" />'
      );
    })
    .join('');

  return (
    `<div class="post-thumb-strip" tabindex="0" role="group" aria-label="Every image on this post">${strip}</div>` +
    `<div class="tiny muted">${n(images.length)} ${images.length === 1 ? 'image' : 'images'}, in the order they are stored. ` +
    'The strip scrolls sideways inside its own box, so the drawer never does</div>'
  );
}

/**
 * What the post says about itself.
 *
 * The surface is printed RAW, as the stored enum, not as a prettier label. Every
 * other page here counts surfaces by that exact key: the Pulse donut, the Tags
 * page split and the Feed filter all read `screenshots` and `play-feature-graphic`
 * off the wire. A friendly label on this one page would mean two pages
 * disagreeing about the name of the same thing, and an operator filtering Feed
 * for what they just read in the drawer finding nothing.
 *
 * `template_project_id` is here because it is the honest signal for which
 * template is worth keeping: it is the id of the template a post was built from,
 * and it is empty on a post started from a blank artboard.
 */
function renderFacts(post, images) {
  const tags = tagsOf(post);
  const chips = stateChips(post, images);

  const tagRow = tags.length
    ? `<div class="chip-row">${tags.map((tag) => chip(`#${tag}`)).join('')}</div>`
    : '<span class="muted">none</span>';

  return (
    '<div class="card">' +
    '<div class="card-head"><h3>The post</h3></div>' +
    '<div class="card-body">' +
    (chips ? `<div class="chip-row">${chips}</div>` : '') +
    '<dl class="kv">' +
    `<dt>Caption</dt><dd>${post.caption ? esc(post.caption) : '<span class="muted">none</span>'}</dd>` +
    `<dt>Tags</dt><dd>${tagRow}</dd>` +
    `<dt>Surface</dt><dd>${post.surface ? `<span class="surface-chip">${esc(post.surface)}</span>` : '<span class="muted">not set</span>'}</dd>` +
    `<dt>App name</dt><dd>${post.app_name ? esc(post.app_name) : '<span class="muted">not given</span>'}</dd>` +
    `<dt>Template</dt><dd>${post.template_project_id ? `<span class="mono">${esc(post.template_project_id)}</span>` : '<span class="muted">started from a blank artboard</span>'}</dd>` +
    `<dt>Screens</dt><dd class="num">${n(post.screens)}</dd>` +
    `<dt>Posted</dt><dd>${esc(stamp(post.created))} <span class="muted">(${esc(ago(post.created))})</span></dd>` +
    `<dt>Last edited</dt><dd>${esc(stamp(post.updated))}</dd>` +
    `<dt>Row id</dt><dd class="mono">${esc(post.id)}</dd>` +
    '</dl>' +
    '</div></div>'
  );
}

/**
 * Everything this drawer can write, in one row, with the reversible ones first.
 *
 * Hide is at the front because it is the answer to almost every report: it takes
 * the post out of every feed, tag count and author page, it touches no counter,
 * and it is one press to undo with the evidence still attached. Delete is last
 * and red, and it is the only one on this row that cannot be taken back.
 *
 * The PocketBase admin link is an escape hatch and is meant to be. This
 * dashboard shows what an operator needs and deliberately not every column; when
 * the answer is in a field nobody thought to render, the row itself is one click
 * away. The URL shape was read off the admin bundle this box is serving
 * (`#/collections?collection=<name>&record=<id>`), not guessed.
 */
function renderActions(post, id) {
  const adminUrl =
    `${String(pb.auth.url || '').replace(/\/$/, '')}/_/#/collections?collection=posts&record=${encodeURIComponent(id)}`;

  return (
    '<div class="card">' +
    '<div class="card-head">' +
    '<h3>Actions</h3>' +
    '<span class="sub">Every one of these asks first, and says what it did afterwards</span>' +
    '</div>' +
    '<div class="card-body">' +
    '<div class="btn-row">' +
    `<button class="btn btn-sm" data-act="${post.hidden ? 'unhide' : 'hide'}" type="button">${post.hidden ? 'Unhide' : 'Hide'}</button>` +
    `<button class="btn btn-sm" data-act="${post.featured ? 'unfeature' : 'feature'}" type="button">${post.featured ? 'Unfeature' : 'Feature'}</button>` +
    '<button class="btn btn-sm" data-copy-id type="button">Copy id</button>' +
    `<a class="btn btn-sm" href="${esc(adminUrl)}" target="_blank" rel="noopener noreferrer">Open in PocketBase</a>` +
    '<span class="spacer"></span>' +
    '<button class="btn btn-sm btn-danger" data-act="delete" type="button">Delete post</button>' +
    '</div>' +
    '</div></div>'
  );
}

/**
 * The counters, with the drift called out when the two disagree.
 *
 * `posts.likes` and `posts.comments` are caches of `post_likes` and `comments`,
 * and the route counts both the stored column and the join table so this page
 * can put them side by side. They disagree for one ordinary reason: every
 * relation in the schema cascade deletes, so removing an account takes its like
 * rows with it and leaves this column exactly where it was. That is not a bug to
 * hide. It is the thing the Integrity page exists to find and Recount exists to
 * repair, and this drawer is where an operator meets it first.
 *
 * A table rather than a pair of chips, because the question is comparative and a
 * comparison wants two columns. The status column carries a WORD, so the row
 * reads correctly for somebody who cannot tell the amber chip from the grey one.
 *
 * Views, remixes and saves sit in their own row underneath with no comparison,
 * and the copy says why: nothing on this box derives them from a join table, so
 * there is no second number to check them against. Pretending otherwise by
 * showing them in the same table with an empty "actual" column would read as a
 * check that failed.
 */
function renderEngagement(post, data) {
  const drift = data?.drift || {};

  const row = (label, stored, actual) => {
    const off = Number(stored) !== Number(actual);
    const delta = Number(stored) - Number(actual);
    const status = off
      ? chip(delta > 0 ? `${n(delta)} too high` : `${n(-delta)} too low`, 'warn')
      : chip('agrees', 'good');
    return (
      '<tr>' +
      `<td>${esc(label)}</td>` +
      `<td class="num">${n(stored)}</td>` +
      `<td class="num">${n(actual)}</td>` +
      `<td>${status}</td>` +
      '</tr>'
    );
  };

  const anyDrift =
    Number(drift.likes_stored) !== Number(drift.likes_actual) ||
    Number(drift.comments_stored) !== Number(drift.comments_actual);

  return (
    '<div class="card">' +
    '<div class="card-head">' +
    '<h3>Engagement</h3>' +
    '<span class="sub">Stored is the column the feed reads. Actual is a live count of the join table</span>' +
    '</div>' +
    '<div class="card-body">' +
    '<div class="table-wrap"><table class="data">' +
    '<thead><tr><th>Counter</th><th class="num">Stored</th><th class="num">Actual</th><th>Status</th></tr></thead>' +
    '<tbody>' +
    row('Likes', drift.likes_stored, drift.likes_actual) +
    row('Comments', drift.comments_stored, drift.comments_actual) +
    '</tbody></table></div>' +
    (anyDrift
      ? '<div class="tiny muted">A difference here is normally an account that was deleted: the cascade removed its like and comment rows and left these columns alone. ' +
        'Integrity has a Fix button that rebuilds them from the join tables</div>'
      : '') +
    '<dl class="kv">' +
    `<dt>Views</dt><dd class="num">${n(post.views)}</dd>` +
    `<dt>Remixes</dt><dd class="num">${n(post.remixes)}</dd>` +
    `<dt>Saves</dt><dd class="num">${n(data?.savers)}</dd>` +
    '</dl>' +
    '<div class="tiny muted">Views, remixes and saves have no join table behind them, so there is nothing to check them against. ' +
    'Who saved a post is deliberately not shown anywhere: a save is private and nobody agreed to publish it</div>' +
    '</div></div>'
  );
}

/**
 * Who posted it, or a plain statement that nobody did any more.
 *
 * `author` is `null` and never `{}` when the account has gone, which the route
 * chose deliberately so this can be said in words. An empty object would render
 * as a nameless row with a blank avatar and read as a rendering fault, and the
 * operator would go looking for a bug instead of reading the fact.
 *
 * The id is still printed in that case, because it is the only handle left on
 * the account and it is what a `mod_log` search is keyed on.
 */
function renderAuthor(post, author) {
  if (!author) {
    return (
      '<div class="card">' +
      '<div class="card-head"><h3>Author</h3></div>' +
      '<div class="card-body">' +
      emptyState(
        'The account behind this post is gone',
        'The post row still holds the id it was written with. Everything that account owned went with it when it was deleted, and counters elsewhere may still be counting it'
      ) +
      (post.author ? `<dl class="kv"><dt>Author id</dt><dd class="mono">${esc(post.author)}</dd></dl>` : '') +
      '</div></div>'
    );
  }

  const handle = handleOf(author);
  /*
   * The badge is `good`, not `accent`.
   *
   * `accent` on this dashboard marks a deliberate editorial choice or a live
   * capability: a featured post, a project shared by link, an OAuth provider.
   * `good` marks a state that is fine as it is. A verified badge is the second
   * of those, and it is the same fact `accountDetail.js` already renders as
   * `verified badge` in green, so rendering it here in the accent colour made
   * one fact wear two colours depending on which drawer you opened. Worse, it
   * put it in the same colour as `featured` two cards up, which is a claim
   * about the POST rather than about its author.
   */
  const chips =
    (author.banned ? chip('banned', 'bad') : '') +
    (author.verified_badge ? chip('badge', 'good') : '');

  return (
    '<div class="card">' +
    '<div class="card-head"><h3>Author</h3></div>' +
    '<div class="card-body">' +
    '<div class="identity">' +
    avatar(author, 'lg', pb.auth.url) +
    `<a href="#/account/${esc(author.id)}" data-account="${esc(author.id)}" class="strong">${esc(nameOf(author))}</a>` +
    (handle ? `<span class="muted">${esc(handle)}</span>` : '') +
    (chips ? `<span class="chip-row">${chips}</span>` : '') +
    '</div>' +
    '<dl class="kv">' +
    `<dt>Email</dt><dd>${author.email ? esc(author.email) : '<span class="muted">none on the row</span>'}</dd>` +
    `<dt>Posts</dt><dd class="num">${n(author.post_count)}</dd>` +
    `<dt>Followers</dt><dd class="num">${n(author.followers)}</dd>` +
    `<dt>Joined</dt><dd>${esc(stamp(author.created))}</dd>` +
    `<dt>Account id</dt><dd class="mono">${esc(author.id)}</dd>` +
    '</dl>' +
    '</div></div>'
  );
}

/**
 * The thread, oldest first, with the two levers on every row.
 *
 * Oldest first because that is how a thread reads and because it is the order
 * `idx_comments_post` already produces, so the route pays nothing for it. It is
 * NOT the newest-first ordering the rest of this dashboard uses, which is worth
 * saying on screen rather than leaving an operator to work out from timestamps.
 *
 * Hide and Delete on the row, rather than a drawer inside a drawer. A comment is
 * one sentence and the decision about it is made from reading it; making that
 * two clicks and a second overlay is how a moderation queue stops being worked.
 *
 * The 50 cap is the route's and is stated rather than silently applied. A post
 * with more comments than that has a link out to the Comments page, which pages
 * properly.
 */
function renderComments(comments) {
  const list = Array.isArray(comments) ? comments : [];

  if (!list.length) {
    return (
      '<div class="card">' +
      '<div class="card-head"><h3>Comments</h3></div>' +
      '<div class="card-body">' +
      emptyState('Nothing has been said on this post', 'Comments people leave in the app show up here, hidden ones included') +
      '</div></div>'
    );
  }

  const hidden = list.filter((row) => row.hidden).length;

  const rows = list
    .map((row) => {
      const who = {
        id: row.author,
        name: row.author_name,
        handle: row.author_handle,
        avatar: row.author_avatar,
      };
      const handle = handleOf(who);
      return (
        '<tr>' +
        `<td>${esc(row.body)}${row.hidden ? ` ${chip('hidden', 'warn')}` : ''}</td>` +
        '<td>' +
        (row.author
          ? `<a href="#/account/${esc(row.author)}" data-account="${esc(row.author)}">${esc(nameOf(who))}</a>` +
            (handle ? ` <span class="muted">${esc(handle)}</span>` : '')
          : '<span class="muted">account gone</span>') +
        '</td>' +
        `<td class="num">${n(row.likes)}</td>` +
        `<td class="nowrap" title="${esc(stamp(row.created))}">${esc(ago(row.created))}</td>` +
        '<td><span class="row-actions">' +
        `<button class="btn btn-sm" type="button" data-comment="${esc(row.id)}" data-comment-act="${row.hidden ? 'unhide' : 'hide'}">${row.hidden ? 'Unhide' : 'Hide'}</button>` +
        `<button class="btn btn-sm btn-danger" type="button" data-comment="${esc(row.id)}" data-comment-act="delete">Delete</button>` +
        '</span></td>' +
        '</tr>'
      );
    })
    .join('');

  return (
    '<div class="card">' +
    '<div class="card-head">' +
    '<h3>Comments</h3>' +
    `<span class="sub">Oldest first, the order the thread reads in${hidden ? `. ${n(hidden)} hidden` : ''}</span>` +
    `<span class="spacer"></span><span class="muted tiny">${n(list.length)} shown${list.length >= 50 ? ', the route stops at 50' : ''}</span>` +
    '</div>' +
    '<div class="card-body">' +
    '<div class="table-wrap"><table class="data">' +
    // "Actions", not "Act". `comments.js` heads the same column "Actions" and
    // every drawer card on this page is headed "Actions", so the abbreviation
    // here was the only one of its kind and read as a verb telling the operator
    // to do something rather than as a label for the column under it.
    '<thead><tr><th>Comment</th><th>Author</th><th class="num">Likes</th><th>When</th><th>Actions</th></tr></thead>' +
    `<tbody>${rows}</tbody>` +
    '</table></div>' +
    '</div></div>'
  );
}

/**
 * Who liked it, newest first, and how many kept it.
 *
 * The liker list is the fastest way to spot the shape of a fake: forty likes
 * from accounts that all joined on the same afternoon is a pattern you can see
 * in this table and cannot see in the number 40. Every row clicks through to the
 * account drawer, which is where that suspicion gets confirmed or dropped.
 *
 * Savers is a number and not a list, and the route says why: a save is private,
 * nobody has agreed to publish who made one, and the count answers the only
 * question an operator actually has, which is whether the post is being kept.
 */
function renderLikers(likers, savers) {
  const list = Array.isArray(likers) ? likers : [];

  if (!list.length) {
    return (
      '<div class="card">' +
      '<div class="card-head"><h3>Likes</h3></div>' +
      '<div class="card-body">' +
      emptyState('Nobody has liked this post', 'Every like in the app writes a row here, and the newest 40 of them show up in this list') +
      '</div></div>'
    );
  }

  const rows = list
    .map((row) => {
      const who = { id: row.u, name: row.name, handle: row.handle, avatar: row.avatar };
      const handle = handleOf(who);
      return (
        `<tr class="clickable" data-account="${esc(row.u)}" tabindex="0">` +
        `<td><span class="identity">${avatar(who, 'sm', pb.auth.url)}<span class="truncate">${esc(nameOf(who))}</span></span></td>` +
        `<td class="muted">${handle ? esc(handle) : 'no handle'}</td>` +
        `<td class="nowrap" title="${esc(stamp(row.created))}">${esc(ago(row.created))}</td>` +
        '</tr>'
      );
    })
    .join('');

  return (
    '<div class="card">' +
    '<div class="card-head">' +
    '<h3>Likes</h3>' +
    '<span class="sub">Newest first. Saves are counted but never listed, because a save is private</span>' +
    `<span class="spacer"></span><span class="muted tiny">${n(list.length)} shown${list.length >= 40 ? ', the route stops at 40' : ''}, ${n(savers)} saved</span>` +
    '</div>' +
    '<div class="card-body">' +
    '<div class="table-wrap"><table class="data">' +
    '<thead><tr><th>Account</th><th>Handle</th><th>Liked</th></tr></thead>' +
    `<tbody>${rows}</tbody>` +
    '</table></div>' +
    '</div></div>'
  );
}

/**
 * The two JSON columns, exactly as they are stored.
 *
 * `image_meta` is a parallel array of `{aspect, fit, label}` that the server
 * never interprets, and notably it has NO byte size in it, which is why the
 * Storage page cannot total post images and has to walk the disk instead. This
 * is the only place on the box anybody can look inside one, so it renders raw.
 * `rawJson` answers an empty string for nothing at all, so both can be
 * concatenated without leaving an empty disclosure behind.
 */
function renderRaw(post) {
  const blocks = rawJson('image_meta as stored', post.image_meta) + rawJson('tags as stored', post.tags);
  if (!blocks) return '';
  return `<div class="card"><div class="card-body">${blocks}</div></div>`;
}

// ------------------------------------------------------------------ wiring ---

/**
 * The Close button, on every pass.
 *
 * `openDrawer` wires `[data-close]` to `closeDrawer` when it first fills the
 * drawer, and every repaint after that throws that listener away with the
 * markup. So it is re-attached here, and it goes through the router rather than
 * straight to `closeDrawer`: `#/post/<id>` is a real URL and closing has to take
 * the hash back to the list underneath. Escape and the scrim reach the same
 * place through the `dash:drawer-close` watcher instead, because those two
 * cannot be intercepted from in here.
 */
function wireChrome(drawer, id) {
  $$('[data-close]', drawer).forEach((button) =>
    button.addEventListener('click', () => {
      if (location.hash === `#/post/${id}`) {
        release();
        window.__dash.go(returnRoute());
      } else {
        closeDrawer();
      }
    })
  );
}

/**
 * Every control in the painted drawer.
 *
 * Re-run after each repaint, alongside `wireChrome`, because `paint` reassigns
 * `innerHTML` and takes every listener with it. Nothing here is delegated: the
 * drawer is one screen of controls rather than an unbounded list, so a handler
 * per button is clearer than a click map, and the repaint is what keeps them
 * from accumulating.
 */
function wireDrawer(drawer, data, id, { refresh, moderate, once }) {
  const post = data?.post || {};
  const title = post.title || 'this post';
  const drift = data?.drift || {};

  /*
   * A line for the delete confirm when the stored column and the real count
   * disagree, and nothing at all when they do not.
   *
   * Worth saying rather than silently printing the right number. An operator
   * who has just read "996 too high" in the Engagement table and then sees "3
   * comments" in the confirm needs to know those two are the same fact and not
   * a third number appearing from somewhere; otherwise the honest figure looks
   * like the dialog disagreeing with the page. `esc` is not needed on any of
   * this: every part of it is a number this file formatted.
   */
  const drifts = (stored, actual) => {
    const a = Number(stored);
    const b = Number(actual);
    return Number.isFinite(a) && Number.isFinite(b) && a !== b;
  };
  const driftBits = [
    drifts(drift.comments_stored, drift.comments_actual)
      ? `${n(drift.comments_stored)} comments`
      : '',
    drifts(drift.likes_stored, drift.likes_actual) ? `${n(drift.likes_stored)} likes` : '',
  ].filter(Boolean);
  const driftNote = driftBits.length
    ? `Those are live counts. The post row itself still claims ${driftBits.join(' and ')}, ` +
      'which is the drift the Engagement table above is reporting'
    : '';

  wireChrome(drawer, id);

  // Straight through to the account drawer, from the author row, from a
  // comment's author and from a liker. `go` re-routes the hash, so the account
  // drawer REPLACES this one rather than stacking a second overlay on top of it.
  $$('[data-account]', drawer).forEach((element) => {
    const open = () => {
      const account = element.dataset.account;
      if (account) window.__dash.go(`#/account/${account}`);
    };
    element.addEventListener('click', (ev) => {
      ev.preventDefault();
      open();
    });
    // The liker rows are table rows and not anchors, so they need the key
    // handling an anchor would have brought with it.
    if (element.tagName === 'TR') {
      element.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        ev.preventDefault();
        open();
      });
    }
  });

  const copy = $('[data-copy-id]', drawer);
  if (copy) copy.addEventListener('click', () => copyText(id));

  /*
   * The five post actions, behind a confirm apiece.
   *
   * All five, not just Delete. The gate footer promises that everything which
   * writes asks first, and hiding a post is a change to what every visitor sees.
   * The confirm carries the old value beside the new one for the two flag flips,
   * which is what `confirmAction`'s `from` and `to` are for and is a great deal
   * more use than "are you sure" on a button somebody has pressed forty times
   * today.
   *
   * The bodies are HTML, so the title is escaped HERE. `confirmAction` escapes
   * its own title and its diff and deliberately does not touch `body`, so that a
   * caller can put a count in bold.
   */
  const POST_ACTIONS = {
    hide: {
      title: 'Hide this post?',
      body:
        `<p><strong>${esc(title)}</strong> comes out of every feed, every tag count and its author's page.</p>` +
        '<p class="muted">Nothing is deleted, no counter moves, the images stay on the disk and this is one press to undo. ' +
        'Hiding is the right answer to almost every report, because the evidence is still attached when somebody asks about it next week</p>',
      confirmLabel: 'Hide',
      from: 'visible',
      to: 'hidden',
    },
    unhide: {
      title: 'Put this post back?',
      body: `<p><strong>${esc(title)}</strong> returns to the feed, to its tags and to its author's page.</p>`,
      confirmLabel: 'Unhide',
      from: 'hidden',
      to: 'visible',
    },
    feature: {
      title: 'Feature this post?',
      body:
        `<p><strong>${esc(title)}</strong> carries the featured badge and gets the ranking boost from <span class="mono">feed_featured_boost</span>.</p>` +
        '<p class="muted">It will be seen by people who were not looking for it, so it is worth reading the caption and the comments first</p>',
      confirmLabel: 'Feature',
      from: 'ordinary',
      to: 'featured',
    },
    unfeature: {
      title: 'Stop featuring this post?',
      body: `<p><strong>${esc(title)}</strong> loses the badge and the ranking boost. It stays in the feed.</p>`,
      confirmLabel: 'Unfeature',
      from: 'featured',
      to: 'ordinary',
    },
    delete: {
      title: 'Delete this post?',
      danger: true,
      /*
       * The counts come from `data.drift`, NOT from `post.comments` and
       * `post.likes`.
       *
       * ## The bug this fixes
       *
       * It used to read the stored columns, on the one page in this dashboard
       * whose entire subject is that those columns drift. The Engagement table
       * four inches up the same drawer says "996 too high" in amber, and then
       * the confirm underneath it promised to delete 999 comments when three
       * existed. A confirm dialog is the one piece of copy here that has to be
       * read rather than skimmed, and a number in it that the same screen has
       * already contradicted is worse than no number: it teaches the operator
       * that the bold figures in these dialogs are decoration.
       *
       * `*_actual` is a live COUNT over the join table taken in the same pass
       * as the rest of this payload, which is exactly what the cascade will
       * remove. `??` rather than `||` so that a genuine zero is printed as
       * zero instead of falling through to the stored column.
       */
      body:
        `<p><strong>${esc(title)}</strong> and everything attached to it go: ` +
        `<strong>${n(drift.comments_actual ?? post.comments)}</strong> comments, ` +
        `<strong>${n(drift.likes_actual ?? post.likes)}</strong> likes, every save, and ` +
        `<strong>${n(imagesOf(post).length)}</strong> uploaded images.</p>` +
        (driftNote ? `<p class="muted">${driftNote}</p>` : '') +
        "<p class=\"muted\">The author's post count is decremented in the same write. This cannot be undone and Hide does the same job reversibly</p>",
      confirmLabel: 'Delete it',
    },
  };

  $$('[data-act]', drawer).forEach((button) => {
    button.addEventListener('click', () =>
      once(async () => {
        const action = button.dataset.act;
        const spec = POST_ACTIONS[action];
        if (!spec) return;

        const ok = await confirmAction(spec);
        if (!ok) return;

        const reply = await moderate('post', id, action, button);
        if (!reply) return;

        syncBadge('feed', 'posts');

        /*
         * A deleted post has no drawer to refresh. Going back to the list is not
         * merely tidier than closing: the hash still names a record that no
         * longer exists, and leaving it there means a refresh or a shared link
         * lands on a 404 for something the operator knows perfectly well they
         * deleted.
         */
        if (action === 'delete') {
          release();
          window.__dash.go(returnRoute());
          return;
        }

        await refresh();
      })
    );
  });

  /*
   * Hide and Delete on a comment.
   *
   * Both go through `moderate` rather than through the record API, and the
   * difference matters for Delete: `posts.comments` is a cache of the comments
   * table and a raw DELETE would leave it one too high, which is exactly the
   * drift shown four inches up this same drawer. The route decrements it inside
   * the transaction, clamped at zero.
   */
  $$('[data-comment-act]', drawer).forEach((button) => {
    button.addEventListener('click', () =>
      once(async () => {
        const commentId = button.dataset.comment;
        const action = button.dataset.commentAct;
        if (!commentId || !action) return;

        const row = (data?.comments || []).find((item) => item.id === commentId);
        // Trimmed for the dialog. A 500 character comment in a confirm pushes
        // the buttons off the bottom of a short window, and the whole body is on
        // the row behind the dialog anyway.
        const text = String(row?.body || '');
        const body = text ? `${text.slice(0, 120)}${text.length > 120 ? '...' : ''}` : 'this comment';

        const spec =
          action === 'delete'
            ? {
                title: 'Delete this comment?',
                danger: true,
                confirmLabel: 'Delete it',
                /*
                 * "This cannot be undone" is stated outright, because every
                 * other delete confirm in this dashboard states it and this one
                 * was the only one that did not. The account delete, the
                 * project delete and the post delete four inches up this same
                 * drawer all say it in as many words. An operator learns the
                 * shape of these dialogs, and a delete confirm missing the one
                 * sentence the others all carry reads as a smaller decision
                 * than it is. It is not smaller: there is no soft delete on
                 * this box and no backup this dashboard can reach.
                 */
                body:
                  `<p><strong>${esc(body)}</strong></p>` +
                  "<p class=\"muted\"><strong>This cannot be undone.</strong> It goes with its likes, and the post's comment count is decremented in the same write. Hiding takes it out of the thread and keeps it</p>",
              }
            : {
                title: action === 'hide' ? 'Hide this comment?' : 'Put this comment back?',
                confirmLabel: action === 'hide' ? 'Hide' : 'Unhide',
                from: action === 'hide' ? 'in the thread' : 'hidden',
                to: action === 'hide' ? 'hidden' : 'in the thread',
                body:
                  `<p><strong>${esc(body)}</strong></p>` +
                  (action === 'hide'
                    ? '<p class="muted">Nothing is deleted and no counter moves. It stays readable from here</p>'
                    : ''),
              };

        const ok = await confirmAction(spec);
        if (!ok) return;

        const reply = await moderate('comment', commentId, action, button);
        if (!reply) return;

        syncBadge('comments', 'comments');
        await refresh();
      })
    );
  });
}

/**
 * Keep a rail badge honest after this drawer changed what it counts.
 *
 * The rail carries hidden posts on Feed and hidden comments on Comments, and
 * both numbers are fetched by the shell when a page mounts. Hiding something
 * from in here changes one of them without the shell ever knowing, so the badge
 * would sit there stale until the next navigation, which is the worst state for
 * a queue counter to be in: quietly wrong rather than obviously missing.
 *
 * One cheap count, and every failure is swallowed. A badge is a convenience, and
 * an error toast about one on top of the toast that just reported the action
 * itself would be two messages about one press, the second of which the operator
 * can do nothing about.
 *
 * Zero is passed as `null` on purpose. `setRailCount` hides the badge for null,
 * and `app.js` argues the case: a rail full of zeroes teaches the eye to skip
 * the badges, and then the one that says 4 gets skipped too.
 */
function syncBadge(railId, collection) {
  pb.count(collection, 'hidden = true')
    .then((total) => window.__dash.setRailCount(railId, total || null))
    .catch(() => {});
}

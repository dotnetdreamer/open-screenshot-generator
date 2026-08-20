/**
 * Settings, the tunables this box reads, grouped and documented in place.
 *
 * This is the page that makes the one-row-per-setting shape of the `settings`
 * collection worth having. A `description` column only means anything when
 * there is one row per thing being described, and what it buys is exactly this:
 * an operator can read what a number does at the moment they are about to move
 * it, rather than going to find the migration that seeded it. So the page is
 * not a form over a table. It IS the documentation for what each number does,
 * and every sentence on it is written on that assumption.
 *
 * ## The safety net, and why it is not a licence
 *
 * Every hook on this box carries its own default for every key. `DEFAULTS` in
 * `pb-hooks/lib/openscreengen.js` is the whole list, and the reader there skips
 * any row whose key is not in it, falls back to the default with a warning when
 * a number will not parse, and reads any switch that is not the exact word
 * `false` as on. A deleted row, a blank row or a row full of nonsense therefore
 * behaves like the seeded one instead of switching a feature off.
 *
 * That is a safety net and not a licence. The failure it converts is the loud
 * one: instead of the feed going dark because somebody typed `ten` into
 * `max_posts_per_day`, the box quietly carries on at 10 while THIS PAGE says
 * `ten`. Nothing reports that, nobody is paged for it, and the row reads as one
 * thing while the box does another until somebody happens to look. Which is why
 * every row here prints what the hooks will actually make of the value it is
 * holding, and why the confirm prints it again before the write lands.
 *
 * ## The three guards on the write
 *
 * 1. **The confirm shows the old value beside the new one.** "Are you sure" on
 *    its own is a button people learn to click through inside a week, and the
 *    thing being changed here is a single unlabelled string, which is the worst
 *    possible case for a confirm that only asks. `ui.confirmAction` takes `from`
 *    and `to` for precisely this, and renders the pair itself so no caller can
 *    quietly forget to include it.
 * 2. **Anything that looks like a credential is masked and cannot be edited
 *    here.** See `CREDENTIAL_RE` below, which also explains at length why the
 *    two `*_client_ids` rows on this box are deliberately NOT caught by it.
 * 3. **The rows that change what users get carry a loud note in the row
 *    itself**, before the confirm rather than only inside it. See `LOUD`.
 *
 * ## What this collection does not have
 *
 * There is no `created` column here at all, and on an older box there is no
 * `updated` column either. So nothing on this page is ever sorted by time: the
 * list is sorted by `key`, which is also the order somebody scanning for a name
 * wants. A row whose `updated` is absent or empty is shown as not edited since
 * the box was set up, which is the truth, rather than as an empty cell, which
 * looks like a rendering bug. The seeded rows all read that way today because
 * the autodate only stamps writes made after the column existed.
 *
 * ## Every edit is recorded
 *
 * A successful save appends a `mod_log` row through the record API, with the
 * old and the new value in its note. `mod_log.target` accepts `settings` for
 * this, and there is no route for it because none is needed: the collection is
 * superuser-only like everything else here. The log is written AFTER the value
 * lands and its failure is reported separately, because an audit line that
 * could cost the change it describes is worse than a missing audit line.
 */

import * as pb from '../pb.js';
import {
  esc,
  n,
  bytes,
  stamp,
  toast,
  emptyState,
  errorState,
  skeleton,
  confirmAction,
  newRef,
} from '../ui.js';

// ------------------------------------------------ how a value is read ------

/**
 * What the hooks make of each key's raw string.
 *
 * This mirrors the shape of `DEFAULTS` in `pb-hooks/lib/openscreengen.js`,
 * where the TYPE of the default is what decides how the row is parsed: a number
 * default parses the row as a number, a boolean as a boolean, a string as a
 * string with `unset` meaning empty. `github_allow_pat` is the one entry in
 * `STRICT_BOOLEANS` over there, which inverts the polarity: every other switch
 * reads anything that is not `false` as on, and that one reads only the exact
 * word `true` as on.
 *
 * Yes, this is a second copy of knowledge that lives in the hook. It is a copy
 * of the SHAPE and never of the value, and the cost of it drifting is bounded
 * and visible: a key added to `DEFAULTS` and not added here renders with no
 * read hint and lands in "Everything else", which looks exactly like the thing
 * it is, an undocumented row. Deriving the shape from the stored value instead
 * was the obvious alternative and it is wrong in the one case that matters:
 * a number row containing a typo would stop being classified as a number
 * precisely when saying "this will not parse" is the useful thing to say.
 *
 * `bytes` is a number that is additionally worth printing as a size. `1073741824`
 * is a number nobody reads correctly at a glance and `1.0 GB` is the same fact.
 */
const READS = {
  enabled: 'switch',
  writes_enabled: 'switch',
  signin_enabled: 'switch',
  avatar_fetch_enabled: 'switch',
  cloud_projects_enabled: 'switch',
  github_allow_pat: 'strict-switch',
  google_client_ids: 'text',
  github_client_ids: 'text',
  official_handle: 'text',
  moderation_note: 'text',
  feed_page_size: 'number',
  feed_max_page_size: 'number',
  feed_rank_window: 'number',
  feed_max_following: 'number',
  feed_fresh_boost: 'number',
  feed_fresh_hours: 'number',
  feed_featured_boost: 'number',
  max_posts_per_day: 'number',
  max_comments_per_hour: 'number',
  max_images_per_post: 'number',
  max_image_bytes: 'bytes',
  max_cloud_projects: 'number',
  max_cloud_doc_bytes: 'bytes',
  max_cloud_asset_bytes: 'bytes',
  max_cloud_project_bytes: 'bytes',
  max_cloud_user_bytes: 'bytes',
};

/**
 * The one key that wants more than a 320px input.
 *
 * `moderation_note` is a sentence shown to every visitor who reaches an empty
 * feed, and `.setting-val input` is capped at 320px by the sheet, which is
 * about forty characters of visible text. Composing public copy through a slot
 * that narrow is how a typo ships. A textarea is not capped by that rule and is
 * already styled, so it is the field this row gets. The Enter key therefore
 * does not save on this row, and the keydown handler below skips it explicitly:
 * a multi line box where Enter submits is a box you cannot type a second line
 * into, and finding that out costs you the first line.
 */
const MULTILINE = new Set(['moderation_note']);

// --------------------------------------------------- the credential guard ---

/**
 * Guard two: anything that looks like a credential is masked and read only.
 *
 * A pattern rather than a hand kept denylist, and that is the whole point. A
 * denylist protects the keys somebody remembered on the day they added the row;
 * a pattern protects the key that gets added at midnight six months from now by
 * somebody who has never read this file. The day a `push_secret` or an
 * `smtp_password` row appears in this collection it is masked without anybody
 * doing anything, which is the only version of this guard that actually holds.
 *
 * **On this box the pattern currently matches nothing, and that is correct.**
 * The two rows that look like credentials to a passing reader are
 * `google_client_ids` and `github_client_ids`, and neither is a secret:
 *
 *   - A client id is public by construction. It is handed to every browser that
 *     loads a sign-in button and it sits in the shipped app bundle, so it is
 *     already in the hands of anybody who would want it. It identifies which
 *     OAuth app a token came from, it does not authorise anything.
 *   - Both rows here are ALLOWLISTS of such ids, which is the opposite of a
 *     secret: they are the box saying which apps it belongs to. Publishing one
 *     costs nothing; getting one wrong locks the door, which is a thing an
 *     operator has to be able to see and fix from here.
 *   - The actual client secret never reaches this box at all. Google tokens are
 *     verified by audience, and GitHub's client id is read off the
 *     `X-OAuth-Client-Id` header GitHub puts on its own responses, so the caller
 *     cannot claim one. There is no `*_client_secret` row in this collection.
 *
 * So they stay visible and editable, on purpose, and this comment exists so the
 * next reader does not have to work that out for themselves, or worse, mask
 * them "to be safe" and leave nobody able to fix a broken sign-in from here.
 *
 * `MASKED` is the escape hatch for a future key whose name does not carry a
 * warning word. It is empty today and the masked branch in `settingRow` is
 * therefore dead code on this box, which is deliberate: the alternative is
 * writing that branch in a hurry on the day it is first needed.
 */
const CREDENTIAL_RE = /(secret|password|passphrase|private|credential|_key$|_token$|api_key)/i;
const MASKED = new Set();

const isCredential = (key) => MASKED.has(key) || CREDENTIAL_RE.test(key);

// ------------------------------------------------------------ loud rows ---

/**
 * Guard three: the rows that change what users get, called out in the row.
 *
 * Each sentence here is what the seeded description does NOT already say, which
 * is almost always the consequence. The description explains the mechanism, and
 * an operator standing over the box at two in the morning does not need the
 * mechanism, they need to know what breaks and for whom. Repeating the seeded
 * wording here would be worse than saying nothing: two paragraphs that agree
 * train the eye to skip both.
 *
 * They are printed in the row and again in the confirm, and a key in this map
 * also makes its confirm `danger`. That is the whole of what "loud" means here.
 */
const LOUD = {
  enabled:
    'Off is silent on the way out: anybody with Discover open keeps the posts already on their screen and every tap after that fails with no explanation, and nobody is signed out or told why. Nothing is queued while it is off, so the reads and writes that happen in that window are simply lost.',
  writes_enabled:
    'The feed keeps looking perfectly healthy while this is off, which is the point and also the cost: somebody tapping like gets a failure they cannot tell from a bug. It hides nothing that is already posted, so it is a pause on new writes and never a way to take content down.',
  signin_enabled:
    'This closes the door without emptying the room. Anybody already holding a token carries on posting until it expires, and a new visitor gets a sign-in that fails rather than one that is visibly closed, so expect the reports to arrive as "the app is broken".',
  github_allow_pat:
    'On, any GitHub account anywhere can open an account here, because a pasted token was never issued to this app and carries nothing tying it to it. This is the widest door on the box: turn it on while the sign-in Worker is being set up, and off again afterwards. It is also the one row where only the exact word true counts as on, so a typo leaves it shut rather than open.',
  cloud_projects_enabled:
    'Off mid-session means the next save fails and the work stays only in that browser, so this stops new writes and is never a backup. Nothing already on the disk is deleted or changed by turning it off, and every existing project is still there when it goes back on.',
  max_posts_per_day:
    'A rolling 24 hours, not a reset at midnight, and it applies to every account including the official one. Lowering it to stop one flooder also stops the eleventh post from everybody else that day, and they see a refusal that names the number.',
  max_comments_per_hour:
    'A rolling hour, counted per account across the whole feed rather than per post. Set it low and an ordinary back and forth between two people under one post reaches the limit in a few minutes, and the person on the wrong side of it sees a comment that will not send.',
  max_image_bytes:
    'Per screen, not per post, so a six screen share can be six times this number on the disk. Raising it here alone changes nothing: the upload still fails at the cap the collection carries on its own, and the person sharing sees a post that will not go through with nothing telling them why.',
  max_cloud_user_bytes:
    'Lowering it frees nothing. Accounts already over the new number keep everything they have and simply cannot add to it, so this bounds the disk tomorrow and not the disk today. Storage lists the owners sitting nearest this line, which is the page to read before moving it.',
  official_handle:
    'Point this at the handle of a real person and their posts start wearing the check that says this account is the app itself. Nothing here validates that the handle exists, so a typo quietly means no account is official at all and the showcase posts lose their badge.',
  moderation_note:
    'Whatever is typed here is shown to every visitor who reaches an empty feed, so it is public copy and not an operator note. It is rendered as plain text with no formatting and no link, and the word unset is what hides the line rather than emptying the box.',
  feed_featured_boost:
    'Raise it far and the featured posts stop being a shortlist and become the feed, because this multiplies the score of a post instead of competing with it. It moves For you and Trending only, so Newest still shows the feed in the order it really arrived.',
  feed_fresh_boost:
    'Raise it past the engagement a good post on this box actually collects and the two ranked tabs turn into a second Newest, with nothing anybody liked near the top. Six is worth about six likes, so compare it against what a real post here gets before moving it.',
};

// -------------------------------------------------------------- grouping ---

/**
 * The six groups, and the ordering trap that decides what goes in them.
 *
 * **A key belongs to the FIRST group whose test claims it.** That single rule is
 * what makes this list an ordering problem rather than a list of headings, and
 * it is the trap the Ludo reference documents at length because it has bitten
 * there: a greedy group placed above a narrower one is a narrower group that
 * never sees its own rows, and nothing complains. The rows do not vanish, they
 * turn up under a heading that is almost right, which is the failure mode you do
 * not notice for months.
 *
 * There is exactly one greedy test here and its position is the whole design:
 *
 *   `Limits and rate control` matches `^max_`, which claims all five
 *   `max_cloud_*` keys as well as its own four. So **Cloud projects sits above
 *   it**, one place earlier than the reading order would put it, and takes its
 *   own rows out of the pool first. Flip those two and the disk ceilings
 *   scatter into a group about posting rate, where nobody looking for a storage
 *   limit would think to look, and the loud note on `max_cloud_user_bytes`
 *   would sit under a heading that has nothing to do with the disk.
 *
 * The greed is deliberate rather than something to anchor away. `^max_` means a
 * `max_tags_per_post` added next year lands in the limits group by itself
 * instead of falling into "Everything else"; the price of that is one ordering
 * constraint, written down here, rather than one more list to keep.
 *
 * Every other test is an exact anchored alternation, so the first three groups
 * can sit in reading order and steal nothing:
 *
 *   - `Master switches` is `^(enabled|writes_enabled)$`. Anchored at both ends,
 *     so it cannot reach `signin_enabled` or `cloud_projects_enabled` even
 *     though both read like master switches. Written as `_enabled$` it would
 *     take four rows that belong to two other groups, and it is first, so it
 *     would take them silently.
 *   - `Sign in` names its five keys outright. `avatar_fetch_enabled` is in it
 *     because that fetch happens at sign in and nowhere else.
 *   - `Feed and ranking` is `^feed_`, greedy in form but not in effect: nothing
 *     else on this box starts with `feed_`, and anything that does in future
 *     belongs here anyway.
 */
const GROUPS = [
  {
    title: 'Master switches',
    note: 'The two rows that decide whether this box answers the community app at all. Everything below assumes both are on',
    match: (key) => /^(enabled|writes_enabled)$/.test(key),
  },
  {
    title: 'Sign in',
    note: 'Who may open an account here and what proves they are who they say. None of these is a secret: they are public OAuth client ids, and this box holds no client secret at all',
    match: (key) =>
      /^(signin_enabled|google_client_ids|github_client_ids|github_allow_pat|avatar_fetch_enabled)$/.test(key),
  },
  {
    title: 'Feed and ranking',
    note: 'What the feed answers with and in what order. Nothing here changes a number anybody sees, only which cards come first',
    match: (key) => key.startsWith('feed_'),
  },
  // Above `Limits and rate control` on purpose. See the long note above: that
  // group matches `^max_` and would otherwise take all five of these rows.
  {
    title: 'Cloud projects',
    note: 'Saving a project to this box, and the four ceilings that decide how much of the disk one account can take',
    match: (key) => key === 'cloud_projects_enabled' || key.startsWith('max_cloud_'),
  },
  {
    title: 'Limits and rate control',
    note: 'What one account may do in a day, in an hour and in a single upload. Every one of these is felt by the person who hits it, as a refusal',
    match: (key) => key.startsWith('max_'),
  },
  {
    title: 'Presentation',
    note: 'The two rows that put words in front of people rather than changing what the box does',
    match: (key) => /^(official_handle|moderation_note)$/.test(key),
  },
];

/**
 * Where an unrecognised row goes.
 *
 * It has to exist. This page is the documentation for what a number does, and a
 * page that silently drops a row it does not have a heading for is a page that
 * hides the one row nobody has documented yet, which is the row most likely to
 * be doing something surprising. The note says the honest thing: the hook reader
 * skips any key that is not in its own `DEFAULTS`, so a row down here is a note
 * somebody left in the table and not a setting the box reads.
 */
const OTHER_NOTE =
  'Rows this dashboard has no heading for. The hooks ignore any key that is not in their own defaults, so a row here is something somebody left in the table rather than a setting the box reads';

const SCOPES = [
  { id: 'all', label: 'All' },
  { id: 'loud', label: 'Loud only' },
  { id: 'edited', label: 'Edited' },
];

// ------------------------------------------------------------- the view ---

export async function render(root) {
  /*
   * The delegated listeners below go on `root`, and `root` is `#view`, which is
   * the SAME element for every view in this dashboard. The router replaces its
   * innerHTML on the way to the next page but it does not replace the element,
   * so a listener left on it fires for clicks in a completely different view and
   * one more of them accumulates on every visit to Settings. The `closest`
   * guards make that harmless in practice, which is exactly why it would never
   * be noticed. Hence the cleanup at the bottom, and hence this flag: a fetch
   * that resolves after the operator has already navigated away must not write
   * into markup that is no longer on the page.
   */
  let alive = true;

  /**
   * Is this view still the one on screen, with a session still behind it.
   *
   * The flag beside this one is set false by the cleanup the router calls, and
   * that flag cannot cover a FIRST load: `render()` has not returned the cleanup
   * yet, so when the session ends there is nothing for the shell to call.
   * Everything after an await was then running inside a view that had already
   * been thrown away, which is how `feed.js`, `accounts.js` and `comments.js`
   * all managed to write into markup that no longer existed, and how this file
   * managed to push a rail badge onto the sign-in gate.
   *
   * `mark` is the first element this view put into `#view`, so it stops being
   * connected the moment the shell empties or refills `#view`. It cannot be
   * `root.isConnected`, because `root` IS `#view` and `#view` survives being
   * emptied perfectly happily. `pb.auth.token` is the session itself, empty the
   * instant somebody signs out or a 401 comes back, which `pb.js` turns into the
   * same call. Both are read rather than taken as a flag from the shell, because
   * both are state the two sides already share.
   */
  let mark = null;
  const mounted = () => !!mark && mark.isConnected && !!pb.auth.token;
  const isLive = () => alive && mounted();


  const state = {
    rows: [],
    scope: 'all',
    query: '',
    // Whether the collection carries an `updated` column at all, as opposed to
    // carrying one that is empty on every seeded row. The two look identical in
    // a rendered row and they are not the same fact: one means nothing has been
    // edited yet, the other means this box cannot tell you either way.
    hasUpdated: false,
    loaded: false,
  };

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Settings</h2>
        <div class="sub">What every tunable on this box is set to, what each one does, and what changes for users if you move it</div>
      </div>
      <div class="page-tools">
        <span class="muted tiny" data-set-count role="status"></span>
        <button class="btn btn-sm" type="button" data-set-reload>Reload</button>
      </div>
    </div>

    <div class="card">
      <div class="card-body">
        <p class="tiny dim">
          Every hook carries its own default for every key, so a row that is deleted, blank or unreadable behaves like the
          seeded one rather than switching a feature off. A number that will not parse falls back to that default and logs a
          warning, and a switch reads anything that is not the exact word <span class="mono">false</span> as on.
        </p>
        <p class="tiny dim">
          That is a safety net, not a licence. It converts the loud failure into a quiet one: instead of the feed going dark,
          this page says one thing while the box does another, and nothing reports it. So each row prints what the hooks will
          actually make of the value it is holding, and the confirm prints it again before the write lands. A saved value is
          picked up within about thirty seconds, because each hook caches the whole collection for that long.
        </p>
        <p class="tiny dim">
          This collection records no created date, and on an older box no updated date either, so nothing here is ever sorted
          by time. Rows are listed by key, and a row with nothing in its updated field is shown as never edited rather than as
          a blank cell. Every save from this page is recorded in <span class="mono">mod_log</span> with the old value and the new one.
        </p>
      </div>
    </div>

    <div class="filter-row">
      <div class="segmented" role="group" aria-label="Which settings to show" data-set-scopes>
        ${SCOPES.map(
          (scope) =>
            `<button type="button" data-scope="${esc(scope.id)}" aria-pressed="${scope.id === state.scope}">${esc(scope.label)}</button>`
        ).join('')}
      </div>
      <input type="search" data-set-query placeholder="Filter by key or wording" aria-label="Filter settings by key or wording" spellcheck="false" />
      <span class="muted tiny">Sorted by key, because this collection has no date to sort by</span>
    </div>

    <div data-set-body>${skeleton('rows', 8)}</div>`;


  /*
   * Captured AFTER the markup above is written, never before.
   *
   * `root` IS `#view`, and until the assignment above runs it is still holding
   * the router's loading skeleton. A reference taken any earlier would point at
   * a skeleton element that this very line detaches, so `mounted()` would answer
   * false for the whole life of the view and every fetch would quietly refuse to
   * paint. Found exactly that way: the charts stayed as placeholder cards
   * forever, with no error anywhere. See `mounted`.
   */
  mark = root.firstElementChild;
  const body = root.querySelector('[data-set-body]');
  const countEl = root.querySelector('[data-set-count]');

  // ---------------------------------------------------------- loading ---

  /**
   * `perPage: 200` because there are 26 rows and there will never be enough of
   * these to page. `sort: 'key'` is not a preference: `sort=-created` on this
   * collection is a 400 from the record API, since the column does not exist.
   */
  async function load(isRefetch) {
    if (isRefetch) body.classList.add('is-stale');
    else body.innerHTML = skeleton('rows', 8);

    try {
      const page = await pb.list('settings', { perPage: 200, sort: 'key' });
      if (!isLive()) return;
      state.rows = page.items || [];
      state.hasUpdated = state.rows.some((row) =>
        Object.prototype.hasOwnProperty.call(row, 'updated')
      );
      state.loaded = true;
      draw();
    } catch (err) {
      if (!isLive()) return;
      body.innerHTML = errorState('Could not load the settings', err);
      countEl.textContent = '';
    } finally {
      body.classList.remove('is-stale');
    }
  }

  // ---------------------------------------------------------- drawing ---

  function visibleRows() {
    const needle = state.query.trim().toLowerCase();
    return state.rows.filter((row) => {
      if (state.scope === 'loud' && !LOUD[row.key]) return false;
      if (state.scope === 'edited' && !editedAt(row)) return false;
      if (!needle) return true;
      const hay = `${row.key} ${row.description || ''} ${row.value || ''}`.toLowerCase();
      return hay.indexOf(needle) !== -1;
    });
  }

  function draw() {
    const loud = state.rows.filter((row) => LOUD[row.key]).length;
    const rows = visibleRows();

    /*
     * The one line on this page that says how big the answer is, and it is a
     * live region.
     *
     * TWO THINGS WERE WRONG HERE. It counted `state.rows`, the whole
     * collection, so typing in the filter box took twenty six rows down to one
     * while this line went on saying twenty six. And nothing announced the
     * change at all: a sighted operator watches the cards disappear, and
     * everybody else got no signal that the page had just answered a different
     * question. `tags.js` had already solved this with a `role="status"` span,
     * so this is the same pattern rather than a second one.
     *
     * The unfiltered wording is left exactly as it was, because when nothing is
     * filtered "3 of 26" would be noise: the interesting second number then is
     * how many of the keys are loud.
     */
    const filtered = rows.length !== state.rows.length;
    countEl.textContent = !state.rows.length
      ? ''
      : filtered
        ? `${n(rows.length)} of ${n(state.rows.length)} keys shown`
        : `${n(state.rows.length)} keys, ${n(loud)} of them loud`;

    // The Edited segment is meaningless on a box whose collection has no
    // `updated` column: it would answer "nothing" forever and read as a bug in
    // the filter rather than as a missing column. Hiding the control is the
    // honest version of "this box cannot answer that".
    const editedButton = root.querySelector('[data-scope="edited"]');
    if (editedButton) editedButton.hidden = state.loaded && !state.hasUpdated;

    if (!state.rows.length) {
      body.innerHTML = emptyState(
        'This box has no settings rows',
        'Every hook is running on its own built in defaults. Seeding the collection through the migration is what puts the rows here'
      );
      return;
    }

    if (!rows.length) {
      body.innerHTML = emptyState(...noMatchCopy());
      return;
    }

    /*
     * First group whose `match` claims the key wins, and a claimed key leaves
     * the pool. `taken` is what enforces that, and it is why the order of
     * `GROUPS` is a decision rather than a layout: see the note on that list.
     */
    const taken = new Set();
    const groups = [];
    for (const group of GROUPS) {
      const items = rows.filter((row) => !taken.has(row.key) && group.match(row.key));
      for (const item of items) taken.add(item.key);
      if (items.length) groups.push({ title: group.title, note: group.note, items });
    }
    const rest = rows.filter((row) => !taken.has(row.key));
    if (rest.length) groups.push({ title: 'Everything else', note: OTHER_NOTE, items: rest });

    body.innerHTML = groups.map(groupCard).join('');
  }

  /** What an empty result means depends on which filter emptied it. */
  function noMatchCopy() {
    if (state.query.trim()) {
      return [
        'No key matches that',
        'The filter reads the key, the seeded description and the stored value. Clearing the box brings every row back',
      ];
    }
    if (state.scope === 'loud') {
      return [
        'No loud rows here',
        'Loud rows are the ones that change what users get. Switch back to All to see the rest',
      ];
    }
    return [
      'Nothing has been edited here',
      'Every row still holds the value the migration seeded. Saving any row on this page puts it in this list',
    ];
  }

  function groupCard(group) {
    return `<div class="section-title">${esc(group.title)}</div>
      <div class="card">
        <div class="card-head">
          <div class="sub">${esc(group.note)}</div>
          <span class="spacer"></span>
          <span class="muted tiny">${n(group.items.length)} ${group.items.length === 1 ? 'key' : 'keys'}</span>
        </div>
        ${group.items.map(settingRow).join('')}
      </div>`;
  }

  // ------------------------------------------------------------ saving ---

  /**
   * One save, with the confirm in front of it.
   *
   * Reads the field live rather than trusting anything cached, because the
   * operator may have kept typing between opening the confirm and answering it,
   * and the value shown in the diff has to be the value that gets written.
   */
  async function attemptSave(key) {
    const row = state.rows.find((item) => item.key === key);
    const field = body.querySelector(`[data-set-input="${CSS.escape(key)}"]`);
    const button = body.querySelector(`[data-set-save="${CSS.escape(key)}"]`);
    if (!row || !field || !button) return;

    const next = field.value;
    if (next === row.value) {
      toast('Nothing changed');
      return;
    }

    // The column is text 2048. Catching it here rather than letting the record
    // API answer 400 means the operator is told the limit and keeps what they
    // typed, instead of getting a validation message about a column name.
    if (next.length > 2048) {
      toast(`That is ${n(next.length)} characters and the column holds 2048`, 'bad');
      return;
    }

    const loud = LOUD[key];
    const before = interpret(key, row.value);
    const after = interpret(key, next);

    /*
     * `from` and `to` are the LITERAL stored strings, never a prettified form of
     * them. The diff is the operator's last chance to see the exact text that is
     * about to be written, and a cell reading "1.0 GB" where the row holds
     * `1073741824` hides a trailing space, a smart quote pasted out of a chat
     * window, or the word `unset` where a value was meant. The readable
     * interpretation goes in the body underneath, where it cannot be mistaken
     * for the thing being stored.
     */
    const ok = await confirmAction({
      title: `Change ${key}?`,
      danger: !!loud,
      confirmLabel: 'Save it',
      from: row.value || '(empty)',
      to: next || '(empty)',
      body:
        (loud ? `<p><strong>${esc(loud)}</strong></p>` : '') +
        (row.description ? `<p class="muted">${esc(row.description)}</p>` : '') +
        `<p class="tiny dim">Now: ${esc(before || 'no change in how this is read')}</p>` +
        `<p class="tiny dim">After: ${esc(after || 'read as the number it says')}</p>` +
        '<p class="tiny dim">Every hook picks this up within about thirty seconds, and the change is recorded in the moderation log</p>',
    });
    if (!ok) return;

    button.disabled = true;
    try {
      const saved = await pb.update('settings', row.id, { value: next });
      if (!isLive()) return;
      const from = row.value;
      row.value = saved.value;
      // Only overwrite what we know. A box with no `updated` column answers
      // without one, and copying `undefined` over the old value would turn a
      // known-missing column into a row that claims it was never edited two
      // seconds after it was.
      if (Object.prototype.hasOwnProperty.call(saved, 'updated')) row.updated = saved.updated;

      refreshRow(row, !editedAt(row));
      toast(`${key} saved`, 'good');
      await recordEdit(key, from, row.value);
    } catch (err) {
      if (!isLive()) return;
      toast(err.message || 'Could not save that', 'bad');
      // Put the field back to what is actually stored. Leaving the rejected text
      // in the box next to a row that still holds the old value is how the same
      // failed edit gets retried three times.
      field.value = row.value;
    } finally {
      button.disabled = false;
    }
  }

  /**
   * The audit line, written after the value has landed.
   *
   * Deliberately not part of the save. `mod_log` is superuser-writable through
   * the record API and needs no route, but it is still a second request that can
   * fail on its own, and an audit line that could roll back the change it
   * describes would be a worse trade than a missing line. So the change is
   * already committed and toasted by the time this runs, and a failure here gets
   * its own message saying exactly that: the value moved, the record of it did
   * not. Nobody should be left thinking the save failed.
   *
   * `actor` is filled in here because this is the record API and not the hook
   * route, so nothing on the server side fills it for us.
   */
  async function recordEdit(key, from, to) {
    try {
      await pb.create('mod_log', {
        actor: clip(pb.auth.email, 128),
        target: 'settings',
        target_id: clip(key, 40),
        action: 'set',
        label: clip(key, 160),
        note: clip(`changed from "${clip(from, 180) || '(empty)'}" to "${clip(to, 180) || '(empty)'}"`, 512),
        ref: newRef(),
      });
    } catch (err) {
      console.warn('settings: the value saved but the log line did not', err);
      toast('Saved, but this edit was not written to the moderation log', 'bad');
    }
  }

  /**
   * Repaint the three parts of a row that a save can change.
   *
   * In place rather than a full redraw, because a redraw at this moment throws
   * away the operator's filter position and their scroll, and moves the row they
   * are looking at. `justSaved` covers the box with no `updated` column: we know
   * perfectly well it was saved a second ago even when the collection cannot
   * record it, and saying so beats printing "never edited" under a row that was
   * edited while they watched.
   */
  function refreshRow(row, justSaved) {
    const field = body.querySelector(`[data-set-input="${CSS.escape(row.key)}"]`);
    const note = body.querySelector(`[data-set-note="${CSS.escape(row.key)}"]`);
    const when = body.querySelector(`[data-set-edited="${CSS.escape(row.key)}"]`);
    const size = body.querySelector(`[data-set-size="${CSS.escape(row.key)}"]`);
    if (field) field.value = row.value;
    if (note) note.textContent = rowNote(row.key, row.value);
    if (when) when.textContent = justSaved ? 'saved a moment ago' : editedLine(row);
    if (size) {
      const hint = sizeHint(row.key, row.value);
      size.textContent = hint;
      size.hidden = !hint;
    }
  }

  // ----------------------------------------------------------- wiring ---

  const onClick = (ev) => {
    const scope = ev.target.closest('[data-scope]');
    if (scope && root.contains(scope)) {
      state.scope = scope.dataset.scope;
      root
        .querySelectorAll('[data-set-scopes] button')
        .forEach((button) => button.setAttribute('aria-pressed', String(button === scope)));
      draw();
      return;
    }

    const reload = ev.target.closest('[data-set-reload]');
    if (reload && root.contains(reload)) {
      load(true);
      return;
    }

    const save = ev.target.closest('[data-set-save]');
    if (save && root.contains(save)) attemptSave(save.dataset.setSave);
  };

  const onInput = (ev) => {
    const field = ev.target.closest('[data-set-query]');
    if (!field || !root.contains(field)) return;
    state.query = field.value;
    // No debounce on purpose. This filters an array of 26 objects already in
    // memory, so the work is a rounding error and a delay would only make the
    // box feel like it is not listening.
    draw();
  };

  /**
   * Enter saves, except in the textarea.
   *
   * Somebody correcting a number types the number and presses Enter. Making
   * them reach for a Save button they can already see is a small rudeness that
   * happens twenty times in a session. `MULTILINE` rows are skipped because
   * Enter there is how you type a second line.
   */
  const onKeydown = (ev) => {
    if (ev.key !== 'Enter' || ev.shiftKey) return;
    const field = ev.target.closest('[data-set-input]');
    if (!field || !root.contains(field)) return;
    if (field.tagName === 'TEXTAREA') return;
    ev.preventDefault();
    attemptSave(field.dataset.setInput);
  };

  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('keydown', onKeydown);

  await load(false);

  return () => {
    alive = false;
    root.removeEventListener('click', onClick);
    root.removeEventListener('input', onInput);
    root.removeEventListener('keydown', onKeydown);
  };
}

// --------------------------------------------------------------- markup ---

function settingRow(row) {
  const key = row.key || '';
  const loud = LOUD[key];
  const size = sizeHint(key, row.value);

  /*
   * The size hint is always in the markup for a bytes row, even when it has
   * nothing to say, and `hidden` is what keeps it out of the way.
   *
   * It used to be rendered only when there was a size to print, which meant a
   * row holding `twelve` had no `[data-set-size]` element at all: correcting the
   * value put the number in the field and left the row with no readable size
   * until somebody reloaded the whole page, because `refreshRow` had nothing to
   * write into. An always-present span costs one empty element per bytes row and
   * removes a whole class of "it did not update" report.
   */
  const sizeSlot = READS[key] === 'bytes'
    ? `<span class="muted tiny" data-set-size="${esc(key)}" ${size ? '' : 'hidden'}>${esc(size)}</span>`
    : '';

  return `<div class="setting">
    <div>
      <div class="setting-key">${esc(key)}${loud ? ' <span class="chip chip-warn">Loud</span>' : ''}</div>
      ${row.description ? `<div class="setting-desc">${esc(row.description)}</div>` : ''}
      ${loud ? `<div class="setting-desc"><strong>What changes for users</strong> ${esc(loud)}</div>` : ''}
    </div>
    <div>
      <div class="setting-val">
        ${valueControl(row)}
        ${sizeSlot}
      </div>
      <div class="setting-desc" data-set-note="${esc(key)}">${esc(rowNote(key, row.value))}</div>
      <div class="setting-desc" data-set-edited="${esc(key)}">${esc(editedLine(row))}</div>
    </div>
  </div>`;
}

/**
 * The field, or the mask.
 *
 * The masked branch is dead on this box today and is written anyway, because
 * the alternative is writing it in a hurry on the day the first real secret row
 * appears. It shows the length and nothing else: that is enough to answer "is it
 * set, and does it look like the right sort of thing" without a screenshot of
 * this page becoming the leak.
 */
function valueControl(row) {
  const key = row.key || '';
  const value = row.value == null ? '' : String(row.value);

  if (isCredential(key)) {
    return `<span class="chip">Set on the box</span>
      <span class="muted tiny">${value ? `${n(value.length)} characters, hidden here` : 'empty'}</span>`;
  }

  const field = MULTILINE.has(key)
    ? `<textarea data-set-input="${esc(key)}" rows="3" spellcheck="false"
         aria-label="Value for ${esc(key)}">${esc(value)}</textarea>`
    : `<input type="text" class="mono" value="${esc(value)}" data-set-input="${esc(key)}"
         spellcheck="false" autocapitalize="off" autocorrect="off" autocomplete="off"
         aria-label="Value for ${esc(key)}" />`;

  return `${field}
    <button class="btn btn-sm" type="button" data-set-save="${esc(key)}" aria-label="Save ${esc(key)}">Save</button>`;
}

// -------------------------------------------------------------- helpers ---

/**
 * What the hooks will make of this exact string.
 *
 * The single most useful sentence on the page, because the gap between what a
 * row says and what the box does is the failure the defaults create. It is
 * written in the present tense about the value that is stored right now, and it
 * is shown twice: in the row, and again in the confirm for both the old and the
 * new value, where it is the difference between "10 to ten" looking like a typo
 * and looking like a change.
 */
function interpret(key, value) {
  const kind = READS[key];
  const raw = value == null ? '' : String(value).trim();

  if (kind === 'strict-switch') {
    return raw === 'true'
      ? 'Read as on'
      : 'Read as off, because this is the one row where only the exact word true turns it on';
  }
  if (kind === 'switch') {
    return raw === 'false' || raw === '0'
      ? 'Read as off'
      : 'Read as on, because anything that is not the word false is on';
  }
  if (kind === 'number' || kind === 'bytes') {
    const parsed = Number(raw);
    if (!raw || !isFinite(parsed) || parsed < 0) {
      return 'This will not parse as a number, so the hooks use their own built in default and log a warning. The row says one thing and the box does another';
    }
    return kind === 'bytes' ? `Read as ${bytes(parsed)}` : '';
  }
  if (kind === 'text') {
    return raw === '' || raw === 'unset'
      ? 'The word unset means empty here, so nothing is configured'
      : '';
  }
  return 'Nothing in the hooks reads this key, so whatever it says has no effect';
}

/**
 * Does this raw string read as a byte count.
 *
 * One reading, shared by the hint beside the field and the note under it, so
 * the two can never disagree about the same value. They used to: an EMPTY bytes
 * row printed `0 B` beside the field, because `Number('')` is 0 and 0 is a
 * finite non-negative number, while the note under it correctly said the value
 * would not parse and the hooks would fall back to their own default. One row,
 * two opposite claims.
 */
function readsAsBytes(value) {
  const raw = value == null ? '' : String(value).trim();
  if (!raw) return false;
  const parsed = Number(raw);
  return isFinite(parsed) && parsed >= 0;
}

/** `1.0 GB` beside the raw byte count, because nobody reads 1073741824 at a glance. */
function sizeHint(key, value) {
  if (READS[key] !== 'bytes' || !readsAsBytes(value)) return '';
  return bytes(Number(String(value).trim()));
}

/**
 * What the note under a row's field should say, which is not always what
 * `interpret` returns.
 *
 * THE DUPLICATE THIS REMOVES. On all twenty six rows the value column printed
 * the same fact twice for the bytes keys: `1.0 GB` in the `.setting-val` hint,
 * and `Read as 1.0 GB` on the line directly underneath it. Two lines, one fact,
 * a millimetre apart. The hint wins because it sits beside the field it
 * describes, where the eye already is when it reads the raw number.
 *
 * The "will not parse" branch is kept, and it is the branch that earns the line:
 * it is the only place on this page that says the box is about to ignore what
 * the row holds. `interpret` itself is untouched, because the confirm dialog
 * prints it for both the old and the new value and there is no size hint in a
 * confirm for it to duplicate.
 */
function rowNote(key, value) {
  if (READS[key] === 'bytes' && readsAsBytes(value)) return '';
  return interpret(key, value);
}

/**
 * The `updated` value, or an empty string, without ever assuming the column is
 * there. An older box answers with no such field at all and a seeded row answers
 * with an empty one, and both mean the same thing to a reader.
 */
function editedAt(row) {
  const raw = row && row.updated != null ? String(row.updated).trim() : '';
  return raw;
}

function editedLine(row) {
  const raw = editedAt(row);
  if (!raw) return 'Not edited since this box was set up';
  const when = stamp(raw);
  // `stamp` answers 'unknown' for anything it cannot parse. A date that exists
  // but will not read is still evidence the row was touched, so say that rather
  // than claiming it never was.
  return when === 'unknown' ? 'Edited, but this box did not record when' : `Edited ${when}`;
}

/** Trim to a column width, keeping the front, which is the half that identifies it. */
function clip(value, max) {
  const text = value == null ? '' : String(value);
  return text.length > max ? `${text.slice(0, Math.max(0, max - 3))}...` : text;
}

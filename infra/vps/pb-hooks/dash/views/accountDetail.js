/**
 * One account: who they are, what this box has counted about them, what they
 * published, and the four things an operator can do about it.
 *
 * ## Why this is one request and not eight
 *
 * Everything on this page comes from `GET /api/openscreengen/dash/account`. The
 * obvious alternative is a record API call per panel: one for the row, one for
 * the posts, one for the comments, one for the projects, and four `count` calls
 * for the join tables. That is eight round trips for one drawer, and worse, it
 * is eight round trips whose answers are taken at eight different moments, so a
 * like arriving between the third and the fourth means the numbers on screen
 * never actually described any single state of the database. The route counts
 * everything in one pass and the drawer renders one consistent snapshot.
 *
 * ## The counters, and why this drawer is the place drift shows up
 *
 * `users.post_count` and `users.followers` are denormalized caches of `posts`
 * and `follows`. Nothing on the box recomputes them: the app increments them
 * when it writes, and a cascade delete removes the join rows underneath them
 * without touching the columns. So an account that followed somebody who was
 * later deleted still counts that follow, and an author whose post was removed
 * out from under the counter still counts that post.
 *
 * The route therefore returns BOTH numbers, stored and actual, and this drawer
 * puts them side by side the moment they disagree, with the repair button in
 * the same card. That pairing is the whole point: a number that is wrong and a
 * button that fixes it, in one place, so nobody has to carry a finding from the
 * Integrity page over to a different screen and remember which scope it was.
 *
 * ## What writes here
 *
 * Four actions, all through `POST /api/openscreengen/dash/moderate` rather than
 * through `pb.update` on the record: the route runs them in a transaction, it
 * writes the `mod_log` row, and for a delete it counts what went with the
 * account BEFORE deleting it, which is a number nothing can recover afterwards.
 * Ban and the badge are reversible from this same drawer. Delete is not
 * reversible by anything, which is why its confirm spells out every table the
 * cascade reaches and says so in as many words.
 *
 * Plus Recount, which is a repair rather than a moderation action and goes to
 * `POST /api/openscreengen/dash/recount`.
 */

import * as pb from '../pb.js';
import {
  $,
  $$,
  ago,
  avatar,
  bytes,
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

/**
 * How many drifting rows one Recount press repairs.
 *
 * The route caps a single call at 2000 rows across every scope and defaults to
 * 500 per scope, and it answers with `remaining` so the page can say plainly
 * whether another pass is needed. 500 is passed explicitly rather than left to
 * the default so that the sentence next to the button ("up to 500 rows") is a
 * promise this file is making rather than one it is guessing at.
 */
const RECOUNT_LIMIT = 500;

/**
 * Which recount scope repairs which counter.
 *
 * Two entries, because two of the five denormalized counters live on `users`
 * and the other three live on `posts` and `comments`, which are the Feed and
 * Comments pages' business. The scope strings are the route's own vocabulary
 * and a typo in one is a 400 that says "that is not something this can
 * recount", so they are written down once here rather than inline at the call.
 */
const DRIFT_SPECS = [
  {
    scope: 'post_count',
    label: 'Posts published',
    button: 'Recount post counts',
    stored: 'post_count_stored',
    actual: 'post_count_actual',
    source: 'counted from the posts table',
  },
  {
    scope: 'followers',
    label: 'Followers',
    button: 'Recount follower counts',
    stored: 'followers_stored',
    actual: 'followers_actual',
    source: 'counted from the follows table',
  },
];

/**
 * Bumped by every `openAccount` call, and compared after every await inside
 * one.
 *
 * The router imports this module lazily and awaits `openAccount`, so an
 * operator who clicks two accounts in quick succession has two of these in
 * flight over the SAME drawer element. Without a token the slower fetch paints
 * last and the drawer ends up showing account A under a hash that says account
 * B, with A's Delete button under B's name. That is the one failure mode on
 * this page that could destroy the wrong record, so it is guarded rather than
 * hoped about.
 */
let session = 0;

/**
 * Releases the `dash:drawer-close` listener the open drawer registered, if any.
 *
 * Module scope rather than a closure variable, because the thing that has to be
 * released is a listener belonging to a PREVIOUS call to `openAccount`, and the
 * new call cannot reach the old call's locals.
 */
let releaseClose = null;

/**
 * Put the hash back when the drawer is dismissed by something that is not the
 * Close button.
 *
 * ## The bug this fixes
 *
 * This file used to wire `dismiss` to `[data-close]` clicks and to nothing
 * else, so Escape and a click on the scrim both went straight through
 * `ui.closeDrawer` and left the address bar sitting on `#/account/<id>` with
 * the drawer hidden. Three separate things went wrong from that one gap:
 *
 *   1. `accounts.js` reloads its table when the hash leaves `#/account/...`,
 *      keyed on `hashchange`. No hash change meant no reload, so a ban or a
 *      badge applied in this drawer was not reflected in the row behind it.
 *   2. The row the drawer was opened from keeps `.is-open` and stays tinted,
 *      because that class is also driven by the hash.
 *   3. The topbar Refresh, or a browser reload, re-ran the current route and
 *      RE-OPENED the drawer the operator had just dismissed.
 *
 * ## Why an event and not three fixes
 *
 * `ui.closeDrawer` already fires `dash:drawer-close` for exactly this, and it
 * fires for the button, the scrim and Escape alike. `postDetail.js` and
 * `projects.js` were both already listening to it; this file was the only
 * detail view that was not, so the fix is to join them rather than to invent a
 * fourth mechanism. Escape is not interceptable from in here in any case: the
 * key handler lives in `ui.js` and this module never sees the keystroke.
 *
 * ## Why the guard, and why it releases itself
 *
 * The same event fires when the ROUTER closes the drawer on its way somewhere
 * else, and by then the hash is already that other page. Without the guard,
 * clicking Feed in the rail while an account drawer was open would drag the
 * operator to `#/accounts` instead. The id is compared exactly, so a listener
 * left over from account A stands down the moment account B is the one on
 * screen. And it releases either way, so a closed drawer is not still holding
 * a listener that names a record nobody is looking at.
 */
function watchClose(id) {
  releaseCloseWatch();

  const onClose = () => {
    releaseCloseWatch();
    if (location.hash !== `#/account/${id}`) return;
    go('#/accounts');
  };

  document.addEventListener('dash:drawer-close', onClose);
  releaseClose = () => document.removeEventListener('dash:drawer-close', onClose);
}

function releaseCloseWatch() {
  const off = releaseClose;
  releaseClose = null;
  if (off) off();
}

/**
 * "1 post" and "3 posts", never "1 posts".
 *
 * Small, and worth a function rather than a ternary at each call site: this
 * page writes twelve of these, six of them inside the delete confirm, and that
 * confirm is the last thing somebody reads before destroying an account. A
 * sentence that reads like a template is a sentence people skim, and the whole
 * job of that dialog is to be read.
 */
function plural(count, one, many) {
  const value = Number(count) || 0;
  return `${n(value)} ${value === 1 ? one : many}`;
}

/** The router owns the hash, so navigation goes through the shell, never `location.hash =`. */
function go(hash) {
  if (window.__dash && typeof window.__dash.go === 'function') window.__dash.go(hash);
  else location.hash = hash;
}

/**
 * Google, GitHub, both, or neither.
 *
 * Both keys can be set at once: the accounts migration keeps `google_sub` and
 * `github_id` as separate columns precisely so one person can link both, and
 * an account that only ever shows the first one found would hide half of how
 * they can get back in. "No provider" is a real state rather than an error,
 * covering a row made by hand in the PocketBase admin and one whose provider
 * link was cleared, and it is worth seeing because such a row cannot sign in
 * through either route the app offers.
 */
function providersOf(account) {
  const list = [];
  if (account?.google_sub) list.push('Google');
  if (account?.github_id) list.push('GitHub');
  return list;
}

function providerChips(account) {
  const list = providersOf(account);
  if (!list.length) return chip('no provider', 'warn');
  return list.map((name) => chip(name, 'accent')).join(' ');
}

/*
 * ## The chip vocabulary, and what this file had wrong
 *
 * A chip's colour is a claim about severity, and the same state has to make the
 * same claim on every page or the colour stops carrying information and becomes
 * decoration. Across the dashboard the settled vocabulary is:
 *
 *   hidden          warn     a reversible moderation state, not a fault
 *   featured        accent   a deliberate editorial choice
 *   banned          bad      the account is refused everywhere
 *   badge           good     a claim this box makes about somebody
 *   shared by link  accent   a real capability, spelled out in full every time
 *   private         no kind   the default, and a default is not news
 *   no provider     warn     the row cannot sign in by either route the app has
 *   clear / agree   good
 *
 * This file disagreed with all of that in three places and it mattered:
 *
 *   - `hidden` was rendered `bad` in the posts, comments and projects tables,
 *     so a routine hide sat in the same red as a ban two rows above it.
 *   - `private` was rendered `good`, which made the ordinary state of nearly
 *     every project look like a passed check and left `shared by link`, the
 *     state that actually needs attention, reading as the failure of one.
 *   - `shared by link` was rendered `warn`, which is the colour this page uses
 *     for drift. Sharing is a capability the owner chose, not a fault.
 */

/**
 * The head of the drawer, in every state it can be in.
 *
 * Separated out because the loading state, the error state and the loaded
 * state all need a Close button in the same place. A drawer whose header
 * appears only once the fetch has landed is a drawer an operator cannot get out
 * of while a slow box is thinking, and Escape is not a discoverable answer to
 * that.
 */
function headShell(inner) {
  return `<div class="drawer-head">${inner}
      <span class="spacer"></span>
      <button class="icon-btn" data-close type="button" aria-label="Close">✕</button>
    </div>`;
}

/**
 * The counts grid.
 *
 * The route hands back seventeen numbers. Seventeen tiles is a wall of digits
 * that takes a drawer-and-a-half of scrolling and answers no question in
 * particular, so they are folded into six tiles: the headline number is the one
 * an operator would say out loud, and the rest ride in the tile's meta row
 * where they read as context for it. Every one of the seventeen is on screen,
 * none of them is a chart, and the grouping is the same one the account page in
 * the app itself uses, so the numbers sit next to the numbers they belong with.
 *
 * Followers is `followers_actual`, the count from the join table, NOT the
 * stored column. Where the two disagree the drift card above says so and names
 * both; showing the cached number here and the real one there would put the
 * dashboard's own two answers on the same screen with nothing saying which is
 * which.
 */
function countsGrid(counts) {
  const c = counts || {};

  const tile = (label, value, meta, title) =>
    `<div class="kpi"${title ? ` title="${esc(title)}"` : ''}>
      <div class="kpi-label">${esc(label)}</div>
      <div class="kpi-value">${esc(value)}</div>
      <div class="kpi-meta">${meta.map((part) => `<span>${esc(part)}</span>`).join('')}</div>
    </div>`;

  return `<div class="grid grid-kpi">
      ${tile('Posts', n(c.posts), [`${n(c.hidden_posts)} hidden`, `${n(c.featured_posts)} featured`])}
      ${tile('Comments written', n(c.comments), [`${n(c.hidden_comments)} hidden`])}
      ${tile(
        'Followers',
        n(c.followers_actual),
        [`following ${n(c.following)}`],
        'Counted from the follows table, not read from the stored column'
      )}
      ${tile('Likes received', n(c.received_likes), [
        `${n(c.received_comments)} comments`,
        `${n(c.views)} views`,
      ])}
      ${tile('Likes given', n(c.likes_given), [
        `${n(c.saves)} saves`,
        `${n(c.comment_likes_given)} comment likes`,
      ])}
      ${tile('Cloud projects', n(c.projects), [
        `${n(c.shared_projects)} shared`,
        `${n(c.assets)} assets`,
        bytes(c.project_bytes),
      ])}
    </div>`;
}

/**
 * The drift card, which is a finding in the Integrity page's own clothes.
 *
 * `.finding` rather than a plain card on purpose. This is the same object that
 * page renders, found by the same SQL, repaired by the same route, and giving
 * it a different shape here would make it read as a different kind of fact.
 * `is-active` puts the amber on the edge as well as in the chip, because a
 * drawer is scrolled and the operator may arrive at this card from either
 * direction.
 *
 * When nothing has drifted the card does not disappear, it collapses to the
 * `finding-clear` line. A check that vanishes when it passes cannot be told
 * apart from a check that was never run, and on a page whose whole subject is
 * "the cached numbers may be lying to you", silence is the one answer that must
 * never be ambiguous.
 */
function driftCard(drift) {
  const d = drift || {};
  const off = DRIFT_SPECS.filter((spec) => Number(d[spec.stored]) !== Number(d[spec.actual]));

  if (!off.length) {
    return `<div class="finding">
        <div class="finding-head">
          <h3>Stored counters</h3>
          <div class="sub">post_count and followers on this row, checked against the posts and follows tables</div>
        </div>
        <div class="finding-clear">${chip('agree', 'good')} Both cached counters match the join tables</div>
      </div>`;
  }

  const rows = off
    .map((spec) => {
      const stored = Number(d[spec.stored]) || 0;
      const actual = Number(d[spec.actual]) || 0;
      const gap = stored - actual;
      return `<div class="setting">
          <div>
            <div class="setting-key">${esc(spec.scope)}</div>
            <div class="setting-desc">${esc(spec.label)}, ${esc(spec.source)}</div>
          </div>
          <div class="setting-val">
            ${chip(`stored ${n(stored)}`, 'warn')}
            ${chip(`actual ${n(actual)}`, 'good')}
            <span class="muted tiny">${esc(
              gap > 0 ? `reads ${n(gap)} too high` : `reads ${n(-gap)} too low`
            )}</span>
            <span class="spacer"></span>
            <button class="btn btn-sm" type="button" data-recount="${esc(spec.scope)}">${esc(
              spec.button
            )}</button>
          </div>
        </div>`;
    })
    .join('');

  return `<div class="finding is-active">
      <div class="finding-head">
        ${chip(off.length === 1 ? '1 counter is wrong' : `${n(off.length)} counters are wrong`, 'warn')}
        <h3>Stored counters disagree with the join tables</h3>
        <div class="sub">Nothing recomputes these columns. A cascade delete takes the join rows and leaves the
          cached number behind, so this is what that looks like afterwards</div>
      </div>
      <div class="finding-body">
        ${rows}
        <div class="card-body">
          <p class="note muted">Recount rebuilds the column from the join
            table for up to ${n(RECOUNT_LIMIT)} drifting rows across the whole table, not only this account, and
            it writes only the rows that are actually wrong. If more than that have drifted it says so and you
            run it again. The stored number is what the app shows on a profile, so until this is run the person
            and everybody reading their page sees the wrong one</p>
        </div>
      </div>
    </div>`;
}

/** Who this is, in the fields somebody would quote in a support thread. */
function identityCard(account) {
  const a = account || {};
  const providers = providersOf(a);

  return `<div class="card">
      <div class="card-head"><h3>Identity</h3><span class="spacer"></span>
        <span class="muted tiny">the row as it is stored</span></div>
      <div class="card-body">
        <dl class="kv">
          <dt>Account id</dt><dd class="mono">${esc(a.id)}</dd>
          <dt>Display name</dt><dd>${esc(a.display_name || a.name || 'none set')}</dd>
          <dt>Handle</dt><dd>${
            a.handle
              ? `<span class="mono">${esc(handleOf(a))}</span>`
              : '<span class="muted">never claimed one</span>'
          }</dd>
          <dt>Email</dt><dd>${esc(a.email || 'none on the row')}</dd>
          <dt>Bio</dt><dd>${a.bio ? esc(a.bio) : '<span class="muted">empty</span>'}</dd>
          <dt>Signed in with</dt><dd><span class="chip-row">${providerChips(a)}</span></dd>
          ${
            a.google_sub
              ? `<dt>Google subject</dt><dd class="mono">${esc(a.google_sub)}</dd>`
              : ''
          }
          ${a.github_id ? `<dt>GitHub id</dt><dd class="mono">${esc(a.github_id)}</dd>` : ''}
          <dt>Badge</dt><dd>${
            a.verified_badge ? chip('verified badge', 'good') : '<span class="muted">no badge</span>'
          }</dd>
          <dt>Status</dt><dd>${a.banned ? chip('banned', 'bad') : chip('active', 'good')}</dd>
          <dt>Stored counters</dt><dd class="num">post_count ${n(a.post_count)}, followers ${n(
            a.followers
          )}</dd>
          <dt>Joined</dt><dd>${esc(stamp(a.created))} <span class="muted">(${esc(ago(a.created))})</span></dd>
          <dt>Row last written</dt><dd>${esc(stamp(a.updated))} <span class="muted">(${esc(
            ago(a.updated)
          )})</span></dd>
        </dl>
      </div>
    </div>`;
}

/**
 * A section header's count line.
 *
 * The route caps each of the three lists at 24 rows in its own SQL while
 * `counts` holds the real total, and those two numbers disagreeing is the
 * normal case for a busy account. The cap is read off the array rather than
 * hard coded here, so a change to the route's LIMIT cannot leave this file
 * telling a confident lie about it. Saying "newest 24 of 61" rather than just
 * "24" is the difference between a list an operator trusts as complete and one
 * they quietly assume is.
 */
function shownOf(list, total) {
  const shown = (list || []).length;
  const all = Number(total) || 0;
  if (!shown) return 'nothing yet';
  if (all > shown) return `newest ${n(shown)} of ${n(all)}`;
  return `${n(shown)} in total`;
}

/**
 * A section: one card, one table, one honest empty state.
 *
 * `rows` is already built markup rather than data, because each of the three
 * sections has different columns and folding them into one row renderer would
 * mean a column spec object that is harder to read than the three tables it
 * replaced.
 */
function section({ title, note, count, rows, head, empty }) {
  return `<div class="card">
      <div class="card-head"><h3>${esc(title)}</h3><span class="spacer"></span>
        <span class="muted tiny">${esc(count)}</span></div>
      <div class="card-body" style="--card-body-top:8px">
        ${
          rows
            ? `<div class="table-wrap"><table class="data">
                <thead><tr>${head}</tr></thead>
                <tbody>${rows}</tbody></table></div>
               ${note ? `<p class="note muted">${esc(note)}</p>` : ''}`
            : empty
        }
      </div>
    </div>`;
}

/**
 * The posts this account published.
 *
 * No thumbnails, which is a deliberate difference from the Feed page. Twenty
 * four posts is up to a hundred and twenty screenshots, and a drawer that opens
 * on a moderation queue must not spend a hundred image requests before the
 * operator can read a title. The image COUNT is on the row instead, and the
 * post drawer one click away has the pictures.
 *
 * The title is a real anchor with a real href rather than a row with a click
 * handler, so it is tab reachable, it announces as a link, and it can be
 * middle clicked or copied. The row keeps a click target as well, because a
 * mouse wants the whole row and the delegated handler sends both to the same
 * place.
 */
function postRows(posts) {
  return (posts || [])
    .map((post) => {
      const images = Array.isArray(post.images) ? post.images.length : 0;
      const marks = [
        post.hidden ? chip('hidden', 'warn') : '',
        post.featured ? chip('featured', 'accent') : '',
      ]
        .filter(Boolean)
        .join(' ');

      return `<tr class="clickable" data-go="#/post/${esc(post.id)}">
          <td>
            <a href="#/post/${esc(post.id)}" data-go="#/post/${esc(post.id)}">${esc(
              post.title || 'Untitled'
            )}</a>
            ${marks ? ` ${marks}` : ''}
            <div class="muted tiny">${esc(
              [
                plural(post.screens, 'screen', 'screens'),
                plural(images, 'image', 'images'),
                plural(post.remixes, 'remix', 'remixes'),
              ].join(', ')
            )}</div>
          </td>
          <td><span class="surface-chip">${esc(post.surface || 'no surface')}</span></td>
          <td class="num">${n(post.likes)}</td>
          <td class="num">${n(post.comments)}</td>
          <td class="num">${n(post.views)}</td>
          <td class="nowrap muted tiny" title="${esc(stamp(post.created))}">${esc(ago(post.created))}</td>
        </tr>`;
    })
    .join('');
}

/**
 * The comments this account wrote.
 *
 * There is no comment drawer on this dashboard, so a comment row goes to the
 * post it is on: that is where the comment can actually be read in context and
 * where the per comment Hide and Delete buttons live. `post_title` comes from
 * the route so the destination is named before it is opened.
 *
 * A comment whose post is gone is rendered flat rather than as a dead link. The
 * cascade should have taken it, so a row that survives is worth seeing rather
 * than hiding, and Integrity counts these as orphans.
 */
function commentRows(comments) {
  return (comments || [])
    .map((row) => {
      const onPost = row.post
        ? `<a href="#/post/${esc(row.post)}" data-go="#/post/${esc(row.post)}">${esc(
            row.post_title || 'Untitled post'
          )}</a>`
        : '<span class="muted">its post is gone</span>';

      return `<tr${row.post ? ` class="clickable" data-go="#/post/${esc(row.post)}"` : ''}>
          <td>
            <div class="truncate" style="--truncate-cap:280px" title="${esc(row.body)}">${esc(row.body)}</div>
            ${row.hidden ? chip('hidden', 'warn') : ''}
          </td>
          <td class="truncate" style="--truncate-cap:180px">${onPost}</td>
          <td class="num">${n(row.likes)}</td>
          <td class="nowrap muted tiny" title="${esc(stamp(row.created))}">${esc(ago(row.created))}</td>
        </tr>`;
    })
    .join('');
}

/**
 * The cloud projects this account owns.
 *
 * The share slug is deliberately NOT printed here. Twenty two characters of
 * base36 IS the entire permission to read that project, and a drawer that lists
 * one per row puts every live share link for this person into anything that
 * screenshots the page. The Cloud projects drawer shows and copies it one click
 * away, where it is one credential on purpose rather than twenty by accident.
 */
function projectRows(projects) {
  return (projects || [])
    .map((project) => {
      const total = (Number(project.doc_bytes) || 0) + (Number(project.asset_bytes) || 0);
      const marks = [
        project.visibility === 'link' ? chip('shared by link', 'accent') : chip('private'),
        project.hidden ? chip('hidden', 'warn') : '',
      ]
        .filter(Boolean)
        .join(' ');

      return `<tr class="clickable" data-go="#/project/${esc(project.id)}">
          <td>
            <a href="#/project/${esc(project.id)}" data-go="#/project/${esc(project.id)}">${esc(
              project.name || 'Untitled project'
            )}</a>
            <div class="muted tiny mono">${esc(project.project_id)}</div>
          </td>
          <td class="num">${n(project.boards)}</td>
          <td class="num" title="${esc(
            `document ${bytes(project.doc_bytes)}, assets ${bytes(project.asset_bytes)}`
          )}">${esc(bytes(total))}</td>
          <td><span class="chip-row">${marks}</span></td>
          <td class="num">${n(project.format_version)}</td>
          <td class="nowrap muted tiny" title="${esc(
            `created ${stamp(project.created)}`
          )}">${esc(ago(project.updated))}</td>
        </tr>`;
    })
    .join('');
}

/** The whole loaded drawer: head, counts, drift, identity, three sections, raw row. */
function renderAccount(data) {
  const account = data.account || {};
  const counts = data.counts || {};
  const name = nameOf(account);
  const handle = handleOf(account);

  /*
   * The head carries the two labels that decide what an operator does next, and
   * the four buttons that do it. The name block is truncated on both lines
   * because `.drawer-head` is a flex row that does not wrap: without an
   * `overflow: hidden` somewhere in it, a forty character display name pushes
   * the Delete button off the right hand edge of a 720px drawer, and on a phone
   * where the drawer is full width it pushes off all four.
   *
   * The badge does not get a chip up here even though `banned` does. The Verify
   * button's own label already says which way the badge is set, so a chip would
   * be the same fact twice in a row that has no room for it, while `banned` has
   * no button label of its own that reads as a state.
   */
  const head = headShell(
    `${avatar(account, 'md', pb.auth.url)}
      <div class="identity-text">
        <h3 class="truncate">${esc(name)}</h3>
        <div class="sub truncate">${esc(
          [handle, account.email].filter(Boolean).join(' · ') || 'no handle and no email'
        )}</div>
      </div>
      ${account.banned ? chip('banned', 'bad') : ''}
      <span class="spacer"></span>
      <button class="btn btn-sm" type="button" data-act="${account.banned ? 'unban' : 'ban'}">${
        account.banned ? 'Unban' : 'Ban'
      }</button>
      <button class="btn btn-sm" type="button" data-act="${
        account.verified_badge ? 'unverify' : 'verify'
      }">${account.verified_badge ? 'Remove badge' : 'Verify badge'}</button>
      <button class="btn btn-sm" type="button" data-copy="${esc(account.id)}">Copy id</button>
      <button class="btn btn-sm btn-danger" type="button" data-act="delete">Delete</button>`
  );

  return `${head}
    <div class="drawer-body" data-body>
      ${countsGrid(counts)}
      ${driftCard(data.drift)}
      ${identityCard(account)}

      ${section({
        title: 'Posts',
        count: shownOf(data.posts, counts.posts),
        rows: postRows(data.posts),
        head: '<th>Post</th><th>Surface</th><th class="num">Likes</th><th class="num">Comments</th><th class="num">Views</th><th>Published</th>',
        note: 'Open one to see its images, its comment thread and who liked it',
        empty: emptyState(
          'Nothing published',
          'Posts this account shares to the community feed land here, newest first'
        ),
      })}

      ${section({
        title: 'Comments',
        count: shownOf(data.comments, counts.comments),
        rows: commentRows(data.comments),
        head: '<th>Comment</th><th>On</th><th class="num">Likes</th><th>Written</th>',
        note: 'A comment opens the post it is on, which is where it can be hidden or deleted',
        empty: emptyState(
          'No comments written',
          'Anything this account writes under a post in the feed shows up here, newest first'
        ),
      })}

      ${section({
        title: 'Cloud projects',
        count: shownOf(data.projects, counts.projects),
        rows: projectRows(data.projects),
        head: '<th>Project</th><th class="num">Boards</th><th class="num">Size</th><th>Visibility</th><th class="num">Format</th><th>Updated</th>',
        note: 'Size is the project document plus every asset saved with it. Open one for the asset list and the share link',
        empty: emptyState(
          'Nothing saved to the cloud',
          'Projects appear once this account turns on cloud saving in the editor'
        ),
      })}

      <div class="card"><div class="card-body">${rawJson('Raw account row', account)}${rawJson(
        'Raw counts',
        counts
      )}</div></div>
    </div>`;
}

/**
 * Open the account drawer for one id.
 *
 * Called by the router for `#/account/<id>`, and by any list view that would
 * rather hand over an id than build a drawer of its own. Returns once the first
 * paint has happened, which is what lets the router treat a failed open as an
 * error it can toast.
 */
export async function openAccount(id) {
  const mine = ++session;
  // Any watcher left by a previous open is dropped before this one registers,
  // so opening a second account without closing the first (the shell's search
  // does exactly that) never leaves two of them waiting on the same event.
  releaseCloseWatch();

  const drawer = openDrawer(
    `${headShell('<h3>Account</h3>')}
     <div class="drawer-body" data-body>${skeleton('tiles', 6)}${skeleton('rows', 5)}</div>`
  );
  // No `#drawer` host means this module is running somewhere that is not the
  // dashboard shell. Nothing useful can happen and a thrown error here would
  // surface in the router as "could not open that record", which would be a lie
  // about what went wrong.
  if (!drawer) return;

  let data = null;
  let failure = null;

  /** Close, and put the hash back where the router can find a page for it. */
  const dismiss = () => {
    /*
     * A detail route is a real URL here, so simply hiding the panel would leave
     * the address bar on `#/account/<id>` with nothing on screen, and the next
     * refresh would reopen a drawer over a record that may no longer exist.
     * Handing the hash back to the list is what makes Close and Escape and a
     * completed delete all end in the same understandable place.
     *
     * The watcher is released first. Routing to `#/accounts` closes the drawer
     * on the way, which fires `dash:drawer-close`, and while the guard in
     * `watchClose` would already stand that down (the hash is `#/accounts` by
     * then) it is clearer to have exactly one thing navigating per dismissal
     * than to rely on the order two of them run in.
     */
    releaseCloseWatch();
    if (location.hash.startsWith('#/account/')) go('#/accounts');
    else closeDrawer();
  };

  const bodyEl = () => $('[data-body]', drawer);

  /** Every button this drawer owns, so one press cannot start a second write. */
  const setBusy = (on) => {
    $$('[data-act], [data-recount], [data-copy]', drawer).forEach((btn) => {
      btn.disabled = on;
    });
  };

  /*
   * Held at reduced opacity rather than replaced with a skeleton. A refetch
   * after a ban takes a few hundred milliseconds and the panel underneath is
   * still true for all but one field; blanking it would make every action look
   * like the drawer had reloaded from scratch, which is exactly the flash the
   * house rule about `is-stale` exists to prevent.
   */
  const setStale = (on) => bodyEl()?.classList.toggle('is-stale', on);

  /*
   * One press at a time, across the whole drawer, and the CONFIRM is inside it.
   *
   * ## The bug this fixes
   *
   * `act` used to read `if (!ok) return;` and only then call `setBusy(true)`,
   * so the lock did not exist until after the dialog had been answered. Two
   * clicks landing in one tick therefore raised two dialogs, and confirming
   * both sent two moderate POSTs with two different refs, which the audit trail
   * records as two separate actions because nothing on that route is keyed on
   * the ref. On Delete it was worse than a duplicate write: the second confirm
   * resolved after `dismiss` had already closed the drawer, leaving an orphan
   * "Delete <name>?" dialog floating over the accounts table for an account
   * that was already gone.
   *
   * Disabling the pressed button is not a substitute. A press is a confirm,
   * then a write, then a refetch, and `paint` throws the button away and
   * rebuilds it in the middle of that, so the disabled flag does not survive
   * the sequence it is meant to cover. A flag around the WHOLE sequence has
   * neither problem, and it also covers the case a per-button flag never could,
   * which is pressing Recount while a Ban is still in flight.
   *
   * `postDetail.js` was already right about this and this is the same shape.
   * `ui.js` refuses a second dialog while one is open, which stops the stacking
   * on its own, but the per-surface lock is still what stops the second WRITE,
   * so both belong.
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

  const paint = () => {
    if (mine !== session) return;

    if (failure) {
      drawer.innerHTML = `${headShell('<h3>Account</h3>')}
        <div class="drawer-body" data-body>
          ${errorState('Could not read this account', failure)}
          <div><button class="btn" type="button" data-retry>Try again</button></div>
        </div>`;
    } else if (data) {
      drawer.innerHTML = renderAccount(data);
    } else {
      drawer.innerHTML = `${headShell('<h3>Account</h3>')}
        <div class="drawer-body" data-body>${skeleton('tiles', 6)}${skeleton('rows', 5)}</div>`;
    }

    wire();
  };

  /**
   * Fetch and repaint.
   *
   * `refetch` is the difference between the first load, where there is nothing
   * on screen worth keeping, and a reload after a write, where there is. A
   * reload that fails keeps the last good render and says so in a toast: the
   * write it followed may well have succeeded, and throwing the panel away
   * would hide the one thing the operator needs to see to know whether it did.
   */
  const load = async (refetch) => {
    if (refetch) setStale(true);
    try {
      const answer = await pb.account(id);
      if (mine !== session) return;
      data = answer;
      failure = null;
    } catch (err) {
      if (mine !== session) return;
      if (refetch && data) {
        setStale(false);
        setBusy(false);
        toast(err.message || 'Could not reload this account', 'bad');
        return;
      }
      data = null;
      failure = err;
    }
    paint();
  };

  /**
   * One moderation action, confirmed first, and the server's own sentence in
   * the toast afterwards.
   *
   * The confirm copy is written per action rather than generated, because the
   * three of them are not the same kind of decision: a ban is reversible from
   * this drawer, a badge is a public claim about somebody, and a delete is
   * neither. Only the last one is `danger`, so the red button means one thing
   * on this page and keeps meaning it.
   *
   * `ref` is minted once per confirmed press and not per attempt, and it is a
   * MARKER IN THE AUDIT TRAIL rather than a lock. Nothing on the moderate route
   * is keyed on it: the route validates its shape, writes it into `mod_log.ref`
   * and acts unconditionally. What it buys is that a human reading two
   * identical audit lines a second apart can tell one action logged twice from
   * two genuine presses, which is why a retry of the same press must reuse the
   * same value. It does NOT deduplicate a double submit. The `once` lock above
   * is the only thing that does that.
   */
  const act = async (action) => {
    const account = data?.account || {};
    const counts = data?.counts || {};
    const name = nameOf(account);
    const safeName = esc(name);

    let ok = false;
    if (action === 'ban' || action === 'unban') {
      ok = await confirmAction({
        title: action === 'ban' ? `Ban ${name}?` : `Lift the ban on ${name}?`,
        danger: action === 'ban',
        confirmLabel: action === 'ban' ? 'Ban' : 'Unban',
        from: account.banned ? 'banned' : 'active',
        to: action === 'ban' ? 'banned' : 'active',
        body:
          action === 'ban'
            ? `<p><strong>${safeName}</strong> is refused at every route that checks the flag, and every token
                 they are holding stops working on their next request rather than at expiry.</p>
               <p class="muted">Their ${plural(counts.posts, 'post', 'posts')} and ${plural(
                 counts.comments,
                 'comment',
                 'comments'
               )} stay in the feed. Nothing is deleted and this is reversible from here.</p>`
            : `<p><strong>${safeName}</strong> can sign in, post and comment again.</p>`,
      });
    } else if (action === 'verify' || action === 'unverify') {
      ok = await confirmAction({
        title: action === 'verify' ? `Give ${name} the badge?` : `Take the badge off ${name}?`,
        confirmLabel: action === 'verify' ? 'Verify badge' : 'Remove badge',
        from: account.verified_badge ? 'verified badge' : 'no badge',
        to: action === 'verify' ? 'verified badge' : 'no badge',
        body:
          action === 'verify'
            ? `<p>The badge shows next to <strong>${safeName}</strong> everywhere their posts appear. It is a
                 claim this box is making about them, not something they earned by a rule.</p>`
            : `<p>The badge stops showing next to <strong>${safeName}</strong>. Nothing else about the account
                 changes.</p>`,
      });
    } else {
      /*
       * The one that cannot be taken back.
       *
       * Every number in this list is counted BEFORE the delete, because after
       * it there is nothing left to count: `users` is the parent of every
       * relation in this schema and all of them cascade. The list is written
       * out table by table rather than summarised as "and all their data",
       * which is the phrase people click past.
       *
       * The last paragraph is the honest part. Deleting takes the follows and
       * the likes this account made, and those were somebody ELSE's follower
       * and like counts. The server cannot walk them inside the transaction
       * without an unbounded number of writes, so it does not, and the operator
       * needs to know that before they press rather than after.
       */
      ok = await confirmAction({
        title: `Delete ${name}?`,
        danger: true,
        confirmLabel: 'Delete account',
        body: `<p>Deleting <strong>${safeName}</strong> removes, by cascade:</p>
          <ul>
            <li>${plural(counts.posts, 'post', 'posts')} and every screenshot uploaded with them</li>
            <li>${plural(counts.comments, 'comment', 'comments')}</li>
            <li>${plural(counts.projects, 'cloud project', 'cloud projects')}, ${plural(
              counts.assets,
              'saved asset',
              'saved assets'
            )} and every file behind them</li>
            <li>${plural(counts.likes_given, 'like', 'likes')}, ${plural(
              counts.saves,
              'save',
              'saves'
            )} and ${plural(
              counts.comment_likes_given,
              'comment like',
              'comment likes'
            )} they gave</li>
            <li>${plural(counts.following, 'follow', 'follows')} out and ${plural(
              counts.followers_actual,
              'follower',
              'followers'
            )} in</li>
            <li>their avatar, their handle and the row itself</li>
          </ul>
          <p><strong>This cannot be undone.</strong> There is no soft delete on this box and no backup this
             dashboard can reach. Ban is the reversible version of this decision.</p>
          <p class="muted">Like and follower counts on other people's rows may read high afterwards, because the
             join rows go and the cached columns on those rows do not. Recount rebuilds them, from the Integrity
             page or from any drawer that shows drift.</p>`,
      });
    }

    if (!ok) return;

    setBusy(true);
    try {
      const reply = await pb.moderate({ target: 'account', id, action, ref: newRef() });
      if (mine !== session) return;
      // The route writes `note` for a person to read and it is more specific
      // than anything invented here: it names how many posts and comments went
      // with a delete, and what a ban does to a token that is already minted.
      toast(reply?.note || 'Done', 'good');

      if (action === 'delete') {
        // The row this drawer was opened from no longer exists, so there is
        // nothing to repaint and nothing to go back to inside the drawer.
        dismiss();
        return;
      }
      await load(true);
    } catch (err) {
      if (mine !== session) return;
      setBusy(false);
      toast(err.message || 'That did not go through', 'bad');
    }
  };

  /**
   * Rebuild one counter from its join table.
   *
   * ## Why this asks, when it used to not
   *
   * It went straight to `pb.recount` on the argument that a repair is not a
   * moderation action and a dialog in front of one teaches people to click
   * through dialogs. That argument loses to three things it was weighed
   * against:
   *
   *   - The gate footer promises that everything which writes is marked and all
   *     of it asks first, with no exception carved out for repairs, and the
   *     README's table says the dashboard is read only until you confirm.
   *   - The IDENTICAL repair on the Integrity page already raises a dialog, so
   *     the same button did two different things depending on which screen the
   *     operator reached it from.
   *   - `projects.js` makes the argument against itself better than this
   *     comment can: a page where three of four buttons are guarded teaches the
   *     hand to expect a dialog and then punishes it on the fourth.
   *
   * The dialog is not `danger`. Red means "cannot be undone" on this page and
   * this is the one write here that can simply be run again.
   *
   * ## What the copy has to say, and why
   *
   * That the scope is the WHOLE TABLE. The button sits inside an account
   * drawer, next to that account's own two wrong numbers, which makes it read
   * as "fix this person". It is not: the route rebuilds up to 500 drifting rows
   * wherever they are. An operator who thinks they touched one row and actually
   * touched five hundred has been misled by the placement, and the dialog is
   * the place to correct that before the write rather than after.
   *
   * `remaining` decides the toast. The call is bounded, so "rebuilt 500" with
   * no more said would read as finished when it is half way, and the operator
   * would walk away from a table that still drifts.
   */
  const recount = async (scope) => {
    const spec = DRIFT_SPECS.find((item) => item.scope === scope);
    if (!spec) return;

    const ok = await confirmAction({
      title: `Rebuild the ${spec.label.toLowerCase()} counter?`,
      confirmLabel: 'Rebuild counters',
      body:
        `<p>This rewrites <strong>${esc(spec.scope)}</strong>, ${esc(spec.source)}, for up to ` +
        `<strong>${n(RECOUNT_LIMIT)}</strong> rows that disagree with it.</p>` +
        '<ul>' +
        '<li>Every drifting row in the table is in scope, not only this account</li>' +
        '<li>Rows that already agree are not written, so nothing correct is restamped</li>' +
        '<li>No account, post, comment or project is created, hidden or deleted</li>' +
        '</ul>' +
        '<p class="muted">If more than that have drifted it says so and you run it again</p>',
    });
    if (!ok) return;
    if (mine !== session) return;

    setBusy(true);
    try {
      const reply = await pb.recount({ scope, limit: RECOUNT_LIMIT });
      if (mine !== session) return;
      const fixed = Number(reply?.fixed?.[scope]) || 0;
      const left = Number(reply?.remaining?.[scope]) || 0;

      if (left > 0) {
        toast(
          `Rebuilt ${plural(fixed, 'row', 'rows')}, ${n(left)} still disagree. Run it again`,
          ''
        );
      } else if (fixed > 0) {
        toast(`Rebuilt ${plural(fixed, 'row', 'rows')}, none left disagreeing`, 'good');
      } else {
        toast('Nothing needed rebuilding, the columns already agree', 'good');
      }

      await load(true);
    } catch (err) {
      if (mine !== session) return;
      setBusy(false);
      toast(err.message || 'The recount did not run', 'bad');
    }
  };

  /**
   * Bind everything, after every paint.
   *
   * `paint()` reassigns `drawer.innerHTML`, which throws away every listener
   * including the ones `openDrawer` attached when the shell was first drawn, so
   * this has to run again each time rather than once at the top.
   *
   * The click delegation is bound to the BODY element and not to the drawer,
   * and that is the part worth remembering: the drawer element outlives this
   * function and is shared with every other detail view, so a listener on it
   * would still be there the next time an account, a post or a project is
   * opened. The body is rebuilt on every paint, so its listeners die with it.
   */
  const wire = () => {
    $$('[data-close]', drawer).forEach((btn) => btn.addEventListener('click', dismiss));

    /*
     * Both writes go through `once`, and `once` wraps the CONFIRM as well as
     * the POST. Wrapping only the POST would leave the window in which two
     * clicks raise two dialogs, which is the bug the lock exists for. Copy is
     * not wrapped: it writes nothing and blocking it behind an in-flight ban
     * would be a lock that only annoys.
     */
    $$('[data-act]', drawer).forEach((btn) =>
      btn.addEventListener('click', () => once(() => act(btn.dataset.act)))
    );

    $$('[data-copy]', drawer).forEach((btn) =>
      btn.addEventListener('click', () => copyText(btn.dataset.copy))
    );

    $$('[data-recount]', drawer).forEach((btn) =>
      btn.addEventListener('click', () => once(() => recount(btn.dataset.recount)))
    );

    const retry = $('[data-retry]', drawer);
    if (retry) retry.addEventListener('click', () => load(false));

    const body = bodyEl();
    if (!body) return;
    body.addEventListener('click', (ev) => {
      const target = ev.target.closest('[data-go]');
      if (!target) return;
      /*
       * The anchors carry a real href so they are tab reachable and copyable,
       * and this handler takes the navigation off them anyway: `go` routes a
       * hash that has not changed, which the browser's own hash write does not,
       * and one path through the router is easier to reason about than two.
       * The anchor sits inside a clickable row, and `closest` finds whichever
       * is nearer, so a click on either sends exactly one navigation.
       */
      ev.preventDefault();
      go(target.dataset.go);
    });
  };

  /*
   * `paint` rather than `wire` for the first draw, even though `openDrawer` has
   * already put the same skeleton on screen.
   *
   * `openDrawer` wires its own plain `closeDrawer` handler onto `[data-close]`,
   * and this drawer needs `dismiss` instead: closing has to hand the hash back
   * to the list, or the address bar sits on a record that is no longer showing.
   * Repainting throws that listener away with the markup it was attached to,
   * which leaves exactly one handler on the button instead of two doing
   * overlapping jobs. It costs one string assignment.
   */
  paint();
  /*
   * Registered before the fetch, not after it.
   *
   * The whole point of drawing the shell first is that the drawer is on screen
   * and closeable while the request is still out, and an operator who presses
   * Escape during that second has to land on `#/accounts` exactly as they would
   * a second later. Waiting for `load` would leave the one window where the
   * original bug still bit.
   */
  watchClose(id);
  await load(false);
}

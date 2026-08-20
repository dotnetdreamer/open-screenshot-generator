/**
 * Integrity — what the box noticed about itself.
 *
 * ## Nothing on this page is a verdict
 *
 * Every finding here is a lead. A shared handle, a burst of posts in an
 * afternoon or an account sitting on a gigabyte of projects is a launch day at
 * least as often as it is abuse, and the one thing a moderation tool must never
 * do is present a query result as guilt. So every card carries two sentences:
 * what the finding means, and what it does NOT mean. The second one is the more
 * important of the two and it is why the cards are this verbose.
 *
 * ## The spine of the page is counter drift
 *
 * `posts.likes`, `posts.comments`, `comments.likes`, `users.post_count` and
 * `users.followers` are denormalized caches of the join tables. A feed page is
 * twelve cards, every card shows two counters and every sort except newest
 * orders by them, so counting them per request is the query that makes the feed
 * slow before anything else does.
 *
 * The cost of that decision is drift. Every relation on this box cascades, so
 * deleting an account removes its likes, saves, follows and comments as ROWS
 * and touches none of the counters that were summarising them. Nothing is
 * corrupted and nothing is lost; the numbers on other people's posts are simply
 * now too high. That is not a bug to hide. It is the thing this page exists to
 * surface and the thing Fix exists to repair.
 *
 * ## Why a check that found nothing still gets a card
 *
 * A passing check that vanished would be indistinguishable from a check that
 * never ran, and those are very different states when a query has started
 * throwing on the server. So a clean check collapses to one green line rather
 * than disappearing, a check whose array never arrived says "could not run"
 * rather than "clear", and the difference between the three is visible at arm's
 * length. `styles.css` makes the same argument at greater length over
 * `.finding`, which is where these three states are painted.
 *
 * ## What Fix does, and what it deliberately does not do
 *
 * The five drift cards carry a Fix button that calls `recount` for that scope.
 * The route rewrites only the rows that actually disagree, because `updated` is
 * an autodate and an UPDATE that rewrote every row with the value it already
 * had would restamp the entire feed and reorder anything sorting by it. A
 * repair that changes what the feed looks like is not a repair.
 *
 * It is also bounded, at 500 rows per scope per call, so the SQLite write lock
 * is never held long enough for a feed read to notice. That is why the answer
 * carries `remaining` as well as `fixed`, and why this page says "run it again"
 * rather than pretending one press finished the job.
 *
 * Nothing else here writes. There is no Hide, no Ban and no Delete on this page
 * on purpose: this is the page you read before you act, and the acting happens
 * in the drawer behind the links in these tables, where the whole record is in
 * front of you rather than one row of it.
 */

import * as pb from '../pb.js';
import {
  esc,
  n,
  bytes,
  signed,
  ago,
  stamp,
  emptyState,
  errorState,
  skeleton,
  toast,
  confirmAction,
  node,
  $,
} from '../ui.js';

/**
 * How many rows the risk route returns per check.
 *
 * Every list in that route ends `LIMIT 40`, which means a card showing forty
 * rows is showing a floor and not a total. The page has to say so, or an
 * operator reads "40 posts drifting" as the whole problem and stops after one
 * pass of Fix that reported two thousand rows still wrong.
 */
const LIST_CAP = 40;

/**
 * Rows per Fix press. The route defaults to this and caps it at 2000 across a
 * call, so sending it explicitly changes nothing except that the confirm dialog
 * can name the number before it happens rather than after.
 */
const RECOUNT_LIMIT = 500;

// ------------------------------------------------------------- posture ---

/**
 * The seven switches the risk route reports, and what each state actually does.
 *
 * Read before the findings, always. Two of these decide whether the findings
 * below mean anything at all: while `enabled` is off nothing new is arriving,
 * so a quiet scan is a quiet box rather than a clean one, and while
 * `writes_enabled` is off the counters cannot drift any further no matter what
 * the tables currently say.
 *
 * ## The polarity is not the same for every key, and that is deliberate
 *
 * `lib/openscreengen.js` parses these two different ways and this table mirrors
 * it exactly. Ordinary booleans are ON unless the stored string is the literal
 * `false` or `0`, so a blank row, a typo or a half finished edit leaves a
 * working feature working. `github_allow_pat` has the opposite polarity and is
 * OFF unless the string is exactly `true` or `1`, because it widens who may
 * sign in, and a typo must leave that door shut rather than open.
 *
 * `fallback` is the value from `DEFAULTS` in `lib/openscreengen.js`, which is
 * what the box acts on when the settings row is missing. It is written out here
 * rather than read from the wire because the risk route does not send it, and
 * it is the only part of this page that can silently disagree with the server:
 * if a default changes over there, change it here too.
 *
 * `loud` names the state worth a warning chip. It is not the same as "off": a
 * feed that is switched off is loud, and a PAT door that is switched on is loud.
 */
const POSTURE = {
  enabled: {
    fallback: 'true',
    loud: 'off',
    on: 'Every community route is answering and the editor shows Discover',
    off: 'Every community route answers 503 and the editor hides Discover. Designing and exporting are unaffected, nothing about them touches this box',
  },
  writes_enabled: {
    fallback: 'true',
    loud: 'off',
    on: 'Posting, commenting, liking, saving and following are all being accepted',
    off: 'The feed is fully readable and every write is refused with 503. This is the switch to reach for while moderating, rather than the master one',
  },
  signin_enabled: {
    fallback: 'true',
    loud: 'off',
    on: 'Both token exchange routes are open, so new sessions can be minted',
    off: 'No new session can be minted. Tokens already issued keep working until they expire, so this closes the door without signing anybody out',
  },
  cloud_projects_enabled: {
    fallback: 'true',
    loud: 'off',
    on: 'Projects can be saved to this box, which is the half of the feature that fills the disk',
    off: 'Every projects route answers 503 and the editor hides the option. Saves already on the box are untouched',
  },
  github_allow_pat: {
    fallback: 'false',
    strict: true,
    loud: 'on',
    on: 'A pasted GitHub personal access token is accepted, which proves only that somebody holds a GitHub token and not that they got it from this app',
    off: 'Only a token from a listed OAuth app is accepted, which is the state to be in unless the editor sign in Worker is unconfigured',
  },
  avatar_fetch_enabled: {
    fallback: 'true',
    loud: null,
    on: 'Provider pictures are copied into this box at sign in, so the feed never asks Google or GitHub for one and never shows them who is reading it',
    off: 'Accounts show the initials chip instead, which is what everybody without a picture already gets',
  },
  moderation_note: {
    fallback: '',
    text: true,
    on: 'This text is shown under an empty feed',
    off: 'No note is shown under an empty feed. The word unset is what hides the line, because the settings row cannot be saved blank',
  },
};

/**
 * Posture order: master switches, then the doors, then presentation.
 *
 * The wire array is alphabetical, which puts `avatar_fetch_enabled` above
 * `enabled` and buries the one key that decides whether anything on this page
 * is happening at all. A key the route grows later is unknown to this list and
 * falls to the end rather than disappearing.
 */
const POSTURE_ORDER = [
  'enabled',
  'writes_enabled',
  'cloud_projects_enabled',
  'signin_enabled',
  'github_allow_pat',
  'avatar_fetch_enabled',
  'moderation_note',
];

/**
 * One posture row, interpreted the way the hooks interpret it.
 *
 * `absent` is the case this function exists for. The risk route emits every key
 * whether or not the settings table has a row for it, and a missing row is the
 * HOOK DEFAULT in force rather than an off switch. Dropping the key from the
 * strip would make "nobody has configured this" look identical to "this is
 * switched off", which is the one distinction the strip is for.
 */
function readPosture(row) {
  const key = String(row.k || '');
  const spec = POSTURE[key];
  const stored = row.v === null || row.v === undefined ? '' : String(row.v);
  const absent = row.absent === true;
  // What the box will act on: the stored string when there is a row, the hook
  // default when there is not.
  const effective = (absent ? (spec ? spec.fallback : '') : stored).trim();

  if (!spec) {
    return {
      key,
      absent,
      stored,
      effective,
      word: 'stored',
      kind: '',
      note: 'This page carries no note for this key, so it is shown exactly as the settings table holds it',
    };
  }

  if (spec.text) {
    // `unset` is the placeholder the migration seeds, because settings.value is
    // a required column and a row cannot be created blank. It is not a value,
    // and the hooks read it as an empty string.
    const shown = effective !== '' && effective !== 'unset';
    return {
      key,
      absent,
      stored,
      effective,
      word: shown ? 'shown' : 'not shown',
      kind: '',
      note: shown ? spec.on : spec.off,
    };
  }

  const on = spec.strict
    ? effective === 'true' || effective === '1'
    : !(effective === 'false' || effective === '0');
  const loud = spec.loud === (on ? 'on' : 'off');
  return {
    key,
    absent,
    stored,
    effective,
    word: on ? 'on' : 'off',
    kind: loud ? 'warn' : 'good',
    note: on ? spec.on : spec.off,
  };
}

// -------------------------------------------------------------- markup ---

/**
 * A cell that is deliberately markup rather than text.
 *
 * `table()` escapes every plain cell, because most of what lands in one is a
 * title, a display name or a comment body somebody typed into the app, and this
 * dashboard is the one place in the project that renders those without a React
 * layer escaping them first. A cell that genuinely needs markup has to say so,
 * which makes the unsafe path the one you have to type on purpose.
 */
const raw = (html) => ({ html });

/**
 * A table. Heads are strings, or `{ label, num: true }` for a numeric column so
 * the figures get the tabular numerals and the right alignment `table.data`
 * already knows how to give them.
 *
 * An empty cell prints the word "none" rather than a dash, both for the house
 * rule that keeps em and en dashes out of everything a person reads, and
 * because "none" is a fact where a dash is a shrug.
 */
function table(heads, rows) {
  if (!rows.length) return '';
  const cols = heads.map((head) => (typeof head === 'string' ? { label: head, num: false } : head));
  const cell = (value, num) => {
    const cls = num ? ' class="num"' : '';
    if (value === null || value === undefined || value === '') {
      return `<td${cls}><span class="muted">none</span></td>`;
    }
    if (typeof value === 'object' && typeof value.html === 'string') return `<td${cls}>${value.html}</td>`;
    return `<td${cls}>${esc(value)}</td>`;
  };
  return `<div class="table-wrap"><table class="data">
    <thead><tr>${cols
      .map((col) => `<th${col.num ? ' class="num"' : ''}>${esc(col.label)}</th>`)
      .join('')}</tr></thead>
    <tbody>${rows
      .map((row) => `<tr>${row.map((value, i) => cell(value, cols[i] ? cols[i].num : false)).join('')}</tr>`)
      .join('')}</tbody>
  </table></div>`;
}

/**
 * A link into the account drawer.
 *
 * A real anchor rather than a clickable row. The rows on this page are evidence
 * and the first thing anybody does with a lead is open the record behind it, so
 * it has to be reachable with a keyboard and it has to be something somebody
 * can copy into a message. `#/account/<id>` rides on top of whichever view is
 * mounted, so the drawer opens over this page and closing it leaves the scan
 * exactly as it was.
 *
 * The name is escaped and so is the id. The id is fifteen lowercase
 * alphanumerics from the box and could be interpolated raw, but a rule that has
 * an exception in it is a rule nobody applies, so everything from the wire goes
 * through `esc` including the parts that are known safe.
 */
const personCell = (row) => {
  const name = row.name || 'Someone';
  const handle = row.handle ? ` <span class="muted tiny">@${esc(row.handle)}</span>` : '';
  if (!row.u) return raw(`${esc(name)}${handle}`);
  return raw(`<a href="#/account/${esc(row.u)}">${esc(name)}</a>${handle}`);
};

const postCell = (row) => raw(`<a href="#/post/${esc(row.id)}">${esc(row.title || 'Untitled')}</a>`);

const projectCell = (row) =>
  raw(`<a href="#/project/${esc(row.id)}">${esc(row.name || 'Untitled project')}</a>`);

/** n things, with the verb and the noun agreeing. Every lead line uses it. */
const plural = (count, one, many) => `${n(count)} ${count === 1 ? one : many}`;

/**
 * Enough of a comment body to recognise it by, and no more.
 *
 * `comments.body` is 500 characters, and a drift row only has to say WHICH
 * comment the number is wrong on. The `.truncate` class cannot do this job here:
 * it is `overflow: hidden` plus `white-space: nowrap`, and an inline span in a
 * table cell ignores overflow while obeying nowrap, so the whole 500 characters
 * would render on one unbreakable line and push the table sideways inside its
 * scroller. Cutting the string is the honest fix, and the full body is one click
 * away in the post drawer.
 */
function clip(text, max = 140) {
  const value = text === null || text === undefined ? '' : String(text);
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Forty rows is a floor when the route capped the list, and saying so is the
 * difference between an operator running Fix once and running it until
 * `remaining` reaches zero.
 */
const capNote = (rows) =>
  rows.length >= LIST_CAP
    ? `The scan lists at most ${n(LIST_CAP)} rows per check, so this is a floor rather than a total`
    : '';

// ------------------------------------------------------------- findings ---

/**
 * Every check the risk route runs, in the order an operator should read them.
 *
 * Not sorted by severity at paint time, on purpose. Fix re-renders one card in
 * place, and a page that reordered itself the moment a card went clean would
 * move the next card you were about to press out from under the pointer. A
 * fixed order also means the page looks the same on every box, which is what
 * makes "the third card is red again" a sentence two people can have.
 *
 * Drift first, because it is the only thing here with a repair button. Then the
 * checks that mean a bug in the schema rather than a lead about a person. Then
 * the people, last, and every one of those carries the sentence saying what the
 * innocent reading of it is.
 */
const FINDINGS = [
  {
    id: 'post_like_drift',
    key: 'post_like_drift',
    title: 'Like counts that disagree with the likes table',
    level: 'warning',
    scope: 'post_likes',
    column: 'posts.likes',
    source: 'the post_likes table',
    lead: (rows) =>
      `${plural(rows.length, 'post shows', 'posts show')} a like count the rows behind it do not support`,
    clear: 'Every post like count matches the rows in post_likes',
    means:
      'posts.likes is a cache of post_likes, and these rows have fallen out of step, almost always because an account was deleted and its likes went with it',
    notMeans:
      'Nobody faked a like. The join rows are the truth and the cached number is stale, so the feed is over counting rather than the like being invented',
    body: (rows) =>
      table(
        ['Post', { label: 'Shows', num: true }, { label: 'Rows', num: true }, { label: 'Gap', num: true }],
        rows.map((row) => [postCell(row), n(row.stored), n(row.actual), signed(row.stored - row.actual)])
      ),
  },
  {
    id: 'post_comment_drift',
    key: 'post_comment_drift',
    title: 'Comment counts that disagree with the comments table',
    level: 'warning',
    scope: 'post_comments',
    column: 'posts.comments',
    source: 'the comments table',
    lead: (rows) =>
      `${plural(rows.length, 'post shows', 'posts show')} a comment count the comments on it do not support`,
    clear: 'Every post comment count matches the comments on it',
    means:
      'posts.comments is bumped when a comment is written and decremented when one is deleted, and a cascade delete moves the comment rows without touching it',
    notMeans:
      'No comment is missing from the post. Open one and the list is complete, only the number printed over it is wrong',
    body: (rows) =>
      table(
        ['Post', { label: 'Shows', num: true }, { label: 'Rows', num: true }, { label: 'Gap', num: true }],
        rows.map((row) => [postCell(row), n(row.stored), n(row.actual), signed(row.stored - row.actual)])
      ),
  },
  {
    id: 'comment_like_drift',
    key: 'comment_like_drift',
    title: 'Comment like counts that disagree with the comment likes table',
    level: 'warning',
    scope: 'comment_likes',
    column: 'comments.likes',
    source: 'the comment_likes table',
    lead: (rows) =>
      `${plural(rows.length, 'comment shows', 'comments show')} a like count the rows behind it do not support`,
    clear: 'Every comment like count matches the rows in comment_likes',
    means:
      'The same cache as the two above, one level down. A deleted account takes its comment likes with it and leaves the number on the comment where it was',
    notMeans:
      'Not a moderation problem, and visible to almost nobody. It is the smallest of the five and the cheapest one to leave until later',
    body: (rows) =>
      table(
        [
          'Comment',
          { label: 'Shows', num: true },
          { label: 'Rows', num: true },
          { label: 'Gap', num: true },
        ],
        rows.map((row) => [
          clip(row.body) || 'Empty comment',
          n(row.stored),
          n(row.actual),
          signed(row.stored - row.actual),
        ])
      ),
  },
  {
    id: 'author_count_drift',
    key: 'author_count_drift',
    title: 'Accounts whose post count disagrees with their posts',
    level: 'warning',
    scope: 'post_count',
    column: 'users.post_count',
    source: 'the posts table',
    lead: (rows) =>
      `${plural(rows.length, 'account carries', 'accounts carry')} a post count their posts do not support`,
    clear: 'Every account post count matches the posts they have written',
    means:
      'users.post_count is what a profile prints without reading the posts table, and it is maintained by the share and delete routes rather than by the database',
    notMeans:
      'Not evidence the account did anything. A post removed by hand in the PocketBase admin decrements nothing, and that is the usual cause',
    body: (rows) =>
      table(
        [
          'Account',
          { label: 'Carries', num: true },
          { label: 'Posts', num: true },
          { label: 'Gap', num: true },
        ],
        rows.map((row) => [personCell(row), n(row.stored), n(row.actual), signed(row.stored - row.actual)])
      ),
  },
  {
    id: 'follower_drift',
    key: 'follower_drift',
    title: 'Accounts whose follower count disagrees with the follows table',
    level: 'warning',
    scope: 'followers',
    column: 'users.followers',
    source: 'the follows table',
    lead: (rows) =>
      `${plural(rows.length, 'account carries', 'accounts carry')} a follower count the follows table does not support`,
    clear: 'Every follower count matches the rows in follows',
    means:
      'users.followers is a cache of the follows table, and deleting an account removes every follow it made without touching the counts those follows were propping up',
    notMeans:
      'Not somebody buying followers. A stored number far above the rows is what a deleted account leaves behind, and a number below them is a follow written straight into the admin',
    body: (rows) =>
      table(
        [
          'Account',
          { label: 'Carries', num: true },
          { label: 'Follows', num: true },
          { label: 'Gap', num: true },
        ],
        rows.map((row) => [personCell(row), n(row.stored), n(row.actual), signed(row.stored - row.actual)])
      ),
  },
  {
    id: 'self_follows',
    key: 'self_follows',
    title: 'Accounts following themselves',
    level: 'warning',
    lead: (rows) => `${plural(rows.length, 'account follows', 'accounts follow')} their own posts`,
    clear: 'Nobody is following themselves',
    means:
      'The follow route refuses this, so a row here was written by hand in the admin or that refusal has a hole in it, and either way it lifts the account own follower count by one',
    notMeans:
      'Not a farming signal. One row is nearly always a test somebody left behind, and Fix does not clear it: recount rebuilds the count from the rows, and this row is one of them',
    body: (rows) => table(['Account'], rows.map((row) => [personCell(row)])),
  },
  {
    id: 'duplicate_handles',
    key: 'duplicate_handles',
    title: 'Handles claimed by more than one account',
    level: 'critical',
    lead: (rows) => `${plural(rows.length, 'handle is', 'handles are')} held by more than one account`,
    clear: 'Every claimed handle belongs to exactly one account',
    means:
      'idx_users_handle is a partial unique index over every non empty handle, so two rows sharing one means the index is missing or was rebuilt without its WHERE clause',
    notMeans:
      'Not two people picking the same name, the box refuses that at write time. Accounts with no handle at all are excluded here because they are allowed to collide',
    body: (rows) =>
      table(
        ['Handle', { label: 'Accounts', num: true }],
        rows.map((row) => [raw(`<span class="mono">@${esc(row.handle)}</span>`), n(row.n)])
      ),
  },
  {
    id: 'slug_collisions',
    key: 'slug_collisions',
    title: 'Share links pointing at more than one project',
    level: 'critical',
    lead: (rows) =>
      `${plural(rows.length, 'share link resolves', 'share links resolve')} to more than one project`,
    clear: 'Every share link resolves to exactly one project',
    means:
      'A share slug is the entire credential on a link, so two projects answering one slug means whoever holds that link can reach work that is not theirs',
    notMeans:
      'Not somebody guessing a slug. It is 22 random characters, and a collision here is an index that stopped being unique rather than an attack',
    body: (rows) =>
      table(
        ['Share slug', { label: 'Projects', num: true }],
        rows.map((row) => [raw(`<span class="mono">${esc(row.slug)}</span>`), n(row.n)])
      ),
  },
  {
    id: 'empty_posts',
    key: 'empty_posts',
    title: 'Posts with no screens on them',
    level: 'warning',
    lead: (rows) => `${plural(rows.length, 'post has', 'posts have')} nothing to show`,
    clear: 'Every post has at least one screen on it',
    means:
      'The share route refuses a post with no images, so these are uploads whose second half failed, or records whose files left the disk without the row going with them',
    notMeans:
      'Not hidden and not deleted. These are live in the feed right now, rendering as an empty card, which is the symptom nobody can otherwise explain',
    body: (rows) =>
      table(
        ['Post', 'Author', 'Published'],
        rows.map((row) => [
          postCell(row),
          row.author_name || 'Someone',
          raw(`<span class="muted tiny">${esc(stamp(row.created))}, ${esc(ago(row.created))}</span>`),
        ])
      ),
  },
  {
    id: 'orphans',
    title: 'Rows pointing at something that is gone',
    level: 'critical',
    /*
     * Not an array on the wire: six named counts. Its own reader, and its own
     * definition of how many findings that is, which matches `countFindings` in
     * app.js on purpose. One broken cascade is ONE finding no matter how many
     * rows it left behind, because "post_likes: 4180" is a single thing that
     * went wrong and not four thousand of them.
     */
    collect: (data) => {
      const buckets = data.orphans && typeof data.orphans === 'object' ? data.orphans : null;
      if (!buckets) return { rows: [], count: 0, missing: true };
      const rows = Object.keys(buckets).map((name) => ({ k: name, n: Number(buckets[name]) || 0 }));
      return { rows, count: rows.filter((row) => row.n > 0).length, missing: false };
    },
    lead: (rows) => {
      const broken = rows.filter((row) => row.n > 0);
      return `${plural(broken.length, 'table holds', 'tables hold')} rows whose parent record no longer exists`;
    },
    clear: 'Every join row still has both of its parents',
    means:
      'Every relation in the migrations cascades, so all six of these are meant to be zero. A number means a cascade did not fire, and an orphaned asset row is a file on the disk that nothing will ever delete',
    notMeans:
      'Not drift, and Fix does not touch it. A counter is cosmetic and rebuildable, a row with no parent is a repair somebody has to make by hand once they know why it happened',
    body: (rows) =>
      table(
        ['Table', { label: 'Orphaned rows', num: true }, 'State'],
        rows.map((row) => [
          raw(`<span class="mono">${esc(row.k)}</span>`),
          n(row.n),
          raw(
            row.n > 0
              ? '<span class="chip chip-bad">a cascade did not fire</span>'
              : '<span class="chip chip-good">clear</span>'
          ),
        ])
      ),
  },
  {
    id: 'burst_posters',
    key: 'burst_posters',
    title: 'Accounts over the posting limit in the last 24 hours',
    level: 'warning',
    lead: (rows, data) =>
      `${plural(rows.length, 'account is', 'accounts are')} above the ${n(
        limitOf(data, 'max_posts_per_day')
      )} posts a day this box allows`,
    clear: (data) =>
      `Nobody has published more than ${n(limitOf(data, 'max_posts_per_day'))} posts in the last 24 hours`,
    means:
      'max_posts_per_day is the real bound on flooding the feed, and an account above its own limit means the limit was raised since, or the count that enforces it did not see these rows',
    notMeans:
      'Not a flood on its own. A launch day, a template set posted one screen at a time, and the official account seeding the showcase all look exactly like this',
    body: (rows) =>
      table(
        ['Account', { label: 'Posts in 24h', num: true }],
        rows.map((row) => [personCell(row), n(row.n)])
      ),
  },
  {
    id: 'burst_commenters',
    key: 'burst_commenters',
    title: 'Accounts over the commenting limit in the last hour',
    level: 'warning',
    lead: (rows, data) =>
      `${plural(rows.length, 'account is', 'accounts are')} above the ${n(
        limitOf(data, 'max_comments_per_hour')
      )} comments an hour this box allows`,
    clear: (data) =>
      `Nobody has written more than ${n(limitOf(data, 'max_comments_per_hour'))} comments in the last hour`,
    means:
      'The hourly twin of the check above, and the one that catches a script rather than a person, because a person types more slowly than a limit set for a whole afternoon',
    notMeans:
      'Not spam on its own. Somebody answering every comment on their own launch post reads exactly the same way to this query',
    body: (rows) =>
      table(
        ['Account', { label: 'Comments in 1h', num: true }],
        rows.map((row) => [personCell(row), n(row.n)])
      ),
  },
  {
    id: 'heavy_owners',
    key: 'heavy_owners',
    title: 'Accounts over the cloud storage limit',
    level: 'warning',
    lead: (rows, data) =>
      `${plural(rows.length, 'account holds', 'accounts hold')} more than the ${bytes(
        limitOf(data, 'max_cloud_user_bytes')
      )} one account is allowed`,
    clear: (data) =>
      `No account is over the ${bytes(limitOf(data, 'max_cloud_user_bytes'))} cloud storage limit`,
    means:
      'max_cloud_user_bytes is checked before every asset upload, so an account above it grew past the line before the line moved, or its project byte columns are stale',
    notMeans:
      'Not abuse. A designer with thirty real projects full of screenshots is the feature working as intended, and this row is a capacity question rather than a moderation one',
    body: (rows) =>
      table(
        ['Account', { label: 'Held', num: true }, { label: 'Projects', num: true }],
        rows.map((row) => [personCell(row), bytes(row.bytes), n(row.projects)])
      ),
  },
  {
    id: 'over_quota_projects',
    key: 'over_quota_projects',
    title: 'Projects over the per project limit',
    level: 'warning',
    lead: (rows, data) =>
      `${plural(rows.length, 'project is', 'projects are')} bigger than the ${bytes(
        limitOf(data, 'max_cloud_project_bytes')
      )} one project is allowed`,
    clear: (data) => `No project is over the ${bytes(limitOf(data, 'max_cloud_project_bytes'))} limit`,
    means:
      'One project document plus its assets, against the cap the save route enforces. A project above it stopped being saveable at some point, so its owner is seeing failures',
    notMeans:
      'Not a project to delete. It is the one to open first if the disk is filling, and the asset list in its drawer says which files are actually the large ones',
    body: (rows) =>
      table(
        ['Project', 'Owner', { label: 'Size', num: true }],
        rows.map((row) => [projectCell(row), row.owner_name || 'Someone', bytes(row.bytes)])
      ),
  },
  {
    id: 'banned_with_content',
    key: 'banned_with_content',
    title: 'Banned accounts whose work is still in the feed',
    level: 'warning',
    lead: (rows) =>
      `${plural(rows.length, 'banned account still has', 'banned accounts still have')} posts or comments in the feed`,
    clear: 'No banned account still has content in the feed',
    means:
      'Banning stops the token and nothing else, deliberately: it is reversible and it destroys nothing. So this is the list of decisions that were half made',
    notMeans:
      'Not a mistake. Leaving a banned account posts up is a perfectly good choice, and this card exists so that it stays a choice rather than becoming an oversight',
    body: (rows) =>
      table(
        ['Account', { label: 'Posts', num: true }, { label: 'Comments', num: true }],
        rows.map((row) => [personCell(row), n(row.posts), n(row.comments)])
      ),
  },
  {
    id: 'unlinked_accounts',
    title: 'Accounts with no provider linked',
    level: 'info',
    /*
     * A plain number rather than a list, and explicitly NOT a defect. It counts
     * as zero findings here for the same reason app.js leaves it out of the rail
     * badge: nobody has to go and fix any of these, and a badge that included
     * them would send somebody to this page for nothing.
     */
    collect: (data) => {
      const total = Number(data.unlinked_accounts);
      if (!isFinite(total)) return { rows: [], count: 0, missing: true };
      return { rows: [{ n: total }], count: 0, missing: false };
    },
    lead: (rows) =>
      `${plural(rows[0] ? rows[0].n : 0, 'account has', 'accounts have')} neither Google nor GitHub linked`,
    clear: 'Every account has a provider linked',
    means:
      'Neither google_sub nor github_id is set on these rows, so they were made before the provider columns existed, or by a path that never recorded one',
    notMeans:
      'Not a defect and not counted as a finding. It is here for context, because an unlinked account cannot sign in again and that explains an author who went quiet',
    body: (rows) =>
      table([{ label: 'Accounts with no provider', num: true }], rows.map((row) => [n(row.n)])),
  },
];

/**
 * One threshold from the route echo, falling back to the hook default.
 *
 * A list of accounts "over the limit" with the limit missing is unreadable, and
 * a limit printed as zero is worse than unreadable: it makes every account on
 * the box look like it is over the line.
 */
function limitOf(data, key) {
  const limits = data && data.limits ? data.limits : {};
  const value = Number(limits[key]);
  if (isFinite(value)) return value;
  // The same numbers as DEFAULTS in lib/openscreengen.js. Only reached when the
  // route answered without its limits block at all.
  const fallbacks = {
    max_posts_per_day: 10,
    max_comments_per_hour: 30,
    max_cloud_user_bytes: 1073741824,
    max_cloud_project_bytes: 268435456,
  };
  return fallbacks[key] || 0;
}

/**
 * What a check found, or why it did not find anything.
 *
 * `missing` is the third state and the reason this function exists. The route
 * answers one array per check and wraps each query on its own, so a check whose
 * SQL failed is simply absent from the payload. Rendering that as an empty
 * array would print "clear" over a check that never ran, which is the exact lie
 * this page was built to avoid.
 */
function collect(spec, data) {
  if (spec.collect) return spec.collect(data);
  const rows = Array.isArray(data[spec.key]) ? data[spec.key] : null;
  if (!rows) return { rows: [], count: 0, missing: true };
  return { rows, count: rows.length, missing: false };
}

/**
 * The findings total for the rail badge.
 *
 * Deliberately the same arithmetic as `countFindings` in app.js: array checks
 * count their rows, orphan buckets count one per broken table, and
 * `unlinked_accounts` counts nothing. Two numbers that disagreed would be worse
 * than either of them being slightly low, because the badge is what sends
 * somebody to this page and this page is what tells them the badge was honest.
 *
 * It cannot simply be imported: app.js does not export it, and a view reaching
 * back into the shell that dynamically imported it is an import cycle nobody
 * wants to debug at three in the morning. Keeping the definition in the finding
 * specs at least means the number on the page and the number in the rail are
 * the same computation over the same list.
 */
function countFindings(data) {
  let total = 0;
  for (const spec of FINDINGS) {
    const found = collect(spec, data);
    if (found.missing) continue;
    total += found.count;
  }
  return total;
}

// --------------------------------------------------------------- render ---

export async function render(root) {
  /*
   * Every asynchronous continuation in this view checks this before it writes.
   * A Fix press starts a recount and then a rescan, and an operator who moves to
   * another page while those are in flight has already had this view torn down:
   * without the flag the answer lands in a detached card, and the rail badge
   * gets set by a page that is no longer on the screen.
   */
  const live = { on: true };

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
  const isLive = () => live.on && mounted();


  /*
   * What each drift card learned from its last Fix press, keyed by finding id.
   *
   * Kept out of the DOM because the card is rebuilt from fresh data after every
   * pass, and this is the one piece of state that has to survive that rebuild.
   * "Rebuilt 500, 240 still drifting" is the sentence that tells an operator to
   * press the button again, and it would otherwise be lost in the same moment
   * it was earned.
   */
  const passes = new Map();

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Integrity</h2>
        <div class="sub">What the box noticed about itself: counters that disagree with the rows behind them, and the accounts, projects and links worth a second look</div>
      </div>
      <div class="page-tools">
        <span class="muted tiny" data-scanned></span>
        <button class="btn btn-sm" data-rescan type="button">Rescan</button>
      </div>
    </div>
    <div data-content>
      <div class="card">${skeleton('rows', 7)}</div>
      <div class="section-title">Findings</div>
      <div class="stack">
        <div class="card">${skeleton('rows', 4)}</div>
        <div class="card">${skeleton('rows', 4)}</div>
      </div>
    </div>`;


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
  const content = $('[data-content]', root);
  const scanned = $('[data-scanned]', root);
  const rescan = $('[data-rescan]', root);

  /**
   * Fetch and paint.
   *
   * `stale` is what stops the page flashing on a rescan. The previous scan stays
   * on screen at reduced opacity while the new one is in flight, so the numbers
   * an operator was reading do not vanish and reappear a second later. An empty
   * page for one second reads as "it broke", and a page that reads as broken
   * twice earns a bug report that costs somebody an afternoon.
   */
  async function load(stale) {
    if (stale) content.classList.add('is-stale');
    rescan.disabled = true;

    let data;
    try {
      data = await pb.risk();
    } catch (err) {
      if (!isLive()) return;
      content.classList.remove('is-stale');
      rescan.disabled = false;
      // The message, always. A scan that answered 500 because a column was
      // renamed is a five second fix for whoever is on the box, and "something
      // went wrong" is a trip to the browser console to find that out.
      content.innerHTML = errorState('Could not run the integrity scan', err);
      scanned.textContent = '';
      return;
    }

    if (!isLive()) return;
    content.classList.remove('is-stale');
    rescan.disabled = false;
    paint(data);
  }

  function paint(data) {
    scanned.textContent = `scanned ${stamp(data.now)}`;

    content.innerHTML = `
      <div class="stack">
        <div class="card">
          <div class="card-body">
            <div class="stack">
              <div><span class="chip chip-accent">read this first</span></div>
              <div class="dim">These are leads, not verdicts. A shared handle, a burst of posts or a heavy account is a launch day as often as it is abuse, and every card below says what its finding does not mean as well as what it does. Nothing on this page acts on anybody: the only button here that writes is Fix, and all Fix does is rebuild a counter from the rows it was supposed to be counting.</div>
            </div>
          </div>
        </div>
        ${jsonNote(data)}
      </div>

      <div class="section-title">Posture, what is switched on right now</div>
      <div class="card">
        <div class="card-head">
          <div>
            <h3>The seven switches this scan reads</h3>
            <div class="sub">Read these before the findings: a switch explains a quiet scan more often than the data does</div>
          </div>
          <span class="spacer"></span>
          <a class="btn btn-sm" href="#/settings">Open Settings</a>
        </div>
        <div data-posture></div>
      </div>

      <div class="section-title">Findings</div>
      <div class="stack" data-findings></div>`;

    paintPosture(data);
    paintFindings(data);

    /*
     * The badge is set from the page that can explain it, and only from a scan
     * that actually landed. Zero is passed as null rather than as 0, because a
     * rail full of zeroes teaches the eye to skip the badges, and then the one
     * that says 4 gets skipped as well.
     */
    const total = countFindings(data);
    if (window.__dash && window.__dash.setRailCount) window.__dash.setRailCount('risk', total || null);
  }

  /**
   * The SQLite JSON1 line.
   *
   * Silent when the functions are there, because a banner that is always on is a
   * banner nobody reads. When they are not, it has to be explicit about which
   * checks that costs, and the honest answer for THIS route is none of them:
   * every query in the scan is written to work without JSON1, including the
   * empty post check, which tests `images` as text rather than with
   * json_array_length for exactly this reason. What goes quiet is the tag
   * counting on other pages.
   *
   * A check added later that does need JSON1 sets `needsJson` on its finding,
   * and `buildCard` then renders it as could not run rather than as clear. That
   * mechanism is here rather than added later on purpose: the failure it guards
   * against is a check quietly reporting itself clean, which is the kind of bug
   * nobody goes looking for because the page looks fine.
   */
  function jsonNote(data) {
    if (data.json_ok !== false) return '';
    return `<div class="card">
      <div class="card-body">
        <div class="stack">
          <div><span class="chip chip-warn">a database feature is missing</span></div>
          <div class="dim">This SQLite build does not expose the JSON functions. Every check on this page is written to work without them, so nothing below is a false clear, and any check that did need them would say could not run instead of clear. What goes quiet is the tag counting on Pulse and on Tags and surfaces, which reads the tags column with json_each.</div>
        </div>
      </div>
    </div>`;
  }

  function paintPosture(data) {
    const host = $('[data-posture]', content);
    const wire = Array.isArray(data.posture) ? data.posture : [];

    if (!wire.length) {
      // A real empty state rather than a blank card. The route emits all seven
      // keys whether or not the settings rows exist, so nothing at all means the
      // settings read itself failed on the box.
      host.innerHTML = emptyState(
        'No posture came back',
        'The scan answers with every switch it knows about even when the settings rows are missing, so an empty strip means the settings read failed on the box. The PocketBase log says why'
      );
      return;
    }

    const ordered = [...wire].sort((a, b) => {
      const left = POSTURE_ORDER.indexOf(String(a.k || ''));
      const right = POSTURE_ORDER.indexOf(String(b.k || ''));
      // An unknown key sorts to the end rather than to the front, which is what
      // indexOf answering -1 would otherwise make it do.
      return (left === -1 ? 99 : left) - (right === -1 ? 99 : right);
    });

    /*
     * A table rather than a stack of `.setting` rows, which was the first shape
     * this had. `.setting` is a two column grid built for the Settings page,
     * where the right hand column holds an input and a Save button; here it
     * holds a chip and one word, so six tenths of the page was empty while the
     * sentence explaining the switch was wrapping inside a 260px column. Four
     * columns spend the width on the half that has something to say.
     *
     * The stored string is printed raw beside the state read out of it, and both
     * halves matter. The chip says what the box is doing; the mono value is the
     * only place a typo like "False" with a capital F is visible at all, and
     * that one reads as ON because the hook compares against the exact lowercase
     * word. A page that printed only its own interpretation would quietly
     * launder a broken value into a confident answer.
     */
    host.innerHTML = table(
      ['Key', 'State', 'Stored', 'What that means right now'],
      ordered.map((row) => {
        const state = readPosture(row);
        const chipClass = state.kind ? ` chip-${state.kind}` : '';
        const stored = state.absent
          ? '<span class="muted">no row</span>'
          : `<span class="mono">${esc(state.stored === '' ? 'empty' : state.stored)}</span>`;
        // Joined with a full stop rather than a space. These are two complete
        // sentences and running them together reads as one broken one, which is
        // exactly how it looked on screen the first time.
        const fallback = state.absent
          ? `. No settings row for this key, so the hook default is in force and the box acts on ${
              state.effective === '' ? 'an empty value' : state.effective
            }`
          : '';
        return [
          raw(`<span class="mono">${esc(state.key)}</span>`),
          raw(
            `<span class="chip${chipClass}">${esc(state.word)}</span>${
              state.absent ? ' <span class="chip">not set</span>' : ''
            }`
          ),
          raw(stored),
          `${state.note}${fallback}`,
        ];
      })
    );
  }

  function paintFindings(data) {
    const host = $('[data-findings]', content);
    host.innerHTML = '';

    // Every check absent at once is not fifteen broken queries, it is an older
    // build of the hook answering. Say that once, rather than printing fifteen
    // identical could not run cards that all mean the same thing.
    const anyPresent = FINDINGS.some((spec) => !collect(spec, data).missing);
    if (!anyPresent) {
      host.innerHTML = emptyState(
        'No checks came back',
        'The scan answers one array per check and none of them arrived. That is what an older build of the dash hook looks like, and restarting PocketBase after a deploy is what usually puts them back'
      );
      return;
    }

    for (const spec of FINDINGS) host.append(buildCard(spec, data));
  }

  /**
   * One finding card.
   *
   * Built as an element rather than as a string because Fix replaces exactly one
   * of them in place, and a card that knows how to rebuild itself from a fresh
   * payload is what makes that a two line operation rather than a diff.
   *
   * Three states, never two: found something, ran and found nothing, could not
   * run. The clear line is its own strip under the head rather than a body,
   * which is what collapses a passing check to one line without hiding the
   * check itself.
   */
  function buildCard(spec, data) {
    const found = collect(spec, data);
    const blocked = found.missing
      ? 'This check did not come back from the box. Each query in the scan is wrapped on its own, so an absent one failed there and the reason is in the PocketBase log'
      : spec.needsJson && data.json_ok === false
        ? 'This check needs the SQLite JSON functions and this build does not expose them, so it has no answer either way'
        : '';

    const active = !blocked && found.count > 0;
    const info = spec.level === 'info';
    // An informational card with a number in it is still not a finding, so it
    // shows its rows without wearing the warning edge or a warning chip.
    const shown = !blocked && (active || (info && found.rows.length > 0 && found.rows[0].n > 0));

    let word = 'clear';
    let kind = 'chip-good';
    if (blocked) {
      word = 'could not run';
      kind = 'chip-warn';
    } else if (info) {
      // A plain chip with no state class: this one is context, and colouring it
      // would put it in the same visual family as the checks that found a fault.
      word = shown ? 'for context' : 'clear';
      kind = shown ? '' : 'chip-good';
    } else if (active) {
      word = spec.level === 'critical' ? 'needs a fix' : 'worth a look';
      kind = spec.level === 'critical' ? 'chip-bad' : 'chip-warn';
    }

    const clearLine = typeof spec.clear === 'function' ? spec.clear(data) : spec.clear;
    const lead = blocked ? 'The scan could not answer this one' : shown ? spec.lead(found.rows, data) : clearLine;

    const pass = passes.get(spec.id) || null;
    // Open when there is something to read: rows, a reason it could not run, or
    // the note from a Fix press that has to be visible the moment the card comes
    // back rather than one click later.
    const open = shown || Boolean(blocked) || Boolean(pass);
    const rowsNote = shown ? capNote(found.rows) : '';

    const card = node(`<div class="finding${active && !info ? ' is-active' : ''}">
      <div class="finding-head">
        <div>
          <h3><span class="chip${kind ? ` ${esc(kind)}` : ''}">${esc(word)}</span> ${esc(spec.title)}</h3>
          <div class="sub">${esc(lead)}</div>
        </div>
        <span class="spacer"></span>
        ${
          spec.scope && shown
            ? `<button class="btn btn-sm" data-fix type="button">${
                pass && pass.remaining > 0 ? 'Run another pass' : 'Fix'
              }</button>`
            : ''
        }
        <button class="btn btn-sm" data-toggle type="button" aria-expanded="${open ? 'true' : 'false'}">${
          open ? 'Hide' : 'What this checks'
        }</button>
      </div>
      ${
        shown || blocked
          ? ''
          : `<div class="finding-clear"><span class="strong">Clear</span><span>${esc(clearLine)}</span></div>`
      }
      <div class="finding-body"${open ? '' : ' hidden'}>
        <div class="card-body">
          <div class="stack">
            ${pass ? passLine(pass) : ''}
            ${blocked ? `<div class="tiny"><span class="chip chip-warn">could not run</span> ${esc(blocked)}</div>` : ''}
            <div class="tiny muted"><span class="strong dim">What it means:</span> ${esc(spec.means)}</div>
            <div class="tiny muted"><span class="strong dim">What it does not mean:</span> ${esc(spec.notMeans)}</div>
            ${shown ? spec.body(found.rows, data) : ''}
            ${rowsNote ? `<div class="tiny muted">${esc(rowsNote)}</div>` : ''}
          </div>
        </div>
      </div>
    </div>`);

    const body = $('.finding-body', card);
    const toggle = $('[data-toggle]', card);
    toggle.addEventListener('click', () => {
      const opening = body.hidden;
      body.hidden = !opening;
      toggle.setAttribute('aria-expanded', opening ? 'true' : 'false');
      // A clear card offers to explain itself rather than to show rows it does
      // not have, so its closed label is different from an active card's.
      toggle.textContent = opening ? 'Hide' : shown || blocked ? 'Show' : 'What this checks';
    });

    const fix = $('[data-fix]', card);
    if (fix) fix.addEventListener('click', () => runFix(spec, found, card, fix));

    return card;
  }

  /** What the last Fix press did, in the words the operator needs next. */
  function passLine(pass) {
    if (pass.remaining > 0) {
      return `<div class="tiny"><span class="chip chip-warn">another pass needed</span> Rebuilt ${esc(
        n(pass.fixed)
      )} of them, and ${esc(n(pass.remaining))} rows still disagree. One press rewrites at most ${esc(
        n(RECOUNT_LIMIT)
      )} rows, which is what keeps the write lock short enough that nobody reading the feed notices</div>`;
    }
    return `<div class="tiny"><span class="chip chip-good">rebuilt</span> Rebuilt ${esc(
      n(pass.fixed)
    )} counters, and nothing in this check is drifting now</div>`;
  }

  /**
   * Rebuild one counter, then reload that one card.
   *
   * ## Why a repair asks first
   *
   * Fix writes to the database, and every write on this dashboard asks first and
   * names exactly what it will touch. This one is not destructive and the dialog
   * says so in as many words, because an operator who has been taught that every
   * confirm means danger will eventually click straight through the one that
   * does.
   *
   * ## Why the whole scan is refetched to reload one card
   *
   * There is no per check route: `risk` is one request that runs every query.
   * Refetching it is the only way to get honest rows for this card, and at this
   * size it is cheap. Only the one card is re-rendered from the answer, which is
   * what keeps the scroll position, the open state of the other cards and the
   * posture strip exactly where the operator left them. The badge is refreshed
   * from the same answer, because a Fix that cleared six findings must not leave
   * a rail still insisting on six.
   */
  async function runFix(spec, found, card, button) {
    // "1 rows disagree" is the kind of sentence that makes an operator wonder
    // what else on the page was not read before it shipped, so the count and the
    // verb agree here as they do in every lead line.
    const one = found.rows.length === 1;
    const known = found.rows.length >= LIST_CAP ? `At least ${n(LIST_CAP)}` : n(found.rows.length);
    /*
     * A plain question, not a column name.
     *
     * This dialog used to be headed `Rebuild posts.likes`, which made it the one
     * confirm on the dashboard titled with a schema identifier, and the heading
     * of a WRITE at that. An operator reads the heading of a confirm as the
     * question they are answering, and `posts.likes` is not a question: it names
     * a column in a table nobody outside this box has to know about. The
     * identifier has not been lost, it has moved one line down into the body,
     * where it is the first thing in bold and is surrounded by the sentence that
     * says what will be done to it.
     */
    const ok = await confirmAction({
      title: one ? 'Rebuild this counter?' : 'Rebuild these counters?',
      body:
        `<p>This rewrites <strong>${esc(spec.column)}</strong> from ${esc(spec.source)}, for up to ${esc(
          n(RECOUNT_LIMIT)
        )} rows that disagree with it.</p>` +
        '<ul>' +
        `<li>${esc(known)} ${one ? 'row disagrees' : 'rows disagree'} right now</li>` +
        '<li>Rows that already agree are not written, so nothing correct is restamped and the feed order does not move</li>' +
        '<li>No post, comment, account or project is created, hidden or deleted</li>' +
        '</ul>',
      confirmLabel: 'Rebuild counters',
    });
    if (!ok || !isLive()) return;

    button.disabled = true;
    card.classList.add('is-stale');

    let answer;
    try {
      answer = await pb.recount({ scope: spec.scope, limit: RECOUNT_LIMIT });
    } catch (err) {
      if (!isLive()) return;
      card.classList.remove('is-stale');
      button.disabled = false;
      toast(err.message || 'The rebuild did not run', 'bad');
      return;
    }

    if (!isLive()) return;

    const fixed = Number(answer && answer.fixed ? answer.fixed[spec.scope] : 0) || 0;
    const remaining = Number(answer && answer.remaining ? answer.remaining[spec.scope] : 0) || 0;
    passes.set(spec.id, { fixed, remaining });
    toast(
      remaining > 0
        ? `Rebuilt ${n(fixed)} counters, ${n(remaining)} rows still drift`
        : `Rebuilt ${n(fixed)} counters, nothing is drifting now`,
      remaining > 0 ? '' : 'good'
    );

    let data;
    try {
      data = await pb.risk();
    } catch (err) {
      if (!isLive()) return;
      card.classList.remove('is-stale');
      button.disabled = false;
      // The rebuild landed and only the reread failed, so this card is now
      // showing rows that have already been repaired. Say that, rather than
      // leaving it looking as though the Fix itself did not work.
      toast('The counters were rebuilt, but the rescan did not answer. Press Rescan', 'bad');
      return;
    }

    if (!isLive()) return;
    card.replaceWith(buildCard(spec, data));
    scanned.textContent = `scanned ${stamp(data.now)}`;
    const total = countFindings(data);
    if (window.__dash && window.__dash.setRailCount) window.__dash.setRailCount('risk', total || null);
  }

  rescan.addEventListener('click', () => load(true));

  await load(false);

  return () => {
    live.on = false;
    /*
     * The findings badge is deliberately NOT cleared here, and this is the third
     * view in this directory to say so: `feed.js` and `pulse.js` both carry the
     * same paragraph, because the three of them kept drifting apart on it.
     *
     * THE BUG THIS REPLACES. This cleanup used to call
     * `setRailCount('risk', null)`, on the theory that a count belongs to the
     * page that computed it. It does not. `app.js` fills the rail badges exactly
     * twice: once on boot and once per press of the Refresh button. So one visit
     * to Integrity was enough to delete the number for the rest of the session.
     * Measured on the fixture box: risk read 11 at boot, went blank the moment
     * the operator navigated away from Integrity, and stayed blank on every view
     * after that. The most expensive number on the rail, the one that costs
     * fifteen queries to recompute, was the one guaranteed to be missing.
     *
     * A badge is the box's claim about the box, not this view's claim about
     * itself. Leaving it up is also the honest reading: it was true when it was
     * measured, and the rail is what tells an operator there is something here
     * on a page that is not this one. A number that is a few minutes old is
     * worth vastly more than no number at all.
     *
     * Both of the places that DO write it stay: `load` pushes a fresh count
     * after every scan and `runFix` pushes one after a repair, so the badge
     * still follows the work while the page is open.
     */
  };
}

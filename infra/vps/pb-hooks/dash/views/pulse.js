/**
 * Pulse — the overview, and the page an operator leaves open all day.
 *
 * Everything on this page comes from exactly TWO aggregate requests plus one
 * liveness ping:
 *
 *   `/api/openscreengen/dash/stats`   the standing totals: posts, accounts,
 *                                     comments, engagement, projects, the
 *                                     surface split, the top tags, the top
 *                                     authors, the switch posture and the row
 *                                     count of every collection.
 *   `/api/openscreengen/dash/series`  one bucketed payload carrying eight
 *                                     arrays, which is what feeds BOTH the four
 *                                     charts and the six sparklines above them.
 *   `/api/health`                     PocketBase's own answer about itself, for
 *                                     the services panel.
 *
 * The single series call is the point, not an optimisation. A KPI tile with its
 * own request would be a seventh round trip describing a window nobody chose,
 * and the moment two tiles disagree with the chart under them the whole page
 * stops being trustworthy. One call, one set of buckets, one range control over
 * all of it: everything visible always describes the same slice.
 *
 * The record API is used for one thing only, and only in response to a live
 * event: resolving the display names of the authors behind the rows that land
 * on the wall. Realtime hands over a record, and a record carries the author's
 * ID and not their name.
 *
 * ## What this file is careful about
 *
 * 1. **The stats poll must not make the page blink.** This is the tab that
 *    stays open, so the sixty second refresh repaints in place and deliberately
 *    does NOT dim anything. `is-stale` is for a refetch the operator asked for,
 *    where the delay is theirs and the dimming explains it. A page that fades
 *    itself once a minute unprompted reads as broken.
 * 2. **A burst of creates is not a burst of requests.** Seeding a box, or one
 *    person hammering the post button, delivers dozens of realtime messages in
 *    a few hundred milliseconds. Every one of them would otherwise want a
 *    repaint, an author lookup and a fresh stats call. All three are debounced,
 *    and the stats refresh additionally has a floor under it so a busy hour
 *    cannot turn a one minute poll into a fifteen per minute poll.
 * 3. **Each half fails on its own.** Stats down does not blank the charts and
 *    series down does not blank the hero. Every section paints its own
 *    `errorState` with the real message in it, because "could not load" with no
 *    status code costs somebody a trip to the browser console to discover that
 *    a column got renamed.
 * 4. **Cleanup is total.** Two realtime subscriptions, one status listener, one
 *    interval and four timers, all released. The router calls the cleanup
 *    before it mounts the next view, and a subscription that outlives its page
 *    keeps writing rows into a DOM nobody can see.
 */

import * as pb from '../pb.js';
import { columnChart, lineChart, barList, donut, sparkline, fillBuckets } from '../charts.js';
import {
  esc,
  n,
  compact,
  bytes,
  node,
  chip,
  avatar,
  nameOf,
  handleOf,
  emptyState,
  errorState,
  skeleton,
  clock,
  stamp,
} from '../ui.js';

/**
 * The three windows, and the query each one sends.
 *
 * `unit` and `span` are NOT read from here when the buckets are filled: the
 * server clamps both (168 hours, 120 days) and answers with what it actually
 * used, so the response is the authority and these two fields exist only so a
 * label can be written before the first response lands. Filling buckets from
 * the request rather than the response is how a chart ends up drawing 30 days
 * of axis over 14 days of data.
 */
const RANGES = [
  { id: '24h', label: '24 hours', query: { hours: 24 } },
  { id: '7d', label: '7 days', query: { days: 7 } },
  { id: '30d', label: '30 days', query: { days: 30 } },
];

/**
 * How many live events the wall keeps.
 *
 * Sixty is roughly two screens of rows, which is as far back as anybody scrolls
 * on a wall whose whole proposition is "what just happened". The cap matters
 * more than the number: without one, a tab left open over a seeding run grows an
 * array and a table until the browser starts to labour, and the operator's first
 * symptom is a dashboard that feels slow rather than one that is full.
 */
const WALL_MAX = 60;

/**
 * A PocketBase record id, used to vet anything that is about to be pasted into
 * a filter string.
 *
 * The ids on the wall arrive over realtime, which means they are wire data, and
 * the author lookup below builds `id="..." || id="..."` by hand because the
 * record API has no other way to ask for a specific set of rows. A value that
 * is not exactly fifteen lowercase alphanumerics never reaches that string. The
 * route is superuser only and the filter language is not SQL, so this is not the
 * last line of defence, but a malformed id turning into a 400 that takes the
 * whole wall's names down with it is a bad enough outcome on its own.
 */
const ID_RE = /^[a-z0-9]{15}$/;

/**
 * The seven loud settings, in the order the services panel reads best, with
 * what each one means when it is not in its usual position.
 *
 * `stats.switches` hands back the RAW stored string, unparsed, so a value of
 * `"ture"` stays visible as `ture` rather than being quietly folded into false.
 * That is deliberate on the server and this panel keeps the bargain: a value
 * that is neither `true` nor `false` gets no colour at all and says plainly that
 * the box will fall back to its built in default, which is the only honest
 * reading of a typo in a settings row.
 *
 * `on` and `off` are the chip kinds, and they are NOT symmetric. `enabled`
 * being false closes every community route on the box, which is serious.
 * `github_allow_pat` being TRUE is the loose one, because it lets a pasted
 * personal access token stand in for an OAuth round trip. Colouring both by the
 * literal boolean would say the opposite of what an operator needs to see.
 *
 * `whenOn` and `whenOff` are two sentences rather than one for the same reason.
 * A single note has to be written about one of the two positions, and the first
 * version of this panel wrote them all about the OFF position, so a healthy box
 * read `Community API [true] off closes every community route on this box`.
 * That is a true sentence sitting under a chip that says the opposite, and at a
 * glance it is an outage notice. Say what IS, and let the other state be found
 * by flipping the switch on the Settings page. `about` is the neutral form, for
 * the three cases where there is no position to describe: a missing row, a value
 * that is neither true nor false, and the one setting here that holds text.
 */
const SWITCHES = [
  {
    k: 'enabled',
    label: 'Community API',
    on: 'good',
    off: 'bad',
    whenOn: 'every community route on this box is answering',
    whenOff: 'every community route is closed, and the app sees the community as turned off',
    about: 'the master switch over every community route on this box',
  },
  {
    k: 'writes_enabled',
    label: 'Writes',
    on: 'good',
    off: 'warn',
    whenOn: 'posts, comments, likes and follows are all being accepted',
    whenOff: 'the feed stays readable and nothing new can land on it',
    about: 'whether anything new may be written to the community',
  },
  {
    k: 'signin_enabled',
    label: 'Sign in',
    on: 'good',
    off: 'warn',
    whenOn: 'a new session can be started with Google or GitHub',
    whenOff: 'no new session can be started, tokens already issued keep working',
    about: 'whether a new session may be started at all',
  },
  {
    k: 'cloud_projects_enabled',
    label: 'Cloud projects',
    on: 'good',
    off: 'warn',
    whenOn: 'projects can be saved to and loaded from this box',
    whenOff: 'saving and loading are both refused, nothing already stored is removed',
    about: 'whether the editor may use this box as its project storage',
  },
  {
    k: 'github_allow_pat',
    label: 'GitHub personal tokens',
    on: 'warn',
    off: 'good',
    whenOn: 'a pasted personal access token signs somebody in with no OAuth round trip',
    whenOff: 'GitHub sign in has to go through OAuth, which is the tighter of the two',
    about: 'whether a pasted GitHub token counts as a sign in',
  },
  {
    k: 'avatar_fetch_enabled',
    label: 'Avatar fetch',
    on: 'good',
    off: '',
    whenOn: 'a new account keeps the picture its provider handed over',
    whenOff: 'a new account keeps its initials instead of the provider picture',
    about: 'whether the provider picture is fetched at sign in',
  },
  {
    k: 'moderation_note',
    label: 'Moderation note',
    text: true,
    about: 'shown to somebody whose post was hidden',
  },
];

export async function render(root) {
  /*
   * Everything mutable for the life of this mount lives here rather than at
   * module scope. The router can mount Pulse, leave it and mount it again, and
   * module scope state would carry one visit's wall into the next one.
   */
  let range = RANGES[0];
  let stats = null;
  let statsError = null;
  let buckets = null;
  let health = null;

  /*
   * The guard every async continuation checks before it touches the DOM.
   *
   * `render` starts several requests and a couple of debounced timers, and the
   * router is free to unmount this view while any of them are in flight. A
   * `.then` that lands afterwards would paint into detached nodes, which is
   * harmless, and would also re-arm the timers it schedules, which is not: that
   * is a view that keeps polling forever after it has been navigated away from.
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


  // The wall's state. `wall` is newest first. `flashed` remembers which rows
  // have already had their arrival animation so a repaint triggered by
  // something else (a name resolving, say) does not flash the whole table
  // again, which reads as a dozen fresh events that did not happen.
  const wall = [];
  const flashed = new Set();

  // Author id to user record, for the wall. `null` means a lookup has been
  // claimed for that id and is either out or came back without it.
  const people = new Map();
  const wanted = new Set();

  // Everything the cleanup has to release.
  const offs = [];
  let wallTimer = null;
  let peopleTimer = null;
  let statsTimer = null;
  let statsTick = null;
  let lastStatsAt = 0;

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Pulse</h2>
        <div class="sub">What the community looks like right now, and the shape of the window behind it</div>
      </div>
      <div class="page-tools">
        <span class="chip" id="pulse-live-chip" hidden></span>
        <span class="muted tiny" id="pulse-asof"></span>
      </div>
    </div>

    <div id="pulse-hero"></div>

    <div class="section-title">Trend</div>
    <div class="filter-row">
      <div class="segmented" id="pulse-range" role="group" aria-label="Time range">
        ${RANGES.map(
          (r) =>
            `<button type="button" data-range="${esc(r.id)}" aria-pressed="${r.id === range.id}">${esc(r.label)}</button>`
        ).join('')}
      </div>
      <span class="muted tiny" id="pulse-range-note">Buckets are UTC, and the tiles and the charts describe the same window</span>
    </div>
    <div class="stack">
      <div id="pulse-kpis"></div>
      <div id="pulse-charts"></div>
    </div>

    <div class="section-title">What people are making</div>
    <div class="grid grid-2">
      <div class="card">
        <div class="card-head">
          <div>
            <h3>Surface split</h3>
            <div class="sub">every post ever, by the canvas it was made for</div>
          </div>
        </div>
        <div class="card-body" id="pulse-surface"></div>
      </div>
      <div class="card">
        <div class="card-head">
          <div>
            <h3>Top tags</h3>
            <div class="sub">the tags on every post published in the last 30 days, hidden ones included</div>
          </div>
        </div>
        <div class="card-body" id="pulse-tags"></div>
      </div>
    </div>

    <div class="section-title">Who is making it</div>
    <div class="card">
      <div class="card-head">
        <div>
          <h3>Top authors</h3>
          <div class="sub">by posts published in the last 30 days, with the likes and views those posts have collected since</div>
        </div>
      </div>
      <div class="card-body" id="pulse-authors"></div>
    </div>

    <div class="section-title">Services</div>
    <div class="grid grid-2">
      <div class="card">
        <div class="card-head">
          <div>
            <h3>PocketBase and posture</h3>
            <div class="sub">what the box says about itself, and the switches that decide what it will answer</div>
          </div>
        </div>
        <div class="card-body" id="pulse-services"></div>
      </div>
      <div class="card">
        <div class="card-head">
          <div>
            <h3>Rows on disk</h3>
            <div class="sub">every collection, counted in SQL rather than listed and measured in the browser</div>
          </div>
        </div>
        <div class="card-body" id="pulse-tables"></div>
      </div>
    </div>

    <div class="section-title">Arriving now</div>
    <div class="card">
      <div class="card-head">
        <div>
          <h3>Live wall</h3>
          <div class="sub">posts and comments as they are written, newest first, the last ${n(WALL_MAX)} kept</div>
        </div>
        <span class="spacer"></span>
        <span class="muted tiny" id="pulse-wall-count"></span>
      </div>
      <div class="card-body" id="pulse-wall"></div>
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
  const heroHost = root.querySelector('#pulse-hero');
  const kpiHost = root.querySelector('#pulse-kpis');
  const chartHost = root.querySelector('#pulse-charts');
  const surfaceHost = root.querySelector('#pulse-surface');
  const tagsHost = root.querySelector('#pulse-tags');
  const authorsHost = root.querySelector('#pulse-authors');
  const servicesHost = root.querySelector('#pulse-services');
  const tablesHost = root.querySelector('#pulse-tables');
  const wallHost = root.querySelector('#pulse-wall');
  const asOf = root.querySelector('#pulse-asof');
  const liveChip = root.querySelector('#pulse-live-chip');
  const wallCount = root.querySelector('#pulse-wall-count');
  const rangeNote = root.querySelector('#pulse-range-note');

  /* --------------------------------------------------- charts and a screen reader --- */

  /**
   * Keep every plotted SVG out of the accessibility tree, for as long as this
   * view is on screen.
   *
   * THE BUG. `charts.js` marks the KPI sparklines `aria-hidden` and gets that
   * exactly right, but the four trend plots and the surface donut were left in
   * the tree. An SVG full of `<text class="chart-axis">` ticks is not read as a
   * chart by anything: it is read as loose static text, so this page handed a
   * screen reader user roughly ninety-six bare numbers with no labels, no units
   * and no order that means anything. Counted on the fixture box by walking the
   * page with the accessibility tree open.
   *
   * WHY A MutationObserver AND NOT ONE PASS. `charts.js` redraws the plot at the
   * container's real pixel width, through a `ResizeObserver` that fires once on
   * observe and again on every resize, and each redraw is an `innerHTML =` that
   * replaces the whole SVG. An `aria-hidden` stamped once would survive until
   * the first time somebody opened the rail drawer or turned their laptop, which
   * is the worst kind of accessibility fix: the one that tests clean.
   *
   * WHAT IS DELIBERATELY NOT HIDDEN. Only `svg` elements, and only inside the
   * two chart hosts. Every number in these panels also exists as real text
   * somewhere outside the picture: the donut's legend prints each label, value
   * and share, and every chart carries a Table view button that expands a real
   * `table.data` of the same series. So this hides the drawing and leaves the
   * data, which is the whole point.
   *
   * `charts.js` belongs to another file and could carry this itself, which would
   * be the better home for it. Until it does, this is the call site's share of
   * the job and it is written so that it costs nothing if that ever lands: an
   * `svg` that already says `aria-hidden` is skipped.
   */
  const plotWatchers = [];
  function hidePlots(host) {
    const stamp = () => {
      // Setting an attribute inside the observed subtree cannot re-trigger a
      // childList observer, so there is no loop here to guard against.
      host.querySelectorAll('svg:not([aria-hidden])').forEach((svg) => {
        svg.setAttribute('aria-hidden', 'true');
        // Old Edge and IE put SVG roots in the tab order. Harmless to say, and
        // it stops a hidden element from being focusable, which is the one
        // combination that genuinely confuses a screen reader.
        svg.setAttribute('focusable', 'false');
      });
    };
    stamp();
    if (typeof MutationObserver !== 'function') return;
    const observer = new MutationObserver(stamp);
    observer.observe(host, { childList: true, subtree: true });
    plotWatchers.push(() => observer.disconnect());
  }

  /**
   * Give a plot a name, and say where the numbers are.
   *
   * A chart with no accessible name is announced as nothing at all once its SVG
   * is hidden, which would trade ninety-six loose numbers for six silent boxes.
   * The card's own `h3` and `sub` are the right words for it, so they are reused
   * rather than a second description being invented that would drift from the
   * one on screen.
   *
   * `role="group"` and not `role="img"`: an `img` makes its children
   * presentational, and the children here include the Table view button, which
   * is the one control on the card that a screen reader user actually needs.
   */
  function nameChart(chart, title, sub) {
    if (!chart) return;
    chart.setAttribute('role', 'group');
    chart.setAttribute('aria-label', `${title} chart, ${sub}. Table view below it lists every value`);
  }

  hidePlots(chartHost);
  hidePlots(surfaceHost);

  /*
   * The loading shape, painted before anything is asked for.
   *
   * Every host below gets the skeleton whose geometry matches what will replace
   * it, so the page does not jump when the two requests land a few hundred
   * milliseconds apart. The two grid hosts have their grid classes REMOVED
   * while they hold a skeleton: `.skel-tiles` and `.skel-cards` carry their own
   * copies of `.grid-kpi` and `.grid-cards`' templates, so leaving the grid
   * class on the host would make the whole skeleton one column of the outer
   * grid rather than a grid of its own.
   */
  heroHost.innerHTML = `<div class="card"><div class="card-body">${skeleton('tiles', 3)}</div></div>`;
  kpiHost.className = '';
  kpiHost.innerHTML = skeleton('tiles', 6);
  chartHost.className = '';
  chartHost.innerHTML = skeleton('cards', 4);
  surfaceHost.innerHTML = skeleton('rows', 4);
  tagsHost.innerHTML = skeleton('rows', 6);
  authorsHost.innerHTML = skeleton('rows', 6);
  servicesHost.innerHTML = skeleton('rows', 5);
  tablesHost.innerHTML = skeleton('rows', 6);
  wallHost.innerHTML = emptyState(
    'Listening',
    'Nothing has been posted or commented since this page opened. A new post or comment on the live box appears here within a second of being written'
  );

  // ------------------------------------------------------------ the hero ---

  /**
   * The headline, and the standing totals beside it.
   *
   * The hero figure is `posts.visible` rather than `posts.total`, because the
   * question this page opens with is what a visitor can actually find. A hidden
   * post still exists, still has its likes, and still counts in the surface
   * split below, and none of that puts it in the feed.
   *
   * The sentence under it says what the numbers MEAN rather than reading them
   * back. `silent` is the one worth leading with: a visible post with neither a
   * like nor a comment is somebody who posted into a room that did not answer,
   * and it is the only figure here that says whether the feed is working for
   * the people filling it.
   */
  function paintHero() {
    if (!stats) return;
    const posts = stats.posts || {};
    const accounts = stats.accounts || {};
    const projects = stats.projects || {};
    const comments = stats.comments || {};

    heroHost.innerHTML = `
      <div class="card"><div class="card-body">
        <div class="hero">
          <div>
            <div class="kpi-label">Posts in the feed</div>
            <div class="hero-figure">${esc(n(posts.visible))}</div>
          </div>
          <div class="hero-note">
            ${esc(n(posts.hidden))} more are hidden and never reach it, and ${esc(n(posts.featured))} are featured.
            ${esc(n(posts.silent))} of the visible ones have collected neither a like nor a comment,
            which is the number that says whether the feed is answering the people posting to it.
          </div>
          <div>
            <div class="kpi-label">Accounts</div>
            <div class="kpi-value">${esc(compact(accounts.total))}</div>
            <div class="kpi-meta">${esc(
              `${n(accounts.banned)} banned, ${n(accounts.verified)} with a badge`
            )}</div>
          </div>
          <div>
            <div class="kpi-label">Cloud projects</div>
            <div class="kpi-value">${esc(compact(projects.total))}</div>
            <div class="kpi-meta">${esc(
              `${n(projects.shared)} shared by link, ${bytes(
                Number(projects.doc_bytes || 0) + Number(projects.asset_bytes || 0)
              )} stored`
            )}</div>
          </div>
          <div>
            <div class="kpi-label">Comments</div>
            <div class="kpi-value">${esc(compact(comments.total))}</div>
            <div class="kpi-meta">${esc(`${n(comments.hidden)} hidden, ${n(comments.today)} today`)}</div>
          </div>
        </div>
      </div></div>`;
  }

  // ------------------------------------------------------- the KPI tiles ---

  /**
   * Six tiles, every one of them a SUM over the buckets the charts are drawn
   * from, and every one of them scoped by the range control above.
   *
   * Only summable series get a tile. The series payload also carries `authors`,
   * which is `COUNT(DISTINCT author)` per bucket, and adding those up would
   * count somebody who posted on Monday and again on Thursday twice. There is
   * no honest total to take from it, so it is left to the Growth page, where it
   * is charted as the shape it actually is.
   *
   * The meta line pairs the window figure with two standing ones from `stats`,
   * today and the all time total, and it does NOT repeat the window name. It
   * used to: every tile read "in 30 days. 754.1 KB written, 16 saved in all",
   * which is six copies of a fact the segmented control above already states,
   * and on the widest tile it was long enough to be clipped mid-word by
   * `.kpi`'s own `overflow: hidden`. The window is named once, in the line
   * beside the range control, which is where a reader looks for it anyway.
   */
  function paintKpis() {
    // Both halves have to have landed. Either one alone would draw a tile with
    // a number in it and no shape, or a shape with no number, and both look
    // like a value of zero rather than like a request that has not answered.
    if (!buckets || !stats) return;

    const sum = (rows, key = 'value') => rows.reduce((carry, row) => carry + (Number(row[key]) || 0), 0);
    const posts = stats.posts || {};
    const accounts = stats.accounts || {};
    const comments = stats.comments || {};
    const engagement = stats.engagement || {};
    const projects = stats.projects || {};

    const tiles = [
      {
        label: 'Posts published',
        value: sum(buckets.posts),
        note: `${n(posts.today)} today, ${n(posts.total)} in all`,
        spark: buckets.posts,
        color: 'var(--series-1)',
      },
      {
        label: 'New accounts',
        value: sum(buckets.signups),
        note: `${n(accounts.new_today)} today, ${n(accounts.total)} in all`,
        spark: buckets.signups,
        color: 'var(--series-2)',
      },
      {
        label: 'Likes given',
        value: sum(buckets.likes),
        note: `${n(engagement.likes_today)} today, ${n(engagement.likes)} in all`,
        spark: buckets.likes,
        color: 'var(--series-3)',
      },
      {
        label: 'Comments written',
        value: sum(buckets.comments),
        note: `${n(comments.today)} today, ${n(comments.total)} in all`,
        spark: buckets.comments,
        color: 'var(--series-4)',
      },
      {
        label: 'Follows made',
        value: sum(buckets.follows),
        note: `${n(engagement.follows_today)} today, ${n(engagement.follows)} in all`,
        spark: buckets.follows,
        color: 'var(--series-2)',
      },
      {
        label: 'Cloud projects saved',
        // `projects` is the one series with a second column: `bytes` is the sum
        // of `doc_bytes + asset_bytes` for the projects created in that bucket,
        // which is the only place on this page that says how fast the disk is
        // filling rather than how full it already is.
        value: sum(buckets.projects),
        note: `${bytes(sum(buckets.projects, 'bytes'))} written, ${n(projects.total)} in all`,
        spark: buckets.projects,
        color: 'var(--series-1)',
      },
    ];

    kpiHost.className = 'grid grid-kpi';
    kpiHost.innerHTML = tiles
      .map((tile) => {
        const spark = sparkline(tile.spark, { color: tile.color });
        return `<div class="kpi${spark ? ' has-spark' : ''}">
          <div class="kpi-label">${esc(tile.label)}</div>
          <div class="kpi-value">${esc(compact(tile.value))}</div>
          <div class="kpi-meta">${esc(tile.note)}</div>
          ${spark}
        </div>`;
      })
      .join('');
  }

  // ---------------------------------------------------------- the charts ---

  /** A chart in a card, with the sentence that says what it counts. */
  function chartCard(title, sub, chart) {
    const card = node(`<div class="card">
      <div class="card-head"><div><h3>${esc(title)}</h3><div class="sub">${esc(sub)}</div></div></div>
      <div class="card-body"></div>
    </div>`);
    nameChart(chart, title, sub);
    card.querySelector('.card-body').append(chart);
    return card;
  }

  /**
   * The four charts, from the one series payload.
   *
   * `fillBuckets` is what turns the server's sparse answer into a dense one.
   * The route returns a row only for a bucket that HAS rows, which is the right
   * thing for it to do and completely wrong to plot: a chart that quietly omits
   * the quiet hours squeezes the busy ones together and misstates the shape of
   * the week. The `unit`, `span` and `now` all come off the RESPONSE rather than
   * off `range`, because the server clamps both windows and is the only party
   * that knows what it actually used.
   */
  function paintCharts(data) {
    const shape = { unit: data.unit, span: data.span, now: data.now };
    const unit = data.unit === 'hour' ? 'hour' : 'day';

    /*
     * The one place the window is named, and it is named from the RESPONSE.
     * The route clamps `hours` to 168 and `days` to 120, so a button labelled
     * "30 days" is a request and not a promise, and writing this line from
     * `range.label` would state a span the data underneath it might not cover.
     */
    rangeNote.textContent = `Buckets are UTC. The tiles and the charts both count the last ${n(data.span)} ${
      unit === 'hour' ? 'hours' : 'days'
    }`;

    buckets = {
      posts: fillBuckets(data.posts, shape),
      signups: fillBuckets(data.signups, shape),
      comments: fillBuckets(data.comments, shape),
      likes: fillBuckets(data.likes, shape),
      saves: fillBuckets(data.saves, shape),
      follows: fillBuckets(data.follows, shape),
      authors: fillBuckets(data.authors, shape),
      // Two columns out of one array. `value` stays the row count so the chart
      // and the sparkline plot projects, and `bytes` rides along for the tile.
      projects: fillBuckets(data.projects, { ...shape, keys: ['n', 'bytes'] }),
    };

    chartHost.className = 'grid grid-charts';
    chartHost.replaceChildren(
      chartCard(
        'Posts published',
        `one column per ${unit}, counted from the row's created stamp, hidden posts included`,
        columnChart({ data: buckets.posts, title: 'Posts published', unit: 'posts' })
      ),
      chartCard(
        'New accounts',
        `one column per ${unit}, counted from the account's created stamp, which is its first sign in`,
        columnChart({ data: buckets.signups, color: 'var(--series-2)', title: 'New accounts', unit: 'accounts' })
      ),
      chartCard(
        'Engagement',
        'likes, saves and comments on one scale, so the three can be read against each other rather than against three different axes',
        lineChart({
          series: [
            { key: 'likes', label: 'Likes', data: buckets.likes },
            { key: 'saves', label: 'Saves', data: buckets.saves },
            { key: 'comments', label: 'Comments', data: buckets.comments },
          ],
          title: 'Engagement',
          unit: 'events',
        })
      ),
      chartCard(
        'Cloud projects saved',
        `one column per ${unit}, counted when the project row was first written and not when it was last edited`,
        columnChart({
          data: buckets.projects,
          color: 'var(--series-4)',
          title: 'Cloud projects saved',
          unit: 'projects',
        })
      )
    );

    paintKpis();
  }

  // ---------------------------------------------- surface, tags, authors ---

  /** The surface split, as a donut over every post the box holds. */
  function paintSurface() {
    if (!stats) return;
    const rows = (stats.posts && stats.posts.by_surface) || [];
    if (!rows.length) {
      surfaceHost.innerHTML = emptyState(
        'No posts yet',
        'The first post published on this box puts its surface here, and a post saved without one is counted as unknown'
      );
      return;
    }
    // `total` is passed so the ring can show a residual if the enum ever grows
    // a value the group-by missed. It sums to `posts.total` today, and a donut
    // handed a total SMALLER than its rows ignores it, so there is no way for
    // this to draw a ring that overflows itself.
    const ring = donut({ rows, total: stats.posts.total });
    // The card head above this host carries the same two lines, and the donut
    // is the only thing in the host, so it is named from them for the same
    // reason the four trend charts are.
    nameChart(ring, 'Surface split', 'every post ever, by the canvas it was made for');
    surfaceHost.replaceChildren(ring);
  }

  /**
   * Top tags, and the one case that must never be reported as an empty list.
   *
   * `posts.tags` is a JSON column and the route reads it with `json_each`, which
   * needs SQLite's JSON1 extension. The route probes for it and answers
   * `json_ok: false` with an empty `top_tags` when it is missing. Rendering that
   * as "no tags" would be a confident wrong answer about a box that may well be
   * covered in them, so the two cases get two different panels.
   */
  function paintTags() {
    if (!stats) return;
    if (stats.json_ok === false) {
      tagsHost.innerHTML =
        `<div class="chip-row">${chip('could not run', 'warn')}</div>` +
        emptyState(
          'Tags could not be counted',
          'Tags live in a JSON column and this box answered without the JSON1 extension, so the count did not run. This is not a claim that there are no tags'
        );
      return;
    }
    const rows = stats.top_tags || [];
    if (!rows.length) {
      tagsHost.innerHTML = emptyState(
        'No tags in the last 30 days',
        'A post published in the last 30 days with at least one tag on it puts that tag here'
      );
      return;
    }
    tagsHost.replaceChildren(barList(rows, { color: 'var(--series-3)' }));
  }

  /**
   * The top authors table.
   *
   * The name cell is a real anchor rather than a click handler on the row, so
   * the table is walkable with Tab and openable with Enter without this file
   * reimplementing what a link already does. The row keeps `clickable` and a
   * click handler on top of that purely for the mouse, and it defers to the
   * anchor when the anchor is what was clicked so a middle click still opens a
   * tab instead of being swallowed.
   */
  function paintAuthors() {
    if (!stats) return;
    const rows = stats.top_authors || [];
    if (!rows.length) {
      authorsHost.innerHTML = emptyState(
        'Nobody has posted in the last 30 days',
        'A post published in the last 30 days puts its author in this table'
      );
      return;
    }

    authorsHost.innerHTML = `<div class="table-wrap"><table class="data">
      <thead><tr>
        <th>Author</th>
        <th class="num">Posts</th>
        <th class="num">Likes</th>
        <th class="num">Views</th>
      </tr></thead>
      <tbody>${rows
        .map((row) => {
          // The route names the columns `u`, `name` and `handle`, so a shape the
          // shared helpers understand has to be assembled here. `avatar` and
          // `nameOf` both tolerate a partial user, which is what this is.
          const user = { id: row.u, name: row.name, handle: row.handle };
          const at = handleOf(user);
          return `<tr class="clickable" data-account="${esc(row.u)}">
            <td>
              <div class="identity">
                ${avatar(user, 'sm', pb.auth.url)}
                <a class="truncate" href="#/account/${esc(row.u)}">${esc(nameOf(user))}</a>
                ${at ? `<span class="dim nowrap">${esc(at)}</span>` : ''}
              </div>
            </td>
            <td class="num">${esc(n(row.posts))}</td>
            <td class="num">${esc(n(row.likes))}</td>
            <td class="num">${esc(n(row.views))}</td>
          </tr>`;
        })
        .join('')}</tbody>
    </table></div>`;
  }

  // -------------------------------------------------- services and rows ---

  /**
   * PocketBase's own answer, the realtime stream's state, and the seven loud
   * settings, in one definition list.
   *
   * The switch rows print the RAW string. A value that is neither `true` nor
   * `false` gets a plain chip and a sentence saying the box will use its default,
   * because that is what `lib/openscreengen.js` actually does with an
   * unparseable settings row, and a warning coloured like a failure would send
   * somebody looking for an outage that is not there.
   */
  function paintServices() {
    /*
     * `onStatus` fires its handler SYNCHRONOUSLY on subscribe, which happens
     * before either request has answered. Painting then would replace the
     * skeleton with a panel holding one row about the stream and nothing else,
     * which is a flash of almost-empty content in the exact box that is about
     * to fill. Hold the skeleton until there is something to say.
     */
    if (health === null && !stats) return;

    const rows = [];

    if (health === null) {
      rows.push(['PocketBase', chip('not asked yet', ''), 'the liveness endpoint has not answered yet']);
    } else if (health instanceof Error) {
      rows.push([
        'PocketBase',
        chip('did not answer', 'bad'),
        health.message || 'the liveness endpoint could not be reached',
      ]);
    } else {
      const data = health.data || {};
      const ok = Number(health.code) === 200;
      rows.push([
        'PocketBase',
        chip(ok ? 'answering' : `code ${health.code}`, ok ? 'good' : 'warn'),
        health.message || '',
      ]);
      rows.push([
        'Backups',
        chip(data.canBackup ? 'possible' : 'blocked', data.canBackup ? 'good' : 'warn'),
        data.canBackup
          ? 'the data directory is writable, so a backup can be taken'
          : 'PocketBase says it cannot write a backup right now, which is usually a full or read only disk',
      ]);
      if (data.possibleProxyHeader) {
        rows.push([
          'Proxy header',
          chip(String(data.possibleProxyHeader), 'warn'),
          'PocketBase sees a forwarding header it is not configured to trust, so the client IP it records may be the proxy and not the visitor',
        ]);
      }
    }

    // The stream's state is read from the pill's own source of truth rather than
    // kept a second time here, so the two can never disagree.
    const state = pb.realtime.status;
    rows.push([
      'Realtime',
      chip(
        state === 'live' ? 'connected' : state === 'connecting' ? 'connecting' : state === 'down' ? 'dropped' : 'idle',
        state === 'live' ? 'good' : state === 'down' ? 'bad' : ''
      ),
      state === 'live'
        ? 'the live wall below is being fed by this stream'
        : 'the wall stops filling while this is not connected, and it reconnects on its own',
    ]);

    /*
     * The posture comes off the stats route, so when that route is down these
     * seven rows have nothing behind them. They used to just not be there, and
     * a panel that silently drops two thirds of itself reads as a box with no
     * switches rather than as a reading that could not be taken. Say which it is.
     */
    if (statsError) {
      rows.push([
        'Switch posture',
        chip('not read', 'warn'),
        'the stats route did not answer, so the seven loud settings could not be read here. The Settings page reads them straight off the collection',
      ]);
    }

    const switches = new Map(((stats && stats.switches) || []).map((row) => [row.k, row]));
    for (const spec of SWITCHES) {
      const row = switches.get(spec.k);
      if (!row) continue;
      const value = String(row.v === undefined || row.v === null ? '' : row.v);

      if (row.absent) {
        // The route flags a setting whose row is missing. That is a safe state
        // on this box, since the hooks fall back to `DEFAULTS`, but it is worth
        // saying out loud: the value on screen is not stored anywhere.
        rows.push([spec.label, chip('not set', 'warn'), `${spec.about}. No row is stored, so the built in default applies`]);
        continue;
      }

      if (spec.text) {
        rows.push([spec.label, `<span class="mono">${esc(value || 'empty')}</span>`, spec.about]);
        continue;
      }

      if (value === 'true' || value === 'false') {
        const on = value === 'true';
        rows.push([spec.label, chip(value, on ? spec.on : spec.off), on ? spec.whenOn : spec.whenOff]);
        continue;
      }

      rows.push([
        spec.label,
        chip(value || 'empty', ''),
        `${spec.about}. That value is neither true nor false, so the box reads it as its built in default`,
      ]);
    }

    servicesHost.innerHTML = `<dl class="kv">${rows
      .map(
        ([label, value, note]) =>
          `<dt>${esc(label)}</dt><dd>${value}${note ? `<div class="muted tiny">${esc(note)}</div>` : ''}</dd>`
      )
      .join('')}</dl>`;
  }

  /**
   * Row counts, as a bar list.
   *
   * A bar list rather than a table on purpose: the interesting fact about these
   * numbers is the ratio between them, and `post_likes` running away from
   * `posts` is a picture rather than a reading. The exact figure is on every
   * row anyway, so nothing is hidden behind the bar.
   */
  function paintTables() {
    if (!stats) return;
    const rows = stats.tables || [];
    if (!rows.length) {
      tablesHost.innerHTML = emptyState(
        'No collections were counted',
        'The stats route counts every collection in one query, so an empty list here means that query did not run'
      );
      return;
    }
    const total = rows.reduce((carry, row) => carry + (Number(row.n) || 0), 0);
    tablesHost.replaceChildren(
      barList(rows, { color: 'var(--series-2)' }),
      node(
        `<p class="muted tiny">${esc(
          `${n(total)} rows across ${n(rows.length)} collections. Join tables grow with every like, save and follow, and they are the ones worth watching`
        )}</p>`
      )
    );
  }

  // -------------------------------------------------------- the live wall ---

  /**
   * The author of a wall row, once it is known.
   *
   * Realtime hands over the raw record, and the record carries `author` as an
   * id. Until the lookup lands the row shows the id in a code tag, which is
   * deliberately not a blank: a name that is on its way and a row with no author
   * at all have to look different, because the second one means the account was
   * deleted between the write and the lookup and that is worth noticing.
   */
  function personCell(id) {
    const user = people.get(id);
    if (!user) {
      return `<span class="code-tag">${esc(id || 'unknown')}</span>`;
    }
    const at = handleOf(user);
    return `<div class="identity">
      ${avatar(user, 'sm', pb.auth.url)}
      <a class="truncate" href="#/account/${esc(user.id)}">${esc(nameOf(user))}</a>
      ${at ? `<span class="dim nowrap">${esc(at)}</span>` : ''}
    </div>`;
  }

  /**
   * Ask for an author's name, later and in company.
   *
   * Every unknown id is collected into a set and one list call resolves up to
   * forty of them at a time, half a second after the last one was noticed. A
   * seeding run that delivers thirty posts in one tick therefore costs ONE
   * request rather than thirty, which is the whole reason this is not a
   * `pb.one` in the paint loop.
   *
   * The ids are claimed (written into `people` as null) BEFORE the request goes
   * out, so a second event from the same author while the first lookup is in
   * flight does not queue a duplicate.
   */
  function wantPerson(id) {
    if (!ID_RE.test(String(id || '')) || people.has(id)) return;
    wanted.add(id);
    schedulePeople();
  }

  function schedulePeople() {
    if (peopleTimer || !wanted.size) return;
    peopleTimer = setTimeout(() => {
      peopleTimer = null;
      if (!isLive()) return;
      const ids = [...wanted].slice(0, 40);
      if (!ids.length) return;
      for (const id of ids) {
        wanted.delete(id);
        people.set(id, null);
      }
      pb.list('users', {
        perPage: ids.length,
        skipTotal: true,
        // Safe to build by hand: every id in here has been through `ID_RE`, so
        // there is no quote to escape and nothing that could close the string.
        filter: ids.map((id) => `id="${id}"`).join(' || '),
        fields: 'id,name,display_name,handle,avatar',
      })
        .then((page) => {
          if (!isLive()) return;
          for (const user of page.items || []) people.set(user.id, user);
          paintWall();
        })
        .catch(() => {
          // Left claimed as null on purpose. A lookup that failed once will
          // fail again for the same reason, and retrying it on every repaint
          // would turn one bad request into a loop of them. The rows keep their
          // id, which is still enough to open the account from the Accounts page.
        })
        .finally(() => {
          // Anything that did not fit in this batch goes out in the next one.
          if (isLive()) schedulePeople();
        });
    }, 500);
  }

  /**
   * Paint the wall.
   *
   * `is-new` is applied only to rows that have not been flashed before. The
   * table is rebuilt from scratch on every paint, and a CSS animation restarts
   * whenever its element is replaced, so marking "the first row" the way the
   * obvious version does would re-run the arrival flash every time a name
   * resolved. An operator glancing over would read that as a fresh event.
   */
  function paintWall() {
    if (!wall.length) {
      wallHost.innerHTML = emptyState(
        'Listening',
        'Nothing has been posted or commented since this page opened. A new post or comment on the live box appears here within a second of being written'
      );
      wallCount.textContent = '';
      return;
    }

    const rowsHtml = wall
      .map((item) => {
        const fresh = !flashed.has(item.key);
        const kind =
          item.kind === 'post'
            ? `<span class="surface-chip">post</span>${
                item.surface ? `<span class="surface-chip">${esc(item.surface)}</span>` : ''
              }`
            : '<span class="surface-chip">comment</span>';
        return `<tr class="clickable${fresh ? ' is-new' : ''}" data-post="${esc(item.post || '')}">
          <td class="nowrap"><span class="muted tiny">${esc(clock(item.at))}</span></td>
          <td><div class="chip-row">${kind}${item.hidden ? chip('hidden', 'warn') : ''}</div></td>
          <td>${personCell(item.author)}</td>
          <td><span class="truncate">${esc(item.text || 'no text')}</span></td>
          <td class="nowrap">${
            item.post ? `<a class="code-tag" href="#/post/${esc(item.post)}">${esc(item.post)}</a>` : '<span class="dim">gone</span>'
          }</td>
        </tr>`;
      })
      .join('');

    wallHost.innerHTML = `<div class="table-wrap"><table class="data">
      <thead><tr>
        <th>Time</th>
        <th>What</th>
        <th>Who</th>
        <th>Detail</th>
        <th>Post</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table></div>`;

    for (const item of wall) flashed.add(item.key);
    wallCount.textContent = wall.length >= WALL_MAX ? `${n(WALL_MAX)} kept, older ones dropped` : `${n(wall.length)} so far`;
  }

  /**
   * One repaint per burst rather than one per event.
   *
   * A leading-edge guard rather than a trailing reset: the first event arms the
   * timer and everything that lands in the next quarter second rides along with
   * it, so a burst of forty creates costs one repaint and the first row is still
   * on screen within 250ms.
   */
  function scheduleWall() {
    if (wallTimer) return;
    wallTimer = setTimeout(() => {
      wallTimer = null;
      if (isLive()) paintWall();
    }, 250);
  }

  /**
   * Put one realtime record on the wall.
   *
   * Creates only. An update is usually a counter being bumped by somebody
   * liking the post, which is not an event a human wrote, and a delete would
   * push a real arrival off a wall whose whole subject is arrivals. Both still
   * move the standing numbers, which is what the debounced stats refresh below
   * is for.
   */
  function pushWall(kind, record) {
    if (!record || !record.id) return;
    const item = {
      key: `${kind}:${record.id}`,
      kind,
      at: record.created || new Date().toISOString(),
      author: String(record.author || ''),
      hidden: !!record.hidden,
      post: kind === 'post' ? String(record.id || '') : String(record.post || ''),
      surface: kind === 'post' ? String(record.surface || '') : '',
      // A post's title can be empty (the app allows an untitled post), and a
      // comment body is the whole content of the row. Neither is trusted: both
      // are user text that has never been near a sanitiser, and both go through
      // `esc` at paint time.
      text: kind === 'post' ? String(record.title || '') : String(record.body || ''),
    };

    // A duplicate can arrive when the stream reconnects and replays, and a
    // second copy of the same row on the wall reads as the person posting twice.
    if (wall.some((existing) => existing.key === item.key)) return;

    wall.unshift(item);
    if (wall.length > WALL_MAX) {
      const dropped = wall.splice(WALL_MAX);
      // The flash memory is trimmed with the wall it describes, or a tab left
      // open all day grows a Set of every id it has ever seen.
      for (const gone of dropped) flashed.delete(gone.key);
    }
    wantPerson(item.author);
    scheduleWall();
    scheduleStats();
  }

  // ------------------------------------------------------------ loading ---

  /**
   * The standing numbers, and the four panels that read from them.
   *
   * Also refreshes the rail badges. This view does not OWN them, the shell sets
   * them once on boot and again on the refresh button, but while Pulse is open
   * it is holding a fresher copy of exactly those two figures than the shell
   * has, and letting the rail go stale next to a hero that is current would be
   * two different answers to one question on one screen.
   *
   * Deliberately not cleared on unmount for the same reason: the badge belongs
   * to the Feed and Comments pages and has to survive a navigation away from
   * here. Nulling it in the cleanup would blank a rail badge every time somebody
   * left this page, and the number would not come back until a manual refresh.
   */
  async function loadStats() {
    lastStatsAt = Date.now();
    let answer;
    try {
      answer = await pb.stats();
    } catch (err) {
      /*
       * Recorded and re-thrown rather than swallowed. The caller decides what
       * to do with the failure (first paint fills every panel with it, the poll
       * only warns), but the services panel has to know either way, and it is
       * the one box on the page that can still be painted usefully while this
       * route is down.
       */
      statsError = err;
      if (isLive()) paintServices();
      throw err;
    }
    if (!isLive()) return;
    stats = answer;
    statsError = null;

    asOf.textContent = `as of ${clock(new Date().toISOString())}`;
    asOf.title = `Standing totals last read at ${stamp(new Date().toISOString())}`;

    const rail = window.__dash && window.__dash.setRailCount;
    if (rail) {
      rail('feed', (stats.posts && stats.posts.hidden) || null);
      rail('comments', (stats.comments && stats.comments.hidden) || null);
    }

    paintHero();
    paintSurface();
    paintTags();
    paintAuthors();
    paintTables();
    paintServices();
    paintKpis();
  }

  /** The buckets, and the four charts and six tiles drawn from them. */
  async function loadSeries() {
    const data = await pb.series(range.query);
    if (!isLive()) return;
    paintCharts(data);
  }

  /** PocketBase's liveness answer, for the services panel. */
  async function loadHealth() {
    try {
      health = await pb.health();
    } catch (err) {
      // Kept rather than thrown. A box that will not answer `/api/health` is
      // exactly what the services panel exists to report, and letting this
      // reject would take the whole panel down instead of filling in its first
      // row with the bad news.
      health = err instanceof Error ? err : new Error(String(err));
    }
    if (isLive()) paintServices();
  }

  /**
   * A stats refresh, at most one in flight and never more often than every
   * twenty seconds.
   *
   * Realtime is what calls this: every create on the wall moves a total in the
   * hero. Without the floor, a seeding run or a busy evening would turn a one
   * minute poll into one aggregate request per event, and the stats route is
   * two dozen counting queries. The floor is enforced by scheduling the timer
   * for whatever is left of the twenty seconds rather than by dropping the
   * request, so the last event in a burst is still reflected.
   */
  function scheduleStats() {
    if (statsTimer) return;
    const since = Date.now() - lastStatsAt;
    statsTimer = setTimeout(
      () => {
        statsTimer = null;
        if (!isLive()) return;
        loadStats().catch((err) => console.warn('pulse: stats refresh did not answer', err));
      },
      Math.max(3000, 20000 - since)
    );
  }

  // ------------------------------------------------------------- wiring ---

  /**
   * The range control.
   *
   * `is-stale` goes on both the tiles and the charts, because both are drawn
   * from the payload that is being refetched and dimming only one of them would
   * say the other is still current. It comes off in a `finally` so a failed
   * range change leaves a readable page rather than a permanently dimmed one.
   */
  root.querySelector('#pulse-range').addEventListener('click', (ev) => {
    const button = ev.target.closest('[data-range]');
    if (!button) return;
    const next = RANGES.find((r) => r.id === button.dataset.range);
    if (!next || next.id === range.id) return;
    range = next;
    for (const other of root.querySelectorAll('[data-range]')) {
      other.setAttribute('aria-pressed', String(other === button));
    }
    kpiHost.classList.add('is-stale');
    chartHost.classList.add('is-stale');
    loadSeries()
      .catch((err) => {
        chartHost.className = '';
        chartHost.innerHTML = errorState('The trend could not be loaded', err);
      })
      .finally(() => {
        kpiHost.classList.remove('is-stale');
        chartHost.classList.remove('is-stale');
      });
  });

  /*
   * Row clicks on the two tables, delegated.
   *
   * Both tables already carry a real anchor in the cell that matters, so this
   * handler exists purely to widen the target for a mouse. It stands aside when
   * the click landed on a link, which is what keeps a middle click and a
   * modifier click opening a tab rather than being turned into a same-page
   * navigation by this file.
   */
  function rowNav(host, attr, prefix) {
    host.addEventListener('click', (ev) => {
      if (ev.target.closest('a')) return;
      const row = ev.target.closest(`[data-${attr}]`);
      if (!row) return;
      const id = row.dataset[attr];
      if (!id) return;
      if (window.__dash && window.__dash.go) window.__dash.go(`#/${prefix}/${id}`);
    });
  }
  rowNav(authorsHost, 'account', 'account');
  rowNav(wallHost, 'post', 'post');

  /*
   * The stream's state, mirrored into the topbar chip on this page and into the
   * services panel. The shell has its own pill; this one is here because the
   * wall is the thing that stops filling when the stream drops, and the answer
   * to "why has nothing arrived in ten minutes" should be next to the wall
   * rather than only at the other end of the window.
   */
  offs.push(
    pb.realtime.onStatus((state) => {
      if (!isLive()) return;
      liveChip.hidden = false;
      liveChip.className = `chip${state === 'live' ? ' chip-good' : state === 'down' ? ' chip-bad' : ''}`;
      liveChip.textContent =
        state === 'live' ? 'live' : state === 'connecting' ? 'connecting' : state === 'down' ? 'stream down' : 'idle';
      liveChip.title =
        state === 'live'
          ? 'New posts and comments are arriving on the live wall'
          : 'The live wall is not being fed right now. The connection retries on its own';
      paintServices();
    })
  );

  offs.push(
    pb.realtime.subscribe('posts', (message) => {
      if (message.action === 'create') pushWall('post', message.record);
      // An update or a delete still moves the hero's totals, so the standing
      // numbers get a nudge even when the wall stays as it is.
      else scheduleStats();
    })
  );

  offs.push(
    pb.realtime.subscribe('comments', (message) => {
      if (message.action === 'create') pushWall('comment', message.record);
      else scheduleStats();
    })
  );

  /*
   * The unattended refresh. Sixty seconds is the same cadence the Ludo
   * dashboard settled on: fast enough that a number on a screen somebody is
   * watching is never more than a minute old, slow enough that a tab left open
   * over a weekend is not a load pattern.
   */
  statsTick = setInterval(() => {
    if (!isLive()) return;
    loadStats().catch((err) => console.warn('pulse: stats poll did not answer', err));
  }, 60000);

  /*
   * First paint. The three requests go out together and are settled
   * INDEPENDENTLY: `Promise.all` here would mean a slow risk of one route
   * taking the other two down with it, and each half already knows how to
   * report its own failure in the box it was going to fill.
   */
  await Promise.allSettled([
    loadStats().catch((err) => {
      if (!isLive()) return;
      heroHost.innerHTML = `<div class="card"><div class="card-body">${errorState(
        'The standing numbers could not be loaded',
        err
      )}</div></div>`;
      const message = errorState('Not loaded', err);
      surfaceHost.innerHTML = message;
      tagsHost.innerHTML = message;
      authorsHost.innerHTML = message;
      tablesHost.innerHTML = message;
      kpiHost.className = '';
      kpiHost.innerHTML = '';
      paintServices();
    }),
    loadSeries().catch((err) => {
      if (!isLive()) return;
      chartHost.className = '';
      chartHost.innerHTML = errorState('The trend could not be loaded', err);
      kpiHost.className = '';
      kpiHost.innerHTML = errorState(
        'The window totals could not be counted',
        'The tiles are summed from the same buckets the charts are drawn from, so they cannot be filled without them'
      );
    }),
    loadHealth(),
  ]);

  return () => {
    alive = false;
    for (const off of offs) off();
    offs.length = 0;
    // The two chart hosts are about to go with the rest of the view, but a
    // MutationObserver holds a strong reference to the node it watches and
    // there is no reason to leave one alive on a detached tree.
    for (const stop of plotWatchers) stop();
    plotWatchers.length = 0;
    clearInterval(statsTick);
    clearTimeout(wallTimer);
    clearTimeout(peopleTimer);
    clearTimeout(statsTimer);
    /*
     * The rail badges are deliberately NOT cleared here. See `loadStats`: this
     * view refreshes the Feed and Comments counts because it is holding fresher
     * copies of them, but it does not own them. They belong to the queue pages
     * and have to survive a navigation away from this one.
     */
  };
}

/**
 * Growth — the trend page. One range over nine charts, and one honest sentence
 * under every one of them.
 *
 * Everything here comes from a SINGLE `/api/openscreengen/dash/series` call.
 * That is not an optimisation, it is the reason the page is trustworthy: nine
 * separate requests would each pick their own `now`, so the last bucket of the
 * likes chart and the last bucket of the posts chart would be different slices
 * of time, and the reader comparing them would be comparing two clocks. One
 * request means one `now`, one `span` and one `unit` for every series on
 * screen, so any two charts on this page can be read against each other.
 *
 * ## Why nine charts and not three with several lines each
 *
 * `lineChart` exists and takes two to four named series, and it is the right
 * tool for likes, saves and comments on the Pulse page, where the question is
 * "which of these three moved". It is the wrong tool here. This page is the
 * per measure reference: somebody arrives asking what follows did in July, and
 * a follows line squeezed under a likes line that is ten times taller answers
 * that with a flat trace along the bottom. One measure, one chart, one scale
 * that belongs to it alone.
 *
 * The same rule is why project bytes is its own chart rather than a second axis
 * on the project count. A dual axis chart is a picture of two scales pretending
 * to be one, and the crossing point where the two lines meet is an artefact of
 * whatever the axis maxima happened to be. Nothing on this dashboard is ever
 * dual axis. Two measures of different scale get two charts.
 *
 * ## Why every chart is gap filled before it is plotted
 *
 * The series route runs `GROUP BY substr(created, 1, 10)`, and SQL only returns
 * the buckets that HAVE rows. Plotted raw, a 30 day window where nobody posted
 * on eleven of the days comes back as nineteen columns, which the chart draws
 * evenly spaced across the full width: the quiet days vanish and the busy ones
 * are dragged next to each other. The numbers are all correct and the shape is
 * a fabrication. `fillBuckets` is what turns the sparse answer back into a
 * dense one, and every single chart below goes through it. Confirmed against
 * the live box: a 30 day window answers 15 posts buckets, 6 signups buckets and
 * 10 projects buckets out of 30.
 *
 * ## What this page cannot tell you
 *
 * There is no session table on this box and no presence row, so there is no
 * such thing as an active account here. `authors` is the closest honest thing:
 * how many different people published something. Somebody who signed in,
 * scrolled the feed for twenty minutes and posted nothing leaves no trace that
 * any query can find. The copy under that chart says so out loud rather than
 * letting the word "authors" quietly get read as "actives", which is the single
 * most likely misreading on this page.
 */

import * as pb from '../pb.js';
import { columnChart, fillBuckets } from '../charts.js';
import { esc, n, bytes, clock, emptyState, errorState, skeleton } from '../ui.js';

/**
 * The windows, and the exact query each one sends.
 *
 * `hours` and `days` are two different parameters on the route rather than one
 * number with a unit beside it, and the route decides the bucket size from
 * which of the two arrived. Confirmed against the live box: `hours=24` answers
 * `unit: 'hour'`, every `days=N` answers `unit: 'day'`, `hours` clamps at 168
 * and `days` clamps at 120. 90 days is therefore inside the clamp and safe to
 * offer; anything past 120 would be silently narrowed by the server and the
 * button would be lying about what it fetched.
 *
 * `label` is reused verbatim in the summary line under each card head ("1,284
 * posts in the last 30 days"), so it is phrased to read after "the last".
 */
const RANGES = [
  { id: '24h', label: '24 hours', query: { hours: 24 } },
  { id: '7d', label: '7 days', query: { days: 7 } },
  { id: '30d', label: '30 days', query: { days: 30 } },
  { id: '90d', label: '90 days', query: { days: 90 } },
];

/**
 * 30 days by default, and the choice matters more than it looks.
 *
 * 24 hours is the wrong landing state for a trend page on a box this size: a
 * community backend with a few dozen posts a week answers an hourly window with
 * twenty-two empty columns and two short ones, which reads as a broken chart
 * rather than as a quiet Tuesday. 30 days is where the shape of this data
 * actually lives, and the operator who genuinely wants the last day is one
 * click away from it.
 */
const DEFAULT_RANGE = '30d';

/**
 * The nine charts, in the order they appear.
 *
 * `wire` is the field on the series response. `field` is which number inside a
 * filled bucket to plot, and it is only ever anything other than the default
 * for the bytes chart, which rides the same `projects` buckets as the count
 * above it.
 *
 * ## Colour is bound to the ENTITY, never to the rank or the position
 *
 * Four validated categorical slots, assigned by what the measure is about:
 * series-1 is content, series-2 is engagement with content, series-3 is
 * accounts and the relationships between them, series-4 is the cloud. That is
 * why likes, saves and comments are all the same colour here and nobody should
 * "fix" it: they are the same kind of thing, and giving each its own hue would
 * imply a distinction the data does not have. Colour is also never the only
 * carrier of anything on this page, because each chart is alone on its own
 * scale with its own title and its own table view.
 *
 * ## `note` is the requirement, not the decoration
 *
 * Every one of these says what the number counts AND what it does not, and
 * none of them ends in a full stop, because no other page in this build ends
 * its equivalent line in one and nine cards each closing with a stray dot is
 * visible as an inconsistency long before anybody reads the words.
 *
 * The
 * second half is the half that gets left out everywhere else, and it is the
 * half that stops a chart being quoted at somebody as evidence for something it
 * never measured. Two of them are load bearing enough to call out: "Distinct
 * authors" says in as many words that it is a proxy for active accounts rather
 * than a measure of them, and the delete-and-unlike ones say that a past bucket
 * can FALL, because these are counts of rows that still exist rather than of
 * events that were logged. Nothing on this box records an unlike; it deletes
 * the like row, and the July bucket that held it quietly gets smaller. An
 * operator comparing a screenshot from last week against the same chart today
 * needs to know that before they go looking for a bug.
 *
 * ## `note` is authored markup, and it is the ONE string on this page that is
 * not run through `esc()`
 *
 * A column name is not prose. `post_likes` set in the body face inside a
 * sentence reads as a typo for two English words, and the rest of this
 * dashboard has already settled the question: Storage writes
 * `<span class="mono">posts.images</span>`, Settings puts every key in the
 * mono face, and only this page was still printing its identifiers as bare
 * prose. So the notes carry their own `<span class="mono">` and
 * `buildScaffold` writes them through rather than escaping them.
 *
 * That is safe HERE and nowhere else on this page, for one reason that has to
 * stay true: every character of every `note` is a literal in the array below.
 * Not one byte of it comes off the wire, out of the hash, or from anything an
 * operator can type. The moment somebody wants a note to interpolate a value
 * from `data`, that value goes through `esc()` on its way in, or this whole
 * field goes back to being escaped text. Nothing else in this file is exempt.
 */
const CHARTS = [
  {
    id: 'signups',
    wire: 'signups',
    title: 'New accounts',
    unit: 'accounts',
    color: 'var(--series-3)',
    emptyTitle: 'Nobody signed up in this range',
    emptyNote: 'A first sign in through Google or GitHub creates the account row that puts a bar here',
    note:
      'Counts rows in the <span class="mono">users</span> table by when the account was created, Google, GitHub and unlinked alike. ' +
      'It does not count returning sign ins, and a deleted account takes its row out of the table, so a past bucket can fall',
  },
  {
    id: 'posts',
    wire: 'posts',
    title: 'Posts published',
    unit: 'posts',
    color: 'var(--series-1)',
    emptyTitle: 'No posts were published in this range',
    emptyNote: 'Somebody sharing a board from the editor puts a bar here',
    note:
      'Counts post rows by when they were created, hidden and featured ones included, because hiding is not deleting. ' +
      'It does not count edits to an existing post, and a deleted post leaves the bucket it was created in',
  },
  {
    id: 'authors',
    wire: 'authors',
    title: 'Distinct authors',
    unit: 'authors',
    color: 'var(--series-3)',
    /*
     * The one series on this page whose columns MUST NOT be added up, and the
     * live box proves it: over 90 days the buckets sum to 33 on a fixture that
     * holds twelve accounts in total. Each bucket is its own
     * COUNT(DISTINCT author), so somebody who posted on three days is counted
     * in three of them. A "33 authors in the last 90 days" line under this
     * chart would be a plainly false number sitting in the most authoritative
     * position on the card.
     */
    additive: false,
    emptyTitle: 'No account published anything in this range',
    emptyNote: 'One post from one account puts a bar here',
    note:
      'Counts how many different accounts published at least one post in that bucket, which is the honest proxy for active accounts ' +
      'and not a measure of them: nothing on this box records a session, so somebody who signed in, read the feed and posted nothing ' +
      'is not in this chart at all. The columns do not add up either, because an account that posted on three days is counted in three of them',
  },
  {
    id: 'comments',
    wire: 'comments',
    title: 'Comments',
    unit: 'comments',
    color: 'var(--series-2)',
    emptyTitle: 'Nobody commented in this range',
    emptyNote: 'A comment on any post, hidden or not, puts a bar here',
    note:
      'Counts comment rows by when they were written, hidden ones included. ' +
      'It does not count likes on comments, which are their own table, and a comment on a deleted post goes with it by cascade',
  },
  {
    id: 'likes',
    wire: 'likes',
    title: 'Likes',
    unit: 'likes',
    color: 'var(--series-2)',
    emptyTitle: 'Nothing was liked in this range',
    emptyNote: 'A like on a post writes the row that puts a bar here',
    note:
      'Counts rows in <span class="mono">post_likes</span>, one per account per post, so liking the same post twice is still one row. ' +
      'It does not include comment likes, and an unlike deletes the row rather than logging an event, so a past bucket can fall',
  },
  {
    id: 'saves',
    wire: 'saves',
    title: 'Saves',
    unit: 'saves',
    color: 'var(--series-2)',
    emptyTitle: 'Nothing was saved in this range',
    emptyNote: 'Somebody saving a post to their own list puts a bar here',
    note:
      'Counts rows in <span class="mono">post_saves</span>, one per account per post. A save is private and never shown on the post, ' +
      'so this is not a public engagement number, and un-saving deletes the row rather than logging an event',
  },
  {
    id: 'follows',
    wire: 'follows',
    title: 'Follows',
    unit: 'follows',
    color: 'var(--series-3)',
    emptyTitle: 'Nobody followed anybody in this range',
    emptyNote: 'One account following another writes the row that puts a bar here',
    note:
      'Counts follow rows by when they were created, one per follower and author pair. ' +
      'It does not net out unfollows: an unfollow deletes the row, which shrinks the bucket it was created in ' +
      'instead of showing up as a negative here',
  },
  {
    id: 'projects',
    wire: 'projects',
    title: 'Cloud projects saved',
    unit: 'projects',
    color: 'var(--series-4)',
    emptyTitle: 'No project was saved to the cloud in this range',
    emptyNote: 'A first cloud save from the editor creates the project row that puts a bar here',
    note:
      'Counts <span class="mono">cloud_projects</span> rows by when the project was first saved, private and link shared alike. ' +
      'It does not count saves over a project that already exists, which update the same row, so this is new projects and not save traffic',
  },
  {
    id: 'project-bytes',
    wire: 'projects',
    field: 'bytes',
    format: 'bytes',
    title: 'Cloud project bytes',
    unit: 'bytes',
    color: 'var(--series-4)',
    emptyTitle: 'The projects in this range hold no bytes',
    emptyNote: 'A project with a document or an uploaded asset in it puts a bar here',
    note:
      'Sums <span class="mono">doc_bytes</span> plus <span class="mono">asset_bytes</span> for the projects created in each bucket, measured as they are now rather than as they were on the day. ' +
      'It is a second chart and not a second axis on the one above, because a byte count and a project count share no scale. ' +
      'Post images are not in here: the database has no byte column for them, and the Storage page is the only place that can measure them',
  },
];

/**
 * Which fields to pull out of a bucket row.
 *
 * `fillBuckets` renames `n` to `value` and leaves every other key alone, so
 * asking for `['n', 'bytes']` on the projects series yields a bucket carrying
 * both `value` and `bytes`, and the two projects charts share one filled array
 * instead of filling the same 90 buckets twice. Confirmed against the live box:
 * `projects` is the only series that answers a second number.
 */
const bucketKeys = (wire) => (wire === 'projects' ? ['n', 'bytes'] : ['n']);

export async function render(root) {
  let range = RANGES.find((r) => r.id === DEFAULT_RANGE) || RANGES[0];

  /*
   * A monotonic token, checked after every await.
   *
   * Two things race here. The operator clicking 24 hours and then 90 days
   * fires two requests, and there is no guarantee the 90 day one lands second:
   * it scans four times as much of the index. Without this the page ends up
   * with the range control reading "90 days" over charts drawn from a 24 hour
   * answer, which is the worst kind of wrong because nothing looks broken. The
   * router also tears this view down while a request is in flight, and a stale
   * response writing into detached nodes is at best wasted work.
   */
  let token = 0;
  let alive = true;

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Growth</h2>
        <div class="sub">How each measure on this box has moved, one chart per measure over one shared range</div>
      </div>
      <div class="page-tools">
        <span class="muted tiny" id="growth-asof"></span>
      </div>
    </div>

    <div class="filter-row">
      <div class="segmented" id="growth-range" role="group" aria-label="Time range">
        ${RANGES.map(
          (r) =>
            `<button type="button" data-range="${esc(r.id)}" aria-pressed="${r.id === range.id}">${esc(r.label)}</button>`
        ).join('')}
      </div>
      <span class="muted tiny">Buckets are UTC, and every chart on this page shares them</span>
    </div>

    <div id="growth-note" role="status"></div>
    <div id="growth-body"></div>`;

  const asOf = root.querySelector('#growth-asof');
  const noteHost = root.querySelector('#growth-note');
  const body = root.querySelector('#growth-body');

  /**
   * The nine cards, built empty.
   *
   * The scaffold is put up BEFORE the first request rather than after it,
   * because the card head, the range summary slot and the "what this counts"
   * note are all static and none of them needs the data. That means the
   * skeleton sits inside the real grid at the real card widths, so when the
   * charts land nothing on the page moves. A skeleton that is a different shape
   * from the thing it stands in for is just a spinner with extra steps.
   *
   * `skeleton('rows', 4)` in each body rather than 'cards' or 'tiles': the
   * other two carry their own grid template (232px and 200px columns) and would
   * shatter a 460px chart card into a strip of little boxes. Four rows is close
   * enough to the height of a plotted chart that the drop is unnoticeable.
   */
  function buildScaffold() {
    body.innerHTML = `<div class="grid grid-charts" id="growth-charts">${CHARTS.map(
      (chart) => `<div class="card" data-chart="${esc(chart.id)}">
        <div class="card-head">
          <div>
            <h3>${esc(chart.title)}</h3>
            <div class="sub" data-summary>counting</div>
          </div>
        </div>
        <div class="card-body">
          <div data-plot>${skeleton('rows', 4)}</div>
          <p class="muted tiny" data-note>${chart.note}</p>
        </div>
      </div>`
    ).join('')}</div>`;
  }

  /**
   * The summary line that sits under each card title.
   *
   * It leads with the total across the window and closes with how wide a column
   * is, because "1,284 posts in the last 30 days" is the sentence somebody came
   * to the page for and "one column per day" is the caveat that makes the
   * picture readable. `unit` is echoed from the wire rather than derived from
   * the button that was pressed, so if the route ever clamps a range to a
   * different bucket size the line says what actually came back.
   *
   * A NON ADDITIVE series gets a different sentence entirely rather than the
   * same one with a hedge bolted on. Distinct authors is the only one, its
   * buckets genuinely cannot be added, and the peak plus the number of live
   * buckets are the two facts that summarise it without inventing a total that
   * does not exist.
   */
  function summaryLine(chart, figures, unit) {
    // Not named `window`. A local called `window` is legal and shadows the
    // global one for the whole function, which is a trap waiting for whoever
    // adds a `window.__dash.go` to this helper later.
    const tail = `in the last ${range.label}, one column per ${unit}, UTC`;
    if (chart.additive === false) {
      return `${n(figures.peak)} at most in one ${unit}, on ${n(figures.live)} of the last ${range.label}, UTC`;
    }
    if (chart.format === 'bytes') return `${bytes(figures.total)} across the projects created ${tail}`;
    /*
     * "1 accounts in the last 24 hours" was what this printed before the trim,
     * and a summary line with a grammar mistake in it is the first thing a
     * reader stops trusting. Dropping the trailing s is safe here because every
     * unit word on this page is a regular plural and its own singular is the
     * word minus that letter: accounts, posts, comments, likes, saves, follows,
     * projects. Nothing irregular can arrive, because these seven are constants
     * in the array above rather than anything off the wire. The distinct
     * authors card never reaches this line, and the bytes card never uses a
     * unit word at all.
     */
    const word = figures.total === 1 ? chart.unit.replace(/s$/, '') : chart.unit;
    return `${n(figures.total)} ${word} ${tail}`;
  }

  /**
   * Draw one card from an already filled, already dense bucket array.
   *
   * A range whose total is zero gets an empty state rather than a chart, and
   * that is a deliberate departure from "always draw the chart". `columnChart`
   * handed 90 buckets of zero draws a full axis, a full set of ticks, three
   * gridlines and not one mark, which is pixel identical to a chart whose data
   * failed to arrive. charts.js makes exactly this argument about its own empty
   * cases. The empty state says which of the two it is and, more usefully, what
   * would put a bar there. The note underneath survives either way, because the
   * "what this counts" line is the answer to "why is this zero" as often as the
   * chart is.
   */
  function paintCard(card, chart, buckets, unit) {
    const rows =
      chart.field === 'bytes'
        ? // The bytes chart rides the projects buckets, so `value` has to be
          // moved onto the byte column before the chart sees it. Spread rather
          // than rebuilt: `full`, `range`, `local`, `at`, `groupKey` and
          // `groupLabel` are all read by the tooltip header and the second axis
          // row, and a clean `{ label, value }` pair would silently delete them.
          buckets.map((bucket) => ({ ...bucket, value: bucket.bytes }))
        : buckets;

    /*
     * Three figures rather than one, because the summary line needs different
     * ones depending on the series and computing them here means walking the
     * buckets once. `live` is buckets that carried something rather than
     * buckets that exist: after `fillBuckets` every bucket exists, so the count
     * of non zero ones is the only thing left that says how spread out the
     * activity was.
     */
    const figures = rows.reduce(
      (acc, bucket) => {
        const value = isFinite(bucket.value) ? bucket.value : 0;
        acc.total += value;
        if (value > acc.peak) acc.peak = value;
        if (value > 0) acc.live += 1;
        return acc;
      },
      { total: 0, peak: 0, live: 0 }
    );
    card.querySelector('[data-summary]').textContent = summaryLine(chart, figures, unit);

    const plot = card.querySelector('[data-plot]');
    if (!figures.total) {
      /*
       * The empty state is a heading and a sentence, so it needs no chart name
       * on top of it, and leaving the group role on would announce "column
       * chart" over markup that has no chart in it. Both attributes come off
       * rather than being overwritten, because a card can go from drawn to
       * empty and back again as the range changes.
       */
      plot.removeAttribute('role');
      plot.removeAttribute('aria-label');
      plot.innerHTML = emptyState(chart.emptyTitle, chart.emptyNote);
      return false;
    }

    /*
     * A named container around the chart, because the SVG inside it has no name
     * of its own.
     *
     * `columnChart` writes its axis as plain `<text>` with no `aria-hidden`, so
     * a screen reader walks straight into the ticks and reads "0 25 50 Jul 1
     * Jul 8" with nothing to say what any of it is. The sparklines in the KPI
     * tiles are marked `aria-hidden` and get this right; the big charts are not.
     *
     * What can be done from a CALL SITE is this: name the box the chart sits in
     * and point at the figures in words. `role="group"` rather than
     * `role="img"` on purpose, because the chart carries a real Table view
     * button and a table inside it, and `role="img"` makes everything under it
     * presentational, which would take that button out of the reading order
     * along with the ticks.
     *
     * What CANNOT be done from here is silencing the axis text: `responsive()`
     * in charts.js replaces the whole `<svg>` element on every ResizeObserver
     * fire, so an `aria-hidden` set on it here is gone the first time the
     * window is dragged. That one belongs inside charts.js.
     */
    plot.setAttribute('role', 'group');
    plot.setAttribute(
      'aria-label',
      `${chart.title}, column chart. Use the Table view button inside it to read every bucket as figures`
    );

    plot.replaceChildren(
      columnChart({ data: rows, color: chart.color, title: chart.title, unit: chart.unit })
    );
    // A boolean, because the only caller asks "did anything happen here", and
    // handing back a byte count from one card and a row count from the next for
    // the caller to add together is how the two get confused for each other.
    return true;
  }

  /**
   * One response in, nine charts out.
   *
   * Every series is filled against the SAME `{ unit, span, now }` taken off the
   * response, never off the button that was pressed. The route clamps (168
   * hours, 120 days) and it is the response that knows what it clamped to; a
   * client that filled from its own idea of the span would draw buckets the
   * server never answered for and label them zero.
   */
  function paint(data) {
    const shape = { unit: data.unit, span: data.span, now: data.now };
    const filled = new Map();
    /*
     * A boolean rather than a running sum, because one of the nine totals is a
     * byte count and the other eight are row counts. Adding them together would
     * produce a number that means nothing at all, and the only question being
     * asked of it here is whether anything at all happened.
     */
    let anything = false;

    for (const chart of CHARTS) {
      if (!filled.has(chart.wire)) {
        filled.set(chart.wire, fillBuckets(data[chart.wire], { ...shape, keys: bucketKeys(chart.wire) }));
      }
      const card = body.querySelector(`[data-chart="${chart.id}"]`);
      // A card that is not on the page is not an error worth shouting about: it
      // means a retry rebuilt the scaffold under this paint, and the newer
      // paint is already on its way.
      if (!card) continue;
      if (paintCard(card, chart, filled.get(chart.wire), data.unit)) anything = true;
    }

    /*
     * The page level empty state. Nine cards each saying "nothing here" is a
     * lot of screen for one fact, and on a fresh box that fact is not a fault
     * at all, so it gets said once, plainly, above the grid: nothing happened,
     * and the range control is the lever. Cleared on every paint so it cannot
     * outlive the range it was true for.
     */
    noteHost.innerHTML = anything
      ? ''
      : `<p class="muted tiny">Not one row was written anywhere on this box in the last ${esc(range.label)}. ` +
        `That is a real answer rather than a failure, and a wider range is the way to find where the last activity was</p>`;
  }

  /** The it-broke card, with the retry that goes with it. */
  function paintError(err) {
    noteHost.innerHTML = '';
    body.innerHTML = `<div class="card">
      <div class="card-head">
        <div>
          <h3>Trend</h3>
          <div class="sub">Nothing on this page can be drawn until this request comes back</div>
        </div>
        <span class="spacer"></span>
        <button type="button" class="btn btn-sm" data-retry>Try again</button>
      </div>
      <div class="card-body">${errorState(`The last ${range.label} did not load`, err)}</div>
    </div>`;
  }

  /**
   * Fetch and repaint.
   *
   * `first` is the difference between a skeleton and a stale hold. On the first
   * load there is nothing on screen worth keeping, so the scaffold's skeletons
   * do the waiting. On a range change there ARE charts on screen, and blanking
   * them back to skeletons for the third of a second the request takes is a
   * flash that makes the page feel like it is falling over on every click.
   * `is-stale` dims what is there instead, which reads as "these are the old
   * numbers" without moving a single pixel of layout.
   *
   * The class is put on and taken off the grid looked up FRESH each time rather
   * than on a captured reference, because a retry replaces the whole body and
   * any reference taken before that points at a detached node.
   */
  async function load(first) {
    const seq = ++token;
    if (first) buildScaffold();
    const grid = body.querySelector('#growth-charts');
    if (!first && grid) grid.classList.add('is-stale');

    try {
      const data = await pb.series(range.query);
      if (!alive || seq !== token) return;
      paint(data);
      asOf.textContent = `as of ${clock(new Date().toISOString())}`;
    } catch (err) {
      if (!alive || seq !== token) return;
      /*
       * The whole body goes, charts included, and that is on purpose. The range
       * control is a page level control, so leaving the previous range's charts
       * up under a button that now reads "90 days" would have the page state
       * something the data never said. An error here is total by nature anyway:
       * one request feeds all nine charts, so there is no partial answer to
       * salvage. 404 and 400 both land here rather than signing the operator
       * out, which is why the message itself is shown.
       */
      paintError(err);
    } finally {
      if (alive && seq === token) {
        const current = body.querySelector('#growth-charts');
        if (current) current.classList.remove('is-stale');
      }
    }
  }

  /*
   * One delegated listener on the whole view rather than one per button.
   *
   * The retry button does not exist until a request has already failed, so
   * wiring it at render time is not an option, and re-wiring it inside the
   * error path is one more thing to forget. Delegation covers both controls and
   * survives every rebuild of the body. Both are real `<button>` elements, so
   * Tab reaches them and Enter and Space activate them with nothing added here.
   *
   * ## Held in a named const because it MUST be removed on teardown
   *
   * `root` is `#view`, and `#view` is the same element for every page in this
   * dashboard: the router replaces its innerHTML on the way to the next view,
   * never the element. An anonymous handler left on it therefore outlives this
   * view and keeps matching `[data-range]` and `[data-retry]` in whatever
   * renders next, and one more of them piles up on every visit to Growth.
   *
   * This was not theoretical. Pulse and Tags both draw their own range strips
   * with the SAME `data-range` ids, so Growth then Pulse then a click on
   * Pulse's "7 days" fired TWO series requests, one of them Growth's dead
   * closure still holding its own `range` and asking the box for a page nobody
   * was looking at. `alive` does not help: it is checked after the await, so it
   * stops the paint and not the request. settings.js documents the same trap
   * and removes all three of its listeners, which is the pattern this now
   * matches.
   */
  const onClick = (ev) => {
    const rangeButton = ev.target.closest('[data-range]');
    if (rangeButton) {
      const next = RANGES.find((r) => r.id === rangeButton.dataset.range);
      // Clicking the range that is already showing is a no-op rather than a
      // refetch: it is a common miss on a four button strip and answering it
      // with a dim-and-redraw looks like the page glitched.
      if (!next || next.id === range.id) return;
      range = next;
      root.querySelectorAll('[data-range]').forEach((button) => {
        button.setAttribute('aria-pressed', String(button === rangeButton));
      });
      // The scaffold is already up and holding the layout, so this is never a
      // first load even though the previous attempt may have failed: the retry
      // path below is what rebuilds after an error.
      load(!body.querySelector('#growth-charts')).catch(() => {});
      return;
    }

    if (ev.target.closest('[data-retry]')) {
      load(true).catch(() => {});
    }
  };
  root.addEventListener('click', onClick);

  await load(true);

  /*
   * Two things to give back, and the listener is the one that used to be
   * missed.
   *
   * `alive` stops an in-flight response writing into markup the router has
   * already thrown away. The `removeEventListener` is what stops this view's
   * click handler from living on `#view` forever and firing under Pulse and
   * Tags; see the long note beside `onClick`. Anything added to this file later
   * that attaches to something outside `root`'s own markup belongs here too.
   */
  return () => {
    alive = false;
    root.removeEventListener('click', onClick);
  };
}

/**
 * Charts, hand drawn in SVG.
 *
 * The specs here are not taste. Thin marks, a 4px rounded data-end square at
 * the baseline, 2px lines, a 2px surface gap doing the separating rather than a
 * stroke around each mark, hairline SOLID gridlines one step off the surface,
 * and text in text tokens rather than in the series colour. A legend appears
 * for two or more series and never for one — with one series the title already
 * says what is plotted, and a legend box with a single swatch just restates it.
 *
 * Every chart carries a table-view twin, because a tooltip must never be the
 * only way to read a value, and because the table is the only route a keyboard
 * has to these numbers at all.
 *
 * The palette is the four validated categorical slots in fixed order (see
 * styles.css), assigned by entity and never by rank, so filtering a series out
 * cannot repaint the survivors. Nothing here is ever dual axis: two measures of
 * different scale get two charts.
 *
 * Charts render at the container's real pixel width via ResizeObserver rather
 * than by scaling a fixed viewBox, which is what keeps a 2px line 2px instead
 * of however wide the card happens to make it.
 *
 * THEME: there is not one hex literal in this file, and that is load bearing.
 * Every colour a mark can take is a `var(--…)` read from the sheet at paint
 * time, which means the light/dark switch repaints every chart on the page for
 * free, with no re-render, no observer and no redraw hook. The one place the
 * Ludo original cheated was the sparkline dot's halo, which hardcoded the dark
 * surface; here it reads `var(--surface-1)` and survives the switch. The same
 * rule holds for the two new components below, `lineChart` and `donut`: their
 * strokes, fills, halos and legend bars are all tokens, so a theme change is a
 * repaint and nothing more.
 */

import { esc, n, compact, emptyState } from './ui.js';

const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];

/**
 * The neutral used for "everything the ring could not give a slot to".
 *
 * Deliberately not a fifth series hue: the categorical palette is four slots
 * wide because four is what was validated, and inventing a fifth is how a chart
 * ends up with two colours nobody can tell apart. Grey reads as "not a
 * category", which is exactly what a grouped remainder is.
 */
const NEUTRAL = 'var(--line)';

/*
 * ============================ reading a row ============================
 *
 * ## Two shapes, both real, and the failure mode when they meet
 *
 * Every aggregate on this box answers in the SQL shape: `{ k, n }` for a
 * grouped key and its count, `{ b, n }` for a time bucket and its count. That
 * is what `SELECT surface AS k, COUNT(*) AS n` hands back and nothing on the
 * server renames it. Every chart in this file was written against
 * `{ label, value }`, which is what `fillBuckets` produces. `stats.top_tags`,
 * `stats.by_surface`, `stats.tables`, `stats.switches` and `risk.posture` are
 * all the first shape and all of them are drawn by something in here.
 *
 * When the two meet unmediated nothing throws, and that is the problem.
 * `row.value` on a `{ k, n }` row is `undefined`; `undefined / max * 100` is
 * `NaN`; `width:NaN%` is a declaration the CSS parser drops on the floor; and
 * `esc(undefined)` is an empty string. The result is a panel of full width
 * tracks with no fill, no labels and no values, which reads exactly like a
 * table with no rows in it. A dashboard answering "there is nothing there"
 * about something that is there is the worst outcome available to it, worse
 * than a stack trace, because a stack trace gets fixed.
 *
 * So the readers live here, once, and every entry point runs its input through
 * them before it does anything else. Normalising 168 buckets costs nothing next
 * to the paint that follows.
 */

/**
 * A number, or NaN meaning "this row did not carry one".
 *
 * NaN rather than 0, and that is the whole point of the function. Zero is a
 * claim: nobody posted that hour, nobody used that tag. A missing field claims
 * nothing at all, and flattening the two together makes the chart state
 * something the database never said. Each chart below decides for itself what
 * an unreadable row should look like, and none of them is allowed to have that
 * decision made for it by a silent zero.
 *
 * null, undefined and '' are unreadable rather than zero for the same reason:
 * `COUNT(*)` never answers null, so a null in this position means the shape is
 * wrong rather than that the count came out empty.
 */
function readNumber(value) {
  if (value === null || value === undefined || value === '') return NaN;
  const x = Number(value);
  return isFinite(x) ? x : NaN;
}

/**
 * One array of rows, in whichever shape it arrived, with `label` and `value`
 * settled. Anything that is not an array at all becomes an empty one.
 *
 * Accepted per row: `{ label, value }`, `{ k, n }`, `{ b, n }`, and a bare
 * number for the sparkline's plain `[1, 4, 9]` form.
 *
 * The original object is SPREAD THROUGH rather than replaced. Bucket rows carry
 * a great deal more than a label and a number: `full`, `range`, `local`, `at`,
 * `groupKey` and `groupLabel` are all read further down by the tooltip header
 * and the second axis row, and a normaliser that handed back a clean pair would
 * quietly delete every one of them and leave the tooltips blank.
 */
function readRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const src = row && typeof row === 'object' ? row : {};
    const value = readNumber(src.value !== undefined ? src.value : src.n !== undefined ? src.n : row);
    const label =
      src.label !== undefined ? src.label : src.k !== undefined ? src.k : src.b !== undefined ? src.b : '';
    return { ...src, label, value };
  });
}

/** The rows that can actually be drawn. Scales are built from these and only these. */
function drawable(rows) {
  return rows.filter((row) => isFinite(row.value));
}

/**
 * What a chart renders when there is nothing to render.
 *
 * An axis frame with no marks in it is not an empty state, it is a chart that
 * looks broken, and the reader cannot tell it apart from one whose data failed
 * to arrive. This says which of the two it is, in the same `.empty` block every
 * list and table on this dashboard uses, so a card with no data looks the same
 * everywhere regardless of what was supposed to be inside it.
 *
 * Still a `.chart` element, because every caller appends the return value to a
 * card and a couple of them measure it. The contract is that this function
 * hands back an element, always, and never null.
 */
function emptyChart(title, note) {
  const root = document.createElement('div');
  root.className = 'chart';
  root.innerHTML = emptyState(title, note);
  return root;
}

function niceMax(value) {
  if (!isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalised = value / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * Which ticks get a label.
 *
 * Every `stride`-th one, plus the last — but the last ONLY when there is room
 * for it. Forcing it unconditionally is what produced `08:0009:00` jammed
 * together at the right edge: the final bucket is `length-1 % stride` bands
 * away from the previous label, which can be one band.
 */
function labelled(i, count, stride, band) {
  if (i % stride === 0) return true;
  const last = count - 1;
  return i === last && (last % stride) * band >= 46;
}

/** A bar whose top corners are rounded and whose baseline end stays square. */
function barPath(x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height));
  if (height <= 0.5) return '';
  return `M${x} ${y + height}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + width - r}Q${x + width} ${y} ${x + width} ${y + r}V${y + height}Z`;
}

/**
 * Re-renders the plot at the container's real pixel width.
 *
 * **The SVG goes in its own child, never into the container itself.** The
 * container is also where the tooltip lives, and an `innerHTML =` on it wipes
 * that tooltip the first time the chart paints — which is a repaint that always
 * happens, because ResizeObserver fires once on observe. The result was a
 * tooltip element that existed for about one frame and a hover that silently
 * did nothing. Keep the two in separate subtrees.
 *
 * The returned `paint` is not decoration either: anything that changes what is
 * plotted without changing the container's size (a legend toggle, say) has to
 * be able to ask for a redraw, and this is the only handle on the draw closure.
 */
function responsive(container, draw) {
  const canvas = document.createElement('div');
  container.append(canvas);
  const paint = () => {
    const width = container.clientWidth;
    if (width < 40) return;
    canvas.innerHTML = draw(width);
  };
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(paint);
    observer.observe(container);
  } else {
    window.addEventListener('resize', paint);
  }
  requestAnimationFrame(paint);
  return paint;
}

/** The toggle every chart carries, so no value is gated behind a hover. */
function withTableView(root, buildTable) {
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;justify-content:flex-end;margin-top:6px';
  const button = document.createElement('button');
  button.className = 'btn btn-ghost btn-sm';
  button.type = 'button';
  button.textContent = 'Table view';
  const table = document.createElement('div');
  table.className = 'chart-table';
  table.hidden = true;
  button.onclick = () => {
    table.hidden = !table.hidden;
    button.textContent = table.hidden ? 'Table view' : 'Hide table';
    if (!table.hidden) table.innerHTML = buildTable();
  };
  bar.append(button);
  root.append(bar, table);
}

// ---------- sparkline ----------

/**
 * The 12-point trend inside a stat tile. No axis, no labels, no tooltip: it
 * shows shape, and the tile's own value carries the number.
 *
 * The last point gets a dot with a halo, and the halo is `var(--surface-1)`
 * rather than a baked-in dark hex. That halo exists to punch the dot out of the
 * line it sits on, so it has to be the colour of the ground behind the tile; on
 * a light theme a hardcoded near-black halo turns the dot into an ink blot.
 * Reading the token means the switch repaints it and nobody has to remember.
 *
 * ACCEPTS `[1, 4, 9]`, `[{ value }]` and the wire's `[{ k, n }]` / `[{ b, n }]`,
 * which matters because a KPI tile is usually fed the same array its chart got
 * and mapping it down to bare numbers at the call site is one more place to get
 * the field name wrong.
 *
 * RETURNS AN EMPTY STRING when there are fewer than two readable points, and
 * that is the honest degradation rather than a missing one: this thing has no
 * axis and no labels, so a sparkline of one point is a dot with no meaning, and
 * the tile it sits in still carries the number that answers the question. There
 * is no box left behind to look broken.
 */
export function sparkline(values, { color = 'var(--series-1)', width = 220, height = 34 } = {}) {
  const points = drawable(readRows(values)).map((point) => point.value);
  if (points.length < 2) return '';
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const span = max - min || 1;
  const stepX = width / (points.length - 1);
  const y = (value) => height - 5 - ((value - min) / span) * (height - 10);

  const line = points.map((value, i) => `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(1)} ${y(value).toFixed(1)}`).join('');
  const area = `${line}L${width} ${height}L0 ${height}Z`;
  const lastX = width;
  const lastY = y(points[points.length - 1]);

  return `<svg class="kpi-spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${area}" fill="${color}" opacity="0.1"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <circle cx="${lastX - 3}" cy="${lastY.toFixed(1)}" r="3.2" fill="${color}" stroke="var(--surface-1)" stroke-width="2" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

// ---------- column chart (one series) ----------

/**
 * One measure over time. Single series, so no legend: `title` names it.
 *
 * `data` is `[{ label, value, tip }]` and must already be gap-filled — a chart
 * that silently omits the quiet hours misstates the shape, which is why the
 * series route's buckets get expanded by the caller rather than plotted raw.
 *
 * ACCEPTS `[{ label, value }]` from `fillBuckets` and the raw wire shapes
 * `[{ b, n }]` and `[{ k, n }]`. Handed the raw shape it still draws the right
 * bars, it just has no tooltip header, no local time line and no second axis
 * row, because those are things `fillBuckets` works out and the wire does not
 * carry. Handed an empty array, or one where nothing is readable, it says so
 * instead of drawing an axis with no marks between the gridlines.
 */
export function columnChart({ data: rows, color = SERIES[0], title = '', unit = '' }) {
  const data = readRows(rows);
  const live = drawable(data);
  if (!data.length) {
    return emptyChart('Nothing to plot', 'No buckets came back for this range, so there is nothing to draw');
  }
  if (!live.length) {
    return emptyChart(
      'Nothing readable to plot',
      'Buckets came back for this range, but not one of them carried a number this chart could read'
    );
  }

  const root = document.createElement('div');
  root.className = 'chart';
  const plot = document.createElement('div');
  plot.style.position = 'relative';
  root.append(plot);

  // The scale is built from the readable buckets ALONE. One unreadable value in
  // an otherwise fine series used to take the whole axis with it: `Math.max`
  // over anything containing NaN is NaN, `niceMax(NaN)` falls back to 1, and
  // every bar in the chart then draws off the top of a plot whose axis claims a
  // ceiling of one.
  const values = live.map((d) => d.value);
  const max = niceMax(Math.max(...values, 0));

  responsive(plot, (width) => {
    const padL = 46;
    const padR = 8;
    const padT = 10;
    const plotH = 150;
    // Two rows now: the hour/day ticks, then the day/month band under them.
    const axisH = 38;
    const innerW = Math.max(20, width - padL - padR);
    const band = innerW / Math.max(1, data.length);
    // The 2px surface gap is what separates neighbours; 24px is the cap.
    const barW = Math.max(2, Math.min(24, band - 2));
    const y = (value) => padT + plotH - (value / max) * plotH;

    const ticks = [0, max / 2, max];
    const grid = ticks
      .map(
        (t) =>
          `<line x1="${padL}" y1="${y(t).toFixed(1)}" x2="${width - padR}" y2="${y(t).toFixed(1)}" stroke="var(--grid)" stroke-width="1"/>` +
          `<text class="chart-axis" x="${padL - 8}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end">${compact(t)}</text>`
      )
      .join('');

    // Label stride, so ticks never collide. `10:00` is wider than `10` was, so
    // the estimate has to grow with it or every other label overlaps.
    const stride = Math.max(1, Math.ceil((data.length * 46) / innerW));
    const bars = data
      .map((d, i) => {
        const x = padL + i * band + (band - barW) / 2;
        /*
         * An unreadable bucket draws NO BAR, and keeps its tick and its hit
         * area so the tooltip can say why. A zero height column and a real zero
         * are the same picture, and only one of them is a fact: drawing the
         * missing one as zero would have this chart assert that nothing
         * happened in an hour it simply has no number for.
         */
        const height = isFinite(d.value) ? (d.value / max) * plotH : 0;
        const top = padT + plotH - height;
        const label = labelled(i, data.length, stride, band)
          ? `<text class="chart-axis" x="${(padL + i * band + band / 2).toFixed(1)}" y="${padT + plotH + 14}" text-anchor="middle">${esc(d.label)}</text>`
          : '';
        return (
          `<path d="${barPath(x, top, barW, height, 4)}" fill="${color}"/>` +
          // The hit area is the whole band with a 24px floor, so a 3px bar on a
          // quiet day is still hoverable.
          // `data-top` is the BAR's top, not the hit area's. The hit area is
          // full height so the tooltip could never find room above it and
          // flipped below on every single column, covering the next chart.
          `<rect class="hit" data-i="${i}" data-top="${top.toFixed(1)}" x="${(padL + i * band + band / 2 - Math.max(12, band / 2)).toFixed(1)}" y="${padT}" width="${Math.max(24, band).toFixed(1)}" height="${plotH}" fill="transparent"/>` +
          label
        );
      })
      .join('');

    return `<svg height="${padT + plotH + axisH}" width="${width}" viewBox="0 0 ${width} ${padT + plotH + axisH}">
      <rect class="band" x="0" y="${padT}" width="0" height="${plotH}" fill="var(--surface-2)" opacity="0" rx="4"/>
      ${grid}
      <line x1="${padL}" y1="${padT + plotH}" x2="${width - padR}" y2="${padT + plotH}" stroke="var(--axis)" stroke-width="1"/>
      ${bars}
      ${groupAxis(groupTicks(data), { padL, padR, padT, plotH, band, width })}
    </svg>`;
  });

  const total = values.reduce((sum, v) => sum + v, 0);
  const average = values.length ? total / values.length : 0;
  const peak = Math.max(...values, 0);
  const trough = Math.min(...values, 0);

  wireTooltip(plot, data, (d, i) => {
    /*
     * The bucket is there, the number is not. Worth saying out loud, because
     * every other path through this tooltip prints a figure and `n(NaN)`
     * answers a confident '0', which is the one thing this bucket does not
     * know. The previous bucket gets the same test before it is used as a
     * comparison: a delta against a value nobody could read is arithmetic
     * dressed up as a fact.
     */
    if (!isFinite(d.value)) {
      return tipHeader(d) + '<div class="t-flag">this bucket carried no readable number</div>';
    }
    const stats = [
      deltaRow(d.value, i > 0 && isFinite(data[i - 1].value) ? data[i - 1].value : null),
      total > 0 ? ['share of range', `${((d.value / total) * 100).toFixed(1)}%`] : null,
      average > 0
        ? (() => {
            const pct = Math.round(((d.value - average) / average) * 100);
            return ['vs average', `${pct >= 0 ? '+' : ''}${pct}%`, pct > 0 ? 'up' : pct < 0 ? 'down' : ''];
          })()
        : null,
    ];
    const flag =
      peak > 0 && d.value === peak
        ? 'highest in this range'
        : peak > 0 && d.value === trough
          ? 'lowest in this range'
          : '';
    return (
      tipHeader(d) +
      `<div class="t-row t-big"><span class="swatch" style="background:${color}"></span>` +
      `<strong>${esc(n(d.value))}</strong>${unit ? ` <span class="t-unit">${esc(unit)}</span>` : ''}</div>` +
      statRows(stats) +
      (flag ? `<div class="t-flag">${esc(flag)}</div>` : '') +
      `<div class="t-foot">${esc(n(total))}${unit ? ' ' + esc(unit) : ''} across the range · ${esc(average.toFixed(average < 10 ? 1 : 0))} per ${esc(unitWord(data))}</div>`
    );
  });

  withTableView(root, () =>
    // An unreadable bucket gets an empty cell, not a 0, for the same reason it
    // gets no bar. The table is the accessible twin of the picture and has to
    // agree with it about what is known.
    tableHtml([title || 'Value'], data.map((d) => [d.full || d.label, isFinite(d.value) ? n(d.value) : '']))
  );
  return root;
}

/**
 * "hour" or "day", read off the buckets rather than passed in twice.
 *
 * `at` only exists on rows that came through `fillBuckets`. Plotted straight
 * off the wire there is no timestamp to subtract, the arithmetic is NaN, and
 * NaN fails every comparison, so this settles on "day". That is the right way
 * round: "per day" under a chart of hours reads as a mistake in the label,
 * while "per hour" under a chart of days reads as a mistake in the numbers.
 */
function unitWord(data) {
  const step = data.length > 1 ? data[1].at - data[0].at : NaN;
  return isFinite(step) && step <= 3600000 ? 'hour' : 'day';
}

// ---------- line chart (two to four named series) ----------

/**
 * Several measures of the SAME kind over the same UTC buckets: likes, saves and
 * comments, say, which are all "things people did to a post" and all counted in
 * events. Lines rather than stacked columns because the question a multi-series
 * engagement chart answers is which one moved, and a stack answers how much
 * there was in total while actively hiding the middle bands' shape.
 *
 * `series` is `[{ key, label, data, color? }]` where `data` is the output of
 * `fillBuckets`, so every series is already dense and every series shares the
 * same bucket keys. Two to four of them: past four the lines cross often enough
 * that the reader is decoding rather than reading, and past four there is no
 * validated colour left to give.
 *
 * Colour is bound ONCE, here, from the position of the series in the array the
 * caller passed. It is never derived from rank, from the visible subset, or
 * from anything that can change between paints. That is what makes the legend
 * toggle safe: hiding "Saves" must not hand its orange to "Comments", because a
 * reader who looks away and back would then read the wrong line.
 *
 * Theme: every stroke, dot, halo and legend swatch below is a `var(--…)`, so a
 * light/dark switch repaints this chart without a redraw, exactly like the
 * ported ones.
 *
 * ACCEPTS, per series, `data` in any shape `readRows` understands: the
 * `[{ label, value }]` from `fillBuckets`, or the raw `[{ b, n }]` off the
 * series route. Raw rows lose the tooltip header and the second axis row, which
 * `fillBuckets` derives and the wire does not carry, and plot correctly
 * otherwise. No series at all, or series that are all empty, get an empty state
 * rather than a bare pair of gridlines.
 *
 * `label` is coerced to a string here rather than trusted, because it is
 * lowercased for the tooltip rows and a caller who passed a number would have
 * taken the tooltip down with a `toLowerCase is not a function` the first time
 * somebody hovered the chart.
 */
export function lineChart({ series, title = '', unit = '' }) {
  const root = document.createElement('div');
  root.className = 'chart';

  const lines = (Array.isArray(series) ? series : []).slice(0, SERIES.length).map((given, i) => {
    const s = given && typeof given === 'object' ? given : {};
    return {
      key: String(s.key || s.label || i),
      label: String(s.label || s.key || `Series ${i + 1}`),
      // Position in the caller's array, not position among the visible ones.
      color: s.color || SERIES[i % SERIES.length],
      data: readRows(s.data),
      on: true,
    };
  });

  /*
   * The bucket spine. Every series is supposed to be the same length because
   * they all came out of `fillBuckets` with the same span, but the longest one
   * is what the axis is drawn from, and a series that is short is drawn with a
   * BREAK in the line rather than a run of zeros. Zero is a claim: it says
   * nobody liked anything that hour. A missing bucket says we do not know.
   */
  const buckets = lines.reduce((longest, s) => (s.data.length > longest.length ? s.data : longest), []);

  /*
   * Two ways to have nothing: nobody passed a series, or every series came back
   * empty. They are different mistakes and worth different sentences, because
   * the first one is a bug in the view and the second one is a quiet week on
   * the box, and the operator reading the card is the person who can tell them
   * apart only if the card says which it is.
   */
  if (!lines.length) {
    return emptyChart('Nothing to plot', 'This chart was given no series, so there is nothing to draw');
  }
  if (!buckets.length) {
    return emptyChart('Nothing to plot', 'No buckets came back for this range, so there is nothing to draw');
  }

  // A legend for two or more, never for one: with one series the card title
  // already names what is plotted and a lone swatch just says it again.
  let legend = null;
  if (lines.length > 1) {
    legend = document.createElement('div');
    legend.className = 'chart-legend';
    root.append(legend);
  }

  const plot = document.createElement('div');
  plot.style.position = 'relative';
  root.append(plot);

  /*
   * The scale the last paint used, kept so the hover crosshair can place its
   * dots without re-deriving `max`, `band` and the padding from scratch. It is
   * written by every repaint and read only from a pointer handler, and a
   * pointer handler cannot run before the first frame has painted, so there is
   * no window where this is null while something needs it.
   */
  let geom = null;

  const visible = () => lines.filter((l) => l.on);

  const repaint = responsive(plot, (width) => {
    const padL = 46;
    const padR = 8;
    const padT = 10;
    const plotH = 150;
    const axisH = 38;
    const innerW = Math.max(20, width - padL - padR);
    const band = innerW / Math.max(1, buckets.length);
    const live = visible();
    /*
     * The scale follows what is actually shown. Hiding a series is a deliberate
     * "let me see the small one" and leaving the axis pinned to the hidden
     * giant would answer that request with a flat line along the bottom. The
     * COLOURS do not move when this happens, which is the invariant that
     * matters; the axis is allowed to, and it is labelled, so it says so.
     */
    // Folded rather than spread, and every point tested. `Math.max` over an
    // array holding one NaN is NaN, `niceMax(NaN)` falls back to a ceiling of
    // 1, and every line in the chart then leaves the top of the plot: one
    // unreadable point in one series would have broken the axis for all four.
    const max = niceMax(
      live.reduce(
        (best, l) => l.data.reduce((inner, d) => (isFinite(d.value) && d.value > inner ? d.value : inner), best),
        0
      )
    );
    // Points sit at band CENTRES, the same place a column would stand, which is
    // what lets the crosshair band and the tick under it mean the same bucket.
    const x = (i) => padL + i * band + band / 2;
    const y = (value) => padT + plotH - (value / max) * plotH;
    geom = { x, y, band, padT, plotH };

    const grid = [0, max / 2, max]
      .map(
        (t) =>
          `<line x1="${padL}" y1="${y(t).toFixed(1)}" x2="${width - padR}" y2="${y(t).toFixed(1)}" stroke="var(--grid)" stroke-width="1"/>` +
          `<text class="chart-axis" x="${padL - 8}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end">${compact(t)}</text>`
      )
      .join('');

    // A dot per point only when the bands are wide enough to carry them. On a
    // seven day range the dots are the whole point (three points with no marks
    // reads as a triangle, not as data); on a 168 hour range they would be a
    // solid rope. No area fill under any of them: overlapping translucent areas
    // invent colours that are not in the palette.
    const marks = band >= 22;
    const paths = live
      .map((l) => {
        let d = '';
        let open = false;
        let dots = '';
        buckets.forEach((_, i) => {
          const point = l.data[i];
          if (!point || !isFinite(point.value)) {
            open = false;
            return;
          }
          d += `${open ? 'L' : 'M'}${x(i).toFixed(1)} ${y(point.value).toFixed(1)}`;
          open = true;
          if (marks) {
            dots += `<circle cx="${x(i).toFixed(1)}" cy="${y(point.value).toFixed(1)}" r="2.6" fill="${l.color}"/>`;
          }
        });
        if (!d) return '';
        return (
          `<path d="${d}" fill="none" stroke="${l.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` +
          dots
        );
      })
      .join('');

    const stride = Math.max(1, Math.ceil((buckets.length * 46) / innerW));
    const hits = buckets
      .map((b, i) => {
        /*
         * `data-top` is the TOPMOST MARK at this bucket, not the top of the hit
         * area. The hit area is the full plot height (that is what makes a
         * crosshair feel like a crosshair) so anchoring to it would leave the
         * tooltip no room above and flip it below on every single bucket,
         * covering whatever chart sits underneath.
         */
        const top = live.reduce((best, l) => {
          const point = l.data[i];
          if (!point || !isFinite(point.value)) return best;
          return Math.min(best, y(point.value));
        }, padT + plotH);
        const label = labelled(i, buckets.length, stride, band)
          ? `<text class="chart-axis" x="${x(i).toFixed(1)}" y="${padT + plotH + 14}" text-anchor="middle">${esc(b.label)}</text>`
          : '';
        /*
         * The hit area keeps the 24px floor from the column charts so a dense
         * hourly range is still hoverable, but the highlight BAND must stay one
         * bucket wide or a 3px band would light up six buckets at once. Hence
         * the separate `data-band-*`: the thing you can hit and the thing that
         * lights up are not the same rectangle here.
         */
        return (
          `<rect class="hit" data-i="${i}" data-top="${top.toFixed(1)}" data-band-x="${(padL + i * band).toFixed(1)}" data-band-w="${Math.max(1, band).toFixed(1)}" ` +
          `x="${(x(i) - Math.max(12, band / 2)).toFixed(1)}" y="${padT}" width="${Math.max(24, band).toFixed(1)}" height="${plotH}" fill="transparent"/>` +
          label
        );
      })
      .join('');

    // The crosshair dots are created once per paint and MOVED on hover, never
    // created on hover: making elements inside a pointermove is how a chart
    // starts dropping frames on a trackpad. The halo is the surface token for
    // the same reason the sparkline's is, so it works on either ground.
    //
    // `data-dot` carries the SERIES index and doubles as the selector. It is an
    // attribute rather than a class because the sheet has no rule for these and
    // should not need one: everything about them is geometry, set from script.
    const focusDots = lines
      .map(
        (l, i) =>
          `<circle data-dot="${i}" cx="0" cy="0" r="3.6" opacity="0" fill="${l.color}" stroke="var(--surface-1)" stroke-width="2"/>`
      )
      .join('');

    return `<svg height="${padT + plotH + axisH}" width="${width}" viewBox="0 0 ${width} ${padT + plotH + axisH}">
      <rect class="band" x="0" y="${padT}" width="0" height="${plotH}" fill="var(--surface-2)" opacity="0" rx="2"/>
      ${grid}
      <line x1="${padL}" y1="${padT + plotH}" x2="${width - padR}" y2="${padT + plotH}" stroke="var(--axis)" stroke-width="1"/>
      ${paths}
      ${focusDots}
      ${hits}
      ${groupAxis(groupTicks(buckets), { padL, padR, padT, plotH, band, width })}
    </svg>`;
  });

  /** Moves the crosshair dots onto the hovered bucket, or parks them. */
  const focus = (index) => {
    plot.querySelectorAll('[data-dot]').forEach((dot) => {
      const line = lines[Number(dot.dataset.dot)];
      const point = index >= 0 && line && line.on ? line.data[index] : null;
      if (!point || !geom || !isFinite(point.value)) {
        dot.setAttribute('opacity', '0');
        return;
      }
      dot.setAttribute('cx', geom.x(index).toFixed(1));
      dot.setAttribute('cy', geom.y(point.value).toFixed(1));
      dot.setAttribute('opacity', '1');
    });
  };

  const rangeTotal = lines.reduce(
    (sum, l) => sum + l.data.reduce((inner, d) => inner + (isFinite(d.value) ? d.value : 0), 0),
    0
  );

  const resetTip = wireTooltip(
    plot,
    buckets,
    (bucket, i) => {
      const live = visible();
      const at = (l, index) => (l.data[index] && isFinite(l.data[index].value) ? l.data[index].value : 0);
      /*
       * Rows stay in the caller's order, never sorted by value. A tooltip that
       * reorders itself as you sweep across the chart has to be re-read at every
       * bucket, which is slower than reading a fixed list even though each
       * individual reading is easier. The swatch is what links a row to a line.
       */
      const rows = live
        .map(
          (l) =>
            `<div class="t-row t-big"><span class="swatch" style="background:${l.color}"></span>` +
            `<strong>${esc(n(at(l, i)))}</strong> <span class="t-unit">${esc(l.label.toLowerCase())}</span></div>`
        )
        .join('');
      const here = live.reduce((sum, l) => sum + at(l, i), 0);
      const before = i > 0 ? live.reduce((sum, l) => sum + at(l, i - 1), 0) : null;
      const stats = [
        live.length > 1 ? ['all series here', n(here)] : null,
        deltaRow(here, before),
      ];
      // The foot is the only place the measure gets NAMED inside the tooltip.
      // A column chart borrows that from its card title, which sits directly
      // above a single plot; here the reader may have three lines and a legend
      // between them and the heading, so it is worth repeating.
      const foot = [
        title,
        `${n(rangeTotal)}${unit ? ' ' + unit : ''} across the range, every series`,
        lines.length > 1 ? `${lines.length} series` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      return tipHeader(bucket) + rows + statRows(stats) + `<div class="t-foot">${esc(foot)}</div>`;
    },
    focus
  );

  if (legend) {
    lines.forEach((line) => {
      /*
       * A real <button>, because this thing does something and a <span> that
       * does something is invisible to a keyboard and to a screen reader. It
       * carries `aria-pressed`, so the state is announced rather than only
       * dimmed.
       *
       * The inline reset undoes the user agent's button chrome. It is here
       * rather than in the sheet only because the sheet's `.key` was written
       * for the static legend on `divergingChart`, which is a span, and a
       * legend that renders as three grey OS buttons the day someone forgets
       * the extra rule is worse than one line of style travelling with the
       * element that needs it.
       */
      const key = document.createElement('button');
      key.type = 'button';
      key.className = 'key';
      key.style.cssText = 'background:none;border:0;padding:0;font:inherit;color:inherit;cursor:pointer';
      key.setAttribute('aria-pressed', 'true');
      key.innerHTML = `<span class="swatch" style="background:${line.color}"></span>${esc(line.label)}`;
      key.onclick = () => {
        // Never let the last one go dark. An empty plot is a dead end with no
        // affordance saying how to get out of it, and the operator who did it
        // by accident has to guess that clicking a greyed word brings it back.
        if (line.on && visible().length === 1) return;
        line.on = !line.on;
        key.setAttribute('aria-pressed', line.on ? 'true' : 'false');
        /*
         * The muted state is set inline rather than left to a class, because a
         * control whose state you cannot see is worse than no control at all
         * and this component cannot assume the sheet carries a rule for it. The
         * sheet is welcome to style `.chart-legend .key[aria-pressed="false"]`
         * on top of this; nothing here fights it.
         */
        key.style.opacity = line.on ? '' : '0.42';
        // The tooltip caches the rendered bucket, so without this a series that
        // was hidden while the tooltip was open stays listed until the pointer
        // crosses into a different bucket.
        resetTip();
        repaint();
      };
      legend.append(key);
    });
  }

  withTableView(root, () =>
    /*
     * The table lists EVERY series, including the ones hidden in the plot.
     * Hiding a line is a viewing choice about the picture; it is not a claim
     * that the number does not exist, and the table is the accessible twin, so
     * it must never be the smaller of the two.
     */
    tableHtml(
      lines.map((l) => l.label),
      buckets.map((b, i) => [
        b.full || b.label,
        ...lines.map((l) => (l.data[i] && isFinite(l.data[i].value) ? n(l.data[i].value) : '')),
      ])
    )
  );
  return root;
}

// ---------- diverging columns (in vs out) ----------

/**
 * Two directions around a shared zero baseline: one above, one below.
 *
 * This is the diverging form rather than two stacked series, because the
 * question is polarity — did the day put more in than it took out — and a
 * stack answers "how much in total" instead.
 *
 * ACCEPTS `[{ label, up, down }]`, and takes the label from `k` or `b` as well
 * so a grouped query can be plotted without renaming its columns first. Unlike
 * the column and line charts, an unreadable `up` or `down` is drawn as zero
 * rather than as a gap: this form has no way to say "missing" (a bar of no
 * height IS the picture for zero here, on both sides of the axis), so the
 * choice is between a zero and a NaN in the geometry, and a NaN in an SVG path
 * takes the whole chart out. Rows with nothing readable on either side are
 * still counted and still drawn, at zero, which is what the axis shows.
 */
export function divergingChart({ data: rows, upLabel = 'In', downLabel = 'Out' }) {
  const data = readRows(rows).map((row) => {
    const up = readNumber(row.up);
    const down = readNumber(row.down);
    return { ...row, up: isFinite(up) ? up : 0, down: isFinite(down) ? down : 0 };
  });
  if (!data.length) {
    return emptyChart('Nothing to plot', 'No buckets came back for this range, so there is nothing to draw');
  }

  const root = document.createElement('div');
  root.className = 'chart';

  const upColor = SERIES[0];
  const downColor = SERIES[1];
  root.innerHTML = `<div class="chart-legend">
    <span class="key"><span class="swatch" style="background:${upColor}"></span>${esc(upLabel)}</span>
    <span class="key"><span class="swatch" style="background:${downColor}"></span>${esc(downLabel)}</span>
  </div>`;

  const plot = document.createElement('div');
  plot.style.position = 'relative';
  root.append(plot);

  const max = niceMax(Math.max(...data.map((d) => Math.max(d.up, d.down)), 0));

  responsive(plot, (width) => {
    const padL = 52;
    const padR = 8;
    const padT = 8;
    const half = 74;
    const axisH = 38;
    const zero = padT + half;
    const innerW = Math.max(20, width - padL - padR);
    const band = innerW / Math.max(1, data.length);
    const barW = Math.max(2, Math.min(24, band - 2));

    const grid = [max, 0, -max]
      .map((t) => {
        const yy = zero - (t / max) * half;
        return (
          `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${width - padR}" y2="${yy.toFixed(1)}" stroke="${t === 0 ? 'var(--axis)' : 'var(--grid)'}" stroke-width="1"/>` +
          `<text class="chart-axis" x="${padL - 8}" y="${(yy + 3.5).toFixed(1)}" text-anchor="end">${compact(Math.abs(t))}</text>`
        );
      })
      .join('');

    const stride = Math.max(1, Math.ceil((data.length * 46) / innerW));
    const bars = data
      .map((d, i) => {
        const x = padL + i * band + (band - barW) / 2;
        const upH = (d.up / max) * half;
        const downH = (d.down / max) * half;
        const label = labelled(i, data.length, stride, band)
          ? `<text class="chart-axis" x="${(padL + i * band + band / 2).toFixed(1)}" y="${zero + half + 15}" text-anchor="middle">${esc(d.label)}</text>`
          : '';
        return (
          `<path d="${barPath(x, zero - upH, barW, upH, 4)}" fill="${upColor}"/>` +
          // Mirrored: the rounded end is the data end, so it points downward.
          `<g transform="translate(0 ${(zero * 2).toFixed(1)}) scale(1 -1)"><path d="${barPath(x, zero - downH, barW, downH, 4)}" fill="${downColor}"/></g>` +
          `<rect class="hit" data-i="${i}" data-top="${(zero - upH).toFixed(1)}" x="${(padL + i * band + band / 2 - Math.max(12, band / 2)).toFixed(1)}" y="${padT}" width="${Math.max(24, band).toFixed(1)}" height="${half * 2}" fill="transparent"/>` +
          label
        );
      })
      .join('');

    return `<svg height="${zero + half + axisH}" width="${width}" viewBox="0 0 ${width} ${zero + half + axisH}">
      <rect class="band" x="0" y="${padT}" width="0" height="${half * 2}" fill="var(--surface-2)" opacity="0" rx="4"/>
      ${grid}${bars}
      ${groupAxis(groupTicks(data), { padL, padR, padT, plotH: half * 2, band, width })}
    </svg>`;
  });

  const totalUp = data.reduce((sum, d) => sum + d.up, 0);
  const totalDown = data.reduce((sum, d) => sum + d.down, 0);

  wireTooltip(plot, data, (d, i) => {
    const net = d.up - d.down;
    const previous = i > 0 ? data[i - 1] : null;
    const stats = [
      // Net is the whole reason this is a diverging chart rather than two
      // stacked series: the question is which way the day went.
      ['net', `${net >= 0 ? '+' : ''}${n(net)}`, net > 0 ? 'up' : net < 0 ? 'down' : ''],
      deltaRow(net, previous ? previous.up - previous.down : null),
      totalUp > 0 ? [`share of ${upLabel.toLowerCase()}`, `${((d.up / totalUp) * 100).toFixed(1)}%`] : null,
    ];
    return (
      tipHeader(d) +
      `<div class="t-row t-big"><span class="swatch" style="background:${upColor}"></span>` +
      `<strong>${esc(n(d.up))}</strong> <span class="t-unit">${esc(upLabel.toLowerCase())}</span></div>` +
      `<div class="t-row t-big"><span class="swatch" style="background:${downColor}"></span>` +
      `<strong>${esc(n(d.down))}</strong> <span class="t-unit">${esc(downLabel.toLowerCase())}</span></div>` +
      statRows(stats) +
      `<div class="t-foot">${esc(n(totalUp))} in, ${esc(n(totalDown))} out across the range · net ${totalUp - totalDown >= 0 ? '+' : ''}${esc(n(totalUp - totalDown))}</div>`
    );
  });

  withTableView(root, () =>
    tableHtml([upLabel, downLabel, 'Net'], data.map((d) => [d.full || d.label, n(d.up), n(d.down), n(d.up - d.down)]))
  );
  return root;
}

// ---------- horizontal magnitude list ----------

/**
 * Magnitude across nominal categories: one hue for every row, length carrying
 * the value. Never a colour ramp — the bar already shows the size, and
 * darker-where-bigger burns the only free channel restating it.
 *
 * No table-view twin on this one, and that is not an omission: every label and
 * every value is already sitting there as selectable text in reading order, so
 * a table view would be the same list printed twice.
 *
 * ## Shapes, and the bug this signature caused
 *
 * ACCEPTS `[{ label, value }]` and the wire's `[{ k, n }]` / `[{ b, n }]`. That
 * second one is not a nicety: `stats.top_tags`, `stats.by_surface`,
 * `stats.tables`, `stats.switches` and `risk.posture` are all `{ k, n }`, and
 * this component is what Pulse, Tags and Storage draw them with. The old body
 * read `r.value` with no fallback, so `barList(stats.top_tags)` rendered a
 * column of empty tracks with blank labels and no numbers: the tags panel said
 * "no tags" about a box with plenty of them, and nothing anywhere threw or
 * warned. A blank panel that should have been full is the worst failure a
 * dashboard has, because nobody goes looking for the cause of good news.
 *
 * Rows with nothing readable in them are SKIPPED rather than counted as zero,
 * and the list says how many it skipped. One NaN in a `Math.max` is NaN, one
 * NaN in the total makes every share NaN, and `width:NaN%` is a declaration the
 * CSS parser drops, so a single bad row used to flatten every bar in the list
 * including the good ones.
 */
export function barList(rows, { color = SERIES[0], format = n, max: forced } = {}) {
  // Same reason as the donut's: a caller passing `format: null` explicitly gets
  // the default rather than a throw out of the first row.
  if (typeof format !== 'function') format = n;

  const root = document.createElement('div');
  root.className = 'barlist';

  const given = readRows(rows);
  const live = drawable(given);
  if (!live.length) {
    /*
     * Two different nothings, said differently. No rows at all is a quiet
     * window, which is a fact about the box. Rows that came back unreadable is
     * a fact about the wiring, and an operator who sees the second sentence has
     * something to report; one who sees the first has nothing to do.
     */
    root.innerHTML = given.length
      ? emptyState(
          'Nothing readable to rank',
          'Rows came back for this window, but not one of them carried a number this list could read'
        )
      : emptyState('Nothing to rank', 'Nothing has been counted in this window yet, so there is nothing to rank');
    return root;
  }

  const asked = readNumber(forced);
  // A caller-supplied ceiling is honoured only when it is a usable one. A zero
  // or a negative would divide every bar into a nonsense width, and the point
  // of passing one at all is to share a scale across several lists.
  const max = isFinite(asked) && asked > 0 ? asked : Math.max(...live.map((row) => row.value), 1);
  const total = live.reduce((sum, row) => sum + row.value, 0);

  const bars = live
    .map((row) => {
      // No tooltip layer here: the value is already on the row, so hover only
      // has to add the one thing it does not say, which is the share. A title
      // attribute is enough for that and costs no elements.
      const share = total > 0 ? `, ${((row.value / total) * 100).toFixed(1)}% of ${n(total)}` : '';
      // Clamped, because a bar is a picture of a proportion and neither end of
      // it can be outside the track. A row above a caller-supplied ceiling runs
      // to the end and stops there rather than overflowing the box, and a
      // negative one draws nothing rather than a width the parser discards.
      const fill = Math.max(0, Math.min(100, (row.value / max) * 100));
      return `<div class="barlist-row" title="${esc(row.label)}: ${esc(format(row.value))}${esc(share)}">
        <span class="truncate">${esc(row.label)}</span>
        <span class="barlist-track"><span class="barlist-fill" style="width:${fill.toFixed(1)}%;background:${color}"></span></span>
        <span class="barlist-val">${esc(format(row.value))}</span>
      </div>`;
    })
    .join('');

  // Skipped rows are reported rather than swallowed. A list that is quietly
  // shorter than the data behind it is the same silent wrong answer this whole
  // function exists to stop, just in a smaller size.
  const skipped = given.length - live.length;
  const note = skipped
    ? `<p class="muted tiny" style="margin:0">${esc(
        skipped === 1 ? '1 row carried no readable number and is not shown' : `${n(skipped)} rows carried no readable number and are not shown`
      )}</p>`
    : '';

  root.innerHTML = bars + note;
  return root;
}

// ---------- donut (a split of one whole) ----------

/**
 * How one total divides: the surface split, and anything else that is genuinely
 * parts of a single whole. Not a general comparison chart. If the rows do not
 * add up to something the reader thinks of as one number, they want `barList`.
 *
 * `rows` is `[{ label, value }]` (the wire's `{ k, n }` is accepted too, since
 * every aggregate on this box speaks that shape and mapping it at eleven call
 * sites is eleven chances to typo it). `total` is the true denominator when the
 * caller only passed a top N, so the shares do not quietly renormalise to the
 * rows that happened to be included.
 *
 * COLOUR IS NEVER THE ONLY CARRIER. Every slice's label and value sit in the
 * legend beside the ring, and the legend is part of this component rather than
 * something a caller can forget: a ring with a colour key three lines down is a
 * memory test, and a ring with no key at all is decoration. Slices at or above
 * about 3% also carry their percentage on the ring itself; below that the text
 * is wider than the arc it belongs to and pointing at it with a leader line
 * costs more clutter than it buys, so the legend carries those alone.
 *
 * Theme: the ring, the track behind it, the label halos and the legend swatches
 * are all tokens, so this repaints on a theme switch with no redraw and no
 * observer, same as the rest of the file.
 *
 * ACCEPTS `[{ label, value }]` and the wire's `[{ k, n }]`, which is what
 * `stats.by_surface` and `stats.tables` are. Anything that is not an array at
 * all, and an array with no rows in it, get an empty state: a ring drawn as a
 * bare track with "0 total" in the hole is a picture of a working chart with
 * nothing in it, and there is no way for the reader to tell that apart from a
 * request that failed.
 *
 * A row whose number cannot be read counts as zero here rather than being
 * dropped, because this component is about how a whole divides and a category
 * silently missing from the ring changes what every other slice's share means.
 * It keeps its legend row, at zero, where it can be seen.
 */
export function donut({ rows, total, format = n }) {
  // A caller passing `format: null` would otherwise take the chart down: a
  // default parameter only fires for `undefined`, and every branch below calls
  // this thing at least once.
  if (typeof format !== 'function') format = n;

  const all = readRows(rows).map((row, i) => ({
    label: String(row.label),
    value: isFinite(row.value) ? row.value : 0,
    at: i,
  }));
  if (!all.length) {
    return emptyChart('Nothing to split', 'No categories came back, so there is no whole to divide up');
  }

  const root = document.createElement('div');
  root.className = 'chart';

  const rowsTotal = all.reduce((sum, s) => sum + s.value, 0);
  const given = Number(total);
  // A caller-supplied total that is SMALLER than the rows is a caller bug, not
  // a residual, and honouring it would draw a ring that overflows itself. The
  // rows are the thing actually being drawn, so they win.
  const sum = isFinite(given) && given > rowsTotal ? given : rowsTotal;

  /*
   * Four validated slots, and the surface enum on this box has five values, so
   * folding is not a corner case here, it is Tuesday. The smallest categories
   * are the ones that get folded (that is what a reader expects from a pie),
   * but the survivors keep the CALLER's order so the colour a category gets
   * comes from where it sits in the enum rather than from how it placed today.
   *
   * Perfect colour stability is impossible once there are more categories than
   * slots, and when something has to give it is the colour, never the label:
   * every folded row still appears in the legend with its own name and its own
   * number, drawn in the neutral so it visibly belongs to the grouped arc.
   */
  const positive = all.filter((s) => s.value > 0);
  const winners = new Set(
    positive
      .slice()
      .sort((a, b) => b.value - a.value)
      .slice(0, SERIES.length)
      .map((s) => s.at)
  );
  const drawn = positive.filter((s) => winners.has(s.at));
  drawn.forEach((s, i) => {
    s.color = SERIES[i % SERIES.length];
  });
  const folded = positive.filter((s) => !winners.has(s.at));
  folded.forEach((s) => {
    s.color = NEUTRAL;
  });

  const drawnTotal = drawn.reduce((carry, s) => carry + s.value, 0);
  const rest = sum - drawnTotal;
  const slices = drawn.slice();
  if (rest > 0.5) {
    // Everything the ring could not draw as itself: the folded tail, plus any
    // gap between the rows and a caller-supplied total.
    slices.push({ label: 'Other', value: rest, color: NEUTRAL, at: -1, rest: true });
  }

  /*
   * The ring and the legend sit side by side in `.donut`, which is the sheet's
   * flex row, and the legend is `.donut-legend`, whose `.key` rows are a fixed
   * three column grid of swatch, label, value. Those class names are a contract
   * with styles.css, not decoration: the sheet pins the ring to 150 square
   * through `.donut svg`, which is why the size below is a constant rather than
   * something measured. Drawing at any other size would just be handing the
   * browser a scale factor, and a scaled SVG scales its stroke widths with it,
   * which is the one thing every chart in this file is arranged to avoid.
   */
  const shell = document.createElement('div');
  shell.className = 'donut';
  const plot = document.createElement('div');
  plot.style.position = 'relative';
  const legendBox = document.createElement('div');
  legendBox.className = 'donut-legend';
  shell.append(plot, legendBox);
  root.append(shell);

  /*
   * A one-shot paint rather than `responsive`, and that is deliberate. The ring
   * is a fixed square, so there is nothing for a ResizeObserver to react to,
   * and worse: `responsive` refuses to draw while its container measures under
   * 40px, and this container is a bare div whose width comes entirely FROM the
   * SVG it does not have yet. It would sit at zero width, decline to paint, and
   * stay empty forever. The SVG still goes in its own child, for the same
   * reason it does everywhere else here: the tooltip lives in `plot`, and an
   * `innerHTML =` on `plot` would take it with it.
   */
  const canvas = document.createElement('div');
  plot.append(canvas);

  ((size) => {
    const cx = size / 2;
    const cy = size / 2;
    // A ring rather than a pie: the hole is where the total goes, and a total
    // in the middle is the number people actually came for.
    const thickness = Math.max(16, Math.round(size * 0.17));
    const r = (size - thickness) / 2 - 1;
    const circumference = 2 * Math.PI * r;

    /*
     * Slices are stroked arcs on one circle rather than filled wedge paths.
     * Arithmetic aside, this is what makes the 100% case work: a wedge from 0
     * to 2π has its start and end at the same point and collapses to nothing,
     * which is a classic donut bug that only shows up the day one category
     * takes everything. A dash the length of the whole circumference is just a
     * ring, with no special case anywhere.
     */
    const gap = slices.length > 1 ? 2 : 0;
    let carried = 0;
    let arcs = '';
    let hits = '';
    let labels = '';

    slices.forEach((slice, i) => {
      const fraction = sum > 0 ? slice.value / sum : 0;
      const length = fraction * circumference;
      const dash = Math.max(0.6, length - gap);
      const offset = (1 - carried) * circumference;
      // `data-arc` rather than a class, because this is a behaviour hook and
      // not a style hook: nothing in the sheet has an opinion about a slice,
      // and a class name that no rule matches is a promise nobody made.
      arcs +=
        `<circle data-arc="${i}" cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="none" stroke="${slice.color}" stroke-width="${thickness}" ` +
        `stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`;

      // The mid-angle, used for the on-ring label and for telling the tooltip
      // where the mark it belongs to actually is.
      const mid = (carried + fraction / 2) * Math.PI * 2 - Math.PI / 2;
      const mx = cx + Math.cos(mid) * r;
      const my = cy + Math.sin(mid) * r;

      if (fraction >= 0.03) {
        /*
         * The halo trick: the same text painted once as a fat stroke in the
         * surface colour and once as a fill, with `paint-order` putting the
         * stroke underneath. That gives a legible label on ANY slice hue in
         * either theme without picking a text colour per slice, which cannot be
         * done from CSS variables anyway.
         */
        labels +=
          `<text class="chart-axis chart-axis-group" x="${mx.toFixed(1)}" y="${(my + 3.6).toFixed(1)}" text-anchor="middle" ` +
          `stroke="var(--surface-1)" stroke-width="3" paint-order="stroke" stroke-linejoin="round">${esc(Math.round(fraction * 100) + '%')}</text>`;
      }

      // Transparent, thicker, and drawn last so it sits on top: `transparent`
      // is a paint, unlike `none`, so it hit-tests. The dash pattern is copied
      // so only this slice's own arc is hoverable.
      hits +=
        `<circle class="hit" data-i="${i}" data-top="${(my - thickness / 2).toFixed(1)}" data-cx="${mx.toFixed(1)}" cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" ` +
        `fill="none" stroke="transparent" stroke-width="${thickness + 8}" ` +
        `stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`;

      carried += fraction;
    });

    // `String()` because a caller's formatter is free to hand back a number,
    // and the size test below asks it for a `.length`.
    const centre = String(format(sum));
    canvas.innerHTML = `<svg height="${size}" width="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="none" stroke="var(--line-soft)" stroke-width="${thickness}"/>
      ${arcs}
      ${labels}
      <text x="${cx}" y="${(cy + 2).toFixed(1)}" text-anchor="middle" fill="var(--ink)" font-size="${centre.length > 7 ? 15 : 19}" font-weight="600">${esc(centre)}</text>
      <text class="chart-axis" x="${cx}" y="${(cy + 18).toFixed(1)}" text-anchor="middle">total</text>
      ${hits}
    </svg>`;
    // 150, because `.donut svg` in styles.css says 150. The two have to agree
    // or the browser scales the drawing and every stroke width in it.
  })(150);

  /** Dims every slice except the hovered one, so the ring answers the tooltip. */
  const focus = (index) => {
    plot.querySelectorAll('[data-arc]').forEach((arc) => {
      arc.setAttribute('opacity', index < 0 || Number(arc.dataset.arc) === index ? '1' : '0.32');
    });
  };

  wireTooltip(
    plot,
    slices,
    (slice) => {
      const share = sum > 0 ? ((slice.value / sum) * 100).toFixed(1) : '0.0';
      return (
        tipHeader(slice) +
        `<div class="t-row t-big"><span class="swatch" style="background:${slice.color}"></span>` +
        `<strong>${esc(format(slice.value))}</strong></div>` +
        statRows([['share of total', `${share}%`]]) +
        (slice.rest ? '<div class="t-flag">the smallest categories, grouped</div>' : '') +
        `<div class="t-foot">${esc(format(sum))} across every slice</div>`
      );
    },
    focus
  );

  /*
   * The legend lists every row the caller passed, in the caller's order,
   * including the zero ones. A category that scored nothing this week is a
   * fact worth showing, and a legend that silently drops it makes the reader
   * wonder whether the category exists at all.
   *
   * Three children per row, because `.donut-legend .key` is a three column
   * grid of swatch, label, value and a fourth child would wrap onto an implicit
   * row of its own. The share rides inside the value cell for that reason, and
   * because the percentage is the one number the ring cannot state exactly.
   *
   * A row that got folded into Other is drawn in the neutral, so the legend and
   * the ring agree about which arc it is part of without either of them having
   * to say it twice.
   */
  const legendRows = all
    .map((item) => {
      const hue = item.color || NEUTRAL;
      const share = sum > 0 ? ((item.value / sum) * 100).toFixed(1) : '0.0';
      return `<div class="key" title="${esc(item.label)}: ${esc(format(item.value))}, ${esc(share)}% of ${esc(format(sum))}">
        <span class="swatch" style="background:${hue}"></span>
        <span class="truncate">${esc(item.label)}</span>
        <span class="num">${esc(format(item.value))} <span class="muted">${esc(share)}%</span></span>
      </div>`;
    })
    .join('');
  /*
   * The ring is allowed to draw one arc the legend has no row for, and there
   * are two ways to get one: the folded tail, and the gap between the rows and
   * a caller-supplied total that is bigger than them (which is the whole point
   * of passing a total with a top N). Both have to be said out loud. An arc
   * with no explanation anywhere is the reader assuming the chart is broken,
   * and they would be right to: an unexplained slice is an unexplained number.
   */
  const notes = [];
  if (folded.length === 1) {
    notes.push('The smallest category is grouped as Other on the ring, and keeps its own row here');
  } else if (folded.length > 1) {
    notes.push(`The smallest ${folded.length} categories are grouped as Other on the ring, and keep their own rows here`);
  }
  if (sum - rowsTotal > 0.5) {
    notes.push(`Other on the ring also covers ${format(sum - rowsTotal)} that these rows do not account for`);
  }
  // The notes are grid items in the legend like the rows are, so the gap that
  // separates the rows separates them too and no margin has to be invented.
  legendBox.innerHTML =
    legendRows + notes.map((text) => `<p class="muted tiny" style="margin:0">${esc(text)}</p>`).join('');

  withTableView(root, () =>
    tableHtml(
      ['Value', 'Share'],
      all.map((row) => [row.label, format(row.value), `${sum > 0 ? ((row.value / sum) * 100).toFixed(1) : '0.0'}%`]),
      'Slice'
    )
  );
  return root;
}

// ---------- shared ----------

// ---------- tooltip content ----------

/** The date block every tooltip leads with. */
function tipHeader(item) {
  const sub = [item.range, item.local].filter(Boolean).join(' · ');
  return (
    `<span class="t-label">${esc(item.full || item.tip || item.label)}</span>` +
    (sub ? `<span class="t-sub">${esc(sub)}</span>` : '')
  );
}

/** `[label, value, direction]` triples, laid out as a small two-column grid. */
function statRows(rows) {
  const live = rows.filter(Boolean);
  if (!live.length) return '';
  return `<div class="t-stats">${live
    .map(([k, v, dir]) => `<div><span>${esc(k)}</span><b class="${dir || ''}">${esc(v)}</b></div>`)
    .join('')}</div>`;
}

/**
 * Change against the previous bucket.
 *
 * A percentage against zero is infinity, which reads as a bug, so a rise from
 * nothing is reported as the raw count and called "from none".
 */
function deltaRow(current, previous) {
  if (previous === null || previous === undefined) return null;
  const diff = current - previous;
  const dir = diff > 0 ? 'up' : diff < 0 ? 'down' : '';
  if (diff === 0) return ['vs previous', 'no change', ''];
  if (!previous) return ['vs previous', `+${n(diff)} from none`, dir];
  const pct = Math.round((diff / Math.abs(previous)) * 100);
  return ['vs previous', `${diff > 0 ? '+' : ''}${n(diff)} (${diff > 0 ? '+' : ''}${pct}%)`, dir];
}

/**
 * Hover: a highlight band, and a tooltip that answers more than "what is this
 * bar".
 *
 * `render(item, index)` returns the whole tooltip body, so each chart decides
 * what context is worth showing. The band is a rect already in the SVG that
 * gets moved rather than created, so hovering never touches layout.
 *
 * `onFocus(index)` is the hook for anything else that has to follow the
 * pointer: the line chart's crosshair dots, the donut's dimming of the slices
 * it is not talking about. It is called with -1 on leave. Charts that want
 * neither simply do not pass it.
 *
 * The tooltip flips below the cursor when there is no room above it. Without
 * that, the tall version clips off the top of the card on the first row of
 * charts, which is exactly where the eye goes first.
 *
 * Returns a `reset`, for the case where the DATA changed while the tooltip was
 * open: the rendered body is cached per index, so hiding the element alone
 * would show the stale body again the moment the pointer re-entered the same
 * bucket.
 */
function wireTooltip(plot, data, render, onFocus) {
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  plot.append(tip);

  let shown = -1;

  const hide = () => {
    // `pointermove` fires on the gaps between marks too (the plot's margins,
    // the hole in the middle of a donut), so this runs many times per second
    // while nothing is shown. Bailing on the already-hidden case is what keeps
    // the `onFocus` sweep out of that path.
    if (shown === -1 && tip.hidden) return;
    tip.hidden = true;
    shown = -1;
    const band = plot.querySelector('.band');
    if (band) band.setAttribute('opacity', '0');
    if (onFocus) onFocus(-1);
  };

  const show = (ev) => {
    const hit = ev.target.closest('.hit');
    if (!hit) return hide();
    const index = Number(hit.dataset.i);
    const item = data[index];
    if (!item) return hide();

    if (index !== shown) {
      tip.innerHTML = render(item, index);
      shown = index;
    }
    tip.hidden = false;

    const band = plot.querySelector('.band');
    if (band) {
      /*
       * `data-band-*` when the chart has one, the hit rect's own geometry
       * otherwise. The two are the same rectangle on a column chart, and they
       * are not on a line chart: there the hit area is widened to a 24px floor
       * so a dense hourly range stays hoverable, while the band has to stay one
       * bucket wide or the highlight claims six buckets at once.
       */
      band.setAttribute('x', hit.dataset.bandX || hit.getAttribute('x'));
      band.setAttribute('width', hit.dataset.bandW || hit.getAttribute('width'));
      band.setAttribute('opacity', '1');
    }

    const box = plot.getBoundingClientRect();
    const hitBox = hit.getBoundingClientRect();
    /*
     * `data-cx` when the hit element's bounding box is not the mark. A donut
     * slice is a dashed arc on a full circle, so its box is the whole circle
     * and every slice would place the tooltip in the same spot; the arc's
     * mid-point is the honest anchor and only the chart knows where it is.
     */
    const centre = hit.dataset.cx ? Number(hit.dataset.cx) : hitBox.left - box.left + hitBox.width / 2;
    const height = tip.offsetHeight;
    // Anchor to the mark, not to the hit area: `data-top` is where the mark
    // actually starts, which is what decides whether a tooltip fits above it.
    const marked = Number(hit.dataset.top);
    const above = isFinite(marked) ? marked : hitBox.top - box.top;

    /*
     * Keep the whole card in view horizontally: clamp the centre so a tooltip
     * on the first or last column does not hang off the side of the chart.
     *
     * The clamp is skipped when the plot is NARROWER than the tooltip, because
     * then the two bounds cross and `Math.min` wins every time, pinning every
     * tooltip to the same x no matter which mark is hovered. That is the
     * donut's case: a 150px ring inside a much wider card, where the honest
     * answer is to centre on the mark and let the tooltip overhang a box it was
     * never going to fit inside.
     */
    const half = tip.offsetWidth / 2;
    const rightBound = box.width - half - 4;
    const leftBound = half + 4;
    tip.style.left = `${rightBound > leftBound ? Math.min(rightBound, Math.max(leftBound, centre)) : centre}px`;

    if (above - height - 10 < 0) {
      tip.style.top = `${above + 22}px`;
      tip.style.transform = 'translate(-50%, 0)';
    } else {
      tip.style.top = `${above - 8}px`;
      tip.style.transform = 'translate(-50%, -100%)';
    }

    if (onFocus) onFocus(index);
  };

  plot.addEventListener('pointermove', show);
  plot.addEventListener('pointerleave', hide);
  // Keyboard reaches the same values through the table view, which is why the
  // tooltip is allowed to be pointer only.
  return hide;
}

/**
 * The table-view twin's markup.
 *
 * `firstHead` exists because not every chart is bucketed: the donut's first
 * column is a category, and a column headed "Bucket" listing surfaces is the
 * kind of small lie that makes a reader distrust the rest of the page.
 */
function tableHtml(valueHeads, rows, firstHead = 'Bucket') {
  return `<div class="table-wrap"><table class="data">
    <thead><tr><th>${esc(firstHead)}</th>${valueHeads.map((h) => `<th class="num">${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows
      .map((row) => `<tr>${row.map((cell, i) => `<td class="${i ? 'num' : ''}">${esc(cell)}</td>`).join('')}</tr>`)
      .join('')}</tbody>
  </table></div>`;
}

/**
 * Turns the aggregate route's sparse buckets into a dense series.
 *
 * SQL only returns buckets that HAVE rows. Plotting that raw draws the quiet
 * hours as if they never happened and compresses the busy ones together, which
 * is the chart lying about the shape rather than about the numbers.
 */
/*
 * Formatters pinned to UTC, because the BUCKETS are UTC.
 *
 * This was a real bug rather than a tidy-up: the axis label used to be built
 * with `toLocaleDateString` in local time while the bucket key it belonged to
 * came from `substr` on a UTC timestamp. Anywhere east or west of UTC, the
 * column for the first hours of a day was labelled with the previous or next
 * day's date. The tooltip says "UTC" out loud for the same reason.
 */
const UTC_LONG = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
});
const UTC_SHORT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const UTC_MONTH = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * Where the second axis row changes, and what it says there.
 *
 * One entry per day (on an hourly chart) or per month (on a daily one), at the
 * bucket the run starts on — so a 24 hour window that crosses midnight reads
 * "9 Aug … | 10 Aug …" instead of leaving the reader to work out that 01:00
 * belongs to tomorrow.
 */
function groupTicks(data) {
  const out = [];
  let last = null;
  data.forEach((d, i) => {
    if (d.groupKey && d.groupKey !== last) {
      // `groupLabel` is only ever set beside `groupKey` by `fillBuckets`, but a
      // chart plotted straight off the wire has neither, and a half filled row
      // that carried one without the other would reach `groupAxis`, which asks
      // the label for its `.length` to decide whether it overflows the plot.
      // That is a throw inside a paint, which takes the card with it.
      out.push({ i, text: String(d.groupLabel == null ? d.groupKey : d.groupLabel) });
      last = d.groupKey;
    }
  });
  return out;
}

/**
 * The date row and its dividers.
 *
 * The divider is skipped at index 0 — there it would land on the y-axis and
 * read as a second axis line — and the last label is right-anchored when it
 * would otherwise run off the edge of the plot.
 */
function groupAxis(groups, { padL, padR, padT, plotH, band, width }) {
  return groups
    .map((g) => {
      const x = padL + g.i * band;
      const approx = g.text.length * 5.6;
      const overflows = x + 5 + approx > width - padR;
      const line =
        g.i === 0
          ? ''
          : `<line x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${padT + plotH + 20}" stroke="var(--axis)" stroke-width="1"/>`;
      const label = `<text class="chart-axis chart-axis-group" x="${(overflows ? width - padR : x + 5).toFixed(1)}" y="${padT + plotH + 32}" text-anchor="${overflows ? 'end' : 'start'}">${esc(g.text)}</text>`;
      return line + label;
    })
    .join('');
}

/** The viewer's own zone, named once so the tooltip can say whose clock it is. */
const LOCAL_ZONE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  } catch {
    return 'local';
  }
})();

export function fillBuckets(rows, { unit, span, now, keys = ['n'] } = {}) {
  const index = new Map((Array.isArray(rows) ? rows : []).map((row) => [row && row.b, row]));
  const out = [];
  const stepMs = unit === 'hour' ? 3600000 : 86400000;
  const cut = unit === 'hour' ? 13 : 10;

  /*
   * `now` and `span` are checked because the failure was a THROW rather than a
   * bad chart. `new Date(NaN).toISOString()` raises a RangeError, so a view
   * that called this before its `stats` had landed, or one that mistyped the
   * options object, killed the render at the first bucket with a message about
   * an invalid time value and nothing pointing back here. A missing `now` is
   * this machine's clock, which is within a second of the box's; a missing
   * span is no buckets, which every chart above now reports as an empty state.
   *
   * The upper bound on `span` is the same kind of guard. The routes clamp to
   * 168 hours and 120 days, so anything past a few hundred is a mistake, and a
   * loop of a million iterations building a Date each time is a hung tab rather
   * than a slow one. The ceiling on `now` is the outer edge of what a Date can
   * represent: past it, `toISOString` is the same RangeError again.
   */
  const at = Number(now);
  const base = isFinite(at) && Math.abs(at) <= 8.64e15 ? at : Date.now();
  const steps = Math.min(2000, Math.max(0, Math.floor(Number(span) || 0)));
  const fields = Array.isArray(keys) && keys.length ? keys : ['n'];

  for (let i = steps - 1; i >= 0; i--) {
    const bucket = new Date(base - i * stepMs).toISOString().replace('T', ' ').slice(0, cut);
    /*
     * Rebuilt FROM the bucket key rather than kept as "now minus i hours".
     * The key is truncated to the hour but the raw date still carries the
     * current minutes, so the local-time line read "19:47" next to a
     * "17:00 to 18:00 UTC" range — two different instants on one row.
     */
    const date = new Date(unit === 'hour' ? `${bucket.replace(' ', 'T')}:00:00Z` : `${bucket}T00:00:00Z`);
    const hour = Number(bucket.slice(11, 13));
    const item = {
      key: bucket,
      at: date.getTime(),
      /*
       * `10:00`, not `10`. A bare two-digit hour is indistinguishable from a
       * day-of-month at a glance — the first question anybody asked of this
       * chart was "are those dates?". The `:00` settles it in the tick itself,
       * and the group row below settles which DAY each run of hours belongs to.
       */
      label: unit === 'hour' ? `${bucket.slice(11, 13)}:00` : UTC_SHORT.format(date),
      /*
       * The second axis row: the day a run of hours sits in, or the month a run
       * of days sits in. Drawn once per change rather than per tick.
       */
      groupKey: unit === 'hour' ? bucket.slice(0, 10) : bucket.slice(0, 7),
      groupLabel: unit === 'hour' ? UTC_SHORT.format(date) : UTC_MONTH.format(date),
      // The long form the tooltip leads with.
      full: UTC_LONG.format(date),
      // Which slice of that day, and the same instant on the reader's clock:
      // an admin in Karachi should not have to convert 03:00 UTC in their head.
      range:
        unit === 'hour'
          ? `${bucket.slice(11, 13)}:00 to ${String((hour + 1) % 24).padStart(2, '0')}:00 UTC`
          : 'whole day, UTC',
      local:
        unit === 'hour'
          ? `${new Date(date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} ${LOCAL_ZONE}`
          : '',
    };
    item.tip = item.full;
    const found = index.get(bucket) || {};
    /*
     * A bucket the SQL did not return is a real zero here, unlike everywhere
     * else in this file: the query returns a row for every bucket that HAS
     * rows, so an absent bucket means the count was zero rather than that the
     * shape was wrong. That is the entire job of this function. A bucket that
     * came back with an unreadable number is still zero, because there is
     * nothing else a dense series can be filled with.
     */
    for (const key of fields) {
      const value = Number(found[key] || 0);
      item[key === 'n' ? 'value' : key] = isFinite(value) ? value : 0;
    }
    out.push(item);
  }
  return out;
}

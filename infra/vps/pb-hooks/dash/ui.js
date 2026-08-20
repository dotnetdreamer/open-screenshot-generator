/**
 * The small pieces: escaping, formatting, and the chrome that more than one view
 * needs (toast, drawer, confirm, prompt, empty, error, skeleton).
 *
 * ## Why `esc` is the first thing in the file
 *
 * Everything in this dashboard renders through HTML strings. There is no React
 * layer between the wire and the page, and this is the one place in the whole
 * project where a post title, a caption, an @handle, a comment body, a project
 * name or a tag is written into the DOM without a framework having escaped it
 * first. A `<img src=x onerror=...>` typed into a caption in the app is inert
 * everywhere else and live here. So: **every value that came from the wire goes
 * through `esc` before it lands in markup**, without exception, and the reviewer
 * checks for it.
 *
 * ## Which functions return HTML and which return plain text
 *
 * The two are mixed in one module and getting them the wrong way round is the
 * mistake this note exists to prevent.
 *
 *   Return **HTML**, already escaped inside, drop straight into a template:
 *     avatar, chip, emptyState, errorState, skeleton, rawJson
 *
 *   Return **plain text**, which you must still pass through `esc` yourself:
 *     n, compact, bytes, pct, signed, ago, duration, clock, stamp, dayStamp,
 *     nameOf, handleOf, initials, newRef
 *
 * The number and date formatters produce nothing that needs escaping, so `esc`
 * around them is harmless noise rather than a bug. `nameOf` and `handleOf` are
 * the two that matter: both hand back a raw string that came off the wire.
 *
 * ## House rule that applies to every string below
 *
 * No em dashes and no en dashes in anything a person reads. A comma, a period, a
 * colon or the word "to". Comments are exempt and use them freely. No trailing
 * period on short UI copy.
 */

/**
 * String coercion that cannot throw.
 *
 * `String(value)` is not total, which is a surprise the first time it costs a
 * page. Two shapes throw a TypeError rather than answering text: a value with a
 * null prototype, which `JSON.parse` produces for a `__proto__` key and several
 * of the JSON columns on this box are operator supplied, and a symbol, which
 * refuses implicit conversion by design. Everything in this file is assembled
 * inside a template string, so a formatter that throws does not produce a wrong
 * label, it takes the whole card being built with it and leaves the view half
 * rendered with one line in the console explaining nothing.
 *
 * So the coercion happens here, once, and answers '' for anything it cannot
 * read. A blank label is a small loss. A card that never rendered is not.
 */
function asText(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  try {
    return String(value);
  } catch {
    return '';
  }
}

/**
 * Number coercion that cannot throw, answering NaN for "no number here".
 *
 * `Number(symbol)` throws for the same reason `String(symbol)` does, and every
 * formatter below used to call `Number` on whatever a view handed it. NaN
 * rather than 0 as the failure value is the important half: each formatter
 * decides for itself what an unreadable input should print, and none of them
 * gets to have that decision made for it by a silent zero. A count of zero is a
 * claim about the data; an unreadable value is a claim about nothing.
 *
 * '' is unreadable rather than zero, which is `Number`'s own answer and a bad
 * one here: an empty string in a numeric column means the field was missing,
 * not that the number came out empty.
 */
function asNumber(value) {
  if (typeof value === 'number') return value;
  if (value === null || value === undefined || value === '') return NaN;
  try {
    return Number(value);
  } catch {
    return NaN;
  }
}

export function esc(value) {
  if (value === null || value === undefined) return '';
  return asText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * One HTML string in, one element out.
 *
 * `<template>` rather than a `<div>` on purpose: the HTML parser refuses to keep
 * a bare `<tr>` or `<td>` inside a div and silently drops it, and half the views
 * here build table rows one string at a time. Template content is parsed in a
 * mode where those are legal, so this works for a row as well as for a card.
 */
export function node(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = asText(html).trim();
  return tpl.content.firstElementChild;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ------------------------------------------------------------- numbers ---

/**
 * 1,284.
 *
 * Coerced rather than type checked, because a few of these numbers arrive from
 * the wire as strings: a SQLite SUM over a big column comes back as a JSON
 * number, but a value read out of a settings row is text and views pass it here
 * anyway. Anything that will not coerce is an honest 0 rather than "NaN" printed
 * in a stat tile.
 */
export function n(value) {
  const x = asNumber(value);
  return isFinite(x) ? x.toLocaleString('en-US') : '0';
}

/** 1,284 / 12.9K / 4.2M, for stat tiles where width is the constraint. */
export function compact(value) {
  const x = asNumber(value) || 0;
  const sign = x < 0 ? '-' : '';
  const a = Math.abs(x);
  if (a < 10000) return sign + a.toLocaleString('en-US');
  if (a < 1e6) return `${sign}${(a / 1e3).toFixed(a < 1e5 ? 1 : 0)}K`;
  if (a < 1e9) return `${sign}${(a / 1e6).toFixed(1)}M`;
  return `${sign}${(a / 1e9).toFixed(1)}B`;
}

/**
 * 940 B / 12.4 KB / 3.1 MB / 1.2 GB.
 *
 * This dashboard is mostly about disk, so this one is load bearing: the Storage
 * page, the project table, the per owner bar list and the quota checks on
 * Integrity all read out of it, and a units mistake here is a wrong answer to
 * the only question that page exists to answer.
 *
 * 1024 based, which is what `doc_bytes` and `asset_bytes` are counted in and
 * what `$os.stat` reports, so the number on the page matches the number `du`
 * prints on the box. One decimal from KB up and none for plain bytes, because
 * "940.0 B" is precision that does not exist.
 *
 * The re-check after rounding is not paranoia: 1048575 bytes divides to 1023.999
 * KB, which `toFixed(1)` renders as "1024.0 KB", a unit that stopped being right
 * the moment it was rounded.
 */
export function bytes(value) {
  const x = asNumber(value);
  if (!isFinite(x)) return '0 B';
  const sign = x < 0 ? '-' : '';
  let a = Math.abs(x);
  if (a < 1024) return `${sign}${Math.round(a)} B`;

  const units = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do {
    a /= 1024;
    i++;
  } while (a >= 1024 && i < units.length - 1);
  if (Number(a.toFixed(1)) >= 1024 && i < units.length - 1) {
    a /= 1024;
    i++;
  }
  return `${sign}${a.toFixed(1)} ${units[i]}`;
}

/**
 * '12.4%', or '0%' when there is nothing to be a share of.
 *
 * A whole number keeps its decimal off, so a full bar reads "100%" rather than
 * "100.0%". Dividing by zero answers 0% rather than NaN: on this dashboard the
 * denominator is usually a row count, and a table with no rows is a legitimate
 * state on a fresh box rather than an error.
 */
export function pct(part, whole) {
  const p = asNumber(part) || 0;
  const w = asNumber(whole) || 0;
  if (!w) return '0%';
  const text = ((p / w) * 100).toFixed(1);
  return `${text.endsWith('.0') ? text.slice(0, -2) : text}%`;
}

export const signed = (value) => (asNumber(value) > 0 ? `+${n(value)}` : n(value));

// --------------------------------------------------------------- time ---

/**
 * What every date formatter below prints when it is handed something it cannot
 * parse. Not a dash: the house rule forbids one in anything a person reads, and
 * "unknown" is also the more honest word, since a missing `created` means this
 * client could not tell rather than that nothing happened.
 */
const NO_DATE = 'unknown';

/**
 * PocketBase hands back `2026-08-10 12:34:56.789Z`, which Safari will not parse
 * as a Date: the space where ISO 8601 wants a T is enough for it to answer
 * Invalid Date, while Chrome shrugs and parses it anyway. Swapping the first
 * space for a T is the whole fix, and this exact bug has bitten a project shaped
 * like this one before, on an operator's iPad, weeks after it shipped.
 *
 * `replace` with a string pattern only replaces the first occurrence, which is
 * what is wanted here: there is exactly one space in that format.
 *
 * ## Numbers are accepted, and 0 is still nothing
 *
 * Not every timestamp on this wire is a PocketBase string. `stats.now` and
 * `series.now` are epoch milliseconds, and a view that hands one of those to
 * `stamp` deserves the date rather than the word "unknown" — which is what it
 * used to get, because `new Date('1755000000000')` is an Invalid Date: a
 * numeric STRING is parsed as a date format, not as a count of milliseconds.
 * Only a real number takes that path; a numeric string stays on the text path,
 * since there is no column on this box that stores an epoch as text and
 * guessing at one would turn a mangled date string into a confident wrong year.
 *
 * A 0 is read as nothing rather than as 1 January 1970, for both the number and
 * the string form. Every date column here is either a real timestamp or absent,
 * so a zero in this position is a field that was never filled in, and the
 * formatters answer "unknown" for it, which is the truth.
 */
export function toDate(value) {
  if (value === null || value === undefined || value === '' || value === 0) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    if (!isFinite(value)) return null;
    const fromMs = new Date(value);
    return isNaN(fromMs.getTime()) ? null : fromMs;
  }
  const date = new Date(asText(value).replace(' ', 'T'));
  return isNaN(date.getTime()) ? null : date;
}

export function ago(value) {
  const date = toDate(value);
  if (!date) return NO_DATE;
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  // A future timestamp is not impossible: the box's clock and this machine's
  // clock are two different clocks, and a row written a second ago can read as
  // a second from now. "in 1s" is a better answer than "1s ago" being negative.
  if (seconds < 0) return `in ${duration(-seconds)}`;
  if (seconds < 10) return 'now';
  return `${duration(seconds)} ago`;
}

export function duration(seconds) {
  const s = asNumber(seconds) || 0;
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

/** 12:34:56, for the live feed where the ordering within a minute matters. */
export function clock(value) {
  const date = toDate(value);
  if (!date) return '';
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** 10 Aug 2026, 12:34. en-GB because it puts the day first and uses a 24 hour clock. */
export function stamp(value) {
  const date = toDate(value);
  if (!date) return NO_DATE;
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 10 Aug 2026. For a column where the time of day is noise. */
export function dayStamp(value) {
  const date = toDate(value);
  if (!date) return NO_DATE;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ------------------------------------------------------------- people ---

/**
 * The name to print, in the order the app itself resolves it.
 *
 * `display_name` is what the person chose, `name` is what the provider handed
 * over at sign in, and the local part of the email is the last thing that is
 * still recognisably them. 'Someone' rather than 'Unknown' for the final
 * fallback, because a row with no name at all is still a person and this string
 * ends up in sentences like "Someone commented".
 *
 * RETURNS RAW TEXT off the wire. Pass it through `esc` at the call site.
 */
export const nameOf = (user) =>
  user?.display_name || user?.name || (user?.email ? asText(user.email).split('@')[0] : '') || 'Someone';

/**
 * '@handle', or an empty string when the account never claimed one.
 *
 * Empty rather than a placeholder, so a template can write
 * `${handleOf(u) ? `<span>${esc(handleOf(u))}</span>` : ''}` and get no stray
 * separator. `handle` is unique only where it is non-empty in this schema, which
 * is exactly why plenty of rows have none.
 *
 * RETURNS RAW TEXT off the wire. Pass it through `esc` at the call site.
 */
export const handleOf = (user) => (user?.handle ? `@${asText(user.handle)}` : '');

/**
 * One or two characters for the chip behind an avatar.
 *
 * Letters and digits only, and everything else is treated as a word separator.
 * That is not tidiness, it is the same wire-data rule the rest of this file
 * runs on: the name arriving here is whatever somebody typed into the app, so
 * `<script>alert(1)</script>` is a name that can reach this function, and the
 * old version answered `<S` for it. `avatar` escapes the result, so the page was
 * never in danger, but a chip reading `<S` is a bug report from an operator and
 * `@dave` answering `@D` was one already. Stripping punctuation answers `SA` and
 * `DA`, which is what a person would have written.
 *
 * Split by code point rather than by UTF-16 unit. A name whose first letter
 * lives outside the basic plane is two units long, and slicing it in half
 * produces a lone surrogate: an unpaired half character that renders as the
 * replacement glyph. Rare, and free to get right.
 *
 * '?' when there is nothing left, which covers null, an empty string, a name
 * made entirely of emoji, and a row whose name column was never filled in.
 */
export function initials(name) {
  const clean = asText(name).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return [...words[0]].slice(0, 2).join('').toUpperCase();
  return ([...words[0]][0] + [...words[words.length - 1]][0]).toUpperCase();
}

/**
 * An account's picture, or an initials chip when there is not one.
 *
 * ## The shape, and why the initials are always in the markup
 *
 * The chip is rendered underneath the `<img>` rather than instead of it. A file
 * that has been deleted off the box, or a token that expired between the render
 * and the paint, then costs nothing: the image simply fails to paint and the
 * initials that were always there show through. The alternative, an `onerror`
 * that swaps the node, fights with the retry-with-a-fresh-token handler in
 * `pb.js`, because whichever of the two runs first destroys the other's subject.
 * `alt=""` is load bearing for the same reason: a broken image with an empty alt
 * renders as nothing at all, while one with alt text renders the browser's
 * broken-file glyph over the chip.
 *
 * ## Why this does not call `pb.fileUrl`
 *
 * `ui.js` is the leaf of this dashboard and knows nothing about sessions, which
 * is what lets every other module import it without a cycle. It can build this
 * one URL by hand safely because `users.avatar` is NOT a protected field in the
 * migrations, so it needs no file token: the app's own feed shows these pictures
 * to signed out visitors on purpose. `baseUrl` is the server the operator signed
 * in to, which is `auth.url` from `pb.js`; it defaults to this page's origin,
 * which is right whenever the dashboard is being served by the box it is looking
 * at, which is the normal case.
 *
 * `96x96` is the only thumb size the migration declares for this field. Asking
 * for a size that was never declared is not a size you get.
 *
 * ## Sizing, and which of the two forms wins
 *
 * `size` is one argument that speaks two languages, so the rule is simply which
 * language it was written in.
 *
 *   A NUMBER, or a string of digits, is a pixel size and WINS OUTRIGHT. It is
 *   emitted as `--avatar-size` on the element and no size class is added, which
 *   is the half that has to be got right: `.avatar` reads
 *   `var(--avatar-size, 26px)` and `.avatar-lg` sets a literal 46px, both at one
 *   class of specificity, and `.avatar-lg` is written later in the sheet. Ship
 *   the two together and the class wins the cascade, so `avatar(user, 64)`
 *   silently measures 46px and the caller's number is decoration. A digit string
 *   counts because `el.dataset.size` and `getAttribute` both hand back strings
 *   and somebody will pass one straight through.
 *
 *   ANYTHING ELSE is read as a keyword: 'sm', 'md', 'lg', or the full class name
 *   'avatar-sm' / 'avatar-md' / 'avatar-lg'. A keyword nobody has written a rule
 *   for falls back to 'md' rather than being passed through, because emitting
 *   `avatar-xl` when the sheet has no `.avatar-xl` produces a normal sized chip
 *   and no clue anywhere about why the size was ignored.
 *
 * The number is clamped to 12px at the bottom, where the initials stop being
 * readable at all, and 512px at the top, so a wire value that arrived somewhere
 * it should not have cannot lay out a chip the size of a wall.
 *
 * Must not throw on a null user, and does not: every read is optional chained
 * and every value that reaches a URL or an attribute goes through a coercion
 * that cannot throw. The liker list on a post drawer renders rows whose author
 * was deleted while the page was open, and the avatar column on Accounts renders
 * whatever the `avatar` file column happens to hold.
 */

/** The size classes that exist in styles.css. Anything else is not a size. */
const AVATAR_CLASSES = { sm: 'avatar-sm', md: 'avatar-md', lg: 'avatar-lg' };

/** The pixel form of `size`, or null when the argument is not one. */
function avatarPx(size) {
  // Only a number or a string is ever a pixel size. Without this, `true` coerces
  // to 1 and a caller who passed a flag by mistake gets a 12px chip instead of
  // the default one, which is a stranger bug to find than the flag itself.
  if (typeof size !== 'number' && typeof size !== 'string') return null;
  if (typeof size === 'string' && !/^\s*\d+(\.\d+)?\s*$/.test(size)) return null;
  const px = asNumber(size);
  if (!isFinite(px)) return null;
  return Math.round(Math.max(12, Math.min(512, px)));
}

export function avatar(user, size = 'md', baseUrl = '') {
  const label = nameOf(user);
  const ini = initials(label);

  const px = avatarPx(size);
  let cls = AVATAR_CLASSES.md;
  let style = '';
  if (px !== null) {
    cls = '';
    style = ` style="--avatar-size:${px}px"`;
  } else if (typeof size === 'string' && size.trim()) {
    cls = AVATAR_CLASSES[size.trim().toLowerCase().replace(/^avatar-/, '')] || AVATAR_CLASSES.md;
  }

  const file = asText(user?.avatar);
  const id = asText(user?.id);
  let src = '';
  if (file && id) {
    /*
     * `baseUrl` is the server the operator signed in to. It is checked rather
     * than trusted because it is a value they typed into a text field on the
     * gate, and the only two shapes that belong in an `src` are an absolute
     * http(s) origin and a root relative path. Anything else, `javascript:`
     * included, falls back to this page's own origin, which is the right server
     * in the normal case anyway. `location` is read defensively so this module
     * can be imported and exercised outside a page.
     */
    const here = typeof location !== 'undefined' && location.origin ? location.origin : '';
    const asked = asText(baseUrl).trim();
    const root = (/^https?:\/\//i.test(asked) || asked.startsWith('/') ? asked : here).replace(/\/$/, '');
    src = `${root}/api/files/users/${encodeURIComponent(id)}/${encodeURIComponent(file)}?thumb=96x96`;
  }

  return (
    `<span class="avatar${cls ? ` ${esc(cls)}` : ''}"${style} role="img" aria-label="${esc(label)}" title="${esc(label)}">` +
    `<span class="avatar-ini" aria-hidden="true">${esc(ini)}</span>` +
    (src ? `<img class="avatar-img" src="${esc(src)}" alt="" loading="lazy" decoding="async" />` : '') +
    '</span>'
  );
}

// ------------------------------------------------------------- chrome ---

/*
 * `index.html` owns three hosts: `#drawer`, `#drawer-scrim` and `#toasts`.
 * Nothing in this file creates a second one of any of them, and the two dialogs
 * below append their own scrim and card to `<body>` at a higher layer than the
 * drawer, so a confirm raised from inside a drawer sits on top of it rather than
 * underneath it. The z-indexes live in the stylesheet, not here: a magic number
 * in a template string is a stacking bug waiting for the day somebody adds a
 * sticky bulk bar.
 */

const TOAST_LIMIT = 4;

/*
 * How long a toast stays up.
 *
 * It used to be a flat 3.6 seconds for everything, which was wrong twice over.
 * The moderation routes answer with a whole sentence about what the write did
 * ("deleted with 3 comments and 2 likes, the author's post count went from 5 to
 * 4"), and 3.6 seconds is not long enough to read seventy odd characters, let
 * alone to take in a number you may want to check. And a failure got exactly as
 * long as a success, so the one message an operator most needs to read was the
 * one most likely to be missed.
 *
 * So: a floor per kind, plus reading time for anything longer than a short
 * phrase, capped so a pathological message cannot camp on the corner of the
 * screen. 80ms a character is deliberately slower than a comfortable reading
 * speed, because this is glanced at rather than read.
 */
const TOAST_MS = { base: 4000, bad: 9000, perChar: 80, floorChars: 40, max: 15000 };

/** How long the toast lingers after the pointer or the keyboard leaves it. */
const TOAST_GRACE_MS = 2000;

/**
 * A short message in the corner. `kind` is '' , 'good' or 'bad'.
 *
 * Capped, because the bulk bars on Feed and Comments fire one of these per row
 * and a thirty row hide would otherwise build a column of toasts taller than the
 * window, hiding the page underneath the report of what just happened to it.
 * Oldest goes first, so what is left on screen is the most recent news.
 *
 * ## Why the item carries no `role`
 *
 * `#toasts` in `index.html` is already `aria-live="polite"`, and a live region
 * announces the children that get appended to it. Putting `role="status"` on
 * each item as well nests one live region inside another, which several screen
 * readers announce twice. One or the other, and the container is the one that
 * has to stay: it is the thing that exists before the message does.
 *
 * ## Why there is a dismiss button
 *
 * A toast that reports a write is the only record of that write the operator
 * gets, it cannot be brought back, and it used to disappear on its own timer
 * with no way to hold it. The button is the way out; hovering or tabbing into
 * the toast pauses the timer, which is what makes a long sentence readable.
 */
export function toast(message, kind = '') {
  const host = $('#toasts');
  if (!host) return;

  const text = asText(message);
  const item = node(
    `<div class="toast ${esc(kind)}">` +
      `<span class="toast-text">${esc(text)}</span>` +
      '<button class="toast-close" type="button" aria-label="Dismiss">&#10005;</button>' +
      '</div>'
  );

  /*
   * Laid out here rather than in styles.css on purpose. A toast is built by this
   * function and by nothing else, it is two elements, and a rule in the sheet
   * for it would be a rule that has to be found before this code can be read.
   * The colour and the box still come from `.toast` in the sheet; only the row
   * and the button, which exist because of the paragraph above, are set here.
   */
  item.style.display = 'flex';
  item.style.alignItems = 'flex-start';
  item.style.gap = '10px';
  const close = $('.toast-close', item);
  close.style.cssText =
    'flex:none;margin:-1px -4px 0 auto;padding:2px 4px;border:0;background:none;' +
    'color:inherit;font:inherit;line-height:1;opacity:.65;cursor:pointer';

  host.append(item);
  while (host.children.length > TOAST_LIMIT) host.firstElementChild.remove();

  const life = Math.min(
    TOAST_MS.max,
    (kind === 'bad' ? TOAST_MS.bad : TOAST_MS.base) +
      Math.max(0, text.length - TOAST_MS.floorChars) * TOAST_MS.perChar
  );

  let timer = null;
  const dismiss = () => {
    clearTimeout(timer);
    item.style.opacity = '0';
    setTimeout(() => item.remove(), 220);
  };
  const start = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(dismiss, ms);
  };

  close.addEventListener('click', dismiss);
  item.addEventListener('mouseenter', () => clearTimeout(timer));
  item.addEventListener('focusin', () => clearTimeout(timer));
  item.addEventListener('mouseleave', () => start(TOAST_GRACE_MS));
  item.addEventListener('focusout', () => start(TOAST_GRACE_MS));
  start(life);
}

/*
 * Scroll locking is counted rather than set and cleared.
 *
 * A confirm opened from inside a drawer locks the page a second time, and if
 * closing the confirm simply cleared the lock, the drawer behind it would go
 * back to scrolling the page under itself. The counter means the page unlocks
 * when the last thing that wanted it locked has gone.
 */
let scrollLocks = 0;

function lockScroll() {
  scrollLocks += 1;
  document.body.style.overflow = 'hidden';
}

function unlockScroll() {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks === 0) document.body.style.overflow = '';
}

/**
 * Whether a modal dialog is up. The drawer's Escape and Tab keys stand down
 * while it is, and `modal()` refuses to open a second one over the first.
 */
let modalOpen = false;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keep Tab inside `container`.
 *
 * One implementation for the drawer and for both dialogs, because they are the
 * same problem and the drawer spent a long time not solving it: it was a plain
 * `<aside>` over a scrim, so Tab walked straight out of it and painted a focus
 * ring on the rail underneath the blur, where an operator could press Enter on
 * a nav link they could not see. A trap in front of a Delete button is not
 * decoration.
 *
 * `offsetParent !== null` drops anything that is in the markup but not on
 * screen: a drawer keeps rows that scrolled out of view focusable, which is
 * right, but a `hidden` pager or a collapsed section is not something Tab
 * should stop on. Elements that are not in `items` at all, the container itself
 * included, are treated as "before the first", so a backwards Tab from the
 * panel wrapper lands on the last control rather than escaping behind it.
 */
function trapTab(ev, container) {
  if (!container) return;
  const items = $$(FOCUSABLE, container).filter((el) => el.offsetParent !== null);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  const at = document.activeElement;
  if (ev.shiftKey && (at === first || !items.includes(at))) {
    ev.preventDefault();
    last.focus();
  } else if (!ev.shiftKey && at === last) {
    ev.preventDefault();
    first.focus();
  }
}

let drawerOpen = false;
let drawerReturnFocus = null;
let drawerNamer = null;

/** The id stamped on whichever heading is currently naming the drawer. */
const DRAWER_TITLE_ID = 'drawer-title';

/**
 * Give the open drawer an accessible name.
 *
 * `index.html` ships `aria-label="Detail"` on the element, which named every
 * drawer in the dashboard the same thing: a landmark or dialog list read
 * "Detail, Detail, Detail" and none of the three said which record was open.
 *
 * A caller may pass its own name. When it does not, the name is taken from the
 * heading the drawer already shows, which is the same string the sighted
 * operator is reading and therefore cannot drift from it.
 *
 * The heading is re-read on every mutation because every detail view replaces
 * `drawer.innerHTML` wholesale once its data arrives (postDetail, accountDetail,
 * projects and tables all do). The element we stamped an id on during the
 * skeleton paint is gone by the time the record is on screen, and an
 * `aria-labelledby` pointing at a removed node is a drawer with no name at all.
 */
function nameDrawer(drawer, label) {
  if (label) {
    drawer.setAttribute('aria-label', label);
    drawer.removeAttribute('aria-labelledby');
    return;
  }
  const heading = $('.drawer-head h3', drawer) || $('h3', drawer);
  if (heading) {
    if (!heading.id) heading.id = DRAWER_TITLE_ID;
    drawer.setAttribute('aria-labelledby', heading.id);
    drawer.removeAttribute('aria-label');
    return;
  }
  // Better than nothing, and only reachable while a view is between paints.
  drawer.setAttribute('aria-label', 'Detail');
  drawer.removeAttribute('aria-labelledby');
}

/**
 * Put focus back inside the drawer after a repaint has thrown it away.
 *
 * `openDrawer` focuses the first control in the skeleton, and then the view
 * replaces `drawer.innerHTML` with the real record. Replacing the subtree
 * destroys the focused button, and a browser answers that by moving focus to
 * `<body>`. Measured before this: a post drawer two seconds after opening had
 * `document.activeElement` back on `<body>`, so it was a dialog with the
 * keyboard outside it, and every Tab from there started at the top of the
 * document again.
 *
 * It only acts when focus has actually been LOST, meaning it is on `<body>` or
 * on a node that is no longer in the document. Focus that is somewhere real is
 * somewhere the operator or a dialog put it, and moving it would be worse than
 * the bug: `modalOpen` covers the confirm that is raised from a drawer button,
 * whose card lives outside the drawer on purpose.
 */
function keepFocusInDrawer(drawer) {
  if (!drawerOpen || modalOpen) return;
  const at = document.activeElement;
  if (at && at !== document.body && at.isConnected) return;
  const first = $(FOCUSABLE, drawer);
  if (first) first.focus();
  else drawer.focus();
}

/**
 * Fill the drawer and show it.
 *
 * Takes the whole inner markup, `.drawer-head` and `.drawer-body` included, so a
 * view owns its own header row and its own action buttons. Anything carrying
 * `data-close` is wired to close it. Returns the drawer element, which is what a
 * caller needs in order to bind the rest of its buttons. `label` is optional and
 * names the drawer for a screen reader; see `nameDrawer` for what happens when
 * it is left out, which is what every view does today.
 *
 * Focus is moved into the drawer and put back where it came from on close. The
 * detail drawers here are opened by clicking a row in a long table, and losing
 * your place in that table on every close is the difference between a tool you
 * can work through a moderation queue with and one you cannot.
 *
 * ## Why this is a dialog and not just a panel
 *
 * It used to be a bare `<aside>` with a scrim over the page, and measured, that
 * meant: `document.activeElement` was still `<body>` after it opened, the
 * element had no `role`, no `aria-modal` and no `tabindex`, `#app` was neither
 * inert nor hidden, and nineteen presses of Tab walked the focus ring out of the
 * drawer and onto the rail's Pulse link, underneath a blurred scrim, while the
 * drawer was still open. `confirmAction` and `promptValue` in this same file
 * were already correct, so the drawer was the odd one out rather than the
 * pattern. It now does what they do: a name, a role, focus moved in, a trap, and
 * the page behind it taken out of the tab order.
 *
 * `inert` on `#app` and not `aria-hidden`: `aria-hidden` would take the page out
 * of the accessibility tree while leaving all of it tabbable, which is the worse
 * half of the two. `inert` does both. It is a plain attribute with no stylesheet
 * behind it, so it cannot be undone by an edit to `styles.css`. The drawer and
 * its scrim live outside `#app` in `index.html`, which is what makes this safe:
 * the thing being marked inert does not contain the thing being focused.
 */
export function openDrawer(html, label = '') {
  const drawer = $('#drawer');
  const scrim = $('#drawer-scrim');
  if (!drawer || !scrim) return null;

  if (!drawerOpen) {
    drawerReturnFocus = document.activeElement;
    lockScroll();
    drawerOpen = true;
  }

  drawer.innerHTML = html;
  drawer.hidden = false;
  scrim.hidden = false;
  drawer.scrollTop = 0;

  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-modal', 'true');
  // So the panel itself can hold focus while a view is still painting its first
  // button, and so `Escape` has somewhere to land when it has none.
  drawer.setAttribute('tabindex', '-1');
  $('#app')?.setAttribute('inert', '');

  nameDrawer(drawer, label);
  drawerNamer?.disconnect();
  drawerNamer = new MutationObserver(() => {
    if (!label) nameDrawer(drawer, '');
    keepFocusInDrawer(drawer);
  });
  // childList and subtree only. Attributes are deliberately not watched, since
  // `nameDrawer` writes one and watching them would call it from inside itself.
  drawerNamer.observe(drawer, { childList: true, subtree: true });

  scrim.onclick = () => closeDrawer();
  $$('[data-close]', drawer).forEach((btn) => btn.addEventListener('click', () => closeDrawer()));

  const first = $(FOCUSABLE, drawer);
  if (first) first.focus();
  else drawer.focus();

  return drawer;
}

/**
 * Hide the drawer and empty it.
 *
 * Emptying matters as much as hiding: a drawer left full of markup keeps every
 * `<img>` in it alive, and the post drawer holds up to six full screenshots.
 *
 * The `dash:drawer-close` event is for the shell. Detail routes are real URLs
 * here (`#/post/<id>`), so closing the drawer has to take the hash back to the
 * list underneath, and the router is the only thing that knows what that was.
 * An event rather than a callback, because `ui.js` must not import the shell.
 */
export function closeDrawer() {
  const drawer = $('#drawer');
  const scrim = $('#drawer-scrim');
  if (!drawer || !scrim || drawer.hidden) return;

  drawerNamer?.disconnect();
  drawerNamer = null;

  drawer.hidden = true;
  drawer.innerHTML = '';
  scrim.hidden = true;
  scrim.onclick = null;

  // Everything `openDrawer` added comes off again, including the accessible
  // name: a hidden element with `role="dialog"` still on it is a dialog as far
  // as an assistive technology walking the document is concerned.
  drawer.removeAttribute('role');
  drawer.removeAttribute('aria-modal');
  drawer.removeAttribute('tabindex');
  drawer.removeAttribute('aria-labelledby');
  drawer.removeAttribute('aria-label');
  $('#app')?.removeAttribute('inert');

  if (drawerOpen) {
    drawerOpen = false;
    unlockScroll();
  }

  const back = drawerReturnFocus;
  drawerReturnFocus = null;
  if (back && back.isConnected && typeof back.focus === 'function') back.focus();

  document.dispatchEvent(new CustomEvent('dash:drawer-close'));
}

document.addEventListener('keydown', (ev) => {
  if (!drawerOpen) return;
  // A dialog on top of the drawer takes the keyboard. Without this, one Escape
  // closes both, and the operator loses the record they were half way through
  // acting on along with the confirm they meant to cancel. The same goes for
  // Tab: the dialog runs its own trap in the capture phase, and this one would
  // then drag the focus straight back out of it.
  if (modalOpen) return;
  if (ev.key === 'Escape') {
    closeDrawer();
    return;
  }
  if (ev.key === 'Tab') trapTab(ev, $('#drawer'));
});

/**
 * The shared body of both dialogs below.
 *
 * They are deliberately one implementation wearing two sets of clothes: the
 * scrim, the Escape key, the layering, the focus trap and the button row are
 * identical, and the only difference is what sits above the buttons and what the
 * promise resolves to.
 *
 * `build(card, finish)` gets the card element and the function that closes the
 * dialog with an answer, and wires whatever is particular to it.
 */
function modal({ title, inner, confirmLabel, danger, cancelLabel = 'Cancel' }, build) {
  /*
   * One dialog at a time, and the second request is answered "no".
   *
   * This is the fix for a real double click. Five of the six write surfaces set
   * their busy lock only after the confirm resolves, so two clicks in the same
   * tick raised two dialogs stacked on each other, and confirming both sent the
   * destructive request twice, with two different idempotency keys, which the
   * server records as two separate operator decisions in `mod_log`. Measured
   * before this guard: two `.modal` elements on screen, both resolving true.
   *
   * It is fixed here rather than in each view because two modal dialogs stacked
   * on top of each other is never the right thing regardless of what raised
   * them: the lower one is `aria-modal` and unreachable, the focus trap of the
   * upper one owns the keyboard, and the operator cannot see what they are
   * agreeing to. Refusing costs a caller nothing, since `confirmAction` maps
   * this to false and `promptValue` maps it to null, and both mean "did not
   * happen".
   *
   * A confirm raised from inside an open DRAWER is a different case and still
   * works: the drawer is not a dialog in this sense, it stands its keyboard
   * handling down while `modalOpen` is set, and the dialog layers over it.
   */
  if (modalOpen) {
    console.warn('openscreengen dash: a dialog was asked for while one was already open, refused');
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const scrim = node('<div class="modal-scrim"></div>');
    const card = node(`
      <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="modal-card">
          <h3 class="modal-title">${esc(title)}</h3>
          ${inner}
          <div class="modal-actions">
            <button class="btn" data-no type="button">${esc(cancelLabel)}</button>
            <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes type="button">${esc(confirmLabel)}</button>
          </div>
        </div>
      </div>`);

    const returnFocus = document.activeElement;
    modalOpen = true;
    lockScroll();

    const finish = (answer) => {
      document.removeEventListener('keydown', onKey, true);
      scrim.remove();
      card.remove();
      modalOpen = false;
      unlockScroll();
      if (returnFocus && returnFocus.isConnected && typeof returnFocus.focus === 'function') {
        returnFocus.focus();
      }
      resolve(answer);
    };

    /*
     * Capture phase, so this runs before the drawer's own Escape handler no
     * matter which of the two was bound first, and a plain focus trap on Tab.
     * The trap is not decoration: this dialog is the last gate in front of
     * deleting an account, and a Tab that walks the keyboard out into the table
     * behind it means the operator can press Enter on something that is not the
     * button they think they are on.
     */
    const onKey = (ev) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        finish(null);
        return;
      }
      if (ev.key !== 'Tab') return;
      trapTab(ev, card);
    };

    scrim.onclick = () => finish(null);
    $('[data-no]', card).onclick = () => finish(null);
    document.addEventListener('keydown', onKey, true);
    document.body.append(scrim, card);

    build(card, finish);
  });
}

/**
 * The gate in front of everything here that writes.
 *
 * **It shows the old value beside the new one**, because "are you sure" on its
 * own is a button people learn to click through inside a week. Pass `from` and
 * `to` and it renders the pair itself, which is better than each view inventing
 * its own diff markup and one of them quietly forgetting to include it.
 *
 * `body` is HTML, not text, so a caller can put a list or a count in bold in it.
 * That means **the caller escapes anything that came off the wire**: a post
 * title going into a delete confirm has to arrive here already through `esc`.
 * `title`, `from`, `to` and the labels are escaped here.
 *
 * Resolves false on Cancel, on Escape and on the scrim. Never rejects.
 */
export function confirmAction({ title, body = '', confirmLabel = 'Confirm', danger = false, from, to }) {
  const hasDiff = from !== undefined || to !== undefined;
  const inner =
    (body ? `<div class="modal-body">${body}</div>` : '') +
    (hasDiff
      ? '<div class="modal-diff">' +
        `<div class="modal-diff-cell"><span class="modal-diff-label">Now</span><span class="modal-diff-value">${esc(from)}</span></div>` +
        `<div class="modal-diff-cell is-next"><span class="modal-diff-label">After</span><span class="modal-diff-value">${esc(to)}</span></div>` +
        '</div>'
      : '');

  return modal({ title, inner, confirmLabel, danger }, (card, finish) => {
    $('[data-yes]', card).onclick = () => finish(true);
    /*
     * A dangerous dialog opens with Cancel focused, a safe one with the action.
     *
     * The button that was focused before was the destructive one, so a dialog
     * raised by a keyboard press of Enter, which is how a row button is usually
     * activated, sat there with "Ban" or "Delete" under the same key that had
     * just been pressed. Two presses of Enter banned an account. The safe half
     * of a two button dialog is the half that gets the focus, and reaching the
     * other one is one Tab away.
     */
    $(danger ? '[data-no]' : '[data-yes]', card).focus();
  }).then((answer) => answer === true);
}

/**
 * `confirmAction` with a box to type in. Resolves the trimmed value, or null.
 *
 * **Nothing calls this yet.** It is exported, it is styled in `styles.css`, it
 * is exercised by the harness, and no view in `views/` raises it. That is not an
 * oversight and it is not dead code to delete on sight: it is the dialog for the
 * writes this dashboard is going to grow, the ones that take a value rather than
 * a yes, a share slug being reissued or a handle being corrected, and the point
 * of having it ready is that the first view to need one does not invent a
 * seventh way of asking. If you are reading this because a view finally uses it,
 * delete this paragraph.
 *
 * Its own function rather than a flag on `confirmAction`, because the two
 * resolve different types and a dialog that sometimes answers a boolean and
 * sometimes a string is one every caller has to check twice, which is how a
 * truthy string ends up meaning "confirmed" somewhere it meant "the value".
 *
 * `generate` is optional. Given one, the field grows a button that refills it,
 * which is the difference between an operator inventing a value under time
 * pressure and being handed one. The value is never masked: this dialog exists
 * for values that have to be read back, and a `type="password"` box is one the
 * operator cannot check before committing it.
 */
const PROMPT_ERROR_ID = 'dash-prompt-error';

export function promptValue({
  title,
  body = '',
  label = 'Value',
  confirmLabel = 'Save',
  value = '',
  placeholder = '',
  generate = null,
  danger = false,
}) {
  const inner =
    (body ? `<div class="modal-body">${body}</div>` : '') +
    '<div class="modal-field">' +
    `<label class="modal-label" for="dash-prompt-value">${esc(label)}</label>` +
    '<div class="modal-input-row">' +
    '<input class="input mono" id="dash-prompt-value" data-value type="text" spellcheck="false" ' +
    `autocapitalize="off" autocorrect="off" autocomplete="off" placeholder="${esc(placeholder)}" />` +
    (generate ? '<button class="btn btn-sm" data-gen type="button">New</button>' : '') +
    '</div>' +
    /*
     * `role="alert"` and an id, because the validation message used to be a
     * paragraph that un-hid itself and said nothing to anybody who was not
     * looking at it. A screen reader got silence and a dialog that would not
     * submit, with no way to find out why. `role="alert"` is an assertive live
     * region, so unhiding it announces it; the id is what `aria-describedby`
     * below points the field at.
     *
     * A fixed id is safe now in a way it was not before: `modal()` refuses to
     * open a second dialog while one is up, so there can only ever be one of
     * these in the document.
     */
    `<p class="modal-error" id="${PROMPT_ERROR_ID}" data-error role="alert" hidden></p>` +
    '</div>';

  return modal({ title, inner, confirmLabel, danger }, (card, finish) => {
    const field = $('[data-value]', card);
    const error = $('[data-error]', card);
    // Assigned rather than interpolated into the attribute: the starting value
    // can be anything already stored, quotes and angle brackets included, and an
    // attribute is the one place `esc` is easy to get subtly wrong.
    field.value = asText(value);

    /** Put the field back to valid. Called the moment they change anything. */
    const clearError = () => {
      if (error.hidden) return;
      error.hidden = true;
      error.textContent = '';
      field.removeAttribute('aria-invalid');
      field.removeAttribute('aria-describedby');
    };

    const submit = () => {
      const typed = field.value.trim();
      if (!typed) {
        // Answered inside the dialog rather than by closing it and toasting, so
        // whatever they were part way through typing is still on screen. The
        // field is marked invalid and pointed at the message, so the reason
        // reaches somebody who cannot see the red line under the box, and focus
        // goes back to the field because that is where the fix has to happen.
        error.textContent = 'Type something first';
        error.hidden = false;
        field.setAttribute('aria-invalid', 'true');
        field.setAttribute('aria-describedby', PROMPT_ERROR_ID);
        field.focus();
        return;
      }
      finish(typed);
    };

    $('[data-yes]', card).onclick = submit;
    field.addEventListener('input', clearError);
    field.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        submit();
      }
    });

    const gen = $('[data-gen]', card);
    if (gen) {
      gen.onclick = () => {
        field.value = generate();
        clearError();
        field.focus();
        field.select();
      };
    }

    field.focus();
    field.select();
  }).then((answer) => (typeof answer === 'string' ? answer : null));
}

// --------------------------------------------------- shared bits of markup ---

/**
 * The nothing-here state.
 *
 * `note` says **what would make it non-empty**, not that it is empty, which the
 * absence of rows already said. "No hidden posts" is a fact; "Nothing has been
 * hidden yet, and hiding one from the Feed page puts it here" is the one an
 * operator can act on.
 */
export function emptyState(title, note = '') {
  return (
    '<div class="empty">' +
    `<strong>${esc(title)}</strong>` +
    (note ? `<span>${esc(note)}</span>` : '') +
    '</div>'
  );
}

/**
 * The it-broke state, which SHOWS THE MESSAGE.
 *
 * A card that says "Something went wrong" is a card that costs somebody a trip
 * to the browser console to find out that a column was renamed. `ApiError` from
 * `pb.js` carries a status and a readable message, a transport failure carries
 * status 0, and a plain string is accepted too so a view can report a problem it
 * worked out for itself.
 */
export function errorState(title, err) {
  const message =
    typeof err === 'string' ? err : err?.message || err?.body?.message || 'No detail was returned';
  const status = err && typeof err === 'object' && err.status ? ` (status ${err.status})` : '';
  return (
    '<div class="empty is-error">' +
    `<strong>${esc(title)}</strong>` +
    `<span class="mono">${esc(message)}${esc(status)}</span>` +
    '</div>'
  );
}

/**
 * The loading shape, never a spinner.
 *
 * A spinner tells you to wait. This tells you what you are waiting for, and more
 * importantly it holds the same box the real content will fill, so the page does
 * not jump when the data lands. That is the whole point: every view here
 * refetches on a range change, on a filter change and on the refresh button, and
 * a layout that collapses to nothing and springs back on every one of those is
 * unusable long before it is ugly.
 *
 * Three kinds, matching the three layouts in this dashboard: 'rows' for tables
 * and queues, 'cards' for the post grid, 'tiles' for the KPI strips.
 *
 * The bar widths are varied on purpose. Identical bars read as a repeating
 * pattern and the eye files them as decoration; uneven ones read as text that
 * has not arrived. The widths are woven from a fixed list rather than a random
 * number so a re-render does not reshuffle them, which would look like the page
 * was doing something.
 */
const SKELETON_WIDTHS = [72, 54, 88, 61, 79, 46, 67, 83];

/**
 * How many placeholder shapes to build.
 *
 * Clamped, because `count` is usually the length of whatever the view is about
 * to replace and that number came off the wire: `skeleton('rows', total)` on a
 * Tables page pointed at `post_likes` would ask for one row per like and hang
 * the tab building forty thousand divs nobody will look at for more than a
 * second. Twelve past the fold is as convincing as a thousand. A count that is
 * missing, zero, negative or unreadable falls back to the caller's own default,
 * which is what the old `count || fallback` did and is still right.
 */
function skeletonCount(count, fallback) {
  const asked = asNumber(count);
  if (!isFinite(asked) || asked < 1) return fallback;
  return Math.min(48, Math.round(asked));
}

export function skeleton(kind = 'rows', count = 0) {
  const width = (i, spread) => SKELETON_WIDTHS[(i * 3 + spread) % SKELETON_WIDTHS.length];
  let items = '';

  if (kind === 'cards') {
    const total = skeletonCount(count, 8);
    for (let i = 0; i < total; i++) {
      items +=
        '<div class="skel-card">' +
        '<div class="skel-box skel-thumb"></div>' +
        `<div class="skel-bar" style="width:${width(i, 0)}%"></div>` +
        `<div class="skel-bar skel-bar-sm" style="width:${width(i, 2)}%"></div>` +
        '</div>';
    }
    return `<div class="skel skel-cards" aria-hidden="true">${items}</div>`;
  }

  if (kind === 'tiles') {
    const total = skeletonCount(count, 6);
    for (let i = 0; i < total; i++) {
      items +=
        '<div class="skel-tile">' +
        `<div class="skel-bar skel-bar-sm" style="width:${width(i, 1)}%"></div>` +
        '<div class="skel-bar skel-bar-lg" style="width:56%"></div>' +
        '</div>';
    }
    return `<div class="skel skel-tiles" aria-hidden="true">${items}</div>`;
  }

  const total = skeletonCount(count, 6);
  for (let i = 0; i < total; i++) {
    items +=
      '<div class="skel-row">' +
      '<div class="skel-box skel-avatar"></div>' +
      '<div class="skel-lines">' +
      `<div class="skel-bar" style="width:${width(i, 0)}%"></div>` +
      `<div class="skel-bar skel-bar-sm" style="width:${width(i, 4)}%"></div>` +
      '</div>' +
      '</div>';
  }
  return `<div class="skel skel-rows" aria-hidden="true">${items}</div>`;
}

/**
 * A labelled pill. `kind` is '', 'good', 'warn', 'bad' or 'accent'.
 *
 * **The word is always in the chip.** Colour is never the only thing carrying
 * the meaning here, which is an accessibility rule but also a practical one: a
 * red dot with no word beside it means "bad" to the person who wrote the page
 * and nothing at all to the person reading it at three in the morning.
 */
export function chip(text, kind = '') {
  return `<span class="chip${kind ? ` chip-${esc(kind)}` : ''}">${esc(text)}</span>`;
}

/**
 * A JSON blob, collapsed, rendered exactly as it is stored.
 *
 * Deliberately raw. `image_meta`, `tags` and an asset's `meta` are columns the
 * server never interprets, so this dashboard is the only place anybody can look
 * inside one, and a prettified guess at what they contain would defeat that.
 * Returns an empty string for nothing at all, so a caller can concatenate it
 * unconditionally without leaving an empty disclosure behind.
 */
export function rawJson(label, value) {
  let text = '';
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    // A circular object and a BigInt both throw here rather than stringifying,
    // and the fallback has to be the coercion that cannot throw a second time.
    text = asText(value);
  }
  if (!text || text === 'null' || text === 'undefined') return '';
  return `<details class="raw"><summary>${esc(label)}</summary><pre>${esc(text)}</pre></details>`;
}

/**
 * Parses a JSON column, which PocketBase may hand back either as a parsed value
 * or as the text it stored, depending on the field type and the route. Answers
 * null rather than throwing, because half the callers are inside a template
 * string where a throw takes the whole card with it.
 */
export function asJson(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Copy to the clipboard, and say so.
 *
 * The fallback is not legacy cruft. `navigator.clipboard` only exists in a
 * secure context, and this dashboard is regularly opened against a box over
 * plain http on a LAN address while somebody is setting it up, which is exactly
 * when they most need to copy a record id out of it. `execCommand` is deprecated
 * and still the only thing that works there.
 *
 * Focus is put back where it was: the textarea has to be in the document and
 * focused to be selectable, and leaving the caret in a removed element is how a
 * drawer's keyboard handling stops responding right after a Copy id.
 */
export async function copyText(value) {
  const text = asText(value);
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied', 'good');
    return true;
  } catch {
    /* not a secure context, or permission refused: fall through */
  }

  const back = document.activeElement;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.setAttribute('aria-hidden', 'true');
  // Off screen rather than display:none, because a hidden element cannot be
  // selected. Fixed position so that focusing it does not scroll the page.
  area.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0';
  document.body.append(area);

  let ok = false;
  try {
    area.select();
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  if (back && back.isConnected && typeof back.focus === 'function') back.focus();

  toast(ok ? 'Copied' : 'Could not copy, select the text by hand', ok ? 'good' : 'bad');
  return ok;
}

/**
 * An idempotency key for a write.
 *
 * `crypto.getRandomValues`, never `Math.random`. This is not a decoration on a
 * log line: it is what lets the server recognise a retry of the same composed
 * action as the same action rather than as a second one, so two operators
 * pressing Delete on the same post, or one operator pressing it twice because
 * the box was slow, resolve to one write and one audit row. A predictable
 * sequence is a key that can collide with somebody else's, and a colliding
 * idempotency key is worse than none: it makes a genuinely different action look
 * like a repeat and get swallowed.
 *
 * Lower case alphanumerics only, so it survives being copied out of a log, typed
 * into a filter, or pasted into a shell without quoting.
 */
export function newRef() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const values = new Uint32Array(12);
  crypto.getRandomValues(values);
  let out = 'dash_';
  for (const value of values) out += alphabet[value % alphabet.length];
  return out;
}

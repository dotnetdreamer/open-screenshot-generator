/**
 * The theme: light, dark, and system.
 *
 * Three states, not two. "System" is a real state and not a synonym for
 * whichever of the other two the OS currently resolves to, because the two
 * behave differently over the course of an evening: an operator on system wants
 * the page to go dark on its own when macOS flips at sunset, and an operator
 * who explicitly chose light does not, no matter what their OS does. A two-way
 * toggle cannot express that difference, so this is a three-way control.
 *
 * HOW THE STATE REACHES THE CSS
 * -----------------------------
 * `light` and `dark` stamp `data-theme` on <html>. `system` stamps NOTHING and
 * removes the attribute if it is there. That absence is load bearing: the dark
 * half of styles.css is written as
 *
 *   @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }
 *   :root[data-theme="dark"] { … }
 *
 * so with no attribute the media query alone decides, which is exactly what
 * "follow the system" means, and it keeps following it live because a media
 * query re-evaluates itself. Stamping `data-theme="system"` would happen to
 * work today and would break the first time somebody wrote a rule keyed to the
 * attribute; there is no value in the CSS called "system" and there should not
 * be one here either.
 *
 * THE FLASH
 * ---------
 * This module runs from a `<script type="module">`, which is deferred by
 * definition, which means it runs AFTER first paint. On its own it would repaint
 * the page a moment after the operator sees it, and at 2am a dark-mode operator
 * would get a full-screen white flash on every single load. The fix is not in
 * this file: index.html carries a tiny blocking inline script in <head> that
 * reads the same localStorage key and stamps the same attribute before the
 * first frame. THE KEY NAME BELOW AND THE ONE IN THAT INLINE SCRIPT ARE THE
 * SAME STRING AND HAVE TO STAY THAT WAY. There is no import that can join them
 * up, because an inline script that blocks paint cannot be a module.
 *
 * WHAT THIS MODULE DOES NOT DO
 * ----------------------------
 * It attaches no click handlers and no key handlers. app.js owns the shell and
 * wires the topbar control and Shift+D; if this file also wired them, every
 * press would fire twice and the theme would appear to skip a state. The one
 * thing it does reach into the DOM for is `paintSwitch`, which only writes
 * `aria-pressed`, is idempotent, and is called automatically on every change so
 * the control is correct even if app.js never calls it itself.
 */

/**
 * The storage key. Prefixed, because this dashboard shares an origin with the
 * PocketBase admin UI and with anything else ever mounted on this box, and an
 * unprefixed `theme` key is the kind of thing two apps collide on silently.
 */
export const THEME_KEY = 'osg_dash_theme';

/**
 * Cycle order, and also the validation whitelist. light -> system -> dark ->
 * light. System sits in the middle on purpose: it is the halfway house, so the
 * order reads as a slider from bright to dark rather than as an arbitrary loop.
 */
const MODES = ['light', 'system', 'dark'];

const root = document.documentElement;

/**
 * `matchMedia` is universal now, but this is a tool an operator might open on a
 * ten year old iPad that happens to be the only screen in the room. A missing
 * `matchMedia` should cost the live OS following, not the whole module, so it
 * degrades to a stub that always answers "not dark" and never fires.
 */
const darkQuery =
  typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : { matches: false, addEventListener: null, addListener: null };

const listeners = new Set();

let current = readStored();

/**
 * Reading localStorage can THROW, it does not merely return null.
 *
 * Safari in private browsing used to throw on write, and any browser with
 * "block third party cookies" throws on read when the page is framed. This
 * dashboard is not framed today, but a hook route or a proxy could put it in
 * one tomorrow, and a theme preference is not worth a blank page. Anything we
 * cannot read or do not recognise falls back to `system`, which is also the
 * right default for a first visit: follow the machine until told otherwise.
 */
function readStored() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return MODES.includes(stored) ? stored : 'system';
  } catch (err) {
    return 'system';
  }
}

function writeStored(mode) {
  try {
    // `system` is the default, so it is stored as an ABSENT key rather than as
    // the string "system". That way an operator who lands back on system leaves
    // no trace behind, and a future change of default is picked up by everyone
    // who never expressed an opinion instead of only by new visitors.
    if (mode === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, mode);
  } catch (err) {
    // Non fatal by design. The theme still applies for this tab; it just will
    // not survive a reload, which is a far better failure than a thrown error
    // taking the boot sequence down with it.
    console.warn('dash theme: could not persist the choice', err);
  }
}

/** The mode the operator chose: 'light', 'dark' or 'system'. */
export function getTheme() {
  return current;
}

/**
 * What the page is ACTUALLY painting right now: 'light' or 'dark', never
 * 'system'. Anything that has to pick a colour in JavaScript wants this one,
 * not `getTheme`.
 */
export function resolvedTheme() {
  if (current === 'light' || current === 'dark') return current;
  return darkQuery.matches ? 'dark' : 'light';
}

/**
 * Writes the choice to <html> and to the colour-scheme meta.
 *
 * The meta is belt and braces over the `color-scheme` property that the palette
 * blocks already set: the CSS property is what actually makes native scrollbars,
 * date pickers and `<select>` popups follow the theme, and the meta covers the
 * moment before the stylesheet has applied. Keeping them in step costs one line
 * and stops a white scrollbar appearing beside a dark page.
 */
function apply() {
  if (current === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', current);

  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.setAttribute('content', current === 'system' ? 'light dark' : current);

  paintSwitch();

  const resolved = resolvedTheme();
  listeners.forEach((fn) => {
    try {
      fn(current, resolved);
    } catch (err) {
      // One listener throwing must not stop the others from repainting. A chart
      // that failed to re-read its colours is a chart in the wrong palette; a
      // chart that stopped the loop is every chart after it in the wrong
      // palette, which is much harder to notice and much harder to explain.
      console.warn('dash theme: a listener threw', err);
    }
  });
}

/**
 * Set the mode. Anything not in MODES is ignored loudly rather than stored,
 * because a typo persisted into localStorage is a theme that stays broken
 * across reloads and cannot be fixed from the UI.
 */
export function setTheme(next) {
  if (!MODES.includes(next)) {
    console.warn(`dash theme: ignoring unknown theme "${next}"`);
    return current;
  }
  if (next === current) {
    // Still re-apply. `setTheme` is what app.js calls from a click, and a click
    // on the already-pressed segment should leave the DOM in the state that
    // segment claims, even if something else had knocked the attribute off.
    apply();
    return current;
  }
  current = next;
  writeStored(current);
  apply();
  return current;
}

/** light -> system -> dark -> light. Wired to Shift+D by app.js. */
export function cycleTheme() {
  const index = MODES.indexOf(current);
  return setTheme(MODES[(index + 1) % MODES.length]);
}

/**
 * Subscribe to theme changes. Returns an unsubscribe function, so a view that
 * re-colours a chart can drop its listener in the cleanup the router calls, and
 * a page left open all night does not accumulate one listener per visit.
 *
 * The callback gets `(mode, resolved)`: the choice and what it currently paints
 * as. Chart code wants the second one; a settings screen showing the control
 * wants the first.
 */
export function onThemeChange(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Push the current state onto the three-way control in the topbar.
 *
 * The markup contract, which app.js and index.html both keep:
 *
 *   <button data-theme-set="light|system|dark" aria-pressed="true|false">
 *
 * Only `aria-pressed` is written, and styles.css hangs the fill off exactly
 * that attribute, so the accessible state and the visible state cannot drift
 * apart: there is no separate `is-on` class to forget. Called from `apply` on
 * every change, so any control present in the DOM is always right, including
 * one rendered later inside a drawer.
 */
export function paintSwitch(scope = document) {
  const buttons = scope.querySelectorAll('[data-theme-set]');
  buttons.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.themeSet === current));
  });
}

/**
 * The OS changed its mind while the tab was open.
 *
 * Only worth repainting when we are on `system`, but the listener is attached
 * unconditionally and the guard is inside: attaching and detaching it as the
 * mode changes is more state to get wrong for no measurable gain, and the
 * callback is three lines long.
 *
 * `addEventListener` on a MediaQueryList only landed in Safari 14. The
 * deprecated `addListener` is the fallback and is still the only API on
 * anything older, which is exactly the machine most likely to be running a
 * fixed OS theme.
 */
function onSystemChange() {
  if (current !== 'system') return;
  apply();
}

if (typeof darkQuery.addEventListener === 'function') {
  darkQuery.addEventListener('change', onSystemChange);
} else if (typeof darkQuery.addListener === 'function') {
  darkQuery.addListener(onSystemChange);
}

/**
 * Another tab changed the preference.
 *
 * An operator with the Feed open on one monitor and Integrity on another is the
 * normal way this dashboard gets used, and having half the desk repaint is
 * worse than not offering the setting at all. The `storage` event only fires in
 * the OTHER tabs, never the one that wrote, so there is no loop to guard
 * against. A null `newValue` means the key was removed, which is how `system`
 * is stored.
 */
window.addEventListener('storage', (event) => {
  if (event.key !== THEME_KEY && event.key !== null) return;
  const next = readStored();
  if (next === current) return;
  current = next;
  apply();
});

/**
 * Apply once at import.
 *
 * The inline script in <head> has already stamped the attribute, so this is
 * usually a no-op on <html>. It is not a no-op everywhere else: it is what sets
 * the meta, paints the topbar control's pressed state, and gives every listener
 * registered later a consistent starting point. It also repairs the case where
 * the inline script threw on a locked-down localStorage and stamped nothing.
 */
apply();

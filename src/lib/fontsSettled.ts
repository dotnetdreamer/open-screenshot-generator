// When a font that text was measured without has arrived.
//
// Text is measured in whatever face is loaded at the time, so everything that
// measures has to hear when a face arrives: the locale font fit, the App Store
// check, the header and search designs. Browsers have an event for that,
// `loadingdone`, and WebKit does not fire it. WebKit is what the desktop app
// runs in, and its other signals are no better:
//
//   - It fires `loading` over and over with nothing loading, and
//     `document.fonts.ready` then settles at once, so a listener that measures
//     again on it starts the next round itself. Tried on a blank project, that
//     came to more than 200 rounds in 8 seconds.
//   - `document.fonts.check` says a face is there about three seconds into a
//     load that is still going, which is when the page gives up waiting and
//     draws the fallback.
//
// What works in both engines is asking for the face by name:
// `document.fonts.load` settles when that face has arrived. So the probe in
// textFit.ts names each face it measures in (watchFace), this file asks for
// it once, and what it keeps is its own record of which of those have arrived.

type FaceName = { fontFamily?: string; fontWeight?: string; fontStyle?: string };

const listeners = new Set<() => void>();
let telling = false;

/** Tell every listener, once, however many faces arrived in the same moment. */
function tell(): void {
  if (telling) return;
  telling = true;
  setTimeout(() => {
    telling = false;
    for (const listener of [...listeners]) listener();
  }, 0);
}

let hooked = false;

/**
 * Call `listener` each time a font that matters to measured text has arrived.
 * Returns the way to stop listening.
 *
 * Listeners are told in the order they were added. A module that keeps a cache
 * of measurements adds its own when it loads, which is before any component
 * can, so the cache is empty by the time a component measures again.
 */
export function onFontsSettled(listener: () => void): () => void {
  listeners.add(listener);
  // Chromium and Firefox say when a load has finished, whoever asked for it.
  if (!hooked && typeof document !== 'undefined' && document.fonts?.addEventListener) {
    hooked = true;
    document.fonts.addEventListener('loadingdone', tell);
  }
  return () => {
    listeners.delete(listener);
  };
}

/** The CSS font shorthand that asks the page for a face. `family` is already quoted for CSS. */
export function faceSpec(face: FaceName, family: string): string {
  const style = face.fontStyle === 'italic' || face.fontStyle === 'oblique' ? `${face.fontStyle} ` : '';
  return `${style}${face.fontWeight || '400'} 16px ${family || 'Arial'}`;
}

/**
 * Which parts of Unicode a string draws on, coarsely. A family is served as
 * one file per script, so a face can be on the page for Latin and still be on
 * its way for Cyrillic.
 */
function scriptsOf(text: string): string {
  if (/^[\u0000-\u007f]*$/.test(text)) return '';
  const blocks = new Set<number>();
  for (const char of text) blocks.add((char.codePointAt(0) ?? 0) >> 8);
  return [...blocks].sort((a, b) => a - b).join(',');
}

/** Every face asked for, by shorthand and then by script: true once the page has answered. */
const asked = new Map<string, Map<string, boolean>>();

/**
 * A face the page already had answers in the same breath. One that answers
 * later than this was on its way, whatever `check` said when it was asked for.
 */
const SAME_BREATH_MS = 250;

/**
 * Note that `text` is being measured in this face, and ask the page for the
 * face if nobody has. When it was not there yet, the listeners are told once
 * it arrives. `spec` is the face as a CSS font shorthand (faceSpec).
 */
export function watchFace(spec: string, text: string): void {
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  const scripts = scriptsOf(text);
  let byScript = asked.get(spec);
  if (!byScript) asked.set(spec, (byScript = new Map()));
  if (byScript.has(scripts)) return;
  const answers = byScript;
  const fonts = document.fonts;
  let had = false;
  try {
    had = fonts.check(spec, text);
  } catch {
    // A weight or family the shorthand cannot say. Nothing to wait for.
    answers.set(scripts, true);
    return;
  }
  answers.set(scripts, false);
  const since = performance.now();
  fonts.load(spec, text).then(
    () => {
      answers.set(scripts, true);
      if (!had || performance.now() - since > SAME_BREATH_MS) tell();
    },
    () => {
      // A face that failed stays in its fallback, which is what was measured.
      answers.set(scripts, true);
    }
  );
}

/**
 * True while a face that text was measured in has been asked for and has not
 * arrived. False for a face nothing has measured in. `spec` is the face as a
 * CSS font shorthand (faceSpec).
 */
export function faceOnItsWay(spec: string): boolean {
  const byScript = asked.get(spec);
  if (!byScript) return false;
  for (const arrived of byScript.values()) if (!arrived) return true;
  return false;
}

// The faces layers are measured in when they move between projects, put on
// the page before they are.
//
// Layers that land in a project with another base language are rewritten in
// it (rebaseLanguages in transfer.ts), and the size the new base language's
// text fits its box at is measured in that language's face and stored with the
// layer. Measured in a face this page does not have yet, a webfont still
// loading, a built-in family whose stylesheet has not arrived, or a font
// imported in another window after this one started, it is the size the
// fallback fits at, and it stays stored. So a paste, a move and a copy to
// another tab wait for the faces first. Most of the time they are on the page
// already, and nothing waits.

import { clearLocaleFontSizeCache } from '@/lib/i18n/project';
import { isCustomFontFamily, loadCustomFontFamilies } from '@/services/customFonts';
import { ALL_FONTS, GOOGLE_FONTS, whenBuiltInFacesDeclared } from '@/services/fontService';
import type { TextFace } from './transfer';

const BUILT_IN = new Set(ALL_FONTS.map((font) => font.family.toLowerCase()));
/** The built-in families the Google Fonts stylesheet declares (preloadGoogleFonts). */
const FROM_STYLESHEET = new Set(GOOGLE_FONTS.map((font) => font.family.toLowerCase()));

/**
 * The longest a paste or a move waits for its faces. Past this the network is
 * the trouble, the canvas draws those layers in the fallback as well, and a
 * paste that has not landed after this long reads as one that did nothing.
 */
const FACE_WAIT_MS = 10_000;

/** True when text in the face draws in it now: loaded, or nothing to load, as with a system font. */
function isReady(face: TextFace): boolean {
  try {
    return document.fonts.check(face.font, face.text);
  } catch {
    // A shorthand the browser cannot read has nothing it could load either.
    return true;
  }
}

/**
 * Null when every face is ready, so text measured now is measured right.
 * Otherwise a promise that settles once they are: the built-in families'
 * stylesheet is waited for, a family that may be a font imported in another
 * window is looked for among this device's imported fonts and put on the page,
 * and each face still loading is waited for. It never rejects, and gives up
 * after FACE_WAIT_MS. A face that cannot load is measured as the fallback,
 * which is how the canvas draws it too.
 */
export function whenFacesLoaded(faces: readonly TextFace[]): Promise<void> | null {
  if (typeof document === 'undefined' || !document.fonts || faces.length === 0) return null;
  const families = [...new Set(faces.map((face) => face.family))];
  const unknown = families.filter(
    (family) => !family.includes(',') && !BUILT_IN.has(family.trim().toLowerCase()) && !isCustomFontFamily(family)
  );
  // Before its stylesheet is in, a built-in face is one the page knows nothing
  // of, which check() calls ready.
  const declared = families.some((family) => FROM_STYLESHEET.has(family.trim().toLowerCase()))
    ? whenBuiltInFacesDeclared()
    : null;
  if (!declared && unknown.length === 0 && faces.every(isReady)) return null;
  const loaded = (async () => {
    try {
      await declared;
      await loadCustomFontFamilies(unknown);
      const loading = faces.filter((face) => !isReady(face));
      await Promise.all(loading.map((face) => document.fonts.load(face.font, face.text).catch(() => [])));
      // Text measured while one of them was missing was measured in the fallback.
      if (declared || loading.length > 0 || unknown.some(isCustomFontFamily)) clearLocaleFontSizeCache();
    } catch (error) {
      console.error('Could not load the fonts of the layers', error);
    }
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const givenUp = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, FACE_WAIT_MS);
  });
  return Promise.race([loaded, givenUp]).finally(() => clearTimeout(timer));
}

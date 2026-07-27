// localStorage keys carried across the rename from Artboard Studio to Open
// Screenshot Generator.
//
// The prefix went from `artboard-studio.` to `open-screenshot-generator.`, and
// these keys hold real user state: the signed-in cloud account and the AI
// provider API keys. Reading straight from the new key would have looked like a
// silent sign-out plus a wiped key list to anyone who had used the app before.
//
// The move happens on the first read of each key and is one-way, so it costs a
// single extra lookup once and nothing afterwards.

const LEGACY_PREFIX = 'artboard-studio.';
const CURRENT_PREFIX = 'open-screenshot-generator.';

/** `null` for a key that was never on the old prefix. */
function legacyKeyFor(key: string): string | null {
  return key.startsWith(CURRENT_PREFIX) ? LEGACY_PREFIX + key.slice(CURRENT_PREFIX.length) : null;
}

/**
 * Read `key`, falling back to its pre-rename name and moving the value over
 * when only the old one is present.
 */
export function readWithLegacyFallback(key: string): string | null {
  if (typeof window === 'undefined') return null;

  const legacyKey = legacyKeyFor(key);
  let legacy: string | null = null;
  try {
    const current = window.localStorage.getItem(key);
    if (current !== null) return current;
    if (!legacyKey) return null;
    legacy = window.localStorage.getItem(legacyKey);
  } catch {
    // Storage is unavailable entirely (private mode with cookies blocked).
    return null;
  }
  if (legacy === null || !legacyKey) return null;

  try {
    window.localStorage.setItem(key, legacy);
    window.localStorage.removeItem(legacyKey);
  } catch {
    // A full quota. The value is still returned for this session and the old
    // key stays put, so the move can land on a later load.
  }
  return legacy;
}

/**
 * Remove `key` under both names. Clearing only the new one would let a
 * not-yet-migrated value come back on the next load.
 */
export function removeWithLegacy(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
    const legacyKey = legacyKeyFor(key);
    if (legacyKey) window.localStorage.removeItem(legacyKey);
  } catch {
    // Ignore.
  }
}

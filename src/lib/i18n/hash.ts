// A fingerprint of the base string a translation was made from.
//
// Stored on every override as `sourceHash`. When the English headline is later
// edited the hash stops matching and the translation is flagged stale instead
// of being silently overwritten, which is the one behaviour every reference
// tool converged on: refreshing a reviewed human translation is always an
// explicit action.
//
// FNV-1a, 32 bits. Not a security hash and not trying to be: it is compared
// against a value we wrote ourselves seconds earlier, so collision resistance
// costs more than it buys, and this runs over every localizable string on every
// render of the translation table.

/** Short stable hex fingerprint of `input`. Always 8 characters. */
export function hash32(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // The FNV prime, 16777619, via shifts: Math.imul keeps it in 32 bits
    // where a plain `*` would lose precision above 2^53.
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

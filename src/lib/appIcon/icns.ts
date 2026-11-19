/**
 * A Mac .icns file, the icon format apps built without Xcode use (Tauri and
 * Electron among them). It is a list of typed entries, each a PNG here, after
 * an 8 byte header: "icns" and the length of the whole file, big-endian.
 * Which type holds which size is ICNS_ENTRIES in exportPlan.ts.
 */

export function buildIcns(entries: readonly { type: string; png: Uint8Array }[]): Uint8Array {
  const total = 8 + entries.reduce((sum, entry) => sum + 8 + entry.png.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  const writeType = (at: number, type: string) => {
    for (let i = 0; i < 4; i++) out[at + i] = type.charCodeAt(i) & 0xff;
  };
  writeType(0, 'icns');
  view.setUint32(4, total);
  let at = 8;
  for (const entry of entries) {
    if (entry.type.length !== 4) throw new Error(`An .icns entry type has four letters, not "${entry.type}"`);
    writeType(at, entry.type);
    view.setUint32(at + 4, 8 + entry.png.length);
    out.set(entry.png, at + 8);
    at += 8 + entry.png.length;
  }
  return out;
}

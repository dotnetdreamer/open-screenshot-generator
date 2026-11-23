// Downloads the film's four faces (latin subset, woff2) from Google Fonts into
// assets/fonts/, so renders never fetch. Run once: node scripts/fetch-fonts.mjs
import { writeFile, mkdir } from "node:fs/promises";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const FAMILIES = [
  ["Space Grotesk", "wght@500;700"],
  ["Inter", "wght@400;500;600;700"],
  ["JetBrains Mono", "wght@500;700"],
  ["Instrument Serif", "ital@0;1"],
];
const out = new URL("../assets/fonts/", import.meta.url);
await mkdir(out, { recursive: true });

for (const [family, axes] of FAMILIES) {
  const url = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:${axes}&display=block`;
  const css = await (await fetch(url, { headers: { "User-Agent": UA } })).text();
  // Each block: /* latin */ @font-face { font-style; font-weight; src: url(...) }
  const blocks = css.split("/* ").filter((b) => b.startsWith("latin */"));
  for (const b of blocks) {
    const style = /font-style:\s*(\w+)/.exec(b)[1];
    const weight = /font-weight:\s*(\d+)/.exec(b)[1];
    const src = /url\((https:[^)]+\.woff2)\)/.exec(b)[1];
    const name = `${family.replace(/ /g, "")}-${weight}${style === "italic" ? "i" : ""}.woff2`;
    const buf = Buffer.from(await (await fetch(src)).arrayBuffer());
    await writeFile(new URL(name, out), buf);
    console.log(name, buf.length);
  }
}

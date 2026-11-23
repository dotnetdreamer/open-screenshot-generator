// Cuts the product pictures the screens use out of the app's own captures and
// exports (promo/public, public/elements/images), scaled to the size they are
// drawn at, into assets/shots/. Needs ffmpeg. Run: node scripts/prep-shots.mjs
//
// Every source is real output of the app: editor captures from the PromoFeatures
// rig (promo/scripts/features2), the Juniper store set the editor exported, the
// template previews of the vs cut, 3D Studio renders, and the in-house 3D objects,
// stickers and mascots of the Images palette (docs/image-asset-licenses.md
// section 5). No Adobe Stock photograph is copied here.
import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const P = (p) => path.join(repo, "promo/public", p);
const LIB = (p) => path.join(repo, "public/elements/images", p);
const OUT = path.resolve(here, "../assets/shots");
mkdirSync(OUT, { recursive: true });

/** crop: [x, y, w, h] in source px or null; width: output width; key: chroma key colour for a mask. */
function cut(src, out, { crop = null, width, key = null } = {}) {
  const vf = [];
  if (crop) vf.push(`crop=${crop[2]}:${crop[3]}:${crop[0]}:${crop[1]}`);
  if (width) vf.push(`scale=${width}:-2:flags=lanczos`);
  if (key) vf.push(`format=rgba,colorkey=${key}:0.13:0.04`);
  const args = ["-v", "error", "-y", "-i", src, "-vf", vf.join(",") || "null"];
  args.push("-c:v", "libwebp", "-quality", "92", "-lossless", "0");
  if (key || /\.png$/i.test(src)) args.push("-pix_fmt", key ? "yuva420p" : "yuva420p");
  args.push(path.join(OUT, out));
  const r = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${out}: ${r.stderr}`);
  console.log("ok", out);
}

// 01 Templates: preview strips of real templates (five store screenshots each)
const WALL = ["droply-habits", "budgetly-finance", "plannio-student", "coinly-crypto", "vowly-wedding", "kicksy-sneakers", "calora-macros", "nookly-focus", "tripora-travel", "feasto", "beatforge-studio", "lotus-calm"];
for (const w of WALL) cut(P(`vs/wall/${w}.png`), `wall-${w}.webp`, { width: 1100 });

// 02 Your screenshots: Juniper's raw screens and the store set they became
for (const s of ["today", "detail", "add"]) cut(P(`juniper/en/${s}.png`), `raw-${s}.webp`, { width: 420 });
// 02, 09, 15: the exported Juniper set in four languages
for (const l of ["en", "de", "ja", "ar"]) for (const b of [1, 2, 3, 4, 5]) cut(P(`features2/juniper-set/${l}/b${b}.png`), `set-${l}-b${b}.webp`, { width: 440 });

// 03 Edit anything: the first board large, the same board with its background keyed out, the palette
cut(P("features2/juniper-set/en/b1.png"), "edit-b1.webp", { width: 600 });
cut(P("features2/juniper-set/en/b1.png"), "edit-b1-keyed.webp", { width: 600, key: "0x2D6A4F" });
cut(P("features2/design/editor-color.png"), "edit-palette.webp", { crop: [2270, 1185, 560, 340], width: 560 });

// 05 3D phones: 3D Studio turning a phone, plus finishes and a Pixel
for (let k = 0; k < 48; k += 2) cut(P(`features2/design/studio3d/turn-${String(k).padStart(2, "0")}.png`), `turn-${String(k / 2).padStart(2, "0")}.webp`, { crop: [400, 100, 800, 1420], width: 470 });
for (const f of ["finish-burgundy", "finish-forest", "finish-silver", "pixel"]) cut(P(`features2/design/studio3d/${f}.png`), `studio-${f}.webp`, { crop: [300, 100, 1000, 1400], width: 260 });

// 06 One picture: the panorama set
for (const b of [1, 2, 3]) cut(P(`features2/design/panorama/b${b}.png`), `pano-b${b}.webp`, { width: 400 });

// 07 Picture library: in-house 3D objects, stickers and mascots
const LIBRARY = [
  "objects/object-app-globe.png", "objects/object-app-heart.png", "objects/object-app-lens.png", "objects/object-airliner.png",
  "stickers/sticker-avatar-girl.png", "stickers/sticker-backpack.png", "stickers/sticker-avatar-dad.png",
  "mascots/mascot-box-robot.png", "mascots/mascot-bunny-medal.png",
];
for (const f of LIBRARY) if (existsSync(LIB(f))) cut(LIB(f), `lib-${path.basename(f, ".png")}.webp`, { width: 260 });

// 08 Community: the two trending posts and the share button
cut(P("features2/more/discover.png"), "community-head.webp", { crop: [120, 200, 1000, 92], width: 700 });
cut(P("features2/more/discover.png"), "community-card1.webp", { crop: [128, 318, 1290, 742], width: 900 });
cut(P("features2/more/discover.png"), "community-card2.webp", { crop: [1458, 318, 1290, 742], width: 900 });
cut(P("features2/more/discover.png"), "community-share.webp", { crop: [2172, 210, 340, 84], width: 300 });

// 11 Preview videos: the three video boards and the timeline under them
cut(P("features2/design/video/editor-timeline.png"), "video-boards.webp", { crop: [690, 232, 1296, 930], width: 900 });
cut(P("features2/design/video/editor-timeline.png"), "video-timeline.webp", { crop: [690, 1200, 1526, 462], width: 900 });

// 12 Capture: every screen in every language, and the button that takes them
cut(P("features2/flows/capture-done.png"), "capture-grid.webp", { crop: [700, 270, 1640, 1390], width: 940 });
cut(P("features2/flows/capture-done.png"), "capture-button.webp", { crop: [1238, 146, 520, 82], width: 420 });

// 13 AI agent: the boards it built, its header, its steps, its summary and the prompt box
cut(P("features2/flows/agent-chat.png"), "agent-boards.webp", { crop: [676, 198, 1268, 556], width: 900 });
cut(P("features2/flows/agent-chat.png"), "agent-head.webp", { crop: [2040, 255, 840, 78], width: 600 });
cut(P("features2/flows/agent-chat.png"), "agent-steps.webp", { crop: [2060, 790, 810, 232], width: 600 });
cut(P("features2/flows/agent-chat.png"), "agent-done.webp", { crop: [2060, 1425, 810, 92], width: 600 });

// 10 Every device: the app's own Every device view (All devices), captured by
// scripts/capture-every-device.cjs from the dev server with Droply Habits open
const EV = path.join(here, ".captures/every");
if (existsSync(path.join(EV, "all-devices.png"))) {
  cut(path.join(EV, "all-devices.png"), "every-head.webp", { crop: [130, 108, 1330, 82], width: 900 });
  cut(path.join(EV, "all-devices.png"), "every-iphone.webp", { crop: [785, 244, 715, 276], width: 600 });
  cut(path.join(EV, "all-devices.png"), "every-ipad.webp", { crop: [785, 854, 955, 276], width: 801 });
  cut(path.join(EV, "all-devices.png"), "every-android.webp", { crop: [785, 1463, 805, 276], width: 675 });
  cut(path.join(EV, "all-devices-1.png"), "every-mac.webp", { crop: [785, 1489, 1185, 272], width: 994 });
} else console.log("skip every-*: run node scripts/capture-every-device.cjs first (dev server on :9002)");

// 15 Store listing: the App Store page as the preview shows it on an iPhone
cut(P("features2/more/header/listing.png"), "listing-phone.webp", { crop: [820, 235, 646, 1346], width: 460 });

// 16 Every size: the export dialog in three parts
cut(P("features2/flows/export.png"), "export-top.webp", { crop: [960, 120, 966, 440], width: 860 });
cut(P("features2/flows/export.png"), "export-sizes.webp", { crop: [960, 590, 966, 420], width: 860 });
cut(P("features2/flows/export.png"), "export-foot.webp", { crop: [960, 1440, 966, 270], width: 860 });

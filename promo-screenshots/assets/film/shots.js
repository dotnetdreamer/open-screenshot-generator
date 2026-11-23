// The product pictures the demos use, made by scripts/prep-shots.mjs from the
// app's own captures and exports in promo/public. Key: file (or list of files).
const set = (l) => [1, 2, 3, 4, 5].map((b) => `set-${l}-b${b}.webp`);

export const SHOTS = {
  // droply-habits sits at index 7, where the Templates scroll stops (demos.js PICK)
  wall: ["budgetly-finance", "vowly-wedding", "coinly-crypto", "plannio-student", "kicksy-sneakers", "calora-macros", "nookly-focus", "droply-habits", "tripora-travel", "feasto", "beatforge-studio", "lotus-calm"].map((w) => `wall-${w}.webp`),
  raw: ["raw-today.webp", "raw-detail.webp", "raw-add.webp"],
  setEn: set("en"),
  setDe: set("de"),
  setJa: set("ja"),
  setAr: set("ar"),
  editB1: "edit-b1.webp",
  editKeyed: "edit-b1-keyed.webp",
  palette: "edit-palette.webp",
  turn: Array.from({ length: 24 }, (_, k) => `turn-${String(k).padStart(2, "0")}.webp`),
  finishes: ["studio-finish-burgundy.webp", "studio-finish-forest.webp", "studio-finish-silver.webp", "studio-pixel.webp"],
  pano: ["pano-b1.webp", "pano-b2.webp", "pano-b3.webp"],
  lib: [
    "lib-object-app-globe.webp", "lib-sticker-avatar-girl.webp", "lib-mascot-box-robot.webp",
    "lib-object-app-heart.webp", "lib-sticker-backpack.webp", "lib-object-airliner.webp",
    "lib-mascot-bunny-medal.webp", "lib-object-app-lens.webp", "lib-sticker-avatar-dad.webp",
  ],
  communityHead: "community-head.webp",
  communityCards: ["community-card1.webp", "community-card2.webp"],
  communityShare: "community-share.webp",
  videoBoards: "video-boards.webp",
  videoTimeline: "video-timeline.webp",
  captureGrid: "capture-grid.webp",
  captureButton: "capture-button.webp",
  agentBoards: "agent-boards.webp",
  agentHead: "agent-head.webp",
  agentSteps: "agent-steps.webp",
  agentDone: "agent-done.webp",
  listing: "listing-phone.webp",
  // the app's own Every device view (scripts/capture-every-device.cjs), Droply Habits laid out per device
  everyHead: "every-head.webp",
  every: ["every-iphone.webp", "every-ipad.webp", "every-android.webp", "every-mac.webp"],
  exportTop: "export-top.webp",
  exportSizes: "export-sizes.webp",
  exportFoot: "export-foot.webp",
};

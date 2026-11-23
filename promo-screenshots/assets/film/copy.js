// Every word on screen. House style (promo/README.md): plain words, no dashes,
// no full stop at the end of a line. Numbers are checked against the code:
// 122 templates (src/lib/templateCategories.ts), 57 languages
// (src/lib/i18n/locales.ts), 17 phones in 3D Studio (src/lib/device3dModels.ts),
// 276 library pictures (src/lib/imageLibrary.ts). `mono` is the label the app
// itself uses for the feature, so a viewer can find it. `short` is the line on
// the slate at the end.
//
// The root composition exposes name and sub as variables (index.html), so they
// can be edited in the HyperFrames Studio; COPY is the default.

export const FEATURES = [
  { name: "Templates", sub: "122 designs to start from", mono: "App Screenshots · Apple Watch · Mac", short: "122 designs to start from", accent: "#F5B83D" },
  { name: "Your screenshots", sub: "every design shows your own screens", mono: "Start from your screenshots", short: "dropped into every design", accent: "#6FB3B5" },
  { name: "Edit anything", sub: "change any word, color or layout", mono: "Properties", short: "any word, color or layout", accent: "#FF7A59" },
  { name: "Your fonts", sub: "bring the font your brand uses", mono: "Import font file", short: "import any font file", accent: "#B08CFF" },
  { name: "3D phones", sub: "17 real phones, turned to any angle", mono: "3D Studio (any angle)", short: "17 real phones, any angle", accent: "#5EC8FF" },
  { name: "One picture", sub: "carries on as people swipe your set", mono: "All artboards, split", short: "one picture across the set", accent: "#4FD1A5" },
  { name: "Picture library", sub: "276 pictures ready to drop in", mono: "Images", short: "276 pictures to drop in", accent: "#FF6FAE" },
  { name: "Community", sub: "start from designs other people shipped", mono: "Trending in the community", short: "designs other people shipped", accent: "#FFD166" },
  { name: "57 languages", sub: "translated for you from one design", mono: "Translate text", short: "one design, every language", accent: "#7C9CFF" },
  { name: "Every device", sub: "laid out again for iPad, Android and Mac", mono: "Every device", short: "iPad, Android and Mac", accent: "#D4AF37" },
  { name: "Preview videos", sub: "your recording in a phone, with music", mono: "App Preview Videos", short: "your recording, with music", accent: "#FF5A5F" },
  { name: "Capture", sub: "takes the screenshots of your app for you", mono: "Take all screens in all languages", short: "screenshots taken for you", accent: "#A3E635" },
  { name: "AI agent", sub: "say what you want and watch it build", mono: "Claude Code · Codex", short: "say it, watch it build", accent: "#FF9F43" },
  { name: "CLI", sub: "store images from your terminal", mono: "npx open-screenshot-generator", short: "store images from a terminal", accent: "#39D98A" },
  { name: "Store listing", sub: "see your set the way shoppers will", mono: "Store listing", short: "see it as shoppers will", accent: "#8B7CFF" },
  { name: "Every size", sub: "every size the stores ask for, in one click", mono: "Export screenshots", short: "every store size, one click", accent: "#E9C46A" },
];

export const SLATE = {
  count: "16 features.",
  accent: "One take.",
  prod: "Open Screenshot Generator",
  take: "TAKE 1",
  pill: "Free and open source · openscrgen.app",
  note: "Capture, Claude Code and Codex need the free desktop app",
};

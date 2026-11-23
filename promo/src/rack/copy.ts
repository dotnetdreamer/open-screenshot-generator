/**
 * Every word on screen in the rack cut. House style: plain words, no dashes,
 * no full stop at the end of a line. `name` is the module's title and what the
 * terminal types after /add; `sub` is the line under it and on the end card.
 *
 * The film leaves out everything about making the screenshots themselves
 * (templates, the editor, languages, Capture, every device): these are the
 * other eighteen things the app does. Column one gets the app ready to launch,
 * column two shows how it is doing, column three is how you work with it, and
 * the last module sends the set to the stores.
 */
export type Feature = { name: string; sub: string };

export const FEATURES: Feature[] = [
  { name: "App icon", sub: "one design, every icon size" },
  { name: "Remove background", sub: "cut people and products out of photos" },
  { name: "Header art", sub: "for the new App Store in iOS 27" },
  { name: "Social graphics", sub: "posts, stories and banners in one go" },
  { name: "Website", sub: "home, support and privacy pages" },
  { name: "SEO", sub: "found on Google and in AI answers" },

  { name: "Growth", sub: "downloads, ratings and reviews in one place" },
  { name: "Before and after", sub: "did the new screenshots work?" },
  { name: "Keywords", sub: "your App Store search rank, every day" },
  { name: "Competitors", sub: "know when they change screenshots" },
  { name: "Reviews", sub: "AI drafts a reply in the reviewer's language" },
  { name: "Store compliance", sub: "why apps get rejected, in plain words" },

  { name: "Edit together", sub: "see who is working where, live" },
  { name: "Versions", sub: "every version kept, put any one back" },
  { name: "Drive and GitHub", sub: "projects saved to your own account" },
  { name: "MCP server", sub: "let your AI tools drive the editor" },
  { name: "Second screen", sub: "panels in a window of their own" },
  { name: "Store upload", sub: "sent straight to both stores" },
];

export const HEADER = {
  title: "open screenshot generator · v1.0.11",
  /** What the terminal says before the first module, and after the last. */
  before: "screenshots done",
  after: "ship it",
};

export const CARD = {
  count: "18 tools,",
  accent: "one app",
  kicker: "Open Screenshot Generator",
  pill: "Free and open source · openscrgen.app",
  note: "Upload, Growth and Reviews need the free desktop app",
};

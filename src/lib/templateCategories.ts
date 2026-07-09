import type { Size } from '@/types/artboard';

// Categories for the "Start a New Project" template picker. Each category is a
// tab in that dialog: its `files` are the template JSONs under
// public/data/projects, and `defaultSize` is the canvas size used when the user
// clicks "Start Blank" while this tab is active (so a blank Feature Graphic is
// 1024×500, not a phone screenshot).
//
// Adding a surface later (e.g. Apple marketing) means appending one entry here;
// the dialog builds its tabs, count badges, and panels from this catalog, so no
// component edits are needed to grow the tab set.

export interface TemplateCategory {
  // Stable id, unique across the catalog. Tagged onto every loaded Project so
  // the dialog can filter templates into their tab.
  id: string;
  label: string;
  // Optional sub-copy shown in the empty state when this category has no
  // templates yet.
  blurb?: string;
  // Canvas size for "Start Blank" while this tab is active.
  defaultSize: Size;
  // Template JSON filenames (in public/data/projects) belonging to this tab.
  files: string[];
  // How the picker renders this category's preview thumbnails. App-screenshot
  // previews are a wide strip of several phone screens, so the box is wide and
  // the image is contained (never cropped) so every screen stays readable;
  // banner previews are a single ~1024×500 frame, so the box matches that ratio
  // and the image covers it edge to edge.
  previewAspect: string; // CSS aspect-ratio, e.g. '3 / 1' or '1024 / 683'
  previewFit: 'cover' | 'contain';
  // Tailwind grid-template-columns utilities for this category's card grid.
  // Wide strips want fewer, wider columns; banners pack more per row.
  gridClassName: string;
}

export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  {
    id: 'screenshots',
    label: 'App Screenshots',
    blurb: 'Portrait App Store and Play Store screenshot layouts.',
    defaultSize: { width: 1290, height: 2796 },
    previewAspect: '3 / 1',
    previewFit: 'contain',
    gridClassName: 'grid-cols-1 lg:grid-cols-2',
    files: [
      'breathora-breathing.json',
      'vowly-wedding.json',
      'verda-eco.json',
      'connectly-chat.json',
      'budgetly-finance.json',
      'listly-tasks.json',
      'inboxly-mail.json',
      'darzi-studio.json',
      'beauty-glam.json',
      'castique-podcast.json',
      'inquira.json',
      'zyluxe-beauty.json',
      'nexmind.json',
      'endless-communities.json',
      'kicksy-sneakers.json',
      'endless-podcasts.json',
      'answerly-ai.json',
      'lumina-search.json',
      'streamio-movies.json',
      'readly-books.json',
      'luxe-glow.json',
      'cryptix.json',
      'feasto.json',
      'storybuzz-kids.json',
      'trackio-fitness.json',
      'streamio-binge.json',
      'roomora-home.json',
      'playverse-games.json',
      'voyago-travel.json',
      'finexa-crypto.json',
      'flixio-kids.json',
      'listenly-audio.json',
      'tripora-travel.json',
      'tunio-music.json',
      'coinly-crypto.json',
      'stockio-invest.json',
      'threadly-social.json',
      'beatforge-studio.json',
      'podly-podcasts.json',
      'cinevault-stream.json',
      'sereno-mind.json',
      'droply-habits.json',
      'zeeb-fashion.json',
      'lingua-learn.json',
    ],
  },
  {
    id: 'apple-watch',
    label: 'Apple Watch',
    blurb: 'App Store Apple Watch screenshot layouts with 3D watch mockups.',
    // Apple Watch Ultra 3 (49mm) — the required App Store baseline watch size;
    // the store auto-scales it down to the smaller watch tiers.
    defaultSize: { width: 422, height: 514 },
    // Watch screens are near-square portraits, so a template's card shows a wide
    // strip of several watch mockups (contained, never cropped), same treatment
    // as the App Screenshots tab.
    previewAspect: '3 / 1',
    previewFit: 'contain',
    gridClassName: 'grid-cols-1 lg:grid-cols-2',
    files: [
      'watch-breathora.json',
      'watch-vowly.json',
      'watch-smart-appscreens.json',
      'watch-editors-choice.json',
      'watch-dark-aso.json',
      'watch-ultra-showcase.json',
      'watch-lavender.json',
      'watch-sunset.json',
    ],
  },
  {
    id: 'play-feature-graphic',
    label: 'Google Feature Graphic',
    blurb: 'Google Play 1024×500 feature banner.',
    defaultSize: { width: 1024, height: 500 },
    previewAspect: '1024 / 683',
    previewFit: 'cover',
    gridClassName: 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3',
    files: [
      'fg-wallet-protected.json',
      'fg-expense-tracking.json',
      'fg-fitness-all-in-one.json',
      'fg-trading-app.json',
      'fg-alertlab.json',
      'fg-wallet-your-app.json',
      'fg-work-play-happy.json',
      'fg-paws-hearts.json',
      'fg-chat-connect.json',
      'fg-music-stream.json',
      'fg-food-delivery.json',
      'fg-habit-tracker.json',
      'fg-travel-explore.json',
      'fg-crypto-portfolio.json',
      'fg-productivity-tasks.json',
    ],
  },
];

// Flat filename list for callers that just want every template file.
export const ALL_TEMPLATE_FILES: string[] =
  TEMPLATE_CATEGORIES.flatMap((c) => c.files);

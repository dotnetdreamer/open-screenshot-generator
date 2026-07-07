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
}

export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  {
    id: 'screenshots',
    label: 'App Screenshots',
    blurb: 'Portrait App Store and Play Store screenshot layouts.',
    defaultSize: { width: 1290, height: 2796 },
    files: [
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
    id: 'play-feature-graphic',
    label: 'Feature Graphic',
    blurb: 'Google Play 1024×500 feature banner.',
    defaultSize: { width: 1024, height: 500 },
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

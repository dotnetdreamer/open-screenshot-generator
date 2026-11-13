// The two stores Growth reads, and how an app says which one it is in.
//
// An App Store app keeps the id App Store Connect gives it (all digits). A
// Google Play app has no such id, so Growth names it after its package:
// `play:com.example.app`. The prefix keeps the two apart in the database, where
// every row is keyed by app id, and tells every screen which store's words to use.

export type GrowthStore = 'appstore' | 'playstore';

const PLAY_PREFIX = 'play:';

export function playAppId(packageName: string): string {
  return `${PLAY_PREFIX}${packageName.trim()}`;
}

/** The package name of a Google Play app id, or null for an App Store app. */
export function packageOf(appId: string): string | null {
  return appId.startsWith(PLAY_PREFIX) ? appId.slice(PLAY_PREFIX.length) : null;
}

export function storeOf(appId: string): GrowthStore {
  return appId.startsWith(PLAY_PREFIX) ? 'playstore' : 'appstore';
}

export function isPlayApp(appId: string): boolean {
  return storeOf(appId) === 'playstore';
}

/** Words that change with the store, so a sentence can name the right one. */
export interface StoreWords {
  /** "App Store", "Google Play". */
  store: string;
  /** Where the developer manages the app: "App Store Connect", "Play Console". */
  console: string;
  /** Who sends the numbers: "Apple", "Google". */
  owner: string;
  /** The key Growth reads with. */
  key: string;
}

export const STORE_WORDS: Record<GrowthStore, StoreWords> = {
  appstore: { store: 'App Store', console: 'App Store Connect', owner: 'Apple', key: 'App Store Connect API key' },
  playstore: { store: 'Google Play', console: 'Play Console', owner: 'Google', key: 'Google Play service account key' },
};

export function wordsFor(appId: string): StoreWords {
  return STORE_WORDS[storeOf(appId)];
}

/** The public store page of a Google Play app. */
export function playStoreUrl(packageName: string): string {
  return `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageName)}`;
}

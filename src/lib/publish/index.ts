// Direct-to-store publishing: the public surface.
//
// The two stores are different enough that there is no useful common
// interface (Apple needs app + version + locale + a per-size set, Play needs a
// package + language + one slot), so unlike src/lib/account there is no
// provider abstraction here. The dialog talks to whichever client it needs and
// this file is the single import site.

import { isTauri } from '@/lib/desktop';

export * from './types';
export {
  APPLE_DISPLAY_TARGETS,
  PLAY_IMAGE_TARGETS,
  appleTargetForSize,
  nearestAppleSizes,
  suggestPlayImageType,
  validatePlayImage,
  type AppleDisplayTarget,
  type PlayImageTarget,
} from './storeTargets';
export {
  getStoreCredentials,
  setAppStoreCredentials,
  setPlayCredentials,
  clearStoreCredentials,
  subscribeToStoreCredentials,
  useStoreCredentials,
} from './credentials';
export {
  MAX_SCREENSHOTS_PER_SET,
  forgetAppStoreToken,
  listAppStoreApps,
  listAppStoreLocalizations,
  listAppStoreVersions,
  uploadAppStoreScreenshots,
  type AppStoreApp,
  type AppStoreLocalization,
  type AppStoreVersion,
  type AppStoreUploadOptions,
} from './appStoreConnect';
export {
  forgetPlayToken,
  listPlayLanguages,
  parseServiceAccount,
  serviceAccountEmail,
  uploadPlayScreenshots,
  verifyPlayAccess,
  type PlayListing,
  type PlayUploadOptions,
} from './googlePlay';

/**
 * Store uploads are desktop only, and not as a product decision:
 * api.appstoreconnect.apple.com serves no CORS headers, so a browser tab
 * physically cannot call it. The desktop build routes these requests through
 * tauri-plugin-http, which goes out through Rust and never sees CORS.
 */
export function isStorePublishingAvailable(): boolean {
  return isTauri();
}

/** data: URL from html-to-image to raw bytes, without a round trip through fetch. */
export function decodeDataUrl(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  const binary = atob(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

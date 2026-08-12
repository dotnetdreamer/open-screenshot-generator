// Direct-to-store publishing: shared types.
//
// The editor already renders store-correct PNGs; this layer hands them to the
// two stores that matter without a round trip through the user's Downloads
// folder. Same bring-your-own-credentials stance as src/lib/account: we host
// nothing, there is no server in this product, and the keys stay on the
// machine that uses them.
//
// Both APIs are reached with the user's OWN developer credentials:
//   - App Store Connect: an API key (issuer id + key id + .p8), ES256 JWT
//   - Google Play: a service account JSON key, RS256 JWT bearer grant
//
// Desktop only, and not by choice: api.appstoreconnect.apple.com serves no
// CORS headers, so a browser tab can never reach it. The Tauri build routes
// these calls through tauri-plugin-http (Rust side, no CORS), the same escape
// hatch the free AI providers and the account layer already use.

export type StoreId = 'appstore' | 'playstore';

/** An App Store Connect API key, created under Users and Access > Integrations. */
export interface AppStoreCredentials {
  /** UUID shown once at the top of the Integrations page. */
  issuerId: string;
  /** The 10-character key id of the .p8. */
  keyId: string;
  /** Contents of the downloaded AuthKey_XXXXXXXXXX.p8 (PKCS#8 PEM). */
  privateKey: string;
}

/** A Google Play service account key, plus the app it may publish to. */
export interface PlayCredentials {
  /** The whole service-account JSON file, verbatim. */
  serviceAccountJson: string;
  /** e.g. com.example.app. Play has no list-apps API, so this is typed in. */
  packageName: string;
}

/** Everything the credential store holds. One key set per store. */
export interface StoreCredentials {
  appstore?: AppStoreCredentials;
  playstore?: PlayCredentials;
}

/** One rendered artboard, ready to hand to a store. */
export interface PublishImage {
  /** The artboard it came from, so the UI can label progress rows. */
  artboardId: string;
  /** Name the store files it under, always ending in .png. */
  fileName: string;
  bytes: Uint8Array;
  width: number;
  height: number;
  /**
   * The project language this was rendered in. Absent on single-language
   * projects. Set by whoever captured the image rather than by whoever asked
   * for it, so a batch upload labels each set by what actually got painted.
   */
  locale?: string;
}

export type PublishStage =
  | 'authenticating'
  | 'preparing'
  | 'clearing'
  | 'uploading'
  | 'committing'
  | 'processing'
  | 'done';

export interface PublishProgress {
  stage: PublishStage;
  /** Sentence shown under the progress bar. */
  message: string;
  /** 1-based image number and total, when the stage is per image. */
  current?: number;
  total?: number;
}

export type PublishProgressFn = (progress: PublishProgress) => void;

/** What actually landed in the store, for the summary panel. */
export interface PublishResult {
  uploaded: number;
  /** Non-fatal problems: an image the store rejected, a reorder that failed. */
  warnings: string[];
  /** Where the user should go to check the result. */
  reviewUrl?: string;
}

/**
 * The credentials are wrong, expired, or lack permission. The dialog sends the
 * user back to the credentials step instead of showing a dead end, matching
 * how AccountAuthError works in the account layer.
 */
export class StoreAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreAuthError';
  }
}

/** Anything the store refused that the user can fix (wrong size, full set). */
export class StoreRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreRejectedError';
  }
}

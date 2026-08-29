/**
 * `osg upload` - push the rendered set to App Store Connect or Google Play.
 *
 * CREDENTIALS, FIRST, BECAUSE THEY ARE THE RISK HERE
 *
 * Two secrets can pass through this command: an App Store Connect .p8 private
 * key, which can publish and withdraw builds for the whole team, and a Google
 * Play service account JSON, which can change a live listing. The rules this
 * command follows, without exception:
 *
 *   - They are named by PATH, in the config or in an environment variable.
 *     Never by value. `keyFile: './AuthKey_ABC123.p8'` is a path; a config that
 *     contains the key itself is a config that gets committed.
 *   - They are read from disk at run time, held for the length of the run, and
 *     handed to the page as an argument of the upload call.
 *   - They are never written into the editor's localStorage. The dialog inside
 *     the app stores them there for a person who uses it every day (see
 *     src/lib/publish/credentials.ts); a CLI run is a different bargain, and
 *     leaving a key in a browser profile the user cannot see is not one this
 *     command makes.
 *   - Nothing is ever written back into the committed config. `osg upload` does
 *     not "save" a key it was given.
 *   - The key file is warned about if it sits inside the project directory,
 *     because the next thing that happens to a file in a repo is a commit.
 *
 * WHY THE UPLOAD RUNS IN THE PAGE
 *
 * The store clients in src/lib/publish are already desktop grade: Apple's
 * three-step asset reservation with the MD5 confirmation and the asynchronous
 * delivery poll, Play's single staged edit so a five-language run is atomic.
 * Reimplementing that in node would be a second implementation of the one part
 * of this product where being wrong is publicly visible, so the bytes are
 * captured in the page (session.capture) and the upload is run in the page too,
 * through `window.__osg.publish`.
 *
 * The page has one thing node does not: the app's own code. Node has one thing
 * the page does not: a socket with no CORS rules on it. api.appstoreconnect.
 * apple.com sends no CORS headers at all, which is exactly why the desktop
 * build routes these calls through tauri-plugin-http. This command plays that
 * same role for the browser: `window.fetch` is swapped for a shim that hands
 * cross-origin requests to node and hands the response back, so every byte of
 * store logic stays in the app and only the socket moves. The shim is removed
 * again when the run ends.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { CommandContext } from '../context.js';
import type { Session } from '../driver/session.js';
import { flagBool, flagList, flagString } from '../args.js';
import { EXIT, OsgError, driverError, usageError } from '../errors.js';
import { bold, cyan, debug, dim, emit, humanBytes, info, ok, step, warn } from '../log.js';

// --- the page contract ------------------------------------------------------
//
// `window.__osg.publish(request)` is a facade over src/lib/publish, in the same
// spirit as the rest of src/lib/headless/bridge.ts: it adds no behaviour, it
// only routes. It is feature detected rather than version gated, so an older
// bundle fails with a sentence instead of a stack trace.
//
//   apps           -> listAppStoreApps
//   versions       -> listAppStoreVersions(appId)
//   localizations  -> listAppStoreLocalizations(versionId), each row also
//                     carrying `code` from localeForAppleLocale
//   languages      -> listPlayLanguages, each row carrying `code` from
//                     localeForPlayLanguage
//   stage          -> decode base64 to Uint8Array and hold as PublishImage
//   clear          -> drop everything staged
//   upload         -> uploadAppStoreScreenshotsForLocales, or
//                     uploadPlayScreenshotsForLanguages, over the staged images
//                     grouped by locale. With dryRun it groups and validates
//                     exactly as the real run would and returns the plan
//                     without touching the network.

interface AppStoreKey {
  issuerId: string;
  keyId: string;
  privateKey: string;
}

interface PlayKey {
  serviceAccountJson: string;
  packageName: string;
}

interface StagedImage {
  artboardId: string;
  fileName: string;
  /** PNG bytes. The bridge decodes; nothing on this side ever holds a Buffer. */
  base64: string;
  width: number;
  height: number;
  /** Null on a single language project. Matched strictly against the sets. */
  locale: string | null;
}

interface AppleSetRequest {
  locale: string | null;
  localizationId: string;
  /** Only for progress lines and warnings. Apple never sees it. */
  label: string;
}

interface PlayEntryRequest {
  locale: string | null;
  language: string;
  /** Omitted means the bridge splits by suggestPlayImageType, per image. */
  imageType?: string;
}

interface PublishRequest {
  store: StoreId;
  action: 'apps' | 'versions' | 'localizations' | 'languages' | 'stage' | 'clear' | 'upload';
  credentials: AppStoreKey | PlayKey | null;
  appId?: string;
  versionId?: string;
  images?: StagedImage[];
  sets?: AppleSetRequest[];
  entries?: PlayEntryRequest[];
  replaceExisting?: boolean;
  dryRun?: boolean;
}

interface PublishResponse<T> {
  ok: boolean;
  error?: string;
  /** auth is a bad key, rejected is a store rule. They exit differently. */
  kind?: 'auth' | 'rejected' | 'other';
  data?: T;
}

interface AppRow {
  id: string;
  name: string;
  bundleId: string;
}

interface VersionRow {
  id: string;
  versionString: string;
  state: string;
  editable: boolean;
  inReview: boolean;
}

interface LocalizationRow {
  id: string;
  locale: string;
  code: string | null;
}

interface PlayListingRow {
  language: string;
  title?: string;
  code: string | null;
}

interface PlanRow {
  label: string;
  target: string;
  count: number;
  files: string[];
}

interface UploadPlan {
  plan: PlanRow[];
  warnings: string[];
}

interface UploadOutcome {
  uploaded: number;
  warnings: string[];
  reviewUrl?: string;
}

type StoreId = 'appstore' | 'play';

/** The name node exposes into the page for the socket half of the shim. */
const FETCH_BINDING = '__osgStoreFetch';

export async function run(ctx: CommandContext): Promise<number> {
  if (ctx.offline) {
    throw usageError(
      'Uploading talks to a store, so it cannot run with --offline.',
      'Drop --offline. Everything before this step, including render and verify, still works without a network.'
    );
  }

  const store = resolveStore(ctx);
  const dryRun = flagBool(ctx.args.flags, 'dry-run', false);
  const replaceExisting = flagBool(ctx.args.flags, 'replace', false);
  const credentials = store === 'appstore' ? readAppStoreKey(ctx) : readPlayKey(ctx);
  // Said out loud on every run, because a user handing a publishing key to a
  // command line deserves to know where it goes. The global --help cannot carry
  // it, so the command does.
  info(
    dim('  The key is read from disk for this run only. It is not saved in the editor, the config, or the cache')
  );

  const session = await ctx.session();
  await requirePublishBridge(session);
  const releaseSockets = await useNodeSockets(session);

  try {
    // The store lookups come before the render on purpose: a wrong key should
    // cost three seconds, not the two minutes a full capture takes.
    const destination =
      store === 'appstore'
        ? await resolveAppleDestination(ctx, session, credentials as AppStoreKey)
        : await resolvePlayDestination(ctx, session, credentials as PlayKey);

    const captured = await captureSet(ctx, session, store, destination.locales);
    if (captured.length === 0) {
      throw usageError(
        'Nothing was captured, so there is nothing to upload.',
        'Check that the project has artboards: `osg call list_artboards`.'
      );
    }

    const request: PublishRequest =
      store === 'appstore'
        ? {
            store,
            action: 'upload',
            credentials,
            appId: (destination as AppleDestination).app.id,
            sets: (destination as AppleDestination).sets,
            replaceExisting,
            dryRun,
          }
        : {
            store,
            action: 'upload',
            credentials,
            entries: (destination as PlayDestination).entries,
            replaceExisting,
            dryRun,
          };

    step(dryRun ? 'planning the upload, with nothing sent' : `uploading ${captured.length} images`);
    const result = await publish<UploadPlan | UploadOutcome>(session, request);

    return report(ctx, {
      store,
      dryRun,
      replaceExisting,
      destination,
      captured,
      result,
    });
  } finally {
    // Both of these matter for the same reason: the page outlives this command
    // inside `osg all`, and neither the shim nor the staged bytes belong to it.
    await clearStage(session, store).catch(() => {});
    await releaseSockets().catch(() => {});
  }
}

// --- credentials ------------------------------------------------------------

/**
 * The `publish` block of osg.config.ts.
 *
 * Read off the loaded config rather than through OsgConfig, which does not
 * declare it yet: a config that has the block works today, and one that does
 * not is unaffected. Every value here is a path or an identifier. None of them
 * is a secret.
 */
interface PublishConfig {
  appstore?: {
    issuerId?: string;
    keyId?: string;
    /** Path to AuthKey_XXXXXXXXXX.p8, relative to the config. */
    keyFile?: string;
    appId?: string;
    bundleId?: string;
    version?: string;
  };
  play?: {
    /** Path to the service account JSON, relative to the config. */
    serviceAccountFile?: string;
    packageName?: string;
  };
}

function publishConfig(ctx: CommandContext): PublishConfig {
  return (ctx.config as { publish?: PublishConfig }).publish ?? {};
}

function resolveStore(ctx: CommandContext): StoreId {
  const raw = (flagString(ctx.args.flags, 'store') ?? ctx.config.store ?? 'appstore').toLowerCase();
  if (raw === 'appstore' || raw === 'ios' || raw === 'apple') return 'appstore';
  if (raw === 'play' || raw === 'playstore' || raw === 'android') return 'play';
  throw usageError(`Unknown store: ${raw}`, 'Use --store appstore or --store play');
}

function readAppStoreKey(ctx: CommandContext): AppStoreKey {
  const config = publishConfig(ctx).appstore ?? {};
  const keyPath = firstOf(
    flagString(ctx.args.flags, 'key'),
    process.env.OSG_APPSTORE_KEY_PATH,
    config.keyFile
  );
  if (!keyPath) {
    throw usageError('No App Store Connect key was named.', [
      'Pass --key ./AuthKey_ABC1234567.p8, set OSG_APPSTORE_KEY_PATH, or add publish.appstore.keyFile to osg.config.ts.',
      'The file is the .p8 you downloaded from Users and Access, Integrations. Keep it outside the repo.',
    ].join(' '));
  }

  const file = resolveSecretPath(ctx, keyPath, 'App Store Connect key');
  const privateKey = fs.readFileSync(file, 'utf8');
  if (!privateKey.includes('BEGIN PRIVATE KEY')) {
    throw usageError(
      `${file} is not a PKCS#8 private key.`,
      'App Store Connect gives you AuthKey_XXXXXXXXXX.p8, which starts with BEGIN PRIVATE KEY.'
    );
  }

  const issuerId = firstOf(flagString(ctx.args.flags, 'issuer'), process.env.OSG_APPSTORE_ISSUER_ID, config.issuerId);
  if (!issuerId) {
    throw usageError('No App Store Connect issuer id.', [
      'Pass --issuer, set OSG_APPSTORE_ISSUER_ID, or add publish.appstore.issuerId to osg.config.ts.',
      'It is the UUID at the top of the Integrations page. It is not a secret.',
    ].join(' '));
  }

  // AuthKey_ABC1234567.p8 carries the key id in its name, which is what
  // everybody has on disk, so infer it rather than making them retype it.
  const inferred = /AuthKey_([A-Z0-9]{10})\.p8$/i.exec(path.basename(file))?.[1];
  const keyId = firstOf(flagString(ctx.args.flags, 'key-id'), process.env.OSG_APPSTORE_KEY_ID, config.keyId, inferred);
  if (!keyId) {
    throw usageError(
      'No App Store Connect key id.',
      'Pass --key-id, set OSG_APPSTORE_KEY_ID, or rename the file back to AuthKey_<keyid>.p8 so it can be read from the name.'
    );
  }

  return { issuerId: issuerId.trim(), keyId: keyId.trim(), privateKey };
}

function readPlayKey(ctx: CommandContext): PlayKey {
  const config = publishConfig(ctx).play ?? {};
  const keyPath = firstOf(
    flagString(ctx.args.flags, 'service-account'),
    process.env.OSG_PLAY_SERVICE_ACCOUNT,
    config.serviceAccountFile
  );
  if (!keyPath) {
    throw usageError('No Play service account key was named.', [
      'Pass --service-account ./play-key.json, set OSG_PLAY_SERVICE_ACCOUNT, or add publish.play.serviceAccountFile.',
      'It is the JSON key of a service account you invited into the Play Console under Users and permissions.',
    ].join(' '));
  }

  const file = resolveSecretPath(ctx, keyPath, 'Play service account key');
  const serviceAccountJson = fs.readFileSync(file, 'utf8');
  try {
    const parsed = JSON.parse(serviceAccountJson) as { client_email?: string; private_key?: string };
    if (!parsed.client_email || !parsed.private_key) throw new Error('no client_email or private_key');
  } catch (error) {
    throw usageError(
      `${file} is not a service account key: ${(error as Error).message}.`,
      'Use the JSON downloaded for the service account, not the OAuth client file.'
    );
  }

  const packageName = firstOf(
    flagString(ctx.args.flags, 'package'),
    process.env.OSG_PLAY_PACKAGE,
    config.packageName
  );
  if (!packageName) {
    throw usageError(
      'No Play package name.',
      'Pass --package com.example.app, set OSG_PLAY_PACKAGE, or add publish.play.packageName to osg.config.ts.'
    );
  }

  return { serviceAccountJson, packageName: packageName.trim() };
}

/** Resolve, check it exists, and complain if it is somewhere a commit will find it. */
function resolveSecretPath(ctx: CommandContext, value: string, what: string): string {
  const file = path.isAbsolute(value) ? value : path.resolve(ctx.root, value);
  if (!fs.existsSync(file)) {
    throw usageError(`${what} not found: ${file}`, 'Name it by path, and keep the file itself out of the repository.');
  }
  const relative = path.relative(ctx.root, file);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    warn(`The ${what} is inside the project at ${relative}`);
    info(dim('  Move it out, or add it to .gitignore. A key in a repository is a key in every clone of it'));
  }
  return file;
}

function firstOf(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

// --- destinations -----------------------------------------------------------

interface AppleDestination {
  kind: 'appstore';
  app: AppRow;
  version: VersionRow;
  sets: AppleSetRequest[];
  locales: (string | null)[];
}

interface PlayDestination {
  kind: 'play';
  packageName: string;
  entries: PlayEntryRequest[];
  locales: (string | null)[];
}

type Destination = AppleDestination | PlayDestination;

async function resolveAppleDestination(
  ctx: CommandContext,
  session: Session,
  credentials: AppStoreKey
): Promise<AppleDestination> {
  const config = publishConfig(ctx).appstore ?? {};
  step('App Store Connect: reading your apps');
  const apps = await publish<AppRow[]>(session, { store: 'appstore', action: 'apps', credentials });

  const wanted = firstOf(flagString(ctx.args.flags, 'app'), config.appId, config.bundleId);
  const app = pickApp(apps, wanted);
  step(`app: ${app.name} (${app.bundleId})`);

  const versions = await publish<VersionRow[]>(session, {
    store: 'appstore',
    action: 'versions',
    credentials,
    appId: app.id,
  });
  const version = pickVersion(versions, firstOf(flagString(ctx.args.flags, 'version'), config.version));
  step(`version: ${version.versionString} (${version.state})`);

  const rows = await publish<LocalizationRow[]>(session, {
    store: 'appstore',
    action: 'localizations',
    credentials,
    versionId: version.id,
  });

  const wantedLocales = resolveLocales(ctx, await projectLocales(session));
  const sets: AppleSetRequest[] = [];
  const used: (string | null)[] = [];
  for (const locale of wantedLocales) {
    const row = matchLocale(rows, locale, (entry) => entry.code, (entry) => entry.locale);
    if (!row) {
      warn(`${locale ?? 'the project'} has no localization on this version, so it was skipped`);
      continue;
    }
    sets.push({ locale, localizationId: row.id, label: row.locale });
    used.push(locale);
  }
  if (sets.length === 0) {
    throw usageError(
      'None of these languages exist on that App Store version.',
      `The version has: ${rows.map((row) => row.locale).join(', ') || 'no localizations at all'}. Add them in App Store Connect first.`
    );
  }

  return { kind: 'appstore', app, version, sets, locales: used };
}

async function resolvePlayDestination(
  ctx: CommandContext,
  session: Session,
  credentials: PlayKey
): Promise<PlayDestination> {
  step(`Google Play: reading the listing for ${credentials.packageName}`);
  const listings = await publish<PlayListingRow[]>(session, { store: 'play', action: 'languages', credentials });

  const imageType = flagString(ctx.args.flags, 'image-type');
  const wantedLocales = resolveLocales(ctx, await projectLocales(session));
  const entries: PlayEntryRequest[] = [];
  const used: (string | null)[] = [];
  for (const locale of wantedLocales) {
    const row = matchLocale(listings, locale, (entry) => entry.code, (entry) => entry.language);
    if (!row) {
      // Play creates a listing only when you write one, and writing a language
      // the developer never set up is a decision this command does not get to
      // make on their behalf.
      warn(`${locale ?? 'the project'} has no Play listing, so it was skipped`);
      continue;
    }
    entries.push({ locale, language: row.language, ...(imageType ? { imageType } : {}) });
    used.push(locale);
  }
  if (entries.length === 0) {
    throw usageError(
      'None of these languages exist on that Play listing.',
      `The listing has: ${listings.map((row) => row.language).join(', ') || 'no languages at all'}. Add them in the Play Console first.`
    );
  }

  return { kind: 'play', packageName: credentials.packageName, entries, locales: used };
}

function pickApp(apps: AppRow[], wanted: string | undefined): AppRow {
  if (apps.length === 0) {
    throw usageError(
      'That key can see no apps.',
      'App Store Connect keys are scoped by role. An App Manager or Admin key sees the apps you can edit.'
    );
  }
  if (wanted) {
    const found = apps.find((app) => app.id === wanted || app.bundleId === wanted || app.name === wanted);
    if (!found) {
      throw usageError(
        `No app matched ${wanted}.`,
        `This key can see: ${apps.map((app) => app.bundleId || app.name).join(', ')}`
      );
    }
    return found;
  }
  if (apps.length === 1) return apps[0];
  throw usageError('That key can see more than one app, so name the one you mean.', [
    `--app ${apps[0].bundleId || apps[0].id}, or publish.appstore.bundleId in osg.config.ts.`,
    `Choices: ${apps.map((app) => app.bundleId || app.name).join(', ')}`,
  ].join(' '));
}

function pickVersion(versions: VersionRow[], wanted: string | undefined): VersionRow {
  if (wanted) {
    const found = versions.find((version) => version.versionString === wanted || version.id === wanted);
    if (!found) {
      throw usageError(
        `No version ${wanted} on that app.`,
        `It has: ${versions.map((version) => `${version.versionString} (${version.state})`).join(', ')}`
      );
    }
    if (!found.editable) throw frozenVersion(found);
    return found;
  }
  const editable = versions.find((version) => version.editable);
  if (editable) return editable;
  const frozen = versions.find((version) => version.inReview);
  if (frozen) throw frozenVersion(frozen);
  throw usageError(
    'That app has no version whose screenshots can be edited.',
    'Create the next version in App Store Connect, then run this again.'
  );
}

function frozenVersion(version: VersionRow): OsgError {
  return usageError(
    `Version ${version.versionString} is ${version.state}, and Apple freezes screenshots once a version is submitted.`,
    'Remove it from review, or create the next version, then run this again.'
  );
}

/** Match a store row to a project locale, by our code first and the store's second. */
function matchLocale<T>(
  rows: T[],
  locale: string | null,
  ourCode: (row: T) => string | null,
  storeCode: (row: T) => string
): T | undefined {
  if (locale) {
    const lower = locale.toLowerCase();
    return (
      rows.find((row) => ourCode(row)?.toLowerCase() === lower) ??
      rows.find((row) => storeCode(row).toLowerCase() === lower) ??
      // 'de' should still find 'de-DE' when the table has no opinion.
      rows.find((row) => storeCode(row).toLowerCase().startsWith(`${lower}-`))
    );
  }
  // A single language project: prefer the store's usual default, then settle
  // for the only one there is.
  return (
    rows.find((row) => /^en[-_]?US$/i.test(storeCode(row))) ??
    rows.find((row) => /^en/i.test(storeCode(row))) ??
    (rows.length === 1 ? rows[0] : undefined)
  );
}

async function projectLocales(session: Session): Promise<string[]> {
  const status = await session.status();
  return status.locales ?? [];
}

function resolveLocales(ctx: CommandContext, projectLocaleCodes: string[]): (string | null)[] {
  const requested = flagList(ctx.args.flags, 'locales') ?? ctx.config.locales;
  if (projectLocaleCodes.length === 0) return [null];
  if (!requested || requested.includes('all')) return projectLocaleCodes;
  const unknown = requested.filter((code) => !projectLocaleCodes.includes(code));
  if (unknown.length) {
    throw usageError(
      `The project has no language ${unknown.join(', ')}.`,
      `It has: ${projectLocaleCodes.join(', ')}. Add one with \`osg localize --add ${unknown[0]}\`.`
    );
  }
  return requested;
}

// --- capture ----------------------------------------------------------------

async function captureSet(
  ctx: CommandContext,
  session: Session,
  store: StoreId,
  locales: (string | null)[]
): Promise<StagedImage[]> {
  const status = await session.status();
  const requested = flagList(ctx.args.flags, 'artboards');
  const artboardIds = requested ?? status.artboards.map((artboard) => artboard.id);
  if (artboardIds.length === 0) return [];

  const formats = (flagList(ctx.args.flags, 'formats') ?? ctx.config.formats ?? []).map((id) =>
    id === 'as-is' || id === 'asis' ? null : id
  );
  // No format at all means "whatever size the boards already are", which is the
  // right default for a project built from a store-sized template.
  const formatList: (string | null)[] = formats.length ? formats : [null];

  const expected = artboardIds.length * formatList.length * locales.length;
  step(`rendering ${expected} images from ${artboardIds.length} boards`);

  const staged: StagedImage[] = [];
  for (const locale of locales) {
    for (const formatId of formatList) {
      const images = await session.capture(artboardIds, formatId, locale);
      for (const image of images) {
        const entry: StagedImage = {
          artboardId: image.artboardId,
          fileName: image.fileName,
          base64: image.base64,
          width: image.width,
          height: image.height,
          locale,
        };
        // One call per image: the bytes are megabytes each, and a single call
        // carrying the whole set would be one enormous protocol message.
        await publish<null>(session, {
          store,
          action: 'stage',
          credentials: null,
          images: [entry],
        });
        staged.push(entry);
        if (staged.length % 5 === 0 || staged.length === expected) {
          info(dim(`  captured ${staged.length} of ${expected}`));
        }
      }
    }
  }
  return staged;
}

async function clearStage(session: Session, store: StoreId): Promise<void> {
  await publish<null>(session, { store, action: 'clear', credentials: null });
}

// --- the page -------------------------------------------------------------

async function requirePublishBridge(session: Session): Promise<void> {
  const present = await session.evaluate<boolean>(
    `typeof window.__osg === 'object' && typeof window.__osg.publish === 'function'`
  );
  if (present) return;
  throw driverError(
    'This editor build cannot upload: its headless bridge has no publish method.',
    'Upgrade with `npm i -g open-screenshot-generator@latest`, or drop --editor-url so the CLI drives the bundled editor.'
  );
}

async function publish<T>(session: Session, request: PublishRequest): Promise<T> {
  const response = await session.evaluate<PublishResponse<T>>(
    `window.__osg.publish(${jsLiteral(request)})`
  );
  if (!response || typeof response !== 'object') {
    throw driverError('The editor returned nothing from publish.', 'Re-run with --verbose to see the page console.');
  }
  if (!response.ok) throw storeFailure(request, response);
  return response.data as T;
}

/**
 * A store failure, mapped onto the exit codes the rest of the CLI promises.
 * A rejected image is exit 3 for the same reason `osg verify` is: the files
 * exist and a store rule says no.
 */
function storeFailure(request: PublishRequest, response: PublishResponse<unknown>): OsgError {
  const message = response.error || 'the store refused the request';
  if (response.kind === 'auth') {
    return new OsgError(message, {
      code: EXIT.usage,
      fix:
        request.store === 'appstore'
          ? 'Check the issuer id, the key id and the .p8. An expired or revoked key fails exactly like this.'
          : 'Invite the service account into the Play Console under Users and permissions, and give it access to this app.',
      detail: { store: request.store, action: request.action },
    });
  }
  if (response.kind === 'rejected') {
    return new OsgError(message, {
      code: EXIT.verify,
      fix: 'Run `osg verify` to see which files break the rule, fix the sizes, then upload again.',
      detail: { store: request.store, action: request.action },
    });
  }
  return driverError(message, 'Re-run with --verbose to see the page console.', {
    store: request.store,
    action: request.action,
  });
}

interface FetchReply {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyBase64: string;
}

/**
 * Lend the page node's socket for the length of the run.
 *
 * The store hosts send no CORS headers, so a request the page makes itself is
 * refused before it leaves. Node has no such rule, and this is the same trick
 * the desktop build plays with tauri-plugin-http, so the app's own code keeps
 * making every decision about what to send and what a response means.
 *
 * Same-origin traffic and the font hosts are left alone: those are the editor
 * loading itself, and they already have a cache in browser/launch.ts.
 */
async function useNodeSockets(session: Session): Promise<() => Promise<void>> {
  const bridge = async (rawUrl: unknown, rawInit: unknown): Promise<FetchReply> => {
    const url = String(rawUrl);
    const init = (rawInit ?? {}) as { method?: string; headers?: Record<string, string>; bodyBase64?: string | null };
    const method = init.method ?? 'GET';
    debug(`store ${method} ${safeUrl(url)}`);
    const response = await fetch(url, {
      method,
      headers: init.headers,
      body: init.bodyBase64 ? Buffer.from(init.bodyBase64, 'base64') : undefined,
      redirect: 'follow',
    });
    const body = Buffer.from(await response.arrayBuffer());
    debug(`store ${response.status} ${safeUrl(url)} (${humanBytes(body.length)})`);
    // forEach rather than fromEntries: the DOM Headers type this package
    // compiles against declares no iterator, and undici's does not either.
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return {
      status: response.status,
      statusText: response.statusText,
      headers,
      bodyBase64: body.toString('base64'),
    };
  };

  try {
    await session.page.exposeFunction(FETCH_BINDING, bridge);
  } catch (error) {
    // Already bound by an earlier upload in this process, which is the same
    // function; `osg all` can reach here twice.
    debug(`${FETCH_BINDING}: ${(error as Error).message}`);
  }

  await session.evaluate(`(() => {
    if (window.__osgRestoreFetch) return;
    const original = window.fetch.bind(window);
    const leaveAlone = ['fonts.googleapis.com', 'fonts.gstatic.com'];
    const encode = (bytes) => {
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      return btoa(binary);
    };
    const decode = (base64) => {
      const binary = atob(base64);
      const out = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
      return out;
    };
    window.fetch = async (input, init) => {
      const request = input instanceof Request && !init ? input : new Request(input, init);
      let target = null;
      try { target = new URL(request.url); } catch (error) { target = null; }
      if (!target || target.origin === location.origin || leaveAlone.indexOf(target.host) !== -1) {
        return original(input, init);
      }
      const buffer = await request.arrayBuffer();
      const headers = {};
      request.headers.forEach((value, key) => { headers[key] = value; });
      const reply = await window.${FETCH_BINDING}(request.url, {
        method: request.method,
        headers: headers,
        bodyBase64: buffer.byteLength ? encode(new Uint8Array(buffer)) : null,
      });
      const bodyless = reply.status === 204 || reply.status === 205 || reply.status === 304;
      return new Response(bodyless ? null : decode(reply.bodyBase64), {
        status: reply.status,
        statusText: reply.statusText || '',
        headers: reply.headers,
      });
    };
    window.__osgRestoreFetch = () => {
      window.fetch = original;
      delete window.__osgRestoreFetch;
    };
  })()`);

  return async () => {
    await session.evaluate(`(() => { if (window.__osgRestoreFetch) window.__osgRestoreFetch(); })()`);
  };
}

/** A URL without its query, because signed upload URLs carry credentials in it. */
function safeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return 'an unparseable url';
  }
}

/**
 * A value as a JavaScript literal inside an evaluated expression.
 *
 * session.evaluate takes an expression string and puppeteer ignores the extra
 * arguments when the page function is a string, so the data has to be embedded.
 * U+2028 and U+2029 are valid in JSON and are line terminators in JavaScript,
 * which turns a stray character in a filename into a syntax error.
 */
function jsLiteral(value: unknown): string {
  return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

// --- reporting --------------------------------------------------------------

interface ReportInput {
  store: StoreId;
  dryRun: boolean;
  replaceExisting: boolean;
  destination: Destination;
  captured: StagedImage[];
  result: UploadPlan | UploadOutcome;
}

function report(ctx: CommandContext, input: ReportInput): number {
  const { destination, result } = input;
  const plan = 'plan' in result ? result.plan : [];
  const uploaded = 'uploaded' in result ? result.uploaded : 0;
  const warnings = result.warnings ?? [];
  const reviewUrl = 'reviewUrl' in result ? result.reviewUrl : undefined;
  const bytes = input.captured.reduce((sum, image) => sum + byteLength(image.base64), 0);

  if (ctx.json) {
    emit({
      ok: true,
      store: input.store,
      dryRun: input.dryRun,
      replace: input.replaceExisting,
      target:
        destination.kind === 'appstore'
          ? {
              app: destination.app,
              version: { id: destination.version.id, versionString: destination.version.versionString },
              localizations: destination.sets.map((set) => ({ locale: set.locale, storeLocale: set.label })),
            }
          : {
              packageName: destination.packageName,
              languages: destination.entries.map((entry) => ({ locale: entry.locale, language: entry.language })),
            },
      images: input.captured.map((image) => ({
        artboardId: image.artboardId,
        fileName: image.fileName,
        width: image.width,
        height: image.height,
        bytes: byteLength(image.base64),
        locale: image.locale,
      })),
      plan,
      uploaded,
      warnings,
      reviewUrl,
    });
    return warnings.length && uploaded === 0 && !input.dryRun ? EXIT.driver : EXIT.ok;
  }

  info('');
  if (destination.kind === 'appstore') {
    info(`  ${bold(destination.app.name)} ${dim(destination.app.bundleId)}`);
    info(`  version ${destination.version.versionString} ${dim(destination.version.state)}`);
    info(`  languages ${destination.sets.map((set) => set.label).join(', ')}`);
  } else {
    info(`  ${bold(destination.packageName)}`);
    info(`  languages ${destination.entries.map((entry) => entry.language).join(', ')}`);
  }
  info(`  ${input.captured.length} images, ${humanBytes(bytes)}${input.replaceExisting ? ', replacing what is there' : ''}\n`);

  for (const row of plan) {
    info(`  ${row.label.padEnd(12)} ${dim(row.target)}  ${row.count} images`);
    for (const file of row.files.slice(0, 3)) info(dim(`      ${file}`));
    if (row.files.length > 3) info(dim(`      and ${row.files.length - 3} more`));
  }

  // Everything the store said no to, verbatim. Apple in particular only reports
  // a bad size minutes later through the delivery poll, so these lines are
  // usually the only place that failure is ever visible.
  for (const line of warnings) warn(line);

  if (input.dryRun) {
    info(`\n  ${dim('Nothing was sent. Drop --dry-run to upload')}\n`);
    return EXIT.ok;
  }

  ok(`${uploaded} images uploaded`);
  if (reviewUrl) info(`  ${cyan(reviewUrl)}`);
  info('');
  // Uploading nothing at all is a failed run, even though every call returned.
  return uploaded === 0 ? EXIT.driver : EXIT.ok;
}

function byteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

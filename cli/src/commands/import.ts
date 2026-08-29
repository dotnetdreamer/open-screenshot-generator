/**
 * osg import: the screenshots your app already ships with.
 *
 * The competitor's flow starts at a simulator, which means a Mac, an Xcode
 * install and a build that runs. Most people asking for better store
 * screenshots already shipped once: their current set is sitting on their
 * listing at full resolution, and Apple serves it with an open CORS header and
 * no key. So this command takes a store link or an app name and puts the real
 * screenshots and the real icon on disk, ready for `osg fill` or `osg new`.
 *
 * Everything here is node-pure. src/lib/intake/appStoreLookup.ts is written
 * against fetch and nothing else, which is why the same module serves the
 * browser flow and this one:
 *
 *   parseStoreLink        what did the user paste
 *   resolveStoreInput     link or name to listings, with a reason when neither
 *   upscaleArtworkUrl     the payload's 392px thumbnails are unusable
 *   downloadListingImages the bytes, dropping one dead URL rather than all
 *
 * Google Play publishes no equivalent endpoint and sends no CORS header, so a
 * Play link resolves to nothing. That is said out loud rather than guessed
 * around: importing "the App Store app with a similar name" would silently put
 * somebody else's screenshots in your project.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  downloadListingImages,
  parseStoreLink,
  resolveStoreInput,
  upscaleArtworkUrl,
  type AppListing,
} from '@/lib/intake/appStoreLookup';
import { flagBool, flagNumber, flagString } from '../args.js';
import type { CommandContext } from '../context.js';
import { EXIT, driverError, usageError } from '../errors.js';
import { emit, humanBytes, info, ok, step, warn } from '../log.js';

/** Where the screenshots land when nothing says otherwise. */
const DEFAULT_DESTINATION = 'osg/screenshots';

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'app';

async function writeFiles(files: File[], dir: string, rename?: (index: number, extension: string) => string): Promise<{ name: string; bytes: number }[]> {
  const written: { name: string; bytes: number }[] = [];
  for (const [index, file] of files.entries()) {
    const extension = path.extname(file.name) || '.png';
    const name = rename ? rename(index, extension) : file.name;
    const target = path.join(dir, name);
    fs.writeFileSync(target, Buffer.from(await file.arrayBuffer()));
    written.push({ name, bytes: fs.statSync(target).size });
  }
  return written;
}

function describeInput(input: string): string {
  const parsed = parseStoreLink(input);
  if (!parsed) return 'nothing to look up';
  if (parsed.kind === 'apple') return `App Store id ${parsed.id} in ${parsed.country.toUpperCase()}`;
  if (parsed.kind === 'play') return `Play package ${parsed.packageName}`;
  return `a search for "${parsed.term}"`;
}

export async function run(ctx: CommandContext): Promise<number> {
  const { flags } = ctx.args;
  const input = (ctx.args.positionals.join(' ').trim() || flagString(flags, 'app') || '').trim();
  if (!input) {
    throw usageError(
      'osg import needs an app',
      'Paste a store link (`osg import https://apps.apple.com/us/app/things/id904237743`), an App Store id, or just the name (`osg import things 3`).'
    );
  }
  if (ctx.offline) {
    throw usageError('osg import reads the App Store, so it cannot run with --offline', 'Drop --offline for this one command.');
  }
  // downloadListingImages builds File objects, which are global from Node 20.
  // Without the guard a missing global would look like eight dead URLs.
  if (typeof File === 'undefined') {
    throw usageError('This Node build has no global File.', 'Upgrade to Node 20.12 or newer.');
  }

  const destination = path.resolve(ctx.root, flagString(flags, 'out') ?? ctx.config.screenshots ?? DEFAULT_DESTINATION);
  const country = flagString(flags, 'country') ?? 'us';
  // Seconds, like every other --timeout in this CLI. The whole import shares
  // one budget: a store that is answering slowly will answer slowly nine times.
  const timeout = (flagNumber(flags, 'timeout') ?? 120) * 1000;
  const signal = AbortSignal.timeout(timeout);

  step(`looking up ${describeInput(input)}`);

  let listings: AppListing[];
  let notice: string | null;
  try {
    ({ listings, notice } = await resolveStoreInput(input, { country, signal }));
  } catch (error) {
    throw driverError(
      `The App Store lookup failed: ${(error as Error).message}`,
      'Check the network, or try again in a moment. The endpoint rate limits by IP.'
    );
  }

  if (listings.length === 0) {
    throw usageError(
      notice ?? `Nothing on the App Store matched "${input}"`,
      'Try the exact app name, or paste the store link from the listing itself.'
    );
  }

  const pick = Math.max(1, flagNumber(flags, 'pick') ?? 1) - 1;
  const listing = listings[pick] ?? listings[0];
  if (listings.length > 1) {
    info(`${listings.length} apps matched, taking ${listing.name} by ${listing.developer}`);
    for (const [index, other] of listings.slice(0, 5).entries()) {
      if (other.id === listing.id) continue;
      info(`   --pick ${index + 1}  ${other.name} by ${other.developer} (id ${other.id})`);
    }
  }

  const tablet = flagBool(flags, 'tablet', false);
  let usedTablet = tablet;
  let urls = tablet ? listing.tabletScreenshotUrls : listing.screenshotUrls;
  if (urls.length === 0 && !tablet && listing.tabletScreenshotUrls.length > 0) {
    warn('this listing has no iPhone screenshots, taking the iPad set instead');
    urls = listing.tabletScreenshotUrls;
    usedTablet = true;
  }
  const limit = flagNumber(flags, 'limit');
  if (limit !== undefined && limit > 0) urls = urls.slice(0, limit);

  if (urls.length === 0) {
    throw usageError(
      `${listing.name} has no ${tablet ? 'iPad' : 'iPhone'} screenshots on its listing`,
      tablet ? 'Drop --tablet to take the phone set.' : 'Try --tablet, or point --screenshots at captures of your own.'
    );
  }

  const before = fs.existsSync(destination)
    ? fs.readdirSync(destination).filter((name) => /\.(png|jpe?g|webp)$/i.test(name))
    : [];
  fs.mkdirSync(destination, { recursive: true });
  const prefix = slugify(listing.name);

  step(`downloading ${urls.length} screenshots from ${listing.name}`);
  const files = await downloadListingImages(urls, { signal, namePrefix: prefix });
  if (files.length === 0) {
    throw driverError(
      'Every image on that listing failed to download.',
      'The CDN may be mid-deploy, or the network is blocking it. Retry, or save the images by hand into --out.'
    );
  }
  if (files.length < urls.length) warn(`${urls.length - files.length} images did not download`);
  const written = await writeFiles(files, destination);

  // The listing hands out a 512px icon; the store's own source art is 1024, and
  // asking the CDN for a size it does not have simply returns what it does.
  let icon: { name: string; bytes: number } | null = null;
  if (listing.iconUrl) {
    const iconFiles = await downloadListingImages([upscaleArtworkUrl(listing.iconUrl, 1024)], { signal, namePrefix: 'icon' });
    const savedIcon = await writeFiles(iconFiles, destination, (_index, extension) => `${prefix}-icon${extension}`);
    icon = savedIcon[0] ?? null;
    if (!icon) warn('the icon did not download');
  }

  // Every later command treats a folder of images as one set, so an older
  // import left beside this one becomes a project holding two apps.
  const fresh = new Set([...written.map((entry) => entry.name), ...(icon ? [icon.name] : [])]);
  const leftovers = before.filter((name) => !fresh.has(name));
  if (leftovers.length > 0) {
    warn(`${leftovers.length} other ${leftovers.length === 1 ? 'image was' : 'images were'} already in that folder. \`osg fill\` reads all of them, so delete them or import into --out <dir>`);
  }

  // A sidecar rather than a config edit: the name, the category and the
  // description are what `osg fill --name`, `osg design` and the manifest all
  // want next, and none of them should have to hit the network again for it.
  const record = {
    source: 'appstore',
    importedAt: new Date().toISOString(),
    country,
    id: listing.id,
    name: listing.name,
    developer: listing.developer,
    category: listing.category,
    storeUrl: listing.storeUrl,
    description: listing.description,
    icon: icon ? icon.name : null,
    screenshots: written.map((entry) => entry.name),
    tablet: usedTablet,
  };
  const recordFile = path.join(destination, 'listing.json');
  fs.writeFileSync(recordFile, `${JSON.stringify(record, null, 2)}\n`);

  const bytes = written.reduce((total, entry) => total + entry.bytes, 0) + (icon?.bytes ?? 0);

  if (ctx.json) {
    emit({
      command: 'import',
      directory: destination,
      listingFile: recordFile,
      bytes,
      listing: record,
      matches: listings.map((entry) => ({ id: entry.id, name: entry.name, developer: entry.developer })),
    });
    return EXIT.ok;
  }

  ok(`${listing.name} by ${listing.developer}, ${written.length} screenshots${icon ? ' and the icon' : ''} (${humanBytes(bytes)})`);
  info(`   ${destination}`);
  info(`   ${listing.storeUrl}`);
  info('');
  info('Store artwork belongs to whoever published it. Import your own app');
  info(`Next: \`osg fill --screenshots ${path.relative(ctx.root, destination).split(path.sep).join('/')} --name "${listing.name}"\``);
  return EXIT.ok;
}

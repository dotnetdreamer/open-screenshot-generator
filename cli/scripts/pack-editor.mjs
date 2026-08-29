// Assembles the shippable editor tier: cli/editor/ plus cli/assets.manifest.json.
//
// The CLI never contains a second renderer. It drives the real editor bundle,
// so what an agent renders from a terminal is what a person renders in the app.
// That bundle is what gets copied here: the Next shell, the 101 template JSONs
// and the AI catalog. Canvas, all 49 design tools, PNG and MP4 export, the 57
// languages and the AI agent all run at that tier, and it is a few megabytes.
//
// The artwork is deliberately NOT copied.
//
// Two reasons, and the first one is not negotiable. public/elements/images is
// Adobe Stock, held under a standard licence by this project. That licence
// covers using the files inside the product; it does not permit redistributing
// them on a standalone basis, and an npm tarball is exactly that: a bag of
// image files anyone can extract and reuse without ever running the program.
// Hydrating a file at run time from the project's own deployment is a different
// act, and the same one a browser performs when somebody visits the site. The
// second reason is merely practical: the artwork is around thirty times the
// size of the program, and most runs touch a handful of it.
//
// So every file that stays behind gets an entry in assets.manifest.json with
// its request path, byte length and sha256. The local server (src/editor/
// server.ts) checks disk first, and on a miss fetches the path from
// assetsBaseUrl, verifies the digest and writes it into a machine-wide
// content-addressed cache, so any given file is downloaded once per machine
// across every version of the CLI. See cli/src/editor/assets.ts and
// THIRD-PARTY-ASSETS.md.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(cliRoot, '..');
const outDir = path.join(repo, 'out');
const editorDir = path.join(cliRoot, 'editor');

const pkg = JSON.parse(fs.readFileSync(path.join(cliRoot, 'package.json'), 'utf8'));

// The shell. index.html is the whole app (a static export with one route);
// 404.html is what the local server would otherwise have no answer for.
const REQUIRED_FILES = ['index.html', '404.html'];
// Icons: the page requests these on load, and a missing one is a console error
// in every screenshot run, so they travel with the shell rather than hydrating.
const ICON_FILES = ['favicon.ico', 'icon.svg', 'logo.svg', 'apple-icon.png', 'apple-touch-icon.png'];

const sha256 = (body) => crypto.createHash('sha256').update(body).digest('hex');

/** Root absolute request path for a file under out/, as the page asks for it. */
const requestPathOf = (file) => `/${path.relative(outDir, file).split(path.sep).join('/')}`;

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function copyFile(relative) {
  const source = path.join(outDir, relative);
  const target = path.join(editorDir, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  return fs.statSync(target).size;
}

/**
 * Which tier a left-behind file belongs to, so `osg cache warm --tier` can pull
 * only what a run needs. 'templates' is the catch-all: a render always wants the
 * screenshot art a template paints, and anything unclassified is small.
 */
function tierOf(requestPath) {
  if (requestPath.startsWith('/elements/device-3d/')) return 'device3d';
  if (requestPath.startsWith('/elements/images/')) return 'images';
  if (requestPath.startsWith('/data/projects/previews/')) return 'previews';
  return 'templates';
}

function fail(message, fix) {
  console.error(`pack-editor failed: ${message}`);
  if (fix) console.error(`  fix: ${fix}`);
  process.exitCode = 1;
}

if (!fs.existsSync(outDir) || !fs.existsSync(path.join(outDir, 'index.html'))) {
  fail(
    `No static export at ${path.relative(repo, outDir).replace(/\\/g, '/')}`,
    'Run `npm run build` in the repository root first, it writes out/.'
  );
} else {
  // Start clean, so a file removed from out/ cannot linger in a published
  // tarball and shadow a hydrated one at run time.
  fs.rmSync(editorDir, { recursive: true, force: true });
  fs.mkdirSync(editorDir, { recursive: true });

  const copied = new Set();
  let packedBytes = 0;

  const take = (relative) => {
    packedBytes += copyFile(relative);
    copied.add(path.join(outDir, relative));
  };

  let missingRequired = null;
  for (const name of REQUIRED_FILES) {
    if (!fs.existsSync(path.join(outDir, name))) {
      missingRequired = name;
      break;
    }
    take(name);
  }

  if (missingRequired) {
    fail(
      `out/${missingRequired} is missing, the export is incomplete`,
      'Run `npm run build` in the repository root again.'
    );
  } else {
    for (const name of ICON_FILES) {
      if (fs.existsSync(path.join(outDir, name))) take(name);
    }

    for (const file of walk(path.join(outDir, '_next'))) {
      take(path.relative(outDir, file));
    }

    // Only the template JSONs at the top level. data/projects also holds the
    // screenshot art and the preview thumbnails, which are tens of megabytes
    // and hydrate on demand.
    const projectsDir = path.join(outDir, 'data/projects');
    const templates = fs
      .readdirSync(projectsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name)
      .sort();
    for (const name of templates) take(path.join('data/projects', name));

    // The AI agent's URL mode points providers at this file, and it is the same
    // catalog the client rebuilds to check the verification token, so it has to
    // be the packaged one rather than whatever the deployment is serving today.
    const catalog = path.join('data', 'ai', 'catalog.txt');
    if (fs.existsSync(path.join(outDir, catalog))) take(catalog);

    const entries = {};
    const tiers = {};
    let manifestBytes = 0;

    // Sorted, so an unchanged out/ produces a byte identical manifest.
    for (const file of walk(outDir).sort()) {
      if (copied.has(file)) continue;
      const body = fs.readFileSync(file);
      const requestPath = requestPathOf(file);
      entries[requestPath] = { path: requestPath, bytes: body.length, sha256: sha256(body) };
      manifestBytes += body.length;
      const tier = tierOf(requestPath);
      (tiers[tier] ??= []).push(requestPath);
    }

    fs.writeFileSync(
      path.join(cliRoot, 'assets.manifest.json'),
      `${JSON.stringify({ version: pkg.version, tiers, entries }, null, 2)}\n`
    );

    const mb = (bytes) => `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    const byTier = Object.entries(tiers)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([tier, paths]) => `${tier} ${paths.length}`)
      .join(', ');

    // The five agent skills and the asset provenance record live at the repo
    // root, because that is where `npx skills add` and the Claude Code plugin
    // loader look for them. npm's `files` list is relative to this directory,
    // so without this copy `npm i -g open-screenshot-generator` would install a
    // CLI with no skills and no licence record, silently.
    const copyTree = (from, to) => {
      let count = 0;
      let bytes = 0;
      for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const source = path.join(from, entry.name);
        const target = path.join(to, entry.name);
        if (entry.isDirectory()) {
          fs.mkdirSync(target, { recursive: true });
          const inner = copyTree(source, target);
          count += inner.count;
          bytes += inner.bytes;
        } else {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.copyFileSync(source, target);
          count += 1;
          bytes += fs.statSync(target).size;
        }
      }
      return { count, bytes };
    };

    const skillsSource = path.join(repo, 'skills');
    const skillsTarget = path.join(cliRoot, 'skills');
    fs.rmSync(skillsTarget, { recursive: true, force: true });
    fs.mkdirSync(skillsTarget, { recursive: true });
    const skills = copyTree(skillsSource, skillsTarget);
    fs.copyFileSync(path.join(repo, 'THIRD-PARTY-ASSETS.md'), path.join(cliRoot, 'THIRD-PARTY-ASSETS.md'));

    console.log(`pack-editor: cli/editor ${mb(packedBytes)} (${templates.length} templates, ${copied.size} files)`);
    console.log(`pack-editor: cli/skills ${skills.count} files, plus THIRD-PARTY-ASSETS.md`);
    console.log(
      `pack-editor: cli/assets.manifest.json ${Object.keys(entries).length} entries, ${mb(manifestBytes)} hydrated on demand (${byTier})`
    );
  }
}

/**
 * Wires the neutral skeleton library (app-screens/) into the empty phone
 * mockups of the App Screenshots templates: for every device element that has
 * no real screenshot yet, sets screenshotSrc to the archetype+theme chosen for
 * that app, cycling archetypes across the template's devices so consecutive
 * phones don't show identical screens.
 *
 * Usage:
 *   node wire-app-skeletons.js            # apply to ALL mapped templates
 *   node wire-app-skeletons.js tunio-music beauty-glam   # only these slugs
 *   node wire-app-skeletons.js --report   # print plan, write nothing
 */
const fs = require('fs');
const path = require('path');

const PROJ = path.resolve(__dirname, '../../../../public/data/projects');
const NAT_W = 1692, NAT_H = 3420; // app-screens are authored at 846x1710 @ DPR2

// theme = the phone-screen theme that best matches the app's real UI (chosen to
// pop against the template background). cycle = archetypes rotated across the
// template's devices in document order.
const MAP = {
  'budgetly-finance':    { theme: 'light', cycle: ['dashboard', 'list', 'dashboard'] },
  'beauty-glam':         { theme: 'light', cycle: ['grid', 'feed', 'grid'] },
  'castique-podcast':    { theme: 'dark',  cycle: ['player', 'list', 'player'] },
  'inquira':             { theme: 'light', cycle: ['chat', 'list', 'feed'] },
  'zyluxe-beauty':       { theme: 'light', cycle: ['grid', 'feed'] },
  'nexmind':             { theme: 'dark',  cycle: ['chat', 'list', 'feed'] },
  'endless-communities': { theme: 'light', cycle: ['feed', 'list', 'grid'] },
  'kicksy-sneakers':     { theme: 'light', cycle: ['grid', 'feed', 'grid'] },
  'endless-podcasts':    { theme: 'dark',  cycle: ['player', 'list', 'grid'] },
  'answerly-ai':         { theme: 'dark',  cycle: ['chat', 'list'] },
  'lumina-search':       { theme: 'light', cycle: ['chat', 'grid', 'list'] },
  'streamio-movies':     { theme: 'dark',  cycle: ['grid', 'feed', 'player'] },
  'readly-books':        { theme: 'light', cycle: ['grid', 'list', 'player'] },
  'luxe-glow':           { theme: 'light', cycle: ['grid', 'feed'] },
  'cryptix':             { theme: 'dark',  cycle: ['dashboard', 'list'] },
  'feasto':              { theme: 'light', cycle: ['grid', 'list', 'feed'] },
  'storybuzz-kids':      { theme: 'light', cycle: ['grid', 'feed'] },
  'trackio-fitness':     { theme: 'dark',  cycle: ['dashboard', 'list'] },
  'streamio-binge':      { theme: 'dark',  cycle: ['grid', 'feed', 'player'] },
  'roomora-home':        { theme: 'light', cycle: ['grid', 'feed', 'list'] },
  'playverse-games':     { theme: 'dark',  cycle: ['grid', 'feed'] },
  'voyago-travel':       { theme: 'light', cycle: ['feed', 'grid', 'list'] },
  'finexa-crypto':       { theme: 'dark',  cycle: ['dashboard', 'list'] },
  'flixio-kids':         { theme: 'dark',  cycle: ['grid', 'feed'] },
  'listenly-audio':      { theme: 'light', cycle: ['player', 'list', 'grid'] },
  'tripora-travel':      { theme: 'light', cycle: ['feed', 'grid'] },
  'tunio-music':         { theme: 'dark',  cycle: ['player', 'list', 'grid'] },
  'coinly-crypto':       { theme: 'dark',  cycle: ['dashboard', 'list'] },
  'stockio-invest':      { theme: 'dark',  cycle: ['dashboard', 'list'] },
  'threadly-social':     { theme: 'light', cycle: ['feed', 'list', 'grid'] },
  'beatforge-studio':    { theme: 'dark',  cycle: ['player', 'grid', 'list'] },
  'podly-podcasts':      { theme: 'dark',  cycle: ['player', 'list'] },
  'cinevault-stream':    { theme: 'dark',  cycle: ['grid', 'feed', 'player'] },
  'sereno-mind':         { theme: 'light', cycle: ['dashboard', 'list', 'feed'] },
  'droply-habits':       { theme: 'light', cycle: ['dashboard', 'list'] },
  'zeeb-fashion':        { theme: 'light', cycle: ['grid', 'feed'] },
  'lingua-learn':        { theme: 'light', cycle: ['list', 'feed', 'grid'] },
};

const args = process.argv.slice(2);
const reportOnly = args.includes('--report');
const slugs = args.filter((a) => !a.startsWith('--'));
const targets = slugs.length ? slugs : Object.keys(MAP);

// Surgical, formatting-preserving insert: every device element's `deviceType`
// line is immediately followed by `styleType` (verified 195/195), so we drop
// the five screenshot fields in right after `deviceType`, matching indentation.
// This keeps the templates' hand-authored inline-object style intact (a full
// JSON.stringify would re-expand every {x,y} and blow up the diff).
let totalDevices = 0;
for (const slug of targets) {
  const cfg = MAP[slug];
  if (!cfg) { console.log(`SKIP ${slug} (no mapping)`); continue; }
  const file = path.join(PROJ, `${slug}.json`);
  let text = fs.readFileSync(file, 'utf8');

  // Guard: skip templates already wired (idempotent re-runs) or with real screens.
  JSON.parse(text); // ensure it parses before editing
  if (text.includes('app-screens/app-')) { console.log(`SKIP ${slug} (already wired)`); continue; }
  if (/"screenshotSrc":\s*"\/data\/projects\/(?!app-screens)/.test(text)) {
    console.log(`SKIP ${slug} (already has real screenshots)`); continue;
  }

  let ci = 0;
  const used = [];
  text = text.replace(/^([ \t]*)"deviceType":\s*"[^"]+",[^\n]*\n/gm, (m, indent) => {
    const arch = cfg.cycle[ci % cfg.cycle.length];
    ci++;
    const src = `/data/projects/app-screens/app-${arch}-${cfg.theme}.png`;
    // Every device already carries screenshotObjectFit:"cover" and a full
    // screenshotRect (0,0,100,100) — only the src + natural dims are missing.
    const ins =
      `${indent}"screenshotSrc": "${src}",\n` +
      `${indent}"naturalScreenshotWidth": ${NAT_W},\n` +
      `${indent}"naturalScreenshotHeight": ${NAT_H},\n`;
    used.push(`${arch}-${cfg.theme}`);
    totalDevices++;
    return m + ins;
  });

  // Validate the result still parses before writing.
  JSON.parse(text);
  console.log(`${slug.padEnd(22)} ${ci} devices -> [${used.join(', ')}]`);
  if (!reportOnly) fs.writeFileSync(file, text);
}
console.log(`\n${reportOnly ? 'PLAN' : 'WROTE'}: ${targets.length} templates, ${totalDevices} device screens filled`);

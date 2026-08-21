/**
 * Crops the raw public/features captures down to the regions PromoFeatures
 * shows. A whole 1600x1000 app window scaled into a 900px panel is an
 * unreadable grey slab, so every beat gets the one region that matters.
 *
 * Coordinates are CSS px at the capture viewport; the sources are DPR2, so
 * every box is doubled on the way into ffmpeg.
 *
 * Run from promo/: node scripts/crop-features.js
 */
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const FFMPEG = process.env.FFMPEG || 'C:/ffmpeg-2026-02-04-git-627da1111c-essentials_build/bin/ffmpeg.exe';
const DIR = path.join(__dirname, '../public/features');
const DPR = 2;

/** [source, out, cssX, cssY, cssW, cssH] */
const CROPS = [
  ['02-templates', 'ui-templates', 138, 160, 1334, 500],
  ['02-templates', 'ui-tabs', 128, 62, 600, 46],
  ['01-discover', 'ui-discover', 128, 157, 1350, 505],
  ['04-editor', 'ui-canvas', 291, 48, 977, 447],
  ['32-devices-palette', 'ui-devices', 8, 190, 272, 700],
  ['11-export', 'ui-export', 560, 221, 480, 558],
  ['31-video-timeline', 'ui-timeline', 298, 700, 976, 232],
  ['31-video-timeline', 'ui-video-boards', 291, 48, 490, 390],
  ['30-agent', 'ui-agent', 100, 152, 1400, 696],
  ['34-mcp', 'ui-mcp', 320, 60, 960, 320],
  ['24-languages', 'ui-languages', 464, 40, 672, 430],
  ['25-fonts', 'ui-fonts', 1291, 373, 299, 384],
  ['23-save-menu', 'ui-save', 1158, 40, 292, 200],
  ['22-share-menu', 'ui-share', 1320, 40, 208, 160],
  ['26-panels-menu', 'ui-panels', 1280, 82, 290, 250],
  ['20-versions', 'ui-versions', 1281, 56, 319, 235],
  ['21-history', 'ui-history', 1281, 56, 319, 420],
  // Captured in its own 460x900 window, so this one is the whole frame.
  ['35-detached-panel', 'ui-detached', 0, 0, 460, 900],
];

for (const [src, out, x, y, w, h] of CROPS) {
  const inFile = path.join(DIR, `${src}.png`);
  if (!fs.existsSync(inFile)) { console.warn(`skip ${out}: no ${src}.png`); continue; }
  const crop = `crop=${w * DPR}:${h * DPR}:${x * DPR}:${y * DPR}`;
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', inFile, '-vf', crop,
    path.join(DIR, `${out}.png`)]);
  console.log(`${out}.png  ${w * DPR}x${h * DPR}`);
}

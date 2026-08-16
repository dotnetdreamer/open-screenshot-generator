/**
 * Crops the raw public/vs captures down to the regions PromoVs actually shows,
 * so the video never carries dead app chrome. Coordinates are CSS px at the
 * 1600x1000 capture viewport; sources are DPR2, so every box is doubled.
 *
 * Run from promo/: node scripts/crop-vs.js
 */
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const FFMPEG = 'C:/ffmpeg-2026-02-04-git-627da1111c-essentials_build/bin/ffmpeg.exe';
const DIR = path.join(__dirname, '../public/vs');
const DPR = 2;

/** [source, out, cssX, cssY, cssW, cssH] */
const CROPS = [
  ['1x-editor-fit', 'canvas-cinevault', 294, 72, 964, 405],
  ['1x-editor-fit', 'artboard-hero', 294, 72, 189, 405],
  ['1x-export', 'ui-export', 560, 221, 480, 558],
  ['02-agent', 'ui-agent', 103, 149, 1399, 717],
  ['2x-languages', 'ui-languages', 469, 43, 668, 500],
  ['01-start', 'ui-tabs', 128, 53, 885, 71],
  ['01-start', 'ui-templates', 128, 160, 1348, 498],
  ['03-video-tab', 'ui-video-templates', 128, 160, 1348, 498],
];

for (const [src, out, x, y, w, h] of CROPS) {
  const inFile = path.join(DIR, `${src}.png`);
  if (!fs.existsSync(inFile)) { console.warn(`skip ${out}: no ${src}.png`); continue; }
  const crop = `crop=${w * DPR}:${h * DPR}:${x * DPR}:${y * DPR}`;
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', inFile, '-vf', crop,
    path.join(DIR, `${out}.png`)]);
  console.log(`${out}.png  ${w * DPR}x${h * DPR}`);
}

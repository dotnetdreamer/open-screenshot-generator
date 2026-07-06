/**
 * Worked example: blank project -> Devices tab -> open a 3D category ->
 * add a tile -> upload a test screenshot -> export the artboard PNG.
 *
 * Usage:  node example-flow.js [outputDir]
 * Output: screenshots + downloaded export under outputDir (default ./out).
 */
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const lib = require('./lib');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'out'));
const DL = path.join(OUT, 'downloads');
const FFMPEG = 'C:/ffmpeg-2026-02-04-git-627da1111c-essentials_build/bin/ffmpeg.exe';

(async () => {
  fs.mkdirSync(DL, { recursive: true });

  // A synthetic test screen: gradient + 2px grid exposes blur/aliasing instantly.
  const screenTest = path.join(OUT, 'screen-test.png');
  if (!fs.existsSync(screenTest)) {
    execFileSync(FFMPEG, [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', 'gradients=s=1080x2400:c0=0x4F46E5:c1=0x06B6D4:x0=0:y0=0:x1=1080:y1=2400',
      '-vf', 'drawgrid=w=120:h=120:t=2:color=white@0.55',
      '-frames:v', '1', screenTest,
    ]);
  }

  const { browser, page } = await lib.launch({ downloadDir: DL });
  try {
    await lib.startBlankProject(page);
    await lib.clickTab(page, 'Devices');
    await lib.shot(page, path.join(OUT, '01-devices-overview.png'));

    await lib.clickByTitle(page, 'Browse 3D iPhone 17 Pro Max');
    await lib.sleep(800);
    await lib.shot(page, path.join(OUT, '02-3d-category-open.png'));

    await lib.addTileAndCount(page, 'Add iPhone 17 Pro Max 3D — tilted right (black)', { settleMs: 2000 });
    await lib.uploadScreenshotToSelected(page, screenTest);
    await lib.shot(page, path.join(OUT, '03-element-on-canvas.png'));

    const files = await lib.exportArtboards(page, DL, 1);
    console.log('exported:', files);
  } finally {
    await browser.close();
  }
  console.log('DONE — artifacts in', OUT);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});

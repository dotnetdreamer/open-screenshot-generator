// Bundles the app's own 3D Studio maths (src/lib/device3dStudio.ts, no three.js in it) into a
// CommonJS module this folder can require, so the turntable frames are placed with the exact
// box refit the rotate handle commits (withStudioRehug), not a guess.
//   node make-studio-math.cjs   ->  studio-math.cjs
const path = require('path');
const REPO = require('path').resolve(__dirname, '..', '..', '..', '..');
const esbuild = require(REPO + '/node_modules/esbuild');

esbuild
  .build({
    stdin: {
      contents: `
        export * from '@/lib/device3dStudio';
        export { PHONE_MODELS, measuredModelFor } from '@/lib/device3dModels';
      `,
      resolveDir: REPO,
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    tsconfig: REPO + '/tsconfig.json',
    outfile: path.join(__dirname, 'studio-math.cjs'),
    logLevel: 'error',
  })
  .then(() => {
    const m = require('./studio-math.cjs');
    const model = m.studioModelFor('iphone-18-pro');
    console.log('ok', model && model.label, Object.keys(m).length, 'exports');
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

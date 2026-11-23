// Bundles three (and the few addons the film uses) into assets/vendor/three.bundle.js.
// Uses the repo's own node_modules (three 0.185.1, esbuild). Run: node scripts/build-vendor.mjs
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
await build({
  entryPoints: [here("./vendor-entry.js")],
  bundle: true,
  format: "esm",
  minify: true,
  legalComments: "eof",
  outfile: here("../assets/vendor/three.bundle.js"),
  logLevel: "info",
});

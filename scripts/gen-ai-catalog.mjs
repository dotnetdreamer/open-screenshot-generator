// Generates public/data/ai/catalog.txt, the repository-hosted template
// catalog the AI agent's URL mode points providers at.
//
// It bundles the REAL src/lib/ai serializers with esbuild and loads templates
// exactly the way src/services/projectService.ts does (TEMPLATE_CATEGORIES
// order, filename-derived ids, name/description fallbacks), because the
// running client rebuilds the same file in the browser to compute the
// expected VERIFICATION-TOKEN. Any drift between this script and
// projectService breaks the token handshake and the app silently falls back
// to inline prompts.
//
// Runs as part of `npm run build`; run it manually after editing templates.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { build } = createRequire(path.join(repo, 'package.json'))('esbuild');

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-catalog-'));
const entryFile = path.join(workDir, 'entry.mjs');
const outFile = path.join(workDir, 'bundle.mjs');
fs.writeFileSync(
  entryFile,
  `export { buildHostedCatalog, HOSTED_CATALOG_PATH } from ${JSON.stringify(
    path.join(repo, 'src/lib/ai/hostedCatalog.ts')
  )};
export { TEMPLATE_CATEGORIES } from ${JSON.stringify(path.join(repo, 'src/lib/templateCategories.ts'))};
`
);

await build({
  entryPoints: [entryFile],
  bundle: true,
  format: 'esm',
  outfile: outFile,
  platform: 'node',
  alias: { '@': path.join(repo, 'src') },
  logLevel: 'silent',
});

const lib = await import(pathToFileURL(outFile).href);

// Mirror projectService.loadProjectTemplates: same order, ids, and fallbacks.
const projectsDir = path.join(repo, 'public/data/projects');
const templates = lib.TEMPLATE_CATEGORIES.flatMap((category) =>
  category.files.map((filename) => {
    let projectData;
    try {
      projectData = JSON.parse(fs.readFileSync(path.join(projectsDir, filename), 'utf8'));
    } catch (error) {
      console.warn(`gen-ai-catalog: skipping ${filename}: ${error.message}`);
      return null;
    }
    const baseName = filename.replace('.json', '');
    const displayName = baseName.charAt(0).toUpperCase() + baseName.slice(1);
    const templateName = (!Array.isArray(projectData) && projectData.name) || displayName;
    return {
      id: `template_${baseName}`,
      name: templateName,
      description:
        (!Array.isArray(projectData) && projectData.description) ||
        `${templateName} project template`,
      previewImage:
        (!Array.isArray(projectData) && projectData.previewImage) ||
        `https://placehold.co/300x200/6366f1/FFFFFF?text=${encodeURIComponent(templateName)}`,
      timestamp: new Date(),
      category: category.id,
      projectData: Array.isArray(projectData) ? projectData : projectData.projectData || [],
    };
  })
).filter(Boolean);

const { fileText, token } = lib.buildHostedCatalog(templates);
const target = path.join(repo, 'public', ...lib.HOSTED_CATALOG_PATH.split('/').filter(Boolean));
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, fileText);
fs.rmSync(workDir, { recursive: true, force: true });

console.log(
  `gen-ai-catalog: wrote ${path.relative(repo, target)} (${templates.length} templates, ${fileText.length} chars, token ${token})`
);

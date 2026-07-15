// Sub-path deploy helper.
//
// When the app is served under a sub-path (e.g. https://<user>.github.io/open-screenshot-generator/
// on GitHub Pages), Next applies basePath to its own assets and to next/link, but it does
// NOT rewrite string `src` values you hand to next/image or a plain <img>. So any
// root-absolute public asset we render (/elements/..., /data/...) 404s under the sub-path.
//
// We keep stored/library paths canonical (no basePath) and prefix ONLY at render time via
// withBasePath(). Locally BASE_PATH is empty, so this is a no-op in dev.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

// Prefix a root-absolute local path with the deploy sub-path. Leaves data:, blob:,
// http(s):, and protocol-relative (//) URLs untouched, and never double-prefixes.
export function withBasePath(src?: string | null): string {
  if (!src) return src ?? '';
  if (!src.startsWith('/') || src.startsWith('//')) return src;
  if (BASE_PATH && (src === BASE_PATH || src.startsWith(`${BASE_PATH}/`))) return src;
  return `${BASE_PATH}${src}`;
}

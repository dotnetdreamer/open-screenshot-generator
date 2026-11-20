// Copied from github.com/dotnetdreamer/claude-seo osg/checks/index.ts at da732e65be7f.
// Change it there and run npm run sync:seo-checks. Edits here are lost on the next sync.

// The checks Open Screenshot Generator's SEO view runs, written again in
// TypeScript from this repository's Python scripts. They are pure functions
// over text: the app fetches the pages, these read them.

export { parseHtml, textOf, findAll, find, attr, type HtmlElement } from './html';
export { canonicalizeUrl, urlMatchKey, joinUrl, siteRoot } from './url';
export {
  runPageChecks,
  visibleText,
  severityFor,
  trimEvidence,
  charLength,
  PAGE_CHECKS,
  PAGE_CHECK_IDS,
  SEVERITY_ORDER,
  THRESHOLDS,
  TITLE_MIN_CHARS,
  TITLE_MAX_CHARS,
  META_DESCRIPTION_MIN_CHARS,
  META_DESCRIPTION_MAX_CHARS,
  THIN_CONTENT_MIN_WORDS,
  type PageCheckId,
  type PageCheckResult,
  type PageFinding,
  type PageFacts,
  type NotChecked,
  type Severity,
  type HeaderMap,
} from './pageChecks';
export {
  AI_AGENTS,
  auditRobots,
  auditRobotsText,
  parseRobots,
  selectGroup,
  isAllowed,
  productToken,
  serverRendered,
  wordsWithoutJavaScript,
  jsShellMarker,
  type AiAgent,
  type AgentAccess,
  type AgentRole,
  type RobotsAudit,
  type CheckStatus,
} from './aiAccess';
export { lighthouseLlmsTxt, type LlmsVerdict } from './llms';
export { analyseText, FILLER_PHRASES, AI_PATTERNS, type ContentQuality } from './contentQuality';
export { analyseMetadata, analyseMetadataPairs, type MetadataResult, type MetadataSiteResult, type MetadataSignal } from './metadataTemplate';
export { pyRound } from './py';
export { pythonJsonError, NESTED_TOO_DEEPLY } from './pyJson';
export { decodeEntities } from './html';
export { decodeBody, decodeAs, pythonCodec, charsetFromContentType, metaCharset } from './decode';
export { readSitemapBody, MAX_SITEMAP_BYTES, type SitemapBody, type SitemapEntry, type SitemapKind } from './sitemap';

/** Which Python scripts these files follow, for the app's notes and the sync skill. */
export const PORTED_FROM = [
  'scripts/page_checks.py',
  'scripts/agentic_check.py (robots.txt, llms.txt, server-rendered)',
  'scripts/content_quality.py',
  'scripts/metadata_template.py',
  'scripts/url_safety.py (decode_body)',
  'scripts/sitemap_discovery.py (_read_body, _classify, _xml_entries)',
] as const;

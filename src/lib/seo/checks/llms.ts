// Copied from github.com/dotnetdreamer/claude-seo osg/checks/llms.ts at da732e65be7f.
// Change it there and run npm run sync:seo-checks. Edits here are lost on the next sync.

// llms.txt the way Lighthouse 13.5 judges it (scripts/agentic_check.py,
// _lighthouse_llms_txt). llmstxt.org is a community proposal, not a
// standard, and Google Search ignores the file; Lighthouse checks it.

import { charLength } from './pageChecks';
import { PY_DOT, PY_LINE_START_TEST, PY_NOT_SPACE, PY_SPACE, PY_SPACE_NOT_NEWLINE, pyIgnoreCase, pyLstrip, pySplitLines, pyStrip } from './py';

export interface LlmsVerdict {
  lighthouse: 'pass' | 'fail' | 'not-applicable';
  errors: string[];
  notes: string[];
}

// The script's patterns with re.M, in Python's terms: ^ after "\n" only, . up to "\n", its whitespace.
// They're only ever test()ed, so the ^ may take the "\n" (py.ts, PY_LINE_START_TEST).
const H1 = new RegExp(`${PY_LINE_START_TEST}${PY_SPACE_NOT_NEWLINE}*#${PY_SPACE}+${PY_DOT}+`);
const SUMMARY = new RegExp(`${PY_LINE_START_TEST}${PY_SPACE_NOT_NEWLINE}*>${PY_SPACE}+${PY_NOT_SPACE}`);
const H2 = new RegExp(`${PY_LINE_START_TEST}${PY_SPACE_NOT_NEWLINE}*##${PY_SPACE}+${PY_NOT_SPACE}`);
const SOFT_404 = new RegExp(`^${PY_SPACE}*<(${pyIgnoreCase('!doctype')}|${pyIgnoreCase('html')})`);

/** The same answer as /\[.+\]\(.+\)/ in one pass per line. */
function hasMarkdownLink(content: string): boolean {
  if (!content.includes('](')) return false;
  for (const line of content.split('\n')) {
    const opening = line.indexOf('[');
    if (opening < 0) continue;
    const middle = line.indexOf('](', opening + 2);
    if (middle >= 0 && line.indexOf(')', middle + 3) >= 0) return true;
  }
  return false;
}

/** For the parity tests (regexes.test.ts): what _LLMS_LH_H1, _SUMMARY and _H2 find. */
export function llmsLineTests(text: string): [boolean, boolean, boolean] {
  return [H1.test(text), SUMMARY.test(text), H2.test(text)];
}

export function lighthouseLlmsTxt(status: number | null, content: string | null): LlmsVerdict {
  if (status === null) return { lighthouse: 'fail', errors: ['fetch failed'], notes: [] };
  if (status >= 500) return { lighthouse: 'fail', errors: [`HTTP ${status}`], notes: [] };
  if (status >= 400) return { lighthouse: 'not-applicable', errors: [], notes: [`HTTP ${status}`] };
  const text = (content ?? '').replace(/^\ufeff+/, '');
  const errors: string[] = [];
  if (!H1.test(text)) errors.push('missing an H1 header ("# Title")');
  if (!hasMarkdownLink(text)) errors.push('contains no Markdown links');
  if (charLength(text) < 50) errors.push('shorter than 50 characters');
  const notes: string[] = [];
  const lines = pySplitLines(text).filter((line) => pyStrip(line));
  if (lines.length && !pyLstrip(lines[0]).startsWith('# ')) notes.push('llmstxt.org expects the H1 to be the first line');
  if (!SUMMARY.test(text)) notes.push("no blockquote summary ('> ...') as llmstxt.org recommends");
  if (!H2.test(text)) notes.push('no H2 sections grouping the links');
  if (SOFT_404.test(text)) notes.push('served HTML, not Markdown (likely a soft 404); not a Lighthouse rule');
  return { lighthouse: errors.length ? 'fail' : 'pass', errors, notes };
}

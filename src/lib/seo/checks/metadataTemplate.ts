// Copied from github.com/dotnetdreamer/claude-seo osg/checks/metadataTemplate.ts at da732e65be7f.
// Change it there and run npm run sync:seo-checks. Edits here are lost on the next sync.

// Machine-made title and description pairs (scripts/metadata_template.py): a
// description that opens by repeating its own title and ends with a stock
// call to action, the brand pasted into the description, or a description
// that is the title again. String comparison only, no model.

import { PY_END, PY_SPACE, pyCompare, pyIgnoreCaseSource, pyLower, pyRepr, pyRound, pySplit, pyStrip, WORD_CHAR } from './py';

const W = WORD_CHAR;
const CTA_TAIL_PATTERNS = [
  'try (?:it )?(?:free|now)(?: now)?',
  'try (?:it )?today',
  `start (?:your |the )?(?:${W}+ ){0,3}(?:free|now)`,
  '(?:learn|read|find out|see) (?:more )?now',
  'get started(?: (?:now|free|today))?',
  `check (?:it out|your ${W}+) now`,
  `(?:boost|improve|upgrade) (?:your )?(?:${W}+ ){0,3}now`,
  'sign up (?:free|now|today)',
];
// re.IGNORECASE as Python reads it, without the i flag, which would widen \w as well (py.ts, pyIgnoreCaseSource).
const CTA_TAIL = new RegExp(`(${CTA_TAIL_PATTERNS.map(pyIgnoreCaseSource).join('|')})[.!]*${PY_SPACE}*${PY_END}`, 'u');
const BRAND_SEPARATOR = new RegExp(`${PY_SPACE}[|\\u2013\\u2014-]${PY_SPACE}`, 'u');
const NON_ALNUM = /[^a-z0-9 ]+/g;
const MIN_TITLE_CHARS = 25;
const ECHO_PREFIX_CHARS = 60;
const BRAND_MIN_CHARS = 2;
const BRAND_MAX_CHARS = 30;
const SITE_MIN_TEMPLATED_PAGES = 3;
const SITE_HIGH_RATIO = 0.3;
const SITE_MEDIUM_RATIO = 0.1;

type SignalSeverity = 'high' | 'medium' | 'low';

export interface MetadataSignal {
  id: 'templated_metadata' | 'description_echoes_title' | 'brand_suffix_in_description' | 'description_duplicates_title';
  severity: SignalSeverity;
  message: string;
  recommendation: string;
}

export interface MetadataResult {
  url: string | null;
  title: string;
  description: string;
  templated: boolean;
  severity: SignalSeverity | 'none';
  cta_phrase: string | null;
  flags: string[];
  signals: MetadataSignal[];
}

function cps(text: string): string[] {
  return Array.from(text);
}

function normalise(text: string): string {
  return pySplit(pyLower(text).replace(NON_ALNUM, ' ')).join(' ');
}

function stripChars(text: string, set: string): string {
  const list = cps(text);
  let start = 0;
  let end = list.length;
  while (start < end && set.includes(list[start])) start++;
  while (end > start && set.includes(list[end - 1])) end--;
  return list.slice(start, end).join('');
}

function titleCore(title: string): string {
  return pyStrip(title.split(BRAND_SEPARATOR)[0]);
}

/** For the parity tests (regexes.test.ts): _CTA_TAIL_RE.search(text).group(1). */
export function ctaTail(text: string): string | null {
  return CTA_TAIL.exec(text)?.[1] ?? null;
}

function echoRemainder(core: string, description: string): string {
  return stripChars(cps(description).slice(cps(core).length).join(''), ' -\u2013\u2014:|.');
}

export function analyseMetadata(title: string, description: string, url: string | null = null): MetadataResult {
  const t = pyStrip(title || '');
  const d = pyStrip(description || '');
  const result: MetadataResult = { url, title: t, description: d, templated: false, severity: 'none', cta_phrase: null, flags: [], signals: [] };
  if (!t || !d) {
    result.flags.push('missing-metadata');
    return result;
  }
  const core = titleCore(t);
  const coreN = normalise(core);
  const titleN = normalise(t);
  const descriptionN = normalise(d);
  const signals = result.signals;

  const echoesTitle = cps(coreN).length >= MIN_TITLE_CHARS && descriptionN.startsWith(cps(coreN).slice(0, ECHO_PREFIX_CHARS).join(''));
  if (echoesTitle) {
    const cta = CTA_TAIL.exec(echoRemainder(core, d));
    if (cta) {
      result.templated = true;
      result.cta_phrase = normalise(cta[1]);
      result.flags.push('templated-metadata');
      signals.push({
        id: 'templated_metadata',
        severity: 'high',
        message:
          'Meta description repeats the title verbatim and then closes with a stock call to action. Bulk metadata jobs emit this shape on every page at once, and duplicated or templated metadata site-wide is a documented content-quality problem even when the body copy is original.',
        recommendation:
          'Rewrite the description to say what the title does not: what the page does, for whom, and what makes it different. 150-160 characters, no stock CTA.',
      });
    } else {
      result.flags.push('description-echoes-title');
      signals.push({
        id: 'description_echoes_title',
        severity: 'medium',
        message: 'Meta description opens with the exact text of the title, so the SERP snippet says the same thing twice.',
        recommendation: 'Open the description with information the title does not already carry.',
      });
    }
  }

  const parts = t.split(BRAND_SEPARATOR);
  if (parts.length > 1) {
    const brand = pyStrip(parts[parts.length - 1]);
    const brandN = normalise(brand);
    const brandLength = cps(brand).length;
    if (brandLength >= BRAND_MIN_CHARS && brandLength <= BRAND_MAX_CHARS && brandN && ` ${descriptionN} `.includes(` ${brandN} `) && !d.startsWith(brand)) {
      result.flags.push('brand-suffix-in-description');
      signals.push({
        id: 'brand_suffix_in_description',
        severity: 'low',
        message: `The title's brand suffix ${pyRepr(brand)} was concatenated into the meta description body. That is a generation artefact rather than a written sentence, and it spends SERP characters on your own name.`,
        recommendation: `Remove ${pyRepr(brand)} from the description body; the title already carries it.`,
      });
    }
  }

  if (cps(titleN).length >= MIN_TITLE_CHARS && descriptionN === titleN) {
    result.flags.push('description-duplicates-title');
    signals.push({
      id: 'description_duplicates_title',
      severity: 'medium',
      message: 'Meta description is identical to the title tag. Google has two SERP slots and both currently say the same thing.',
      recommendation: 'Write a description that expands on the title instead of repeating it.',
    });
  }

  const order: Record<SignalSeverity, number> = { high: 3, medium: 2, low: 1 };
  if (signals.length) {
    result.severity = signals.reduce<SignalSeverity>((best, signal) => (order[signal.severity] > order[best] ? signal.severity : best), signals[0].severity);
  }
  return result;
}

export interface MetadataSiteResult {
  pages: MetadataResult[];
  pages_checked: number;
  templated_count: number;
  templated_ratio: number;
  shared_cta_phrases: Record<string, number>;
  site_flags: string[];
  site_risk: 'high' | 'medium' | 'low';
  method: 'heuristic';
}

/** The pages together: one templated description is an oversight, the same shape across a third of the site is a pattern. */
export function analyseMetadataPairs(pairs: ReadonlyArray<{ title?: string; description?: string; url?: string | null }>): MetadataSiteResult {
  const pages = pairs.map((pair) => analyseMetadata(pair.title ?? '', pair.description ?? '', pair.url ?? null));
  const templated = pages.filter((page) => page.templated);
  const checked = pages.length;
  const ratio = checked ? templated.length / checked : 0;
  const counts = new Map<string, number>();
  for (const page of templated) if (page.cta_phrase) counts.set(page.cta_phrase, (counts.get(page.cta_phrase) ?? 0) + 1);
  const shared: Record<string, number> = {};
  for (const [phrase, n] of [...counts.entries()].sort((a, b) => b[1] - a[1] || pyCompare(a[0], b[0]))) shared[phrase] = n;
  const siteFlags: string[] = [];
  let risk: MetadataSiteResult['site_risk'] = 'low';
  if (templated.length >= SITE_MIN_TEMPLATED_PAGES && ratio >= SITE_HIGH_RATIO) {
    siteFlags.push('site-wide-templated-metadata');
    risk = 'high';
  } else if (templated.length >= SITE_MIN_TEMPLATED_PAGES && ratio >= SITE_MEDIUM_RATIO) {
    siteFlags.push('templated-metadata-cluster');
    risk = 'medium';
  } else if (templated.length) {
    siteFlags.push('templated-metadata-isolated');
  }
  if ([...counts.values()].some((n) => n >= SITE_MIN_TEMPLATED_PAGES)) siteFlags.push('shared-cta-tail');
  return {
    pages,
    pages_checked: checked,
    templated_count: templated.length,
    templated_ratio: pyRound(ratio, 3),
    shared_cta_phrases: shared,
    site_flags: siteFlags,
    site_risk: risk,
    method: 'heuristic',
  };
}

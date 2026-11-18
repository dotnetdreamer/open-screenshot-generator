// The playbook's files, read into what the screens show (types.ts). Pure, so
// tests/unit/storeCompliance.test.ts runs it on the repository's real files.
//
// The playbook is written by people and changes often, so every reader takes
// what it can: an entry without an id or a title is skipped, an unknown store
// or severity falls back to a neutral one, a date that is not YYYY-MM-DD is
// left out. Only a file that cannot be read at all throws (BrokenFileError),
// and for the two data files that stops the whole update (sync.ts), so the
// copy on this computer stays the last one that worked.

import { hash32 } from '@/lib/i18n/hash';
import { parsePlainLanguage, PLAIN_FILE, withPlainLanguage } from './plain';
import type {
  AppType,
  Checklist,
  ChecklistGroup,
  ChecklistSection,
  Deadline,
  GuideGroup,
  GuideLink,
  RejectionRule,
  RuleStore,
  RulesLibrary,
  Severity,
  ShipStore,
  StoredFile,
} from './types';

export class BrokenFileError extends Error {
  constructor(
    readonly path: string,
    reason: string
  ) {
    super(`${path}: ${reason}`);
    this.name = 'BrokenFileError';
  }
}

const STORES: RuleStore[] = ['apple', 'google', 'both', 'web'];
const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function textOrNull(value: unknown): string | null {
  const value_ = text(value);
  return value_ || null;
}

function words(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim());
}

function day(value: unknown): string | null {
  const value_ = text(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(value_) ? value_ : null;
}

function severity(value: unknown): Severity {
  const value_ = text(value).toLowerCase();
  return (SEVERITIES as string[]).includes(value_) ? (value_ as Severity) : 'medium';
}

function readJson(path: string, source: string): Record<string, unknown> {
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch {
    throw new BrokenFileError(path, 'is not valid JSON');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new BrokenFileError(path, 'is not a JSON object');
  return data as Record<string, unknown>;
}

/** rejection-patterns.json, with each rule's command from detection-recipes.json when there is one. */
export function parseRules(source: string, recipesSource?: string | null): { rules: RejectionRule[]; updated: string | null } {
  const path = 'data/rejection-patterns.json';
  const data = readJson(path, source);
  if (!Array.isArray(data.patterns)) throw new BrokenFileError(path, 'has no "patterns" list');
  const recipes = recipesSource ? parseRecipes(recipesSource) : {};
  const seen = new Set<string>();
  const rules: RejectionRule[] = [];
  for (const entry of data.patterns as unknown[]) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    const id = text(raw.id);
    const title = text(raw.title);
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    const store = text(raw.platform).toLowerCase();
    rules.push({
      id,
      store: (STORES as string[]).includes(store) ? (store as RuleStore) : 'both',
      guideline: text(raw.guideline),
      title,
      severity: severity(raw.severity),
      detection: text(raw.detection),
      fix: text(raw.fix),
      signals: words(raw.signals),
      counterSignals: words(raw.counterSignals),
      added: day(raw.added),
      framework: textOrNull(raw.framework),
      recipe: recipes[id] ?? null,
    });
  }
  if (rules.length === 0) throw new BrokenFileError(path, 'has no rules with an id and a title');
  return { rules, updated: day(data.updated) };
}

/** detection-recipes.json: one command per rule id. A broken file only loses the commands. */
export function parseRecipes(source: string): Record<string, string> {
  try {
    const data = readJson('data/detection-recipes.json', source);
    const recipes = data.recipes;
    if (!recipes || typeof recipes !== 'object' || Array.isArray(recipes)) return {};
    const out: Record<string, string> = {};
    for (const [id, command] of Object.entries(recipes as Record<string, unknown>)) {
      if (typeof command === 'string' && command.trim()) out[id] = command.trim();
    }
    return out;
  } catch {
    return {};
  }
}

export function parseDeadlines(source: string): Deadline[] {
  const path = 'data/regulatory-deadlines.json';
  const data = readJson(path, source);
  if (!Array.isArray(data.deadlines)) throw new BrokenFileError(path, 'has no "deadlines" list');
  const seen = new Set<string>();
  const deadlines: Deadline[] = [];
  for (const entry of data.deadlines as unknown[]) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    const id = text(raw.id);
    const law = text(raw.law);
    if (!id || !law || seen.has(id)) continue;
    seen.add(id);
    deadlines.push({
      id,
      jurisdiction: text(raw.jurisdiction) || 'Worldwide',
      law,
      requirement: text(raw.requirement),
      effective: day(raw.effective_date),
      grace: textOrNull(raw.grace_period),
      mandatory: day(raw.mandatory_date),
      enforcement: day(raw.enforcement_date),
      priority: severity(raw.priority),
      sourceUrl: webAddress(raw.source_url),
      verifiedOn: day(raw.verified_on),
      sourceNote: textOrNull(raw.source_note),
    });
  }
  if (deadlines.length === 0) throw new BrokenFileError(path, 'has no deadlines with an id and a law');
  return deadlines;
}

/** Only http and https addresses are ever opened. */
export function webAddress(value: unknown): string | null {
  const value_ = text(value);
  if (!value_) return null;
  try {
    const url = new URL(value_);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The day a deadline counts from: when it must be met, else when it is enforced, else when it took effect. */
export function deadlineDay(deadline: Deadline): string | null {
  return deadline.mandatory ?? deadline.enforcement ?? deadline.effective;
}

// --- Markdown ------------------------------------------------------------------

/** Lines without front matter, HTML blocks and the CRs of Windows line ends. */
function markdownLines(source: string): string[] {
  let body = source.replace(/\r\n?/g, '\n');
  if (body.startsWith('---\n')) {
    const end = body.indexOf('\n---', 4);
    if (end !== -1) body = body.slice(body.indexOf('\n', end + 1) + 1);
  }
  body = body.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  return body.split('\n');
}

function heading(line: string): { level: number; text: string } | null {
  const match = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
  return match ? { level: match[1].length, text: match[2].trim() } : null;
}

function storeOfTitle(title: string): ShipStore | null {
  const apple = /\bapple\b|\bios\b|app store/i.test(title);
  const google = /\bgoogle\b|\bandroid\b|\bplay\b/i.test(title);
  if (apple === google) return null;
  return apple ? 'apple' : 'google';
}

const COMMON_WORDS = new Set('a an and are as at be by for from has have in is it its of on or so that the their this to what when with app apps'.split(' '));

function contentWords(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) => !COMMON_WORDS.has(word)));
}

/** A box says the same check as a sentence when most of the shorter one's words are in the other. */
function sameCheck(sentence: string, box: string): boolean {
  const a = contentWords(sentence);
  const b = contentWords(box);
  const shared = [...a].filter((word) => b.has(word)).length;
  return Math.min(a.size, b.size) > 0 && shared / Math.min(a.size, b.size) >= 0.6;
}

/**
 * docs/PRE-SUBMISSION-CHECKLIST.md: `##` sections, `###` groups and `- [ ]`
 * items. A short line ending in a full stop right before a list ("Apple.")
 * names a group too, as the platform mechanics section writes them. A section
 * with no boxes (a closing note) is left out. The list after a sentence saying
 * some items "can never be marked not applicable" names the boxes that always
 * apply (`always`): every app has them, so the screen offers no way out.
 */
export function parseChecklist(source: string): Checklist {
  const lines = markdownLines(source);
  const checklist: Checklist = { title: 'Checklist', intro: [], sections: [], always: [] };
  // The paragraph just read said which checks can never be marked not applicable.
  let alwaysNext = false;
  // The raw lines under the section heading, until its first box or heading.
  let introLines: string[] | null = null;
  const endIntro = () => {
    if (section && introLines) section.introSource = introLines.join('\n').replace(/\s+/g, ' ').trim();
    introLines = null;
  };
  let section: ChecklistSection | null = null;
  let group: ChecklistGroup | null = null;
  let paragraph: string[] = [];
  // A paragraph like "Apple." waits to see whether a list follows it.
  let label: string | null = null;
  const ids = new Set<string>();

  const itemId = (body: string) => {
    const base = hash32(body.replace(/\s+/g, ' ').trim().toLowerCase());
    let id = base;
    for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
    ids.add(id);
    return id;
  };
  const startGroup = (title: string | null) => {
    if (!section) return;
    group = { id: `${section.id}/${hash32(title ?? '')}`, title, store: title ? storeOfTitle(title) : null, items: [] };
    section.groups.push(group);
  };
  const intro = (words: string) => {
    if (section) section.intro.push(words);
    else checklist.intro.push(words);
  };
  const dropLabel = () => {
    if (label) intro(label);
    label = null;
  };
  const flush = () => {
    const joined = paragraph.join(' ').trim();
    paragraph = [];
    if (!joined) return;
    dropLabel();
    if (/never be marked (as )?(not applicable|n\/a)/i.test(joined)) alwaysNext = true;
    // A group's name is a word or three ("Apple.", "Cross-cutting."); a longer line is a sentence.
    if (section && joined.length <= 25 && /^[A-Z][\w-]*(?: [\w-]+){0,2}\.$/.test(joined)) label = joined;
    else intro(joined);
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const head = heading(line);
    if (head || /^\s*[-*]\s+\[[ xX]\]\s+/.test(line)) endIntro();
    else if (introLines) introLines.push(line);
    if (head) {
      flush();
      dropLabel();
      alwaysNext = false;
      if (head.level === 1) {
        checklist.title = head.text;
      } else if (head.level === 2) {
        section = { id: hash32(head.text), title: head.text, intro: [], store: storeOfTitle(head.text), groups: [] };
        checklist.sections.push(section);
        group = null;
        introLines = [];
      } else if (section) {
        startGroup(head.text);
      }
      continue;
    }
    const item = /^\s*[-*]\s+\[[ xX]\]\s+(.*)$/.exec(line);
    if (item && section) {
      // A one-line paragraph like "Apple." right above the list names it.
      flush();
      if (label) {
        startGroup((label as string).slice(0, -1));
        label = null;
      }
      let body = item[1];
      // Lines indented under the item belong to it.
      while (index + 1 < lines.length && /^\s{2,}\S/.test(lines[index + 1]) && !/^\s*[-*]\s+\[/.test(lines[index + 1])) {
        body += ` ${lines[++index].trim()}`;
      }
      if (!group) startGroup(null);
      group!.items.push({ id: itemId(body), text: body.trim() });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (alwaysNext && bullet) {
      flush();
      checklist.always.push(bullet[1].trim());
      intro(bullet[1].trim());
      continue;
    }
    if (alwaysNext && checklist.always.length > 0) alwaysNext = false;
    // Plain bullets in an intro read as sentences of it.
    paragraph.push(line.trim().replace(/^[-*]\s+/, ''));
  }
  flush();
  dropLabel();
  endIntro();
  checklist.sections = checklist.sections
    .map((entry) => ({ ...entry, groups: entry.groups.filter((candidate) => candidate.items.length > 0) }))
    .filter((entry) => entry.groups.length > 0);
  for (const section of checklist.sections) {
    for (const group of section.groups) {
      for (const item of group.items) {
        if (checklist.always.some((sentence) => sameCheck(sentence, item.text))) item.always = true;
      }
    }
  }
  return checklist;
}

/** Every box of the checklist, in order. */
export function checklistItems(
  checklist: Checklist | null
): Array<{ section: ChecklistSection; group: ChecklistGroup; id: string; text: string; plain?: string; always?: boolean }> {
  if (!checklist) return [];
  return checklist.sections.flatMap((section) =>
    section.groups.flatMap((group) =>
      group.items.map((item) => ({ section, group, id: item.id, text: item.text, plain: item.plain, always: item.always }))
    )
  );
}

/** The boxes for an app on these stores: a section or group about the other store only is left out. */
export function checklistItemsFor(checklist: Checklist | null, stores: ShipStore[]): ReturnType<typeof checklistItems> {
  return checklistItems(checklist).filter(
    (item) => (!item.section.store || stores.includes(item.section.store)) && (!item.group.store || stores.includes(item.group.store))
  );
}

const MD_LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;

/** A relative link in the file at `from`, as a repository path. Null for a web address or an anchor. */
export function repoPath(href: string, from = 'docs/'): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('#')) return null;
  const [file] = href.split(/[#?]/);
  if (!file) return null;
  const parts = (file.startsWith('/') ? file : from.replace(/[^/]*$/, '') + file).split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '..') out.pop();
    else if (part && part !== '.') {
      try {
        out.push(decodeURIComponent(part));
      } catch {
        out.push(part);
      }
    }
  }
  return out.join('/') || null;
}

/** A link to a Markdown file of the repository, as a repository path. */
export function docsPath(href: string, from = 'docs/'): string | null {
  const path = repoPath(href, from);
  return path && /\.md$/i.test(path) ? path : null;
}

function sentence(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * The guides, in the groups and order of the repository's own docs/index.md,
 * so a guide the repository links there shows here too. A table row's first
 * cell describes its link ("About to submit"), and a list item's words after
 * its link do. The section about installing the guard is left out: the guard
 * is a command-line tool this app does not run.
 */
export function parseGuideIndex(source: string): GuideGroup[] {
  const groups: GuideGroup[] = [];
  const seen = new Set<string>();
  let current: GuideGroup | null = null;
  for (const line of markdownLines(source)) {
    const head = heading(line);
    if (head) {
      current = head.level >= 2 ? { title: head.text, guides: [] } : null;
      if (current && !/run the guard|install/i.test(current.title)) groups.push(current);
      else current = null;
      continue;
    }
    if (!current) continue;
    const links = [...line.matchAll(MD_LINK)];
    if (links.length === 0) continue;
    const cells = line.trim().startsWith('|') ? line.split('|').map((cell) => cell.trim()).filter(Boolean) : null;
    for (const link of links) {
      const path = docsPath(link[2]);
      if (!path || seen.has(path)) continue;
      seen.add(path);
      let description: string | null = null;
      if (cells && cells.length > 1 && !cells[0].includes('](')) {
        description = cells[0];
      } else if (links.length === 1) {
        const after = line.slice((link.index ?? 0) + link[0].length).replace(/^[\s.:,]+/, '').replace(MD_LINK, '$1').trim();
        description = after || null;
      }
      const guide: GuideLink = { path, title: sentence(link[1].replace(/[*_`]/g, '').trim()), description };
      current.guides.push(guide);
    }
  }
  return groups.filter((group) => group.guides.length > 0);
}

/** One guide per kind of app, the every-app one first. */
export function parseAppTypes(files: Array<{ path: string; text: string }>): AppType[] {
  const types = files.map((file) => {
    const lines = markdownLines(file.text);
    const title = lines.map(heading).find((head) => head && head.level === 1)?.text ?? file.path.replace(/^.*\//, '').replace(/\.md$/, '');
    const points = lines
      .map((line) => /^\s*[-*]\s+(.*)$/.exec(line)?.[1]?.trim())
      .filter((point): point is string => !!point);
    const id = file.path.replace(/^.*\//, '').replace(/\.md$/, '');
    return { id, title, points };
  });
  return types
    .filter((type) => type.points.length > 0)
    .sort((a, b) => (a.id.startsWith('universal') ? -1 : b.id.startsWith('universal') ? 1 : a.title.localeCompare(b.title)));
}

/** A heading's anchor, as GitHub makes it, so links like PRE-SUBMISSION-CHECKLIST.md#apple-specific land. */
export function anchorOf(title: string): string {
  return title
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

export const RULES_FILE = 'data/rejection-patterns.json';
export const DEADLINES_FILE = 'data/regulatory-deadlines.json';

/**
 * Check the two data files of an update before it is kept. Throws
 * BrokenFileError when either cannot be read.
 */
export function validateRequired(files: Map<string, Pick<StoredFile, 'text'>>): void {
  const rules = files.get(RULES_FILE);
  const deadlines = files.get(DEADLINES_FILE);
  if (!rules) throw new BrokenFileError(RULES_FILE, 'is missing');
  if (!deadlines) throw new BrokenFileError(DEADLINES_FILE, 'is missing');
  parseRules(rules.text);
  parseDeadlines(deadlines.text);
}

/**
 * An optional file of an update is taken only when its screen can use it,
 * read the way that screen reads it, so a push that breaks it (bad JSON, or
 * good JSON in the wrong shape, like {"recipes": null}) keeps the copy that
 * worked, the way a broken data file keeps the whole last update (sync.ts).
 * A file not named here only has to have something in it.
 */
export function usableFile(file: Pick<StoredFile, 'path' | 'text'>): boolean {
  switch (file.path) {
    case 'data/detection-recipes.json':
      return Object.keys(parseRecipes(file.text)).length > 0;
    case PLAIN_FILE: {
      const plain = parsePlainLanguage(file.text);
      return plain.rules.size + plain.deadlines.size + plain.checklist.size > 0;
    }
    case 'docs/PRE-SUBMISSION-CHECKLIST.md':
      return checklistItems(parseChecklist(file.text)).length > 0;
    case 'docs/index.md':
      return parseGuideIndex(file.text).length > 0;
    default:
      return file.text.trim().length > 0;
  }
}

/** Everything the screens read, from the files on this computer. */
export function buildLibrary(files: Map<string, Pick<StoredFile, 'path' | 'text'>>, commit: string | null): RulesLibrary | null {
  const rulesFile = files.get(RULES_FILE);
  const deadlinesFile = files.get(DEADLINES_FILE);
  if (!rulesFile || !deadlinesFile) return null;
  let rules: RejectionRule[];
  let updated: string | null;
  let deadlines: Deadline[];
  try {
    ({ rules, updated } = parseRules(rulesFile.text, files.get('data/detection-recipes.json')?.text ?? null));
    deadlines = parseDeadlines(deadlinesFile.text);
  } catch (error) {
    console.error('The playbook saved on this computer could not be read', error);
    return null;
  }
  const checklistFile = files.get('docs/PRE-SUBMISSION-CHECKLIST.md');
  const indexFile = files.get('docs/index.md');
  const version = files.get('VERSION')?.text.trim().split('\n')[0]?.trim() ?? '';
  const plain = withPlainLanguage(
    parsePlainLanguage(files.get(PLAIN_FILE)?.text),
    rules,
    deadlines,
    checklistFile ? parseChecklist(checklistFile.text) : null
  );
  return {
    rules: plain.rules,
    rulesUpdated: updated,
    version: /^v?\d+(\.\d+){0,3}$/.test(version) ? version.replace(/^v/, '') : null,
    deadlines: plain.deadlines,
    checklist: plain.checklist,
    appTypes: parseAppTypes([...files.values()].filter((file) => file.path.startsWith('references/guidelines/by-app-type/'))),
    guides: indexFile ? parseGuideIndex(indexFile.text) : [],
    notice: files.get('NOTICE')?.text.trim() || null,
    reviewNotes: files.get('templates/REVIEW-NOTES-TEMPLATE.md')?.text ?? null,
    commit,
  };
}

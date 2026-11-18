// The playbook in everyday words. The playbook is written for developers and
// lawyers ("QUERY_ALL_PACKAGES declared in AndroidManifest", "Article 50(2)"),
// and most people who make screenshots are neither. The repository can carry
// data/plain-language.json beside the playbook's own files: each rule,
// deadline and checklist box rewritten in plain words. The repository makes
// and keeps that file itself (its scripts/plain-language.py and the
// plain-language skill in .claude/skills); this app only reads it. The
// screens show those words and keep the playbook's own a click away, for
// the developer and for the AI.
//
// The fingerprints below are a contract with that script, which writes them
// into the file: tests/unit/storeCompliance.test.ts pins their values, and the
// repository's scripts/test-plain-language.py pins the same ones.
//
// Each rule and deadline entry keeps the fingerprint of the playbook's text it
// was written from. When the playbook rewords a rule or moves a date, the
// fingerprint stops matching and the screens show the playbook's words again,
// so a plain sentence never says something the playbook no longer says. A box
// of the checklist is keyed by its id, which is already the hash of its words;
// a section by the fingerprint of its title and intro; a group by its id.
//
// Plain text may run over a few lines: a short first line, then a list whose
// lines start with "- ". Everything else in it is plain text, never Markdown.

import { hash32 } from '@/lib/i18n/hash';
import type { Checklist, ChecklistGroup, ChecklistSection, Deadline, PlainDeadline, PlainRule, RejectionRule } from './types';

export const PLAIN_FILE = 'data/plain-language.json';

/** The longest plain title the file may hold; anything longer is not a title and is left out. */
export const PLAIN_TITLE_MAX = 120;
/** The longest plain paragraph. */
export const PLAIN_TEXT_MAX = 600;

export function ruleFingerprint(rule: Pick<RejectionRule, 'store' | 'guideline' | 'title' | 'detection' | 'fix'>): string {
  return hash32([rule.store, rule.guideline, rule.title, rule.detection, rule.fix].join('\n'));
}

export function deadlineFingerprint(
  deadline: Pick<Deadline, 'jurisdiction' | 'law' | 'requirement' | 'effective' | 'grace' | 'mandatory' | 'enforcement'>
): string {
  return hash32(
    [deadline.jurisdiction, deadline.law, deadline.requirement, deadline.effective ?? '', deadline.grace ?? '', deadline.mandatory ?? '', deadline.enforcement ?? ''].join('\n')
  );
}

/** A box's key in the file: its id without the "-2" a repeated box gets. */
export function checklistKey(id: string): string {
  return id.replace(/-\d+$/, '');
}

/** What a section's plain words were written from: its title and the lines under it (parse.ts). */
export function sectionFingerprint(section: Pick<ChecklistSection, 'title' | 'introSource'>): string {
  return hash32(`${section.title}\n${section.introSource ?? ''}`);
}

export interface PlainLanguage {
  rules: Map<string, PlainRule & { from: string }>;
  deadlines: Map<string, PlainDeadline & { from: string }>;
  checklist: Map<string, string>;
  sections: Map<string, { from: string; title: string; intro: string | null }>;
  groups: Map<string, string>;
}

/** Plain text, line by line: spaces folded within a line, empty lines dropped, the line breaks kept. */
function words(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  return text && text.length <= max ? text : null;
}

function entries(data: Record<string, unknown>, key: string): Array<[string, Record<string, unknown>]> {
  const value = data[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, Record<string, unknown>] => !!entry[1] && typeof entry[1] === 'object');
}

/**
 * data/plain-language.json. Optional, so anything it cannot read is left out:
 * a broken file only loses the plain words, never the rules.
 */
export function parsePlainLanguage(source: string | null | undefined): PlainLanguage {
  const plain: PlainLanguage = { rules: new Map(), deadlines: new Map(), checklist: new Map(), sections: new Map(), groups: new Map() };
  if (!source) return plain;
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch (error) {
    console.warn(`${PLAIN_FILE} is not valid JSON, so the playbook's own words show`, error);
    return plain;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return plain;
  const file = data as Record<string, unknown>;
  for (const [id, entry] of entries(file, 'rules')) {
    const from = words(entry.from, 64);
    const title = words(entry.title, PLAIN_TITLE_MAX);
    const problem = words(entry.problem, PLAIN_TEXT_MAX);
    const fix = words(entry.fix, PLAIN_TEXT_MAX);
    if (from && title && problem && fix) plain.rules.set(id, { from, title, problem, fix });
  }
  for (const [id, entry] of entries(file, 'deadlines')) {
    const from = words(entry.from, 64);
    const title = words(entry.title, PLAIN_TITLE_MAX);
    const summary = words(entry.summary, PLAIN_TEXT_MAX);
    if (from && title && summary) plain.deadlines.set(id, { from, title, summary });
  }
  for (const [id, entry] of entries(file, 'checklist')) {
    const text = words(entry.text, PLAIN_TEXT_MAX);
    if (text) plain.checklist.set(id, text);
  }
  for (const [id, entry] of entries(file, 'sections')) {
    const from = words(entry.from, 64);
    const title = words(entry.title, PLAIN_TITLE_MAX);
    if (from && title) plain.sections.set(id, { from, title, intro: words(entry.intro, PLAIN_TEXT_MAX) });
  }
  for (const [id, entry] of entries(file, 'groups')) {
    const title = words(entry.title, PLAIN_TITLE_MAX);
    if (title) plain.groups.set(id, title);
  }
  return plain;
}

/** The rules, deadlines and checklist with their plain words, where the file has them for the current wording. */
export function withPlainLanguage(
  plain: PlainLanguage,
  rules: RejectionRule[],
  deadlines: Deadline[],
  checklist: Checklist | null
): { rules: RejectionRule[]; deadlines: Deadline[]; checklist: Checklist | null } {
  return {
    rules: rules.map((rule) => {
      const entry = plain.rules.get(rule.id);
      return entry && entry.from === ruleFingerprint(rule) ? { ...rule, plain: { title: entry.title, problem: entry.problem, fix: entry.fix } } : rule;
    }),
    deadlines: deadlines.map((deadline) => {
      const entry = plain.deadlines.get(deadline.id);
      return entry && entry.from === deadlineFingerprint(deadline) ? { ...deadline, plain: { title: entry.title, summary: entry.summary } } : deadline;
    }),
    checklist: checklist && {
      ...checklist,
      sections: checklist.sections.map((section) => {
        const entry = plain.sections.get(section.id);
        return {
          ...section,
          ...(entry && entry.from === sectionFingerprint(section) ? { plain: { title: entry.title, intro: entry.intro } } : {}),
          groups: section.groups.map((group) => {
            const title = plain.groups.get(group.id);
            return {
              ...group,
              ...(title && group.title ? { plainTitle: title } : {}),
              items: group.items.map((item) => {
                const text = plain.checklist.get(checklistKey(item.id));
                return text ? { ...item, plain: text } : item;
              }),
            };
          }),
        };
      }),
    },
  };
}

// --- what the screens show ----------------------------------------------------------

export function ruleTitle(rule: RejectionRule): string {
  return rule.plain?.title ?? rule.title;
}

/** What the reviewer sees and why the app is turned down. */
export function ruleProblem(rule: RejectionRule): string {
  return rule.plain?.problem ?? rule.detection;
}

export function ruleFix(rule: RejectionRule): string {
  return rule.plain?.fix ?? rule.fix;
}

export function deadlineTitle(deadline: Deadline): string {
  return deadline.plain?.title ?? deadline.law;
}

export function deadlineSummary(deadline: Deadline): string {
  return deadline.plain?.summary ?? deadline.requirement;
}

export function checkText(item: { text: string; plain?: string }): string {
  return item.plain ?? item.text;
}

export function sectionTitle(section: Pick<ChecklistSection, 'title' | 'plain'>): string {
  return section.plain?.title ?? section.title;
}

export function groupTitle(group: Pick<ChecklistGroup, 'title' | 'plainTitle'>): string | null {
  return group.plainTitle ?? group.title;
}

/**
 * The links in a checklist section's own words, for the screen to show under
 * its plain words. The repository leaves out a line that only points to a
 * guide ("The full rules are in the [EU regulatory guide](...)"), so the
 * guide is reached from here. Each link once, images left out.
 */
export function introLinks(paragraphs: string[]): Array<{ label: string; href: string }> {
  const links: Array<{ label: string; href: string }> = [];
  for (const paragraph of paragraphs) {
    for (const match of paragraph.matchAll(/(!?)\[([^\]\n]+)\]\(([^)\n]*)\)/g)) {
      if (match[1]) continue;
      const href = (match[3].trim().split(/\s+/)[0] ?? '').replace(/^<|>$/g, '');
      const label = match[2].replace(/[*_`]/g, '').trim();
      if (!href || !label || links.some((link) => link.href === href)) continue;
      links.push({ label: label.charAt(0).toUpperCase() + label.slice(1), href });
    }
  }
  return links;
}

/** The first line of plain text, for a card that shows one: the lead line, or the first item of a list. */
export function firstLine(text: string): string {
  const line = text.split('\n').find((each) => each.trim()) ?? '';
  return line.replace(/^-\s+/, '');
}

/** Plain text as blocks to draw: lines, and runs of "- " lines as lists. */
export function plainBlocks(text: string): Array<{ kind: 'line'; text: string } | { kind: 'list'; items: string[] }> {
  const blocks: Array<{ kind: 'line'; text: string } | { kind: 'list'; items: string[] }> = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const item = /^-\s+(.*)$/.exec(line);
    const last = blocks[blocks.length - 1];
    if (item && last?.kind === 'list') last.items.push(item[1]);
    else if (item) blocks.push({ kind: 'list', items: [item[1]] });
    else blocks.push({ kind: 'line', text: line });
  }
  return blocks;
}

/**
 * Where a deadline applies, short: "European Union (EU)" is "EU",
 * "California (USA State)" is "California, USA", "Google Play (Global)" is
 * "Google Play", "Apple App Store (Brazil, Australia)" is "App Store in
 * Brazil and Australia".
 */
export function placeName(jurisdiction: string): string {
  const name = jurisdiction
    .trim()
    .replace(/\bApple App Store\b/g, 'App Store')
    .replace(/\bUnited States\b/g, 'USA')
    .replace(/\bUnited Kingdom\b/g, 'UK');
  const match = /^(.*?)\s*\(([^()]*)\)$/.exec(name);
  if (!match) return name;
  const [, head, inner] = match;
  if (/^(global|worldwide|federal)$/i.test(inner)) return head;
  if (/^usa state$/i.test(inner)) return `${head}, USA`;
  // "European Union (EU)", "UK (UK)": the short name says it all.
  if (/^[A-Z]{2,4}$/.test(inner) && (head === inner || /\b(union|kingdom|states)\b/i.test(head))) return inner;
  const places = inner
    .split(/\s*,\s*/)
    .filter(Boolean)
    .map((place) => (place === 'USA' || place === 'UK' ? `the ${place}` : place));
  const list = places.length > 1 ? `${places.slice(0, -1).join(', ')} and ${places[places.length - 1]}` : places[0];
  return list ? `${head} in ${list}` : head;
}

// Finding rules, deadlines and checklist boxes by their words: the search box
// of Rejection reasons, and the extracts Ask AI sends with a question. Plain
// word matching, here, offline: the playbook is small enough that nothing
// cleverer is needed, and a rule found here is a rule that exists.

import { checklistItems, deadlineDay } from './parse';
import type { Deadline, RejectionRule, RulesLibrary, RuleStore, ShipStore } from './types';

const STOP = new Set(
  'a an and are as at be by can could do does for from get got had has have how i if in into is it its me my need not of on or our should so that the their them then there they this to up us was we what when where which who why will with would you your app apps'.split(' ')
);

/** The words of a text, lower case, with a guideline number such as 5.1.1 kept whole. */
export function termsOf(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().match(/\d+(?:\.\d+)+[a-z]?|[\p{L}\p{N}]+/gu) ?? []) {
    if (STOP.has(raw)) continue;
    // Plurals match their singular: "subscriptions" finds "subscription".
    const word = raw.length > 4 && raw.endsWith('s') && !raw.endsWith('ss') ? raw.slice(0, -1) : raw;
    if (word.length > 1 || /\d/.test(word)) out.push(word);
  }
  return [...new Set(out)];
}

const starts = new Map<string, RegExp>();

/** The term starts a word of the text (so "subscription" finds "subscriptions"). Numbers match anywhere. */
function hits(haystack: string, term: string): boolean {
  if (/^\d/.test(term)) return haystack.includes(term);
  let pattern = starts.get(term);
  if (!pattern) {
    // Every word typed in a search box lands here; a long sitting starts the cache over.
    if (starts.size > 500) starts.clear();
    pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u');
    starts.set(term, pattern);
  }
  return pattern.test(haystack);
}

/** How well a rule matches, 0 when it does not. */
export function scoreRule(rule: RejectionRule, terms: string[]): number {
  if (terms.length === 0) return 0;
  const title = rule.title.toLowerCase();
  const guideline = `${rule.guideline} ${rule.id}`.toLowerCase();
  const body = `${rule.detection} ${rule.fix}`.toLowerCase();
  const code = [...rule.signals, ...rule.counterSignals].join(' ').toLowerCase();
  // The plain words too (plain.ts), so "face scan" finds what the playbook calls biometrics.
  const plainTitle = rule.plain?.title.toLowerCase() ?? '';
  const plainBody = rule.plain ? `${rule.plain.problem} ${rule.plain.fix}`.toLowerCase() : '';
  let score = 0;
  for (const term of terms) {
    if (hits(guideline, term)) score += /^\d/.test(term) ? 8 : 3;
    if (hits(title, term) || hits(plainTitle, term)) score += 4;
    if (hits(body, term) || hits(plainBody, term)) score += 2;
    if (hits(code, term)) score += 1;
  }
  return score;
}

function deadlineText(deadline: Deadline): string {
  const plain = deadline.plain ? ` ${deadline.plain.title} ${deadline.plain.summary}` : '';
  return `${deadline.jurisdiction} ${deadline.law} ${deadline.requirement} ${deadline.id}${plain}`.toLowerCase();
}

export function scoreDeadline(deadline: Deadline, terms: string[]): number {
  const haystack = deadlineText(deadline);
  return terms.reduce((sum, term) => sum + (hits(haystack, term) ? 2 : 0), 0);
}

/**
 * The search box: rules holding every word, best match first. A word that
 * matches nothing is ignored rather than emptying the list, so a typo in a
 * long query still finds the rest.
 */
export function searchRules(rules: RejectionRule[], query: string): RejectionRule[] {
  const terms = termsOf(query);
  if (terms.length === 0) return rules;
  const useful = terms.filter((term) => rules.some((rule) => scoreRule(rule, [term]) > 0));
  if (useful.length === 0) return [];
  return rules
    .map((rule) => ({ rule, score: scoreRule(rule, useful), all: useful.every((term) => scoreRule(rule, [term]) > 0) }))
    .filter((entry) => entry.all)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.rule);
}

export function searchDeadlines(deadlines: Deadline[], query: string): Deadline[] {
  const terms = termsOf(query);
  if (terms.length === 0) return deadlines;
  return deadlines.filter((deadline) => terms.every((term) => hits(deadlineText(deadline), term)));
}

/** A rule applies to an app on these stores. Web rules only when asked for. */
export function ruleForStores(store: RuleStore, stores: ShipStore[]): boolean {
  if (store === 'both') return true;
  if (store === 'web') return false;
  return stores.includes(store);
}

/** Where a deadline applies, read from its jurisdiction: one store, or a law for both. */
export function deadlineStore(deadline: Deadline): ShipStore | null {
  const where = deadline.jurisdiction.toLowerCase();
  if (/apple|app store|ios/.test(where)) return 'apple';
  if (/google|android|play/.test(where)) return 'google';
  return null;
}

/** Deadlines from today on, soonest first, then the ones already in force, newest first. */
export function deadlinesByDay(deadlines: Deadline[], today: string): { coming: Deadline[]; past: Deadline[] } {
  const dated = deadlines.map((deadline) => ({ deadline, day: deadlineDay(deadline) }));
  const coming = dated
    .filter((entry) => entry.day && entry.day >= today)
    .sort((a, b) => a.day!.localeCompare(b.day!))
    .map((entry) => entry.deadline);
  const past = dated
    .filter((entry) => !entry.day || entry.day < today)
    .sort((a, b) => (b.day ?? '').localeCompare(a.day ?? ''))
    .map((entry) => entry.deadline);
  return { coming, past };
}

/** Days from `today` to `day`, both YYYY-MM-DD, negative for the past. */
export function daysUntil(day: string, today: string): number {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export interface Extracts {
  rules: RejectionRule[];
  deadlines: Deadline[];
  checks: string[];
}

/**
 * What Ask AI sends with a question: the rules, deadlines and checklist boxes
 * that share its words, the best first. With few matches it adds the
 * critical rules of the user's stores, so a vague question still gets the
 * rules that matter most.
 */
export function extractsFor(library: RulesLibrary, question: string, stores: ShipStore[], today: string): Extracts {
  const terms = termsOf(question);
  const rules = library.rules
    .filter((rule) => rule.store !== 'web' || /\b(web|website|cookie|pwa)\b/i.test(question))
    .map((rule) => ({ rule, score: scoreRule(rule, terms) + (ruleForStores(rule.store, stores) ? 1 : 0) }))
    .filter((entry) => entry.score > 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, 24)
    .map((entry) => entry.rule);
  if (rules.length < 8) {
    for (const rule of library.rules) {
      if (rules.length >= 12) break;
      if (rule.severity === 'critical' && ruleForStores(rule.store, stores) && !rules.includes(rule)) rules.push(rule);
    }
  }
  const soon = /\b(deadline|soon|next|coming|change|changes|law|laws|legal|date|when|2026|2027|2028)\b/i.test(question);
  const { coming } = deadlinesByDay(library.deadlines, today);
  const deadlines = library.deadlines
    .map((deadline) => ({ deadline, score: scoreDeadline(deadline, terms) }))
    .filter((entry) => entry.score >= 4)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((entry) => entry.deadline);
  if (soon) {
    for (const deadline of coming) {
      if (deadlines.length >= 14) break;
      const store = deadlineStore(deadline);
      if ((!store || stores.includes(store)) && !deadlines.includes(deadline)) deadlines.push(deadline);
    }
  }
  const checks = checklistItems(library.checklist)
    .map((item) => {
      const haystack = `${item.text} ${item.plain ?? ''}`.toLowerCase();
      return { text: item.text, score: terms.reduce((sum, term) => sum + (hits(haystack, term) ? 1 : 0), 0) };
    })
    .filter((entry) => entry.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((entry) => entry.text);
  return { rules, deadlines, checks };
}

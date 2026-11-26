// Finding rules, deadlines and checklist boxes by their words: the search box
// of Rejection reasons, and the extracts Ask AI sends with a question. Plain
// word matching, here, offline: the playbook is small enough that nothing
// cleverer is needed, and a rule found here is a rule that exists.

import { checklistItems, deadlineDay, isMonthOnly } from './parse';
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
  const plainBody = rule.plain ? [rule.plain.problem, rule.plain.fix].filter(Boolean).join(' ').toLowerCase() : '';
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
  const plain = deadline.plain ? ` ${deadline.plain.title} ${deadline.plain.summary ?? ''}` : '';
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
  // A month given without a day may still be ahead until that month is over.
  const ahead = (entry: { deadline: Deadline; day: string | null }) =>
    !!entry.day && (entry.day >= today || (isMonthOnly(entry.deadline, entry.day) && monthsUntil(entry.day, today) === 0));
  const coming = dated
    .filter(ahead)
    .sort((a, b) => a.day!.localeCompare(b.day!))
    .map((entry) => entry.deadline);
  const past = dated
    .filter((entry) => !ahead(entry))
    .sort((a, b) => (b.day ?? '').localeCompare(a.day ?? ''))
    .map((entry) => entry.deadline);
  return { coming, past };
}

/** Days from `today` to `day`, both YYYY-MM-DD, negative for the past. */
export function daysUntil(day: string, today: string): number {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/** Calendar months from the month of `today` to the month of `day`, both YYYY-MM-DD. */
export function monthsUntil(day: string, today: string): number {
  return (Number(day.slice(0, 4)) - Number(today.slice(0, 4))) * 12 + Number(day.slice(5, 7)) - Number(today.slice(5, 7));
}

/** "In 12 days", "Tomorrow", "3 months ago". */
export function fromToday(days: number): string {
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  const ahead = days > 0;
  const span = Math.abs(days);
  const months = Math.round(span / 30.4);
  const amount = span < 45 ? `${span} days` : span < 548 ? `${months} month${months === 1 ? '' : 's'}` : `${Math.round(span / 365)} years`;
  return ahead ? `In ${amount}` : `${amount} ago`;
}

/**
 * The countdown on a deadline, and whether it is close enough to stand out:
 * "In 12 days", "Started 3 months ago". A month given without a day
 * (isMonthOnly) counts to its 1st, the earliest the day can be, and never in
 * days, which would claim a day the source never named: "This month", "Next
 * month", "In 4 months".
 */
export function deadlineCountdown(deadline: Deadline, today: string): { text: string; soon: boolean } | null {
  const day = deadlineDay(deadline);
  if (!day) return null;
  const days = daysUntil(day, today);
  const soon = days >= 0 && days <= 30;
  const count = (value: number) => (value < 0 ? `Started ${fromToday(value).toLowerCase()}` : fromToday(value));
  if (!isMonthOnly(deadline, day)) return { text: count(days), soon };
  const months = monthsUntil(day, today);
  if (months === 0) return { text: 'This month', soon: true };
  if (months === 1) return { text: 'Next month', soon };
  if (months === -1) return { text: 'Started last month', soon: false };
  if (Math.abs(days) >= 45) return { text: count(days), soon };
  // Two months on, but fewer than 45 days to the 1st.
  return { text: 'In 1 month', soon };
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

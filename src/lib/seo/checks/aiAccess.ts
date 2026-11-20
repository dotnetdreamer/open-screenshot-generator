// Copied from github.com/dotnetdreamer/claude-seo osg/checks/aiAccess.ts at da732e65be7f.
// Change it there and run npm run sync:seo-checks. Edits here are lost on the next sync.

// What AI crawlers and agents may read, from robots.txt and the raw page:
// the robots.txt part of scripts/agentic_check.py (RFC 9309 groups, each AI
// user agent's group and whether the site root is open to it) and its
// "server-rendered" check. The agent list and its roles are the script's.

import { parseHtml, textOf, without } from './html';
import { PY_SPACE, pyIgnoreCase, pyIsSpace, pyLen, pyLower, pySplit, pyStrip } from './py';

export type AgentRole = 'training' | 'search' | 'user' | 'control' | 'ads';

export interface AiAgent {
  token: string;
  vendor: string;
  role: AgentRole;
  /** Whether the vendor says the agent follows robots.txt. */
  behaviour: string;
}

export const AI_AGENTS: readonly AiAgent[] = [
  { token: 'GPTBot', vendor: 'OpenAI', role: 'training', behaviour: 'honours' },
  { token: 'OAI-SearchBot', vendor: 'OpenAI', role: 'search', behaviour: 'honours' },
  { token: 'ChatGPT-User', vendor: 'OpenAI', role: 'user', behaviour: 'may not apply' },
  { token: 'OAI-AdsBot', vendor: 'OpenAI', role: 'ads', behaviour: 'see vendor documentation' },
  { token: 'ClaudeBot', vendor: 'Anthropic', role: 'training', behaviour: 'honours' },
  { token: 'Claude-SearchBot', vendor: 'Anthropic', role: 'search', behaviour: 'honours' },
  { token: 'Claude-User', vendor: 'Anthropic', role: 'user', behaviour: 'honours' },
  { token: 'PerplexityBot', vendor: 'Perplexity', role: 'search', behaviour: 'honours' },
  { token: 'Perplexity-User', vendor: 'Perplexity', role: 'user', behaviour: 'generally ignores' },
  { token: 'Google-Extended', vendor: 'Google', role: 'control', behaviour: 'honours' },
  { token: 'Google-Agent', vendor: 'Google', role: 'user', behaviour: 'generally ignores' },
  { token: 'Applebot-Extended', vendor: 'Apple', role: 'control', behaviour: 'honours' },
  { token: 'CCBot', vendor: 'Common Crawl', role: 'training', behaviour: 'honours' },
];

export interface RobotsGroup {
  agents: string[];
  rules: Array<['allow' | 'disallow', string]>;
  contentSignal: string[];
}

export interface ParsedRobots {
  groups: RobotsGroup[];
  sitemaps: string[];
  agentmap: string[];
  orphanContentSignal: string[];
}

/** robots.txt split on CR, LF or CRLF only (RFC 9309), so a U+2028 in a comment stays in the comment. */
export function robotsLines(text: string): string[] {
  const body = text.replace(/^\ufeff+/, '');
  const lines = body.split(/\r\n|\n|\r/);
  if (lines.length && lines[lines.length - 1] === '' && /\r\n|\n|\r/.test(text.slice(-2))) lines.pop();
  return lines;
}

export function parseRobots(text: string): ParsedRobots {
  const groups: RobotsGroup[] = [];
  const parsed: ParsedRobots = { groups, sitemaps: [], agentmap: [], orphanContentSignal: [] };
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const raw of robotsLines(text)) {
    const line = pyStrip(raw.split('#', 1)[0]);
    if (!line || !line.includes(':')) continue;
    const colon = line.indexOf(':');
    const field = pyLower(pyStrip(line.slice(0, colon)));
    const value = pyStrip(line.slice(colon + 1));
    if (field === 'user-agent') {
      if (current === null || !lastWasAgent) {
        current = { agents: [], rules: [], contentSignal: [] };
        groups.push(current);
      }
      current.agents.push(value);
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (field === 'sitemap') parsed.sitemaps.push(value);
    else if (field === 'agentmap') parsed.agentmap.push(value);
    else if (current === null) {
      if (field === 'content-signal') parsed.orphanContentSignal.push(value);
    } else if (field === 'allow' || field === 'disallow') current.rules.push([field, value]);
    else if (field === 'content-signal') current.contentSignal.push(value);
  }
  return parsed;
}

const PRODUCT_TOKEN = /^[A-Za-z_-]+/;

/** The lower case product token of one User-agent value: "*", a name, or "". */
export function productToken(value: string): string {
  const trimmed = pyStrip(value || '');
  if (trimmed === '*') return '*';
  const match = PRODUCT_TOKEN.exec(trimmed);
  return match ? match[0].toLowerCase() : '';
}

function groupNames(group: RobotsGroup, token: string): boolean {
  return group.agents.some((agent) => productToken(agent) === token);
}

export interface SelectedGroup {
  matched: 'named' | 'star' | 'none';
  rules: Array<['allow' | 'disallow', string]>;
  contentSignal: string[];
}

/** RFC 9309: every group naming the token together, else every "*" group. */
export function selectGroup(parsed: ParsedRobots, token: string): SelectedGroup {
  const lower = pyLower(pyStrip(token));
  const named = parsed.groups.filter((group) => groupNames(group, lower));
  const chosen = named.length ? named : parsed.groups.filter((group) => groupNames(group, '*'));
  return {
    matched: named.length ? 'named' : chosen.length ? 'star' : 'none',
    rules: chosen.flatMap((group) => group.rules),
    contentSignal: chosen.flatMap((group) => group.contentSignal),
  };
}

/** RFC 9309 path match: "*" is any run of characters, a final "$" the end. No regex built from the rule. */
export function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  if (!body.includes('*')) return anchored ? path === body : path.startsWith(body);
  const pieces = body.replace(/\*{2,}/g, '*').split('*');
  const first = pieces[0];
  const last = pieces[pieces.length - 1];
  const middle = pieces.slice(1, -1);
  if (!path.startsWith(first)) return false;
  let position = first.length;
  for (const piece of middle) {
    const found = path.indexOf(piece, position);
    if (found < 0) return false;
    position = found + piece.length;
  }
  if (anchored) return path.length - last.length >= position && path.endsWith(last);
  return path.indexOf(last, position) >= 0;
}

/** The longest match wins, allow wins a tie, and an empty disallow allows everything. */
export function isAllowed(rules: SelectedGroup['rules'], path = '/'): boolean {
  let bestLength = -1;
  let allowed = true;
  for (const [field, value] of rules) {
    if (field === 'disallow' && value === '') continue;
    if (patternMatches(value, path)) {
      // len(): code points.
      const length = pyLen(value);
      if (length > bestLength || (length === bestLength && field === 'allow')) {
        bestLength = length;
        allowed = field === 'allow';
      }
    }
  }
  return allowed;
}

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'info';

export interface AgentAccess extends AiAgent {
  group: SelectedGroup['matched'];
  rootAllowed: boolean;
}

export interface RobotsAudit {
  /** Whether robots.txt could be read: "missing" is a 4xx, which allows everything. */
  reachable: 'yes' | 'missing' | 'server-error' | 'rate-limited' | 'failed';
  status: number | null;
  agents: AgentAccess[];
  sitemaps: string[];
  nonstandardUserAgentLines: string[];
  /** robots-ai-groups: warn when an AI search crawler is shut out of the whole site. */
  aiGroups: { status: CheckStatus; namedGroups: string[]; searchCrawlersBlockedAtRoot: string[] };
  /** robots-user-agents: info when an agent a person sends is shut out (several ignore robots.txt anyway). */
  userAgents: { status: CheckStatus; blockedAtRoot: string[] };
}

/** The robots.txt audit for a file that was read (a 2xx answer). */
export function auditRobotsText(text: string): RobotsAudit {
  const parsed = parseRobots(text);
  const agents: AgentAccess[] = AI_AGENTS.map((agent) => {
    const selected = selectGroup(parsed, agent.token);
    return { ...agent, group: selected.matched, rootAllowed: isAllowed(selected.rules, '/') };
  });
  const nonstandard = [...new Set(parsed.groups.flatMap((group) => group.agents)
    .filter((agent) => agent !== '*' && !/^[A-Za-z_-]+$/.test(agent))
    .map((agent) => Array.from(agent).slice(0, 80).join('')))].slice(0, 20);
  const named = agents.filter((agent) => agent.group === 'named').map((agent) => agent.token);
  const blockedSearch = agents.filter((agent) => agent.role === 'search' && !agent.rootAllowed).map((agent) => agent.token);
  const blockedUser = agents.filter((agent) => agent.role === 'user' && !agent.rootAllowed).map((agent) => agent.token);
  return {
    reachable: 'yes',
    status: 200,
    agents,
    sitemaps: parsed.sitemaps,
    nonstandardUserAgentLines: nonstandard,
    aiGroups: {
      status: blockedSearch.length ? 'warn' : named.length ? 'pass' : 'info',
      namedGroups: named,
      searchCrawlersBlockedAtRoot: blockedSearch,
    },
    userAgents: { status: blockedUser.length ? 'info' : 'pass', blockedAtRoot: blockedUser },
  };
}

/**
 * The robots.txt audit for any answer. No file (a 4xx) allows everything;
 * a 5xx tells crawlers to treat the whole site as closed; a 429 says nothing
 * about the file, so it is neither.
 */
export function auditRobots(status: number | null, text: string | null): RobotsAudit {
  if (status !== null && status >= 200 && status < 300) return auditRobotsText(text ?? '');
  const open = auditRobotsText('');
  const reachable: RobotsAudit['reachable'] =
    status === null ? 'failed' : status === 429 ? 'rate-limited' : status >= 500 ? 'server-error' : 'missing';
  if (reachable === 'missing') return { ...open, reachable, status };
  const closed = reachable === 'server-error';
  return {
    ...open,
    reachable,
    status,
    agents: open.agents.map((agent) => ({ ...agent, rootAllowed: !closed })),
  };
}

// --- Content without JavaScript --------------------------------------------

/** Words in the raw HTML, scripts, styles, templates and drawings left out (agentic_check.visible_words). */
export function wordsWithoutJavaScript(html: string): number {
  const dropped = new Set(['script', 'style', 'noscript', 'template', 'svg']);
  const text = textOf(without(parseHtml(html), (el) => dropped.has(el.name)));
  return pySplit(text).length;
}

// The script's patterns, with re.I as Python reads it (py.ts, pyIgnoreCase).
const SHELL_PHRASE = new RegExp(pyIgnoreCase('enable javascript'), 'u');
const SHELL_DIV = new RegExp(pyIgnoreCase('<div'), 'gu');
const SHELL_ID = new RegExp(`${pyIgnoreCase('id=')}["'](${['root', 'app', '__next', '__nuxt'].map(pyIgnoreCase).join('|')})["']`, 'u');
const SHELL_END = new RegExp(`^${pyIgnoreCase('</div>')}`, 'u');

/** Whether the raw HTML looks like an app shell that fills itself in with JavaScript. */
export function jsShellMarker(html: string): boolean {
  if (SHELL_PHRASE.test(html)) return true;
  let position = 0;
  for (;;) {
    SHELL_DIV.lastIndex = position;
    const div = SHELL_DIV.exec(html);
    if (!div) return false;
    const afterDiv = div.index + div[0].length;
    const close = html.indexOf('>', afterDiv);
    if (close < 0) return false;
    // \s*</div> right after the tag, with Python's whitespace and no cap on its length.
    let end = close + 1;
    while (end < html.length && pyIsSpace(html[end])) end++;
    if (SHELL_END.test(html.slice(end, end + 8)) && SHELL_ID.test(html.slice(afterDiv + 1, close))) return true;
    position = close + 1;
  }
}

/** The server-rendered check: fail for an empty shell, warn for a thin page, else pass. */
export function serverRendered(html: string): { status: CheckStatus; words: number; shell: boolean } {
  const words = wordsWithoutJavaScript(html);
  const shell = jsShellMarker(html);
  const status: CheckStatus = words < 50 && shell ? 'fail' : words < 150 ? 'warn' : 'pass';
  return { status, words, shell };
}

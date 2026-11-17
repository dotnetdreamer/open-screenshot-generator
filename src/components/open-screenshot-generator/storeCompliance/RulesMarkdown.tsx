"use client";

// The Markdown of the playbook's guides and of Ask AI's answers, drawn as
// React elements and never as HTML: the text comes from a GitHub repository
// and from a model, so nothing in it may become markup in the app. Covers what
// the playbook uses: headings with GitHub's anchors, paragraphs, nested and
// task lists, tables, code, quotes, rules, and inline bold, italic, code,
// strikethrough and links. HTML tags are dropped and pictures are left out
// (they would load from another site).
//
// Links never navigate the page: every one goes to `onLink`, which opens a
// guide inside the view, scrolls to a heading or opens the browser.

import React, { useMemo } from 'react';
import { anchorOf } from '@/lib/storeCompliance/parse';
import { cn } from '@/lib/utils';

type Align = 'left' | 'center' | 'right' | null;

interface ListItem {
  task: boolean | null;
  blocks: Block[];
}

export type Block =
  | { kind: 'heading'; level: number; text: string; id: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { kind: 'code'; text: string }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'table'; align: Align[]; head: string[]; rows: string[][] }
  | { kind: 'rule' };

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?/;
const MARKER = /^(\s*)([-*+]|\d{1,9}[.)])(\s+|$)/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const HTML_LINE = /^\s*<\/?[a-zA-Z][^>]*>\s*$/;

function indentOf(line: string): number {
  return /^\s*/.exec(line)![0].replace(/\t/g, '    ').length;
}

function isBlank(line: string): boolean {
  return line.trim() === '';
}

function marker(line: string): { indent: number; width: number; ordered: boolean; start: number } | null {
  const match = MARKER.exec(line);
  if (!match) return null;
  const ordered = /\d/.test(match[2]);
  return { indent: match[1].length, width: match[0].length, ordered, start: ordered ? parseInt(match[2], 10) : 1 };
}

function startsBlock(line: string, next?: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || !!marker(line) || (line.includes('|') && !!next && TABLE_RULE.test(next));
}

function cells(line: string): string[] {
  let body = line.trim();
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|') && !body.endsWith('\\|')) body = body.slice(0, -1);
  // Split on the pipes that are not escaped (no lookbehind: older WebKit lacks it).
  const out: string[] = [];
  let cell = '';
  for (let at = 0; at < body.length; at++) {
    if (body[at] === '\\' && body[at + 1] === '|') {
      cell += '|';
      at++;
    } else if (body[at] === '|') {
      out.push(cell.trim());
      cell = '';
    } else {
      cell += body[at];
    }
  }
  out.push(cell.trim());
  return out;
}

/** Strip front matter and comments, and split into lines. */
export function markdownSource(source: string): string[] {
  let body = source.replace(/\r\n?/g, '\n');
  if (body.startsWith('---\n')) {
    const end = body.indexOf('\n---', 4);
    if (end !== -1) body = body.slice(body.indexOf('\n', end + 1) + 1);
  }
  return body
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n');
}

export function parseBlocks(lines: string[], anchors: Map<string, number> = new Map()): Block[] {
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (isBlank(line) || HTML_LINE.test(line)) {
      index++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const close = new RegExp(`^\\s{0,3}${fence[1][0] === '`' ? '`' : '~'}{${fence[1].length},}\\s*$`);
      const body: string[] = [];
      index++;
      while (index < lines.length && !close.test(lines[index])) body.push(lines[index++]);
      index++;
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    const head = HEADING.exec(line);
    if (head) {
      const text = head[2];
      const base = anchorOf(plainText(text));
      const seen = anchors.get(base) ?? 0;
      anchors.set(base, seen + 1);
      blocks.push({ kind: 'heading', level: head[1].length, text, id: seen ? `${base}-${seen}` : base });
      index++;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' });
      index++;
      continue;
    }
    if (line.includes('|') && index + 1 < lines.length && TABLE_RULE.test(lines[index + 1])) {
      const head = cells(line);
      const align = cells(lines[index + 1]).map((cell): Align => {
        const left = cell.startsWith(':');
        const right = cell.endsWith(':');
        return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
      });
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && !isBlank(lines[index]) && lines[index].includes('|')) rows.push(cells(lines[index++]));
      blocks.push({ kind: 'table', align, head, rows });
      continue;
    }
    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (index < lines.length && !isBlank(lines[index]) && (QUOTE.test(lines[index]) || !startsBlock(lines[index]))) {
        inner.push(lines[index++].replace(QUOTE, ''));
      }
      blocks.push({ kind: 'quote', blocks: parseBlocks(inner, anchors) });
      continue;
    }
    const first = marker(line);
    if (first) {
      const items: ListItem[] = [];
      while (index < lines.length) {
        const item = marker(lines[index]);
        if (!item || item.indent !== first.indent || item.ordered !== first.ordered) break;
        const content = item.indent + item.width;
        const body = [lines[index].slice(content)];
        index++;
        while (index < lines.length) {
          const next = lines[index];
          if (isBlank(next)) {
            let ahead = index;
            while (ahead < lines.length && isBlank(lines[ahead])) ahead++;
            if (ahead < lines.length && indentOf(lines[ahead]) >= content) {
              body.push('');
              index++;
              continue;
            }
            break;
          }
          const nested = marker(next);
          if (nested && nested.indent <= first.indent) break;
          if (indentOf(next) > first.indent || (!nested && !startsBlock(next))) {
            body.push(next.slice(Math.min(indentOf(next), content)));
            index++;
            continue;
          }
          break;
        }
        const task = /^\[([ xX])\]\s+/.exec(body[0]);
        if (task) body[0] = body[0].slice(task[0].length);
        items.push({ task: task ? task[1] !== ' ' : null, blocks: parseBlocks(body, anchors) });
        while (index < lines.length && isBlank(lines[index])) {
          const after = lines.slice(index).find((candidate) => !isBlank(candidate));
          const again = after ? marker(after) : null;
          if (!again || again.indent !== first.indent || again.ordered !== first.ordered) break;
          index++;
        }
      }
      blocks.push({ kind: 'list', ordered: first.ordered, start: first.start, items });
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && !isBlank(lines[index]) && !HTML_LINE.test(lines[index]) && !(paragraph.length > 0 && startsBlock(lines[index], lines[index + 1]))) {
      paragraph.push(lines[index++].trim());
    }
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
    else index++;
  }
  return blocks;
}

/** A heading's words without their marks, for its anchor and the contents list. */
export function plainText(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[*_~`]/g, '')
    .replace(/\\(.)/g, '$1')
    .trim();
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™', hellip: '…' };

/** A character by number, or the replacement mark when the number names none (fromCodePoint throws on those). */
function character(code: number): string {
  const valid = Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
  return String.fromCodePoint(valid ? code : 0xfffd);
}

function entity(match: string, body: string): string {
  if (body.startsWith('#x') || body.startsWith('#X')) return character(parseInt(body.slice(2), 16));
  if (body.startsWith('#')) return character(parseInt(body.slice(1), 10));
  return ENTITIES[body.toLowerCase()] ?? match;
}

export interface InlineOptions {
  onLink?: (href: string) => void;
  /** A bracketed id such as [APPLE-2.1-MISSING-DEMO-ACCOUNT]; return a node to draw it, or null for the text. */
  token?: (id: string) => React.ReactNode | null;
}

const TOKEN = /^\[([A-Z][A-Z0-9]*(?:-[A-Z0-9.()]+)+)\]/;
const EMPHASIS: Array<{ pattern: RegExp; tag: 'strong' | 'em' | 'del' }> = [
  { pattern: /^\*\*(?=\S)([\s\S]*?\S)\*\*/, tag: 'strong' },
  { pattern: /^__(?=\S)([\s\S]*?\S)__(?![\p{L}\p{N}])/u, tag: 'strong' },
  { pattern: /^\*(?=[^\s*])([\s\S]*?[^\s*])\*(?!\*)/, tag: 'em' },
  { pattern: /^_(?=[^\s_])([\s\S]*?[^\s_])_(?![\p{L}\p{N}])/u, tag: 'em' },
  { pattern: /^~~(?=\S)([\s\S]*?\S)~~/, tag: 'del' },
];

/** Where a link's text ends, allowing brackets inside it. */
function closingBracket(text: string, open: number): number {
  let depth = 0;
  for (let at = open; at < text.length; at++) {
    if (text[at] === '\\') at++;
    else if (text[at] === '[') depth++;
    else if (text[at] === ']' && --depth === 0) return at;
  }
  return -1;
}

export function renderInline(text: string, options: InlineOptions, key = 'i'): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let plain = '';
  let count = 0;
  const flush = () => {
    if (plain) out.push(plain);
    plain = '';
  };
  const push = (node: React.ReactNode) => {
    flush();
    out.push(<React.Fragment key={`${key}-${count++}`}>{node}</React.Fragment>);
  };
  let at = 0;
  while (at < text.length) {
    const rest = text.slice(at);
    const char = text[at];
    if (char === '\\' && at + 1 < text.length && /[\\`*_{}[\]()#+\-.!|~<>]/.test(text[at + 1])) {
      plain += text[at + 1];
      at += 2;
      continue;
    }
    if (char === '`') {
      const run = /^`+/.exec(rest)![0];
      const end = text.indexOf(run, at + run.length);
      if (end !== -1) {
        push(<code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{text.slice(at + run.length, end).trim()}</code>);
        at = end + run.length;
        continue;
      }
    }
    if (char === '!' && text[at + 1] === '[') {
      const close = closingBracket(text, at + 1);
      const target = close !== -1 && text[close + 1] === '(' ? text.indexOf(')', close) : -1;
      if (target !== -1) {
        // Pictures load from other sites, so they are left out.
        at = target + 1;
        continue;
      }
    }
    if (char === '[') {
      const token = options.token ? TOKEN.exec(rest) : null;
      if (token && text[at + token[0].length] !== '(') {
        const node = options.token!(token[1]);
        if (node) {
          push(node);
          at += token[0].length;
          continue;
        }
      }
      const close = closingBracket(text, at);
      if (close !== -1 && text[close + 1] === '(') {
        const end = text.indexOf(')', close + 2);
        if (end !== -1) {
          const href = text.slice(close + 2, end).trim().split(/\s+/)[0].replace(/^<|>$/g, '');
          const label = renderInline(text.slice(at + 1, close), options, `${key}-${count}`);
          push(<InlineLink href={href} onLink={options.onLink}>{label}</InlineLink>);
          at = end + 1;
          continue;
        }
      }
    }
    if (char === '<') {
      const auto = /^<(https?:\/\/[^\s>]+)>/.exec(rest);
      if (auto) {
        push(<InlineLink href={auto[1]} onLink={options.onLink}>{auto[1]}</InlineLink>);
        at += auto[0].length;
        continue;
      }
      const tag = /^<\/?[a-zA-Z][^>]*>/.exec(rest);
      if (tag) {
        if (/^<br\s*\/?>/i.test(tag[0])) push(<br />);
        at += tag[0].length;
        continue;
      }
    }
    if (char === '&') {
      const named = /^&(#\d+|#x[0-9a-f]+|[a-z]+);/i.exec(rest);
      if (named) {
        plain += entity(named[0], named[1]);
        at += named[0].length;
        continue;
      }
    }
    if (char === '*' || char === '_' || char === '~') {
      const before = at > 0 ? text[at - 1] : ' ';
      // An underscore inside a word (snake_case) is a letter.
      if (!(char === '_' && /[\p{L}\p{N}]/u.test(before))) {
        const match = EMPHASIS.map((entry) => ({ entry, found: entry.pattern.exec(rest) })).find((candidate) => candidate.found);
        if (match?.found) {
          const Tag = match.entry.tag;
          push(<Tag className={Tag === 'strong' ? 'font-semibold' : undefined}>{renderInline(match.found[1], options, `${key}-${count}`)}</Tag>);
          at += match.found[0].length;
          continue;
        }
      }
    }
    if ((char === 'h' || char === 'H') && (at === 0 || /[\s(]/.test(text[at - 1]))) {
      const bare = /^https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/i.exec(rest);
      if (bare) {
        push(<InlineLink href={bare[0]} onLink={options.onLink}>{bare[0]}</InlineLink>);
        at += bare[0].length;
        continue;
      }
    }
    plain += char;
    at++;
  }
  flush();
  return out;
}

function InlineLink({ href, onLink, children }: { href: string; onLink?: (href: string) => void; children: React.ReactNode }) {
  if (!onLink) return <span className="underline decoration-muted-foreground/40 underline-offset-2">{children}</span>;
  return (
    <a
      href={/^https?:/i.test(href) ? href : '#'}
      className="font-medium text-[hsl(var(--rules-accent))] underline decoration-[hsl(var(--rules-accent))]/30 underline-offset-2 hover:decoration-[hsl(var(--rules-accent))]"
      onClick={(event) => {
        event.preventDefault();
        onLink(href);
      }}
    >
      {children}
    </a>
  );
}

const HEADING_CLASS: Record<number, string> = {
  1: 'mb-4 text-2xl font-semibold tracking-tight',
  2: 'mb-3 mt-10 border-b pb-2 text-xl font-semibold tracking-tight',
  3: 'mb-2 mt-7 text-base font-semibold',
  4: 'mb-2 mt-5 text-sm font-semibold',
  5: 'mb-1 mt-4 text-sm font-semibold text-muted-foreground',
  6: 'mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground',
};

function BlockView({ block, options, tight, prefix = '' }: { block: Block; options: InlineOptions; tight?: boolean; prefix?: string }) {
  switch (block.kind) {
    case 'heading': {
      const Tag = `h${Math.min(block.level + 1, 6)}` as 'h2';
      return (
        <Tag id={`${prefix}${block.id}`} data-anchor={block.id} className={cn('scroll-mt-4 first:mt-0', HEADING_CLASS[block.level])}>
          {renderInline(block.text, options)}
        </Tag>
      );
    }
    case 'paragraph':
      return <p className={cn('leading-relaxed', tight ? 'my-0' : 'my-3')}>{renderInline(block.text, options)}</p>;
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      const tasks = block.items.some((item) => item.task !== null);
      return (
        <Tag start={block.ordered && block.start !== 1 ? block.start : undefined} className={cn('my-3 space-y-1.5', tasks ? 'list-none pl-0' : block.ordered ? 'list-decimal pl-6' : 'list-disc pl-5', 'marker:text-muted-foreground')}>
          {block.items.map((item, index) => (
            <li key={index} className={cn('leading-relaxed', tasks && 'flex gap-2')}>
              {item.task !== null && (
                <span
                  aria-hidden
                  className={cn(
                    'mt-1 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border text-[9px]',
                    item.task ? 'border-[hsl(var(--rules-accent))] bg-[hsl(var(--rules-accent))] text-white' : 'border-muted-foreground/50'
                  )}
                >
                  {item.task ? '✓' : ''}
                </span>
              )}
              <div className="min-w-0">
                {item.blocks.map((child, childIndex) => (
                  <BlockView key={childIndex} block={child} options={options} prefix={prefix} tight={item.blocks.length === 1 || child.kind !== 'paragraph'} />
                ))}
              </div>
            </li>
          ))}
        </Tag>
      );
    }
    case 'code':
      return <pre className="my-4 overflow-x-auto rounded-lg border bg-muted/60 p-3 font-mono text-xs leading-relaxed text-foreground">{block.text}</pre>;
    case 'quote':
      return (
        <blockquote className="my-4 border-l-2 border-[hsl(var(--rules-accent))]/50 pl-4 text-muted-foreground">
          {block.blocks.map((child, index) => (
            <BlockView key={index} block={child} options={options} prefix={prefix} />
          ))}
        </blockquote>
      );
    case 'table':
      return (
        <div className="my-4 overflow-x-auto rounded-lg border">
          <table className="w-full border-collapse text-left text-[13px]">
            {/* The app's global table styles colour every thead and stripe every row; these classes put the card's colours back. */}
            <thead className="bg-muted/60 text-foreground">
              <tr className="border-b">
                {block.head.map((cell, index) => (
                  <th key={index} className="px-3 py-2 font-semibold" style={{ textAlign: block.align[index] ?? undefined }}>
                    {renderInline(cell, options)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b align-top last:border-b-0 even:bg-muted/25">
                  {block.head.map((_, index) => (
                    <td key={index} className="px-3 py-2 leading-relaxed" style={{ textAlign: block.align[index] ?? undefined }}>
                      {renderInline(row[index] ?? '', options)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'rule':
      return <hr className="my-6 border-border" />;
  }
}

export function useMarkdown(source: string): Block[] {
  return useMemo(() => parseBlocks(markdownSource(source)), [source]);
}

/** `anchorPrefix` goes in front of every heading's id, so a guide's anchors cannot clash with the app's own ids. */
export function RulesMarkdown({ blocks, className, anchorPrefix, ...options }: { blocks: Block[]; className?: string; anchorPrefix?: string } & InlineOptions) {
  return (
    <div className={cn('text-sm text-foreground', className)}>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} options={options} prefix={anchorPrefix} />
      ))}
    </div>
  );
}

/** One line of Markdown, such as a checklist box. */
export function InlineMarkdown({ text, ...options }: { text: string } & InlineOptions) {
  return <>{renderInline(text, options)}</>;
}

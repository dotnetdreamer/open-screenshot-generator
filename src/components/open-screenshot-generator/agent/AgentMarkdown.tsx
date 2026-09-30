"use client";

// Just enough Markdown for an agent's replies: paragraphs, lists, headings,
// code, bold, italic and links. Built as React elements, never as HTML, so
// nothing the model writes can inject markup into the editor.

import React from 'react';
import { openExternal } from '@/lib/desktop';
import { cn } from '@/lib/utils';

type Block =
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'heading'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; text: string };

function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', lines: paragraph });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ kind: 'list', ...list });
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*```/.exec(line);
    if (fence) {
      flushParagraph();
      flushList();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ kind: 'heading', text: heading[1] });
      continue;
    }
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = !!numbered;
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) {
      // A wrapped list item.
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|\[[^\]]+\]\([^)\s]+\))/g;

/**
 * Stands in for an underscore inside a word while the line is tokenised.
 * Markdown leaves those alone, so a reply naming apply_template must not have
 * "template" turned into italics. A lookbehind would say the same thing in the
 * pattern, but older macOS WebKit rejects lookbehind outright.
 */
const INTRAWORD = '\uE000';

type OpenLink = (url: string) => void;

function renderInline(source: string, keyPrefix: string, onOpenLink: OpenLink): React.ReactNode[] {
  const text = source.replace(/([A-Za-z0-9])_(?=[A-Za-z0-9])/g, `$1${INTRAWORD}`);
  const restore = (value: string) => value.split(INTRAWORD).join('_');
  const out: React.ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(INLINE)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > last) out.push(restore(text.slice(last, start)));
    const key = `${keyPrefix}-${index++}`;
    if (token.startsWith('`')) {
      out.push(
        <code key={key} className="rounded bg-muted px-1 py-px font-mono text-[0.85em]">
          {restore(token.slice(1, -1))}
        </code>
      );
    } else if (token.startsWith('**') || token.startsWith('__')) {
      out.push(<strong key={key}>{restore(token.slice(2, -2))}</strong>);
    } else if (token.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      const href = link ? restore(link[2]) : '';
      if (link && /^https?:\/\//i.test(href)) {
        out.push(
          <a
            key={key}
            href={href}
            className="text-primary underline underline-offset-2"
            onClick={(event) => {
              // A webview ignores target=_blank, and navigating the editor
              // away would lose the project.
              event.preventDefault();
              onOpenLink(href);
            }}
          >
            {restore(link[1])}
          </a>
        );
      } else {
        out.push(restore(link?.[1] ?? token));
      }
    } else {
      out.push(<em key={key}>{restore(token.slice(1, -1))}</em>);
    }
    last = start + token.length;
  }
  if (last < text.length) out.push(restore(text.slice(last)));
  return out;
}

export function AgentMarkdown({
  text,
  className,
  onOpenLink = (url) => void openExternal(url),
}: {
  text: string;
  className?: string;
  /** Where a clicked link goes. A detached panel window hands it to the editor. */
  onOpenLink?: OpenLink;
}) {
  const blocks = parseBlocks(text);
  return (
    <div className={cn('space-y-2 break-words text-[13px] leading-relaxed', className)}>
      {blocks.map((block, i) => {
        const key = `b${i}`;
        switch (block.kind) {
          case 'heading':
            return (
              <p key={key} className="font-semibold">
                {renderInline(block.text, key, onOpenLink)}
              </p>
            );
          case 'code':
            return (
              <pre key={key} className="overflow-x-auto rounded-md bg-muted px-2.5 py-2 font-mono text-[11.5px] leading-snug">
                <code>{block.text}</code>
              </pre>
            );
          case 'list': {
            const ListTag = block.ordered ? 'ol' : 'ul';
            return (
              <ListTag key={key} className={cn('space-y-0.5 pl-4', block.ordered ? 'list-decimal' : 'list-disc')}>
                {block.items.map((item, j) => (
                  <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`, onOpenLink)}</li>
                ))}
              </ListTag>
            );
          }
          default:
            return (
              <p key={key}>
                {block.lines.map((line, j) => (
                  <React.Fragment key={`${key}-${j}`}>
                    {j > 0 && <br />}
                    {renderInline(line, `${key}-${j}`, onOpenLink)}
                  </React.Fragment>
                ))}
              </p>
            );
        }
      })}
    </div>
  );
}

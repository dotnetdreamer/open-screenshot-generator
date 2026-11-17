"use client";

// Guides: the playbook's own documents, listed in the groups of its
// docs/index.md and read here. A guide is downloaded the first time it is
// opened and kept on this computer (readGuide in sync.ts), so it opens again
// offline. Links between guides open the other guide here, a link to a
// heading scrolls to it, and a web address opens in the browser.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftIcon, BookOpenIcon, ExternalLinkIcon, ListChecksIcon, Loader2Icon, RefreshCwIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { openExternal } from '@/lib/desktop';
import { filePageUrl } from '@/lib/storeCompliance/source';
import { readGuide, type GuideRead } from '@/lib/storeCompliance/sync';
import type { GuideLink } from '@/lib/storeCompliance/types';
import { cn } from '@/lib/utils';
import { plainText, RulesMarkdown, useMarkdown } from './RulesMarkdown';
import { CHECKLIST_PATH, EmptyState, useGuideLinks, useRulesView } from './StoreComplianceShared';

const ANCHOR_PREFIX = 'guide-';

function titleFromPath(path: string): string {
  const name = path.replace(/^.*\//, '').replace(/\.md$/i, '').replace(/[-_]+/g, ' ').toLowerCase();
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function Reader({ path, anchor, onBack }: { path: string; anchor?: string; onBack: () => void }) {
  const view = useRulesView();
  const [read, setRead] = useState<GuideRead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const top = useRef<HTMLDivElement>(null);
  const guide = view.library.guides.flatMap((group) => group.guides).find((entry) => entry.path === path);
  const title = guide?.title ?? titleFromPath(path);
  const followLink = useGuideLinks(path);

  useEffect(() => {
    let live = true;
    setRead(null);
    setError(null);
    readGuide(path)
      .then((result) => live && setRead(result))
      .catch((failure) => {
        console.error('Reading a guide failed', failure);
        if (live) setError(failure instanceof TypeError ? "Can't reach GitHub to get this guide. Check your internet connection, then try again." : "GitHub didn't send this guide. Try again in a minute.");
      });
    return () => {
      live = false;
    };
  }, [path, attempt]);

  const blocks = useMarkdown(read?.file.text ?? '');
  const contents = useMemo(() => blocks.filter((block): block is Extract<typeof block, { kind: 'heading' }> => block.kind === 'heading' && (block.level === 2 || block.level === 3)), [blocks]);

  // Land on the heading a link asked for, once the guide is drawn.
  useEffect(() => {
    if (!read) return;
    if (anchor) window.requestAnimationFrame(() => document.getElementById(`${ANCHOR_PREFIX}${anchor}`)?.scrollIntoView({ block: 'start' }));
    else top.current?.scrollIntoView({ block: 'start' });
  }, [read, anchor]);

  const onLink = (href: string) => {
    if (href.startsWith('#')) {
      document.getElementById(`${ANCHOR_PREFIX}${href.slice(1)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    followLink(href);
  };

  return (
    <div ref={top} className="mx-auto flex max-w-6xl gap-8 p-4 md:p-6" data-testid="store-compliance-guide">
      <article className="min-w-0 flex-1">
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" className="-ml-2 h-8 gap-1.5" onClick={onBack}>
            <ArrowLeftIcon className="h-3.5 w-3.5" />
            All guides
          </Button>
          <Button variant="ghost" size="sm" className="ml-auto h-8 gap-1.5 text-muted-foreground" onClick={() => void openExternal(filePageUrl(path))}>
            <ExternalLinkIcon className="h-3.5 w-3.5" />
            Open on GitHub
          </Button>
        </div>
        {read?.stale && (
          <p className="mb-4 rounded-lg border border-[hsl(var(--rules-medium))]/30 bg-[hsl(var(--rules-medium))]/10 px-3 py-2 text-xs text-[hsl(var(--rules-medium))]">
            GitHub has a newer copy of this guide that couldn&apos;t be downloaded. Showing the copy saved on this computer.
          </p>
        )}
        {error ? (
          <EmptyState icon={BookOpenIcon} title={`Couldn't download ${title}`}>
            <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
            <Button size="sm" className="gap-1.5" onClick={() => setAttempt((count) => count + 1)}>
              <RefreshCwIcon className="h-3.5 w-3.5" />
              Try again
            </Button>
          </EmptyState>
        ) : !read ? (
          <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground" role="status">
            <Loader2Icon className="h-4 w-4 animate-spin" />
            Downloading {title} from GitHub
          </p>
        ) : (
          <RulesMarkdown blocks={blocks} anchorPrefix={ANCHOR_PREFIX} onLink={onLink} className="max-w-3xl [&_h2:first-child]:mt-0" />
        )}
      </article>
      {read && contents.length > 2 && (
        <nav aria-label="In this guide" className="sticky top-6 hidden max-h-[calc(100vh-10rem)] w-60 shrink-0 self-start overflow-y-auto xl:block">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">In this guide</p>
          <ul className="space-y-1 border-l">
            {contents.map((heading) => (
              <li key={heading.id}>
                <button
                  type="button"
                  className={cn('-ml-px block w-full border-l border-transparent py-0.5 text-left text-xs text-muted-foreground hover:border-foreground hover:text-foreground', heading.level === 2 ? 'pl-3' : 'pl-6')}
                  onClick={() => document.getElementById(`${ANCHOR_PREFIX}${heading.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                >
                  {plainText(heading.text)}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}

function GuideCard({ guide, onOpen }: { guide: GuideLink; onOpen: () => void }) {
  const checklist = guide.path === CHECKLIST_PATH;
  const Icon = checklist ? ListChecksIcon : BookOpenIcon;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-guide={guide.path}
      className="group flex items-start gap-3 rounded-xl border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--rules-accent))]/10 text-[hsl(var(--rules-accent))]">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-snug">{guide.title}</span>
        {guide.description && <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{guide.description}</span>}
      </span>
    </button>
  );
}

export function StoreComplianceGuides() {
  const view = useRulesView();
  const { library, options } = view;
  const [open, setOpen] = useState<{ path: string; anchor?: string } | null>(options.guide ? { path: options.guide, anchor: options.anchor } : null);

  if (open) return <Reader path={open.path} anchor={open.anchor} onBack={() => setOpen(null)} />;

  if (library.guides.length === 0) {
    return (
      <EmptyState icon={BookOpenIcon} title="No guides yet">
        <p className="max-w-sm text-sm text-muted-foreground">The playbook on GitHub lists no guides right now.</p>
      </EmptyState>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4 md:p-6" data-testid="store-compliance-guides">
      {library.guides.map((group) => (
        <section key={group.title} aria-label={group.title}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.guides.map((guide) => (
              <GuideCard key={guide.path} guide={guide} onOpen={() => (guide.path === CHECKLIST_PATH ? view.goTo('checklist') : setOpen({ path: guide.path }))} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

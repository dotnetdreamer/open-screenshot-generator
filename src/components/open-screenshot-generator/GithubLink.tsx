"use client";

// The link to the source, and the mark that goes on it.
//
// lucide dropped its brand icons, so the GitHub mark is inline here the same
// way the account dialog carries its provider marks: no network image to fetch,
// and it inherits currentColor so it reads on either ground.
//
// The anchor is a real anchor (middle-click, copy link address, the browser's
// own affordances) with a desktop escape hatch: a WebView ignores
// target="_blank" and would swallow the navigation, so on Tauri the click is
// cancelled and handed to the system browser instead.

import React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { isTauri, openExternal } from '@/lib/desktop';

export const REPO_URL = 'https://github.com/dotnetdreamer/open-screenshot-generator';

export function GithubMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      className={cn('h-4 w-4', className)}
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/**
 * Icon-only by default, like every other control on the toolbar row it sits
 * on. Pass a label to get a labelled button instead.
 */
export function GithubLinkButton({
  className,
  label,
  title = 'Open Screenshot Generator on GitHub, star it or report an issue',
}: {
  className?: string;
  label?: string;
  title?: string;
}) {
  return (
    <Button variant="outline" asChild className={cn('h-8 shrink-0 gap-1.5', className)}>
      <a
        href={REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        title={title}
        aria-label={label ?? title}
        onClick={(event) => {
          if (isTauri()) {
            event.preventDefault();
            void openExternal(REPO_URL);
          }
        }}
      >
        <GithubMark />
        {label && <span className="text-sm">{label}</span>}
      </a>
    </Button>
  );
}

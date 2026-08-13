"use client";

// "This font is only on this machine."
//
// An imported font lives in IndexedDB, not in the design, so a project that
// uses one is one cleared browser away from losing its typography. The project
// JSON and the account save both carry the file (see lib/account/projectBundle),
// and nothing else does. This says so, at the point where the project actually
// depends on it.
//
// Sticky rather than a toast: the risk lasts as long as the project does, and a
// message that vanishes in four seconds is not a backup prompt.

import { useEffect, useState } from 'react';
import { AlertTriangleIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const DISMISSED_KEY = 'open-screenshot-generator.local-font-notice-dismissed';
/** Enough to cover a working library without growing localStorage forever. */
const MAX_REMEMBERED = 50;

function readDismissed(): string[] {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function rememberDismissed(projectId: string): void {
  try {
    const next = [...readDismissed().filter((id) => id !== projectId), projectId];
    window.localStorage.setItem(
      DISMISSED_KEY,
      JSON.stringify(next.slice(Math.max(0, next.length - MAX_REMEMBERED)))
    );
  } catch {
    // Storage blocked (private mode). The dismissal holds for this session.
  }
}

interface LocalFontNoticeProps {
  /** Imported families the open project's text actually uses. */
  families: string[];
  /** Dismissal is remembered per project: each project can be lost separately. */
  projectId: string | null;
  onExportJson: () => void;
  className?: string;
}

export function LocalFontNotice({ families, projectId, onExportJson, className }: LocalFontNoticeProps) {
  // Starts hidden so the bar cannot flash in before storage has been read, and
  // so it never renders during SSR.
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(projectId ? readDismissed().includes(projectId) : false);
  }, [projectId]);

  if (dismissed || families.length === 0) return null;

  const [first, ...rest] = families;
  const label = rest.length === 0 ? first : `${first} and ${rest.length} more`;
  const many = rest.length > 0;

  const handleDismiss = () => {
    setDismissed(true);
    if (projectId) rememberDismissed(projectId);
  };

  return (
    <div
      role="status"
      className={cn(
        'flex items-start gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2',
        'text-xs text-amber-700 dark:text-amber-400',
        className
      )}
    >
      <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <p className="flex-1 leading-relaxed">
        <span className="font-medium">{label}</span> {many ? 'live' : 'lives'} in this browser, not in the
        project. Export as JSON or save to your account so {many ? 'they travel' : 'it travels'} with it
      </p>
      <Button
        variant="outline"
        size="sm"
        className="h-7 shrink-0 border-amber-500/40 bg-transparent px-2 text-xs hover:bg-amber-500/20"
        onClick={onExportJson}
      >
        Export JSON
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 hover:bg-amber-500/20"
        onClick={handleDismiss}
        title="Dismiss"
        aria-label="Dismiss this notice"
      >
        <XIcon className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

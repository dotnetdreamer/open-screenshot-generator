"use client";

// The Growth browser beside the Ask AI chat: a toolbar drawn here, and below
// it the box the browser itself (growth_browser.rs) is placed over.
//
// The browser is a native view on top of the window, so nothing drawn in the
// page can cover it. While a menu, a list or a dialog would open over the box,
// the browser steps aside (`covered`), and the toasts move to the left while
// it shows (globals.css). On Linux the browser has a window of its own and
// the box says so.

import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ExternalLinkIcon,
  HandIcon,
  KeyRoundIcon,
  Loader2Icon,
  LockIcon,
  RotateCwIcon,
  ShieldAlertIcon,
  SparklesIcon,
  XIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { openExternal } from '@/lib/desktop';
import {
  allowSite,
  browserState,
  closeBrowser,
  navigate,
  setPane,
  subscribeBrowser,
  type BrowserState,
} from '@/lib/growth/setup/browser';
import type { AssistantPhase } from '@/lib/growth/setup/assistant';
import { cn } from '@/lib/utils';

const CLOSED_SERVER: BrowserState = { open: false, embedded: true, url: null, title: null, loading: false, blocked: null, refused: null };

export function useBrowser(): BrowserState {
  return useSyncExternalStore(subscribeBrowser, browserState, () => CLOSED_SERVER);
}

/** Menus, lists and dialogs that open over the page, as Radix draws them. */
const OVERLAYS =
  '[data-radix-popper-content-wrapper], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-radix-dialog-overlay][data-state="open"]';

function covered(box: DOMRect): boolean {
  for (const overlay of Array.from(document.querySelectorAll(OVERLAYS))) {
    const rect = overlay.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.right > box.left && rect.left < box.right && rect.bottom > box.top && rect.top < box.bottom) return true;
  }
  return false;
}

/** Apple's and Google's sign-in pages, where passkeys cannot work. */
function signInPage(url: string | null): boolean {
  try {
    const parsed = new URL(url ?? '');
    return (
      (parsed.hostname === 'appstoreconnect.apple.com' && parsed.pathname.startsWith('/login')) ||
      parsed.hostname === 'idmsa.apple.com' ||
      parsed.hostname === 'accounts.google.com'
    );
  } catch {
    return false;
  }
}

function splitAddress(url: string | null): { host: string; rest: string } {
  try {
    const parsed = new URL(url ?? '');
    return { host: parsed.hostname, rest: `${parsed.pathname}${parsed.search}`.replace(/\/$/, '') };
  } catch {
    return { host: '', rest: '' };
  }
}

export interface GrowthBrowserPaneProps {
  /** The pane is on screen: Growth shows, on Ask AI, with the browser side picked. */
  shown: boolean;
  phase: AssistantPhase;
  /** What the running step says, while the assistant acts. */
  activity: string | null;
  /** What the assistant waits for the user to do, while it waits. */
  waitingFor: string | null;
  /** The button beside it: Done for a step in the browser, the file picker for a key file. */
  waitAction: { label: string; run: () => void } | null;
  className?: string;
}

export function GrowthBrowserPane({ shown, phase, activity, waitingFor, waitAction, className }: GrowthBrowserPaneProps) {
  const browser = useBrowser();
  const box = useRef<HTMLDivElement>(null);

  // The browser follows the box: its place, its size, and whether it shows.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect();
        const visible = shown && rect.width > 40 && rect.height > 40 && !covered(rect);
        setPane(rect, visible);
        if (visible && browserState().open && browserState().embedded) document.documentElement.setAttribute('data-growth-browser', '');
        else document.documentElement.removeAttribute('data-growth-browser');
      });
    };
    const resize = new ResizeObserver(measure);
    resize.observe(element);
    window.addEventListener('resize', measure);
    // Portals land on <body>; Radix flips data-state when one opens or closes.
    const overlays = new MutationObserver(measure);
    overlays.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state'] });
    const unsubscribe = subscribeBrowser(measure);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      overlays.disconnect();
      unsubscribe();
      window.removeEventListener('resize', measure);
      setPane(element.getBoundingClientRect(), false);
      document.documentElement.removeAttribute('data-growth-browser');
    };
  }, [shown]);

  const { host, rest } = splitAddress(browser.url);
  const secure = browser.url?.startsWith('https://') ?? false;
  const recentBlock = browser.blocked && Date.now() - browser.blocked.at < 60_000 ? browser.blocked : null;
  const recentRefusal = browser.refused && Date.now() - browser.refused.at < 30_000 ? browser.refused : null;

  let status: React.ReactNode = null;
  if (recentBlock) {
    status = (
      <div className="flex flex-wrap items-center gap-2 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200" role="status">
        <ShieldAlertIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1">
          {recentBlock.host} did not open here. If it is your company&apos;s sign-in page, you can open it here
        </span>
        <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => void allowSite(recentBlock.url)}>
          Open it here
        </Button>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => void openExternal(recentBlock.url)}>
          Open in my browser
        </Button>
      </div>
    );
  } else if (phase === 'waiting' && waitingFor) {
    status = (
      <div className="flex items-center gap-2 bg-[hsl(var(--growth-assistant))]/10 px-3 py-2 text-xs" role="status">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[hsl(var(--growth-assistant))] opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[hsl(var(--growth-assistant))]" />
        </span>
        <HandIcon className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--growth-assistant))]" />
        <span className="min-w-0 flex-1 truncate font-medium">Your turn: {waitingFor}</span>
        {waitAction && (
          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={waitAction.run}>
            {waitAction.label}
          </Button>
        )}
      </div>
    );
  } else if (phase === 'approval') {
    status = (
      <div className="flex items-center gap-2 bg-[hsl(var(--growth-assistant))]/10 px-3 py-2 text-xs" role="status">
        <ArrowLeftIcon className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--growth-assistant))]" />
        <span className="font-medium">The assistant is waiting for your answer in the chat</span>
      </div>
    );
  } else if (recentRefusal) {
    status = (
      <div className="flex items-center gap-2 bg-muted px-3 py-2 text-xs text-muted-foreground" role="status">
        <ShieldAlertIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {recentRefusal.fileName} was not saved. {recentRefusal.reason}
        </span>
      </div>
    );
  } else if (phase !== 'idle') {
    status = (
      <div className="growth-shimmer flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground" role="status">
        <SparklesIcon className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--growth-assistant))]" />
        <span className="truncate">
          {phase === 'acting' && activity ? activity : phase === 'reading' ? 'Reading the page' : 'Thinking about the next step'}
        </span>
      </div>
    );
  }

  return (
    <div className={cn('flex min-h-0 flex-col bg-muted/40', className)} data-testid="growth-browser">
      <div className="flex items-center gap-1 border-b bg-background px-2 py-1.5">
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Back" onClick={() => void navigate('back')}>
          <ArrowLeftIcon className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Forward" onClick={() => void navigate('forward')}>
          <ArrowRightIcon className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Reload the page" onClick={() => void navigate('reload')}>
          {browser.loading ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <RotateCwIcon className="h-3.5 w-3.5" />}
        </Button>
        <div
          className="mx-1 flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md bg-muted px-2.5 text-xs"
          title={browser.url ?? undefined}
          data-testid="growth-browser-address"
        >
          {secure && <LockIcon className="h-3 w-3 shrink-0 text-muted-foreground" />}
          <span className="shrink-0 font-medium">{host || 'Loading'}</span>
          <span className="truncate text-muted-foreground">{rest}</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Open this page in my browser"
          disabled={!browser.url}
          onClick={() => browser.url && void openExternal(browser.url)}
        >
          <ExternalLinkIcon className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Close the browser" onClick={() => void closeBrowser()}>
          <XIcon className="h-4 w-4" />
        </Button>
      </div>
      {status}
      {signInPage(browser.url) && (
        <div className="flex items-center gap-2 border-b bg-background px-3 py-1.5 text-[11px] text-muted-foreground" data-testid="growth-browser-sign-in-hint">
          <KeyRoundIcon className="h-3.5 w-3.5 shrink-0" />
          <span>Sign in with your email and password, then the code sent to your phone. Passkeys don&apos;t work in this window</span>
        </div>
      )}
      <div ref={box} className="relative min-h-0 flex-1" data-testid="growth-browser-page">
        {/* Shown only while the browser itself is out of the way or loading. */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
          {browser.embedded ? (
            <>
              <Loader2Icon className="h-5 w-5 animate-spin" />
              <span>{browser.title || 'Opening the page'}</span>
            </>
          ) : (
            <p className="max-w-xs text-center">The browser opened in a window of its own. Keep it beside this one while the assistant works.</p>
          )}
        </div>
      </div>
    </div>
  );
}

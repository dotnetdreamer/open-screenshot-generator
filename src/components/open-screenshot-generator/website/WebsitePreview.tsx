"use client";

// The site as visitors will see it, drawn by the same renderer that writes the
// published files (src/lib/website/render.ts), in a frame on this page. The
// screenshots and the icon are addressed from memory instead of from files.
//
// No script runs in the frame: the pages' own script is left out of the
// preview, and the page carries a Content-Security-Policy of script-src
// 'none', so nothing the developer typed could run either. The frame is not
// `sandbox`ed for that: in a sandboxed frame without scripts, Playwright's
// WebKit (which the desktop specs run in, standing in for the app's
// WKWebView) ran no event listeners at all, the editor's own included, and
// the editor listens there to follow the links (a link to the support page
// switches the preview to the support page). It also puts the light or dark look on the page. A
// change while editing replaces the page's head and body in place, so typing
// does not flash the frame or lose where it was scrolled to; a new page or
// language starts at the top.

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Loader2Icon } from 'lucide-react';
import { openExternal } from '@/lib/desktop';
import { isGoogleFamily } from '@/lib/website/assets';
import { renderPage, renderStylesheet, shotPath } from '@/lib/website/render';
import type { TranslationBook } from '@/lib/website/strings';
import type { SiteDraft, SitePage, SiteShot } from '@/lib/website/types';
import { SITE_PAGES } from '@/lib/website/types';
import { cn } from '@/lib/utils';

export type PreviewDevice = 'desktop' | 'phone';
export type PreviewScheme = 'light' | 'dark';

const DESKTOP_WIDTH = 1280;
const PHONE = { width: 390, height: 844 };
const BAR = 38;

function previewHtml(draft: SiteDraft, page: SitePage, locale: string, shots: SiteShot[], known: TranslationBook): string {
  const urls = new Map<string, string>();
  for (const shot of shots) urls.set(shotPath(shot), shot.url);
  const font = draft.theme.headingFont && isGoogleFamily(draft.theme.headingFont)
    ? `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${draft.theme.headingFont.replace(/ /g, '+')}:wght@${draft.theme.headingWeight || 700}&display=swap">`
    : '';
  return renderPage(
    draft,
    page,
    locale,
    shots.map((shot) => ({ path: shotPath(shot), width: shot.width, height: shot.height, caption: shot.caption })),
    {
      preview: true,
      known,
      inlineCss: `${renderStylesheet(draft)}\nhtml{scroll-behavior:auto}`,
      headExtra: `<meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">${font}`,
      asset: (path) => (path === 'assets/icon.png' ? draft.facts.icon : urls.get(path) ?? path),
    }
  );
}

export function WebsitePreview({
  draft,
  page,
  locale,
  device,
  scheme,
  shots,
  known,
  address,
  busy,
  onNavigate,
  className,
}: {
  draft: SiteDraft;
  page: SitePage;
  locale: string;
  device: PreviewDevice;
  scheme: PreviewScheme;
  shots: SiteShot[];
  known: TranslationBook;
  /** The page's address once published, for the browser bar. */
  address: string;
  /** What the preview waits for, such as the screenshots. */
  busy?: string | null;
  onNavigate: (page: SitePage, locale: string) => void;
  className?: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const written = useRef<{ key: string; head: string; body: string } | null>(null);
  const navigate = useRef(onNavigate);
  navigate.current = onNavigate;

  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Rebuilt only when what it shows changes, not on every render of the view.
  const html = useMemo(() => previewHtml(draft, page, locale, shots, known), [draft, page, locale, shots, known]);

  const wire = useCallback((doc: Document) => {
    doc.addEventListener('click', (event) => {
      const target = event.target as Element | null;
      const anchor = target?.closest?.('a');
      if (!anchor) return;
      const to = anchor.getAttribute('data-osg-page');
      const href = anchor.getAttribute('href') ?? '';
      event.preventDefault();
      if (to && (SITE_PAGES as string[]).includes(to)) {
        navigate.current(to as SitePage, anchor.getAttribute('data-osg-locale') ?? locale);
        return;
      }
      if (href.startsWith('#')) {
        doc.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ block: 'start' });
        return;
      }
      if (/^https:\/\//.test(href)) void openExternal(href);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The frame is drawn once the box has a size, so writing waits for that.
  const ready = size.width > 0;
  useEffect(() => {
    const doc = frame.current?.contentDocument;
    if (!ready || !doc) return;
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const key = `${page}|${locale}|${parsed.documentElement.getAttribute('dir')}`;
    const head = parsed.head.innerHTML;
    const body = parsed.body.innerHTML;
    const last = written.current;
    if (!last || last.key !== key || !doc.body) {
      doc.open();
      doc.write(html);
      doc.close();
      // document.open() takes every listener off the document, so the links
      // are followed again after each new page.
      wire(doc);
      frame.current?.contentWindow?.scrollTo(0, 0);
    } else {
      if (last.head !== head) doc.head.innerHTML = head;
      if (last.body !== body) {
        // A question that was open stays open.
        const open = [...doc.querySelectorAll('details[open] > summary')].map((summary) => summary.textContent);
        doc.body.innerHTML = body;
        doc.body.className = parsed.body.className;
        for (const summary of doc.querySelectorAll('details > summary')) {
          if (open.includes(summary.textContent) && !summary.closest('.lang')) summary.parentElement?.setAttribute('open', '');
        }
      }
      for (const name of ['lang', 'dir', 'data-locale']) {
        const value = parsed.documentElement.getAttribute(name);
        if (value !== null) doc.documentElement.setAttribute(name, value);
      }
    }
    doc.documentElement.setAttribute('data-theme', scheme);
    written.current = { key, head, body };
  }, [ready, html, page, locale, scheme, wire]);

  const desktop = device === 'desktop';
  const scale = desktop
    ? Math.min(1, Math.max(0.2, (size.width - 2) / DESKTOP_WIDTH))
    : Math.min(1, Math.max(0.2, (size.height - 28) / PHONE.height), Math.max(0.2, (size.width - 28) / PHONE.width));
  const frameWidth = desktop ? DESKTOP_WIDTH : PHONE.width;
  const frameHeight = desktop ? Math.max(200, (size.height - BAR - 2) / scale) : PHONE.height;

  return (
    <div ref={box} className={cn('relative flex min-h-0 flex-1 items-start justify-center overflow-hidden', className)} data-testid="website-preview">
      {size.width > 0 && (
        <div
          className={cn(
            'relative overflow-hidden bg-background shadow-[0_30px_80px_-40px_rgba(0,0,0,0.45)] ring-1 ring-border',
            desktop ? 'rounded-xl' : 'mt-2 rounded-[44px] border-[10px] border-neutral-900 dark:border-neutral-700'
          )}
          style={desktop ? { width: size.width, height: size.height } : { width: PHONE.width * scale + 20, height: PHONE.height * scale + 20 }}
        >
          {desktop && (
            <div className="flex items-center gap-3 border-b bg-muted/60 px-3" style={{ height: BAR }}>
              <span className="flex gap-1.5" aria-hidden>
                <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
              </span>
              <span className="mx-auto max-w-[60%] truncate rounded-md bg-background px-3 py-0.5 text-[11px] text-muted-foreground" data-testid="website-preview-address">
                {address.replace(/^https:\/\//, '')}
              </span>
              <span className="w-10" aria-hidden />
            </div>
          )}
          <div className="relative overflow-hidden" style={{ width: frameWidth * scale, height: frameHeight * scale }}>
            <iframe
              ref={frame}
              title="Preview of the website"
              className="absolute left-0 top-0 origin-top-left border-0 bg-white"
              style={{ width: frameWidth, height: frameHeight, transform: `scale(${scale})` }}
            />
          </div>
          {busy && (
            <div className="absolute inset-x-0 bottom-3 flex justify-center" role="status">
              <span className="flex items-center gap-2 rounded-full bg-foreground/85 px-3 py-1.5 text-xs text-background shadow-lg">
                <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
                {busy}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

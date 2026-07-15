"use client";
// Full-screen notice shown on phones: viewports under 768px that also have a
// coarse pointer (see .mobile-notice-overlay in globals.css), so a desktop
// window snapped narrow never sees it. The editor needs a pointer and room
// for its panels, so phones get a heads-up that it works best on desktop
// browsers, with a way to continue anyway. Dismissal is remembered for the
// session only; the inline script in layout.tsx re-applies it before first
// paint so a reload doesn't flash the overlay while the bundle hydrates.

import { useEffect, useState } from 'react';
import { MonitorIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Logo } from './Logo';

const DISMISSED_KEY = 'mobile-notice-dismissed';

export function MobileNotice() {
  const [dismissed, setDismissed] = useState(false);

  // Read sessionStorage after mount: the static export renders the overlay
  // markup unconditionally, and deciding during render would risk a hydration
  // mismatch.
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(DISMISSED_KEY) === '1') setDismissed(true);
    } catch {}
  }, []);

  if (dismissed) return null;

  return (
    <>
      {/* Serialized into the static export right before the overlay markup,
          so it runs while the HTML is still parsing: a dismissed notice is
          hidden by the CSS gate before it can flash during hydration. */}
      <script
        dangerouslySetInnerHTML={{
          __html:
            "try{if(sessionStorage.getItem('mobile-notice-dismissed')==='1')document.documentElement.setAttribute('data-mobile-notice-dismissed','')}catch(e){}",
        }}
      />
      <div className="mobile-notice-overlay fixed inset-0 z-[100] items-center justify-center bg-background/80 p-6 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 text-center shadow-2xl">
        <Logo withBackground className="mx-auto h-12 w-12" />
        <div className="mt-4 flex items-center justify-center gap-2">
          <MonitorIcon className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Best on a desktop browser</h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Open Screenshot Generator is a drag and drop design canvas with panels and
          precise controls. It works best on a desktop browser with a mouse and
          a bigger screen.
        </p>
        <Button
          className="mt-5 w-full"
          onClick={() => {
            setDismissed(true);
            // Keep the CSS gate in sync so the overlay stays gone even before
            // the next page's hydration.
            document.documentElement.setAttribute('data-mobile-notice-dismissed', '');
            try {
              window.sessionStorage.setItem(DISMISSED_KEY, '1');
            } catch {}
          }}
        >
          Continue anyway
        </Button>
      </div>
      </div>
    </>
  );
}

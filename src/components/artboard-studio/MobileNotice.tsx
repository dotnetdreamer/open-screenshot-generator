"use client";
// One-time touch onboarding card shown on phones: viewports under 768px that
// also have a coarse pointer (see .mobile-notice-overlay in globals.css), so a
// desktop window snapped narrow never sees it. The editor supports touch
// (drag, pinch zoom, long-press menu); this just teaches the gestures and the
// panel buttons once. Dismissal is remembered for the session only; the inline
// script re-applies it before first paint so a reload doesn't flash the
// overlay while the bundle hydrates.

import { useEffect, useState } from 'react';
import { SmartphoneIcon } from 'lucide-react';
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
          <SmartphoneIcon className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Works with touch</h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Drag elements with one finger, pinch to zoom the canvas, and hold
          for the copy and paste menu. The palette and panels open from the
          toolbar buttons. A tablet or desktop gives you more room for big
          projects.
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
          Start designing
        </Button>
      </div>
      </div>
    </>
  );
}

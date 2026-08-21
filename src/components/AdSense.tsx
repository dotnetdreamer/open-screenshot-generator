"use client";
// Injects the Google AdSense loader for the editor.
//
// This deliberately renders no <ins class="adsbygoogle"> slots. The editor is a
// fixed h-screen/overflow-hidden shell (see src/app/page.tsx), so an in-flow ad
// unit has nowhere to sit without shifting the canvas. Loading the script alone
// is what makes the domain "ready to show ads" for AdSense; adding real units is
// a separate, deliberate change.
//
// IMPORTANT: keep Auto ads switched OFF for editor.openscrgen.app in the AdSense
// console. Auto ads is a dashboard-side setting, so with it on this loader will
// inject anchor and overlay ads over the canvas on its own, which is exactly
// what rendering no slots here is meant to avoid.
//
// Gating mirrors <Analytics />: decided on the client after mount so we can skip
// localhost (dev traffic) and the Tauri desktop shell (stricter CSP, and AdSense
// does not allow serving into a packaged desktop WebView). Deciding after mount
// also avoids a hydration mismatch with the static export, which prerenders this
// as nothing.
import { useEffect, useState } from 'react';
import Script from 'next/script';
import { isDetachedPanelWindow } from '@/lib/panels/url';

export const ADSENSE_CLIENT_ID =
  process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID || 'ca-pub-3225278768671673';

export function AdSense() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!ADSENSE_CLIENT_ID) return;
    if ('__TAURI_INTERNALS__' in window) return; // desktop shell
    // A detached panel window is a tool window, not a page view: it would
    // double-count every session and, for AdSense, put a loader in a window
    // that has nowhere to put an ad.
    if (isDetachedPanelWindow()) return;
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '') return; // dev
    setEnabled(true);
  }, []);

  if (!enabled) return null;

  return (
    <Script
      id="adsense-lib"
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT_ID}`}
      strategy="afterInteractive"
      crossOrigin="anonymous"
    />
  );
}

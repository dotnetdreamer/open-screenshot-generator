"use client";
// Injects the Google Analytics (gtag.js) loader for the editor.
//
// Loading is decided on the client after mount so we can skip it on localhost
// (dev traffic) and inside the Tauri desktop shell (stricter CSP, and desktop
// users opted out of the cloud). Deciding after mount also avoids a hydration
// mismatch with the static export, which prerenders this as nothing.
//
// Event helpers live in src/lib/analytics.ts.
import { useEffect, useState } from 'react';
import Script from 'next/script';
import { GA_MEASUREMENT_ID } from '@/lib/analytics';

export function Analytics() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!GA_MEASUREMENT_ID) return;
    if ('__TAURI_INTERNALS__' in window) return; // desktop shell
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '') return; // dev
    setEnabled(true);
  }, []);

  if (!enabled) return null;

  return (
    <>
      <Script
        id="ga-lib"
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_MEASUREMENT_ID}');`}
      </Script>
    </>
  );
}

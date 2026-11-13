"use client";

// Store images Growth shows, loaded the way their server answers.
//
// Google Play's image server (lh3.googleusercontent.com) refuses images a web
// view asks for the way a browser page does. Measured live on 2026-11-13 from
// the macOS app: a page's fetch of a Play Console image got HTTP 429 every
// time, and a store page showing eight screenshots at once got the first four
// and 429 for the rest. Asked through the app's Rust HTTP client, the way the
// API calls go, all eight came back at once. So on the desktop app a Google
// Play image is fetched that way and shown from memory; anything else (App
// Store images, the web build) loads as a plain image.

import { useEffect, useState } from 'react';
import { bridgeFetch } from '@/lib/account/transport';
import { isTauri } from '@/lib/desktop';

const loaded = new Map<string, Promise<string>>();

/** Whether an image comes from Google's image server, which needs the app's own HTTP client. */
export function isGoogleImage(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('.googleusercontent.com');
  } catch {
    return false;
  }
}

function viaApp(url: string): boolean {
  return isTauri() && isGoogleImage(url);
}

/** An address the page can show: the image itself, or the image fetched by the app and kept in memory. */
export function storeImageSource(url: string): Promise<string> {
  if (!viaApp(url)) return Promise.resolve(url);
  let image = loaded.get(url);
  if (!image) {
    image = (async () => {
      const doFetch = await bridgeFetch();
      const response = await doFetch(url, { method: 'GET' });
      if (!response.ok) throw new Error(`The image server answered HTTP ${response.status}`);
      return URL.createObjectURL(await response.blob());
    })();
    // A failed load is asked again next time rather than kept.
    image.catch(() => loaded.delete(url));
    loaded.set(url, image);
  }
  return image;
}

/** The address to put in an <img>, undefined while the app is still fetching the image. */
export function useStoreImage(url: string | null | undefined): string | undefined {
  const [source, setSource] = useState<string | undefined>(() => (url && !viaApp(url) ? url : undefined));
  useEffect(() => {
    if (!url) {
      setSource(undefined);
      return;
    }
    let current = true;
    if (!viaApp(url)) setSource(url);
    else setSource(undefined);
    storeImageSource(url).then(
      (value) => {
        if (current) setSource(value);
      },
      (error) => {
        console.error('A store image could not be loaded', error);
        // Let the web view try the address itself.
        if (current) setSource(url);
      }
    );
    return () => {
      current = false;
    };
  }, [url]);
  return source;
}

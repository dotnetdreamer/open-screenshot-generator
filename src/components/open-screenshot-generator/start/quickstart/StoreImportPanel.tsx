"use client";

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { Download, Loader2, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  downloadListingImages,
  resolveStoreInput,
  type AppListing,
} from '@/lib/intake/appStoreLookup';

interface StoreImportPanelProps {
  /** Screenshots the user chose to pull down from their listing. */
  onImportFiles: (files: File[], listing: AppListing) => void;
  /** Name, category and icon, whether or not screenshots were taken. */
  onAdoptDetails: (listing: AppListing) => void;
  onClose: () => void;
}

/**
 * Import an app straight from its store listing.
 *
 * The competitor's equivalent field fills in a name, a category and a logo.
 * This one does that, and then offers the listing's actual screenshots, at full
 * resolution, in one click. Somebody who has already shipped does not have to
 * go and find their files at all: they paste their own link and their real
 * screenshots are in the editor a second later, ready to be redesigned.
 *
 * All of it runs in the browser. Apple's search endpoint and its image CDN both
 * answer with Access-Control-Allow-Origin, which is what lets a build with no
 * backend do this at all.
 */
export function StoreImportPanel({ onImportFiles, onAdoptDetails, onClose }: StoreImportPanelProps) {
  const [query, setQuery] = useState('');
  const [listings, setListings] = useState<AppListing[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [pulling, setPulling] = useState<string | null>(null);
  const [selected, setSelected] = useState<AppListing | null>(null);

  /**
   * Debounced search, with every in-flight request cancelled by the next
   * keystroke so a fast typist never sees an older answer land on a newer one.
   *
   * Nothing here writes state until the user actually pauses. That is not a
   * micro-optimisation: this panel sits above a deck of ranked template cards,
   * so a state write per keystroke re-renders that whole tree, and pasting a
   * store link (55 characters arriving at once) chained enough nested updates
   * for React to abort with "Maximum update depth exceeded". The two writes
   * that remain in the short-query branch use the functional form, which lets
   * React bail out when the value has not really changed.
   */
  useEffect(() => {
    const value = query.trim();
    if (value.length < 2) {
      setListings((current) => (current.length === 0 ? current : []));
      setNotice(null);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const result = await resolveStoreInput(value, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setListings(result.listings);
        setNotice(result.notice);
      } catch (error) {
        if (controller.signal.aborted) return;
        setListings([]);
        setNotice(
          error instanceof Error && error.name === 'AbortError'
            ? null
            : 'The App Store could not be reached. Check your connection, or upload the screenshots directly'
        );
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const pull = async (listing: AppListing, urls: string[]) => {
    if (urls.length === 0) return;
    setPulling(listing.id);
    try {
      const files = await downloadListingImages(urls, {
        namePrefix: listing.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 24) || 'app',
      });
      if (files.length > 0) onImportFiles(files, listing);
      else setNotice('Those screenshots could not be downloaded. Upload them directly instead');
    } finally {
      setPulling(null);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Import from the App Store</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Paste your App Store link or search by name. Your listing already has the name, the
            category, the icon and the screenshots
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose} aria-label="Close">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="App name, or an apps.apple.com link"
          className="pl-9"
          autoFocus
        />
        {searching && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {notice && <p className="text-xs text-muted-foreground">{notice}</p>}

      {listings.length > 0 && (
        // Its own scroll, capped: eight results each with an expandable
        // thumbnail strip is taller than the dialog, and without this the deck
        // below gets pushed out of reach instead.
        <ul className="max-h-[52vh] space-y-2 overflow-y-auto show-scrollbar pr-1">
          {listings.map((listing) => {
            const isOpen = selected?.id === listing.id;
            const phone = listing.screenshotUrls;
            const tablet = listing.tabletScreenshotUrls;
            return (
              <li
                key={listing.id}
                className={cn(
                  'rounded-lg border p-2 transition-colors',
                  isOpen ? 'border-primary bg-accent/30' : 'hover:bg-accent/20'
                )}
              >
                <button
                  type="button"
                  onClick={() => setSelected(isOpen ? null : listing)}
                  className="flex w-full items-center gap-3 text-left"
                >
                  {listing.iconUrl ? (
                    <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-[10px] border bg-muted">
                      <Image src={listing.iconUrl} alt="" fill sizes="40px" className="object-cover" unoptimized />
                    </span>
                  ) : (
                    <span className="h-10 w-10 shrink-0 rounded-[10px] border bg-muted" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{listing.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[listing.developer, listing.category].filter(Boolean).join(' , ')}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {phone.length > 0 ? `${phone.length} shots` : 'no shots'}
                  </span>
                </button>

                {isOpen && (
                  <div className="mt-2 space-y-2 border-t pt-2">
                    {phone.length > 0 && (
                      <div className="flex gap-1.5 overflow-x-auto pb-1">
                        {phone.slice(0, 8).map((url) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={url}
                            src={url}
                            alt=""
                            loading="lazy"
                            className="h-24 w-auto shrink-0 rounded border bg-muted object-contain"
                          />
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={phone.length === 0 || pulling === listing.id}
                        onClick={() => void pull(listing, phone)}
                      >
                        {pulling === listing.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                        {`Use these ${phone.length} screenshots`}
                      </Button>
                      {tablet.length > 0 && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={pulling === listing.id}
                          onClick={() => void pull(listing, tablet)}
                        >
                          {`iPad set (${tablet.length})`}
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          onAdoptDetails(listing);
                          onClose();
                        }}
                      >
                        Just take the name and category
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

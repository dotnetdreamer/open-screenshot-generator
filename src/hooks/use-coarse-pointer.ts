"use client";
import { useEffect, useState } from 'react';

/**
 * True when the primary pointer is a finger (phone, tablet) rather than a mouse
 * or trackpad. Drives the touch affordances the canvas needs: bigger drag
 * handles, overlays that cannot wait for a hover that never arrives.
 *
 * Deliberately a media query and not a `'ontouchstart' in window` sniff, which
 * is true on every touchscreen laptop and would coarsen the UI for people
 * holding a mouse. A hybrid device that switches to a finger re-matches and
 * this re-renders.
 *
 * Starts false so SSR and the first client render agree (see rule 14 in
 * AGENTS.md); the real value lands in the effect right after mount.
 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(pointer: coarse)');
    const sync = () => setCoarse(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  return coarse;
}

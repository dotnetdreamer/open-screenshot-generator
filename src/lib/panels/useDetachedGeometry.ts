"use client";

// A detached panel window remembering where it was put.
//
// It writes its own geometry rather than the editor writing it, because the
// editor cannot see a window the user dragged: there is no move event for
// another window, and polling one from across an IPC boundary to find out
// whether somebody nudged it is not a thing worth doing. The window itself
// already knows, in both shells.
//
// Physical pixels on desktop, because a two-display setup at two different
// scale factors has no shared logical origin. CSS pixels on the web, which is
// all window.open accepts back.

import { useEffect } from 'react';
import { writePanelGeometry, type PanelGroup } from './windows';

/** Long enough that a drag writes once, short enough to survive a quick close. */
const SETTLE_MS = 400;

export function useDetachedGeometry(group: PanelGroup): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    const unlisteners: Array<() => void> = [];

    const isDesktop = '__TAURI_INTERNALS__' in window;

    const save = async () => {
      if (disposed) return;
      if (isDesktop) {
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          const self = getCurrentWindow();
          // A maximized window's geometry is not where it should reopen.
          if (await self.isMaximized()) return;
          // outerPosition with innerSize, deliberately: those are the two the
          // setters take back. See PanelGeometry.
          const [position, size] = await Promise.all([self.outerPosition(), self.innerSize()]);
          writePanelGeometry(group, {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
          });
        } catch {
          // A window mid-close answers nothing. Losing one position is fine.
        }
        return;
      }
      writePanelGeometry(group, {
        x: window.screenX,
        y: window.screenY,
        width: window.outerWidth,
        height: window.outerHeight,
      });
    };

    const settle = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void save();
      }, SETTLE_MS);
    };

    if (isDesktop) {
      void (async () => {
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          const self = getCurrentWindow();
          const [offMoved, offResized] = await Promise.all([
            self.onMoved(settle),
            self.onResized(settle),
          ]);
          if (disposed) {
            offMoved();
            offResized();
            return;
          }
          unlisteners.push(offMoved, offResized);
        } catch (error) {
          console.error('Could not follow this window', error);
        }
      })();
    }
    // Once on the way in, too. A window the user never touches fires neither
    // event, and "reopen where it was" should not need a drag first: the
    // display layout can change between one detach and the next.
    const initial = setTimeout(() => void save(), SETTLE_MS);

    // A browser fires resize for a resize and nothing at all for a move, so the
    // position is picked up on the way out instead.
    const saveNow = () => void save();
    if (!isDesktop) window.addEventListener('resize', settle);
    window.addEventListener('pagehide', saveNow);

    return () => {
      disposed = true;
      clearTimeout(initial);
      if (timer) clearTimeout(timer);
      unlisteners.forEach((off) => off());
      if (!isDesktop) window.removeEventListener('resize', settle);
      window.removeEventListener('pagehide', saveNow);
    };
  }, [group]);
}

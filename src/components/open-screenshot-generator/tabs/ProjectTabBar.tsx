"use client";

// The strip of open projects above the toolbar.
//
// It draws the list it is given and reports what the user did; the layout owns
// what is on the canvas (see src/lib/tabs). Everything that moves here is a
// CSS transform on a tab that already exists, so a drag or a close animates
// without one React render per frame:
//
//   - a tab dragged sideways follows the pointer and the others step aside;
//     letting go commits the order, and every tab glides from where it was
//     drawn to its new slot (FLIP)
//   - opening and closing tabs glide the same way, from the positions kept
//     after the previous layout
//
// A finger taps to switch and long-presses for the menu, because a sideways
// swipe on the strip has to stay a scroll.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import {
  AppWindowIcon,
  ChevronDownIcon,
  CopyIcon,
  Loader2Icon,
  MonitorUpIcon,
  PlusIcon,
  RotateCcwIcon,
  SearchIcon,
  XIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { createPortal } from 'react-dom';
import { cycleTab, tabForNumber, tabIndexOf, type ClosedTab, type ProjectTab } from '@/lib/tabs/tabModel';
import { NEUTRAL_ACCENT, type TabSummary } from '@/lib/tabs/summary';
import {
  setElementCarryDropHandler,
  subscribeElementCarry,
  type ElementCarry,
} from '@/lib/tabs/elementCarry';
import type { MonitorInfo } from '@/lib/panels/monitors';
import type { TabWindowPlacement } from '@/lib/tabs/tabWindows';
import { MonitorMenuItems } from '../panels/MonitorMenuItems';
import { TabHoverCard, type TabArtboardsSource } from './TabHoverCard';

/** Another editor window a tab can move to. */
export interface OtherTabWindow {
  id: string;
  title: string;
  tabs: number;
  /** The window the app opened with, not one a tab was moved into. */
  main?: boolean;
}

/** What Move to window calls a window: the main one by that name, any other by the project in front. */
export function tabWindowName(window: { title: string; main?: boolean }, mainWindows = 1): string {
  const title = window.title || 'Untitled project';
  if (!window.main) return title;
  return mainWindows > 1 ? `Main window (${title})` : 'Main window';
}

export interface ProjectTabBarProps {
  tabs: ProjectTab[];
  activeProjectId: string | null;
  /** The tab whose project is being read onto the canvas, for its spinner. */
  loadingProjectId?: string | null;
  /** The active tab's summary, live: it changes as the project is edited. */
  activeSummary?: TabSummary;
  closed: ClosedTab[];
  isSleeping(projectId: string): boolean;
  /** A sleeping tab whose undo history comes back with it (useProjectTabs). */
  keepsUndo?(projectId: string): boolean;
  /** What a tab's hover card draws. */
  artboardsFor(projectId: string): TabArtboardsSource;
  onActivate(projectId: string): void;
  onClose(projectId: string): void;
  onNewTab(): void;
  onMove(projectId: string, toIndex: number): void;
  onCloseOthers(projectId: string): void;
  onCloseToRight(projectId: string): void;
  onDuplicate(projectId: string): void;
  onReopenClosed(projectId?: string): void;
  /** Rename the active tab's project. */
  onRename(name: string): void;
  /**
   * Layers dragged off the canvas were let go over another tab: move them
   * there, or copy them when Alt was held.
   */
  onDropLayers?(projectId: string, carry: ElementCarry): void;
  /**
   * Layers held over another tab long enough to open it. The drag carries on
   * in the tab that opens, so the layers can be put down exactly where wanted.
   */
  onSpringLoad?(projectId: string, carry: ElementCarry): void;
  /**
   * The tab leaves for a window of its own: dragged out of the strip, or
   * Move to new window. On the web this runs inside the release or the click,
   * which is what lets the browser open the window.
   */
  onMoveToNewWindow?(projectId: string, placement: TabWindowPlacement): void;
  /** The tab moves to another editor window that is already open. */
  onMoveToWindow?(projectId: string, windowId: string): void;
  /**
   * A tab is being dragged outside the strip, the pointer where `event` says.
   * The layout works out whether that is over another window (tabDrag.ts).
   */
  onTearMove?(projectId: string, event: { screenX: number; screenY: number }): void;
  /**
   * The drag outside the strip ended: let go where `release` says, with the new
   * window to open when it lands on no other (none for a window's only tab),
   * or put back or cancelled (null). The layout decides where it lands, from
   * the release itself. Called inside the release, which is what lets a
   * browser open a window.
   */
  onTearEnd?(
    projectId: string,
    release: { screenX: number; screenY: number; placement: TabWindowPlacement | null } | null
  ): void;
  /** The other window a tab being dragged out would move to if let go now. */
  tearTarget?: { windowId: string; name: string } | null;
  /** Displays a tab can be opened on. Fewer than two hides the choice. */
  displays?: MonitorInfo[];
  /** The other editor windows, for Move to window. */
  otherWindows?: OtherTabWindow[];
  /** The tab menu opened: a moment to ask which windows and displays there are. */
  onMenuOpen?(): void;
  /** In a browser that can be asked to see every display, but has not been yet. */
  onFindDisplays?(): void;
  /** True while a dialog or an export holds the editor: the shortcuts stand down. */
  shortcutsBlocked: boolean;
  /**
   * The desktop app has no browser tabs of its own, so it gets the browser's
   * tab shortcuts. A browser keeps those for itself.
   */
  desktopShortcuts: boolean;
  className?: string;
}

const HOVER_CARD_DELAY_MS = 450;
/** With a card already open, moving to the next tab swaps it almost at once. */
const HOVER_CARD_SWAP_MS = 60;
const DRAG_THRESHOLD_PX = 4;
const LONG_PRESS_MS = 500;
const TOUCH_SLOP_PX = 8;
const GLIDE_MS = 180;
const GLIDE_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
/** The search box only earns its place once the list is long. */
const SEARCH_FROM_TABS = 7;
/** How long layers have to rest on a tab before it opens under them. */
const SPRING_LOAD_MS = 900;
/** How far past the strip a dragged tab goes before it is leaving the window. */
const TEAR_OFF_PX = 44;
/** The display map shown while a tab is torn off, at most this big. */
const DISPLAY_MAP = { width: 300, height: 104 };

/** Each display as a box in the map, keeping their real arrangement. */
function layoutDisplays(displays: MonitorInfo[]): Array<{ display: MonitorInfo; left: number; top: number; width: number; height: number }> {
  if (displays.length === 0) return [];
  const minX = Math.min(...displays.map((d) => d.position.x));
  const minY = Math.min(...displays.map((d) => d.position.y));
  const maxX = Math.max(...displays.map((d) => d.position.x + d.size.width));
  const maxY = Math.max(...displays.map((d) => d.position.y + d.size.height));
  const scale = Math.min(DISPLAY_MAP.width / Math.max(1, maxX - minX), DISPLAY_MAP.height / Math.max(1, maxY - minY));
  return displays.map((display) => ({
    display,
    left: (display.position.x - minX) * scale,
    top: (display.position.y - minY) * scale,
    width: Math.max(24, display.size.width * scale - 4),
    height: Math.max(16, display.size.height * scale - 4),
  }));
}

/**
 * Run `work` once the browser has painted the current frame.
 *
 * Switching tabs re-renders the whole canvas, and a project full of 3D frames
 * takes a moment to build. Doing that inside the click would hold the tab's
 * own highlight back until it was done; deferring it past one paint lets the
 * strip answer at once and the canvas follow. The timeout covers a page that
 * stopped producing frames.
 */
function afterNextPaint(work: () => void): void {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    work();
  };
  const fallback = window.setTimeout(run, 120);
  requestAnimationFrame(() =>
    window.setTimeout(() => {
      window.clearTimeout(fallback);
      run();
    }, 0)
  );
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

interface Shortcuts {
  next: string;
  previous: string;
  newTab?: string;
  close?: string;
  reopen?: string;
  number?: (digit: number) => string;
}

function shortcutLabels(desktop: boolean, apple: boolean): Shortcuts {
  if (!desktop) {
    return apple ? { next: '⌥⇧→', previous: '⌥⇧←' } : { next: 'Alt+Shift+→', previous: 'Alt+Shift+←' };
  }
  if (apple) {
    return {
      next: '⌃⇥',
      previous: '⌃⇧⇥',
      newTab: '⌘T',
      close: '⌘W',
      reopen: '⇧⌘T',
      number: (digit) => `⌘${digit}`,
    };
  }
  return {
    next: 'Ctrl+Tab',
    previous: 'Ctrl+Shift+Tab',
    newTab: 'Ctrl+T',
    close: 'Ctrl+W',
    reopen: 'Ctrl+Shift+T',
    number: (digit) => `Ctrl+${digit}`,
  };
}

/** Where a tab sits inside the scrolling strip, independent of how far it is scrolled. */
function contentLeft(element: HTMLElement, scroller: HTMLElement): number {
  return element.getBoundingClientRect().left - scroller.getBoundingClientRect().left + scroller.scrollLeft;
}

interface DragState {
  pointerId: number;
  pointerType: string;
  projectId: string;
  startX: number;
  startY: number;
  fromIndex: number;
  lefts: number[];
  widths: number[];
  gap: number;
  dragging: boolean;
  targetIndex: number;
  longPress: number | null;
  longPressFired: boolean;
  /** Pulled out of the strip: letting go opens it in a window of its own. */
  tearing: boolean;
  /** The display in the map the pointer is over, while tearing. */
  displayId: string | null;
}

export function ProjectTabBar({
  tabs,
  activeProjectId,
  loadingProjectId = null,
  activeSummary,
  closed,
  isSleeping,
  keepsUndo,
  artboardsFor,
  onActivate,
  onClose,
  onNewTab,
  onMove,
  onCloseOthers,
  onCloseToRight,
  onDuplicate,
  onReopenClosed,
  onRename,
  onDropLayers,
  onSpringLoad,
  onMoveToNewWindow,
  onMoveToWindow,
  onTearMove,
  onTearEnd,
  tearTarget = null,
  displays = [],
  otherWindows = [],
  onMenuOpen,
  onFindDisplays,
  shortcutsBlocked,
  desktopShortcuts,
  className,
}: ProjectTabBarProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [apple, setApple] = useState(false);
  useEffect(() => setApple(isApplePlatform()), []);
  const shortcuts = useMemo(() => shortcutLabels(desktopShortcuts, apple), [desktopShortcuts, apple]);

  const tabElements = useCallback((): HTMLElement[] => {
    const scroller = scrollerRef.current;
    if (!scroller) return [];
    return Array.from(scroller.querySelectorAll<HTMLElement>('[data-tab-id]'));
  }, []);

  // The tab just picked shows as active on the next frame, and the project
  // behind it follows once that frame is painted (afterNextPaint). Cleared in
  // the same batch as the switch itself, so a switch that was turned down (a
  // live session asking first, an export running) puts the old tab back.
  const [pendingActiveId, setPendingActiveId] = useState<string | null>(null);
  const onActivateRef = useRef(onActivate);
  onActivateRef.current = onActivate;
  const activeIdRef = useRef(activeProjectId);
  activeIdRef.current = activeProjectId;
  const requestActivate = useCallback((projectId: string) => {
    if (projectId === activeIdRef.current) return;
    setPendingActiveId(projectId);
    afterNextPaint(() => {
      onActivateRef.current(projectId);
      setPendingActiveId(null);
    });
  }, []);
  const shownActiveId = pendingActiveId ?? activeProjectId;

  // ------------------------------------------------------------- the glide

  const lastLeftsRef = useRef(new Map<string, number>());
  /** Where each tab was DRAWN when a drag ended, transforms included. */
  const glideFromRef = useRef<Map<string, number> | null>(null);
  const order = tabs.map((tab) => tab.projectId).join('\n');

  const glide = useCallback(
    (from: Map<string, number>, animateNew: boolean) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const reduce = prefersReducedMotion();
      const next = new Map<string, number>();
      for (const element of tabElements()) {
        const id = element.dataset.tabId!;
        const left = contentLeft(element, scroller);
        next.set(id, left);
        if (reduce) continue;
        const before = from.get(id);
        if (before === undefined) {
          if (animateNew) {
            element.animate(
              [
                { opacity: 0, transform: 'translateY(6px) scale(0.96)' },
                { opacity: 1, transform: 'none' },
              ],
              { duration: GLIDE_MS, easing: GLIDE_EASING }
            );
          }
          continue;
        }
        const dx = before - left;
        if (Math.abs(dx) < 0.5) continue;
        element.animate([{ transform: `translateX(${dx}px)` }, { transform: 'translateX(0)' }], {
          duration: GLIDE_MS,
          easing: GLIDE_EASING,
        });
      }
      lastLeftsRef.current = next;
    },
    [tabElements]
  );

  useLayoutEffect(() => {
    const from = glideFromRef.current ?? lastLeftsRef.current;
    const isFirstLayout = lastLeftsRef.current.size === 0 && !glideFromRef.current;
    glideFromRef.current = null;
    glide(from, !isFirstLayout);
  }, [order, glide]);

  // Keep the active tab in view as it changes, without jumping the page.
  useEffect(() => {
    if (!shownActiveId) return;
    const scroller = scrollerRef.current;
    const element = scroller?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(shownActiveId)}"]`);
    if (!scroller || !element) return;
    const left = contentLeft(element, scroller);
    const right = left + element.offsetWidth;
    if (left < scroller.scrollLeft) scroller.scrollTo({ left: left - 8, behavior: 'smooth' });
    else if (right > scroller.scrollLeft + scroller.clientWidth) {
      scroller.scrollTo({ left: right - scroller.clientWidth + 8, behavior: 'smooth' });
    }
  }, [shownActiveId, order]);

  // Faded edges, only where there is more strip to scroll to.
  const [overflow, setOverflow] = useState<{ left: boolean; right: boolean }>({ left: false, right: false });
  const measureOverflow = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const left = scroller.scrollLeft > 1;
    const right = scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1;
    setOverflow((current) => (current.left === left && current.right === right ? current : { left, right }));
  }, []);
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    measureOverflow();
    const observer = new ResizeObserver(measureOverflow);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [measureOverflow, order]);

  // A mouse wheel scrolls the strip sideways once it overflows. Registered by
  // hand because React's wheel listeners are passive and cannot take the
  // event away from the page.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const onWheel = (event: WheelEvent) => {
      if (scroller.scrollWidth <= scroller.clientWidth) return;
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();
      scroller.scrollLeft += event.deltaY;
    };
    scroller.addEventListener('wheel', onWheel, { passive: false });
    return () => scroller.removeEventListener('wheel', onWheel);
  }, []);

  // --------------------------------------------------------- the hover card

  const [hover, setHover] = useState<{ projectId: string; rect: DOMRect } | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const hoverRef = useRef(hover);
  hoverRef.current = hover;
  const clearHoverTimer = () => {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
  };
  const hideHover = useCallback(() => {
    clearHoverTimer();
    setHover(null);
  }, []);
  useEffect(() => clearHoverTimer, []);

  // ------------------------------------------------ layers carried onto a tab

  const [carryOver, setCarryOver] = useState<{ projectId: string | null; x: number; y: number; copy: boolean } | null>(
    null
  );
  const lastCarryRef = useRef<ElementCarry | null>(null);
  const springRef = useRef<{ projectId: string; timer: number } | null>(null);
  const dropLayersRef = useRef(onDropLayers);
  dropLayersRef.current = onDropLayers;
  const springLoadRef = useRef(onSpringLoad);
  springLoadRef.current = onSpringLoad;

  /** What a carried layer is over: nothing, the strip, or a tab in it. */
  const carryTarget = useCallback(
    (x: number, y: number): { projectId: string | null } | null => {
      const root = rootRef.current;
      if (!root) return null;
      const rect = root.getBoundingClientRect();
      // A little slack below the strip: a layer just short of a tab still counts.
      if (x < rect.left || x > rect.right || y < rect.top - 2 || y > rect.bottom + 6) return null;
      for (const element of tabElements()) {
        const box = element.getBoundingClientRect();
        if (x >= box.left && x <= box.right) return { projectId: element.dataset.tabId ?? null };
      }
      return { projectId: null };
    },
    [tabElements]
  );

  const stopSpring = useCallback(() => {
    if (!springRef.current) return;
    window.clearTimeout(springRef.current.timer);
    springRef.current = null;
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeElementCarry((carry) => {
      lastCarryRef.current = carry;
      if (!carry) {
        stopSpring();
        setCarryOver(null);
        return;
      }
      const hit = carryTarget(carry.clientX, carry.clientY);
      if (!hit) {
        stopSpring();
        setCarryOver((current) => (current ? null : current));
        return;
      }
      const target = hit.projectId && hit.projectId !== activeIdRef.current ? hit.projectId : null;
      setCarryOver({ projectId: target, x: carry.clientX, y: carry.clientY, copy: carry.copy });
      // Resting on another tab opens it, with the layers still in hand.
      if (!target || !springLoadRef.current) {
        stopSpring();
        return;
      }
      if (springRef.current?.projectId === target) return;
      stopSpring();
      springRef.current = {
        projectId: target,
        timer: window.setTimeout(() => {
          springRef.current = null;
          const latest = lastCarryRef.current;
          if (latest) springLoadRef.current?.(target, latest);
        }, SPRING_LOAD_MS),
      };
    });
    return () => {
      unsubscribe();
      stopSpring();
    };
  }, [carryTarget, stopSpring]);

  // The strip takes any drop over it: there is no artboard up here for a layer
  // to land on. Over another tab the layers go to that tab; anywhere else on
  // the strip they go back where they were.
  useEffect(
    () =>
      setElementCarryDropHandler((carry) => {
        stopSpring();
        const hit = carryTarget(carry.clientX, carry.clientY);
        if (!hit) return false;
        const target = hit.projectId && hit.projectId !== activeIdRef.current ? hit.projectId : null;
        // After the drag has finished putting its own board back.
        if (target) window.setTimeout(() => dropLayersRef.current?.(target, carry), 0);
        return true;
      }),
    [carryTarget, stopSpring]
  );

  // -------------------------------------------------------------- the drag

  const dragRef = useRef<DragState | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ projectId: string; x: number; y: number } | null>(null);

  // --- a tab torn off: the card that follows the pointer, and the display map
  // A window's only tab gains nothing from a new window of its own, so only
  // the others open one. Any tab can be dragged onto another window, though,
  // which is how one moved out comes back.
  const canTearOff = !!onMoveToNewWindow && tabs.length > 1;
  const canDragOut = canTearOff || (!!onTearMove && !!onTearEnd);
  const tearEndRef = useRef(onTearEnd);
  tearEndRef.current = onTearEnd;
  const [tearOff, setTearOff] = useState<{ projectId: string; displayId: string | null } | null>(null);
  const tearCardRef = useRef<HTMLDivElement>(null);
  const tearPointRef = useRef({ x: 0, y: 0 });
  const moveTearCard = (x: number, y: number) => {
    tearPointRef.current = { x, y };
    const card = tearCardRef.current;
    if (card) card.style.transform = `translate(${x + 14}px, ${y + 14}px)`;
  };
  const displayTiles = useMemo(() => layoutDisplays(displays.length > 1 ? displays : []), [displays]);
  /** The display tile under the pointer, by geometry: the map takes no pointer events. */
  const displayAt = (x: number, y: number): string | null => {
    for (const tile of document.querySelectorAll<HTMLElement>('[data-tear-display]')) {
      const box = tile.getBoundingClientRect();
      if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return tile.dataset.tearDisplay ?? null;
    }
    return null;
  };
  // The card mounts after the drag starts tearing; put it under the pointer.
  useLayoutEffect(() => {
    if (tearOff) moveTearCard(tearPointRef.current.x, tearPointRef.current.y);
  }, [tearOff]);

  const endDrag = useCallback(
    (commit: boolean) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) return;
      if (drag.longPress !== null) window.clearTimeout(drag.longPress);
      if (!drag.dragging) return;
      const scroller = scrollerRef.current;
      const elements = tabElements();
      if (drag.tearing) {
        // Taken away mid tear (the OS cancelled the pointer): it stays here.
        setTearOff(null);
        tearEndRef.current?.(drag.projectId, null);
        const dragged = elements[drag.fromIndex];
        if (dragged) dragged.style.opacity = '';
      }
      if (scroller) {
        glideFromRef.current = new Map(elements.map((element) => [element.dataset.tabId!, contentLeft(element, scroller)]));
      }
      for (const element of elements) {
        element.style.transform = '';
        element.style.transition = '';
        element.style.zIndex = '';
      }
      setDraggingId(null);
      if (commit && drag.targetIndex !== drag.fromIndex) {
        onMove(drag.projectId, drag.targetIndex);
      } else if (glideFromRef.current) {
        // Same slot: no render is coming, so settle the tab back from here.
        const from = glideFromRef.current;
        glideFromRef.current = null;
        glide(from, false);
      }
    },
    [glide, onMove, tabElements]
  );

  const onTabPointerDown = (event: React.PointerEvent<HTMLElement>, tab: ProjectTab) => {
    if (event.button === 1) {
      // Middle button: keep the browser's autoscroll out of it; auxclick closes.
      event.preventDefault();
      return;
    }
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('[data-tab-close], input')) return;
    hideHover();
    const elements = tabElements();
    const scroller = scrollerRef.current;
    const fromIndex = elements.findIndex((element) => element.dataset.tabId === tab.projectId);
    if (!scroller || fromIndex < 0) return;
    const lefts = elements.map((element) => contentLeft(element, scroller));
    const widths = elements.map((element) => element.offsetWidth);
    const touch = event.pointerType !== 'mouse';
    const drag: DragState = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      projectId: tab.projectId,
      startX: event.clientX,
      startY: event.clientY,
      fromIndex,
      lefts,
      widths,
      gap: elements.length > 1 ? Math.max(0, lefts[1] - (lefts[0] + widths[0])) : 0,
      dragging: false,
      targetIndex: fromIndex,
      longPress: null,
      longPressFired: false,
      tearing: false,
      displayId: null,
    };
    if (touch) {
      // A finger: the strip has to stay swipeable, so no reorder. A long press
      // opens the menu instead, which is where "move" lives for touch.
      const { clientX, clientY } = event;
      drag.longPress = window.setTimeout(() => {
        drag.longPressFired = true;
        onMenuOpen?.();
        setMenu({ projectId: tab.projectId, x: clientX, y: clientY });
      }, LONG_PRESS_MS);
    } else {
      // Switch on the press, the way every tab strip does, so the canvas is
      // already changing by the time the button comes back up.
      requestActivate(tab.projectId);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // A pointer the browser no longer tracks; the drag just will not start.
      }
    }
    dragRef.current = drag;
  };

  const onTabPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (drag.pointerType !== 'mouse') {
      if (drag.longPress !== null && Math.hypot(dx, dy) > TOUCH_SLOP_PX) {
        window.clearTimeout(drag.longPress);
        drag.longPress = null;
      }
      return;
    }
    if (!drag.dragging) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
      drag.dragging = true;
      setDraggingId(drag.projectId);
    }
    const elements = tabElements();

    // Pulled well clear of the strip: the tab is leaving for a window of its
    // own, or for another window. Back over the strip, it is an ordinary
    // reorder again.
    const strip = rootRef.current?.getBoundingClientRect();
    const leaving =
      !!strip &&
      canDragOut &&
      (event.clientY > strip.bottom + TEAR_OFF_PX ||
        event.clientY < strip.top - TEAR_OFF_PX / 2 ||
        event.clientX < strip.left - TEAR_OFF_PX ||
        event.clientX > strip.right + TEAR_OFF_PX);
    if (leaving) {
      if (!drag.tearing) {
        drag.tearing = true;
        for (const element of elements) {
          element.style.transition = `transform ${GLIDE_MS}ms ${GLIDE_EASING}, opacity ${GLIDE_MS}ms`;
          element.style.transform = '';
        }
        const dragged = elements[drag.fromIndex];
        if (dragged) dragged.style.opacity = '0.35';
        drag.targetIndex = drag.fromIndex;
        setTearOff({ projectId: drag.projectId, displayId: null });
      }
      moveTearCard(event.clientX, event.clientY);
      onTearMove?.(drag.projectId, { screenX: event.screenX, screenY: event.screenY });
      const over = canTearOff ? displayAt(event.clientX, event.clientY) : null;
      if (over !== drag.displayId) {
        drag.displayId = over;
        setTearOff({ projectId: drag.projectId, displayId: over });
      }
      return;
    }
    if (drag.tearing) {
      drag.tearing = false;
      drag.displayId = null;
      const dragged = elements[drag.fromIndex];
      if (dragged) dragged.style.opacity = '';
      setTearOff(null);
      onTearEnd?.(drag.projectId, null);
    }
    const last = drag.lefts.length - 1;
    const from = drag.fromIndex;
    const minDx = drag.lefts[0] - drag.lefts[from];
    const maxDx = drag.lefts[last] + drag.widths[last] - (drag.lefts[from] + drag.widths[from]);
    const offset = Math.max(minDx, Math.min(maxDx, dx));
    const dragged = elements[from];
    if (dragged) {
      dragged.style.transition = 'none';
      dragged.style.transform = `translateX(${offset}px)`;
      dragged.style.zIndex = '20';
    }
    const center = drag.lefts[from] + drag.widths[from] / 2 + offset;
    let target = from;
    for (let i = from + 1; i <= last; i++) if (drag.lefts[i] + drag.widths[i] / 2 < center) target = i;
    for (let i = from - 1; i >= 0; i--) if (drag.lefts[i] + drag.widths[i] / 2 > center) target = i;
    drag.targetIndex = target;
    const step = drag.widths[from] + drag.gap;
    elements.forEach((element, i) => {
      if (i === from) return;
      let shift = 0;
      if (from < target && i > from && i <= target) shift = -step;
      else if (from > target && i >= target && i < from) shift = step;
      element.style.transition = `transform ${GLIDE_MS}ms ${GLIDE_EASING}`;
      element.style.transform = shift ? `translateX(${shift}px)` : '';
    });
  };

  const onTabPointerUp = (event: React.PointerEvent<HTMLElement>, tab: ProjectTab) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (drag.tearing) {
      // Let go outside the strip: over another window it moves there, and
      // anywhere else it opens a new window, right here or on the display let
      // go over in the map. Called inside this release on purpose: it is what
      // lets a browser open the window.
      const monitor = displays.find((display) => display.id === drag.displayId) ?? null;
      // A window's only tab has nowhere else to go.
      const placement: TabWindowPlacement | null = canTearOff
        ? monitor
          ? { monitor }
          : { screen: { x: event.screenX, y: event.screenY } }
        : null;
      const dragged = tabElements()[drag.fromIndex];
      if (dragged) dragged.style.opacity = '';
      dragRef.current = null;
      setDraggingId(null);
      setTearOff(null);
      for (const element of tabElements()) {
        element.style.transform = '';
        element.style.transition = '';
        element.style.zIndex = '';
      }
      if (onTearEnd) {
        onTearEnd(drag.projectId, { screenX: event.screenX, screenY: event.screenY, placement });
        return;
      }
      if (placement) onMoveToNewWindow?.(drag.projectId, placement);
      return;
    }
    const tapped = drag.pointerType !== 'mouse' && !drag.longPressFired && drag.longPress !== null;
    endDrag(true);
    if (tapped) requestActivate(tab.projectId);
  };

  // ------------------------------------------------------------- renaming

  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const startRename = (tab: ProjectTab) => {
    if (tab.projectId !== activeProjectId) return;
    hideHover();
    setDraftName(tab.name);
    setRenaming(tab.projectId);
  };
  const finishRename = (commit: boolean) => {
    const id = renaming;
    setRenaming(null);
    if (!commit || !id) return;
    const name = draftName.trim();
    const current = tabs.find((tab) => tab.projectId === id)?.name ?? '';
    if (name && name !== current) onRename(name);
  };

  // ------------------------------------------------------------ keyboard

  const blockedRef = useRef(shortcutsBlocked);
  blockedRef.current = shortcutsBlocked;
  const latest = useRef({ tabs, shownActiveId });
  latest.current = { tabs, shownActiveId };

  useEffect(() => {
    const go = (projectId: string | null) => {
      if (projectId && projectId !== latest.current.shownActiveId) requestActivate(projectId);
    };
    // From the tab already showing as active, so a key held down walks the
    // strip one tab per press even while the canvas is still catching up.
    const step = (delta: number) => go(cycleTab(latest.current.tabs, latest.current.shownActiveId, delta));
    const onKeyDown = (event: KeyboardEvent) => {
      if (blockedRef.current || event.defaultPrevented) return;
      // Any open dialog owns the keyboard.
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
      const { key, code, ctrlKey, metaKey, shiftKey, altKey } = event;
      if (!desktopShortcuts) {
        if (altKey && shiftKey && !ctrlKey && !metaKey && (key === 'ArrowRight' || key === 'ArrowLeft')) {
          event.preventDefault();
          step(key === 'ArrowRight' ? 1 : -1);
        }
        return;
      }
      const command = apple ? metaKey : ctrlKey;
      if (ctrlKey && !metaKey && !altKey && key === 'Tab') {
        event.preventDefault();
        step(shiftKey ? -1 : 1);
      } else if (ctrlKey && !metaKey && !shiftKey && !altKey && (key === 'PageDown' || key === 'PageUp')) {
        event.preventDefault();
        step(key === 'PageDown' ? 1 : -1);
      } else if (command && !shiftKey && !altKey && /^Digit[1-9]$/.test(code)) {
        event.preventDefault();
        go(tabForNumber(latest.current.tabs, Number(code.slice(5))));
      } else if (apple && metaKey && shiftKey && !altKey && (code === 'BracketRight' || code === 'BracketLeft')) {
        event.preventDefault();
        step(code === 'BracketRight' ? 1 : -1);
      } else if (apple && metaKey && altKey && !shiftKey && (key === 'ArrowRight' || key === 'ArrowLeft')) {
        event.preventDefault();
        step(key === 'ArrowRight' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [desktopShortcuts, apple, requestActivate]);

  /**
   * Arrow keys walk the strip, the way a tablist should. A key handled here
   * goes no further: the editor's own window listener reads Delete and the
   * arrows as "delete the selection" and "nudge it".
   */
  const onTabKeyDown = (event: React.KeyboardEvent<HTMLElement>, tab: ProjectTab, index: number) => {
    if (renaming) return;
    const focusAt = (at: number) => {
      const elements = tabElements();
      const next = elements[(at + elements.length) % elements.length];
      next?.focus();
    };
    const moveKey = (event.ctrlKey || event.metaKey) && event.shiftKey;
    if (moveKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      event.stopPropagation();
      const to = index + (event.key === 'ArrowRight' ? 1 : -1);
      if (to >= 0 && to < tabs.length) onMove(tab.projectId, to);
      return;
    }
    if (['ArrowRight', 'ArrowLeft', 'Home', 'End', 'Enter', ' ', 'Delete', 'Backspace', 'F2'].includes(event.key)) {
      event.stopPropagation();
    }
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        focusAt(index + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        focusAt(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusAt(0);
        break;
      case 'End':
        event.preventDefault();
        focusAt(tabs.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        requestActivate(tab.projectId);
        break;
      case 'Delete':
        event.preventDefault();
        onClose(tab.projectId);
        break;
      case 'Backspace':
        // Nothing to do on a tab, but WebKit can still take it as Back.
        event.preventDefault();
        break;
      case 'F2':
        event.preventDefault();
        startRename(tab);
        break;
    }
  };

  // --------------------------------------------------------- all tabs menu

  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return tabs;
    return tabs.filter((tab) => (tab.name || 'Untitled project').toLowerCase().includes(query));
  }, [search, tabs]);

  const menuTab = menu ? tabs.find((tab) => tab.projectId === menu.projectId) ?? null : null;
  // The main window first: in a window a tab was moved into, it is where the
  // tab came from.
  const windowChoices = useMemo(
    () => [...otherWindows].sort((a, b) => Number(!!b.main) - Number(!!a.main)),
    [otherWindows]
  );
  const mainWindowCount = otherWindows.filter((other) => other.main).length;
  const menuIndex = menu ? tabIndexOf(tabs, menu.projectId) : -1;
  const hoverTab = hover ? tabs.find((tab) => tab.projectId === hover.projectId) ?? null : null;
  const hoverIndex = hover ? tabIndexOf(tabs, hover.projectId) : -1;
  const hoverArtboards = useMemo(
    () => (hover ? artboardsFor(hover.projectId) : null),
    // The card asks once per tab it opens on, not once per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hover?.projectId, hover?.projectId === activeProjectId ? activeSummary : null]
  );

  const carryName = carryOver?.projectId
    ? tabs.find((tab) => tab.projectId === carryOver.projectId)?.name || 'Untitled project'
    : null;

  return (
    <div
      ref={rootRef}
      className={cn(
        'relative flex h-10 shrink-0 select-none items-end border-b bg-muted/60 pl-1.5 pr-1 dark:bg-muted/30',
        // A phone has no room for a strip of one.
        tabs.length < 2 && 'max-md:hidden',
        carryOver && 'bg-primary/5',
        className
      )}
      data-project-tabs
    >
      <div
        ref={scrollerRef}
        role="tablist"
        aria-label="Open projects"
        aria-orientation="horizontal"
        onScroll={measureOverflow}
        className={cn(
          'relative flex h-full min-w-0 flex-1 items-end overflow-x-auto overflow-y-hidden overscroll-x-contain pt-1.5',
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          overflow.left && overflow.right && '[mask-image:linear-gradient(to_right,transparent,black_28px,black_calc(100%-28px),transparent)]',
          overflow.left && !overflow.right && '[mask-image:linear-gradient(to_right,transparent,black_28px)]',
          !overflow.left && overflow.right && '[mask-image:linear-gradient(to_left,transparent,black_28px)]'
        )}
      >
        {tabs.map((tab, index) => {
          // Drawn as active as soon as it is picked; `live` is the project
          // actually on the canvas, which is what the summary describes.
          const active = tab.projectId === shownActiveId;
          const live = tab.projectId === activeProjectId;
          const loading = tab.projectId === loadingProjectId;
          const sleeping = !live && isSleeping(tab.projectId);
          const summary = live ? activeSummary ?? tab.summary : tab.summary;
          const accent = summary?.accent ?? NEUTRAL_ACCENT;
          const stacked = (summary?.artboards ?? 0) > 1;
          const nextActive = tabs[index + 1]?.projectId === shownActiveId;
          const name = tab.name || 'Untitled project';
          return (
            <div
              key={tab.projectId}
              data-tab-id={tab.projectId}
              data-active={active || undefined}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onPointerDown={(event) => onTabPointerDown(event, tab)}
              onPointerMove={onTabPointerMove}
              onPointerUp={(event) => onTabPointerUp(event, tab)}
              onPointerCancel={() => endDrag(false)}
              onLostPointerCapture={() => {
                if (dragRef.current?.pointerType === 'mouse') endDrag(true);
              }}
              onPointerEnter={(event) => {
                if (event.pointerType !== 'mouse' || dragRef.current || renaming) return;
                clearHoverTimer();
                const element = event.currentTarget;
                hoverTimerRef.current = window.setTimeout(
                  () => setHover({ projectId: tab.projectId, rect: element.getBoundingClientRect() }),
                  hoverRef.current ? HOVER_CARD_SWAP_MS : HOVER_CARD_DELAY_MS
                );
              }}
              onPointerLeave={() => {
                clearHoverTimer();
                hoverTimerRef.current = window.setTimeout(() => setHover(null), 120);
              }}
              onAuxClick={(event) => {
                if (event.button !== 1) return;
                event.preventDefault();
                onClose(tab.projectId);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                hideHover();
                onMenuOpen?.();
                setMenu({ projectId: tab.projectId, x: event.clientX, y: event.clientY });
              }}
              onDoubleClick={(event) => {
                if ((event.target as HTMLElement).closest('[data-tab-close]')) return;
                startRename(tab);
              }}
              onKeyDown={(event) => onTabKeyDown(event, tab, index)}
              className={cn(
                'group relative flex h-8 min-w-[64px] cursor-default items-center gap-2 rounded-t-[10px] pl-2.5 pr-1.5 text-[13px] outline-none',
                'basis-[216px] shrink',
                'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                active
                  ? 'z-10 -mb-px h-[33px] min-w-[128px] border border-b-0 bg-card text-foreground shadow-[0_-1px_3px_-1px_rgba(0,0,0,0.08)]'
                  : 'text-muted-foreground hover:bg-background/70 hover:text-foreground dark:hover:bg-background/40',
                draggingId === tab.projectId && 'shadow-lg ring-1 ring-border',
                carryOver?.projectId === tab.projectId &&
                  'bg-primary/10 text-foreground ring-2 ring-inset ring-primary motion-safe:-translate-y-px',
                // The hairline between two quiet tabs. Gone beside the active
                // one, which has a border of its own, and beside a hovered one.
                !active && !nextActive && index < tabs.length - 1 &&
                  'after:pointer-events-none after:absolute after:right-0 after:top-1/2 after:h-4 after:w-px after:-translate-y-1/2 after:bg-border hover:after:opacity-0'
              )}
            >
              <span
                className={cn('relative h-3.5 w-3.5 shrink-0', sleeping && 'opacity-60 saturate-50')}
                aria-hidden="true"
              >
                {loading ? (
                  <Loader2Icon className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                ) : (
                  <>
                    {stacked && (
                      <span
                        className="absolute inset-0 translate-x-[2.5px] -translate-y-[2.5px] rounded-[3px] opacity-40"
                        style={{ background: accent }}
                      />
                    )}
                    <span
                      className="absolute inset-0 rounded-[3px] ring-1 ring-inset ring-black/15 dark:ring-white/20"
                      style={{ background: accent }}
                    />
                  </>
                )}
              </span>
              {renaming === tab.projectId ? (
                <input
                  autoFocus
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  onFocus={(event) => event.currentTarget.select()}
                  onBlur={() => finishRename(true)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') finishRename(true);
                    if (event.key === 'Escape') finishRename(false);
                  }}
                  aria-label="Project name"
                  className="h-6 min-w-0 flex-1 rounded border bg-background px-1.5 text-[13px] text-foreground outline-none focus:ring-2 focus:ring-ring"
                />
              ) : (
                <span className={cn('min-w-0 flex-1 truncate', tab.preview && 'italic')}>{name}</span>
              )}
              <button
                type="button"
                data-tab-close
                data-touch-reveal={active || undefined}
                tabIndex={-1}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  hideHover();
                  onClose(tab.projectId);
                }}
                aria-label={`Close ${name}`}
                title={shortcuts.close && active ? `Close tab (${shortcuts.close})` : 'Close tab'}
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-opacity',
                  'hover:bg-muted hover:text-foreground focus-visible:opacity-100',
                  active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                )}
              >
                <XIcon className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => {
            hideHover();
            onNewTab();
          }}
          title={shortcuts.newTab ? `New tab (${shortcuts.newTab})` : 'New tab'}
          aria-label="New tab"
          className="mb-1 ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground"
        >
          <PlusIcon className="h-4 w-4" />
        </button>
      </div>

      <DropdownMenu onOpenChange={(open) => !open && setSearch('')}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title="All open projects"
            aria-label="All open projects"
            className="mb-1 ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground data-[state=open]:bg-background"
          >
            <ChevronDownIcon className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          {tabs.length >= SEARCH_FROM_TABS && (
            <div className="relative px-1 pb-1">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                // The menu's own typeahead would take these keys otherwise.
                onKeyDown={(event) => event.stopPropagation()}
                placeholder="Search open projects"
                aria-label="Search open projects"
                className="h-8 w-full rounded-md border bg-background pl-7 pr-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          )}
          <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
            {tabs.length === 1 ? '1 open project' : `${tabs.length} open projects`}
          </DropdownMenuLabel>
          <div className="max-h-[50vh] overflow-y-auto">
            {filtered.map((tab) => {
              const active = tab.projectId === activeProjectId;
              const summary = active ? activeSummary ?? tab.summary : tab.summary;
              const index = tabIndexOf(tabs, tab.projectId);
              return (
                <DropdownMenuItem
                  key={tab.projectId}
                  onSelect={() => requestActivate(tab.projectId)}
                  className={cn('gap-2', active && 'bg-accent/60')}
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-[3px] ring-1 ring-inset ring-black/15 dark:ring-white/20"
                    style={{ background: summary?.accent ?? NEUTRAL_ACCENT }}
                    aria-hidden="true"
                  />
                  <span className={cn('min-w-0 flex-1 truncate', tab.preview && 'italic')}>
                    {tab.name || 'Untitled project'}
                  </span>
                  {shortcuts.number && index < 8 && (
                    <DropdownMenuShortcut>{shortcuts.number(index + 1)}</DropdownMenuShortcut>
                  )}
                </DropdownMenuItem>
              );
            })}
            {filtered.length === 0 && (
              <p className="px-2 py-3 text-center text-sm text-muted-foreground">No open project matches</p>
            )}
          </div>
          {closed.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Recently closed</DropdownMenuLabel>
              {closed.slice(0, 5).map((entry, index) => (
                <DropdownMenuItem key={entry.projectId} onSelect={() => onReopenClosed(entry.projectId)} className="gap-2">
                  <RotateCcwIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{entry.name || 'Untitled project'}</span>
                  {index === 0 && shortcuts.reopen && <DropdownMenuShortcut>{shortcuts.reopen}</DropdownMenuShortcut>}
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* The right-click (or long-press) menu, anchored where it was asked for. */}
      <DropdownMenu open={!!menuTab} onOpenChange={(open) => !open && setMenu(null)} modal={false}>
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden="true"
            className="pointer-events-none fixed h-px w-px"
            style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }}
          />
        </DropdownMenuTrigger>
        {menuTab && (
          <DropdownMenuContent align="start" sideOffset={2} className="w-60">
            <DropdownMenuItem onSelect={() => onNewTab()}>
              <PlusIcon className="h-4 w-4" />
              New tab
              {shortcuts.newTab && <DropdownMenuShortcut>{shortcuts.newTab}</DropdownMenuShortcut>}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onDuplicate(menuTab.projectId)}>
              <CopyIcon className="h-4 w-4" />
              Duplicate project
            </DropdownMenuItem>
            {menuTab.projectId === activeProjectId && (
              <DropdownMenuItem onSelect={() => startRename(menuTab)}>
                <span className="h-4 w-4" aria-hidden="true" />
                Rename
                <DropdownMenuShortcut>F2</DropdownMenuShortcut>
              </DropdownMenuItem>
            )}
            {onMoveToNewWindow && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={tabs.length < 2}
                  onSelect={() => onMoveToNewWindow(menuTab.projectId, {})}
                >
                  <AppWindowIcon className="h-4 w-4" />
                  Move to new window
                </DropdownMenuItem>
                {tabs.length > 1 && (
                  <MonitorMenuItems
                    monitors={displays}
                    label="Open on display"
                    withSeparator={false}
                    onPick={(monitor) => onMoveToNewWindow(menuTab.projectId, { monitor })}
                  />
                )}
                {onFindDisplays && displays.length < 2 && (
                  <DropdownMenuItem onSelect={() => onFindDisplays()}>
                    <MonitorUpIcon className="h-4 w-4" />
                    Find my other displays
                  </DropdownMenuItem>
                )}
              </>
            )}
            {onMoveToWindow && otherWindows.length > 0 && (
              <>
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Move to window</DropdownMenuLabel>
                {windowChoices.map((other) => (
                  <DropdownMenuItem
                    key={other.id}
                    onSelect={() => onMoveToWindow(menuTab.projectId, other.id)}
                    className="gap-2"
                  >
                    <AppWindowIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{tabWindowName(other, mainWindowCount)}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {other.tabs === 1 ? '1 tab' : `${other.tabs} tabs`}
                    </span>
                  </DropdownMenuItem>
                ))}
              </>
            )}
            {tabs.length > 1 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={menuIndex <= 0} onSelect={() => onMove(menuTab.projectId, menuIndex - 1)}>
                  <span className="h-4 w-4" aria-hidden="true" />
                  Move left
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={menuIndex >= tabs.length - 1}
                  onSelect={() => onMove(menuTab.projectId, menuIndex + 1)}
                >
                  <span className="h-4 w-4" aria-hidden="true" />
                  Move right
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onClose(menuTab.projectId)}>
              <XIcon className="h-4 w-4" />
              Close tab
              {shortcuts.close && menuTab.projectId === activeProjectId && (
                <DropdownMenuShortcut>{shortcuts.close}</DropdownMenuShortcut>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={tabs.length < 2} onSelect={() => onCloseOthers(menuTab.projectId)}>
              <span className="h-4 w-4" aria-hidden="true" />
              Close other tabs
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={menuIndex < 0 || menuIndex >= tabs.length - 1}
              onSelect={() => onCloseToRight(menuTab.projectId)}
            >
              <span className="h-4 w-4" aria-hidden="true" />
              Close tabs to the right
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={closed.length === 0} onSelect={() => onReopenClosed()}>
              <RotateCcwIcon className="h-4 w-4" />
              Reopen closed tab
              {shortcuts.reopen && <DropdownMenuShortcut>{shortcuts.reopen}</DropdownMenuShortcut>}
            </DropdownMenuItem>
          </DropdownMenuContent>
        )}
      </DropdownMenu>

      {/* A tab pulled out of the strip: a small window that follows the
          pointer, and with more than one display a map of them to drop on. */}
      {tearOff &&
        createPortal(
          <>
            <div
              ref={tearCardRef}
              data-tab-tear-card
              className="pointer-events-none fixed left-0 top-0 z-[85] w-64 overflow-hidden rounded-xl border bg-card text-card-foreground shadow-2xl"
            >
              <div className="flex items-center gap-2 border-b bg-muted/60 px-2.5 py-1.5">
                <span
                  aria-hidden="true"
                  className="h-3 w-3 shrink-0 rounded-[3px] ring-1 ring-inset ring-black/15 dark:ring-white/20"
                  style={{
                    background:
                      (tearOff.projectId === activeProjectId
                        ? activeSummary?.accent
                        : tabs.find((tab) => tab.projectId === tearOff.projectId)?.summary?.accent) ?? NEUTRAL_ACCENT,
                  }}
                />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  {tabs.find((tab) => tab.projectId === tearOff.projectId)?.name || 'Untitled project'}
                </span>
              </div>
              <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
                <AppWindowIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {tearTarget
                  ? `Let go to move it to ${tearTarget.name}`
                  : tearOff.displayId
                    ? `Opens on ${displays.find((display) => display.id === tearOff.displayId)?.label ?? 'that display'}`
                    : canTearOff
                      ? 'Let go to open it in a new window'
                      : 'Drop it on another window to move it there'}
              </div>
            </div>
            {canTearOff && displayTiles.length > 1 && (
              <div className="pointer-events-none fixed left-1/2 top-14 z-[84] -translate-x-1/2 rounded-2xl border bg-popover/95 p-3 text-popover-foreground shadow-xl backdrop-blur">
                <p className="mb-2 text-center text-xs text-muted-foreground">Or drop it on a display</p>
                <div className="relative" style={{ width: DISPLAY_MAP.width, height: DISPLAY_MAP.height }}>
                  {displayTiles.map((tile) => {
                    const over = tearOff.displayId === tile.display.id;
                    return (
                      <div
                        key={tile.display.id}
                        data-tear-display={tile.display.id}
                        className={cn(
                          'absolute flex items-end overflow-hidden rounded-md border-2 p-1 text-[10px] leading-tight transition-colors',
                          over ? 'border-primary bg-primary/20 text-foreground' : 'border-border bg-muted text-muted-foreground'
                        )}
                        style={{ left: tile.left, top: tile.top, width: tile.width, height: tile.height }}
                      >
                        <span className="truncate">{tile.display.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>,
          document.body
        )}

      {/* What letting go here would do, beside the pointer. */}
      {carryOver &&
        createPortal(
          <div
            data-tab-carry-label
            className="pointer-events-none fixed z-[80] -translate-x-1/2 whitespace-nowrap rounded-full border bg-popover px-3 py-1 text-xs font-medium text-popover-foreground shadow-lg"
            style={{ left: carryOver.x, top: carryOver.y + 20 }}
          >
            {carryName
              ? `${carryOver.copy ? 'Copy to' : 'Move to'} ${carryName}${onSpringLoad ? '. Hold to open it' : ''}`
              : 'Drop on another tab to send it there'}
          </div>,
          document.body
        )}

      {hover && hoverTab && !draggingId && !menu && !carryOver && (
        <TabHoverCard
          key={hover.projectId}
          tab={hoverTab}
          anchor={hover.rect}
          summary={hover.projectId === activeProjectId ? activeSummary ?? hoverTab.summary : hoverTab.summary}
          isActive={hover.projectId === activeProjectId}
          isSleeping={hover.projectId !== activeProjectId && isSleeping(hover.projectId)}
          keepsUndo={keepsUndo?.(hover.projectId) ?? false}
          artboards={hoverArtboards}
          shortcut={shortcuts.number && hoverIndex >= 0 && hoverIndex < 8 ? shortcuts.number(hoverIndex + 1) : undefined}
        />
      )}
    </div>
  );
}

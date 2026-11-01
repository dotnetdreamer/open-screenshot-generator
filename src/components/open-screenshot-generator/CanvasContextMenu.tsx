"use client";
import React, { useLayoutEffect, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  CopyPlusIcon,
  ClipboardPasteIcon,
  SquareArrowOutUpRightIcon,
  Trash2Icon,
  Group as GroupIcon,
  Ungroup as UngroupIcon,
  UnfoldHorizontal,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface CanvasContextMenuProps {
  x: number;
  y: number;
  canCopy: boolean;
  canPaste: boolean;
  canDelete: boolean;
  /** Two or more layers are selected, so there is an arrangement to make. */
  canGroup: boolean;
  /** At least one selected layer is in a group. */
  canUngroup: boolean;
  onCopy: () => void;
  onPaste: () => void;
  onDelete: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  /**
   * Whether everything selected continues across artboard edges. Null hides
   * the item, which is the case for a click on bare canvas.
   */
  spansArtboards?: boolean | null;
  onToggleSpanArtboards?: () => void;
  /** The other open tabs, for Move to and Copy to. Empty or absent hides both. */
  sendTargets?: SendTarget[];
  /** The layers under the menu go to another tab. */
  onSendLayers?: (projectId: string, mode: 'move' | 'copy') => void;
  /** The artboard under the menu goes to another tab (a click on its empty space). */
  onSendArtboard?: (projectId: string, mode: 'move' | 'copy') => void;
  onClose: () => void;
}

export interface SendTarget {
  projectId: string;
  name: string;
  /** The tab's colour chip, as CSS. */
  accent?: string;
}

// py-2.5 on a coarse pointer: the mouse row is 30px tall, which is a fine
// target for a cursor and a poor one for a fingertip.
const itemClass =
  "relative flex w-full select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [@media(pointer:coarse)]:py-2.5";

/** A pointer resting on a row this long opens its list. Passing over it does not. */
const OPEN_DELAY_MS = 90;
/** How long a list stays open after the pointer leaves its row, on its way to the list. */
const CLOSE_DELAY_MS = 300;

/**
 * A row that opens a list of the other tabs beside the menu: hovering opens it
 * for a mouse, a tap toggles it for a finger. Kept inside the menu's own DOM
 * rather than portalled, because the menu treats any press outside itself as a
 * dismissal and would close before the pick landed.
 *
 * The list is the row's own child, and a transparent strip of it bridges the
 * gap to the row, so the pointer never leaves the row on its way across. On
 * top of that the list stays open for a moment after the pointer does leave,
 * which is what lets a diagonal move to a lower item cut across the next row.
 */
function SendToTabRow({
  label,
  icon,
  targets,
  open,
  onOpenChange,
  onPick,
}: {
  label: string;
  icon: React.ReactNode;
  targets: SendTarget[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (projectId: string) => void;
}) {
  const [flip, setFlip] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const clearTimer = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  const later = (delay: number, run: () => void) => {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      run();
    }, delay);
  };
  useEffect(() => clearTimer, []);
  // Opens to the left when the right side has no room for it.
  useLayoutEffect(() => {
    if (!open) {
      setFlip(false);
      return;
    }
    const rect = listRef.current?.getBoundingClientRect();
    if (rect && rect.right > window.innerWidth - 4) setFlip(true);
  }, [open]);
  return (
    <div
      className="relative"
      data-send-to-tab-row={label}
      onPointerEnter={(event) => {
        if (event.pointerType !== 'mouse') return;
        if (open) clearTimer();
        else later(OPEN_DELAY_MS, () => onOpenChange(true));
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== 'mouse') return;
        if (open) later(CLOSE_DELAY_MS, () => onOpenChange(false));
        else clearTimer();
      }}
    >
      <button
        type="button"
        className={itemClass}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          clearTimer();
          onOpenChange(!open);
        }}
      >
        {icon}
        {label}
        <ChevronRightIcon aria-hidden className="ml-auto" />
      </button>
      {open && (
        // The padding is the bridge: it reaches from the row's edge, across the
        // menu's own padding and border, to the list.
        <div ref={listRef} className={cn('absolute -top-1 z-[101]', flip ? 'right-full pr-2' : 'left-full pl-2')}>
          <div
            role="menu"
            aria-label={label}
            className={cn(
              'max-h-[60vh] min-w-[12rem] max-w-[18rem] overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
              'animate-in fade-in-0 zoom-in-95'
            )}
          >
            {targets.map((target) => (
              <button
                key={target.projectId}
                type="button"
                role="menuitem"
                className={itemClass}
                onClick={() => onPick(target.projectId)}
              >
                <span
                  aria-hidden
                  className="h-3 w-3 shrink-0 rounded-[3px] ring-1 ring-inset ring-black/15 dark:ring-white/20"
                  style={{ background: target.accent ?? 'hsl(var(--muted-foreground) / 0.35)' }}
                />
                <span className="truncate">{target.name || 'Untitled project'}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Custom right-click menu for the canvas. Rendered in a portal at the body
// (position: fixed breaks inside transformed ancestors like the zoomed canvas).
export function CanvasContextMenu({
  x,
  y,
  canCopy,
  canPaste,
  canDelete,
  canGroup,
  canUngroup,
  onCopy,
  onPaste,
  onDelete,
  onGroup,
  onUngroup,
  spansArtboards = null,
  onToggleSpanArtboards,
  sendTargets = [],
  onSendLayers,
  onSendArtboard,
  onClose,
}: CanvasContextMenuProps) {
  const sendLayers = canCopy && sendTargets.length > 0 && onSendLayers;
  const sendArtboard = !canCopy && sendTargets.length > 0 && onSendArtboard;
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });
  // One list open at a time, so the row the pointer rests on wins.
  const [openList, setOpenList] = useState<'move' | 'copy' | null>(null);
  const listToggle = (list: 'move' | 'copy') => (open: boolean) =>
    setOpenList((current) => (open ? list : current === list ? null : current));

  // Keep the menu inside the viewport when opened near an edge
  useLayoutEffect(() => {
    const rect = menuRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      x: Math.max(4, Math.min(x, window.innerWidth - rect.width - 4)),
      y: Math.max(4, Math.min(y, window.innerHeight - rect.height - 4)),
    });
  }, [x, y]);

  useEffect(() => {
    // pointerdown, not mousedown: a tap outside has to dismiss the menu too,
    // and on touch the compatibility mousedown may never arrive.
    const handlePointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    // Close when the canvas scrolls or the window changes under the menu
    document.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      data-canvas-context-menu
      // No overflow-hidden: the Move to and Copy to lists open beside the menu.
      className={cn(
        "fixed z-[100] min-w-[10rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
        "animate-in fade-in-0 zoom-in-95"
      )}
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        className={itemClass}
        disabled={!canCopy}
        onClick={() => {
          onCopy();
          onClose();
        }}
      >
        <CopyIcon />
        Copy
        <span className="ml-auto pl-4 text-xs text-muted-foreground">Ctrl+C</span>
      </button>
      <button
        type="button"
        className={itemClass}
        disabled={!canPaste}
        onClick={() => {
          onPaste();
          onClose();
        }}
      >
        <ClipboardPasteIcon />
        Paste
        <span className="ml-auto pl-4 text-xs text-muted-foreground">Ctrl+V</span>
      </button>
      {(sendLayers || sendArtboard) && (
        <>
          <div className="-mx-1 my-1 h-px bg-border" />
          <SendToTabRow
            label={sendLayers ? 'Move to tab' : 'Move artboard to tab'}
            icon={<SquareArrowOutUpRightIcon />}
            targets={sendTargets}
            open={openList === 'move'}
            onOpenChange={listToggle('move')}
            onPick={(projectId) => {
              if (sendLayers) onSendLayers(projectId, 'move');
              else if (sendArtboard) onSendArtboard(projectId, 'move');
              onClose();
            }}
          />
          <SendToTabRow
            label={sendLayers ? 'Copy to tab' : 'Copy artboard to tab'}
            icon={<CopyPlusIcon />}
            targets={sendTargets}
            open={openList === 'copy'}
            onOpenChange={listToggle('copy')}
            onPick={(projectId) => {
              if (sendLayers) onSendLayers(projectId, 'copy');
              else if (sendArtboard) onSendArtboard(projectId, 'copy');
              onClose();
            }}
          />
        </>
      )}
      {(canGroup || canUngroup) && (
        <>
          <div className="-mx-1 my-1 h-px bg-border" />
          <button
            type="button"
            className={itemClass}
            disabled={!canGroup}
            onClick={() => {
              onGroup();
              onClose();
            }}
          >
            <GroupIcon />
            Group
            <span className="ml-auto pl-4 text-xs text-muted-foreground">Ctrl+G</span>
          </button>
          <button
            type="button"
            className={itemClass}
            disabled={!canUngroup}
            onClick={() => {
              onUngroup();
              onClose();
            }}
          >
            <UngroupIcon />
            Ungroup
            <span className="ml-auto pl-4 text-xs text-muted-foreground">Ctrl+Shift+G</span>
          </button>
        </>
      )}
      {spansArtboards !== null && onToggleSpanArtboards && (
        <>
          <div className="-mx-1 my-1 h-px bg-border" />
          {/* A toggle: the check means every selected layer has it on. A
              click turns it on for all of them, or off when all had it. */}
          <button
            type="button"
            className={itemClass}
            aria-pressed={spansArtboards}
            onClick={() => {
              onToggleSpanArtboards();
              onClose();
            }}
          >
            <UnfoldHorizontal />
            Continue across artboards
            <CheckIcon aria-hidden className={cn("ml-auto", !spansArtboards && "opacity-0")} />
          </button>
        </>
      )}
      {/* Separated and tinted: the destructive item sits directly under Paste,
          and these rows are one fingertip apart on a touch screen. */}
      <div className="-mx-1 my-1 h-px bg-border" />
      <button
        type="button"
        // Same destructive affordance the artboard toolbar's delete uses.
        className={cn(itemClass, "text-destructive hover:bg-destructive/90 hover:text-destructive-foreground focus:bg-destructive/90 focus:text-destructive-foreground")}
        disabled={!canDelete}
        onClick={() => {
          onDelete();
          onClose();
        }}
      >
        <Trash2Icon />
        Delete
        <span className="ml-auto pl-4 text-xs opacity-70">Del</span>
      </button>
    </div>,
    document.body
  );
}

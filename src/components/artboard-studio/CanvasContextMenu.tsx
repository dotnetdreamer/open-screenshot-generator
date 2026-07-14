"use client";
import React, { useLayoutEffect, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CopyIcon, ClipboardPasteIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CanvasContextMenuProps {
  x: number;
  y: number;
  canCopy: boolean;
  canPaste: boolean;
  onCopy: () => void;
  onPaste: () => void;
  onClose: () => void;
}

const itemClass =
  "relative flex w-full select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0";

// Custom right-click menu for the canvas. Rendered in a portal at the body
// (position: fixed breaks inside transformed ancestors like the zoomed canvas).
export function CanvasContextMenu({
  x,
  y,
  canCopy,
  canPaste,
  onCopy,
  onPaste,
  onClose,
}: CanvasContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

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
    const handleMouseDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    // Close when the canvas scrolls or the window changes under the menu
    document.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className={cn(
        "fixed z-[100] min-w-[10rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
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
    </div>,
    document.body
  );
}

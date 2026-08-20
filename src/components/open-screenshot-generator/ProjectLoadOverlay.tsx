"use client";

import { useEffect, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProjectLoadStep } from "./LoadStatusBar";

interface ProjectLoadOverlayProps {
  /** True for as long as a project is being opened. */
  active: boolean;
  /** What the loader is doing, when it reports it. */
  status?: ProjectLoadStep | null;
  /** Held back this long, so a fast local open never flashes a card. */
  delayMs?: number;
  className?: string;
}

/**
 * The card that sits over the canvas while a project opens.
 *
 * The thin LoadStatusBar at the top of the editor is easy to miss, and opening
 * a project from an account is not a quick wait: the document, every screen
 * recording and every imported font come down one at a time and are then written
 * to IndexedDB. This says which of those is happening and how far along it is,
 * on the canvas, where the person is already looking.
 *
 * Pointer-events-none on purpose. It reports, it does not trap: the canvas
 * underneath is whatever was open before, and an open that fails leaves the user
 * exactly where they were with a toast.
 */
export function ProjectLoadOverlay({
  active,
  status,
  delayMs = 250,
  className,
}: ProjectLoadOverlayProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!active) {
      setShow(false);
      return;
    }
    const t = setTimeout(() => setShow(true), delayMs);
    return () => clearTimeout(t);
  }, [active, delayMs]);

  if (!show) return null;

  const pct =
    typeof status?.ratio === "number"
      ? Math.min(100, Math.max(0, Math.round(status.ratio * 100)))
      : null;
  const title = status?.name ? `Opening ${status.name}` : "Opening project";

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 z-50 flex items-center justify-center p-6",
        className
      )}
      role="status"
      aria-live="polite"
      data-export-exclude
    >
      <div className="w-full max-w-xs rounded-xl border bg-card/95 p-4 shadow-lg backdrop-blur">
        <div className="flex items-center gap-2">
          <Loader2Icon className="h-4 w-4 shrink-0 animate-spin text-primary" />
          <p className="truncate text-sm font-medium">{title}</p>
          {pct !== null && (
            <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
              {pct}%
            </span>
          )}
        </div>

        <div className="relative mt-3 h-1.5 w-full overflow-hidden rounded-full bg-primary/15">
          {pct !== null ? (
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
              style={{ width: `${pct}%` }}
            />
          ) : (
            <div className="absolute inset-y-0 left-0 w-2/5 rounded-full bg-primary animate-progress-sweep" />
          )}
        </div>

        <p className="mt-2 truncate text-xs text-muted-foreground">
          {status?.step || "Reading your project"}
        </p>
      </div>
    </div>
  );
}

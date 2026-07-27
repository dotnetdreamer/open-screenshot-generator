"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type LoadPhase = "idle" | "templates" | "project";

interface LoadStatusBarProps {
  phase: LoadPhase;
  /** Determinate progress for the 'templates' phase. */
  templateProgress: { done: number; total: number };
  className?: string;
}

/**
 * Thin top-of-editor progress bar that tells the user what the app is doing
 * during the load window that previously showed nothing (or the fake blank
 * artboard):
 *   - 'templates' : determinate, "Loading templates 42 / 111" while the startup
 *                   gallery fetch runs.
 *   - 'project'   : indeterminate sweep, "Opening project" while a saved project
 *                   or template is read from IndexedDB and its artboards build.
 *
 * Sits just above the sticky Toolbar. Renders nothing when idle. After a phase
 * finishes it briefly shows a full/complete state, then fades out, so the bar
 * doesn't vanish abruptly mid-progress.
 */
export function LoadStatusBar({ phase, templateProgress, className }: LoadStatusBarProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (phase !== "idle") {
      setVisible(true);
      return;
    }
    // Let the bar linger a beat at 100% before fading, so the transition reads
    // as "done" rather than "disappeared".
    const t = setTimeout(() => setVisible(false), 400);
    return () => clearTimeout(t);
  }, [phase]);

  if (!visible) return null;

  const { done, total } = templateProgress;
  const isDeterminate = phase === "templates" && total > 0;
  const pct = isDeterminate ? Math.min(100, Math.round((done / total) * 100)) : phase === "idle" ? 100 : 0;

  const label =
    phase === "templates"
      ? total > 0
        ? `Loading templates ${done} / ${total}`
        : "Loading templates"
      : phase === "project"
        ? "Opening project"
        : "Ready";

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 z-[60] flex flex-col transition-opacity duration-300",
        phase === "idle" ? "opacity-0" : "opacity-100",
        className
      )}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      {/* The bar itself */}
      <div className="relative h-0.5 w-full overflow-hidden bg-primary/15">
        {isDeterminate ? (
          <div
            className="h-full bg-primary transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        ) : phase === "idle" ? (
          <div className="h-full w-full bg-primary" />
        ) : (
          // Indeterminate sweep for the fast, unmeasurable project-open phase.
          <div className="absolute inset-y-0 left-0 w-2/5 rounded-full bg-primary animate-progress-sweep" />
        )}
      </div>

      {/* Phase label pill, aligned to the start so it never covers the canvas center */}
      <div className="mt-1 pl-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/95 px-2 py-0.5 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur">
          <span className="relative flex h-1.5 w-1.5">
            {phase !== "idle" && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
            )}
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
          </span>
          {label}
        </span>
      </div>
    </div>
  );
}

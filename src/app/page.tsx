"use client";
import { Suspense } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { OpenScreenshotGeneratorLayout } from "@/components/open-screenshot-generator/OpenScreenshotGeneratorLayout";
import { AppReadySignal } from "@/components/open-screenshot-generator/AppReadySignal";
import { EditorChromeSkeleton } from "@/components/open-screenshot-generator/EditorChromeSkeleton";
import { ClipboardProvider } from "@/contexts/ClipboardContext";
import { PANEL_PARAM } from "@/lib/panels/url";

// The panel window's own root. Split out of the main bundle because the editor
// never needs it and a panel window is opened one at a time, by hand.
const DetachedPanelsWindow = dynamic(
  () =>
    import("@/components/open-screenshot-generator/panels/DetachedPanelsWindow").then(
      (module) => module.DetachedPanelsWindow
    ),
  { ssr: false }
);

/**
 * Which of the two apps this document is.
 *
 * `?panel=` means a detached panel window: the same bundle, on another monitor,
 * showing the editor's dock and nothing else. Everything below the Suspense
 * boundary is client only under `output: 'export'`, so reading the query here
 * costs nothing extra and cannot mismatch hydration. The skeleton that the
 * static HTML carries is hidden in a panel window before first paint by the
 * boot script in lib/panels/boot.ts.
 */
function EditorOrPanel() {
  const params = useSearchParams();
  if (params.get(PANEL_PARAM)) return <DetachedPanelsWindow />;
  return (
    <ClipboardProvider>
      <OpenScreenshotGeneratorLayout />
      {/* Closes the desktop splash. A panel window must never send it: the
          splash belongs to the editor's first paint, not to a tool window. */}
      <AppReadySignal />
    </ClipboardProvider>
  );
}

export default function HomePage() {
  return (
    <main className="h-screen w-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Suspense is required because both branches read the URL, and
          useSearchParams bails out of static prerendering (output: 'export').
          The fallback paints the editor frame into the static HTML so the app
          appears instantly instead of a blank page until the bundle hydrates. */}
      <Suspense fallback={<EditorChromeSkeleton />}>
        <EditorOrPanel />
      </Suspense>
    </main>
  );
}

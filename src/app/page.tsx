"use client";
import { Suspense } from "react";
import { OpenScreenshotGeneratorLayout } from "@/components/open-screenshot-generator/OpenScreenshotGeneratorLayout";
import { AppReadySignal } from "@/components/open-screenshot-generator/AppReadySignal";
import { MobileNotice } from "@/components/open-screenshot-generator/MobileNotice";
import { EditorChromeSkeleton } from "@/components/open-screenshot-generator/EditorChromeSkeleton";
import { ClipboardProvider } from "@/contexts/ClipboardContext";

export default function HomePage() {
  return (
    <main className="h-screen w-screen flex flex-col bg-background text-foreground overflow-hidden">
      <MobileNotice />
      <ClipboardProvider>
        {/* Suspense is required because OpenScreenshotGeneratorLayout calls useSearchParams(),
            which bails out of static prerendering (output: 'export'). The fallback
            paints the editor frame into the static HTML so the app appears
            instantly instead of a blank page until the bundle hydrates. */}
        <Suspense fallback={<EditorChromeSkeleton />}>
          <OpenScreenshotGeneratorLayout />
          <AppReadySignal />
        </Suspense>
      </ClipboardProvider>
    </main>
  );
}

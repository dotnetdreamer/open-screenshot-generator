"use client";
import { Suspense } from "react";
import { ArtboardStudioLayout } from "@/components/artboard-studio/ArtboardStudioLayout";
import { AppReadySignal } from "@/components/artboard-studio/AppReadySignal";
import { MobileNotice } from "@/components/artboard-studio/MobileNotice";
import { EditorChromeSkeleton } from "@/components/artboard-studio/EditorChromeSkeleton";
import { ClipboardProvider } from "@/contexts/ClipboardContext";

export default function HomePage() {
  return (
    <main className="h-screen w-screen flex flex-col bg-background text-foreground overflow-hidden">
      <MobileNotice />
      <ClipboardProvider>
        {/* Suspense is required because ArtboardStudioLayout calls useSearchParams(),
            which bails out of static prerendering (output: 'export'). The fallback
            paints the editor frame into the static HTML so the app appears
            instantly instead of a blank page until the bundle hydrates. */}
        <Suspense fallback={<EditorChromeSkeleton />}>
          <ArtboardStudioLayout />
          <AppReadySignal />
        </Suspense>
      </ClipboardProvider>
    </main>
  );
}

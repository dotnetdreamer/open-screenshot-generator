"use client";
import { Suspense } from "react";
import { ArtboardStudioLayout } from "@/components/artboard-studio/ArtboardStudioLayout";
import { AppReadySignal } from "@/components/artboard-studio/AppReadySignal";
import { ClipboardProvider } from "@/contexts/ClipboardContext";

export default function HomePage() {
  return (
    <main className="h-screen w-screen flex flex-col bg-background text-foreground overflow-hidden">
      <ClipboardProvider>
        {/* Suspense is required because ArtboardStudioLayout calls useSearchParams(),
            which bails out of static prerendering (output: 'export'). */}
        <Suspense>
          <ArtboardStudioLayout />
          <AppReadySignal />
        </Suspense>
      </ClipboardProvider>
    </main>
  );
}

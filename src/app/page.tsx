"use client";
import { ArtboardStudioLayout } from "@/components/artboard-studio/ArtboardStudioLayout";
import { ClipboardProvider } from "@/contexts/ClipboardContext";

export default function HomePage() {
  return (
    <main className="h-screen w-screen flex flex-col bg-background text-foreground overflow-hidden">
      <ClipboardProvider>
        <ArtboardStudioLayout />
      </ClipboardProvider>
    </main>
  );
}

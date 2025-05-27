"use client";
import { ArtboardStudioLayout } from "@/components/artboard-studio/ArtboardStudioLayout";

export default function HomePage() {
  return (
    <main className="h-screen w-screen flex flex-col bg-background text-foreground overflow-hidden">
      <ArtboardStudioLayout />
    </main>
  );
}

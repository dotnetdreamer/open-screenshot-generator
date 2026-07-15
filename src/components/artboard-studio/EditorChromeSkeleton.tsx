import { Skeleton } from "@/components/ui/skeleton";

/**
 * Static shell shown as the Suspense fallback for the editor. Because
 * ArtboardStudioLayout calls useSearchParams under `output: 'export'`, the page
 * bails out to client-side rendering — without a fallback the served HTML is
 * blank until the whole JS bundle downloads and hydrates. This paints the
 * editor's frame (left palette rail, toolbar, canvas, right dock) from the first
 * byte, so the app looks present immediately and there's no white flash before
 * hydration.
 *
 * Widths mirror the real chrome (sidebar 18rem, right dock w-80/20rem) so the
 * swap to the live UI doesn't shift layout.
 */
export function EditorChromeSkeleton() {
  return (
    <div className="flex h-full w-full overflow-hidden bg-background" aria-hidden="true">
      {/* Left palette rail (matches Sidebar --sidebar-width: 18rem) */}
      <aside className="hidden w-[18rem] shrink-0 flex-col border-r bg-sidebar md:flex">
        <div className="flex items-center gap-3 border-b px-2 py-2.5">
          <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-2.5 w-32" />
          </div>
        </div>
        <div className="flex flex-col gap-4 p-3">
          <Skeleton className="h-9 w-full rounded-md" />
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 9 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square w-full rounded-md" />
            ))}
          </div>
          <Skeleton className="h-3 w-24" />
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square w-full rounded-md" />
            ))}
          </div>
        </div>
      </aside>

      {/* Center: toolbar + canvas */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b bg-card px-3">
          <Skeleton className="h-7 w-16 rounded-md" />
          <Skeleton className="h-7 w-16 rounded-md" />
          <div className="mx-1 h-5 w-px bg-border" />
          <Skeleton className="h-7 w-7 rounded-md" />
          <Skeleton className="h-7 w-7 rounded-md" />
          <div className="mx-1 h-5 w-px bg-border" />
          <Skeleton className="h-7 w-24 rounded-md" />
          <div className="ml-auto flex items-center gap-2">
            <Skeleton className="h-7 w-20 rounded-md" />
            <Skeleton className="h-7 w-20 rounded-md" />
          </div>
        </div>
        <div className="flex flex-1 items-start gap-4 overflow-hidden p-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-3">
              <Skeleton className="h-[560px] w-[270px] rounded-[2rem]" />
              <Skeleton className="h-4 w-24 rounded" />
            </div>
          ))}
        </div>
      </div>

      {/* Right dock (matches w-80 / 20rem) */}
      <aside className="hidden h-full w-80 shrink-0 flex-col border-l bg-card lg:flex">
        <div className="flex h-9 items-center border-b px-3">
          <Skeleton className="h-3.5 w-24" />
        </div>
        <div className="flex flex-col gap-4 p-4">
          <Skeleton className="h-24 w-full rounded-md" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-full rounded-md" />
          <Skeleton className="h-9 w-full rounded-md" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-9 w-full rounded-md" />
        </div>
      </aside>
    </div>
  );
}

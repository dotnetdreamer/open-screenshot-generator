"use client";

// The right dock's contents, in one place.
//
// It renders in two windows now: docked beside the canvas, and on its own in a
// detached window that can sit on a second monitor. Both render THIS component,
// fed the same [`DockData`] and the same handler bag, so a change to the tab
// strip or the resize divider cannot land in one and miss the other. The
// difference between the two is entirely in what the host passes: the editor
// passes its live state and its own handlers, the detached window passes a
// snapshot off the bus and handlers that post an intent back.
//
// The chrome around it (the border, the phone bottom sheet, the collapsed rail)
// stays with the host, because only the docked one has any.

import type React from 'react';
import { useRef } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { PropertiesPanel } from '../PropertiesPanel';
import { HistoryPanel } from '../HistoryPanel';
import { VersionsPanel } from '../VersionsPanel';
import { LayersPanel } from '../LayersPanel';
import type { ArtboardElement, ArtboardState } from '@/types/artboard';
import type { ProjectVersionMeta } from '@/lib/versions/store';
import type { DetachableKey } from '@/lib/i18n/project';
import type { DockData, LocalizableField, RightDockTab } from '@/lib/panels/protocol';
import type { DetachablePanel } from '@/lib/panels/url';

/**
 * How tall the layers list is, in the DOCK.
 *
 * A detached window keeps its own (see DetachedPanelsWindow): it is typically a
 * whole screen tall where the dock is a column, so one number cannot flatter
 * both, and a drag in one must not rewrite the other. Same reasoning as the
 * phone bottom sheet, which also keeps its split to itself.
 */
export const RIGHT_DOCK_LAYERS_HEIGHT_KEY = 'abs-right-dock-layers-height';

/** px, keeps the layers list usable. */
export const LAYERS_SECTION_MIN = 120;
/** px, keeps the properties form usable. */
export const PROPERTIES_SECTION_MIN = 160;

/** Everything the panels can ask the editor to do. */
export interface DockHandlers {
  onUpdateElement: (updates: Partial<ArtboardElement>) => void;
  onUpdateElementById: (elementId: string, updates: Partial<ArtboardElement>) => void;
  onTranslateElement: (elementId: string) => void;
  onUpdateArtboardDetails: (updates: Partial<ArtboardState>, scope?: 'board' | 'all') => void;
  onResetLocaleField: (field: LocalizableField) => void;
  onToggleLocaleDetach: (keys: DetachableKey[], detach: boolean) => void;
  onResetLocaleOverrides: (scope: 'element' | 'artboard' | 'project') => void;
  onJumpToHistory: (index: number) => void;
  onSaveNamedVersion: (label: string) => void;
  onRestoreVersion: (version: ProjectVersionMeta) => void;
  onOpenVersionCopy: (version: ProjectVersionMeta) => void;
  onDeleteVersion: (version: ProjectVersionMeta) => void;
  onSelectElement: (elementId: string) => void;
  onMoveElementLayer: (elementId: string, direction: 'up' | 'down') => void;
  onDeleteElement: (elementId: string) => void;
  onRenameElement: (elementId: string, newName: string) => void;
}

interface RightDockPanelsProps {
  data: DockData;
  handlers: DockHandlers;
  /** Which panels this window shows. A detached single panel gets only its own. */
  panels: DetachablePanel[];
  tab: RightDockTab;
  onTabChange: (tab: RightDockTab) => void;
  /** Height of the layers section in px. Ignored when layers are not shown. */
  layersHeight: number;
  onLayersHeightChange: (height: number) => void;
  /** Fired once, when the drag ends, for whoever wants to persist it. */
  onLayersHeightCommit?: (height: number) => void;
  /** Buttons at the right end of the tab strip (collapse, detach, reattach). */
  headerActions?: React.ReactNode;
  className?: string;
}

const TAB_LABELS: Record<RightDockTab, string> = {
  properties: 'Properties',
  history: 'History',
  versions: 'Versions',
};

const TAB_ORDER: RightDockTab[] = ['properties', 'history', 'versions'];

export function RightDockPanels({
  data,
  handlers,
  panels,
  tab,
  onTabChange,
  layersHeight,
  onLayersHeightChange,
  onLayersHeightCommit,
  headerActions,
  className,
}: RightDockPanelsProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const dividerDragRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
    lastHeight: number;
  } | null>(null);

  const tabs = TAB_ORDER.filter((candidate) => panels.includes(candidate));
  const showLayers = panels.includes('layers');
  // A window holding nothing but the layers list still needs a value for the
  // Tabs root, and Radix wants one it recognises.
  const activeTab = tabs.includes(tab) ? tab : (tabs[0] ?? 'properties');

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => onTabChange(value as RightDockTab)}
      className={cn('flex min-h-0 flex-1 flex-col', className)}
    >
      {/* Underline tabs, not the default segmented pill: inside a 320px dock the
          pill reads as a single button rather than a row of tabs. -mb-px drops
          the active underline onto the header rule so the two line up. */}
      <div className="flex h-9 shrink-0 items-stretch justify-between border-b pl-2 pr-1.5">
        <TabsList className="-mb-px h-auto items-stretch gap-4 rounded-none bg-transparent p-0">
          {tabs.map((value) => (
            <TabsTrigger
              key={value}
              value={value}
              className="rounded-none border-b-2 border-transparent bg-transparent px-0.5 text-xs text-muted-foreground shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              {TAB_LABELS[value]}
            </TabsTrigger>
          ))}
          {tabs.length === 0 && (
            <span className="self-center text-xs font-semibold text-foreground">Layers</span>
          )}
        </TabsList>
        {headerActions ? (
          <div className="flex items-center gap-0.5">{headerActions}</div>
        ) : null}
      </div>

      <div ref={contentRef} className="flex min-h-0 flex-1 flex-col">
        {/* data-[state=active]:flex, never a bare flex: a bare flex class beats
            Radix's [hidden] and the inactive tab would still take up the dock. */}
        {tabs.includes('properties') && (
          <TabsContent
            value="properties"
            className="m-0 min-h-[10rem] flex-1 overflow-hidden data-[state=active]:flex"
          >
            <PropertiesPanel
              selectedElement={data.selectedElement}
              onUpdateElement={handlers.onUpdateElement}
              onUpdateElementById={handlers.onUpdateElementById}
              onTranslateElement={handlers.onTranslateElement}
              activeArtboardDetails={data.activeArtboardDetails}
              onUpdateArtboardDetails={handlers.onUpdateArtboardDetails}
              activeLocale={data.activeLocale}
              baseLocale={data.baseLocale}
              localeOverride={data.localeOverride}
              baseElement={data.baseElement}
              onResetLocaleField={handlers.onResetLocaleField}
              localeDetached={data.localeDetached}
              onToggleLocaleDetach={handlers.onToggleLocaleDetach}
              onResetLocaleOverrides={handlers.onResetLocaleOverrides}
              className="h-full border-l-0 shadow-none"
            />
          </TabsContent>
        )}
        {/* A tab each, because they answer different questions: History is this
            sitting and dies with the reload, Versions is what survives one.
            Sharing a split gave each of them half a dock and neither enough rows
            to be read. */}
        {tabs.includes('history') && (
          <TabsContent
            value="history"
            className="m-0 min-h-[10rem] flex-1 overflow-hidden data-[state=active]:flex"
          >
            <HistoryPanel
              entries={data.history}
              currentIndex={data.historyIndex}
              onJumpTo={handlers.onJumpToHistory}
            />
          </TabsContent>
        )}
        {tabs.includes('versions') && (
          <TabsContent
            value="versions"
            className="m-0 min-h-[10rem] flex-1 overflow-hidden data-[state=active]:flex"
          >
            <VersionsPanel
              versions={data.versions}
              projectId={data.activeProjectId}
              isBusy={data.isVersionBusy}
              onSaveNamed={handlers.onSaveNamedVersion}
              onRestore={handlers.onRestoreVersion}
              onOpenCopy={handlers.onOpenVersionCopy}
              onDelete={handlers.onDeleteVersion}
            />
          </TabsContent>
        )}

        {showLayers && tabs.length > 0 && (
          <div
            role="separator"
            aria-orientation="horizontal"
            title="Drag to resize"
            // The bar stays 8px, which is all a cursor needs, but a fingertip
            // cannot aim at 8px. On a coarse pointer the ::before spreads the
            // hit area 12px above and below without moving anything on screen;
            // it is positioned, so it hit-tests above the static panels either
            // side. Gated on the pointer, because those same 12px would be dead
            // space stolen from both panels for someone holding a mouse.
            className={cn(
              'group relative z-10 h-2 shrink-0 cursor-row-resize touch-none border-y bg-muted/50 hover:bg-primary/15',
              "[@media(pointer:coarse)]:before:absolute [@media(pointer:coarse)]:before:-inset-y-3 [@media(pointer:coarse)]:before:inset-x-0 [@media(pointer:coarse)]:before:content-['']"
            )}
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              dividerDragRef.current = {
                pointerId: e.pointerId,
                startY: e.clientY,
                startHeight: layersHeight,
                lastHeight: layersHeight,
              };
            }}
            onPointerMove={(e) => {
              const drag = dividerDragRef.current;
              if (!drag || drag.pointerId !== e.pointerId) return;
              const dockHeight = contentRef.current?.getBoundingClientRect().height ?? 800;
              const max = Math.max(LAYERS_SECTION_MIN, dockHeight - PROPERTIES_SECTION_MIN);
              const next = Math.round(
                Math.min(max, Math.max(LAYERS_SECTION_MIN, drag.startHeight + (drag.startY - e.clientY)))
              );
              drag.lastHeight = next;
              onLayersHeightChange(next);
            }}
            onPointerUp={(e) => {
              const drag = dividerDragRef.current;
              if (!drag || drag.pointerId !== e.pointerId) return;
              dividerDragRef.current = null;
              onLayersHeightCommit?.(drag.lastHeight);
            }}
            onPointerCancel={() => {
              dividerDragRef.current = null;
            }}
          >
            <div className="absolute left-1/2 top-1/2 h-0.5 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/40 group-hover:bg-primary/60" />
          </div>
        )}

        {showLayers && (
          <div
            // A layers-only window gives the whole height to the list; sharing
            // with a tab above it keeps the dragged split, capped so a persisted
            // height taller than the current window still leaves a form.
            style={tabs.length > 0 ? { height: layersHeight } : undefined}
            className={cn(
              'overflow-hidden',
              tabs.length > 0 ? 'max-h-[calc(100%-10rem)] shrink-0' : 'min-h-0 flex-1'
            )}
          >
            <LayersPanel
              elements={data.layerElements}
              selectedElementId={data.selectedElementId}
              onSelectElement={handlers.onSelectElement}
              onMoveElementLayer={handlers.onMoveElementLayer}
              onDeleteElement={handlers.onDeleteElement}
              onRenameElement={handlers.onRenameElement}
              activeArtboardName={data.activeArtboardName}
              activeLocale={data.activeLocale}
              localeStates={data.layerLocaleStates}
            />
          </div>
        )}
      </div>
    </Tabs>
  );
}

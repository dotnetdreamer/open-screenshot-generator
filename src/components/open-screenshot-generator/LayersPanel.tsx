"use client";
import type React from 'react';
import { useState, useRef, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ArtboardElement } from '@/types/artboard';
import { TypeIcon, SquareIcon, CircleIcon, TriangleIcon, SmartphoneIcon, ImagePlusIcon, ArrowUpIcon, ArrowDownIcon, ImageIcon, Trash2Icon, ClapperboardIcon, PointerIcon, LayersIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getElementDisplayName } from '@/lib/historyLabels';
import { localeName } from '@/lib/i18n/locales';

/** How one element resolves in the active locale. Mirrors overrideStateFor. */
export type LocaleOverrideState = 'inherited' | 'manual' | 'auto' | 'stale-manual' | 'stale-auto';

// Flat section of the right dock (bottom half, under the resize divider in
// OpenScreenshotGeneratorLayout): header strip + scrolling list, filling
// whatever height the dock gives it.
interface LayersPanelProps {
  elements: ArtboardElement[];
  // All selected element ids on this artboard; the last one is the "primary"
  // selection used for scroll-into-view.
  selectedElementIds: string[];
  // Plain click selects the element alone; { additive: true } (Shift/Ctrl/Cmd
  // click) toggles it in/out of the selection.
  onSelectElement: (elementId: string, modifiers?: { additive?: boolean }) => void;
  onMoveElementLayer: (elementId: string, direction: 'up' | 'down') => void;
  onDeleteElement: (elementId: string) => void;
  onRenameElement: (elementId: string, newName: string) => void;
  activeArtboardName?: string;
  /** Locale overlay: null means the base language is showing and no dots render. */
  activeLocale?: string | null;
  /** elementId -> state in activeLocale. Missing entries read as 'inherited'. */
  localeStates?: Record<string, LocaleOverrideState>;
}

/**
 * The cheapest of the four untranslated affordances, and the only one that is
 * already on screen while you work. Three looks, not five: whether a string was
 * typed or machine written is the translation table's job, all this row has to
 * answer is "does this layer still say the base language".
 */
function localeDotFor(
  element: ArtboardElement,
  state: LocaleOverrideState,
  locale: string
): { className: string; title: string } | null {
  const name = localeName(locale);
  switch (state) {
    case 'manual':
    case 'auto':
      return {
        className: 'border-primary bg-primary',
        title: `Written for ${name}`,
      };
    case 'stale-manual':
    case 'stale-auto':
      return {
        className: 'border-amber-500 bg-amber-500',
        title: `The base language changed after this was written for ${name}`,
      };
    default:
      // Hollow, and only where a fallback is worth flagging. Text is always
      // worth flagging; a device frame or an image inherits its base asset
      // perfectly well and nagging about every one of them would make the
      // panel unreadable.
      return element.type === 'text'
        ? {
            className: 'border-muted-foreground/50 bg-transparent',
            title: `Nothing written for ${name} yet, this layer falls back to the base language`,
          }
        : null;
  }
}

const getElementIcon = (element: ArtboardElement) => {
  switch (element.type) {
    case 'text':
      return <TypeIcon className="w-4 h-4 mr-2 shrink-0 text-primary" />;
    case 'image':
      return <ImageIcon className="w-4 h-4 mr-2 shrink-0 text-primary" />;
    case 'shape':
      switch (element.shapeType) {
        case 'rectangle':
          return <SquareIcon className="w-4 h-4 mr-2 shrink-0 text-primary" />;
        case 'circle':
          return <CircleIcon className="w-4 h-4 mr-2 shrink-0 text-primary" />;
        case 'triangle':
          return <TriangleIcon className="w-4 h-4 mr-2 shrink-0 text-primary" />;
        default:
          return <SquareIcon className="w-4 h-4 mr-2 shrink-0 text-primary" />;
      }
    case 'device':
       return <SmartphoneIcon className="w-4 h-4 mr-2 shrink-0 text-primary" />;
    case 'video':
      return <ClapperboardIcon className="w-4 h-4 mr-2 shrink-0 text-primary" />;
    case 'video-device':
      return <SmartphoneIcon className="w-4 h-4 mr-2 shrink-0 text-primary" />;
    case 'gesture':
      return <PointerIcon className="w-4 h-4 mr-2 shrink-0 text-primary" />;
    default:
      return <ImagePlusIcon className="w-4 h-4 mr-2 shrink-0 text-primary" />;
  }
};

// Shared with the History panel so a layer reads the same in both.
const getElementLabel = getElementDisplayName;

export function LayersPanel({ elements, selectedElementIds, onSelectElement, onMoveElementLayer, onDeleteElement, onRenameElement, activeArtboardName, activeLocale = null, localeStates }: LayersPanelProps) {
  const [editingElementId, setEditingElementId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedRowRef = useRef<HTMLDivElement>(null);
  const primarySelectedElementId = selectedElementIds.length > 0 ? selectedElementIds[selectedElementIds.length - 1] : null;

  // Keep the selected row visible when selection happens on the canvas;
  // 'nearest' makes this a no-op if the row is already in view.
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [primarySelectedElementId]);

  // Focus input when editing starts
  useEffect(() => {
    if (editingElementId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingElementId]);

  const handleDoubleClick = (element: ArtboardElement) => {
    setEditingElementId(element.id);
    setEditingName(element.name || getElementLabel(element));
  };

  const handleRenameSubmit = () => {
    if (editingElementId && editingName.trim()) {
      onRenameElement(editingElementId, editingName.trim());
    }
    setEditingElementId(null);
    setEditingName('');
  };

  const handleRenameCancel = () => {
    setEditingElementId(null);
    setEditingName('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRenameSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleRenameCancel();
    }
  };

  const reversedElements = [...elements].reverse(); // Display top-most element at the top of the list

  // Returns null, not an empty span, when the base language is showing: the
  // panel has to render exactly what it rendered before this feature existed
  // for every project that has no languages, which is all of them today.
  const localeDot = (element: ArtboardElement) => {
    if (!activeLocale) return null;
    const dot = localeDotFor(element, localeStates?.[element.id] ?? 'inherited', activeLocale);
    if (!dot) return null;
    return (
      <span
        role="img"
        aria-label={dot.title}
        title={dot.title}
        className={cn('mr-1.5 h-2 w-2 shrink-0 rounded-full border', dot.className)}
      />
    );
  };

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b px-3">
        <LayersIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-semibold" title={activeArtboardName}>
          {activeArtboardName ? `Layers: ${activeArtboardName}` : 'Layers'}
        </span>
        {selectedElementIds.length > 1 && (
          <span className="ml-auto shrink-0 rounded-full border px-1.5 text-[11px] tabular-nums text-muted-foreground">
            {selectedElementIds.length} selected
          </span>
        )}
      </div>
      {!activeArtboardName ? (
        <div className="p-3 text-sm text-muted-foreground">Select an artboard to see its layers.</div>
      ) : (
        // Native overflow container, not Radix ScrollArea: ScrollArea under a
        // height-capped flex parent silently stops scrolling.
        <div className="min-h-0 flex-1 overflow-y-auto">
          {reversedElements.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground">No elements on this artboard.</div>
          ) : (
            <div className="p-2 space-y-1">
              {reversedElements.map((element, index) => (
                <div
                  key={element.id}
                  ref={element.id === primarySelectedElementId ? selectedRowRef : undefined}
                  className={cn(
                    "flex items-center w-full justify-start p-1 rounded-md text-sm",
                    selectedElementIds.includes(element.id) ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                  )}
                >
                  {editingElementId === element.id ? (
                    <div className="flex items-center flex-grow mr-1">
                      {getElementIcon(element)}
                      <Input
                        ref={inputRef}
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onBlur={handleRenameSubmit}
                        className="h-6 text-xs border-0 p-1 focus-visible:ring-1 focus-visible:ring-primary"
                        placeholder="Element name..."
                      />
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      className="flex-grow justify-start p-1 h-auto text-left items-center hover:bg-transparent focus-visible:ring-0 max-w-[160px]"
                      onClick={(e) => onSelectElement(element.id, { additive: e.shiftKey || e.ctrlKey || e.metaKey })}
                      onDoubleClick={() => handleDoubleClick(element)}
                      title={`Double-click to rename "${getElementLabel(element)}"`}
                    >
                      {getElementIcon(element)}
                      <span className="truncate flex-grow ml-1">{getElementLabel(element)}</span>
                    </Button>
                  )}
                  {localeDot(element)}
                  <div className="flex-shrink-0 ml-auto space-x-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 p-0"
                      title="Move layer up"
                      onClick={() => onMoveElementLayer(element.id, 'up')}
                      disabled={index === 0} // Cannot move top-most element further up
                    >
                      <ArrowUpIcon className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 p-0"
                      title="Move layer down"
                      onClick={() => onMoveElementLayer(element.id, 'down')}
                      disabled={index === reversedElements.length - 1} // Cannot move bottom-most element further down
                    >
                      <ArrowDownIcon className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      title="Delete element"
                      onClick={() => onDeleteElement(element.id)}
                    >
                      <Trash2Icon className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

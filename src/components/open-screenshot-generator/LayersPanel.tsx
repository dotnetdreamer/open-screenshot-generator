"use client";
import type React from 'react';
import { useState, useRef, useEffect, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ArtboardElement, ElementSelectModifiers } from '@/types/artboard';
import { TypeIcon, SquareIcon, CircleIcon, TriangleIcon, SmartphoneIcon, ImagePlusIcon, ArrowUpIcon, ArrowDownIcon, ImageIcon, Trash2Icon, ClapperboardIcon, PointerIcon, LayersIcon, MusicIcon, FolderIcon, FolderOpenIcon, ChevronRightIcon, ChevronDownIcon, SquareCheckIcon, SquareDashedIcon, Group as GroupIcon, Ungroup as UngroupIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getElementDisplayName } from '@/lib/historyLabels';
import { localeName } from '@/lib/i18n/locales';
import { buildLayerRows, groupCommandState } from '@/lib/elementGeometry';
import { useTouchDrag } from '@/hooks/use-touch-drag';
import { ELEMENT_DRAG_TYPE } from './PreviewTimelineBar';

/** How one element resolves in the active locale. Mirrors overrideStateFor. */
export type LocaleOverrideState = 'inherited' | 'manual' | 'auto' | 'stale-manual' | 'stale-auto';

// Flat section of the right dock (bottom half, under the resize divider in
// OpenScreenshotGeneratorLayout): header strip + scrolling list, filling
// whatever height the dock gives it.
interface LayersPanelProps {
  elements: ArtboardElement[];
  selectedElementId: string | null;
  /**
   * Every selected layer. The list is the way to pick several with a finger,
   * since the canvas marquee is mouse and pen only.
   */
  selectedElementIds?: string[];
  onSelectElement: (elementId: string, modifiers?: ElementSelectModifiers) => void;
  onMoveElementLayer: (elementId: string, direction: 'up' | 'down') => void;
  onDeleteElement: (elementId: string) => void;
  onRenameElement: (elementId: string, newName: string) => void;
  /** Group and ungroup the selection, the same two commands Properties offers. */
  onGroupElements?: () => void;
  onUngroupElements?: () => void;
  /** Free the group a row points at, whether or not it is selected. */
  onUngroupById?: (groupId: string) => void;
  onRenameGroup?: (groupId: string, name: string) => void;
  /**
   * A layer dragged onto another row: it lands beside `anchorId` in the
   * z-order and joins `groupId`, or leaves its group when that is null.
   */
  onDropLayer?: (
    elementId: string,
    anchorId: string,
    side: 'above' | 'below',
    groupId: string | null
  ) => void;
  activeArtboardName?: string;
  /** Locale overlay: null means the base language is showing and no dots render. */
  activeLocale?: string | null;
  /** elementId -> state in activeLocale. Missing entries read as 'inherited'. */
  localeStates?: Record<string, LocaleOverrideState>;
}

/** Which row is being renamed. Groups and layers share the one input. */
type EditingTarget = { kind: 'element' | 'group'; id: string };

/**
 * Where a dragged layer would land.
 *
 * `anchorId` and `side` are z-order, which is what the editor moves the layer
 * by; `lineKey` is the row the line is drawn under, and the two differ for a
 * group header, where the line sits under the header and the layer lands above
 * the group's topmost member.
 */
type DropTarget = {
  anchorId: string;
  side: 'above' | 'below';
  groupId: string | null;
  lineKey: string;
};

/**
 * Read the drop target off the row under the pointer.
 *
 * The rows carry it as data attributes rather than one handler each, so the
 * mouse's dragover and the finger's pointermove resolve a drop the same way.
 */
function dropTargetAt(node: Element | null | undefined): DropTarget | null {
  const row = node?.closest?.('[data-drop-anchor]') as HTMLElement | null;
  if (!row) return null;
  const anchorId = row.dataset.dropAnchor;
  if (!anchorId) return null;
  return {
    anchorId,
    side: row.dataset.dropSide === 'above' ? 'above' : 'below',
    groupId: row.dataset.dropGroup || null,
    lineKey: row.dataset.dropLine ?? anchorId,
  };
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
    case 'audio':
      return <MusicIcon className="w-4 h-4 mr-2 shrink-0 text-primary" />;
    default:
      return <ImagePlusIcon className="w-4 h-4 mr-2 shrink-0 text-primary" />;
  }
};

// Shared with the History panel so a layer reads the same in both.
const getElementLabel = getElementDisplayName;

export function LayersPanel({ elements, selectedElementId, selectedElementIds = [], onSelectElement, onMoveElementLayer, onDeleteElement, onRenameElement, onGroupElements, onUngroupElements, onUngroupById, onRenameGroup, onDropLayer, activeArtboardName, activeLocale = null, localeStates }: LayersPanelProps) {
  const [editing, setEditing] = useState<EditingTarget | null>(null);
  const [editingName, setEditingName] = useState<string>('');
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  /** The layer being dragged, and where the list says it would land. */
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedRowRef = useRef<HTMLDivElement>(null);

  // Top layer first, with each group's members gathered under it.
  const rows = useMemo(() => buildLayerRows(elements), [elements]);
  // Depth in the same top-down order, which is what the up and down buttons
  // move a layer through. A member of a group is no different here: the
  // buttons speak about the z-order, not about the row it is drawn in.
  const depthOf = useMemo(() => {
    const order = new Map<string, number>();
    elements.forEach((el, index) => order.set(el.id, elements.length - 1 - index));
    return order;
  }, [elements]);
  const selected = useMemo(() => new Set(selectedElementIds), [selectedElementIds]);
  const commands = useMemo(
    () => groupCommandState(elements, selectedElementIds),
    [elements, selectedElementIds]
  );

  /** The group the selected layer belongs to, if it is in one. */
  const selectedGroupId = useMemo(
    () => elements.find((el) => el.id === selectedElementId)?.groupId ?? null,
    [elements, selectedElementId]
  );

  // Selecting a layer on the canvas opens the group holding it, or the list
  // would have no row for what the canvas says is selected.
  useEffect(() => {
    if (!selectedGroupId) return;
    setCollapsedGroups((ids) => ids.filter((id) => id !== selectedGroupId));
  }, [selectedGroupId]);

  // Keep the selected row visible when selection happens on the canvas;
  // 'nearest' makes this a no-op if the row is already in view. Collapsing a
  // group moves the rows around, so that counts as a reason to look again.
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedElementId, collapsedGroups]);

  // Focus input when editing starts
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const startEditing = (target: EditingTarget, name: string) => {
    setEditing(target);
    setEditingName(name);
  };

  const handleRenameSubmit = () => {
    const name = editingName.trim();
    if (editing && name) {
      if (editing.kind === 'group') onRenameGroup?.(editing.id, name);
      else onRenameElement(editing.id, name);
    }
    setEditing(null);
    setEditingName('');
  };

  const handleRenameCancel = () => {
    setEditing(null);
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

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups((ids) =>
      ids.includes(groupId) ? ids.filter((id) => id !== groupId) : [...ids, groupId]
    );
  };

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

  /** Take a drop, unless it would put the layer back where it already is. */
  const applyDrop = (dragId: string, target: DropTarget | null) => {
    setDraggingId(null);
    setDropTarget(null);
    if (!target || target.anchorId === dragId) return;
    onDropLayer?.(dragId, target.anchorId, target.side, target.groupId);
  };

  /** A drag with a finger, which fires no HTML5 drag event at all. */
  const touchDrag = useTouchDrag<{ label: string; elementId: string }>({
    onMove: (payload, point) => {
      setDraggingId(payload.elementId);
      const target = dropTargetAt(document.elementFromPoint(point.x, point.y));
      setDropTarget(target && target.anchorId !== payload.elementId ? target : null);
    },
    onDrop: (payload, point) => {
      applyDrop(payload.elementId, dropTargetAt(document.elementFromPoint(point.x, point.y)));
    },
    // The list is the drop target, so nothing has to be moved out of the way.
    dimSheets: false,
  });

  /** The line under the row a drop would land beneath. */
  const dropLine = (key: string) =>
    dropTarget?.lineKey === key ? (
      <span
        aria-hidden="true"
        // Named so a test can ask where the line is without reading classes.
        data-drop-indicator=""
        className="pointer-events-none absolute inset-x-1 -bottom-1 h-0.5 rounded-full bg-primary"
      />
    ) : null;

  const renameInput = (placeholder: string, label: string) => (
    <div className="flex items-center flex-grow mr-1">
      <Input
        ref={inputRef}
        aria-label={label}
        value={editingName}
        onChange={(e) => setEditingName(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleRenameSubmit}
        className="h-6 text-xs border-0 p-1 focus-visible:ring-1 focus-visible:ring-primary"
        placeholder={placeholder}
      />
    </div>
  );

  const elementRow = (element: ArtboardElement, nested: boolean) => {
    const depth = depthOf.get(element.id) ?? 0;
    return (
      <div
        key={element.id}
        ref={element.id === selectedElementId ? selectedRowRef : undefined}
        // Draggable so a layer can be dropped onto the App Preview
        // timeline, which animates it at the second you dropped it
        // (see PreviewTimelineBar). Harmless everywhere else: nothing
        // else on screen accepts this type.
        // Not while renaming: a draggable ancestor stops the mouse
        // from selecting text inside the row's input.
        draggable={!(editing?.kind === 'element' && editing.id === element.id)}
        onDragStart={(e) => {
          e.dataTransfer.setData(ELEMENT_DRAG_TYPE, element.id);
          e.dataTransfer.effectAllowed = 'copyMove';
          setDraggingId(element.id);
          // Dragging a layer that is already part of a selection must
          // not throw the rest of it away.
          if (!selected.has(element.id)) onSelectElement(element.id);
        }}
        onDragEnd={() => {
          setDraggingId(null);
          setDropTarget(null);
        }}
        // Where a drop lands if it is taken here: beneath this row, in this
        // row's group, which is no group at all for a layer outside one.
        data-drop-anchor={element.id}
        data-drop-side="below"
        data-drop-group={element.groupId ?? ''}
        data-drop-line={element.id}
        className={cn(
          "group relative flex items-center w-full justify-start p-1 rounded-md text-sm",
          nested && "ml-4 w-auto",
          draggingId === element.id && "opacity-50",
          selected.has(element.id) ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
        )}
      >
        {editing?.kind === 'element' && editing.id === element.id ? (
          <>
            {getElementIcon(element)}
            {renameInput('Element name...', 'Rename layer')}
          </>
        ) : (
          <Button
            variant="ghost"
            className="flex-grow justify-start p-1 h-auto text-left items-center hover:bg-transparent focus-visible:ring-0 max-w-[160px]"
            onClick={(e) => onSelectElement(element.id, { toggle: e.shiftKey || e.metaKey || e.ctrlKey, single: e.altKey })}
            onDoubleClick={() => startEditing({ kind: 'element', id: element.id }, element.name || getElementLabel(element))}
            title={`Double-click to rename "${getElementLabel(element)}"`}
            // The name is the drag handle for a finger, which fires none of
            // the HTML5 drag events the mouse path above uses. The row's own
            // buttons are left alone, so a long press on Delete still deletes.
            {...touchDrag.bind({ label: getElementLabel(element), elementId: element.id })}
          >
            {getElementIcon(element)}
            <span className="truncate flex-grow ml-1">{getElementLabel(element)}</span>
          </Button>
        )}
        {localeDot(element)}
        <div className="flex-shrink-0 ml-auto space-x-0.5">
          {/* Shift-click builds a multi-selection with a mouse, and a finger
              has no shift key: this is the only way to pick a second layer on
              a phone, where the canvas marquee is mouse and pen only. Shown on
              hover with a mouse, always on a touch screen (see globals.css). */}
          <Button
            variant="ghost"
            size="icon"
            data-touch-reveal
            className={cn(
              'h-6 w-6 p-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100',
              selected.has(element.id) ? 'opacity-100' : 'opacity-0'
            )}
            title={selected.has(element.id) ? 'Take out of the selection' : 'Add to the selection'}
            onClick={() => onSelectElement(element.id, { toggle: true })}
          >
            {selected.has(element.id) ? (
              <SquareCheckIcon className="w-3 h-3" />
            ) : (
              <SquareDashedIcon className="w-3 h-3" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 p-0"
            title="Move layer up"
            onClick={() => onMoveElementLayer(element.id, 'up')}
            disabled={depth === 0} // Cannot move top-most element further up
          >
            <ArrowUpIcon className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 p-0"
            title="Move layer down"
            onClick={() => onMoveElementLayer(element.id, 'down')}
            disabled={depth === elements.length - 1} // Cannot move bottom-most element further down
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
        {dropLine(element.id)}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col bg-card">
      {touchDrag.ghostNode}
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b px-3">
        <LayersIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-semibold" title={activeArtboardName}>
          {activeArtboardName ? `Layers: ${activeArtboardName}` : 'Layers'}
        </span>
        {activeArtboardName && (onGroupElements || onUngroupElements) ? (
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 p-0"
              title="Group selected layers (Ctrl+G)"
              disabled={!commands.canGroup}
              onClick={() => onGroupElements?.()}
            >
              <GroupIcon className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 p-0"
              title="Ungroup selected layers (Ctrl+Shift+G)"
              disabled={!commands.canUngroup}
              onClick={() => onUngroupElements?.()}
            >
              <UngroupIcon className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : null}
      </div>
      {!activeArtboardName ? (
        <div className="p-3 text-sm text-muted-foreground">Select an artboard to see its layers.</div>
      ) : (
        // Native overflow container, not Radix ScrollArea: ScrollArea under a
        // height-capped flex parent silently stops scrolling.
        <div
          className="min-h-0 flex-1 overflow-y-auto"
          // One set of handlers for the whole list rather than a pair per row:
          // the row under the pointer is read off the event's target, the same
          // way the finger path reads it off the point.
          onDragOver={(e) => {
            if (!draggingId) return;
            const target = dropTargetAt(e.target as Element);
            if (!target || target.anchorId === draggingId) {
              setDropTarget(null);
              return;
            }
            // Without this the browser refuses the drop and no drop fires.
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setDropTarget(target);
          }}
          onDrop={(e) => {
            if (!draggingId) return;
            e.preventDefault();
            applyDrop(draggingId, dropTargetAt(e.target as Element));
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            setDropTarget(null);
          }}
        >
          {rows.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground">No elements on this artboard.</div>
          ) : (
            <div className="p-2 space-y-1">
              {rows.map((row) => {
                if (row.kind === 'element') return elementRow(row.element, false);
                const collapsed = collapsedGroups.includes(row.groupId);
                const wholeGroupSelected = row.members.every((el) => selected.has(el.id));
                const renaming = editing?.kind === 'group' && editing.id === row.groupId;
                return (
                  <div
                    key={row.groupId}
                    // Present only while a drop would land in this group.
                    data-drop-into={dropTarget?.groupId === row.groupId ? row.groupId : undefined}
                    className={cn(
                      'space-y-1 rounded-md',
                      // The whole block lights up while a layer is held over
                      // it, because what the drop decides is the group, not
                      // which member the pointer happens to be on.
                      dropTarget?.groupId === row.groupId && 'ring-1 ring-primary/60'
                    )}
                  >
                    <div
                      // A drop on the header goes to the top of the group,
                      // which in z-order is above the topmost member.
                      data-drop-anchor={row.members[0].id}
                      data-drop-side="above"
                      data-drop-group={row.groupId}
                      data-drop-line={`group:${row.groupId}`}
                      className={cn(
                        'relative flex w-full items-center justify-start rounded-md p-1 text-sm',
                        wholeGroupSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                      )}
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 p-0"
                        title={collapsed ? 'Show what is in this group' : 'Hide what is in this group'}
                        onClick={() => toggleGroup(row.groupId)}
                      >
                        {collapsed ? (
                          <ChevronRightIcon className="h-3 w-3" />
                        ) : (
                          <ChevronDownIcon className="h-3 w-3" />
                        )}
                      </Button>
                      {renaming ? (
                        <>
                          {collapsed ? (
                            <FolderIcon className="mr-2 h-4 w-4 shrink-0 text-primary" />
                          ) : (
                            <FolderOpenIcon className="mr-2 h-4 w-4 shrink-0 text-primary" />
                          )}
                          {renameInput('Group name', 'Rename group')}
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          className="h-auto max-w-[150px] flex-grow items-center justify-start p-1 text-left hover:bg-transparent focus-visible:ring-0"
                          onClick={(e) =>
                            onSelectElement(row.members[0].id, {
                              toggle: e.shiftKey || e.metaKey || e.ctrlKey,
                            })
                          }
                          onDoubleClick={() => startEditing({ kind: 'group', id: row.groupId }, row.name)}
                          title={`Double-click to rename group "${row.name}"`}
                        >
                          {collapsed ? (
                            <FolderIcon className="mr-2 h-4 w-4 shrink-0 text-primary" />
                          ) : (
                            <FolderOpenIcon className="mr-2 h-4 w-4 shrink-0 text-primary" />
                          )}
                          <span className="ml-1 flex-grow truncate font-medium">{row.name}</span>
                        </Button>
                      )}
                      <span
                        className="ml-1 shrink-0 text-xs tabular-nums text-muted-foreground"
                        title={`${row.members.length} ${row.members.length === 1 ? 'layer' : 'layers'} in this group`}
                      >
                        {row.members.length}
                      </span>
                      <div className="ml-auto flex-shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 p-0"
                          title={`Ungroup "${row.name}"`}
                          onClick={() => onUngroupById?.(row.groupId)}
                        >
                          <UngroupIcon className="h-3 w-3" />
                        </Button>
                      </div>
                      {dropLine(`group:${row.groupId}`)}
                    </div>
                    {collapsed ? null : row.members.map((member) => elementRow(member, true))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

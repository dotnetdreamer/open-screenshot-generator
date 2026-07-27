"use client";
import type React from 'react';
import { useState, useRef, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ArtboardElement } from '@/types/artboard';
import { TypeIcon, SquareIcon, CircleIcon, TriangleIcon, SmartphoneIcon, ImagePlusIcon, ArrowUpIcon, ArrowDownIcon, ImageIcon, Trash2Icon, ClapperboardIcon, PointerIcon, LayersIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

// Flat section of the right dock (bottom half, under the resize divider in
// ArtboardStudioLayout): header strip + scrolling list, filling whatever
// height the dock gives it.
interface LayersPanelProps {
  elements: ArtboardElement[];
  selectedElementId: string | null;
  onSelectElement: (elementId: string) => void;
  onMoveElementLayer: (elementId: string, direction: 'up' | 'down') => void;
  onDeleteElement: (elementId: string) => void;
  onRenameElement: (elementId: string, newName: string) => void;
  activeArtboardName?: string;
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

const getElementLabel = (element: ArtboardElement): string => {
    // Use custom name if provided
    if (element.name && element.name.trim()) {
        return element.name;
    }

    // Fallback to auto-generated labels
    let label = `${element.type.charAt(0).toUpperCase() + element.type.slice(1)}`;
    if (element.type === 'text' && element.content) {
        label = element.content.substring(0, 20) || "Text";
        if (element.content.length > 20) label += '...';
    } else if (element.type === 'image') {
        label = element.imageAlt || 'Image';
        if (label.length > 20) label = label.substring(0, 20) + '...';
    } else if (element.type === 'shape') {
        label = `${element.shapeType.charAt(0).toUpperCase() + element.shapeType.slice(1)} Shape`;
    } else if (element.type === 'device') {
        label = `${element.deviceType.charAt(0).toUpperCase() + element.deviceType.slice(1)} Device`;
    } else if (element.type === 'video-device') {
        label = `${element.deviceType.charAt(0).toUpperCase() + element.deviceType.slice(1)} Recording`;
    } else if (element.type === 'video') {
        label = 'Recording';
    } else if (element.type === 'gesture') {
        label = `${element.gestureType.charAt(0).toUpperCase() + element.gestureType.slice(1)} Hint`;
    }
    return label;
};

export function LayersPanel({ elements, selectedElementId, onSelectElement, onMoveElementLayer, onDeleteElement, onRenameElement, activeArtboardName }: LayersPanelProps) {
  const [editingElementId, setEditingElementId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedRowRef = useRef<HTMLDivElement>(null);

  // Keep the selected row visible when selection happens on the canvas;
  // 'nearest' makes this a no-op if the row is already in view.
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedElementId]);

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

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b px-3">
        <LayersIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-semibold" title={activeArtboardName}>
          {activeArtboardName ? `Layers: ${activeArtboardName}` : 'Layers'}
        </span>
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
                  ref={element.id === selectedElementId ? selectedRowRef : undefined}
                  className={cn(
                    "flex items-center w-full justify-start p-1 rounded-md text-sm",
                    element.id === selectedElementId ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
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
                      onClick={() => onSelectElement(element.id)}
                      onDoubleClick={() => handleDoubleClick(element)}
                      title={`Double-click to rename "${getElementLabel(element)}"`}
                    >
                      {getElementIcon(element)}
                      <span className="truncate flex-grow ml-1">{getElementLabel(element)}</span>
                    </Button>
                  )}
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

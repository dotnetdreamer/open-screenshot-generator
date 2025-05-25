
"use client";
import type React from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import {
  PlusSquareIcon,
  CopyIcon,
  Trash2Icon,
  ArrowLeftFromLineIcon,
  ArrowRightFromLineIcon,
  ShuffleIcon, // Using Shuffle as a general move icon
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ArtboardToolbarProps {
  artboardId: string;
  onAddNew: () => void;
  onDuplicate: (artboardId: string) => void;
  onDelete: (artboardId: string) => void;
  onMove: (artboardId: string, direction: 'left' | 'right') => void;
  canDelete: boolean;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  className?: string;
}

export function ArtboardToolbar({
  artboardId,
  onAddNew,
  onDuplicate,
  onDelete,
  onMove,
  canDelete,
  canMoveLeft,
  canMoveRight,
  className,
}: ArtboardToolbarProps) {
  return (
    <TooltipProvider delayDuration={100}>
      <div
        className={cn(
          "absolute -top-10 left-1/2 -translate-x-1/2 z-10",
          "flex items-center space-x-1 p-1 bg-card border border-border rounded-md shadow-lg",
          className
        )}
        onClick={(e) => e.stopPropagation()} // Prevent artboard deselection
        onMouseDown={(e) => e.stopPropagation()} // Prevent drag initiation
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="w-7 h-7" onClick={onAddNew}>
              <PlusSquareIcon className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom"><p>Add New Artboard After</p></TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="w-7 h-7" onClick={() => onDuplicate(artboardId)}>
              <CopyIcon className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom"><p>Duplicate Artboard</p></TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="w-7 h-7 text-destructive hover:text-destructive-foreground hover:bg-destructive/90"
              onClick={() => onDelete(artboardId)}
              disabled={!canDelete}
            >
              <Trash2Icon className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom"><p>Delete Artboard</p></TooltipContent>
        </Tooltip>
        
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="w-7 h-7"
              onClick={() => onMove(artboardId, 'left')}
              disabled={!canMoveLeft}
            >
              <ArrowLeftFromLineIcon className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom"><p>Move Artboard Left</p></TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="w-7 h-7"
              onClick={() => onMove(artboardId, 'right')}
              disabled={!canMoveRight}
            >
              <ArrowRightFromLineIcon className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom"><p>Move Artboard Right</p></TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

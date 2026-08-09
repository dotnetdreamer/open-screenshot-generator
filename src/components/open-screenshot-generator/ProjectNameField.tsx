"use client";

// The project name, and renaming it by double-clicking.
//
// Lifted out of Toolbar.tsx unchanged so it could move down to the floating
// bar next to the zoom controls without the behaviour being reimplemented:
// double-click to edit, Enter or blur to commit, Escape to revert, and an
// empty name is ignored rather than saved.
//
// It sits over the canvas now, so pointer events are stopped from reaching it:
// a drag inside the text field would otherwise start a canvas pan, and a
// double-click would reach the canvas's own handlers.

import React, { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface ProjectNameFieldProps {
  currentProjectName?: string;
  onRenameProject?: (newName: string) => void;
  className?: string;
}

export function ProjectNameField({
  currentProjectName,
  onRenameProject,
  className,
}: ProjectNameFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(currentProjectName || 'Untitled Project');
  const inputRef = useRef<HTMLInputElement>(null);

  // Follow renames that happen elsewhere (loading a project, the AI agent).
  useEffect(() => {
    setDraft(currentProjectName || 'Untitled Project');
  }, [currentProjectName]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const startEditing = () => {
    setIsEditing(true);
    setDraft(currentProjectName || 'Untitled Project');
  };

  const commit = () => {
    if (draft.trim() && onRenameProject) {
      onRenameProject(draft.trim());
    }
    setIsEditing(false);
  };

  const cancel = () => {
    setDraft(currentProjectName || 'Untitled Project');
    setIsEditing(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
    // Delete/Backspace inside the field must not reach the canvas shortcut
    // that deletes the selected element.
    event.stopPropagation();
  };

  return (
    <div
      className={cn('flex items-center', className)}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {isEditing ? (
        <Input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commit}
          // h-8 matches the icon buttons in the zoom/tool pills, so the bar
          // keeps one height whether the name is being edited or not.
          className="h-8 w-48 rounded-full text-sm font-medium"
          placeholder="Project name..."
        />
      ) : (
        <div
          className="flex h-8 cursor-pointer items-center rounded-full px-2 hover:bg-accent/50"
          onDoubleClick={(event) => {
            event.stopPropagation();
            startEditing();
          }}
          title="Double-click to rename project"
        >
          <span className="block max-w-[16rem] truncate text-sm font-medium text-foreground">
            {currentProjectName || 'Untitled Project'}
          </span>
        </div>
      )}
    </div>
  );
}

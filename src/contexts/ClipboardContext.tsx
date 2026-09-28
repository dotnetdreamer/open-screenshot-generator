"use client";
import React, { createContext, useContext, useState } from 'react';
import type { ArtboardElement } from '@/types/artboard';

// The editor's own clipboard, for elements. Separate from the system
// clipboard, which carries images into the screenshot intake instead.
//
// It holds a LIST, because a selection can be several layers. `clipboardItem`
// is the first of them and stays the handle for everything that only deals
// with one, so widening this did not have to touch those call sites.
interface ClipboardContextType {
  clipboardItem: ArtboardElement | null;
  clipboardItems: ArtboardElement[];
  copyToClipboard: (element: ArtboardElement) => void;
  copyManyToClipboard: (elements: ArtboardElement[]) => void;
  clearClipboard: () => void;
}

// Create the context with default values
const ClipboardContext = createContext<ClipboardContextType>({
  clipboardItem: null,
  clipboardItems: [],
  copyToClipboard: () => {},
  copyManyToClipboard: () => {},
  clearClipboard: () => {},
});

// Custom hook to use the clipboard context
export const useClipboard = () => useContext(ClipboardContext);

export const ClipboardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [clipboardItems, setClipboardItems] = useState<ArtboardElement[]>([]);

  // Deep copied on the way in, so a later edit to the element on the board
  // cannot reach back into what was copied.
  const copyManyToClipboard = (elements: ArtboardElement[]) => {
    setClipboardItems(JSON.parse(JSON.stringify(elements)));
  };

  const copyToClipboard = (element: ArtboardElement) => {
    copyManyToClipboard([element]);
  };

  const clearClipboard = () => {
    setClipboardItems([]);
  };

  return (
    <ClipboardContext.Provider
      value={{
        clipboardItem: clipboardItems[0] ?? null,
        clipboardItems,
        copyToClipboard,
        copyManyToClipboard,
        clearClipboard,
      }}
    >
      {children}
    </ClipboardContext.Provider>
  );
};

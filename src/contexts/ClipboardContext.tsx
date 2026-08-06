"use client";
import React, { createContext, useContext, useState } from 'react';
import type { ArtboardElement } from '@/types/artboard';

// Define the shape of our clipboard context. Holds a SET of elements so
// multi-select copy/paste preserves the relative arrangement; a single copy
// is just a one-element array.
interface ClipboardContextType {
  clipboardItems: ArtboardElement[];
  copyElementsToClipboard: (elements: ArtboardElement[]) => void;
  clearClipboard: () => void;
}

// Create the context with default values
const ClipboardContext = createContext<ClipboardContextType>({
  clipboardItems: [],
  copyElementsToClipboard: () => {},
  clearClipboard: () => {},
});

// Custom hook to use the clipboard context
export const useClipboard = () => useContext(ClipboardContext);

export const ClipboardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [clipboardItems, setClipboardItems] = useState<ArtboardElement[]>([]);

  // Function to copy elements to clipboard
  const copyElementsToClipboard = (elements: ArtboardElement[]) => {
    // Create a deep copy to avoid reference issues
    setClipboardItems(JSON.parse(JSON.stringify(elements)));
  };

  // Function to clear the clipboard
  const clearClipboard = () => {
    setClipboardItems([]);
  };

  return (
    <ClipboardContext.Provider value={{ clipboardItems, copyElementsToClipboard, clearClipboard }}>
      {children}
    </ClipboardContext.Provider>
  );
};

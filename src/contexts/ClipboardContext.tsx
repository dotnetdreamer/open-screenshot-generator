"use client";
import React, { createContext, useContext, useState } from 'react';
import type { ArtboardElement } from '@/types/artboard';

// Define the shape of our clipboard context
interface ClipboardContextType {
  clipboardItem: ArtboardElement | null;
  copyToClipboard: (element: ArtboardElement) => void;
  clearClipboard: () => void;
}

// Create the context with default values
const ClipboardContext = createContext<ClipboardContextType>({
  clipboardItem: null,
  copyToClipboard: () => {},
  clearClipboard: () => {},
});

// Custom hook to use the clipboard context
export const useClipboard = () => useContext(ClipboardContext);

export const ClipboardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [clipboardItem, setClipboardItem] = useState<ArtboardElement | null>(null);

  // Function to copy an element to clipboard
  const copyToClipboard = (element: ArtboardElement) => {
    // Create a deep copy to avoid reference issues
    setClipboardItem(JSON.parse(JSON.stringify(element)));
  };

  // Function to clear the clipboard
  const clearClipboard = () => {
    setClipboardItem(null);
  };

  return (
    <ClipboardContext.Provider value={{ clipboardItem, copyToClipboard, clearClipboard }}>
      {children}
    </ClipboardContext.Provider>
  );
};

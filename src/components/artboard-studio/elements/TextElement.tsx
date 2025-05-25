
"use client";
import type React from 'react';
import { useState, useEffect, useRef } from 'react';
import type { TextElementProps as TextElementType } from '@/types/artboard';

interface TextElementProps {
  element: TextElementType;
  onUpdate: (updatedElement: Partial<TextElementType>) => void;
  isSelected: boolean;
  artboardZoom: number;
}

export function TextElement({ element, onUpdate, isSelected, artboardZoom }: TextElementProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [text, setText] = useState(element.content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText(element.content);
  }, [element.content]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [isEditing]);

  const handleDoubleClick = () => {
    if (isSelected) { // Only allow editing if selected
      setIsEditing(true);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
  };

  const handleBlur = () => {
    setIsEditing(false);
    if (text !== element.content) {
      onUpdate({ content: text });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleBlur();
    } else if (e.key === 'Escape') {
      setText(element.content); // Revert changes
      handleBlur();
    }
  };
  
  // Calculate dynamic font size based on element's height and zoom
  // This is a simplified approach. True text scaling is complex.
  const dynamicFontSize = Math.max(8, element.fontSize * element.scale); // Minimum font size of 8px

  if (isEditing) {
    return (
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          outline: 'none',
          padding: '2px',
          margin: 0,
          overflow: 'hidden',
          resize: 'none',
          background: 'rgba(255, 255, 255, 0.8)',
          fontFamily: element.fontFamily,
          fontSize: `${dynamicFontSize}px`,
          color: element.color,
          lineHeight: 1.2,
          boxSizing: 'border-box',
        }}
        className="text-element-editing"
      />
    );
  }

  return (
    <div
      onDoubleClick={handleDoubleClick}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center', // Adjust as needed, e.g. 'flex-start' for top-align
        justifyContent: 'center', // Adjust as needed
        fontFamily: element.fontFamily,
        fontSize: `${dynamicFontSize}px`,
        color: element.color,
        lineHeight: 1.2,
        whiteSpace: 'pre-wrap', // Allows line breaks and preserves spaces
        overflow: 'hidden',
        wordBreak: 'break-word',
        cursor: isSelected ? 'text' : 'default',
        padding: '2px', // Consistent with textarea
        boxSizing: 'border-box',
      }}
      title={isSelected ? "Double-click to edit text" : element.content}
    >
      {element.content}
    </div>
  );
}

"use client";
import type React from 'react';
import { useState, useEffect, useRef } from 'react';
import type { TextElementProps as TextElementType } from '@/types/artboard';
import { fitTextBox } from '@/lib/textFit';
import { cssFontFamily } from '@/services/fontService';

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
      // Grow with the edit, not after it, so the added lines are visible and
      // the whole thing is a single undo.
      const fit = fitTextBox(element, text);
      onUpdate(fit ? { content: text, ...fit } : { content: text });
    }
  };

  // Enter inserts a line break rather than ending the edit. Headlines are the
  // main thing people type here and they are routinely two or three lines, so
  // the newline is worth more than the keystroke shortcut. Committing is a
  // click away from the box, Ctrl/Cmd+Enter, or Escape.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleBlur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      // Keep what was typed. Escape used to throw the edit away, which is a
      // lot to lose now that an edit can be several lines.
      handleBlur();
    }
    // Anything else, including a bare Enter, stays with the textarea. The
    // canvas renders the result with white-space: pre-wrap.
  };
  
  // Calculate dynamic font size based on element's height and zoom
  // This is a simplified approach. True text scaling is complex.
  const dynamicFontSize = Math.max(8, element.fontSize * element.scale); // Minimum font size of 8px

  // Adjust display scale compensation
  const displayScaleFactor = 0.3; // Match the artboard scale factor

  // Calculate line height - could be a number (multiplier) or px value
  const lineHeightValue = element.lineHeight || 1.2;

  // Tracking is expressed in the same units as fontSize, so it has to follow
  // whichever compensation the branch below applies to fontSize — /0.3 for the
  // rendered text, *scale for the inline editor's textarea. Using one factor
  // for both branches would make the tracking jump on a double-click.
  const trackedSpacing = (fontScale: number) =>
    typeof element.letterSpacing === 'number' && element.letterSpacing !== 0
      ? `${element.letterSpacing * fontScale}px`
      : undefined;

  // A translated element carries the same textAlign as the English one it came
  // from, because alignment is shared across languages by design. So 'left' has
  // to mean "the side this language starts on", not "the left of the screen":
  // dir="auto" below reads the first strong character and flips the box, and
  // these logical keywords follow it. Arabic and Hebrew then read correctly
  // without a per-locale position, which the locale overlay forbids so that one
  // layout keeps serving every language.
  const logicalAlign: React.CSSProperties['textAlign'] =
    element.textAlign === 'center'
      ? 'center'
      : element.textAlign === 'justify'
        ? 'justify'
        : element.textAlign === 'right'
          ? 'end'
          : 'start';

  // flex-start and flex-end are already direction-aware, so the same mapping
  // puts an RTL headline against the right edge with no second branch.
  const logicalJustify =
    element.textAlign === 'center'
      ? 'center'
      : element.textAlign === 'right'
        ? 'flex-end'
        : 'flex-start';

  if (isEditing) {
    return (
      <textarea
        ref={textareaRef}
        dir="auto"
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
          fontFamily: cssFontFamily(element.fontFamily),
          fontSize: `${dynamicFontSize}px`,
          color: element.color,
          lineHeight: lineHeightValue,
          letterSpacing: trackedSpacing(element.scale),
          fontWeight: element.fontWeight || 'normal',
          fontStyle: element.fontStyle || 'normal',
          textDecoration: element.textDecoration || 'none',
          textAlign: logicalAlign,
          boxSizing: 'border-box',
        }}
        className="text-element-editing"
      />
    );
  }

  return (
    <div
      // Marks the node whose contents the MCP measure_element tool ranges over
      // to report the real glyph box (which no caller can predict from
      // fontSize alone, given the /0.3 compensation and the wrapping).
      data-text-body
      dir="auto"
      className="w-full h-full flex items-center justify-center"
      onDoubleClick={handleDoubleClick}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center', // Adjust as needed, e.g. 'flex-start' for top-align
        justifyContent: logicalJustify, // Map text-align to justify-content
        fontFamily: cssFontFamily(element.fontFamily),
        fontSize: `${element.fontSize / displayScaleFactor}px`,
        color: element.color,
        lineHeight: lineHeightValue,
        letterSpacing: trackedSpacing(1 / displayScaleFactor),
        fontWeight: element.fontWeight || 'normal',
        fontStyle: element.fontStyle || 'normal',
        textDecoration: element.textDecoration || 'none',
        textAlign: logicalAlign,
        whiteSpace: 'pre-wrap', // Allows line breaks and preserves spaces
        overflow: 'hidden',
        wordBreak: 'break-word',
        // Inherit DraggableElement's cursor (grab when selected) rather than
        // painting the whole box with an I-beam. The body fills the element, so
        // the I-beam was the only thing anyone saw over a selected text box —
        // it advertised "click to type" for a single click that actually
        // selects and drags, and left the nearby rotate handle as the only
        // hand-shaped thing on screen. Editing is still a double-click; the
        // title says so.
        cursor: 'inherit',
        padding: '2px', // Consistent with textarea
        boxSizing: 'border-box',
      }}
      title={isSelected ? "Double-click to edit text" : element.content}
    >
      {element.content}
    </div>
  );
}

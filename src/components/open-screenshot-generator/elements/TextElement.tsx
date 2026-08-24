"use client";
import type React from 'react';
import { useState, useEffect, useRef } from 'react';
import type { TextElementProps as TextElementType } from '@/types/artboard';
import { fitTextBox } from '@/lib/textFit';
import { cssFontFamily } from '@/services/fontService';
import { QUICK_EDIT_EVENT } from './DraggableElement';

interface TextElementProps {
  element: TextElementType;
  onUpdate: (updatedElement: Partial<TextElementType>) => void;
  isSelected: boolean;
  artboardZoom: number;
}

/**
 * Which contenteditable mode this engine understands.
 *
 * `plaintext-only` is what keeps pasted rich text, and the block elements the
 * browser would otherwise build on Enter, out of a box that stores a plain
 * string. Every engine this app ships on has it (Chromium, WebKit, Firefox
 * 136+), but the attribute is enumerated: an engine that does NOT know the
 * value falls back to "inherit", i.e. NOT editable, so a bad guess would break
 * typing outright rather than degrade. Probed once, lazily, because the static
 * export renders this file with no `document` around.
 */
let editableMode: 'plaintext-only' | true | null = null;
const contentEditableMode = () => {
  if (editableMode === null) {
    const probe = document.createElement('div');
    probe.contentEditable = 'plaintext-only';
    editableMode = probe.contentEditable === 'plaintext-only' ? 'plaintext-only' : true;
  }
  return editableMode;
};

/**
 * What the browser rendered, as the plain string this element stores.
 *
 * innerText, not textContent: the line breaks are `<br>` or `\n` depending on
 * the engine and textContent would flatten a paragraph into one line. Engines
 * also vary on whether a trailing break counts, so one is dropped.
 */
const readEditedText = (node: HTMLElement) =>
  node.innerText.replace(/\r\n/g, '\n').replace(/\n$/, '');

export function TextElement({ element, onUpdate, isSelected, artboardZoom }: TextElementProps) {
  const [isEditing, setIsEditing] = useState(false);
  /**
   * The text the editor opened on, frozen for the length of the session.
   *
   * React renders this instead of `element.content` while editing, so a change
   * arriving from anywhere else (a live collaborator, the MCP server, the
   * Properties panel) cannot rewrite the node under the caret mid-word.
   */
  const [editSeed, setEditSeed] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);

  const beginEdit = () => {
    setEditSeed(element.content);
    setIsEditing(true);
  };

  // Focus and select the lot, so typing replaces the placeholder copy a
  // template shipped with, which is what this box is opened for nine times in
  // ten. Clicking again inside puts the caret where it was aimed.
  useEffect(() => {
    const node = bodyRef.current;
    if (!isEditing || !node) return;
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [isEditing]);

  // One click on an already selected box opens the editor. DraggableElement
  // owns the gesture (it is the only thing that knows a click from the end of a
  // drag) and announces it on the wrapper, this node's nearest
  // [data-element-id] ancestor.
  // Not bound at all while editing, so a stray one cannot re-seed the box and
  // pull the text out from under the caret.
  useEffect(() => {
    const wrapper = bodyRef.current?.closest('[data-element-id]');
    if (!wrapper || isEditing) return;
    const open = () => beginEdit();
    wrapper.addEventListener(QUICK_EDIT_EVENT, open);
    return () => wrapper.removeEventListener(QUICK_EDIT_EVENT, open);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- beginEdit is
    // recreated every render; the content it seeds from is the dependency.
  }, [element.content, isEditing]);

  // Still wired, and still the way in from a double-tap on touch, which
  // DraggableElement replays as a dblclick.
  const handleDoubleClick = () => {
    if (isSelected && !isEditing) beginEdit();
  };

  const commit = () => {
    const node = bodyRef.current;
    setIsEditing(false);
    if (!node) return;
    const text = readEditedText(node);
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
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      bodyRef.current?.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      // Keep what was typed. Escape used to throw the edit away, which is a
      // lot to lose now that an edit can be several lines.
      bodyRef.current?.blur();
    }
    // Anything else, including a bare Enter, stays with the editor. The box
    // renders the result with white-space: pre-wrap either way.
  };

  // Belt and braces behind `plaintext-only`: on an engine that fell back to a
  // plain editable, this is what stops a paste from a web page arriving as
  // markup that innerText then has to guess its way back out of.
  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (text) document.execCommand('insertText', false, text);
  };

  // Adjust display scale compensation
  const displayScaleFactor = 0.3; // Match the artboard scale factor

  // Calculate line height - could be a number (multiplier) or px value
  const lineHeightValue = element.lineHeight || 1.2;

  // Tracking is expressed in the same units as fontSize, so it takes the same
  // /0.3 compensation the rendered text does.
  const trackedSpacing =
    typeof element.letterSpacing === 'number' && element.letterSpacing !== 0
      ? `${element.letterSpacing / displayScaleFactor}px`
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

  return (
    <div
      // ONE node for both states, editable or not, carrying ONE set of styles.
      // The editor used to be a separate <textarea> at fontSize * scale with
      // the text top-aligned, so clicking into a 48px headline dropped it to a
      // third of its size and moved it: what you typed was never what you had
      // been looking at. Toggling contentEditable on the rendered box instead
      // makes the edit literally in place, and leaves nothing that can drift.
      ref={bodyRef}
      // Marks the node whose contents the MCP measure_element tool ranges over
      // to report the real glyph box (which no caller can predict from
      // fontSize alone, given the /0.3 compensation and the wrapping).
      data-text-body
      dir="auto"
      contentEditable={isEditing ? contentEditableMode() : undefined}
      // React warns about children under a contentEditable node, because it
      // cannot see what the browser does to them. That is the arrangement here:
      // `editSeed` is frozen for the session, so React has nothing to write
      // while the caret is in the box, and reconciles once on the way out.
      suppressContentEditableWarning
      className="w-full h-full flex items-center justify-center"
      onDoubleClick={handleDoubleClick}
      onBlur={isEditing ? commit : undefined}
      onKeyDown={isEditing ? handleKeyDown : undefined}
      onPaste={isEditing ? handlePaste : undefined}
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
        letterSpacing: trackedSpacing,
        fontWeight: element.fontWeight || 'normal',
        fontStyle: element.fontStyle || 'normal',
        textDecoration: element.textDecoration || 'none',
        textAlign: logicalAlign,
        whiteSpace: 'pre-wrap', // Allows line breaks and preserves spaces
        overflow: 'hidden',
        wordBreak: 'break-word',
        // An I-beam once the caret is actually in the box. Otherwise inherit
        // DraggableElement's cursor (grab when selected) rather than painting
        // the whole box with one: the body fills the element, and a press that
        // travels is still a drag. The title says what a click does.
        cursor: isEditing ? 'text' : 'inherit',
        // Nothing painted over the artwork, and no ring: the element's own
        // selection outline is already up, and the caret plus the selected run
        // say the box is live. The point is that it looks unchanged.
        outline: 'none',
        padding: '2px',
        boxSizing: 'border-box',
      }}
      title={isEditing ? undefined : isSelected ? 'Click to edit text' : element.content}
    >
      {isEditing ? editSeed : element.content}
    </div>
  );
}

"use client";

import { cn } from '@/lib/utils';

/** Claude Code's brand colour. */
export const CLAUDE_CODE_ORANGE = '#D97757';

interface ClaudeCodeLogoProps {
  className?: string;
  /**
   * Draw the mark in the text colour instead of the brand orange. For places
   * where the orange would fight whatever sits behind it.
   */
  mono?: boolean;
  /** Put the mark on a rounded orange tile, like an app icon. */
  tile?: boolean;
}

/**
 * The Claude Code mark: the pixel character from its terminal banner.
 *
 * Inline so nothing is fetched, and in the brand orange by default so it reads
 * as Claude Code at a glance in the agent tab, the dock and the chat.
 * Path from the Simple Icons set (CC0).
 */
export function ClaudeCodeLogo({ className, mono = false, tile = false }: ClaudeCodeLogoProps) {
  const mark = (
    <path d="M21 10.5h3v3h-3v3h-1.5v3H18v-3h-1.5v3H15v-3H9v3H7.5v-3H6v3H4.5v-3H3v-3H0v-3h3v-6h18Zm-15 0h1.5v-3H6Zm10.5 0H18v-3h-1.5z" />
  );

  if (tile) {
    return (
      <span
        className={cn('inline-flex shrink-0 items-center justify-center rounded-lg', className)}
        style={{ backgroundColor: CLAUDE_CODE_ORANGE }}
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" className="h-[62%] w-[62%]" fill="#fff">
          {mark}
        </svg>
      </span>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn('shrink-0', className)}
      fill={mono ? 'currentColor' : CLAUDE_CODE_ORANGE}
    >
      {mark}
    </svg>
  );
}

"use client";

import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronDownIcon, PlusIcon, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface CreateMenuItem {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  onSelect: () => void;
}

export interface CreateMenuSection {
  label: string;
  items: CreateMenuItem[];
}

/** How long the mouse rests on the + before the menu opens. */
const OPEN_DELAY_MS = 120;
/** How long the mouse may be off both the + and the menu before it closes. */
const CLOSE_DELAY_MS = 220;

/**
 * The toolbar's + button: every way to start a design, each with its icon and
 * what it makes.
 *
 * A mouse opens it by resting on the button; a click, a tap or the keyboard
 * open it too, because a finger never hovers. Opened by hovering, it leaves the
 * keyboard focus where it was, since a mouse crossing the toolbar must not end
 * the text edit somebody is in the middle of. That is why it is a Popover: a
 * Radix DropdownMenu always moves the focus into itself on opening. A click on
 * a menu the hover opened keeps it open from then on, rather than toggling it
 * shut, and it then stays until it is dismissed.
 */
export function CreateMenu({ sections }: { sections: CreateMenuSection[] }) {
  const idPrefix = useId();
  const [open, setOpen] = useState(false);
  // Opened by resting the mouse on the +, and not yet clicked.
  const byHoverRef = useRef(false);
  // An item was picked: the dialog it opens takes the focus, not the +.
  const choseRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  const openSoon = () => {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      byHoverRef.current = true;
      choseRef.current = false;
      setOpen(true);
    }, OPEN_DELAY_MS);
  };
  const closeSoon = () => {
    clearTimer();
    timerRef.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };

  // Radix asks for this on a click of the +, Escape, or a press outside.
  const changeOpen = (next: boolean) => {
    clearTimer();
    if (next) {
      byHoverRef.current = false;
      choseRef.current = false;
    }
    setOpen(next);
  };

  const choose = (item: CreateMenuItem) => {
    clearTimer();
    choseRef.current = true;
    setOpen(false);
    item.onSelect();
  };

  // Up and Down walk the items, as in the toolbar's other menus.
  const moveFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-create-item]'));
    if (items.length === 0) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    items[(at + step + items.length) % items.length].focus();
  };

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="h-8 shrink-0 gap-1"
          // An aria-label, not a title like the other toolbar buttons: a title
          // tooltip would sit on top of the menu that opens under the pointer.
          aria-label="Create"
          onPointerEnter={(event) => {
            if (event.pointerType !== 'mouse') return;
            if (open) clearTimer();
            else openSoon();
          }}
          onPointerLeave={(event) => {
            if (event.pointerType !== 'mouse') return;
            if (!open) clearTimer();
            else if (byHoverRef.current) closeSoon();
          }}
          onClick={(event) => {
            // Already open from the hover: keep it open, and stop closing it
            // when the mouse wanders off.
            if (open && byHoverRef.current) {
              event.preventDefault();
              byHoverRef.current = false;
              clearTimer();
            }
          }}
        >
          <PlusIcon className="h-4 w-4" />
          <ChevronDownIcon className="h-3.5 w-3.5 opacity-70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-80 p-1"
        onPointerEnter={clearTimer}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse' && byHoverRef.current) closeSoon();
        }}
        onOpenAutoFocus={(event) => {
          if (byHoverRef.current) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          if (byHoverRef.current || choseRef.current) event.preventDefault();
        }}
        onKeyDown={moveFocus}
      >
        {sections.map((section, index) => (
          <div key={section.label} role="group" aria-label={section.label}>
            {index > 0 && <div className="-mx-1 my-1 h-px bg-muted" />}
            <p className="px-2 py-1.5 text-xs font-semibold">{section.label}</p>
            {section.items.map((item) => (
              <button
                key={item.id}
                type="button"
                data-create-item=""
                // Named by the label alone, with the line under it as the
                // description, so a screen reader reads them apart.
                aria-label={item.label}
                aria-describedby={`${idPrefix}-${item.id}`}
                onClick={() => choose(item)}
                className="group flex w-full items-start gap-3 rounded-sm px-2 py-2 text-left outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-background text-foreground">
                  <item.icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium leading-tight">{item.label}</span>
                  <span
                    id={`${idPrefix}-${item.id}`}
                    className="mt-0.5 block text-xs leading-snug text-muted-foreground group-hover:text-accent-foreground/80 group-focus-visible:text-accent-foreground/80"
                  >
                    {item.description}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}

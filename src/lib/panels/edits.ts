"use client";

// Where a window's own edits stand with the editor.
//
// An edit made in the editor's dock is in the props on the next render. A
// detached panel only sends one, and the result comes back in a later
// snapshot, so for a moment the props it renders still hold the values from
// before. A control that must not show those (a slider that would jump back on
// release) keeps its edit on show until the snapshot on screen holds it.

import { createContext, useContext } from 'react';

export interface DockEdits {
  /** The `seq` of the last edit this window sent. 0 in the editor, which sends none. */
  lastSent: () => number;
  /** Every edit up to this `seq` is in the props on show. */
  answered: number;
}

/** The editor's own dock, where nothing is ever waiting. */
const IN_EDITOR: DockEdits = { lastSent: () => 0, answered: Number.POSITIVE_INFINITY };

export const DockEditsContext = createContext<DockEdits>(IN_EDITOR);

export function useDockEdits(): DockEdits {
  return useContext(DockEditsContext);
}

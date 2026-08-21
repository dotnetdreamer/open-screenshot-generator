// Marks a detached panel window before the first paint.
//
// A panel window loads the SAME document as the editor, so the statically
// exported HTML it receives carries the editor's Suspense fallback: the whole
// chrome skeleton, palette rail and all. React only finds out this is a panel
// window once it hydrates, which is one frame too late to stop that skeleton
// flashing across a window that will never hold an editor.
//
// So this runs blocking in <head>, next to the theme script and for the same
// reason. It sets one attribute; globals.css does the rest.
//
// Kept as a string rather than a module because it has to execute before the
// body is parsed, which is earlier than any bundle can run.

import { PANEL_PARAM } from './url';

export const PANEL_WINDOW_BOOT_SCRIPT = `(function(){try{if(new URLSearchParams(location.search).get(${JSON.stringify(
  PANEL_PARAM
)}))document.documentElement.setAttribute('data-osg-panel','1');}catch(e){}})();`;

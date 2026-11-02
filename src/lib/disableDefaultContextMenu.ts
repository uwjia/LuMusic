// Suppress the WebView's built-in right-click menu app-wide.
//
// The stock menu (reload / save image / browser-style entries) breaks the
// illusion of a native desktop player. One document-level listener calls
// only `preventDefault()` — custom menus (e.g. the playlist sidebar rows)
// attach their own handlers and still receive the event, since canceling
// the default action never stops propagation.

let installed = false;

/** Install the global suppression; safe to call more than once. */
export function disableDefaultContextMenu(): void {
  if (installed) return;
  installed = true;
  document.addEventListener('contextmenu', (event) => event.preventDefault());
}

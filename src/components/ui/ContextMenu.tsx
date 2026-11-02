// Minimal fixed-position context menu (custom right-click actions).
//
// Rendered at the cursor and clamped into the viewport once measured so it
// never clips; closes on item activation, Escape, or an outside pointer
// press. Kept dependency-free — portals are unnecessary because the menu
// is the only elevated overlay and z-index handles stacking.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface ContextMenuItem {
  key: string;
  label: string;
  /** Render the entry as destructive (e.g. delete). */
  danger?: boolean;
  onSelect: () => void;
}

/** Visual gap isolating entries (e.g. before a destructive action);
 *  not focusable, not clickable. */
export interface ContextMenuSeparator {
  separator: true;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

interface ContextMenuProps {
  x: number;
  y: number;
  ariaLabel: string;
  items: ContextMenuEntry[];
  onClose: () => void;
}

export function ContextMenu({ x, y, ariaLabel, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  // Start at the cursor; the layout effect nudges it back inside the
  // viewport after the first measure (jsdom measures 0x0, which the
  // clamping tolerates).
  const [left, setLeft] = useState(x);
  const [top, setTop] = useState(y);

  useLayoutEffect(() => {
    const rect = menuRef.current?.getBoundingClientRect();
    setLeft(Math.max(4, Math.min(x, window.innerWidth - (rect?.width ?? 0) - 4)));
    setTop(Math.max(4, Math.min(y, window.innerHeight - (rect?.height ?? 0) - 4)));
    // Keyboard users land on the first entry; Escape still closes globally.
    firstItemRef.current?.focus();
  }, [x, y]);

  useEffect(() => {
    // Capture so the press that *opens* a new menu at another spot also
    // closes this one before the contextmenu handler re-renders.
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  // Separators are not focusable: keyboard entry lands on the first item.
  const firstItem = items.find((e): e is ContextMenuItem => !('separator' in e));

  return (
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      aria-label={ariaLabel}
      style={{ left, top }}
    >
      {items.map((entry, index) =>
        'separator' in entry ? (
          <div key={`separator-${index}`} className="context-menu-separator" role="separator" />
        ) : (
          <button
            key={entry.key}
            type="button"
            ref={entry === firstItem ? firstItemRef : undefined}
            role="menuitem"
            className={`context-menu-item ${entry.danger ? 'danger' : ''}`}
            onClick={() => {
              entry.onSelect();
              onClose();
            }}
          >
            {entry.label}
          </button>
        ),
      )}
    </div>
  );
}

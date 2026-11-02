// Modal confirmation for destructive actions (e.g. deleting a playlist).
//
// The safe choice wins by default: focus starts on Cancel, and Escape or
// an overlay press also cancel. Dependency-free like ContextMenu — a fixed
// overlay with z-index is enough, no portal needed.

import { useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Keyboard users land on the safe action first; a stray Enter cannot
    // confirm the deletion.
    cancelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div
      className="dialog-overlay"
      // Only a press on the backdrop itself dismisses; clicks inside the
      // dialog bubble up with a different target.
      onPointerDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        data-testid="confirm-dialog"
      >
        <div className="dialog-title">{title}</div>
        <p className="dialog-message">{message}</p>
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" className="btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn btn-danger-solid"
            data-testid="confirm-dialog-confirm"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

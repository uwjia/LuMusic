// Modal confirmation for destructive actions (e.g. deleting a playlist).
//
// The dialog only opens after a deliberate staging click, so Enter is the
// "go ahead" default (like window.confirm): focus starts on Confirm and a
// document-wide Enter confirms. Escape or an overlay press still cancels.
// Dependency-free like ContextMenu — a fixed overlay with z-index is
// enough, no portal needed.

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
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      } else if (e.key === 'Enter') {
        // preventDefault also suppresses the native activation of a
        // focused button (e.g. Cancel), so Enter can only ever confirm.
        e.preventDefault();
        onConfirm();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onConfirm, onCancel]);

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
          <button type="button" className="btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
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

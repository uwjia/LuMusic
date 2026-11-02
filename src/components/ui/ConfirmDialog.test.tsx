// Behavior tests for the destructive-action confirmation dialog.
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

function renderDialog(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmDialog
      title="Delete playlist?"
      message='Delete "Focus"?'
      confirmLabel="Delete"
      cancelLabel="Cancel"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onConfirm, onCancel };
}

describe('ConfirmDialog', () => {
  it('renders the given title and message', () => {
    renderDialog();
    expect(screen.getByTestId('confirm-dialog')).toHaveTextContent('Delete playlist?');
    expect(screen.getByTestId('confirm-dialog')).toHaveTextContent('Delete "Focus"?');
  });

  it('focuses Confirm so Enter immediately confirms', () => {
    renderDialog();
    expect(screen.getByTestId('confirm-dialog-confirm')).toHaveFocus();
  });

  it('Enter confirms and never falls through to cancel', () => {
    const { onConfirm, onCancel } = renderDialog();
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('confirming calls only onConfirm', () => {
    const { onConfirm, onCancel } = renderDialog();
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('the Cancel button cancels', () => {
    const { onConfirm, onCancel } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Escape cancels', () => {
    const { onCancel } = renderDialog();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('pressing the backdrop cancels, but dialog clicks do not', () => {
    const { onCancel } = renderDialog();
    fireEvent.pointerDown(screen.getByTestId('confirm-dialog'));
    expect(onCancel).not.toHaveBeenCalled();
    // The backdrop is the dialog's parent element.
    fireEvent.pointerDown(screen.getByTestId('confirm-dialog').parentElement!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

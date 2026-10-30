// Behavior tests for the custom context menu primitive.
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu';

function makeItems() {
  return [
    { key: 'edit', label: 'Edit', onSelect: vi.fn() },
    { key: 'remove', label: 'Remove', danger: true, onSelect: vi.fn() },
  ] satisfies ContextMenuItem[];
}

describe('ContextMenu', () => {
  it('opens at the cursor and clamps into the viewport', () => {
    render(<ContextMenu x={10} y={20} ariaLabel="Actions" items={makeItems()} onClose={vi.fn()} />);
    // jsdom defaults to a 1024x768 viewport, so only x > viewport clamps.
    expect(screen.getByRole('menu', { name: 'Actions' })).toHaveStyle({ left: '10px', top: '20px' });
  });

  it('nudges a menu back when it would overflow the window', () => {
    render(
      <ContextMenu x={2000} y={2000} ariaLabel="Actions" items={makeItems()} onClose={vi.fn()} />,
    );
    expect(screen.getByRole('menu')).toHaveStyle({ left: '1020px', top: '764px' });
  });

  it('activates the item and closes the menu', () => {
    const items = makeItems();
    const onClose = vi.fn();
    render(<ContextMenu x={0} y={0} ariaLabel="Actions" items={items} onClose={onClose} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
    expect(items[1].onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape without running any action', () => {
    const items = makeItems();
    const onClose = vi.fn();
    render(<ContextMenu x={0} y={0} ariaLabel="Actions" items={items} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(items[0].onSelect).not.toHaveBeenCalled();
    expect(items[1].onSelect).not.toHaveBeenCalled();
  });

  it('closes on an outside pointer press but not on one inside', () => {
    const onClose = vi.fn();
    render(<ContextMenu x={0} y={0} ariaLabel="Actions" items={makeItems()} onClose={onClose} />);
    fireEvent.pointerDown(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

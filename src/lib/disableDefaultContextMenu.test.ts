// Pins the app-wide native-menu suppression installed from main.tsx:
// every right-click is default-prevented, yet custom context menus
// (Sidebar playlist rows) still see the event.
import { beforeEach, describe, expect, it, vi } from 'vitest';

async function install(): Promise<void> {
  // resetModules gives each test a fresh module instance so the
  // "installed once" guard cannot leak state between cases.
  vi.resetModules();
  const { disableDefaultContextMenu } = await import('@/lib/disableDefaultContextMenu');
  disableDefaultContextMenu();
}

function rightClick(target: Node): MouseEvent {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe('disableDefaultContextMenu', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('default-prevents right-clicks anywhere in the document', async () => {
    await install();
    const button = document.createElement('button');
    document.body.appendChild(button);
    expect(rightClick(button).defaultPrevented).toBe(true);
    expect(rightClick(document.body).defaultPrevented).toBe(true);
  });

  it('still delivers the event to custom context-menu handlers', async () => {
    await install();
    const handler = vi.fn((e: Event) => e.preventDefault());
    const row = document.createElement('button');
    row.addEventListener('contextmenu', handler);
    document.body.appendChild(row);
    expect(rightClick(row).defaultPrevented).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('registers the listener at most once across repeated calls', async () => {
    await install();
    const addSpy = vi.spyOn(document, 'addEventListener');
    const { disableDefaultContextMenu } = await import('@/lib/disableDefaultContextMenu');
    disableDefaultContextMenu();
    disableDefaultContextMenu();
    expect(addSpy).not.toHaveBeenCalledWith('contextmenu', expect.any(Function));
    addSpy.mockRestore();
  });
});

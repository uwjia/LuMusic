// Behavior tests for the custom title bar (window api injected as a fake).

import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { WindowApi } from '../../api/window';
import { TitleBar } from './TitleBar';

function fakeApi(overrides: Partial<WindowApi> = {}): WindowApi {
  return {
    native: true,
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn().mockResolvedValue(false),
    onMaximizeChange: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  };
}

describe('TitleBar', () => {
  it('is a drag region so the undecorated window can be moved', () => {
    render(<TitleBar api={fakeApi()} />);
    expect(screen.getByRole('banner')).toHaveAttribute('data-tauri-drag-region');
  });

  it('shows the app title', () => {
    render(<TitleBar api={fakeApi()} />);
    expect(screen.getByText('LuMusic')).toBeInTheDocument();
  });

  it('hides window controls outside the Tauri window (browser dev mode)', () => {
    render(<TitleBar api={fakeApi({ native: false })} />);
    expect(screen.queryByRole('button', { name: 'Minimize' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Maximize' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });

  it('minimize / maximize / close call through to the window api', () => {
    const api = fakeApi();
    render(<TitleBar api={api} />);

    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }));
    expect(api.minimize).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Maximize' }));
    expect(api.toggleMaximize).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(api.close).toHaveBeenCalledTimes(1);
  });

  it('subscribes while mounted and unsubscribes on unmount', () => {
    const unlisten = vi.fn();
    const api = fakeApi({ onMaximizeChange: vi.fn().mockReturnValue(unlisten) });
    const { unmount } = render(<TitleBar api={api} />);
    expect(api.onMaximizeChange).toHaveBeenCalledTimes(1);
    unmount();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('reflects the maximize state on the toggle button', async () => {
    let notify: ((maximized: boolean) => void) | undefined;
    const api = fakeApi({
      onMaximizeChange: vi.fn((cb) => {
        notify = cb;
        return () => {};
      }),
    });
    render(<TitleBar api={api} />);

    // Restored initially: the button offers to maximize.
    expect(await screen.findByRole('button', { name: 'Maximize' })).toBeInTheDocument();

    // A resize that maximized the window flips the label to Restore.
    await act(async () => {
      notify?.(true);
    });
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
  });
});

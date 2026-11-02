// Behavior tests for the content-area drop overlay.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { DropZone } from '@/features/shell/DropZone';
import type { DragDropEvent } from '@/types/track';

let handler: ((event: DragDropEvent) => void) | null = null;

vi.mock('@/api', () => ({
  api: {
    onDragDrop: vi.fn((cb: (event: DragDropEvent) => void) => {
      handler = cb;
      return () => {
        handler = null;
      };
    }),
  },
}));

const fire = (event: DragDropEvent) => act(() => handler?.(event));

beforeEach(() => {
  handler = null;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DropZone', () => {
  it('shows the playlist target while a playlist page is open', () => {
    render(<DropZone targetPlaylistId="p1" />);
    fire({ type: 'enter', paths: ['C:/m/a.mp3'] });
    expect(screen.getByTestId('drop-overlay')).toHaveTextContent(
      'Drop audio files to add them to this playlist',
    );
  });

  it('shows the library target elsewhere', () => {
    render(<DropZone targetPlaylistId={null} />);
    fire({ type: 'enter', paths: ['C:/m/a.mp3'] });
    expect(screen.getByTestId('drop-overlay')).toHaveTextContent(
      'Drop audio files to import them into the library',
    );
  });

  it('hides again once the drag leaves or drops', () => {
    render(<DropZone targetPlaylistId="p1" />);
    fire({ type: 'enter', paths: ['C:/m/a.mp3'] });
    fire({ type: 'leave' });
    expect(screen.queryByTestId('drop-overlay')).not.toBeInTheDocument();
    fire({ type: 'enter', paths: ['C:/m/a.mp3'] });
    fire({ type: 'drop', paths: ['C:/m/a.mp3'] });
    expect(screen.queryByTestId('drop-overlay')).not.toBeInTheDocument();
  });
});

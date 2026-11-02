// Drop-target overlay for the content area: while files dragged from the
// OS file manager hover the window, it tells the user where they will land
// (the open playlist when one is open, the library otherwise). Purely
// visual — the native drop handler delivers the paths, the overlay never
// intercepts pointer events.

import { useTranslation } from '@/i18n';
import { useDragDropImport } from '@/hooks/useDragDropImport';

export function DropZone({ targetPlaylistId }: { targetPlaylistId: string | null }) {
  const dragging = useDragDropImport(targetPlaylistId);
  const { t } = useTranslation();
  if (!dragging) return null;
  return (
    <div className="drop-overlay" data-testid="drop-overlay">
      <div className="drop-overlay-card">
        {targetPlaylistId ? t('playlist.dropToPlaylist') : t('playlist.dropToLibrary')}
      </div>
    </div>
  );
}

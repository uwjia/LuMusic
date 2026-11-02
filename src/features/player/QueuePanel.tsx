// Play-queue panel: popover above the player bar listing the queue in
// user-visible order with the playing row highlighted. Clicking a row
// jumps to it; upcoming rows carry a remove button (the playing row is
// protected by the backend). Virtualized: an "All Tracks" queue can hold
// the whole library.

import { useEffect, useRef, type RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { formatDuration } from '@/lib/format';
import { useTranslation } from '@/i18n';
import { useQueueStore } from '@/stores/queueStore';
import type { Track } from '@/types/track';

const ROW_HEIGHT = 32;

interface QueuePanelProps {
  /** The player-bar toggle button; presses on it toggle instead of close. */
  anchorRef: RefObject<HTMLButtonElement | null>;
}

export function QueuePanel({ anchorRef }: QueuePanelProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const queue = useQueueStore((s) => s.queue);
  const error = useQueueStore((s) => s.error);
  const { refresh, jump, remove, setOpen } = useQueueStore.getState();

  // Fresh list every time the panel opens (backend is the source of truth).
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Close on Escape and outside presses (same contract as the EQ panel).
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [anchorRef, setOpen]);

  const tracks: Track[] = queue?.tracks ?? [];
  const virtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    // jsdom measures a 0px scroll element; seed a viewport for tests.
    initialRect: { width: 420, height: 320 },
  });

  const count =
    tracks.length === 1
      ? t('queue.countOne', { count: tracks.length })
      : t('queue.count', { count: tracks.length });

  return (
    <div
      ref={panelRef}
      className="queue-panel"
      role="dialog"
      aria-label={t('queue.title')}
      data-testid="queue-panel"
    >
      <div className="queue-head">
        <h3>{t('queue.title')}</h3>
        <span className="muted">{count}</span>
      </div>

      {tracks.length === 0 ? (
        <div className="queue-empty" data-testid="queue-empty">
          <div className="empty-state-title">{t('queue.empty')}</div>
          <div className="empty-state-hint">{t('queue.emptyHint')}</div>
        </div>
      ) : (
        <div ref={listRef} className="queue-list" data-testid="queue-list">
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((row) => {
              const track = tracks[row.index];
              const isCurrent = queue?.position === row.index;
              return (
                <div
                  key={`${track.id}-${row.index}`}
                  className={`queue-row ${isCurrent ? 'is-current' : ''}`}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: ROW_HEIGHT,
                    transform: `translateY(${row.start}px)`,
                  }}
                >
                  <button
                    type="button"
                    className="queue-row-main"
                    aria-label={t('queue.play', { title: track.title })}
                    onClick={() => void jump(row.index)}
                    onDoubleClick={() => void jump(row.index)}
                    data-testid={`queue-row-${row.index}`}
                  >
                    <span className="queue-index">
                      {isCurrent ? (
                        <span className="playing-dot" aria-label={t('table.playing')} />
                      ) : (
                        row.index + 1
                      )}
                    </span>
                    <span className="queue-title" title={track.title}>
                      {track.title}
                    </span>
                    <span className="queue-artist">{track.artist ?? '—'}</span>
                    <span className="queue-duration">
                      {track.durationSecs != null ? formatDuration(track.durationSecs) : '—'}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="queue-remove row-btn"
                    aria-label={t('queue.remove', { title: track.title })}
                    disabled={isCurrent}
                    onClick={() => void remove(row.index)}
                    data-testid={`queue-remove-${row.index}`}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {error ? (
        <div className="queue-error" role="alert" data-testid="queue-error">
          {error}
        </div>
      ) : null}
    </div>
  );
}

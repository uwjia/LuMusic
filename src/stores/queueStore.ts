// Play-queue store: panel visibility + the queue snapshot (tracks with the
// playing row marked). Mutations go through the api seam; the backend's
// state events (routed by usePlayerEvents) keep the snapshot fresh, and
// each action refetches so tests and the panel never read a stale list.

import { create } from 'zustand';
import { api } from '@/api';
import type { QueueView } from '@/types/track';

interface QueueStoreState {
  /** Whether the queue popover is shown (toggled from the player bar). */
  open: boolean;
  /** Last fetched queue; null until the first refresh resolves. */
  queue: QueueView | null;
  /** Set when the latest queue action failed (shown inside the panel). */
  error: string | null;
  setOpen: (open: boolean) => void;
  refresh: () => Promise<void>;
  insertNext: (trackId: string) => Promise<void>;
  append: (trackId: string) => Promise<void>;
  remove: (index: number) => Promise<void>;
  jump: (index: number) => Promise<void>;
}

async function run(
  set: (partial: Partial<QueueStoreState>) => void,
  action: () => Promise<unknown>,
): Promise<void> {
  try {
    set({ error: null });
    await action();
    // The returned player state does not carry the queue list, so the
    // authoritative snapshot is always a fetch away.
    set({ queue: await api.playerQueue() });
  } catch (err) {
    set({ error: err instanceof Error ? err.message : String(err) });
  }
}

export const useQueueStore = create<QueueStoreState>((set) => ({
  open: false,
  queue: null,
  error: null,

  setOpen: (open) => set({ open }),

  refresh: () => run(set, async () => undefined),

  insertNext: (trackId) => run(set, () => api.playerQueueInsertNext(trackId)),
  append: (trackId) => run(set, () => api.playerQueueAppend(trackId)),
  remove: (index) => run(set, () => api.playerQueueRemove(index)),
  jump: (index) => run(set, () => api.playerQueueJump(index)),
}));

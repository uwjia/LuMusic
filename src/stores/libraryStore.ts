// Library store: track list, search/sort query, scan lifecycle.

import { create } from 'zustand';
import { api } from '@/api';
import type { ScanProgress, ScanSummary, SortField, Track, TrackQuery } from '@/types/track';

export const DEFAULT_QUERY: TrackQuery = {
  search: null,
  sort: 'title',
  descending: false,
};

interface LibraryStoreState {
  tracks: Track[];
  query: TrackQuery;
  loading: boolean;
  /** Non-null while a scan is running. */
  scanProgress: ScanProgress | null;
  lastScan: ScanSummary | null;
  error: string | null;
  load: (query?: Partial<TrackQuery>) => Promise<void>;
  setSearch: (search: string) => Promise<void>;
  toggleSort: (field: SortField) => Promise<void>;
  scan: (root: string) => Promise<boolean>;
  applyScanProgress: (progress: ScanProgress) => void;
  applyScanDone: (summary: ScanSummary) => void;
}

export const useLibraryStore = create<LibraryStoreState>((set, get) => ({
  tracks: [],
  query: { ...DEFAULT_QUERY },
  loading: false,
  scanProgress: null,
  lastScan: null,
  error: null,

  load: async (queryPatch) => {
    const query = { ...get().query, ...queryPatch };
    set({ query, loading: true, error: null });
    try {
      const tracks = await api.getTracks(query);
      // Ignore stale responses (a newer query may already be active).
      if (get().query === query) {
        set({ tracks, loading: false });
      }
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  setSearch: (search) => get().load({ search: search.trim() || null }),

  // Clicking the active column flips direction; another column switches
  // the sort field (ascending first).
  toggleSort: (field) => {
    const { sort, descending } = get().query;
    if (sort === field) {
      return get().load({ descending: !descending });
    }
    return get().load({ sort: field, descending: false });
  },

  scan: async (root) => {
    set({ scanProgress: { scanned: 0, total: 0 }, error: null });
    try {
      const summary = await api.scanLibrary(root);
      set({ lastScan: summary, scanProgress: null });
      await get().load();
      return true;
    } catch (err) {
      set({
        scanProgress: null,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  },

  applyScanProgress: (scanProgress) => set({ scanProgress }),
  applyScanDone: (lastScan) => set({ lastScan }),
}));

// Chooses the API implementation:
// - `vite --mode mock` (or VITE_API=mock): in-memory mock, runs in a browser;
// - otherwise: real Tauri IPC.

import { mockApi } from '@/api/mock';
import { tauriApi } from '@/api/tauri';
import type { PlayerApi } from '@/api/types';

const wantsMock =
  import.meta.env.MODE === 'mock' || import.meta.env.VITE_API === 'mock';

export const api: PlayerApi = wantsMock ? mockApi : tauriApi;
export type { PlayerApi } from '@/api/types';

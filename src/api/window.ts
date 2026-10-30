// Window chrome seam for the custom title bar: minimize / maximize / close.
//
// Follows the api/ layering rule: UI code never imports `@tauri-apps/api`
// directly. The stub implementation keeps `npm run dev:mock` (plain browser)
// and jsdom component tests free of Tauri internals - it is selected at
// runtime by whether the WebView injected `__TAURI_INTERNALS__`.

import { getCurrentWindow } from '@tauri-apps/api/window';
import type { Unsubscribe } from '@/api/types';

export interface WindowApi {
  /** True inside the real Tauri window; false in browser/tests. */
  readonly native: boolean;
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  isMaximized(): Promise<boolean>;
  /** Fires with the authoritative maximize state whenever it may change. */
  onMaximizeChange(cb: (maximized: boolean) => void): Unsubscribe;
}

const stubWindowApi: WindowApi = {
  native: false,
  minimize: () => {},
  toggleMaximize: () => {},
  close: () => {},
  isMaximized: async () => false,
  onMaximizeChange: () => () => {},
};

function createTauriWindowApi(): WindowApi {
  const win = getCurrentWindow();
  return {
    native: true,
    minimize: () => void win.minimize(),
    toggleMaximize: () => void win.toggleMaximize(),
    close: () => void win.close(),
    isMaximized: () => win.isMaximized(),
    onMaximizeChange: (cb) => {
      // Resize is the only emitted signal; query the real state after each hit.
      const promise = win.onResized(() => void win.isMaximized().then(cb));
      return () => void promise.then((unlisten) => unlisten());
    },
  };
}

const hasTauriInternals =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const windowApi: WindowApi = hasTauriInternals
  ? createTauriWindowApi()
  : stubWindowApi;

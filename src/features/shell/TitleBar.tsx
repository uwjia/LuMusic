// Custom title bar spanning the top of the window: drag region + native
// window controls, styled with the app's dark tokens so the chrome blends
// into the page (the OS decorations are disabled in tauri.conf.json).

import { useEffect, useState } from 'react';
import { windowApi, type WindowApi } from '@/api/window';
import { useTranslation } from '@/i18n';

interface TitleBarProps {
  /** Injectable seam for tests; defaults to the module-level selection. */
  api?: WindowApi;
  title?: string;
}

export function TitleBar({ api = windowApi, title = 'LuMusic' }: TitleBarProps) {
  const [maximized, setMaximized] = useState(false);
  const { t } = useTranslation();

  // The drag region attribute handles dragging and double-click-maximize
  // natively; we only mirror the maximize state for the button glyph.
  useEffect(() => {
    if (!api.native) return;
    void api.isMaximized().then(setMaximized);
    return api.onMaximizeChange(setMaximized);
  }, [api]);

  return (
    <header className="titlebar" data-tauri-drag-region>
      <span className="titlebar-glyph" aria-hidden>
        ♪
      </span>
      <div className="titlebar-title" data-tauri-drag-region>
        {title}
      </div>

      {api.native ? (
        <div className="titlebar-controls">
          <button
            type="button"
            className="titlebar-btn"
            aria-label={t('titlebar.minimize')}
            title={t('titlebar.minimize')}
            onClick={() => api.minimize()}
          >
            &#x2013;
          </button>
          <button
            type="button"
            className="titlebar-btn"
            aria-label={maximized ? t('titlebar.restore') : t('titlebar.maximize')}
            title={maximized ? t('titlebar.restore') : t('titlebar.maximize')}
            onClick={() => api.toggleMaximize()}
          >
            {maximized ? '❐' : '▢'}
          </button>
          <button
            type="button"
            className="titlebar-btn titlebar-close"
            aria-label={t('titlebar.close')}
            title={t('titlebar.close')}
            onClick={() => api.close()}
          >
            ✕
          </button>
        </div>
      ) : null}
    </header>
  );
}

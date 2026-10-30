// Settings page: language switch, music folder picker + scan, about info.

import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { api } from '@/api';
import { Button } from '@/components/ui/Button';
import { LOCALES, LOCALE_NAMES, useTranslation } from '@/i18n';
import { useLibraryStore } from '@/stores/libraryStore';

export function SettingsPage() {
  const lastScan = useLibraryStore((s) => s.lastScan);
  const scanProgress = useLibraryStore((s) => s.scanProgress);
  const error = useLibraryStore((s) => s.error);
  const scan = useLibraryStore((s) => s.scan);
  const { locale, setLocale, t } = useTranslation();

  const [folder, setFolder] = useState<string>('');
  const [version, setVersion] = useState('');
  const [closeToTray, setCloseToTray] = useState(true);

  useEffect(() => {
    void api.settingsGet().then((settings) => {
      setFolder(settings.lastFolder ?? '');
      setCloseToTray(settings.closeToTray);
    });
    void api.appInfo().then((info) => setVersion(`${info.name} v${info.version}`));
  }, []);

  // Optimistic toggle: the backend persists the setting for the next launch.
  const toggleCloseToTray = (next: boolean) => {
    setCloseToTray(next);
    void api.settingsSet(next);
  };

  const pickFolder = async () => {
    // The native dialog only exists inside Tauri; mock mode edits the path.
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked === 'string') {
      setFolder(picked);
    }
  };

  const busy = scanProgress != null;

  return (
    <section className="page" data-testid="settings-page">
      <h2>{t('settings.language')}</h2>
      <div className="settings-row language-switch" role="group" aria-label={t('settings.language')}>
        {LOCALES.map((l) => (
          <Button
            key={l}
            variant={l === locale ? 'primary' : 'ghost'}
            aria-pressed={l === locale}
            onClick={() => setLocale(l)}
            data-testid={`locale-${l}`}
          >
            {LOCALE_NAMES[l]}
          </Button>
        ))}
      </div>

      <h2>{t('settings.library')}</h2>
      <div className="settings-row">
        <input
          type="text"
          className="folder-input"
          aria-label={t('settings.musicFolder')}
          value={folder}
          placeholder="C:\Users\me\Music"
          onChange={(e) => setFolder(e.target.value)}
        />
        <Button onClick={() => void pickFolder()}>{t('settings.browse')}</Button>
        <Button
          variant="primary"
          disabled={!folder.trim() || busy}
          onClick={() => void scan(folder.trim())}
          data-testid="scan-button"
        >
          {busy ? t('settings.scanning') : t('settings.scanFolder')}
        </Button>
      </div>

      {busy ? (
        <div className="scan-progress" data-testid="scan-progress">
          <div className="scan-progress-bar">
            <div
              className="scan-progress-fill"
              style={{
                width:
                  scanProgress!.total > 0
                    ? `${Math.round((scanProgress!.scanned / scanProgress!.total) * 100)}%`
                    : '0%',
              }}
            />
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="settings-error" role="alert" data-testid="settings-error">
          {error}
        </div>
      ) : null}

      {lastScan ? (
        <div className="scan-summary" data-testid="scan-summary">
          {t('settings.lastScan', {
            root: lastScan.root,
            filesSeen: lastScan.filesSeen,
            added: lastScan.added,
            updated: lastScan.updated,
            removed: lastScan.removed,
            skipped: lastScan.skipped,
          })}
          {lastScan.warnings.length > 0 ? (
            <ul className="scan-warnings">
              {lastScan.warnings.slice(0, 5).map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <h2>{t('settings.tray')}</h2>
      <div className="settings-row settings-toggle">
        <input
          id="close-to-tray"
          type="checkbox"
          data-testid="close-to-tray"
          checked={closeToTray}
          onChange={(e) => toggleCloseToTray(e.target.checked)}
        />
        <label htmlFor="close-to-tray">{t('settings.closeToTray')}</label>
      </div>
      <p className="muted settings-hint">{t('settings.closeToTrayHint')}</p>

      <h2>{t('settings.about')}</h2>
      <p className="muted">{version || '…'}</p>
      <p className="muted">{t('settings.aboutText')}</p>
    </section>
  );
}

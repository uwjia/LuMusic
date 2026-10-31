// Settings page: language switch, music folder picker + scan, tray, about.
// Each concern lives in its own card (icon + title + hint) inside one
// scroll column, so the page stays scannable as settings grow.

import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { api } from '@/api';
import { Button } from '@/components/ui/Button';
import { LOCALES, LOCALE_NAMES, useTranslation, type MessageKey } from '@/i18n';
import { useLibraryStore } from '@/stores/libraryStore';
import {
  InfoIcon,
  LanguagesIcon,
  MonitorIcon,
  MusicIcon,
} from '@/features/settings/SettingsIcons';

export function SettingsPage() {
  const lastScan = useLibraryStore((s) => s.lastScan);
  const scanProgress = useLibraryStore((s) => s.scanProgress);
  const error = useLibraryStore((s) => s.error);
  const scan = useLibraryStore((s) => s.scan);
  const { locale, setLocale, t } = useTranslation();

  const [folder, setFolder] = useState<string>('');
  const [appName, setAppName] = useState<string>('');
  const [version, setVersion] = useState<string>('');
  const [closeToTray, setCloseToTray] = useState(true);

  useEffect(() => {
    void api.settingsGet().then((settings) => {
      setFolder(settings.lastFolder ?? '');
      setCloseToTray(settings.closeToTray);
    });
    void api.appInfo().then((info) => {
      setAppName(info.name);
      setVersion(info.version);
    });
  }, []);

  // Optimistic toggle: the backend persists the setting for the next launch.
  const toggleCloseToTray = (next: boolean) => {
    setCloseToTray(next);
    void api.settingsSet({ closeToTray: next });
  };

  const pickFolder = async () => {
    // The native dialog only exists inside Tauri; mock mode edits the path.
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked === 'string') {
      setFolder(picked);
    }
  };

  const busy = scanProgress != null;

  // English pluralises chip labels via the paired One/many keys.
  const stat = (count: number, one: MessageKey, many: MessageKey) =>
    t(count === 1 ? one : many, { count });

  return (
    <section className="page settings-page" data-testid="settings-page">
      <header className="page-header">
        <h2>{t('settings.title')}</h2>
      </header>

      <div className="settings-scroll">
        <div className="settings-card">
          <div className="settings-card-head">
            <span className="settings-icon">
              <LanguagesIcon />
            </span>
            <div>
              <h3>{t('settings.language')}</h3>
              <p className="muted">{t('settings.languageHint')}</p>
            </div>
          </div>
          <div className="language-switch" role="group" aria-label={t('settings.language')}>
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
        </div>

        <div className="settings-card">
          <div className="settings-card-head">
            <span className="settings-icon">
              <MusicIcon />
            </span>
            <div>
              <h3>{t('settings.library')}</h3>
              <p className="muted">{t('settings.libraryHint')}</p>
            </div>
          </div>

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
              <span className="muted scan-progress-text">
                {t('library.scanning', {
                  scanned: scanProgress!.scanned,
                  total: scanProgress!.total || '?',
                })}
              </span>
            </div>
          ) : null}

          {error ? (
            <div className="settings-error" role="alert" data-testid="settings-error">
              {error}
            </div>
          ) : null}

          {lastScan ? (
            <div className="scan-summary" data-testid="scan-summary">
              <div className="scan-summary-root">
                {t('settings.lastScanRoot', { root: lastScan.root })}
              </div>
              <div className="scan-stats">
                <span className="scan-stat">
                  {stat(lastScan.filesSeen, 'settings.scanFilesOne', 'settings.scanFiles')}
                </span>
                <span className="scan-stat is-added">
                  {stat(lastScan.added, 'settings.scanAddedOne', 'settings.scanAdded')}
                </span>
                <span className="scan-stat">
                  {stat(lastScan.updated, 'settings.scanUpdatedOne', 'settings.scanUpdated')}
                </span>
                <span className="scan-stat is-removed">
                  {stat(lastScan.removed, 'settings.scanRemovedOne', 'settings.scanRemoved')}
                </span>
                <span className="scan-stat">
                  {stat(lastScan.skipped, 'settings.scanSkippedOne', 'settings.scanSkipped')}
                </span>
              </div>
              {lastScan.warnings.length > 0 ? (
                <ul className="scan-warnings">
                  {lastScan.warnings.slice(0, 5).map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="settings-card">
          <div className="settings-card-head">
            <span className="settings-icon">
              <MonitorIcon />
            </span>
            <div>
              <h3>{t('settings.tray')}</h3>
            </div>
          </div>
          <div className="settings-toggle">
            {/* Visually hidden checkbox drives the styled switch below;
                the label keeps the whole row clickable and accessible. */}
            <input
              id="close-to-tray"
              type="checkbox"
              data-testid="close-to-tray"
              checked={closeToTray}
              onChange={(e) => toggleCloseToTray(e.target.checked)}
            />
            <label htmlFor="close-to-tray" className="switch">
              <span className="switch-track" aria-hidden="true">
                <span className="switch-knob" />
              </span>
              <span>{t('settings.closeToTray')}</span>
            </label>
          </div>
          <p className="muted settings-hint">{t('settings.closeToTrayHint')}</p>
        </div>

        <div className="settings-card">
          <div className="settings-card-head">
            <span className="settings-icon">
              <InfoIcon />
            </span>
            <div>
              <h3>{t('settings.about')}</h3>
            </div>
          </div>
          <div className="about-app">
            <span className="about-name">{appName || '…'}</span>
            {version ? (
              <span className="about-version" data-testid="about-version">
                v{version}
              </span>
            ) : null}
          </div>
          <p className="muted about-text">{t('settings.aboutText')}</p>
        </div>
      </div>
    </section>
  );
}

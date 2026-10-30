// Settings page: music folder picker + scan + about info.

import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { api } from '../../api';
import { Button } from '../../components/ui/Button';
import { useLibraryStore } from '../../stores/libraryStore';

export function SettingsPage() {
  const lastScan = useLibraryStore((s) => s.lastScan);
  const scanProgress = useLibraryStore((s) => s.scanProgress);
  const error = useLibraryStore((s) => s.error);
  const scan = useLibraryStore((s) => s.scan);

  const [folder, setFolder] = useState<string>('');
  const [version, setVersion] = useState('');

  useEffect(() => {
    void api.settingsGet().then((settings) => {
      setFolder(settings.lastFolder ?? '');
    });
    void api.appInfo().then((info) => setVersion(`${info.name} v${info.version}`));
  }, []);

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
      <h2>Library</h2>
      <div className="settings-row">
        <input
          type="text"
          className="folder-input"
          aria-label="Music folder"
          value={folder}
          placeholder="C:\Users\me\Music"
          onChange={(e) => setFolder(e.target.value)}
        />
        <Button onClick={() => void pickFolder()}>Browse…</Button>
        <Button
          variant="primary"
          disabled={!folder.trim() || busy}
          onClick={() => void scan(folder.trim())}
          data-testid="scan-button"
        >
          {busy ? 'Scanning…' : 'Scan folder'}
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
          Last scan of <code>{lastScan.root}</code>: {lastScan.filesSeen} files ·{' '}
          {lastScan.added} added · {lastScan.updated} updated · {lastScan.removed} removed ·{' '}
          {lastScan.skipped} skipped
          {lastScan.warnings.length > 0 ? (
            <ul className="scan-warnings">
              {lastScan.warnings.slice(0, 5).map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <h2>About</h2>
      <p className="muted">{version || '…'}</p>
      <p className="muted">
        Supported formats: MP3, FLAC, WAV, OGG. Settings and the library cache live in the
        app data directory.
      </p>
    </section>
  );
}

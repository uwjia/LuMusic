// Behavior tests for the settings page: language switcher + scan wiring.
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { api } from '@/api';
import { useI18n } from '@/i18n';
import { useLibraryStore } from '@/stores/libraryStore';
import { SettingsPage } from '@/features/settings/SettingsPage';

vi.mock('@/api', () => ({
  api: {
    settingsGet: vi.fn(),
    settingsSet: vi.fn(),
    appInfo: vi.fn(),
    scanLibrary: vi.fn(),
  },
}));

// The native folder dialog does not exist outside Tauri; only its return
// value matters to the page.
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

const eqSettings = { enabled: false, preampDb: 0, gainsDb: Array(10).fill(0) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.settingsGet).mockResolvedValue({
    volume: 0.8,
    lastFolder: 'C:/Music',
    closeToTray: true,
    eq: eqSettings,
  });
  vi.mocked(api.settingsSet).mockResolvedValue({
    volume: 0.8,
    lastFolder: 'C:/Music',
    closeToTray: true,
    eq: eqSettings,
  });
  vi.mocked(api.appInfo).mockResolvedValue({ name: 'LuMusic', version: '0.1.0' });
  useLibraryStore.setState({
    tracks: [],
    query: { search: null, sort: 'title', descending: false },
    loading: false,
    scanProgress: null,
    lastScan: null,
    error: null,
  });
  act(() => {
    useI18n.getState().setLocale('en');
  });
});

describe('SettingsPage language switcher', () => {
  it('lists both locales as endonyms and marks the active one', () => {
    render(<SettingsPage />);
    const enBtn = screen.getByTestId('locale-en');
    const zhBtn = screen.getByTestId('locale-zh-CN');
    expect(enBtn).toHaveTextContent('English');
    expect(zhBtn).toHaveTextContent('简体中文');
    expect(enBtn).toHaveAttribute('aria-pressed', 'true');
    expect(zhBtn).toHaveAttribute('aria-pressed', 'false');
  });

  it('switching to 简体中文 re-renders the page, persists and syncs <html lang>', () => {
    render(<SettingsPage />);
    expect(screen.getByRole('heading', { name: 'Language' })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('locale-zh-CN'));

    expect(screen.getByRole('heading', { name: '语言' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '音乐库' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '关于' })).toBeInTheDocument();
    expect(screen.getByTestId('scan-button')).toHaveTextContent('扫描文件夹');
    expect(localStorage.getItem('lumusic.language')).toBe('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
  });

  it('switching back to English restores the English labels', () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByTestId('locale-zh-CN'));
    fireEvent.click(screen.getByTestId('locale-en'));
    expect(screen.getByRole('heading', { name: 'Language' })).toBeInTheDocument();
    expect(screen.getByTestId('scan-button')).toHaveTextContent('Scan folder');
    expect(localStorage.getItem('lumusic.language')).toBe('en');
  });
});

describe('SettingsPage scan section', () => {
  it('renders the last scan summary with root and stat chips', () => {
    useLibraryStore.setState({
      lastScan: {
        root: 'C:/Music',
        filesSeen: 10,
        added: 6,
        updated: 2,
        removed: 1,
        skipped: 1,
        warnings: [],
      },
    });
    render(<SettingsPage />);
    const summary = screen.getByTestId('scan-summary');
    expect(summary).toHaveTextContent('C:/Music');
    expect(summary).toHaveTextContent('10 files');
    expect(summary).toHaveTextContent('6 added');
    expect(summary).toHaveTextContent('1 removed');
  });

  it('disables scanning while a scan is in progress and shows the busy label', () => {
    useLibraryStore.setState({ scanProgress: { scanned: 1, total: 9 } });
    render(<SettingsPage />);
    const button = screen.getByTestId('scan-button') as HTMLButtonElement;
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Scanning…');
    expect(screen.getByTestId('scan-progress')).toHaveTextContent('1/9');
  });
});

describe('SettingsPage about section', () => {
  it('shows the app name with a version badge', async () => {
    render(<SettingsPage />);
    expect(await screen.findByText('LuMusic')).toBeInTheDocument();
    expect(screen.getByTestId('about-version')).toHaveTextContent('v0.1.0');
  });
});

describe('SettingsPage tray section', () => {
  it('reflects the persisted close-to-tray setting and persists toggles', async () => {
    render(<SettingsPage />);
    const box = (await screen.findByLabelText('Close to tray')) as HTMLInputElement;
    expect(box).toBeChecked();

    fireEvent.click(box);
    expect(box).not.toBeChecked();
    expect(api.settingsSet).toHaveBeenCalledWith({ closeToTray: false });

    fireEvent.click(box);
    expect(api.settingsSet).toHaveBeenLastCalledWith({ closeToTray: true });
  });

  it('starts unchecked when the setting is off', async () => {
    vi.mocked(api.settingsGet).mockResolvedValue({
      volume: 0.8,
      lastFolder: 'C:/Music',
      closeToTray: false,
      eq: eqSettings,
    });
    render(<SettingsPage />);
    expect(await screen.findByLabelText('Close to tray')).not.toBeChecked();
  });
});

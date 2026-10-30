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
    appInfo: vi.fn(),
    scanLibrary: vi.fn(),
  },
}));

// The native folder dialog does not exist outside Tauri; only its return
// value matters to the page.
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.settingsGet).mockResolvedValue({ volume: 0.8, lastFolder: 'C:/Music' });
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
  it('renders the last scan summary with counts', () => {
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
    expect(screen.getByTestId('scan-summary')).toHaveTextContent('6 added');
    expect(screen.getByTestId('scan-summary')).toHaveTextContent('C:/Music');
  });

  it('disables scanning while a scan is in progress and shows the busy label', () => {
    useLibraryStore.setState({ scanProgress: { scanned: 1, total: 9 } });
    render(<SettingsPage />);
    const button = screen.getByTestId('scan-button') as HTMLButtonElement;
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Scanning…');
  });
});

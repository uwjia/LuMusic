// Behavior tests for the tray label sync hook: pushes localized labels on
// mount and re-pushes when the locale changes.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { api } from '@/api';
import { useI18n } from '@/i18n';
import { useTraySync } from '@/hooks/useTraySync';

vi.mock('@/api', () => ({
  api: { traySetLabels: vi.fn().mockResolvedValue(undefined) },
}));

beforeEach(() => {
  vi.clearAllMocks();
  act(() => {
    useI18n.getState().setLocale('en');
  });
});

afterEach(cleanup);

describe('useTraySync', () => {
  it('pushes the English tray labels on mount', () => {
    renderHook(() => useTraySync());
    expect(api.traySetLabels).toHaveBeenCalledTimes(1);
    expect(api.traySetLabels).toHaveBeenCalledWith({
      play: 'Play',
      pause: 'Pause',
      previous: 'Previous track',
      next: 'Next track',
      show: 'Show LuMusic',
      quit: 'Quit',
      nothingPlaying: 'Nothing playing',
    });
  });

  it('re-pushes localized labels when the locale switches', () => {
    renderHook(() => useTraySync());
    act(() => {
      useI18n.getState().setLocale('zh-CN');
    });
    expect(api.traySetLabels).toHaveBeenCalledTimes(2);
    expect(api.traySetLabels).toHaveBeenLastCalledWith({
      play: '播放',
      pause: '暂停',
      previous: '上一曲',
      next: '下一曲',
      show: '显示主窗口',
      quit: '退出',
      nothingPlaying: '暂无播放',
    });
  });
});

// Unit tests for the i18n module: interpolation, locale detection,
// persistence and dictionary parity.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { render, screen } from '@testing-library/react';
import {
  LOCALES,
  detectLocale,
  dictionaries,
  t,
  translate,
  useI18n,
  useTranslation,
} from '@/i18n/index';
import { en } from '@/i18n/locales/en';
import { zhCN } from '@/i18n/locales/zh-CN';

const resetLocale = () => {
  act(() => {
    useI18n.setState({ locale: 'en' });
    document.documentElement.lang = 'en';
  });
  localStorage.removeItem('lumusic.language');
};

beforeEach(() => {
  vi.unstubAllGlobals();
  resetLocale();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetLocale();
});

describe('translate', () => {
  it('interpolates numeric and string params', () => {
    expect(translate('en', 'library.trackCount', { count: 12 })).toBe('12 tracks');
    expect(translate('en', 'playlist.removeTrack', { title: 'Alpha' })).toBe(
      'Remove Alpha from playlist',
    );
  });

  it('handles English singular/plural variants', () => {
    expect(translate('en', 'library.trackCountOne', { count: 1 })).toBe('1 track');
  });

  it('renders Chinese messages for zh-CN', () => {
    expect(translate('zh-CN', 'nav.library')).toBe('音乐库');
    expect(translate('zh-CN', 'library.scanning', { scanned: 2, total: 5 })).toBe(
      '正在扫描… 2/5',
    );
  });

  it('returns the key itself for unknown keys (dev safety, no crash)', () => {
    expect(translate('en', 'no.such.key' as never)).toBe('no.such.key');
  });

  it('keeps unknown placeholders intact instead of dropping them', () => {
    expect(translate('en', 'playlist.removeTrack')).toBe('Remove {title} from playlist');
  });

  it('ignores params the template does not use', () => {
    expect(translate('en', 'nav.library', { count: 3 })).toBe('Library');
  });
});

describe('dictionary parity', () => {
  it('every locale defines exactly the same keys as the en catalogue', () => {
    const enKeys = Object.keys(en).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(dictionaries[locale]).sort()).toEqual(enKeys);
    }
  });

  it('no message is left empty in any locale', () => {
    for (const dict of [en, zhCN]) {
      for (const [key, value] of Object.entries(dict)) {
        expect(value.length, `empty message for ${key}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('detectLocale', () => {
  it('prefers an explicitly stored choice over the OS language', () => {
    localStorage.setItem('lumusic.language', 'en');
    vi.stubGlobal('navigator', { language: 'zh-CN', languages: ['zh-CN', 'zh'] });
    expect(detectLocale()).toBe('en');
  });

  it('maps any Chinese OS language to zh-CN', () => {
    vi.stubGlobal('navigator', { language: 'zh-TW', languages: ['zh-TW', 'zh'] });
    expect(detectLocale()).toBe('zh-CN');
  });

  it('falls back to English for non-Chinese languages', () => {
    vi.stubGlobal('navigator', { language: 'fr-FR', languages: ['fr-FR', 'en'] });
    expect(detectLocale()).toBe('en');
  });

  it('ignores corrupted stored values', () => {
    localStorage.setItem('lumusic.language', 'klingon');
    vi.stubGlobal('navigator', { language: 'en-US', languages: ['en-US'] });
    expect(detectLocale()).toBe('en');
  });
});

describe('useI18n store', () => {
  it('setLocale persists the choice and syncs <html lang>', () => {
    act(() => {
      useI18n.getState().setLocale('zh-CN');
    });
    expect(useI18n.getState().locale).toBe('zh-CN');
    expect(localStorage.getItem('lumusic.language')).toBe('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
  });

  it('t() translates with the current store locale (non-reactive binding)', () => {
    expect(t('nav.settings')).toBe('Settings');
    act(() => {
      useI18n.getState().setLocale('zh-CN');
    });
    expect(t('nav.settings')).toBe('设置');
  });
});

describe('useTranslation', () => {
  it('re-renders components with new messages on locale switch', () => {
    function Probe() {
      const { locale, t: tr } = useTranslation();
      return (
        <div>
          <span data-testid="probe-locale">{locale}</span>
          <span data-testid="probe-msg">{tr('player.repeatOne')}</span>
        </div>
      );
    }

    render(<Probe />);
    expect(screen.getByTestId('probe-msg')).toHaveTextContent('Repeat one');

    act(() => {
      useI18n.getState().setLocale('zh-CN');
    });
    expect(screen.getByTestId('probe-locale')).toHaveTextContent('zh-CN');
    expect(screen.getByTestId('probe-msg')).toHaveTextContent('单曲循环');
  });
});

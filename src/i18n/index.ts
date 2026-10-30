// Minimal dependency-free i18n for the UI layer.
//
// - Two locales: English (`en`, the catalogue source of truth) and
//   Simplified Chinese (`zh-CN`); the dictionaries are key-parity checked
//   by the type system (`Record<MessageKey, string>`).
// - `useI18n` is a tiny zustand store, so components re-render on switch;
//   `t()` is a non-reactive binding for stores/plain modules.
// - The chosen locale persists in localStorage; on first start the OS
//   language is detected (`zh*` -> zh-CN, anything else -> en).
// - `<html lang>` is kept in sync for screen readers / font selection.

import { useCallback } from 'react';
import { create } from 'zustand';
import { en, type MessageKey, type MessageParams } from '@/i18n/locales/en';
import { zhCN } from '@/i18n/locales/zh-CN';

// Re-exported so consumers (e.g. @/lib/playlistDisplay) can key into the
// catalogue without reaching into the locales module directly.
export type { MessageKey, MessageParams } from '@/i18n/locales/en';

export type Locale = 'en' | 'zh-CN';

/** Supported locales in display order. */
export const LOCALES: readonly Locale[] = ['zh-CN', 'en'];

/** Endonyms shown in the language switcher (always in their own language). */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  'zh-CN': '简体中文',
};

const STORAGE_KEY = 'lumusic.language';

export const dictionaries: Record<Locale, Record<MessageKey, string>> = {
  en,
  'zh-CN': zhCN,
};

export type Translate = (key: MessageKey, params?: MessageParams) => string;

/** Renders a message, substituting `{name}` placeholders from `params`. */
export function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
  const dict = dictionaries[locale] ?? dictionaries.en;
  const template = dict[key] ?? String(key);
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    name in params ? String(params[name]) : placeholder,
  );
}

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'zh-CN';
}

function readStoredLocale(): Locale | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isLocale(stored) ? stored : null;
  } catch {
    // Storage can be unavailable (privacy mode / disabled webview storage).
    return null;
  }
}

/** Priority: explicitly saved choice > OS language > English. */
export function detectLocale(): Locale {
  const stored = readStoredLocale();
  if (stored) return stored;
  const langs =
    typeof navigator !== 'undefined' ? (navigator.languages ?? [navigator.language]) : [];
  return langs.some((lang) => /^zh/i.test(lang)) ? 'zh-CN' : 'en';
}

interface I18nState {
  locale: Locale;
  /** Switches the locale, persists it and syncs `<html lang>`. */
  setLocale: (locale: Locale) => void;
}

export const useI18n = create<I18nState>((set) => ({
  locale: detectLocale(),
  setLocale: (locale) => {
    set({ locale });
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // Persistence is best-effort; the switch itself still applies.
    }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
  },
}));

// Non-reactive binding for zustand stores and plain modules (no hooks).
export function t(key: MessageKey, params?: MessageParams): string {
  return translate(useI18n.getState().locale, key, params);
}

/** Reactive binding for components; `t` is stable per locale. */
export function useTranslation(): {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
} {
  const locale = useI18n((s) => s.locale);
  const setLocale = useI18n((s) => s.setLocale);
  const bound = useCallback(
    (key: MessageKey, params?: MessageParams) => translate(locale, key, params),
    [locale],
  );
  return { locale, setLocale, t: bound };
}

// Keep <html lang> correct on startup too (switches are handled by setLocale).
if (typeof document !== 'undefined') {
  document.documentElement.lang = useI18n.getState().locale;
}

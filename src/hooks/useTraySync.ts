// Keeps the native tray menu in the UI's language.
//
// The backend owns the OS tray (icon/menu/tooltip), but - like auto playlist
// names - the strings are translated at the display layer: this hook pushes
// the i18n catalogue's labels on mount and on every locale switch.

import { useEffect } from 'react';
import { api } from '@/api';
import { useTranslation } from '@/i18n';

export function useTraySync(): void {
  const { t } = useTranslation();

  // `t` is stable per locale, so this re-runs exactly on language changes.
  useEffect(() => {
    void api.traySetLabels({
      play: t('player.play'),
      pause: t('player.pause'),
      previous: t('player.prev'),
      next: t('player.next'),
      show: t('tray.show'),
      quit: t('tray.quit'),
      nothingPlaying: t('player.nothingPlaying'),
    });
  }, [t]);
}

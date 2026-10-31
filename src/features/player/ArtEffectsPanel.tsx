// Art effects panel: popover above the player bar listing the preset
// background effects for the lyrics page. Picking a preset applies it
// immediately (the lyrics page previews it live) while the panel stays
// open, so several presets can be tried in a row; closing is done via
// outside press / Escape / the toggle button.

import { useEffect, useRef, type RefObject } from 'react';
import { useTranslation } from '@/i18n';
import { ART_EFFECTS, ART_EFFECT_LABEL_KEY } from '@/lib/artEffects';
import { useArtEffectStore } from '@/stores/artEffectStore';

interface ArtEffectsPanelProps {
  /** The player-bar toggle button; presses on it toggle instead of close. */
  anchorRef: RefObject<HTMLButtonElement | null>;
}

export function ArtEffectsPanel({ anchorRef }: ArtEffectsPanelProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const effect = useArtEffectStore((s) => s.effect);
  const setEffect = useArtEffectStore((s) => s.setEffect);
  const setOpen = useArtEffectStore((s) => s.setOpen);

  // Close on Escape and outside presses; presses on the anchor are the
  // toggle button's own job, so they are excluded (capture phase mirrors
  // the EqualizerPanel / ContextMenu overlay behavior).
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [anchorRef, setOpen]);

  return (
    <div
      ref={panelRef}
      className="fx-panel"
      role="dialog"
      aria-label={t('fx.title')}
      data-testid="fx-panel"
    >
      <div className="fx-head">
        <h3>{t('fx.title')}</h3>
        <span className="muted fx-hint">{t('fx.hint')}</span>
      </div>
      <div className="fx-options" data-testid="fx-options">
        {ART_EFFECTS.map((id) => (
          <button
            key={id}
            type="button"
            className={`fx-option${id === effect ? ' is-active' : ''}`}
            data-testid={`fx-option-${id}`}
            aria-pressed={id === effect}
            onClick={() => setEffect(id)}
          >
            {t(ART_EFFECT_LABEL_KEY[id])}
          </button>
        ))}
      </div>
    </div>
  );
}

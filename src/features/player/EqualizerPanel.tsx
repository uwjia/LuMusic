// Equalizer panel: popover above the player bar with the enable switch,
// preset select, ten band faders and the preamp slider. Band changes flow
// through the equalizer store (optimistic + backend-persisted); sliders
// reuse the drag-safe commit semantics of the shared Slider component.

import { useEffect, useRef, type RefObject } from 'react';
import { Button } from '@/components/ui/Button';
import { Slider } from '@/components/ui/Slider';
import { useTranslation, type MessageKey } from '@/i18n';
import { useEqualizerStore } from '@/stores/equalizerStore';
import {
  EQ_BAND_LABELS,
  EQ_MAX_GAIN_DB,
  EQ_MIN_GAIN_DB,
  EQ_PRESETS,
  clampGain,
  flatGains,
  presetIdOf,
} from '@/lib/equalizer';

const PRESET_KEY: Record<string, MessageKey> = {
  custom: 'eq.preset.custom',
  ...Object.fromEntries(EQ_PRESETS.map((p) => [p.id, `eq.preset.${p.id}` as MessageKey])),
};

/** Formats a band/preamp value as a signed integer ('+4' / '-3' / '0'). */
export function formatDb(db: number): string {
  const rounded = Math.round(db);
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

interface EqualizerPanelProps {
  /** The player-bar toggle button; presses on it toggle instead of close. */
  anchorRef: RefObject<HTMLButtonElement | null>;
}

export function EqualizerPanel({ anchorRef }: EqualizerPanelProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const eq = useEqualizerStore((s) => s.eq);
  const error = useEqualizerStore((s) => s.error);
  const load = useEqualizerStore((s) => s.load);
  const apply = useEqualizerStore((s) => s.apply);
  const setOpen = useEqualizerStore((s) => s.setOpen);

  // Fresh values every time the panel opens (backend is the source of truth).
  useEffect(() => {
    void load();
  }, [load]);

  // Close on Escape and outside presses; presses on the anchor are the
  // toggle button's own job, so they are excluded (capture phase mirrors
  // the ContextMenu overlay behavior).
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

  const currentPreset = presetIdOf(eq.gainsDb);

  const applyGain = (band: number, value: number) => {
    const gains = [...eq.gainsDb];
    gains[band] = clampGain(value);
    void apply({ gainsDb: gains });
  };

  return (
    <div
      ref={panelRef}
      className="eq-panel"
      role="dialog"
      aria-label={t('eq.title')}
      data-testid="eq-panel"
    >
      <div className="eq-head">
        <h3>{t('eq.title')}</h3>
        <div className="settings-toggle">
          <input
            id="eq-enable"
            type="checkbox"
            data-testid="eq-enable"
            checked={eq.enabled}
            onChange={(e) => void apply({ enabled: e.target.checked })}
          />
          <label htmlFor="eq-enable" className="switch">
            <span className="switch-track" aria-hidden="true">
              <span className="switch-knob" />
            </span>
            <span>{t('eq.enable')}</span>
          </label>
        </div>
      </div>

      <div className="eq-controls">
        <label className="eq-preset-label" htmlFor="eq-preset">
          {t('eq.preset')}
        </label>
        <select
          id="eq-preset"
          className="eq-select"
          data-testid="eq-preset"
          value={currentPreset ?? 'custom'}
          onChange={(e) => {
            const preset = EQ_PRESETS.find((p) => p.id === e.target.value);
            if (preset) void apply({ gainsDb: [...preset.gains] });
          }}
        >
          {currentPreset == null ? (
            <option value="custom">{t('eq.preset.custom')}</option>
          ) : null}
          {EQ_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {t(PRESET_KEY[preset.id])}
            </option>
          ))}
        </select>
        <Button onClick={() => void apply({ preampDb: 0, gainsDb: flatGains() })}>
          {t('eq.reset')}
        </Button>
      </div>

      <div className="eq-bands" data-testid="eq-bands">
        {EQ_BAND_LABELS.map((freq, index) => (
          <div className="eq-band" key={freq}>
            <span className="eq-band-value" data-testid={`eq-band-value-${index}`}>
              {formatDb(eq.gainsDb[index] ?? 0)}
            </span>
            <Slider
              className="eq-band-slider"
              aria-label={t('eq.band', { freq })}
              data-testid={`eq-band-${index}`}
              min={EQ_MIN_GAIN_DB}
              max={EQ_MAX_GAIN_DB}
              step={1}
              value={eq.gainsDb[index] ?? 0}
              disabled={!eq.enabled}
              onCommit={(value) => applyGain(index, value)}
            />
            <span className="eq-band-label">{freq}</span>
          </div>
        ))}
        <div className="eq-divider" aria-hidden="true" />
        <div className="eq-band">
          <span className="eq-band-value" data-testid="eq-preamp-value">
            {formatDb(eq.preampDb)}
          </span>
          <Slider
            className="eq-band-slider"
            aria-label={t('eq.preamp')}
            data-testid="eq-preamp"
            min={EQ_MIN_GAIN_DB}
            max={EQ_MAX_GAIN_DB}
            step={1}
            value={eq.preampDb}
            disabled={!eq.enabled}
            onCommit={(value) => void apply({ preampDb: clampGain(value) })}
          />
          <span className="eq-band-label">{t('eq.preampShort')}</span>
        </div>
      </div>

      {error ? (
        <div className="eq-error" role="alert" data-testid="eq-error">
          {error}
        </div>
      ) : null}
    </div>
  );
}

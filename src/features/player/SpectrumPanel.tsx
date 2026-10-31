// Spectrum panel: popover above the player bar drawing the live frequency
// spectrum on a canvas. Bars lerp toward the latest backend frame every
// animation frame; when frames stop (pause/stop) they decay to zero, so no
// stale picture survives the music.
//
// By design the panel stays open until the player-bar toggle is clicked
// again: it is a persistent visualization, so interacting with the app
// (seeking, browsing, EQ) must never dismiss it.

import { useEffect, useRef } from 'react';
import { api } from '@/api';
import { useTranslation } from '@/i18n';
import { usePlayerStore } from '@/stores/playerStore';
import { SILENT_FRAME, useSpectrumStore } from '@/stores/spectrumStore';
import { SPECTRUM_BARS } from '@/types/track';

/** Canvas internal resolution (CSS scales it to the panel width). */
const CANVAS_WIDTH = 480;
const CANVAS_HEIGHT = 160;
/** Per-animation-frame approach factor toward the target (0..1). */
const SMOOTHING = 0.35;
/** Frequency ticks drawn under the bars (locale-neutral literals). */
const AXIS_LABELS: Array<[x01: number, label: string]> = [
  [0.0, '31'],
  [0.33, '250'],
  [0.62, '2k'],
  [0.85, '8k'],
  [1.0, '16k'],
];

export function SpectrumPanel() {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const status = usePlayerStore((s) => s.state?.status);

  // Subscribe while mounted; closing the panel stops the data flow.
  useEffect(() => api.onSpectrum((next) => useSpectrumStore.getState().applyFrame(next)), []);

  // Painting loop: smooth toward the store frame; target silence whenever
  // playback is not running (frames also stop arriving on their own).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const display = [...SILENT_FRAME];
    let raf = 0;
    const styles = getComputedStyle(canvas);
    const accent = styles.getPropertyValue('--accent-2').trim() || '#a855f7';
    const accent2 = styles.getPropertyValue('--accent').trim() || '#6366f1';
    const gridColor = styles.getPropertyValue('--bg-3').trim() || '#2a2f3f';
    const labelColor = styles.getPropertyValue('--fg-2').trim() || '#6b7385';

    const draw = () => {
      const playing = usePlayerStore.getState().state?.status === 'playing';
      const target = playing
        ? useSpectrumStore.getState().frame
        : SILENT_FRAME;
      const gradient = ctx.createLinearGradient(0, CANVAS_HEIGHT, 0, 0);
      gradient.addColorStop(0, accent);
      gradient.addColorStop(1, accent2);

      ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      const barSlot = CANVAS_WIDTH / SPECTRUM_BARS;
      const barWidth = Math.max(2, barSlot - 3);
      for (let bar = 0; bar < SPECTRUM_BARS; bar++) {
        const goal = target[bar] ?? 0;
        display[bar] = display[bar] + (goal - display[bar]) * SMOOTHING;
        const height = Math.max(1, display[bar] * (CANVAS_HEIGHT - 24));
        const x = bar * barSlot + 1.5;
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(x, CANVAS_HEIGHT - 18 - height, barWidth, height, 2);
        ctx.fill();
      }

      // Frequency axis below the bars.
      ctx.fillStyle = labelColor;
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      for (const [x01, label] of AXIS_LABELS) {
        const x = Math.min(CANVAS_WIDTH - 12, Math.max(12, x01 * CANVAS_WIDTH));
        ctx.fillText(label, x, CANVAS_HEIGHT - 4);
      }
      ctx.strokeStyle = gridColor;
      ctx.beginPath();
      ctx.moveTo(0, CANVAS_HEIGHT - 17.5);
      ctx.lineTo(CANVAS_WIDTH, CANVAS_HEIGHT - 17.5);
      ctx.stroke();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      className="spectrum-panel"
      role="dialog"
      aria-label={t('spectrum.title')}
      data-testid="spectrum-panel"
    >
      <div className="spectrum-head">
        <h3>{t('spectrum.title')}</h3>
        <span className="muted spectrum-hint" data-testid="spectrum-status">
          {status === 'playing' ? t('spectrum.live') : t('spectrum.idle')}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        className="spectrum-canvas"
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        aria-label={t('spectrum.canvasLabel')}
        data-testid="spectrum-canvas"
      />
    </div>
  );
}

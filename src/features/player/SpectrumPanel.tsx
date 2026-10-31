// Spectrum panel: chromeless overlay at the bottom-center of the page,
// flush with the player bar's top edge (bars grow straight up out of it),
// drawing the live frequency spectrum on a canvas. Bars lerp toward the
// latest backend frame every animation frame; when frames stop
// (pause/stop) they decay to zero, so no stale picture survives the music.
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
/** Bar opacity — translucent bars never fully hide the page behind the
 * floating overlay (numbers-free, chromeless visualization). */
const BAR_ALPHA = 0.5;

export function SpectrumPanel() {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
      // Translucent fill: the overlay floats over page content, so bars
      // must never fully cover what is behind them.
      ctx.globalAlpha = BAR_ALPHA;
      for (let bar = 0; bar < SPECTRUM_BARS; bar++) {
        const goal = target[bar] ?? 0;
        display[bar] = display[bar] + (goal - display[bar]) * SMOOTHING;
        // Bars grow straight from the canvas's bottom edge (the panel is
        // flush with the player bar) — no reserved axis strip below them.
        const height = Math.max(1, display[bar] * CANVAS_HEIGHT);
        const x = bar * barSlot + 1.5;
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(x, CANVAS_HEIGHT - height, barWidth, height, 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    // Chromeless, text-free and click-through: the panel floats over the
    // bottom-center of whatever page is showing, so only the bars render —
    // the accessible name below is the sole label.
    <div
      className="spectrum-panel"
      role="dialog"
      aria-label={t('spectrum.title')}
      data-testid="spectrum-panel"
    >
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

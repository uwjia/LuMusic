// Art background: a full-page canvas behind the lyrics content rendering
// the preset selected in the player-bar popover. Mounted only while an
// effect is selected — closing the lyrics page (or picking "off")
// unmounts it, which stops the rAF loop and the spectrum subscription,
// so idle art costs nothing.
//
// Music reactivity is opportunistic: spectrum frames (~20 Hz while
// playing) are smoothed into an energy value and per-band display bars;
// when frames go stale (pause/stop) both decay to zero and the effects
// keep drifting at their idle pace.

import { useEffect, useRef } from 'react';
import { api } from '@/api';
import { useTranslation } from '@/i18n';
import { useArtEffectStore } from '@/stores/artEffectStore';
import { SPECTRUM_BARS } from '@/types/track';
import { ART_RENDERERS, type FxColors } from '@/features/lyrics/artRenderers';

/** Per-frame approach factor toward the raw energy target (0..1). */
const ENERGY_SMOOTHING = 0.06;
/** Per-frame approach factor toward the raw bar values (0..1). */
const BARS_SMOOTHING = 0.25;
/** Frames older than this count as silence (backend only emits while playing). */
const FRAME_STALE_MS = 400;
/** Renderer resolution cap — retina-crisp without melting low-end GPUs. */
const MAX_DPR = 2;

export function ArtBackground() {
  const { t } = useTranslation();
  const effect = useArtEffectStore((s) => s.effect);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // The whole painting machine is rebuilt per effect (own seeded state),
  // and torn down on switch/unmount. `off` never mounts the canvas at all.
  useEffect(() => {
    if (effect === 'off') return;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // jsdom has no 2D context; nothing to paint there

    const renderer = ART_RENDERERS[effect];
    const styles = getComputedStyle(canvas);
    const colors: FxColors = {
      accent: styles.getPropertyValue('--accent').trim() || '#6366f1',
      accent2: styles.getPropertyValue('--accent-2').trim() || '#a855f7',
      dim: styles.getPropertyValue('--bg-3').trim() || '#2a2f3f',
    };

    let width = 0;
    let height = 0;
    let fxState: unknown = null;
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      width = wrap.clientWidth;
      height = wrap.clientHeight;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Re-seed on resize: layouts are area-dependent (particle counts).
      if (width > 1 && height > 1) fxState = renderer.create(width, height);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(wrap);

    let rawBars = Array<number>(SPECTRUM_BARS).fill(0);
    let lastFrameAt = 0;
    const bars = Array<number>(SPECTRUM_BARS).fill(0);
    let energy = 0;
    const unsubscribe = api.onSpectrum((frame) => {
      rawBars = frame.slice(0, SPECTRUM_BARS);
      lastFrameAt = performance.now();
    });

    let time = 0;
    let last = performance.now();
    let raf = 0;
    const draw = () => {
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      time += dt;

      const fresh = now - lastFrameAt < FRAME_STALE_MS;
      const target = fresh
        ? rawBars.reduce((sum, value) => sum + value, 0) / Math.max(rawBars.length, 1)
        : 0;
      energy += (target - energy) * ENERGY_SMOOTHING;
      for (let bar = 0; bar < bars.length; bar++) {
        const goal = fresh ? (rawBars[bar] ?? 0) : 0;
        bars[bar] = bars[bar] + (goal - bars[bar]) * BARS_SMOOTHING;
      }

      ctx.clearRect(0, 0, width, height);
      if (width > 1 && height > 1 && fxState) {
        renderer.draw(fxState, { ctx, width, height, time, dt, energy, bars, colors });
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      unsubscribe();
    };
  }, [effect]);

  if (effect === 'off') return null;

  return (
    <div ref={wrapRef} className="art-bg" data-testid="art-bg">
      <canvas
        ref={canvasRef}
        className="art-bg-canvas"
        aria-label={t('fx.canvasLabel')}
        data-testid="art-bg-canvas"
      />
    </div>
  );
}

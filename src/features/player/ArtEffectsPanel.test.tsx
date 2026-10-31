// Behavior tests for the art effects popover: option rendering and
// localized labels, live preview selection (panel stays open), and the
// outside-press / Escape close rules with the anchor excluded.
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ART_EFFECTS, ART_EFFECT_STORAGE_KEY } from '@/lib/artEffects';
import { useArtEffectStore } from '@/stores/artEffectStore';
import { ArtEffectsPanel } from '@/features/player/ArtEffectsPanel';

const anchor = { current: null };

beforeEach(() => {
  localStorage.clear();
  useArtEffectStore.setState({ open: true, effect: 'off' });
});

describe('ArtEffectsPanel', () => {
  it('lists every preset with localized labels and marks the current one', () => {
    render(<ArtEffectsPanel anchorRef={anchor} />);
    expect(screen.getByText('Art effects')).toBeInTheDocument();
    expect(screen.getByText('Renders behind the lyrics page.')).toBeInTheDocument();
    for (const id of ART_EFFECTS) {
      expect(screen.getByTestId(`fx-option-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('fx-option-off')).toHaveClass('is-active');
    expect(screen.getByTestId('fx-option-off')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('fx-option-aurora')).toHaveAttribute('aria-pressed', 'false');
  });

  it('selecting a preset applies it for preview and keeps the panel open', () => {
    render(<ArtEffectsPanel anchorRef={anchor} />);
    fireEvent.click(screen.getByTestId('fx-option-starfield'));
    expect(useArtEffectStore.getState().effect).toBe('starfield');
    expect(localStorage.getItem(ART_EFFECT_STORAGE_KEY)).toBe('starfield');
    // Panel stays mounted so other presets can be tried in a row.
    expect(screen.getByTestId('fx-panel')).toBeInTheDocument();
    expect(screen.getByTestId('fx-option-starfield')).toHaveClass('is-active');
    expect(screen.getByTestId('fx-option-off')).not.toHaveClass('is-active');

    // Switching back to off is equally immediate.
    fireEvent.click(screen.getByTestId('fx-option-off'));
    expect(useArtEffectStore.getState().effect).toBe('off');
  });

  it('closes on outside pointer presses and Escape', () => {
    render(<ArtEffectsPanel anchorRef={anchor} />);
    // The panel itself stays mounted here — unmounting is the player
    // bar's conditional render; what the panel owns is the store flag.
    fireEvent.pointerDown(document.body);
    expect(useArtEffectStore.getState().open).toBe(false);

    useArtEffectStore.setState({ open: true });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useArtEffectStore.getState().open).toBe(false);
  });

  it('ignores presses on itself and on the anchor toggle button', () => {
    const anchorButton = document.createElement('button');
    document.body.appendChild(anchorButton);
    const anchored = { current: anchorButton };
    try {
      render(<ArtEffectsPanel anchorRef={anchored} />);
      // Pressing an option must select, not dismiss (panel contains it).
      fireEvent.pointerDown(screen.getByTestId('fx-option-wave'));
      expect(useArtEffectStore.getState().open).toBe(true);
      // Pressing the toggle button is that button's own job (toggle).
      fireEvent.pointerDown(anchorButton);
      expect(useArtEffectStore.getState().open).toBe(true);
    } finally {
      anchorButton.remove();
    }
  });
});

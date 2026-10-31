// Store behavior: sanitized initial value, visibility toggling and
// persistence of the preset choice (jsdom provides the real localStorage).
import { beforeEach, describe, expect, it } from 'vitest';
import { ART_EFFECT_STORAGE_KEY } from '@/lib/artEffects';
import { useArtEffectStore } from '@/stores/artEffectStore';

beforeEach(() => {
  localStorage.clear();
  useArtEffectStore.setState({ open: false, effect: 'off' });
});

describe('artEffectStore', () => {
  it('starts closed with no effect', () => {
    const state = useArtEffectStore.getState();
    expect(state.open).toBe(false);
    expect(state.effect).toBe('off');
  });

  it('toggle flips panel visibility', () => {
    useArtEffectStore.getState().toggle();
    expect(useArtEffectStore.getState().open).toBe(true);
    useArtEffectStore.getState().setOpen(false);
    expect(useArtEffectStore.getState().open).toBe(false);
  });

  it('setEffect updates state and persists the choice', () => {
    useArtEffectStore.getState().setEffect('aurora');
    expect(useArtEffectStore.getState().effect).toBe('aurora');
    expect(localStorage.getItem(ART_EFFECT_STORAGE_KEY)).toBe('aurora');

    useArtEffectStore.getState().setEffect('off');
    expect(localStorage.getItem(ART_EFFECT_STORAGE_KEY)).toBe('off');
  });
});

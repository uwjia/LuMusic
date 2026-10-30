// Jest-DOM matchers for Vitest (toBeInTheDocument, toHaveValue, ...).
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Auto-cleanup only registers when vitest globals are enabled; we import
// them explicitly, so unmount between tests manually.
afterEach(() => cleanup());

// jsdom lacks ResizeObserver, which @tanstack/react-virtual observes to size
// the scroll viewport. A no-op stub keeps the virtualizer on its
// `initialRect` fallback so rows render in tests.
class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

// jsdom always reports 0x0 element sizes. The virtualized track table derives
// its viewport from the scroll element's clientWidth/clientHeight, so give
// that element a size (other elements keep the jsdom default of 0).
Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
  configurable: true,
  get(this: HTMLElement) {
    return this.classList.contains('track-body') ? 600 : 0;
  },
});
Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
  configurable: true,
  get(this: HTMLElement) {
    return this.classList.contains('track-body') ? 900 : 0;
  },
});

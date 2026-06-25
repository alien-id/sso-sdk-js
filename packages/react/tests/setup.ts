import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom has no canvas; mock qr-code-styling with the surface the components use.
vi.mock('qr-code-styling', () => ({
  default: class QRCodeStylingMock {
    data = '';
    container: HTMLElement | null = null;
    update(options?: { data?: string }) {
      if (options?.data) this.data = options.data;
      this.container?.setAttribute('data-qr', this.data);
    }
    append(container: HTMLElement) {
      this.container = container;
      container.setAttribute('data-qr', this.data);
    }
  },
}));

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

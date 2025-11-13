import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

if (!import.meta.env.VITE_WS_URL) {
  vi.stubEnv('VITE_WS_URL', 'ws://localhost:8787');
}

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  value: vi.fn(function getContext(this: HTMLCanvasElement) {
    const gradientStub = {
      addColorStop: () => {},
    };

    return {
      canvas: this,
      clearRect: () => {},
      fillRect: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      closePath: () => {},
      fill: () => {},
      save: () => {},
      restore: () => {},
      translate: () => {},
      rotate: () => {},
      scale: () => {},
      setTransform: () => {},
      arc: () => {},
      createLinearGradient: () => gradientStub,
      createRadialGradient: () => gradientStub,
      putImageData: () => {},
      drawImage: () => {},
      measureText: () => ({ width: 0 }),
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 1,
    };
  }),
});

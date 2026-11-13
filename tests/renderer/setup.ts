import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => { cleanup(); });

// jsdom has no layout. Give elements a fixed size so the virtual table behaves like a
// 600 px tall viewport with 40 px rows instead of rendering nothing (0 px) or everything.
Object.defineProperties(HTMLElement.prototype, {
  offsetHeight: { configurable: true, get() { return 600; } },
  offsetWidth: { configurable: true, get() { return 1000; } },
  clientHeight: { configurable: true, get() { return 600; } },
  clientWidth: { configurable: true, get() { return 1000; } },
});
HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
  return { x: 0, y: 0, top: 0, left: 0, bottom: 40, right: 1000, width: 1000, height: 40, toJSON() { return this; } } as DOMRect;
};
if (!HTMLElement.prototype.scrollTo) HTMLElement.prototype.scrollTo = function scrollTo() {};
if (!('ResizeObserver' in globalThis)) {
  (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

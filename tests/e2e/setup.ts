import { expect } from 'vitest';

interface LocatorLike { waitFor(o: { state: 'visible'; timeout?: number }): Promise<void>; toString(): string }

// Minimal Playwright-style async matcher so `await expect(locator).toBeVisible()` works under vitest.
expect.extend({
  async toBeVisible(received: LocatorLike) {
    try {
      await received.waitFor({ state: 'visible', timeout: 15000 });
      return { pass: true, message: () => `${received} is visible` };
    } catch (e) {
      return { pass: false, message: () => `${received} did not become visible: ${(e as Error).message}` };
    }
  },
});

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> { toBeVisible(): Promise<void> }
}

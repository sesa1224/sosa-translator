// Helpers for the screen's short animations. The animations themselves are CSS (theme.css, "motion"); code only
// decides the moment a class goes on, so that they play when something changed and never on scroll or selection.

/** Where motion reads the time. Tests move it forward instead of waiting. */
export const motionClock = { now: (): number => performance.now() };

/** How long a table row keeps its "just changed" classes: the length of the rowflash and pop animations. */
export const ROW_FLASH_MS = 900;
export const POP_MS = 450;

/** A table row's last change: when, whether it flashes (a translation came in, an approval) and whether its pill pops. */
export interface RowMotion { at: number; flash: boolean; pop: boolean }

/**
 * Plays a one-off animation on an element again from the start (the class is taken off, layout is forced so the
 * browser sees it gone, and put back). The class comes off by itself when the animation ends.
 */
export function replay(el: Element | null, cls: 'flash' | 'shake'): void {
  if (!el) return;
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
  const done = (e: Event) => {
    // Animations of children bubble up here too; only this element's own one ends it.
    if (e.target !== el) return;
    el.classList.remove(cls);
    el.removeEventListener('animationend', done);
  };
  el.addEventListener('animationend', done);
}

/**
 * Whether a row's change is still playing at `now`, and the delay that lines the animation up with the moment of
 * the change. A virtualized row that leaves the screen and comes back mounts again: inside the window it carries
 * on where it was (negative delay) instead of starting over, after the window it has no class at all.
 */
export function rowMotionStyle(m: RowMotion | undefined, mountedAt: number, now: number): { flash: boolean; pop: boolean; delay: string | undefined } {
  if (!m) return { flash: false, pop: false, delay: undefined };
  const age = now - m.at;
  const flash = m.flash && age < ROW_FLASH_MS;
  const pop = m.pop && age < POP_MS;
  const behind = mountedAt - m.at;
  return { flash, pop, delay: (flash || pop) && behind > 0 ? `${-Math.round(behind)}ms` : undefined };
}

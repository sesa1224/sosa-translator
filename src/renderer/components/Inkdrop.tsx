// 먹물이, the chat's helper: a drop of ink with a face, drawn in code and coloured by the theme's accent.
// It carries the chat's state so the panel is not just two columns of boxes: idle (floats and blinks), working
// (tilts its head, eyes going side to side) and just done (hops, then back to idle). The movement is CSS
// (theme.css "the helper"), so the motion setting and the system's reduced motion stop it like everything else.
import { useEffect, useRef, useState } from 'react';

export type InkState = 'idle' | 'work' | 'done';

/** How long the "just done" hop shows before the helper is idle again: two hops of the animation. */
export const INK_DONE_MS = 1200;

/** The picture. Decoration only: screen readers skip it, the words around it say what is going on. */
export function Inkdrop({ state = 'idle', size = 30, still = false, className }: { state?: InkState; size?: number; still?: boolean; className?: string }) {
  const cls = `ink ink-${state}${still ? ' ink-still' : ''}${className ? ` ${className}` : ''}`;
  return (
    <svg className={cls} viewBox="0 0 40 40" width={size} height={size} aria-hidden="true" focusable="false">
      <path className="ink-body" d="M20 3c5 7 14 13 14 22a14 14 0 0 1-28 0c0-9 9-15 14-22z" />
      <ellipse className="ink-shine" cx="13.5" cy="19" rx="2.6" ry="4.2" transform="rotate(20 13.5 19)" />
      <ellipse className="ink-eye" cx="15.5" cy="25" rx="1.9" ry="2.4" />
      <ellipse className="ink-eye" cx="24.5" cy="25" rx="1.9" ry="2.4" />
      <circle className="ink-cheek" cx="11.8" cy="29" r="2" />
      <circle className="ink-cheek" cx="28.2" cy="29" r="2" />
      <path className="ink-mouth" d="M18 30.2q2 1.8 4 0" />
    </svg>
  );
}

/** The helper's state from whether the chat is busy: working while busy, a short "done" when it stops, then idle. */
export function useInkState(busy: boolean): InkState {
  const [done, setDone] = useState(false);
  const was = useRef(busy);
  useEffect(() => {
    const ended = was.current && !busy;
    was.current = busy;
    if (!ended) {
      if (busy) setDone(false);
      return;
    }
    setDone(true);
    const t = setTimeout(() => setDone(false), INK_DONE_MS);
    return () => clearTimeout(t);
  }, [busy]);
  return busy ? 'work' : done ? 'done' : 'idle';
}

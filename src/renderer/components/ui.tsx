// Parts every screen wears the same way (theme.css "shared parts"): the screen head, a picker whose background
// slides to the picked button, a switch, a tinted callout and an empty state. Screens use these instead of
// dressing themselves up one by one, so a change here reaches all of them.
import { TriangleAlertIcon, type LucideIcon } from 'lucide-react';
import { useLayoutEffect, useRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { num } from '../format';
import { ICON } from '../icons';

/** Big title, an optional count badge beside it, one line under it, and the screen's own actions on the right. */
export function ScreenHead({ title, count, desc, children }: { title: ReactNode; count?: ReactNode; desc?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="ph-text">
        <div className="ph-title">
          <h1 className="page-title">{title}</h1>
          {count !== undefined && count !== null && <span className="cnt">{count}</span>}
        </div>
        {desc && <p className="page-desc">{desc}</p>}
      </div>
      {children && <div className="ph-actions">{children}</div>}
    </header>
  );
}

/**
 * Two to four buttons of which one is picked; one background slides under the picked one (the left menu's way).
 * The picked button is the one marked .on. Placed after every render and when the size changes (fonts arriving,
 * a narrower window). The first place is taken without sliding there.
 */
export function Seg({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const box = ref.current;
    const th = thumb.current;
    if (!box || !th) return;
    const place = () => {
      const on = box.querySelector<HTMLElement>(':scope > button.on');
      th.hidden = !on;
      if (!on) return;
      th.style.width = `${on.offsetWidth}px`;
      th.style.transform = `translateX(${on.offsetLeft}px)`;
      if (!th.dataset.placed) {
        void th.offsetWidth;
        th.dataset.placed = '1';
      }
    };
    place();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(place);
    ro.observe(box);
    return () => ro.disconnect();
  });
  return (
    <div ref={ref} className={`seg slide${className ? ` ${className}` : ''}`} role="group" aria-label={label}>
      <span className="th" ref={thumb} aria-hidden="true" />
      {children}
    </div>
  );
}

/** An on/off setting: the words, then the switch at the end of the line. It stays a checkbox underneath. */
export function Switch({ label, className, ...input }: { label: ReactNode } & Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role'>) {
  return (
    <label className={`sw-line${className ? ` ${className}` : ''}`}>
      <span>{label}</span>
      <input type="checkbox" role="switch" className="sw" {...input} />
    </label>
  );
}

/** A note that holds up the work on this screen, as one tinted line with a button that goes to fix it. */
export function Callout({ children, action, tone = 'warn', icon: Icon = TriangleAlertIcon }: { children: ReactNode; action?: ReactNode; tone?: 'warn' | 'info'; icon?: LucideIcon }) {
  return (
    <div className={`call${tone === 'info' ? ' info' : ''}`}>
      <Icon {...ICON} />
      <span className="call-text">{children}</span>
      {action}
    </div>
  );
}

/** A square of soft colour holding an icon, at the start of a list row or an empty state. */
export function Tile({ icon: Icon, tone }: { icon: LucideIcon; tone?: 'warn' | 'err' | 'mute' | 'ok' | 'info' }) {
  return <span className={`tile${tone ? ` ${tone}` : ''}`} aria-hidden="true"><Icon {...ICON} /></span>;
}

/** What a screen shows with nothing in it: a picture (icon tile or the helper), a title, the words, ways onward. */
export function EmptyState({ art, title, children, actions }: { art: ReactNode; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="es">
      {art}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {actions && <div className="es-actions">{actions}</div>}
    </div>
  );
}

/** A menu item's count, coloured by what it means (a count that wants a person is warn, plain progress is mute). Zero draws nothing. */
export function NavCount({ n, tone, title }: { n: number; tone: 'mute' | 'warn' | 'err' | 'info'; title: string }) {
  if (n <= 0) return null;
  return <span className={`nb nb-${tone}`} title={title}>{num(n)}</span>;
}

/** A number the screen is judged by; a zero is drawn quiet, a count with a meaning colour only when it is not zero. */
export function Stat({ label, value, tone, note, action }: {
  label: ReactNode; value: number; tone?: 'warn' | 'ok' | 'info' | 'err';
  /** A short line on what the number stands for, so a card that only repeated it is not needed. */
  note?: ReactNode;
  /** The one thing to do with these lines (a quiet button), kept with their number. */
  action?: ReactNode;
}) {
  return (
    <div className={`stat${value === 0 ? ' zero' : tone ? ` ${tone}` : ''}${action ? ' has-action' : ''}`}>
      <b className="mono">{num(value)}</b>
      <span>{label}</span>
      {note && <span className="stat-note">{note}</span>}
      {action && <span className="stat-action">{action}</span>}
    </div>
  );
}

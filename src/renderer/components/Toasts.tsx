import { CheckIcon } from 'lucide-react';
import { ICON } from '../icons';
import { useApp } from '../state';

/**
 * Short notes in the lower right that rise, stack and leave by themselves (state.ts notify). The list is always
 * there, even empty, so screen readers announce each note as it is added.
 */
export function Toasts() {
  const { toasts } = useApp();
  return (
    <section className="toasts" aria-live="polite" aria-label="알림">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.out ? ' out' : ''}`}>
          <CheckIcon {...ICON} className="okd" strokeWidth={2.5} />
          <span>{t.text}</span>
        </div>
      ))}
    </section>
  );
}

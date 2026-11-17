import { SearchIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { findText, listCommands, type Command } from '../commands';
import { ICON } from '../icons';
import { useApp } from '../state';

/** One line of the list: a command from the table, or "문장 찾기" for what was typed. */
interface Item { key: string; label: string; icon: Command['icon']; note: string | null; blocked: boolean; run: () => void | Promise<unknown> }

/**
 * The command search over the window (Ctrl+K or the title bar's search button). It lists the screens, the actions
 * and the table filters (commands.ts), narrowed by what is typed, and offers to find the typed text in the lines.
 * Up and down pick, Enter runs, Esc or a click outside closes. Something that cannot run now stays dimmed with why.
 */
export function CommandPalette() {
  const app = useApp();
  // Ctrl+K works anywhere in the workspace, also while typing in a box.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (useApp.get().paletteOpen) useApp.closePalette();
        else useApp.openPalette();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return app.paletteOpen ? <Palette /> : null;
}

function Palette() {
  const app = useApp();
  const [text, setText] = useState('');
  const [pick, setPick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Focus goes back where it was (the table, a box) when the search closes.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => { before?.focus?.({ preventScroll: true }); };
  }, []);

  const items = useMemo((): Item[] => {
    const typed = text.trim();
    const found: Item[] = listCommands(app, typed).map((c) => {
      const why = c.blocked?.(app) ?? null;
      return { key: c.id, label: c.label, icon: c.icon, note: why, blocked: why !== null, run: c.run };
    });
    // Last, so Enter on a word that names a command runs the command; first when nothing else matches.
    if (typed !== '') found.push({ key: 'find', label: `문장 찾기: ${typed}`, icon: SearchIcon, note: '텍스트', blocked: false, run: () => findText(typed) });
    return found;
  }, [app, text]);
  const current = Math.min(pick, Math.max(0, items.length - 1));

  useEffect(() => {
    listRef.current?.querySelector('.pal-item.on')?.scrollIntoView?.({ block: 'nearest' });
  }, [current]);

  const run = async (it: Item | undefined) => {
    if (!it || it.blocked) return;
    setError(null);
    try {
      await it.run();
      useApp.closePalette();
    } catch (e) {
      // Errors stay here, where the user asked for the thing, rather than vanishing with the list.
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setPick(Math.min(items.length - 1, current + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setPick(Math.max(0, current - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); void run(items[current]); }
    else if (e.key === 'Escape') { e.preventDefault(); useApp.closePalette(); }
  };

  return (
    <div className="veil" onMouseDown={(e) => { if (e.target === e.currentTarget) useApp.closePalette(); }}>
      <div className="pal" role="dialog" aria-modal="true" aria-label="명령 검색">
        <input ref={inputRef} className="pal-input" role="combobox" aria-label="명령 검색어" aria-expanded="true" aria-controls="pal-list"
          aria-activedescendant={items.length > 0 ? `pal-${items[current].key}` : undefined} aria-autocomplete="list"
          placeholder="화면, 동작, 거르기, 또는 찾을 문장" autoComplete="off" spellCheck={false} value={text}
          onChange={(e) => { setText(e.target.value); setPick(0); setError(null); }} onKeyDown={onKey} />
        <ul id="pal-list" className="pal-list" role="listbox" aria-label="명령" ref={listRef}>
          {items.map((it, i) => {
            const Icon = it.icon;
            return (
              <li key={it.key} id={`pal-${it.key}`} role="option" aria-selected={i === current} aria-disabled={it.blocked || undefined}
                className={`pal-item${i === current ? ' on' : ''}`} onMouseMove={() => { if (i !== current) setPick(i); }}
                onMouseDown={(e) => e.preventDefault()} onClick={() => void run(it)}>
                <Icon {...ICON} /><span className="pal-label">{it.label}</span>{it.note && <span className="pal-note">{it.note}</span>}
              </li>
            );
          })}
          {items.length === 0 && <li className="pal-empty" role="presentation">맞는 명령이 없어요</li>}
        </ul>
        {error && <div className="pal-error err-text small" role="alert">{error}</div>}
      </div>
    </div>
  );
}

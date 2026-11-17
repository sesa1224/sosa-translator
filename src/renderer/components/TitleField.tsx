import { useState, type KeyboardEvent } from 'react';
import { useApp } from '../state';

// Kept off the title bar, where it would sit beside every other label; the pencil's tooltip and screen readers say it.
const NOTE = '작업표시줄과 타이틀 화면에 이 이름이 보여요';
const NOTE_ID = 'title-field-note';

/** The translated game title under the original one; the pencil turns it into an input (Enter saves, Esc cancels). */
export function TitleField() {
  const app = useApp();
  const title = app.snapshot?.gameTitle ?? null;
  const row = title === null ? undefined
    : app.rowOrder.map((id) => app.rowsById[id]).find((r) => r.kind === 'system' && r.file === 'data/System.json' && r.source === title);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (title === null || !row) return null;

  const start = () => {
    setValue(row.target ?? '');
    setError(null);
    setEditing(true);
  };
  const onKey = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setEditing(false);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      try {
        await useApp.setGameTitle(value);
        setEditing(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  };
  return (
    <span className="title-field">
      {editing
        ? <input className="input title-input" aria-label="번역 제목" aria-describedby={NOTE_ID} autoFocus value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => void onKey(e)} />
        : <span className={row.target ? 'title-target' : 'mute small'}>{row.target ?? '제목 번역 없음'}</span>}
      {!editing && <button type="button" className="icon-btn" aria-label="게임 제목 고치기" aria-describedby={NOTE_ID}
        title={`게임 제목 고치기
${NOTE}`} onClick={start}>✎</button>}
      <span id={NOTE_ID} className="sr-only">{NOTE}</span>
      {error && <span className="err-text small" role="alert">{error}</span>}
    </span>
  );
}

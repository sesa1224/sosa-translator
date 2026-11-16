import { useEffect, useState } from 'react';
import type { ActionOrigin, ActionSummary, CancelResult } from '../../shared/api';
import { num } from '../format';
import { useApp } from '../state';

const WHO: Record<ActionOrigin, string> = { user: '사용자', batch: '번역 작업', review: '검수', chat: '채팅', external: '외부 번역' };

const pad = (n: number) => String(n).padStart(2, '0');

/** '2026-11-16 10:30' in local time. */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function resultNote(r: CancelResult): string {
  const head = `${num(r.restored)}개를 되돌렸어요.`;
  return r.skipped > 0 ? `${head} ${num(r.skipped)}개는 그 뒤에 바뀌어서 그대로 뒀어요.` : head;
}

/** The persistent log of translation changes: cancel one action, or every action after a point. */
export function HistoryView() {
  const history = useApp().history ?? null;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void useApp.loadHistory(); }, []);

  const run = async (question: string, f: () => Promise<CancelResult>) => {
    if (!window.confirm(question)) return;
    setBusy(true);
    setNote(null);
    setError(null);
    try {
      setNote(resultNote(await f()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const cancelOne = (a: ActionSummary) => run(
    `"${a.label}"을(를) 취소할까요? 바뀐 줄 ${num(a.count)}개를 그 전으로 되돌려요. 그 뒤에 다시 바뀐 줄은 그대로 둬요.`,
    () => useApp.cancelAction(a.id));
  const rollback = (a: ActionSummary, list: ActionSummary[]) => {
    const later = list.slice(0, list.indexOf(a)).filter((x) => x.undoneAt === undefined);
    const lines = later.reduce((n, x) => n + x.count, 0);
    return run(
      `이 시점 뒤의 행동 ${num(later.length)}개(바뀐 줄 ${num(lines)}개)를 새것부터 취소할까요? "${a.label}"은(는) 남겨요.`,
      () => useApp.rollbackTo(a.id));
  };

  return (
    <div className="history-view">
      <div className="page-head">
        <h1 className="page-title">작업 기록</h1>
      </div>
      <span className="hint">번역문에 생긴 변화를 행동마다 남겨요(최근 200개). 용어집·판단·그림·이벤트 수정은 여기서 되돌리지 않아요.</span>
      {note && <span className="accent-text small" role="status">{note}</span>}
      {error && <span className="err-text small" role="alert">{error}</span>}
      {history === null && <span className="sub small">기록을 읽는 중이에요</span>}
      {history !== null && history.length === 0 && <div className="empty">아직 기록이 없어요. 번역을 고치거나 작업을 돌리면 여기에 쌓여요.</div>}
      {history?.map((a) => {
        const undone = a.undoneAt !== undefined;
        return (
          <article key={a.id} className={`card hv-item${undone ? ' hv-undone' : ''}`} aria-label={a.label}>
            <span className="mono sub small">{when(a.at)}</span>
            <span className="tag">{WHO[a.origin]}</span>
            <span className="hv-label">{a.label}</span>
            <span className="mono sub small">{`${num(a.count)}줄`}</span>
            {undone && <span className="warn-text small">취소됨</span>}
            <div className="grow" />
            <button type="button" className="btn small-btn" disabled={busy || undone} onClick={() => void cancelOne(a)}>이 행동만 취소</button>
            <button type="button" className="btn ghost small-btn" disabled={busy} onClick={() => void rollback(a, history)}>이 시점으로 되돌리기</button>
          </article>
        );
      })}
    </div>
  );
}

import { DownloadIcon, MessageCircleIcon, PencilLineIcon, ScanSearchIcon, SparklesIcon, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { changedWords } from '../../core/update/carry';
import type { ActionLine, ActionOrigin, ActionPreview, ActionSummary, CancelResult } from '../../shared/api';
import { num, STATUS_LABEL } from '../format';
import { useApp } from '../state';
import { DiffPieces } from './DiffPieces';
import { Inkdrop } from './Inkdrop';
import { EmptyState, ScreenHead, Tile } from './ui';

const WHO: Record<ActionOrigin, string> = { user: '사용자', batch: '번역 작업', review: '검수', chat: '채팅', external: '외부 번역' };
const WHO_ICON: Record<ActionOrigin, LucideIcon> = { user: PencilLineIcon, batch: SparklesIcon, review: ScanSearchIcon, chat: MessageCircleIcon, external: DownloadIcon };
const GONE = '(지금은 없는 문장)';

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

/** 'メッセージ速度 → 메시지 속도', or the status change when the translation stayed. */
function previewText(p: ActionPreview): string {
  const source = p.source ?? GONE;
  if (p.status) return `${source} · ${STATUS_LABEL[p.status.before]} → ${STATUS_LABEL[p.status.after]}`;
  return `${source} → ${p.cleared ? '(번역 지움)' : p.target ?? '(번역 없음)'}`;
}

/** What one opened action has fetched so far (pages of 100 lines). */
interface Loaded { lines: ActionLine[]; total: number; loading: boolean; error: string | null }

function LineChange({ l }: { l: ActionLine }) {
  const targetChanged = l.before.target !== l.after.target;
  const statusChanged = l.before.status !== l.after.status;
  const words = targetChanged ? changedWords(l.before.target ?? '', l.after.target ?? '') : null;
  return (
    <li className="hv-line">
      <div className="hv-line-head">
        <span className="mono sub small">{l.location}</span>
        <div className="grow" />
        <button type="button" className="btn ghost small-btn" disabled={!l.exists} onClick={() => void useApp.selectRow(l.unitId)}>이 문장 보기</button>
      </div>
      <div className="hv-src pre">{l.source ?? GONE}</div>
      {words && (
        <div className="hv-change pre">
          {l.before.target === null ? <span className="sub">(번역 없음)</span> : <DiffPieces pieces={words.old} kind="old" />}
          <span className="sub hv-arrow">→</span>
          {l.after.target === null ? <span className="warn-text">(번역 지움)</span> : <DiffPieces pieces={words.new} kind="new" />}
        </div>
      )}
      {statusChanged && <span className="small sub">{`${STATUS_LABEL[l.before.status]} → ${STATUS_LABEL[l.after.status]}`}</span>}
      {!targetChanged && !statusChanged && <span className="small sub">번역과 상태는 그대로예요(검수 의견 같은 것만 바뀜)</span>}
    </li>
  );
}

function ActionLines({ d, onMore }: { d: Loaded; onMore: () => void }) {
  const rest = d.total - d.lines.length;
  return (
    <div className="hv-detail">
      {d.lines.length > 0 && <ul className="hv-lines" aria-label="바뀐 문장">{d.lines.map((l, i) => <LineChange key={`${l.unitId}-${i}`} l={l} />)}</ul>}
      {d.loading && <span className="sub small">바뀐 문장을 읽는 중이에요</span>}
      {d.error && <span className="err-text small" role="alert">{d.error}</span>}
      {!d.loading && rest > 0 && <button type="button" className="btn ghost small-btn hv-more" onClick={onMore}>{`외 ${num(rest)}줄 더 보기`}</button>}
    </div>
  );
}

/** The persistent log of translation changes: open one to see its lines, cancel one action, or every action after a point. */
export function HistoryView() {
  const history = useApp().history ?? null;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // Kept after closing so opening again does not fetch again; a logged action's lines never change.
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  useEffect(() => { void useApp.loadHistory(); }, []);

  const fetchLines = async (id: string, offset: number) => {
    setLoaded((m) => ({ ...m, [id]: { lines: m[id]?.lines ?? [], total: m[id]?.total ?? 0, loading: true, error: null } }));
    try {
      const r = await useApp.loadActionDetail(id, offset);
      setLoaded((m) => ({ ...m, [id]: { lines: [...(m[id]?.lines ?? []).slice(0, offset), ...r.lines], total: r.total, loading: false, error: null } }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setLoaded((m) => ({ ...m, [id]: { lines: m[id]?.lines ?? [], total: m[id]?.total ?? 0, loading: false, error: message } }));
    }
  };
  const toggle = (id: string) => {
    const next = !open[id];
    setOpen((m) => ({ ...m, [id]: next }));
    if (next && (!loaded[id] || loaded[id].error)) void fetchLines(id, 0);
  };

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
      <ScreenHead title="작업 기록" count={history && history.length > 0 ? `${num(history.length)}개` : undefined}
        desc="번역문에 생긴 변화를 행동마다 남겨요(최근 200개). 용어집·판단·그림·이벤트 수정은 여기서 되돌리지 않아요. 줄을 누르면 바뀐 문장이 보여요." />
      {note && <span className="accent-text small" role="status">{note}</span>}
      {error && <span className="err-text small" role="alert">{error}</span>}
      {history === null && <span className="sub small">기록을 읽는 중이에요</span>}
      {history !== null && history.length === 0 && (
        <EmptyState art={<Inkdrop size={56} />} title="아직 쌓인 기록이 없어요">아직 기록이 없어요. 번역을 고치거나 작업을 돌리면 여기에 쌓여요.</EmptyState>
      )}
      {history !== null && history.length > 0 && <div className="list hv-list">{history.map((a) => {
        const undone = a.undoneAt !== undefined;
        const expanded = open[a.id] === true;
        return (
          <article key={a.id} className={`li hv-item${undone ? ' hv-undone' : ''}`} aria-label={a.label}>
            <div className="hv-head">
              <Tile icon={WHO_ICON[a.origin]} tone={undone ? 'mute' : undefined} />
              {/* The row itself is the toggle; the two action buttons sit beside it, so pressing them never opens it. */}
              <button type="button" className="hv-toggle" aria-expanded={expanded} onClick={() => toggle(a.id)}>
                <span className="hv-meta">
                  <span className="hv-chevron sub" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                  <span className="mono sub small">{when(a.at)}</span>
                  <span className="tag">{WHO[a.origin]}</span>
                  <span className="hv-label">{a.label}</span>
                  <span className="mono sub small">{`${num(a.count)}줄`}</span>
                  {undone && <span className="warn-text small">취소됨</span>}
                </span>
                {a.preview && (
                  <span className="hv-preview small">
                    <span className="hv-preview-text">{previewText(a.preview)}</span>
                    {a.preview.more > 0 && <span className="sub">{`외 ${num(a.preview.more)}줄`}</span>}
                  </span>
                )}
              </button>
              <button type="button" className="btn small-btn" disabled={busy || undone} onClick={() => void cancelOne(a)}>이 행동만 취소</button>
              <button type="button" className="btn ghost small-btn" disabled={busy} onClick={() => void rollback(a, history)}>이 시점으로 되돌리기</button>
            </div>
            {expanded && loaded[a.id] && <ActionLines d={loaded[a.id]} onMore={() => void fetchLines(a.id, loaded[a.id].lines.length)} />}
          </article>
        );
      })}</div>}
    </div>
  );
}

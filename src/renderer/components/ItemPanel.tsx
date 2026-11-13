import { useEffect, useState, type KeyboardEvent } from 'react';
import { controlCodes } from '../../core/text/controlCodes';
import type { Issue } from '../../shared/api';
import { jobActive, useApp } from '../state';
import { CodeText } from './CodeText';
import { GamePreview } from './GamePreview';

const RULE_LABEL: Record<Issue['rule'], string> = {
  'control-codes': '제어 코드',
  'leftover-japanese': '남은 일본어',
  'line-count': '줄 수',
  empty: '빈 번역',
  glossary: '용어집',
  'line-width': '줄 폭',
  'line-width-px': '창 폭',
};

export function ItemPanel() {
  const app = useApp();
  const { selectedId, rowsById, detail, glossary } = app;
  const row = selectedId ? rowsById[selectedId] : undefined;
  const [draft, setDraft] = useState('');
  /** The saved value the draft started from; a different saved value arriving while editing is a conflict. */
  const [base, setBase] = useState('');
  const [conflict, setConflict] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(row?.target ?? '');
    setBase(row?.target ?? '');
    setConflict(null);
    setError(null);
  }, [row?.id]);
  useEffect(() => {
    const saved = row?.target ?? '';
    if (saved === base) return;
    if (draft === base || draft === saved) {
      // Not editing (or the change is our own save): follow the saved value.
      setDraft(saved);
      setBase(saved);
      setConflict(null);
    } else setConflict(saved);
  }, [row?.target]);

  if (!row) return <div className="item-empty sub">줄을 고르면 여기에 자세한 내용이 나와요</div>;

  const run = async (job: () => Promise<unknown>) => {
    setSaving(true);
    setError(null);
    try {
      await job();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const save = () => run(() => useApp.saveTranslation(row.id, draft));
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      void save();
    }
  };

  const issues = detail && detail.row.id === row.id ? detail.issues : [];
  const hasError = row.status === 'error' || issues.some((i) => i.severity === 'error');
  const codeCount = controlCodes(row.source).length;
  const approveBlock = row.target === null ? '번역이 있어야 승인할 수 있어요' : hasError ? '오류를 고쳐야 승인할 수 있어요' : null;
  const approved = row.status === 'approved';
  const confirmed = glossary?.confirmedAt != null;
  const busy = jobActive(app);
  const showChange = () => {
    if (conflict === null) return;
    setDraft(conflict);
    setBase(conflict);
    setConflict(null);
  };

  return (
    <div className="item">
      <div className="item-where">
        <span className="mono sub small">{row.location}</span>
        {row.refCount >= 2 && <span className="tag">{`같은 문장 ${row.refCount}곳`}</span>}
        {row.speaker && <span className="small">{row.speaker}</span>}
      </div>
      <div className="field">
        <span className="label">원문</span>
        <div className="textbox src"><CodeText text={row.source} /></div>
      </div>
      {row.status === 'declined' && (
        <div className="field">
          <span className="label">거절 이유</span>
          <span className="err-text small">{row.declinedReason ?? '이유 없음'}</span>
        </div>
      )}
      {row.review && (
        <section className="review-box" aria-label="검수 의견">
          <span className="label">검수 의견</span>
          <span className="small">{row.review.problem}</span>
          <div className="textbox src"><CodeText text={row.review.suggestion} /></div>
          <div className="row-gap">
            <button type="button" className="btn primary small-btn" disabled={saving} onClick={() => void run(() => useApp.acceptReview(row.id))}>고친 안 받기</button>
            <button type="button" className="btn ghost small-btn" disabled={saving} onClick={() => void run(() => useApp.rejectReview(row.id))}>그대로 두기</button>
          </div>
        </section>
      )}
      {conflict !== null && (
        <div className="conflict small" role="status">
          <span className="warn-text">다른 곳에서 이 줄이 바뀌었어요</span>
          <button type="button" className="btn ghost small-btn" onClick={showChange}>바뀐 내용 보기</button>
        </div>
      )}
      <div className="field">
        <label htmlFor="item-target" className="label">번역</label>
        <textarea id="item-target" className="textbox edit" rows={4} value={draft} disabled={saving}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} />
        <div className="row-between">
          <span className="hint">Ctrl+Enter 로 저장</span>
          <button type="button" className="btn small-btn" disabled={saving || draft === (row.target ?? '')} onClick={() => void save()}>저장</button>
        </div>
      </div>
      <div className="field">
        <span className="label">검사</span>
        {row.target === null && <span className="sub small">번역이 아직 없어요</span>}
        {row.target !== null && issues.length === 0 && (
          <div className="row-between small"><span className="accent-text">통과 · 제어 코드 일치</span><span className="mono sub">{`${codeCount} / ${codeCount}`}</span></div>
        )}
        {issues.map((i, n) => (
          <div key={n} className="issue small">
            <span className={i.severity === 'error' ? 'err-text' : 'warn-text'}>{`${i.severity === 'error' ? '오류' : '주의'} · ${RULE_LABEL[i.rule]}`}</span>
            <span className="sub">{i.message}</span>
          </div>
        ))}
      </div>
      {row.kind === 'dialogue' && <GamePreview unitId={row.id} text={draft} />}
      {error && <span className="err-text small" role="alert">{error}</span>}
      <div className="grow" />
      {approveBlock && <span className="sub small">{approveBlock}</span>}
      <div className="item-actions">
        <button type="button" className="btn ghost" onClick={() => useApp.talkAbout(row.id)}>채팅으로 말하기</button>
        {!row.needsDecision && (
          <button type="button" className="btn ghost" disabled={saving || busy || !confirmed}
            title={!confirmed ? '용어집을 먼저 확정하세요' : busy ? '다른 작업이 진행 중이에요' : undefined}
            onClick={() => void run(() => useApp.translate([row.id]))}>다시 번역</button>
        )}
        <button type="button" className="btn ghost" disabled={saving || row.target === null}
          onClick={() => void run(() => useApp.clearTranslation(row.id))}>지우기</button>
        {approved
          ? <button type="button" className="btn" disabled={saving} onClick={() => void run(() => useApp.setStatus(row.id, 'needs-review'))}>승인 취소</button>
          : <button type="button" className="btn primary" disabled={saving || approveBlock !== null}
              onClick={() => void run(() => useApp.setStatus(row.id, 'approved'))}>승인</button>}
      </div>
    </div>
  );
}

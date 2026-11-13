import { useEffect, useState, type KeyboardEvent } from 'react';
import { controlCodes } from '../../core/text/controlCodes';
import type { Issue } from '../../shared/api';
import { useApp } from '../state';
import { CodeText } from './CodeText';

const RULE_LABEL: Record<Issue['rule'], string> = {
  'control-codes': '제어 코드',
  'leftover-japanese': '남은 일본어',
  'line-count': '줄 수',
  empty: '빈 번역',
};

export function ItemPanel() {
  const { selectedId, rowsById, detail } = useApp();
  const row = selectedId ? rowsById[selectedId] : undefined;
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(row?.target ?? '');
    setError(null);
  }, [row?.id, row?.target]);

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
      {error && <span className="err-text small" role="alert">{error}</span>}
      <div className="grow" />
      {approveBlock && <span className="sub small">{approveBlock}</span>}
      <div className="item-actions">
        <button type="button" className="btn ghost" onClick={() => useApp.talkAbout(row.id)}>채팅으로 말하기</button>
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

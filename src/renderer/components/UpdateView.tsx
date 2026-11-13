import { useEffect, useState, type ReactNode } from 'react';
import { num } from '../format';
import { eventActions, jobActive, updateActions, useApp } from '../state';

export const ASK_CLAUDE_TEXT = '업데이트 뒤 충돌난 수정을 고쳐줘';

function Card({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="card update-card" aria-label={label}>
      {children}
    </section>
  );
}

/** What the last game update changed, with ways to look at each part and to undo it. */
export function UpdateView() {
  const app = useApp();
  const s = app.updateSummary;
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (s === undefined) void updateActions.loadSummary(); }, [s]);

  if (!s) {
    return (
      <div className="update-view">
        <h1 className="page-title">업데이트 결과</h1>
        <span className="sub">{s === null ? '가져온 업데이트가 없어요.' : '읽는 중…'}</span>
      </div>
    );
  }

  const unchanged = s.patches.filter((p) => p.result === 'unchanged').length;
  const moved = s.patches.filter((p) => p.result === 'moved').length;
  const conflicts = s.patches.filter((p) => p.result === 'conflict');
  const confirmed = app.glossary?.confirmedAt != null;
  const run = async (job: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await job();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="update-view">
      <h1 className="page-title">{`${s.fromLabel} → ${s.toLabel}`}</h1>
      <div className="update-cards">
        <Card label="그대로인 문장">
          <span>{`그대로인 문장 ${num(s.kept)}개 · 번역 ${num(s.keptTranslated)}개를 이어받았어요`}</span>
        </Card>
        <Card label="새 문장">
          <span>{`새 문장 ${num(s.added)}개`}</span>
          <button type="button" className="btn ghost small-btn" aria-label="새 문장 보기" onClick={() => updateActions.showStatus('untranslated')}>보기</button>
        </Card>
        <Card label="바뀐 문장">
          <span>{`바뀐 문장 ${num(s.changed)}개 · 이전 번역을 참고로 붙였어요`}</span>
          {s.carried > 0 && <span className="sub small">{`그중 ${num(s.carried)}개는 문장부호만 달라서 이전 번역을 미리 넣었어요(검토 필요)`}</span>}
          <button type="button" className="btn ghost small-btn" aria-label="바뀐 문장 보기" onClick={() => updateActions.showStatus('changed')}>보기</button>
        </Card>
        <Card label="사라진 문장">
          <span>{`사라진 문장 ${num(s.removed)}개 · 번역 ${num(s.removedTranslated)}개는 보관했어요`}</span>
        </Card>
        <Card label="수정">
          <span>{`수정: 그대로 ${num(unchanged)} · 자리를 옮김 ${num(moved)} · 충돌 ${num(conflicts.length)}`}</span>
          {conflicts.length > 0 && (
            <>
              <ul className="update-list">
                {conflicts.map((c) => (
                  <li key={c.id}><span>{c.title}</span><span className="warn-text small">{c.reason ?? ''}</span></li>
                ))}
              </ul>
              <button type="button" className="btn soft small-btn" onClick={() => eventActions.askClaude(ASK_CLAUDE_TEXT, null)}>Claude에게 맡기기</button>
            </>
          )}
        </Card>
        <Card label="그림">
          <span>{`원본이 바뀐 그림 ${num(s.images.changed.length)}장`}</span>
          {s.images.changed.length > 0 && (
            <button type="button" className="btn ghost small-btn" aria-label="바뀐 그림 보기" onClick={() => updateActions.showImageProblems()}>보기</button>
          )}
          <span className="sub small">{`새 그림 ${num(s.images.added)}장`}</span>
        </Card>
        <Card label="판단 필요">
          <span>{`판단 필요: 새 묶음 ${num(s.decisions.newGroups)}개`}</span>
          {s.decisions.newGroups > 0 && (
            <button type="button" className="btn ghost small-btn" aria-label="새 묶음 보기" onClick={() => useApp.openDecisions()}>보기</button>
          )}
        </Card>
      </div>
      {s.warnings.length > 0 && (
        <section className="card update-card" aria-label="경고">
          <span className="warn-text">경고</span>
          <ul className="update-list">
            {s.warnings.map((w, i) => <li key={i}><span className="mono small">{w.file}</span><span className="small">{w.message}</span></li>)}
          </ul>
        </section>
      )}
      <div className="row-gap">
        <button type="button" className="btn primary" disabled={!confirmed || jobActive(app) || busy}
          title={!confirmed ? '용어집을 먼저 확정하세요' : undefined}
          onClick={() => void run(() => useApp.translate(undefined))}>새·바뀐 문장 번역 맡기기</button>
        {!confirmed && <span className="warn-text small">용어집을 먼저 확정하세요</span>}
        <div className="grow" />
        <button type="button" className="btn" disabled={busy} onClick={() => setConfirming(true)}>이 업데이트 되돌리기</button>
      </div>
      {error && <span className="err-text small" role="alert">{error}</span>}
      {confirming && (
        <div className="dialog-backdrop" onClick={() => setConfirming(false)}>
          <div className="dialog card" role="alertdialog" aria-modal="true" aria-labelledby="rollback-title" onClick={(e) => e.stopPropagation()}>
            <span id="rollback-title" className="card-title">이 업데이트를 되돌릴까요?</span>
            <span className="small">이 업데이트 뒤에 한 번역과 수정도 함께 사라져요</span>
            <div className="row-gap end">
              <button type="button" className="btn ghost" onClick={() => setConfirming(false)}>취소</button>
              <button type="button" className="btn primary" disabled={busy}
                onClick={() => { setConfirming(false); void run(() => updateActions.rollback()); }}>되돌리기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

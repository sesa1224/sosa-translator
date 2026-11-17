import { ArrowRightIcon, ChevronDownIcon, CircleHelpIcon, DiffIcon, ImageIcon, SparklesIcon, TriangleAlertIcon, Undo2Icon, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { num } from '../format';
import { ICON } from '../icons';
import { eventActions, jobActive, updateActions, useApp } from '../state';
import { Inkdrop } from './Inkdrop';
import { EmptyState, ScreenHead, Stat, Tile } from './ui';

export const ASK_CLAUDE_TEXT = '업데이트 뒤 충돌난 수정을 고쳐줘';

/** One part of the update that needs a look: what it is on the left, the thing to do about it on the right. */
function Row({ label, icon, tone, action, children }: { label: string; icon: LucideIcon; tone?: 'warn'; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="update-row" aria-label={label}>
      <Tile icon={icon} tone={tone} />
      <div className="update-body">{children}</div>
      {action && <div className="update-act">{action}</div>}
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
        <ScreenHead title="업데이트 결과" />
        {s === null
          ? <EmptyState art={<Inkdrop size={56} />} title="아직 업데이트가 없어요">가져온 업데이트가 없어요.</EmptyState>
          : <span className="sub">읽는 중…</span>}
      </div>
    );
  }

  const unchanged = s.patches.filter((p) => p.result === 'unchanged').length;
  const moved = s.patches.filter((p) => p.result === 'moved').length;
  const conflicts = s.patches.filter((p) => p.result === 'conflict');
  const confirmed = app.glossary?.confirmedAt != null;
  const todo = s.added + s.changed;
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
      <ScreenHead title={`${s.fromLabel} → ${s.toLabel}`} desc="게임 새 버전을 가져오며 바뀐 점이에요. 그대로인 문장의 번역은 이어받았어요." />
      {/* The numbers own the summary; what is below holds only what they cannot say (lists, notes, actions). */}
      <div className="stats" role="group" aria-label="업데이트 요약">
        <Stat label="이어받은 번역" value={s.keptTranslated} tone="ok" note={`그대로인 문장 ${num(s.kept)}개 중`} />
        <Stat label="바뀐 문장" value={s.changed} tone="warn"
          action={<button type="button" className="btn ghost small-btn" aria-label="바뀐 문장 보기" onClick={() => updateActions.showStatus('changed')}>보기</button>} />
        <Stat label="새 문장" value={s.added} tone="info"
          action={<button type="button" className="btn ghost small-btn" aria-label="새 문장 보기" onClick={() => updateActions.showStatus('untranslated')}>보기</button>} />
        <Stat label="사라진 문장" value={s.removed} note={`번역 ${num(s.removedTranslated)}개는 보관했어요`} />
        {conflicts.length > 0 && <Stat label="충돌난 수정" value={conflicts.length} tone="err" />}
      </div>
      <section className="next" aria-label="다음 할 일">
        <div className="next-text">
          <b>다음 할 일</b>
          <span className="sub">{todo > 0
            ? `새 문장과 바뀐 문장 ${num(todo)}개를 번역하세요. 바뀐 문장에는 이전 번역이 참고로 붙어 있어요.`
            : '번역할 새 문장이 없어요. 패치를 빌드하면 새 버전에 맞춘 패치가 나와요.'}</span>
          {s.carried > 0 && <span className="sub small">{`그중 ${num(s.carried)}개는 문장부호만 달라서 이전 번역을 미리 넣었어요(검토 필요)`}</span>}
          {!confirmed && <span className="warn-text small">용어집을 먼저 확정하세요</span>}
        </div>
        {!confirmed && <button type="button" className="btn" onClick={() => useApp.setView('glossary')}>용어집으로<ArrowRightIcon {...ICON} /></button>}
        <button type="button" className="btn primary" disabled={!confirmed || jobActive(app) || busy}
          title={!confirmed ? '용어집을 먼저 확정하세요' : undefined}
          onClick={() => void run(() => useApp.translate(undefined))}><SparklesIcon {...ICON} />새·바뀐 문장 번역 맡기기</button>
      </section>
      {/* Only the parts that need a look get a row; an update with none of them shows none. */}
      {(conflicts.length > 0 || s.images.changed.length > 0 || s.decisions.newGroups > 0) && (
        <div className="card update-rows">
          {conflicts.length > 0 && (
            <Row label="수정" icon={DiffIcon} tone="warn"
              action={<button type="button" className="btn soft small-btn" onClick={() => eventActions.askClaude(ASK_CLAUDE_TEXT, null)}>Claude에게 맡기기</button>}>
              <ul className="update-list">
                {conflicts.map((c) => (
                  <li key={c.id}><span>{c.title}</span><span className="warn-text small">{c.reason ?? ''}</span></li>
                ))}
              </ul>
            </Row>
          )}
          {s.images.changed.length > 0 && (
            <Row label="그림" icon={ImageIcon}
              action={<button type="button" className="btn ghost small-btn" aria-label="바뀐 그림 보기" onClick={() => updateActions.showImageProblems()}>보기</button>}>
              <span>{`원본이 바뀐 그림 ${num(s.images.changed.length)}장`}</span>
            </Row>
          )}
          {s.decisions.newGroups > 0 && (
            <Row label="판단 필요" icon={CircleHelpIcon}
              action={<button type="button" className="btn ghost small-btn" aria-label="새 묶음 보기" onClick={() => useApp.openDecisions()}>보기</button>}>
              <span>{`판단 필요: 새 묶음 ${num(s.decisions.newGroups)}개`}</span>
            </Row>
          )}
        </div>
      )}
      {/* Folded like the older builds: read now and then, and a long list would push the undo out of sight. */}
      {s.warnings.length > 0 && (
        <section className="update-fold" aria-label="경고">
          <details>
            <summary className="small"><TriangleAlertIcon {...ICON} className="warn-text" />{`경고 ${num(s.warnings.length)}개`}<ChevronDownIcon {...ICON} className="update-chev" /></summary>
            <ul className="update-list">
              {s.warnings.map((w, i) => <li key={i}><span className="mono small">{w.file}</span><span className="small">{w.message}</span></li>)}
            </ul>
          </details>
        </section>
      )}
      <section className="update-fold" aria-label="그 밖의 수">
        <details>
          <summary className="small">그 밖의 수<ChevronDownIcon {...ICON} className="update-chev" /></summary>
          <ul className="update-list plain">
            <li><span className="small">{`수정: 그대로 ${num(unchanged)} · 자리를 옮김 ${num(moved)} · 충돌 ${num(conflicts.length)}`}</span></li>
            <li><span className="small">{`새 그림 ${num(s.images.added)}장`}</span></li>
          </ul>
        </details>
      </section>
      <div className="row-gap">
        <div className="grow" />
        <button type="button" className="btn ghost" disabled={busy} onClick={() => setConfirming(true)}><Undo2Icon {...ICON} />이 업데이트 되돌리기</button>
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

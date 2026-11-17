import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { controlCodes } from '../../core/text/controlCodes';
import { keyLabel } from '../../core/decisions/keys';
import { changedWords } from '../../core/update/carry';
import { REVIEW_KIND_LABEL, type Issue, type KeepRule, type PastReview, type Row, type SimilarTranslation } from '../../shared/api';
import { replay } from '../motion';
import { jobActive, useApp } from '../state';
import { hasGamePreview, ItemPreview } from './BigPreview';
import { CodeText } from './CodeText';
import { DiffPieces as Pieces } from './DiffPieces';

const RULE_LABEL: Record<Issue['rule'], string> = {
  'control-codes': '제어 코드',
  'leftover-japanese': '남은 일본어',
  'line-count': '줄 수',
  empty: '빈 번역',
  glossary: '용어집',
  'line-width': '줄 폭',
  'line-width-px': '창 폭',
  'window-lines': '창 줄 수',
  skeleton: '그대로 둘 부분',
  notation: '표기',
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
  const targetRef = useRef<HTMLTextAreaElement>(null);
  const checksRef = useRef<HTMLDivElement>(null);
  const issues = row && detail && detail.row.id === row.id ? detail.issues : [];
  const hasError = !!row && (row.status === 'error' || issues.some((i) => i.severity === 'error'));
  /** The line and whether it had an error, as last drawn: an error appearing on the same line shakes the checks. */
  const seen = useRef<{ id: string | undefined; hasError: boolean }>({ id: undefined, hasError: false });

  useEffect(() => {
    setDraft(row?.target ?? '');
    setBase(row?.target ?? '');
    setConflict(null);
    setError(null);
    // A flash or shake still on from the line before must not carry over to this one.
    targetRef.current?.classList.remove('flash');
    checksRef.current?.classList.remove('shake');
  }, [row?.id]);
  useEffect(() => {
    const before = seen.current;
    seen.current = { id: row?.id, hasError };
    if (before.id === row?.id && !before.hasError && hasError) replay(checksRef.current, 'shake');
  }, [row?.id, hasError]);
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
  /** Fills the draft from elsewhere (an earlier translation, a similar one); the input flashes so the change is seen. */
  const take = (text: string) => {
    setDraft(text);
    replay(targetRef.current, 'flash');
    replay(document.getElementById('stage-target'), 'flash');
  };
  const approve = () => run(async () => {
    try {
      await useApp.approve(row.id);
    } catch (e) {
      replay(checksRef.current, 'shake');
      throw e;
    }
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      void save();
    }
  };

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
      {row.previous && <PreviousBox row={row} onTake={take} disabled={saving} />}
      {row.needsDecision && <DecisionBox row={row} />}
      {row.external && <span className="tag">외부에서 가져온 번역</span>}
      {row.status === 'declined' && (
        <div className="field">
          <span className="label">거절 이유</span>
          <span className="err-text small">{row.declinedReason ?? '이유 없음'}</span>
        </div>
      )}
      {row.review && (
        <section className="review-box" aria-label="검수 의견">
          <span className="label">검수 의견{row.review.kind && <>{' '}<span className="tag small">{REVIEW_KIND_LABEL[row.review.kind]}</span></>}</span>
          <span className="small">{row.review.problem}</span>
          <div className="textbox src"><CodeText text={row.review.suggestion} /></div>
          <div className="row-gap">
            <button type="button" className="btn primary small-btn" disabled={saving} onClick={() => void run(() => useApp.acceptReview(row.id))}>고친 안 받기</button>
            <button type="button" className="btn ghost small-btn" disabled={saving} onClick={() => void run(() => useApp.rejectReview(row.id))}>그대로 두기</button>
          </div>
        </section>
      )}
      {!row.review && row.pastReview && <PastReviewBox row={row} past={row.pastReview} disabled={saving} onSwitch={() => void run(() => useApp.switchPastReview(row.id))} />}
      {conflict !== null && (
        <div className="conflict small" role="status">
          <span className="warn-text">다른 곳에서 이 줄이 바뀌었어요</span>
          <button type="button" className="btn ghost small-btn" onClick={showChange}>바뀐 내용 보기</button>
        </div>
      )}
      <div className="field">
        <label htmlFor="item-target" className="label">번역</label>
        <textarea id="item-target" ref={targetRef} className="textbox edit" rows={4} value={draft} disabled={saving}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} />
        <div className="row-between">
          <span className="hint">Ctrl+Enter 로 저장</span>
          <button type="button" className="btn small-btn" disabled={saving || draft === (row.target ?? '')} onClick={() => void save()}>저장</button>
        </div>
      </div>
      <SimilarBox row={row} onTake={take} disabled={saving} />
      <div className="field" role="group" aria-label="검사" ref={checksRef}>
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
      {hasGamePreview(row) && <ItemPreview row={row} draft={draft} onDraft={setDraft} onKey={onKey} saving={saving} />}
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
          ? <button type="button" className="btn" disabled={saving} onClick={() => void run(() => useApp.setStatus(row.id, 'translated'))}>승인 취소</button>
          : <button type="button" className="btn primary" disabled={saving || approveBlock !== null}
              onClick={() => void approve()}>승인</button>}
      </div>
    </div>
  );
}

const DECISION_LABEL: Record<NonNullable<Row['decision']>, string> = {
  none: '정하지 않음', translate: '번역함', skip: '번역 안 함', 'suggested-translate': '추천: 번역함', 'suggested-skip': '추천: 번역 안 함',
};

/** Keep rule for deciding one line on its own: its group's when that translates, else by kind of key. */
function lineKeep(key: string | undefined, groupKeep: KeepRule | undefined): KeepRule {
  if (groupKeep) return groupKeep;
  if (key?.startsWith('mv:')) return { mode: 'args', from: 1, dropLast: 0 };
  if (key?.startsWith('shape:')) return { mode: 'spans' };
  return { mode: 'whole' };
}

/** A needs-decision line's group, its decision, and deciding just this line. */
function DecisionBox({ row }: { row: Row }) {
  const { decisionGroups } = useApp();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = row.decisionKey;
  const group = key ? decisionGroups.find((g) => g.key === key) : undefined;
  const set = async (translate: boolean) => {
    setError(null);
    try {
      const keep: KeepRule = translate ? lineKeep(key, group?.decision?.translate ? group.decision.keep : undefined) : { mode: 'whole' };
      await useApp.setDecision(`unit:${row.id}`, { translate, keep });
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <section className="field decision-box" aria-label="판단 필요">
      <span className="label">판단 필요</span>
      <div className="row-gap small">
        {key && <span className="mono">{keyLabel(key)}</span>}
        <span className="sub">{DECISION_LABEL[row.decision ?? 'none']}</span>
      </div>
      <div className="row-gap">
        <button type="button" className="btn ghost small-btn" aria-expanded={open} onClick={() => setOpen(!open)}>이 줄만 따로 정하기</button>
        {key && <button type="button" className="btn ghost small-btn" onClick={() => useApp.openDecisions(key)}>묶음 보기</button>}
      </div>
      {open && (
        <div className="row-gap">
          <button type="button" className="btn soft small-btn" onClick={() => void set(true)}>이 줄 번역함</button>
          <button type="button" className="btn small-btn" onClick={() => void set(false)}>이 줄 번역 안 함</button>
        </div>
      )}
      {error && <span className="err-text small" role="alert">{error}</span>}
    </section>
  );
}

// ---- earlier translations of similar sentences ----

/**
 * Translated sentences that read like this one, asked for each time a line is picked. Taking one only fills the
 * draft: the user still reads it against this line's source and saves it themselves.
 */
function SimilarBox({ row, onTake, disabled }: { row: Row; onTake: (target: string) => void; disabled: boolean }) {
  const [hits, setHits] = useState<SimilarTranslation[]>([]);
  useEffect(() => {
    let live = true;
    setHits([]);
    window.api.similar.find(row.id).then((h) => { if (live) setHits(h); }, () => undefined);
    // A late answer for a line picked earlier must not show under the new one.
    return () => { live = false; };
  }, [row.id]);
  if (hits.length === 0) return null;
  return (
    <section className="field" aria-label="비슷한 번역">
      <span className="label">비슷한 번역 <span className="mute">전에 번역한 비슷한 문장</span></span>
      {hits.map((h) => (
        <div key={h.id} className="tm">
          <div className="tm-top">
            <span className="pct">{`${h.score}%`}</span>
            <span className="mono sub small">{h.location}</span>
            <span className="grow" />
            <button type="button" className="btn ghost small-btn" disabled={disabled} onClick={() => onTake(h.target)}>가져오기</button>
          </div>
          <span className="sub small pre" aria-label="비슷한 원문"><Pieces pieces={changedWords(row.source, h.source).new} kind="new" /></span>
          <span className="small pre">{h.target}</span>
        </div>
      ))}
    </section>
  );
}

// ---- the sentence in the older version ----

/** A changed sentence: the older source next to the current one (changes marked) and the older translation to start from. */
function PreviousBox({ row, onTake, disabled }: { row: Row; onTake: (target: string) => void; disabled: boolean }) {
  const prev = row.previous!;
  const words = changedWords(prev.source, row.source);
  return (
    <section className="prev-box" aria-label="이전 버전의 문장">
      <span className="label">이전 버전의 문장</span>
      <div className="textbox src pre" aria-label="이전 원문"><Pieces pieces={words.old} kind="old" /></div>
      <div className="textbox src pre" aria-label="지금 원문"><Pieces pieces={words.new} kind="new" /></div>
      <span className="label">이전 번역</span>
      <div className="textbox src pre" aria-label="이전 번역">{prev.target ?? '(번역 없음)'}</div>
      {row.carried && <span className="warn-text small">문장부호만 달라서 이전 번역을 넣어 뒀어요. 확인하고 승인하세요.</span>}
      <div className="row-gap">
        <button type="button" className="btn ghost small-btn" disabled={disabled || prev.target === null} onClick={() => onTake(prev.target ?? '')}>이전 번역 가져오기</button>
      </div>
    </section>
  );
}

/**
 * The last remark the user took or passed over, with the two translations it chose between and a way to
 * turn the choice around (a wrong click, or a line that reads worse in the game than it did here).
 */
function PastReviewBox({ row, past, disabled, onSwitch }: { row: Row; past: PastReview; disabled: boolean; onSwitch: () => void }) {
  const took = past.taken === 'suggestion';
  // Edited by hand since: switching replaces that edit, so it is said before the click.
  const edited = row.target !== (took ? past.suggestion : past.before);
  return (
    <section className="past-review" aria-label="지난 검수 의견">
      <span className="label">
        {`지난 검수 의견 · ${took ? '고친 안 받음' : '그대로 둠'}${past.at ? ` · ${past.at.slice(0, 10)}` : ''}`}
        {past.kind && <>{' '}<span className="tag small">{REVIEW_KIND_LABEL[past.kind]}</span></>}
      </span>
      <span className="small">{past.problem}</span>
      <span className="label">고치기 전</span>
      <div className="textbox src"><CodeText text={past.before} /></div>
      <span className="label">고친 안</span>
      <div className="textbox src"><CodeText text={past.suggestion} /></div>
      {edited && <span className="warn-text small">그 뒤에 직접 고친 번역이에요. 바꾸면 지금 번역은 사라져요.</span>}
      <div className="row-gap">
        <button type="button" className="btn ghost small-btn" disabled={disabled} onClick={onSwitch}>{took ? '고치기 전으로 되돌리기' : '고친 안으로 바꾸기'}</button>
      </div>
    </section>
  );
}

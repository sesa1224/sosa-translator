import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { NO_REVIEW_KIND_LABEL, REVIEW_KIND_LABEL, REVIEW_KINDS, type ReviewKind, type Row, type StatusFilter } from '../../shared/api';
import { filterRows, scrollMarks } from '../../shared/rows';
import { num, STATUS_LABEL } from '../format';
import { motionClock, rowMotionStyle, type RowMotion } from '../motion';
import { jobActive, orderedRows, shownRows, useApp } from '../state';
import { StageSlot, useRevealRow } from './BigPreview';
import { CodeText } from './CodeText';
import { ReviewDialog } from './ReviewDialog';
import { StoryView } from './StoryView';
import { ExchangeActions } from './ExchangeDialog';
import { confirmAndRewrap } from './TextWindowSettings';

/** What the translation cell shows for a needs-decision row whose decision says more than the target (null = the usual). */
function decisionCell(r: Row): string | null {
  if (r.decision === 'skip') return '번역 안 함';
  if (r.target !== null) return null;
  if (r.decision === 'suggested-translate') return '추천: 번역함';
  if (r.decision === 'suggested-skip') return '추천: 번역 안 함';
  if (r.decision === 'translate') return '번역 전';
  return null;
}

const SEARCH_DELAY = 200;

function statusChip(r: Row): { label: string; cls: string } {
  if (r.status === 'untranslated' && r.needsDecision) return { label: '판단 필요', cls: 'st-warn' };
  const cls = { untranslated: 'st-none', translated: 'st-done', 'needs-review': 'st-warn', approved: 'st-ok', error: 'st-err', declined: 'st-err' }[r.status];
  return { label: STATUS_LABEL[r.status], cls };
}

/** "Translate new lines" and "review everything" buttons above the table. */
function JobActions() {
  const app = useApp();
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fresh = useMemo(() => app.rowOrder.filter((id) => {
    const r = app.rowsById[id];
    return r.status === 'untranslated' && !r.needsDecision;
  }).length, [app.rowOrder, app.rowsById]);
  const confirmed = app.glossary?.confirmedAt != null;
  const busy = jobActive(app);
  const translate = async () => {
    setError(null);
    try {
      await useApp.translate(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="job-actions">
      <button type="button" className="btn primary" disabled={!confirmed || busy || fresh === 0} onClick={() => void translate()}>
        {`새 문장 ${num(fresh)}개 번역 맡기기`}
      </button>
      {!confirmed && <>
        <span className="warn-text small">용어집을 먼저 확정하세요</span>
        <button type="button" className="btn ghost small-btn" onClick={() => useApp.setView('glossary')}>용어집으로</button>
      </>}
      <button type="button" className="btn" disabled={busy} onClick={() => setReviewing(true)}>번역 전체 검수</button>
      {error && <span className="err-text small" role="alert">{error}</span>}
      {reviewing && <ReviewDialog onClose={() => setReviewing(false)} />}
    </div>
  );
}

/**
 * Takes or passes over every open remark among the rows the table now shows. With the search (which also reads
 * what the remark said) this handles one kind of remark in one go instead of a click per line.
 */
function ReviewBulkActions({ ids }: { ids: string[] }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (ids.length === 0 && note === null && error === null) return null;
  const run = async (question: string, f: () => Promise<number>, done: (n: number) => string) => {
    if (!window.confirm(question)) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      setNote(done(await f()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const n = num(ids.length);
  return (
    <span className="exchange-actions" role="group" aria-label="보이는 검수 의견">
      {ids.length > 0 && <>
        <span className="small sub">{`보이는 검수 의견 ${n}개`}</span>
        <button type="button" className="btn small-btn" disabled={busy}
          onClick={() => void run(`지금 보이는 검수 의견 ${n}개의 고친 안을 모두 받을까요? 번역이 고친 안으로 바뀌어요. 나중에 "검수로 바뀜"에서 하나씩 되돌릴 수 있어요.`,
            () => useApp.acceptReviews(ids), (k) => `고친 안 ${num(k)}개를 받았어요`)}>모두 고친 안 받기</button>
        <button type="button" className="btn small-btn" disabled={busy}
          onClick={() => void run(`지금 보이는 검수 의견 ${n}개를 모두 넘길까요? 번역은 그대로 두어요. 나중에 "검수 의견 넘김"에서 하나씩 고친 안으로 바꿀 수 있어요.`,
            () => useApp.rejectReviews(ids), (k) => `의견 ${num(k)}개를 넘겼어요`)}>모두 그대로 두기</button>
      </>}
      {note && <span className="mute small">{note}</span>}
      {error && <span className="err-text small" role="alert">{error}</span>}
    </span>
  );
}

/** "줄바꿈 다시 맞추기" for the lines the table shows under the "창 넘침" filter. */
function RewrapVisible({ ids }: { ids: string[] }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (ids.length === 0 && note === null && error === null) return null;
  const run = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const n = await confirmAndRewrap({ ids }, '보이는 줄 가운데');
      if (n !== null) setNote(n);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="exchange-actions" role="group" aria-label="보이는 줄 줄바꿈">
      {ids.length > 0 && <button type="button" className="btn small-btn" disabled={busy} onClick={() => void run()}>줄바꿈 다시 맞추기</button>}
      {note && <span className="mute small" role="status">{note}</span>}
      {error && <span className="err-text small" role="alert">{error}</span>}
    </span>
  );
}

function FilterBar() {
  const { snapshot, query } = useApp();
  const [text, setText] = useState(query.text ?? '');
  const { rowsById } = useApp();
  const skipped = useMemo(() => Object.values(rowsById).filter((r) => r.decision === 'skip').length, [rowsById]);
  useEffect(() => {
    const t = setTimeout(() => useApp.setQuery({ text: text || undefined }), SEARCH_DELAY);
    return () => clearTimeout(t);
  }, [text]);
  if (!snapshot) return null;
  const s = snapshot.stats;
  const chips: [StatusFilter, string, number][] = [
    ['all', '전체', s.total], ['untranslated', '미번역', s.untranslated], ['translated', '번역 완료', s.translated ?? 0],
    ['needs-review', '검토 필요', s.needsReview],
    ['approved', '승인됨', s.approved], ['error', '오류', s.error], ['needs-decision', '판단 필요', s.needsDecision],
  ];
  if (s.declined > 0) chips.push(['declined', '거절됨', s.declined]);
  if (s.provisional > 0) chips.push(['provisional', '추천안 용어 사용', s.provisional]);
  if ((s.external ?? 0) > 0) chips.push(['external', '외부 번역', s.external]);
  if (skipped > 0) chips.push(['skipped', '번역 안 함', skipped]);
  if ((s.changed ?? 0) > 0) chips.push(['changed', '바뀐 문장', s.changed]);
  if ((s.reviewTaken ?? 0) > 0) chips.push(['review-taken', '검수로 바뀜', s.reviewTaken ?? 0]);
  if ((s.reviewPassed ?? 0) > 0) chips.push(['review-passed', '검수 의견 넘김', s.reviewPassed ?? 0]);
  if ((s.notation ?? 0) > 0) chips.push(['notation', '표기 경고', s.notation ?? 0]);
  if ((s.overflow ?? 0) > 0 || query.status === 'overflow') chips.push(['overflow', '창 넘침', s.overflow ?? 0]);
  const current = query.status ?? 'all';
  return (
    <>
      <div className="filters">
        {chips.map(([key, label, n]) => (
          <button key={key} type="button" className={`pill${current === key ? ' on' : ''}`} aria-pressed={current === key}
            onClick={() => useApp.setQuery({ status: key })}>{`${label} ${num(n)}`}</button>
        ))}
        <label htmlFor="q" className="sr-only">문장 검색</label>
        <input id="q" className="input search" type="search" placeholder="月光草" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      {REVIEW_STATUSES.has(current) && <ReviewKindChips status={current} />}
    </>
  );
}

const REVIEW_STATUSES = new Set<StatusFilter>(['needs-review', 'review-taken', 'review-passed']);

/** Second chip row under a review status: the remark kinds among that status's rows, so one kind can be handled at once. */
function ReviewKindChips({ status }: { status: StatusFilter }) {
  const { rowsById, query } = useApp();
  const counts = useMemo(() => {
    const m = new Map<ReviewKind | 'none', number>();
    for (const r of filterRows(Object.values(rowsById), { status })) {
      const note = r.review ?? r.pastReview;
      if (!note) continue;
      const k = note.kind ?? 'none';
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [rowsById, status]);
  if (counts.size === 0) return null;
  const chips: [ReviewKind | 'none', string][] = [...REVIEW_KINDS.map((k): [ReviewKind, string] => [k, REVIEW_KIND_LABEL[k]]), ['none', NO_REVIEW_KIND_LABEL]];
  return (
    <div className="filters" role="group" aria-label="검수 의견 종류">
      {chips.filter(([k]) => counts.has(k)).map(([k, label]) => {
        const on = query.reviewKind === k;
        return (
          <button key={k} type="button" className={`pill${on ? ' on' : ''}`} aria-pressed={on}
            onClick={() => useApp.setQuery({ reviewKind: on ? undefined : k })}>{`${label} ${num(counts.get(k)!)}`}</button>
        );
      })}
    </div>
  );
}

export function TextTable() {
  const app = useApp();
  const { query, selectedId, snapshot, idFilter } = app;
  const all = useMemo(() => orderedRows(app), [app.rowOrder, app.rowsById]);
  const rows = useMemo(() => shownRows(all, query, idFilter), [all, query, idFilter]);
  const marks = useMemo(() => scrollMarks(rows), [rows]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 48,
    overscan: 8,
    getItemKey: (i) => rows[i].id,
  });

  const move = (delta: number) => {
    if (rows.length === 0) return;
    const i = selectedId ? rows.findIndex((r) => r.id === selectedId) : -1;
    const next = Math.min(rows.length - 1, Math.max(0, i < 0 ? 0 : i + delta));
    v.scrollToIndex(next, { align: 'auto' });
    void useApp.selectRow(rows[next].id);
  };
  useRevealRow((id) => {
    const i = rows.findIndex((r) => r.id === id);
    if (i >= 0) v.scrollToIndex(i, { align: 'auto' });
  }, [rows, v]);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
  };

  const scopeLabel = query.file ? snapshot?.scopes.find((s) => s.file === query.file)?.label : null;
  // Lines a translate job has sent and waits on.
  const job = app.job;
  const pending = useMemo(() => new Set(job?.state === 'running' && job.kind === 'translate' ? job.pending ?? [] : []), [job]);
  const pick = (id: string) => { void useApp.selectRow(id); scrollRef.current?.focus({ preventScroll: true }); };

  return (
    <div className="text-view">
      <StageSlot />
      <div className="text-head">
        <h1 className="page-title">텍스트</h1>
        <TextModeSwitch />
        {scopeLabel && (
          <button type="button" className="pill on" onClick={() => useApp.setQuery({ file: undefined })} aria-label="범위 필터 해제" title={`범위 ${scopeLabel} 해제`}>
            {scopeLabel} ×
          </button>
        )}
        {idFilter && (
          <button type="button" className="pill on" onClick={() => useApp.showRows(null)} aria-label="골라 본 줄 필터 해제">
            {`골라 본 줄 ${num(idFilter.length)}개 ×`}
          </button>
        )}
        {query.decisionKey && (
          <button type="button" className="pill on" onClick={() => useApp.setQuery({ decisionKey: undefined })} aria-label="판단 묶음 필터 해제">
            {`묶음 ${query.decisionKey} ×`}
          </button>
        )}
        <span className="mono sub small">{`${num(rows.length)}줄`}</span>
        <ExchangeActions ids={rows.map((r) => r.id)} />
        <ReviewBulkActions ids={rows.filter((r) => r.review).map((r) => r.id)} />
        {query.status === 'overflow' && <RewrapVisible ids={rows.map((r) => r.id)} />}
      </div>
      <JobActions />
      <FilterBar />
      {app.textMode === 'story' ? <StoryView /> : (
      <div className="table card" role="table" aria-label="텍스트 표" aria-rowcount={rows.length + 1}>
        <div className="tr th" role="row">
          <span role="columnheader">위치</span><span role="columnheader">화자</span><span role="columnheader">원문</span>
          <span role="columnheader">번역</span><span role="columnheader">상태</span>
        </div>
        <div className="tbody-wrap">
          <div className="tbody" ref={scrollRef} tabIndex={0} onKeyDown={onKey} role="rowgroup">
            {rows.length === 0 && <div className="empty sub">맞는 줄이 없어요</div>}
            <div style={{ height: v.getTotalSize(), position: 'relative' }}>
              {v.getVirtualItems().map((item) => (
                <TableRow key={item.key} r={rows[item.index]} index={item.index} start={item.start} measure={v.measureElement}
                  sel={rows[item.index].id === selectedId} busy={pending.has(rows[item.index].id)} motion={app.rowMotion[rows[item.index].id]} onPick={pick} />
              ))}
            </div>
          </div>
          {/* Over the scrollbar: where the errors and lines waiting for review are. Shows only, no clicking. */}
          <div className="scroll-marks" aria-hidden="true">
            {marks.map((m) => <i key={m.pos} className={m.kind} style={{ top: `${+(m.pos * 100).toFixed(3)}%` }} />)}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

/**
 * One table line. It never animates on scroll or selection: only a change marked in rowMotion (a translation that
 * came in, an approval, a new status) plays, once, measured from the moment of the change. The time it mounted is
 * kept so a line scrolled out and back in carries on (or stays still) instead of starting over.
 */
function TableRow({ r, index, start, measure, sel, busy, motion, onPick }: {
  r: Row; index: number; start: number; measure: (el: Element | null) => void; sel: boolean; busy: boolean; motion: RowMotion | undefined; onPick: (id: string) => void;
}) {
  const [mountedAt] = useState(() => motionClock.now());
  const chip = statusChip(r);
  const m = rowMotionStyle(motion, mountedAt, motionClock.now());
  const cls = `tr${sel ? ' sel' : ''}${busy ? ' busy' : ''}${m.flash ? ' rowflash' : ''}`;
  return (
    <div data-index={index} ref={measure} role="row" aria-rowindex={index + 2} aria-selected={sel} className={cls}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${start}px)`, animationDelay: m.flash ? m.delay : undefined }}
      onClick={() => onPick(r.id)}>
      <span role="cell" className="mono sub small">{r.location}</span>
      <span role="cell" className="small">{r.speaker ?? ''}</span>
      <span role="cell" className="src"><CodeText text={r.source} /></span>
      <span role="cell" className={r.target === null && !busy ? 'mute' : ''}>
        {busy ? <><span className="skel" aria-hidden="true" /><span className="sr-only">번역 중</span></>
          : decisionCell(r) !== null ? decisionCell(r) : <>
          {r.target === null ? (r.needsDecision ? '판단 대기' : '번역 전') : <CodeText text={r.target} />}
          </>}
      </span>
      <span role="cell"><span className={`st ${chip.cls}${m.pop ? ' pop' : ''}`} style={m.pop ? { animationDelay: m.delay } : undefined}>{chip.label}</span></span>
    </div>
  );
}

/** "표 | 스토리" switch above the text view. */
function TextModeSwitch() {
  const { textMode } = useApp();
  return (
    <div className="seg" role="group" aria-label="보기 방식">
      <button type="button" aria-pressed={textMode === 'table'} className={textMode === 'table' ? 'on' : ''} onClick={() => useApp.setTextMode('table')}>표</button>
      <button type="button" aria-pressed={textMode === 'story'} className={textMode === 'story' ? 'on' : ''} onClick={() => useApp.setTextMode('story')}>스토리</button>
    </div>
  );
}

import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Row, StatusFilter } from '../../shared/api';
import { filterRows } from '../../shared/rows';
import { num, STATUS_LABEL } from '../format';
import { orderedRows, useApp } from '../state';
import { CodeText } from './CodeText';

const SEARCH_DELAY = 200;

function statusChip(r: Row): { label: string; cls: string } {
  if (r.status === 'untranslated' && r.needsDecision) return { label: '판단 필요', cls: 'st-warn' };
  const cls = { untranslated: 'st-none', 'needs-review': 'st-warn', approved: 'st-ok', error: 'st-err' }[r.status];
  return { label: STATUS_LABEL[r.status], cls };
}

function FilterBar() {
  const { snapshot, query } = useApp();
  const [text, setText] = useState(query.text ?? '');
  useEffect(() => {
    const t = setTimeout(() => useApp.setQuery({ text: text || undefined }), SEARCH_DELAY);
    return () => clearTimeout(t);
  }, [text]);
  if (!snapshot) return null;
  const s = snapshot.stats;
  const chips: [StatusFilter, string, number][] = [
    ['all', '전체', s.total], ['untranslated', '미번역', s.untranslated], ['needs-review', '검토 필요', s.needsReview],
    ['approved', '승인됨', s.approved], ['error', '오류', s.error], ['needs-decision', '판단 필요', s.needsDecision],
  ];
  const current = query.status ?? 'all';
  return (
    <div className="filters">
      {chips.map(([key, label, n]) => (
        <button key={key} type="button" className={`pill${current === key ? ' on' : ''}`} aria-pressed={current === key}
          onClick={() => useApp.setQuery({ status: key })}>{`${label} ${num(n)}`}</button>
      ))}
      <label htmlFor="q" className="sr-only">문장 검색</label>
      <input id="q" className="input search" type="search" placeholder="月光草" value={text} onChange={(e) => setText(e.target.value)} />
    </div>
  );
}

export function TextTable() {
  const app = useApp();
  const { query, selectedId, snapshot } = app;
  const all = useMemo(() => orderedRows(app), [app.rowOrder, app.rowsById]);
  const rows = useMemo(() => filterRows(all, query), [all, query]);
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
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
  };

  const scopeLabel = query.file ? snapshot?.scopes.find((s) => s.file === query.file)?.label : null;

  return (
    <div className="text-view">
      <div className="text-head">
        <h1 className="page-title">텍스트</h1>
        {scopeLabel && (
          <button type="button" className="pill on" onClick={() => useApp.setQuery({ file: undefined })} aria-label="범위 필터 해제" title={`범위 ${scopeLabel} 해제`}>
            {scopeLabel} ×
          </button>
        )}
        <span className="mono sub small">{`${num(rows.length)}줄`}</span>
      </div>
      <FilterBar />
      <div className="table card" role="table" aria-label="텍스트 표" aria-rowcount={rows.length + 1}>
        <div className="tr th" role="row">
          <span role="columnheader">위치</span><span role="columnheader">화자</span><span role="columnheader">원문</span>
          <span role="columnheader">번역</span><span role="columnheader">상태</span>
        </div>
        <div className="tbody" ref={scrollRef} tabIndex={0} onKeyDown={onKey} role="rowgroup">
          {rows.length === 0 && <div className="empty sub">맞는 줄이 없어요</div>}
          <div style={{ height: v.getTotalSize(), position: 'relative' }}>
            {v.getVirtualItems().map((item) => {
              const r = rows[item.index];
              const chip = statusChip(r);
              const sel = r.id === selectedId;
              return (
                <div key={item.key} data-index={item.index} ref={v.measureElement} role="row" aria-rowindex={item.index + 2}
                  aria-selected={sel} className={`tr${sel ? ' sel' : ''}`}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${item.start}px)` }}
                  onClick={() => { void useApp.selectRow(r.id); scrollRef.current?.focus({ preventScroll: true }); }}>
                  <span role="cell" className="mono sub small">{r.location}</span>
                  <span role="cell" className="small">{r.speaker ?? ''}</span>
                  <span role="cell" className="src"><CodeText text={r.source} /></span>
                  <span role="cell" className={r.target === null ? 'mute' : ''}>
                    {r.target === null ? (r.needsDecision ? '판단 대기' : '번역 전') : <CodeText text={r.target} />}
                  </span>
                  <span role="cell"><span className={`st ${chip.cls}`}>{chip.label}</span></span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { translateRanges } from '../../core/decisions/keys';
import type { DecisionGroup, KeepRule, Row } from '../../shared/api';
import { num } from '../format';
import { jobActive, orderedRows, useApp } from '../state';
import { CodeText } from './CodeText';

type Filter = 'all' | 'open' | 'suggested' | 'translate' | 'skip';

const KIND_LABEL: Record<string, string> = {
  'plugin-command': '플러그인 커맨드', 'plugin-param': '플러그인 설정', script: '스크립트', comment: '주석', note: '메모란', 'plugin-js': '플러그인 JS',
};

function filterOf(g: DecisionGroup): Exclude<Filter, 'all'> {
  if (!g.decision) return 'open';
  if (g.decision.status === 'suggested') return 'suggested';
  return g.decision.translate ? 'translate' : 'skip';
}

/** The keep rule the picker starts from: the suggestion's, else by kind of key. */
function initialKeep(g: DecisionGroup): KeepRule {
  if (g.decision?.translate) return g.decision.keep;
  if (g.key.startsWith('mv:')) return { mode: 'args', from: 1, dropLast: 0 };
  if (g.key.startsWith('shape:')) return { mode: 'spans' };
  return { mode: 'whole' };
}

/** A sample with the part that would be translated highlighted and the kept parts dimmed. */
function Sample({ text, keep }: { text: string; keep: KeepRule | null }) {
  if (!keep) return <span data-testid="decision-sample" className="decision-sample"><CodeText text={text} /></span>;
  const ranges = translateRanges(text, keep);
  if (!ranges) {
    return (
      <span data-testid="decision-sample" className="decision-sample">
        <span className="keep-part"><CodeText text={text} /></span>
        <span className="mute small"> 이 줄은 번역할 부분이 없어 그대로 둬요</span>
      </span>
    );
  }
  const parts: { text: string; tr: boolean }[] = [];
  let pos = 0;
  for (const r of ranges) {
    if (r.start > pos) parts.push({ text: text.slice(pos, r.start), tr: false });
    parts.push({ text: text.slice(r.start, r.end), tr: true });
    pos = r.end;
  }
  if (pos < text.length) parts.push({ text: text.slice(pos), tr: false });
  return (
    <span data-testid="decision-sample" className="decision-sample">
      {parts.map((p, i) => (p.tr
        ? <span key={i} data-testid="translate-part" className="translate-part"><CodeText text={p.text} /></span>
        : <span key={i} className="keep-part"><CodeText text={p.text} /></span>))}
    </span>
  );
}

function Picker({ group, onCancel }: { group: DecisionGroup; onCancel: () => void }) {
  const start = initialKeep(group);
  const [mode, setMode] = useState<KeepRule['mode']>(start.mode);
  const [front, setFront] = useState(String(start.mode === 'args' ? start.from : 1));
  const [back, setBack] = useState(String(start.mode === 'args' ? start.dropLast : 0));
  const [error, setError] = useState<string | null>(null);
  const isMv = group.key.startsWith('mv:');
  const count = (s: string) => Math.max(0, Number.parseInt(s, 10) || 0);
  const keep: KeepRule = mode === 'args' ? { mode, from: count(front), dropLast: count(back) } : { mode };
  const save = async () => {
    setError(null);
    try {
      await useApp.setDecision(group.key, { translate: true, keep });
      onCancel();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const radio = (m: KeepRule['mode'], label: string) => (
    <label className="radio-line">
      <input type="radio" name={`keep-${group.key}`} checked={mode === m} onChange={() => setMode(m)} /> {label}
    </label>
  );
  return (
    <div className="decision-picker">
      <div className="decision-modes" role="radiogroup" aria-label="번역할 부분">
        {radio('whole', '전체')}
        {radio('spans', '일본어 부분만')}
        {isMv && radio('args', '앞뒤 조각은 그대로')}
      </div>
      {mode === 'args' && (
        <div className="decision-args">
          <label>앞에서 <input className="input num-input" type="number" min={0} aria-label="앞에서 그대로 둘 조각 수" value={front} onChange={(e) => setFront(e.target.value)} /> 조각</label>
          <label>뒤에서 <input className="input num-input" type="number" min={0} aria-label="뒤에서 그대로 둘 조각 수" value={back} onChange={(e) => setBack(e.target.value)} /> 조각은 그대로</label>
        </div>
      )}
      <div className="decision-samples">
        {group.samples.map((s, i) => <div key={i}><Sample text={s} keep={keep} /></div>)}
      </div>
      <div className="decision-actions">
        <button type="button" className="btn primary small-btn" onClick={() => void save()}>확인</button>
        <button type="button" className="btn ghost small-btn" onClick={onCancel}>취소</button>
        {error && <span className="err-text small" role="alert">{error}</span>}
      </div>
    </div>
  );
}

function JsStrings({ rows }: { rows: Row[] }) {
  const stateLabel = (r: Row) => ({ translate: '번역함', skip: '번역 안 함', 'suggested-translate': '추천: 번역함', 'suggested-skip': '추천: 번역 안 함', none: '정하지 않음' }[r.decision ?? 'none']);
  return (
    <ul className="js-strings">
      {rows.map((r) => (
        <li key={r.id} data-testid="js-string" className="js-string">
          <span className="mono"><CodeText text={r.source} /></span>
          <span className="mute small">{stateLabel(r)}</span>
          <span className="grow" />
          <button type="button" className="btn small-btn" onClick={() => void useApp.setDecision(`unit:${r.id}`, { translate: true, keep: { mode: 'whole' } })}>번역함</button>
          <button type="button" className="btn ghost small-btn" onClick={() => void useApp.setDecision(`unit:${r.id}`, { translate: false, keep: { mode: 'whole' } })}>번역 안 함</button>
        </li>
      ))}
    </ul>
  );
}

function GroupCard({ group, rows, focused }: { group: DecisionGroup; rows: Row[]; focused: boolean }) {
  const [picking, setPicking] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView?.({ block: 'center' });
  }, [focused]);
  const d = group.decision;
  const shownKeep = d?.translate ? d.keep : null;
  const isJs = group.key.startsWith('js:');
  const h = group.hints;
  const meta = [h.metaText, h.metaDesc].filter((x) => x !== undefined && x !== '').join(' · ');
  return (
    <section ref={ref} data-testid="decision-card" className={`card decision-card${focused ? ' focus' : ''}`} aria-label={group.label}>
      <div className="decision-head">
        <span className="mono decision-label">{group.label}</span>
        <span className="mute small">{KIND_LABEL[group.kind] ?? group.kind}</span>
        <span className="mute small">{`${num(group.count)}곳`}</span>
        {d?.status === 'confirmed' && <span className={`chip${d.translate ? '' : ' warn'}`}>{d.translate ? '번역함' : '번역 안 함'}</span>}
      </div>
      {!picking && (
        <div className="decision-samples">
          {group.samples.map((s, i) => <div key={i}><Sample text={s} keep={shownKeep} /></div>)}
        </div>
      )}
      {(meta || h.metaType) && <div className="hint">{`플러그인 설명: ${meta || h.metaType}`}</div>}
      {h.fileNames > 0 && <div className="hint">{`표본 ${group.samples.length}개 중 ${h.fileNames}개가 그림·소리 파일 이름과 같아요`}</div>}
      {d?.status === 'suggested' && (
        <div className="decision-suggest">
          <span>{`추천: ${d.translate ? '번역함' : '번역 안 함'}${d.reason ? ` — ${d.reason}` : ''}`}</span>
          <span className="mute small">{d.by === 'meta' ? ' (플러그인 주석)' : d.by === 'claude' ? ' (Claude)' : ''}</span>
        </div>
      )}
      {picking ? <Picker group={group} onCancel={() => setPicking(false)} /> : (
        <div className="decision-actions">
          <button type="button" className="btn soft small-btn" onClick={() => setPicking(true)}>번역함</button>
          <button type="button" className="btn small-btn" onClick={() => void useApp.setDecision(group.key, { translate: false, keep: { mode: 'whole' } })}>번역 안 함</button>
          <button type="button" className="btn ghost small-btn" onClick={() => useApp.showDecisionRows(group.key)}>이 묶음의 줄 보기</button>
          {isJs && <button type="button" className="btn ghost small-btn" aria-expanded={open} onClick={() => setOpen(!open)}>문자열 하나씩 보기</button>}
        </div>
      )}
      {isJs && open && <JsStrings rows={rows} />}
    </section>
  );
}

export function DecisionView() {
  const app = useApp();
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    useApp.loadDecisionGroups().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  const groups = app.decisionGroups;
  const rowsByKey = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of orderedRows(app)) {
      if (!r.needsDecision || !r.decisionKey || r.kind !== 'plugin-js') continue;
      m.set(r.decisionKey, [...(m.get(r.decisionKey) ?? []), r]);
    }
    return m;
  }, [app.rowOrder, app.rowsById]);
  const counts = { open: 0, suggested: 0, translate: 0, skip: 0 };
  for (const g of groups) counts[filterOf(g)]++;
  let jsSuggested = 0;
  for (const list of rowsByKey.values()) for (const r of list) if (r.decision === 'suggested-translate' || r.decision === 'suggested-skip') jsSuggested++;
  const suggestions = counts.suggested + jsSuggested;
  const shown = filter === 'all' ? groups : groups.filter((g) => filterOf(g) === filter);
  const busy = jobActive(app);
  const run = async (f: () => Promise<void>) => {
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const chips: [Filter, string, number][] = [
    ['open', '정할 것', counts.open], ['suggested', '추천 받음', counts.suggested], ['translate', '번역함', counts.translate], ['skip', '번역 안 함', counts.skip],
  ];
  return (
    <div className="decision-view">
      <div className="decision-top">
        <div>
          <h2>판단 필요</h2>
          <p className="mute">플러그인이 쓰는 값 중 화면에 보이는 글자만 골라 번역해요. 같은 종류는 한 번만 정하면 돼요.</p>
        </div>
        <div className="decision-top-actions">
          <button type="button" className="btn" disabled={busy || groups.length === 0} onClick={() => void run(() => useApp.decide())}>Claude에게 추천 받기</button>
          {suggestions > 0 && (
            <button type="button" className="btn primary" onClick={() => void run(() => useApp.confirmDecisions())}>{`추천 전부 받아들이기 (${num(suggestions)})`}</button>
          )}
        </div>
      </div>
      {error && <div className="err-text small" role="alert">{error}</div>}
      <div className="filters">
        {chips.map(([key, label, n]) => (
          <button key={key} type="button" className={`pill${filter === key ? ' on' : ''}`} aria-pressed={filter === key}
            onClick={() => setFilter(filter === key ? 'all' : key)}>{`${label} ${num(n)}`}</button>
        ))}
      </div>
      {groups.length === 0 && <p className="mute">판단할 항목이 없어요.</p>}
      <div className="decision-list">
        {shown.map((g) => <GroupCard key={g.key} group={g} rows={rowsByKey.get(g.key) ?? []} focused={app.decisionFocus === g.key} />)}
      </div>
    </div>
  );
}

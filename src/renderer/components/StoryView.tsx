import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Row, SceneInfo, SceneLine } from '../../shared/api';
import { filterRows } from '../../shared/rows';
import { num, STATUS_LABEL } from '../format';
import { jobActive, useApp } from '../state';
import { CodeText } from './CodeText';

const CHIP_STATUSES = new Set<Row['status']>(['needs-review', 'error', 'declined']);
const CHIP_CLASS: Partial<Record<Row['status'], string>> = { 'needs-review': 'st-warn', error: 'st-err', declined: 'st-err' };

/** A scene's lines with consecutive choices of the same 102 command put together. */
type Block = { type: 'line'; line: SceneLine } | { type: 'choices'; lines: SceneLine[] };
function blocks(lines: SceneLine[]): Block[] {
  const out: Block[] = [];
  for (const l of lines) {
    const last = out.at(-1);
    if (l.choiceGroup !== undefined && last?.type === 'choices' && last.lines[0].choiceGroup === l.choiceGroup) last.lines.push(l);
    else if (l.choiceGroup !== undefined) out.push({ type: 'choices', lines: [l] });
    else out.push({ type: 'line', line: l });
  }
  return out;
}

const unique = (ids: string[]) => [...new Set(ids)];

function SceneCard({ scene, rows, speakerName }: { scene: SceneInfo; rows: Record<string, Row>; speakerName(s: string): string }) {
  const app = useApp();
  const [error, setError] = useState<string | null>(null);
  const ids = unique(scene.lines.map((l) => l.id)).filter((id) => rows[id]);
  const done = ids.filter((id) => rows[id].target !== null).length;
  const approvable = ids.filter((id) => rows[id].target !== null && rows[id].status !== 'error' && rows[id].status !== 'approved');
  const retranslate = ids.filter((id) => !rows[id].needsDecision);
  const confirmed = app.glossary?.confirmedAt != null;
  const busy = jobActive(app);
  const run = async (job: () => Promise<unknown>) => {
    setError(null);
    try {
      await job();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const approveAll = () => run(async () => { for (const id of approvable) await useApp.setStatus(id, 'approved'); });

  const lineView = (l: SceneLine) => {
    const r = rows[l.id];
    if (!r) return null;
    const who = l.speaker ? speakerName(l.speaker) : null;
    const sel = app.selectedId === l.id;
    return (
      <div key={`${l.id}-${l.order}`} data-id={l.id} className={`story-line${sel ? ' sel' : ''}`} role="button" tabIndex={0}
        onClick={() => void useApp.selectRow(l.id)} onKeyDown={(e) => { if (e.key === 'Enter') void useApp.selectRow(l.id); }}>
        <div className="story-avatar" aria-hidden="true">{who ? [...who][0] : '지문'}</div>
        <div className="story-text">
          <div className="story-who"><span>{who ?? '지문'}</span></div>
          <span className="story-src small"><CodeText text={r.source} /></span>
          <span className={r.target === null ? 'mute' : ''}>{r.target === null ? '번역 전' : <CodeText text={r.target} />}</span>
        </div>
        {CHIP_STATUSES.has(r.status) && <span className={`st ${CHIP_CLASS[r.status]} story-chip`}>{STATUS_LABEL[r.status]}</span>}
      </div>
    );
  };

  return (
    <section className="story-scene card" aria-label={scene.label}>
      <div className="story-head">
        <div className="story-title">
          <span className="card-title">{scene.label}</span>
          {scene.condition && <span className="mono sub small">{`조건: ${scene.condition}`}</span>}
        </div>
        <span className="mono sub small">{`번역 ${num(done)} / ${num(ids.length)}`}</span>
      </div>
      <div className="story-body">
        {blocks(scene.lines).map((b, i) => (b.type === 'line' ? lineView(b.line) : (
          <div key={`c${i}`} className="story-choices" role="group" aria-label="선택지">
            {b.lines.map((l) => {
              const r = rows[l.id];
              if (!r) return null;
              return (
                <button key={l.id} type="button" data-id={l.id} className={`story-choice${app.selectedId === l.id ? ' sel' : ''}`}
                  onClick={() => void useApp.selectRow(l.id)}>
                  <span className={r.target === null ? 'mute' : ''}>{r.target === null ? '번역 전' : <CodeText text={r.target} />}</span>
                  <span className="sub small">{r.source}</span>
                </button>
              );
            })}
          </div>
        )))}
      </div>
      <div className="story-foot">
        {error && <span className="err-text small" role="alert">{error}</span>}
        <div className="grow" />
        <button type="button" className="btn ghost small-btn" disabled={retranslate.length === 0 || busy || !confirmed}
          title={!confirmed ? '용어집을 먼저 확정하세요' : busy ? '다른 작업이 진행 중이에요' : undefined}
          onClick={() => void run(() => useApp.translate(retranslate))}>이 장면 다시 번역</button>
        <button type="button" className="btn primary small-btn" disabled={approvable.length === 0} onClick={() => void approveAll()}>장면 승인</button>
      </div>
    </section>
  );
}

/** Story view: the scenes of the chosen file, read top to bottom. Status filter and search apply. */
export function StoryView() {
  const app = useApp();
  const file = app.query.file ?? null;
  const [scenes, setScenes] = useState<SceneInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setScenes(null);
    setError(null);
    if (!file) return;
    let alive = true;
    window.api.story.scenes(file).then((s) => { if (alive) setScenes(s); }, (e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [file]);

  const terms = app.glossary?.terms;
  const speakerName = useMemo(() => {
    const map = new Map((terms ?? []).filter((t) => t.target).map((t) => [t.source, t.target]));
    return (s: string) => map.get(s) ?? s;
  }, [terms]);

  // Scenes with at least one line left by the status filter and search (the scope is the file itself).
  const visible = useMemo(() => {
    if (!scenes) return [];
    const q = { ...app.query, file: undefined };
    return scenes.filter((s) => filterRows(s.lines.map((l) => app.rowsById[l.id]).filter((r): r is Row => !!r), q).length > 0);
  }, [scenes, app.query, app.rowsById]);

  const v = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 320,
    overscan: 3,
    getItemKey: (i) => visible[i].key,
  });

  if (!file) return <div className="story-empty sub">왼쪽에서 범위를 고르면 장면이 나와요</div>;
  return (
    <div className="story" ref={scrollRef} aria-label="스토리">
      {error && <div className="err-text small" role="alert">{error}</div>}
      {scenes && visible.length === 0 && <div className="story-empty sub">{scenes.length === 0 ? '이 범위에는 장면이 없어요' : '맞는 장면이 없어요'}</div>}
      <div style={{ height: v.getTotalSize(), position: 'relative' }}>
        {v.getVirtualItems().map((item) => (
          <div key={item.key} data-index={item.index} ref={v.measureElement} className="story-slot"
            style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${item.start}px)` }}>
            <SceneCard scene={visible[item.index]} rows={app.rowsById} speakerName={speakerName} />
          </div>
        ))}
      </div>
    </div>
  );
}

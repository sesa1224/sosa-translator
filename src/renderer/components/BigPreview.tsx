import { ChevronLeftIcon, ChevronRightIcon, Minimize2Icon } from 'lucide-react';
import { useEffect, useMemo, useSyncExternalStore, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Layout, Row, WindowMetrics } from '../../shared/api';
import { ICON } from '../icons';
import { orderedRows, shownRows, useApp } from '../state';
import { GamePreview, MessageWindow, MIMIC_NOTE, previewProblem, usePreviewLayout, windowDrawWidth, type PreviewLayout } from './GamePreview';

// The large preview ("크게 보며 고치기") is drawn by the item tab into a place the text table keeps above itself.
// The item tab keeps the draft, so the stage's input and the item's input are one draft and saving, conflicts
// and the preview layout all go through the item tab's code as before.

/** Lines that have a game preview (a message window to draw). */
export function hasGamePreview(row: Row): boolean {
  return row.kind === 'dialogue';
}

// ---- the place over the text table ----

let slot: HTMLElement | null = null;
const slotListeners = new Set<() => void>();
function setSlot(el: HTMLElement | null): void {
  if (slot === el) return;
  slot = el;
  for (const l of slotListeners) l();
}
function subscribeSlot(l: () => void): () => void {
  slotListeners.add(l);
  return () => { slotListeners.delete(l); };
}
function useStageSlot(): HTMLElement | null {
  return useSyncExternalStore(subscribeSlot, () => slot);
}

/** Where the stage opens. Empty it takes no room: it is display: contents, so the text view's gap stays the same. */
export function StageSlot() {
  return <div className="stage-slot" ref={setSlot} />;
}

const revealListeners = new Set<(id: string) => void>();
/** The text table scrolls a line the stage moved to into view (the table owns the scrolling). */
export function useRevealRow(f: (id: string) => void, deps: unknown[]): void {
  useEffect(() => {
    revealListeners.add(f);
    return () => { revealListeners.delete(f); };
  }, deps);
}
function revealRow(id: string): void {
  for (const l of revealListeners) l(id);
}

// ---- the item tab's preview with its stage ----

/** The item tab's game preview, and the stage over the table while it is open. Both draw from one layout call. */
export function ItemPreview({ row, draft, onDraft, onKey, saving }: {
  row: Row; draft: string; onDraft: (text: string) => void; onKey: (e: KeyboardEvent) => void; saving: boolean;
}) {
  const preview = usePreviewLayout(row.id, draft);
  const { bigPreview, view } = useApp();
  const place = useStageSlot();
  const toggle = () => {
    if (bigPreview && view === 'text') return useApp.setBigPreview(false);
    useApp.setView('text');
    useApp.setBigPreview(true);
  };
  return (
    <>
      <GamePreview preview={preview} big={bigPreview && view === 'text'} onBig={toggle} />
      {bigPreview && view === 'text' && place && createPortal(
        <BigStage row={row} preview={preview} draft={draft} onDraft={onDraft} onKey={onKey} saving={saving} />, place)}
    </>
  );
}

/** "n줄 / 최대 m줄 · 폭 p%" and whether it overflows the window (more lines than fit, or a line too wide). */
export function fitLabel(layout: Layout, metrics: WindowMetrics): { text: string; over: boolean } {
  const maxLines = layout.maxLines ?? metrics.maxLines;
  const lines = layout.lines.length;
  const width = layout.available > 0 ? Math.round((layout.maxWidth / layout.available) * 100) : 0;
  return { text: `${lines}줄 / 최대 ${maxLines}줄 · 폭 ${width}%`, over: lines > maxLines || layout.maxWidth > layout.available };
}

function BigStage({ row, preview, draft, onDraft, onKey, saving }: {
  row: Row; preview: PreviewLayout; draft: string; onDraft: (text: string) => void; onKey: (e: KeyboardEvent) => void; saving: boolean;
}) {
  const app = useApp();
  const shown = useMemo(() => shownRows(orderedRows(app), app.query, app.idFilter), [app.rowOrder, app.rowsById, app.query, app.idFilter]);
  const at = shown.findIndex((r) => r.id === row.id);
  // Lines without a message window (choices, database names) would close the stage, so they are stepped over.
  const prev = at < 0 ? undefined : shown.slice(0, at).findLast(hasGamePreview);
  const next = at < 0 ? undefined : shown.slice(at + 1).find(hasGamePreview);
  const go = (r: Row | undefined) => {
    if (!r) return;
    void useApp.selectRow(r.id);
    revealRow(r.id);
  };
  const { state, layout, palette, family } = preview;
  const fit = state && layout ? fitLabel(layout, state.metrics) : null;
  const problem = previewProblem(preview);
  return (
    <section className="stage" aria-label="크게 보며 고치기">
      <div className="stage-tools">
        {fit && <span className={`fit${fit.over ? ' over' : ''}`}>{fit.text}</span>}
        <span className="stage-where">{row.location}{row.speaker ? ` · ${row.speaker}` : ''}</span>
        <span className="grow" />
        <button type="button" className="sbtn2" disabled={!prev} onClick={() => go(prev)}><ChevronLeftIcon {...ICON} />이전 줄</button>
        <button type="button" className="sbtn2" disabled={!next} onClick={() => go(next)}>다음 줄<ChevronRightIcon {...ICON} /></button>
        <button type="button" className="sbtn2" onClick={() => useApp.setBigPreview(false)}><Minimize2Icon {...ICON} />작게</button>
      </div>
      {/* One column as wide as the window at full size, so the input lines up under the window it fills. */}
      <div className="stage-col" style={state && layout ? { maxWidth: windowDrawWidth(layout, state.metrics) } : undefined}>
        {problem ?? (state && layout && <MessageWindow layout={layout} metrics={state.metrics} palette={palette} family={family} />)}
        <label htmlFor="stage-target" className="sr-only">큰 미리보기 번역</label>
        <textarea id="stage-target" className="stage-input" rows={3} value={draft} disabled={saving} placeholder="여기에 바로 번역을 쓰세요"
          onChange={(e) => onDraft(e.target.value)} onKeyDown={onKey} />
        <div className="stage-foot">
          <span>Ctrl+Enter 로 저장</span>
          <span>{MIMIC_NOTE}</span>
        </div>
      </div>
    </section>
  );
}

import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { FontInfo, ImageEntry, Rect, Region, RegionOverflow } from '../../shared/api';
import { num } from '../format';
import { useApp } from '../state';

type Filter = 'all' | 'none' | 'todo' | 'done' | 'manual' | 'skip' | 'problem';
const FILTERS: [Filter, string][] = [['all', '전체'], ['none', '안 본 것'], ['todo', '할 것'], ['done', '끝남'], ['manual', '직접 고침'], ['skip', '건너뜀'], ['problem', '문제 있음']];
const STATUS_LABEL: Record<ImageEntry['status'], string> = { none: '안 봄', todo: '할 것', done: '끝남', manual: '직접 고침', skip: '건너뜀' };
const COLUMNS = 3;
const CELL_HEIGHT = 168;
const SAVE_DELAY = 300;
const ZOOMS: ['fit' | 1 | 2, string][] = [['fit', '맞춤'], [1, '100%'], [2, '200%']];

const baseName = (p: string) => p.replace(/^.*[\\/]/, '');
const folderOf = (file: string) => file.slice(0, Math.max(0, file.lastIndexOf('/')));
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function newId(): string {
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** An object URL for PNG bytes, revoked when the bytes change or the component goes away. */
function useBlobUrl(bytes: Uint8Array | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!bytes || bytes.length === 0) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [bytes]);
  return url;
}

function matches(e: ImageEntry, f: Filter): boolean {
  if (f === 'all') return true;
  if (f === 'problem') return e.problem !== undefined;
  return e.status === f;
}

// ---------------------------------------------------------------- list

function Thumb({ entry }: { entry: ImageEntry }) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const which = entry.status === 'done' || entry.status === 'manual' || entry.status === 'todo' ? 'rendered' : 'original';
  useEffect(() => {
    let alive = true;
    // Thumbnails are made (and kept on disk) only when a cell comes into view.
    window.api.images.thumb(entry.file, which).then((b) => { if (alive) setBytes(b); }, () => undefined);
    return () => { alive = false; };
  }, [entry.file, entry.hash, entry.status, which]);
  const url = useBlobUrl(bytes);
  return <span className="iv-thumb">{url && <img src={url} alt="" />}</span>;
}

function ImageGrid({ entries, current }: { entries: ImageEntry[]; current: string | null }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = Math.ceil(entries.length / COLUMNS);
  const v = useVirtualizer({ count: rows, getScrollElement: () => scrollRef.current, estimateSize: () => CELL_HEIGHT, overscan: 3 });
  return (
    <div className="iv-grid" ref={scrollRef} role="list" aria-label="그림 목록">
      <div style={{ height: v.getTotalSize(), position: 'relative' }}>
        {v.getVirtualItems().map((row) => (
          <div key={row.key} className="iv-grid-row" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: CELL_HEIGHT, transform: `translateY(${row.start}px)` }}>
            {entries.slice(row.index * COLUMNS, row.index * COLUMNS + COLUMNS).map((e) => (
              <button key={e.file} type="button" role="button" data-file={e.file} title={e.file}
                className={`iv-cell${e.file === current ? ' on' : ''}`} aria-pressed={e.file === current} onClick={() => useApp.selectImage(e.file)}>
                <Thumb entry={e} />
                <span className="iv-cell-name small">{baseName(e.file)}</span>
                <span className="iv-cell-meta">
                  <span className={`tag small${e.problem ? ' warn' : ''}`}>{e.problem ? '문제 있음' : STATUS_LABEL[e.status]}</span>
                  {e.usedByEvents > 0 && <span className="sub small">{`이벤트 ${num(e.usedByEvents)}곳`}</span>}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- font chooser

function fontLabel(path: string | null, fonts: FontInfo[] | null): string {
  if (!path) return '정하지 않음';
  return fonts?.find((f) => f.path.toLowerCase() === path.toLowerCase())?.displayName ?? baseName(path);
}

function useFontList(): FontInfo[] | null {
  const [fonts, setFonts] = useState<FontInfo[] | null>(null);
  useEffect(() => {
    let alive = true;
    window.api.fonts.list().then((l) => { if (alive) setFonts(l.fonts); }, () => { if (alive) setFonts([]); });
    return () => { alive = false; };
  }, []);
  return fonts;
}

/** A small font list (the same fonts as the game font picker). allowDefault adds "기본 폰트 쓰기". */
function FontChooser({ title, allowDefault, onPick, onClose }: { title: string; allowDefault: boolean; onPick(path: string | null): void; onClose(): void }) {
  const fonts = useFontList();
  const [query, setQuery] = useState('');
  const [hangulOnly, setHangulOnly] = useState(true);
  const [extra, setExtra] = useState<FontInfo[]>([]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...(fonts ?? []), ...extra].filter((f) => (!hangulOnly || f.hasHangul) && (q === '' || f.displayName.toLowerCase().includes(q) || f.family.toLowerCase().includes(q)));
  }, [fonts, extra, query, hangulOnly]);
  const pickFile = async () => {
    const f = await window.api.fonts.pickFile().catch(() => null);
    if (f) {
      setExtra((x) => [...x, f]);
      onPick(f.path);
    }
  };
  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div className="dialog iv-font-dialog" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <span className="card-title">{title}</span>
        <input className="input" type="search" aria-label="폰트 검색" placeholder="폰트 이름" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="small"><input type="checkbox" checked={hangulOnly} onChange={(e) => setHangulOnly(e.target.checked)} /> 한글 있는 폰트만</label>
        <div className="iv-font-list" role="listbox" aria-label="이미지 폰트 목록">
          {allowDefault && <button type="button" role="option" aria-selected={false} className="iv-font" onClick={() => onPick(null)}>기본 폰트 쓰기</button>}
          {fonts === null && <span className="sub small">폰트를 읽는 중이에요</span>}
          {shown.map((f) => (
            <button key={f.path} type="button" role="option" aria-selected={false} className="iv-font" onClick={() => onPick(f.path)}>
              <span>{f.displayName}</span><span className="sub small">{f.style}</span>
            </button>
          ))}
        </div>
        <div className="row-gap">
          <button type="button" className="btn small-btn" onClick={() => void pickFile()}>폰트 파일 직접 고르기</button>
          <div className="grow" />
          <button type="button" className="btn ghost small-btn" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

function DefaultFontControl() {
  const [path, setPath] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const fonts = useFontList();
  const { images } = useApp();
  useEffect(() => {
    window.api.images.defaultFont().then(setPath, () => undefined);
  }, [images]);
  const pick = async (p: string | null) => {
    setOpen(false);
    await useApp.setImageFont(p);
    setPath(p);
  };
  return (
    <span className="iv-default-font small">
      <span>{`기본 이미지 폰트: ${fontLabel(path, fonts)}`}</span>
      <button type="button" className="btn ghost small-btn" onClick={() => setOpen(true)}>바꾸기</button>
      {open && <FontChooser title="기본 이미지 폰트" allowDefault={false} onPick={(p) => void pick(p)} onClose={() => setOpen(false)} />}
    </span>
  );
}

// ---------------------------------------------------------------- editor

type Drag =
  | { kind: 'draw'; x0: number; y0: number }
  | { kind: 'move'; index: number; x0: number; y0: number; rect: Rect }
  | { kind: 'resize'; index: number; corner: 'nw' | 'ne' | 'sw' | 'se'; rect: Rect };

function clampRect(r: Rect, w: number, h: number): Rect {
  const x = Math.max(0, Math.min(Math.round(r.x), w - 1));
  const y = Math.max(0, Math.min(Math.round(r.y), h - 1));
  return { x, y, w: Math.max(1, Math.min(Math.round(r.w), w - x)), h: Math.max(1, Math.min(Math.round(r.h), h - y)) };
}

function boxStyle(r: Rect, entry: ImageEntry): React.CSSProperties {
  return { left: `${(r.x / entry.width) * 100}%`, top: `${(r.y / entry.height) * 100}%`, width: `${(r.w / entry.width) * 100}%`, height: `${(r.h / entry.height) * 100}%` };
}

function Stage({ entry, url, alt, regions, selected, zoom, editable, onSelect, onChange, onAdd }: {
  entry: ImageEntry; url: string | null; alt: string; regions: Region[]; selected: number; zoom: 'fit' | 1 | 2; editable: boolean;
  onSelect(i: number): void; onChange?(i: number, rect: Rect): void; onAdd?(rect: Rect): void;
}) {
  const overlay = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Rect | null>(null);
  const toImage = (e: { clientX: number; clientY: number }) => {
    const r = overlay.current!.getBoundingClientRect();
    const s = r.width > 0 ? r.width / entry.width : 1;
    const t = r.height > 0 ? r.height / entry.height : s;
    return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / t };
  };
  const begin = (e: ReactMouseEvent, drag: Drag) => {
    if (!editable || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const start = toImage(e);
    const rectOf = (p: { x: number; y: number }): Rect => {
      if (drag.kind === 'draw') return { x: Math.min(drag.x0, p.x), y: Math.min(drag.y0, p.y), w: Math.abs(p.x - drag.x0), h: Math.abs(p.y - drag.y0) };
      if (drag.kind === 'move') return { ...drag.rect, x: drag.rect.x + p.x - drag.x0, y: drag.rect.y + p.y - drag.y0 };
      const r = drag.rect;
      const left = drag.corner.endsWith('w') ? p.x : r.x;
      const right = drag.corner.endsWith('e') ? p.x : r.x + r.w;
      const top = drag.corner.startsWith('n') ? p.y : r.y;
      const bottom = drag.corner.startsWith('s') ? p.y : r.y + r.h;
      return { x: Math.min(left, right), y: Math.min(top, bottom), w: Math.abs(right - left), h: Math.abs(bottom - top) };
    };
    const move = (ev: MouseEvent) => {
      const r = clampRect(rectOf(toImage(ev)), entry.width, entry.height);
      if (drag.kind === 'draw') setDraft(r);
      else onChange?.(drag.index, r);
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      const p = toImage(ev);
      const raw = rectOf(p);
      setDraft(null);
      if (drag.kind === 'draw') {
        if (raw.w >= 2 && raw.h >= 2) onAdd?.(clampRect(raw, entry.width, entry.height));
      } else if (p.x !== start.x || p.y !== start.y) onChange?.(drag.index, clampRect(raw, entry.width, entry.height));
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  const width = zoom === 'fit' ? undefined : entry.width * zoom;
  return (
    <div className="iv-stage-wrap">
      <div className="iv-stage" style={zoom === 'fit' ? { maxWidth: '100%' } : { width }}>
        {url ? <img src={url} alt={alt} role="img" draggable={false} /> : <span className="sub small">그림을 불러오는 중이에요</span>}
        <div ref={overlay} className={`iv-overlay${editable ? ' editable' : ''}`} aria-label={editable ? '원본 위에서 끌어 영역 만들기' : undefined}
          onMouseDown={(e) => { if (e.target === overlay.current) begin(e, { kind: 'draw', ...(() => { const p = toImage(e); return { x0: p.x, y0: p.y }; })() }); }}>
          {regions.map((r, i) => (
            <div key={r.id} className={`iv-box${i === selected ? ' on' : ''}`} style={boxStyle(r.rect, entry)}
              onMouseDown={(e) => { onSelect(i); const p = toImage(e); begin(e, { kind: 'move', index: i, x0: p.x, y0: p.y, rect: r.rect }); }}>
              <span className="iv-box-n">{i + 1}</span>
              {editable && i === selected && (['nw', 'ne', 'sw', 'se'] as const).map((c) => (
                <span key={c} className={`iv-handle ${c}`} onMouseDown={(e) => begin(e, { kind: 'resize', index: i, corner: c, rect: r.rect })} />
              ))}
            </div>
          ))}
          {draft && <div className="iv-box draft" style={boxStyle(draft, entry)} />}
        </div>
      </div>
    </div>
  );
}

function RegionEditor({ region, index, count, overflow, onChange, onRemove, onPickFont, fonts }: {
  region: Region; index: number; count: number; overflow: RegionOverflow | undefined; fonts: FontInfo[] | null;
  onChange(patch: Partial<Region>): void; onRemove(): void; onPickFont(): void;
}) {
  const over = overflow && (overflow.overflowX || overflow.overflowY);
  return (
    <section className="card iv-editor" aria-label="영역 설정">
      <div className="row-between">
        <span className="card-title">{`선택한 글자 영역 ${index + 1} / ${count}`}</span>
        {over && <span className="warn-text small" role="status">영역을 넘쳐요</span>}
        <button type="button" className="btn ghost small-btn" onClick={onRemove}>영역 지우기</button>
      </div>
      <label className="field"><span className="label">문장</span>
        <textarea className="input iv-text" aria-label="문장" rows={2} value={region.text} onChange={(e) => onChange({ text: e.target.value })} />
      </label>
      {region.source && <span className="mute small">원래 글: <span>{region.source}</span></span>}
      <div className="iv-fields">
        <label className="field"><span className="label">지우기</span>
          <select className="input" aria-label="지우기 방식" value={region.erase} onChange={(e) => onChange({ erase: e.target.value as Region['erase'] })}>
            <option value="none">안 지움</option>
            <option value="fill">색으로 채움</option>
            <option value="sample">주변 색으로 채움</option>
          </select>
        </label>
        {region.erase === 'fill' && (
          <label className="field"><span className="label">채울 색</span>
            <span className="row-gap">
              <input type="color" aria-label="채울 색" value={(region.fillColor ?? '#000000').slice(0, 7)} onChange={(e) => onChange({ fillColor: e.target.value })} />
              <span className="mono small">{region.fillColor ?? '#000000'}</span>
            </span>
          </label>
        )}
        <div className="field"><span className="label">폰트</span>
          <button type="button" className="btn small-btn" onClick={onPickFont}>{region.fontPath ? fontLabel(region.fontPath, fonts) : '기본 폰트'}</button>
        </div>
      </div>
      <div className="field"><span className="label">크기</span>
        <span className="row-gap">
          <input type="range" min={6} max={200} aria-label="크기 조절" value={Math.min(200, region.size)} onChange={(e) => onChange({ size: Number(e.target.value) })} />
          <input className="input num-input" type="number" min={6} max={512} aria-label="크기" value={region.size}
            onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= 6) onChange({ size: Math.min(512, n) }); }} />
          <span className="sub small">px</span>
        </span>
      </div>
      <div className="iv-fields">
        <label className="field"><span className="label">색</span>
          <span className="row-gap">
            <input type="color" aria-label="글자 색" value={region.color.slice(0, 7)} onChange={(e) => onChange({ color: e.target.value })} />
            <span className="mono small">{region.color}</span>
          </span>
        </label>
        <div className="field"><span className="label">가로 정렬</span>
          <span className="seg">
            {([['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']] as const).map(([v, l]) => (
              <button key={v} type="button" className={region.align === v ? 'on' : ''} aria-pressed={region.align === v} onClick={() => onChange({ align: v })}>{l}</button>
            ))}
          </span>
        </div>
        <div className="field"><span className="label">세로 정렬</span>
          <span className="seg">
            {([['top', '위', '위'], ['middle', '가운데', '세로 가운데'], ['bottom', '아래', '아래']] as const).map(([v, l, aria]) => (
              <button key={v} type="button" aria-label={aria} className={region.valign === v ? 'on' : ''} aria-pressed={region.valign === v} onClick={() => onChange({ valign: v })}>{l}</button>
            ))}
          </span>
        </div>
      </div>
      <div className="iv-fields">
        <label className="field"><span className="label">줄 높이</span>
          <input className="input num-input" type="number" step={0.05} min={0.5} max={5} aria-label="줄 높이" value={region.lineHeight}
            onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n > 0) onChange({ lineHeight: n }); }} />
        </label>
        <label className="small iv-check"><input type="checkbox" checked={region.bold} onChange={(e) => onChange({ bold: e.target.checked })} /> 굵게</label>
        <label className="small iv-check"><input type="checkbox" checked={region.stroke !== null}
          onChange={(e) => onChange({ stroke: e.target.checked ? { color: '#000000', width: 2 } : null })} /> 테두리</label>
        {region.stroke && (
          <span className="row-gap">
            <input type="color" aria-label="테두리 색" value={region.stroke.color.slice(0, 7)} onChange={(e) => onChange({ stroke: { ...region.stroke!, color: e.target.value } })} />
            <input className="input num-input" type="number" min={0} max={40} aria-label="테두리 두께" value={region.stroke.width}
              onChange={(e) => onChange({ stroke: { ...region.stroke!, width: Math.max(0, Number(e.target.value) || 0) } })} />
          </span>
        )}
        <label className="small iv-check"><input type="checkbox" checked={region.shadow !== null}
          onChange={(e) => onChange({ shadow: e.target.checked ? { color: '#000000', dx: 2, dy: 2, blur: 2 } : null })} /> 그림자</label>
        {region.shadow && (
          <span className="row-gap">
            <input type="color" aria-label="그림자 색" value={region.shadow.color.slice(0, 7)} onChange={(e) => onChange({ shadow: { ...region.shadow!, color: e.target.value } })} />
            {(['dx', 'dy', 'blur'] as const).map((k) => (
              <input key={k} className="input num-input" type="number" aria-label={`그림자 ${k === 'dx' ? '가로' : k === 'dy' ? '세로' : '흐림'}`} value={region.shadow![k]}
                onChange={(e) => onChange({ shadow: { ...region.shadow!, [k]: Number(e.target.value) || 0 } })} />
            ))}
          </span>
        )}
      </div>
    </section>
  );
}

function ImageEditor({ entry }: { entry: ImageEntry }) {
  const file = entry.file;
  const [regions, setRegions] = useState<Region[]>([]);
  const [selected, setSelected] = useState(0);
  const [original, setOriginal] = useState<Uint8Array | null>(null);
  const [rendered, setRendered] = useState<Uint8Array | null>(null);
  const [overflow, setOverflow] = useState<Record<string, RegionOverflow>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [zoom, setZoom] = useState<'fit' | 1 | 2>('fit');
  const [fontFor, setFontFor] = useState<'region' | 'default' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualFile, setManualFile] = useState(false);
  const fonts = useFontList();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Region[] | null>(null);
  const originalUrl = useBlobUrl(original);
  const renderedUrl = useBlobUrl(rendered);

  const refreshRendered = useCallback(async () => {
    try {
      setRendered(await window.api.images.full(file, 'rendered'));
      setFailure(null);
    } catch (e) {
      setRendered(null);
      setFailure((await window.api.images.failure(file).catch(() => null)) ?? errorText(e));
    }
    window.api.images.overflow(file).then(setOverflow, () => setOverflow({}));
  }, [file]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await useApp.imageRecipe(file).catch(() => null);
      if (!alive) return;
      setRegions(r?.regions ?? []);
      setManualFile(!!r?.manualFile);
      setSelected(0);
      setOriginal(await window.api.images.full(file, 'original').catch(() => null));
    })();
    return () => { alive = false; };
  }, [file]);

  // A new entry object means the picture or its recipe changed (also after our own save).
  useEffect(() => {
    void refreshRendered();
    window.api.images.recipe(file).then((r) => setManualFile(!!r?.manualFile), () => undefined);
  }, [entry, refreshRendered, file]);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    pending.current = null;
    if (!next) return;
    try {
      setError(null);
      await useApp.saveRecipe(file, next);
      await refreshRendered();
    } catch (e) {
      setError(errorText(e));
    }
  }, [file, refreshRendered]);

  // Leaving the picture saves what is still waiting.
  useEffect(() => () => { void flush(); }, [flush]);

  const commit = (next: Region[]) => {
    setRegions(next);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY);
  };
  const patch = (i: number, p: Partial<Region>) => commit(regions.map((r, n) => (n === i ? { ...r, ...p } : r)));
  const add = (rect: Rect) => {
    const like = regions[selected] ?? regions.at(-1);
    const r: Region = like
      ? { ...like, id: newId(), rect, text: '', source: undefined }
      : { id: newId(), rect, erase: 'sample', text: '', fontPath: null, size: 24, color: '#ffffff', align: 'center', valign: 'middle', lineHeight: 1.25, bold: false, stroke: null, shadow: null };
    if (r.source === undefined) delete r.source;
    commit([...regions, r]);
    setSelected(regions.length);
  };
  const remove = () => {
    commit(regions.filter((_, n) => n !== selected));
    setSelected((s) => Math.max(0, Math.min(s, regions.length - 2)));
  };
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const pickFont = async (p: string | null) => {
    const mode = fontFor;
    setFontFor(null);
    if (mode === 'region') patch(selected, { fontPath: p });
    else await run(() => useApp.setImageFont(p));
  };
  const cur = regions[selected];
  const done = entry.status === 'done';

  return (
    <div className="iv-main">
      <div className="iv-actions row-gap">
        {done
          ? <button type="button" className="btn small-btn" onClick={() => void run(() => useApp.setImageStatus(file, 'todo'))}>다시 할 것으로</button>
          : <button type="button" className="btn soft small-btn" onClick={() => void run(async () => { await flush(); await useApp.setImageStatus(file, 'done'); })}>끝남으로 표시</button>}
        <button type="button" className="btn small-btn" onClick={() => void run(() => useApp.setImageStatus(file, 'skip'))}>건너뛰기</button>
        {manualFile || entry.status === 'manual'
          ? <button type="button" className="btn small-btn" onClick={() => void run(() => useApp.clearManualImage(file))}>직접 고친 그림 빼기</button>
          : <button type="button" className="btn small-btn" onClick={() => void run(() => useApp.pickManualImage(file))}>직접 고친 그림 넣기</button>}
        <button type="button" className="btn ghost small-btn" onClick={() => useApp.talkAboutImage(file)}>채팅으로 말하기</button>
        <div className="grow" />
        <span className="seg" aria-label="확대">
          {ZOOMS.map(([z, l]) => <button key={l} type="button" className={zoom === z ? 'on' : ''} aria-pressed={zoom === z} onClick={() => setZoom(z)}>{l}</button>)}
        </span>
      </div>
      {entry.problem === 'base-changed' && (
        <div className="banner warn" role="status">
          <span>원본 그림이 바뀌었어요. 지시서가 맞는지 확인하세요</span>
          <div className="grow" />
          <button type="button" className="btn small-btn" onClick={() => void run(() => useApp.acceptImageBase(file))}>확인했어요</button>
        </div>
      )}
      {entry.problem === 'font-missing' && (
        <div className="banner warn" role="status">
          <span>폰트를 찾을 수 없어요</span>
          <div className="grow" />
          <button type="button" className="btn small-btn" onClick={() => setFontFor('default')}>폰트 고르기</button>
        </div>
      )}
      {(entry.problem === 'render-failed' || failure) && (
        <div className="banner err" role="alert">
          <span>{failure ?? '그림을 찍지 못했어요'}</span>
          <div className="grow" />
          <button type="button" className="btn small-btn" onClick={() => void refreshRendered()}>다시 찍기</button>
        </div>
      )}
      {error && <span className="err-text small" role="alert">{error}</span>}
      <div className="iv-panes">
        <div className="iv-pane">
          <span className="label">원본 · 끌어서 글자 영역을 만들어요</span>
          <Stage entry={entry} url={originalUrl} alt="원본" regions={regions} selected={selected} zoom={zoom} editable
            onSelect={setSelected} onChange={(i, rect) => patch(i, { rect })} onAdd={add} />
        </div>
        <div className="iv-pane">
          <span className="label accent-text">번역본 · 고른 폰트로 바로 다시 찍혀요</span>
          <Stage entry={entry} url={renderedUrl ?? originalUrl} alt="번역본" regions={regions} selected={selected} zoom={zoom} editable={false} onSelect={setSelected} />
        </div>
      </div>
      {cur
        ? <RegionEditor region={cur} index={selected} count={regions.length} overflow={overflow[cur.id]} fonts={fonts}
            onChange={(p) => patch(selected, p)} onRemove={remove} onPickFont={() => setFontFor('region')} />
        : <span className="sub small">글자 영역이 없어요. 원본 위에서 끌어 만드세요.</span>}
      {fontFor && <FontChooser title={fontFor === 'region' ? '이 영역의 폰트' : '기본 이미지 폰트'} allowDefault={fontFor === 'region'}
        onPick={(p) => void pickFont(p)} onClose={() => setFontFor(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------- screen

export function ImageView() {
  const { images, imageFile } = useApp();
  // The update result opens this screen on the pictures with a problem.
  const [filter, setFilter] = useState<Filter>(() => (FILTERS.some(([f]) => f === useApp.get().imageFilter) ? (useApp.get().imageFilter as Filter) : 'all'));
  const [folder, setFolder] = useState('');
  useEffect(() => { void useApp.loadImages(); }, []);
  const folders = useMemo(() => [...new Set((images ?? []).map((e) => folderOf(e.file)))].sort(), [images]);
  const shown = useMemo(() => (images ?? []).filter((e) => matches(e, filter) && (!folder || folderOf(e.file) === folder)), [images, filter, folder]);
  const current = images?.find((e) => e.file === imageFile) ?? null;
  const [regionCount, setRegionCount] = useState<number | null>(null);
  useEffect(() => {
    if (!current) return setRegionCount(null);
    window.api.images.recipe(current.file).then((r) => setRegionCount(r?.regions.length ?? 0), () => setRegionCount(null));
  }, [current]);

  return (
    <div className="image-view">
      <div className="page-head iv-head">
        <div>
          <h1 className="page-title">이미지</h1>
          {current && <span className="mono sub small">{`${current.file}${regionCount !== null ? ` · 글자 영역 ${num(regionCount)}개` : ''}`}</span>}
        </div>
        <div className="grow" />
        <DefaultFontControl />
        <button type="button" className="btn small-btn" onClick={() => void useApp.rerenderImages().catch(() => undefined)}>전체 이미지 다시 찍기</button>
      </div>
      <span className="hint">완성된 그림이 아니라 설정을 저장해요. 값을 바꾸면 바로 다시 찍혀요.</span>
      {images === null && <span className="sub small">그림을 찾는 중이에요</span>}
      {images !== null && images.length === 0 && <div className="empty">이 게임에는 글자가 있을 만한 그림 폴더가 없어요</div>}
      {images !== null && images.length > 0 && (
        <div className="iv-cols">
          <div className="iv-side">
            <div className="fp-chips">
              {FILTERS.map(([f, label]) => (
                <button key={f} type="button" className={`pill${filter === f ? ' on' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>{label}</button>
              ))}
            </div>
            <select className="input" aria-label="폴더" value={folder} onChange={(e) => setFolder(e.target.value)}>
              <option value="">모든 폴더</option>
              {folders.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <ImageGrid entries={shown} current={imageFile} />
          </div>
          {current ? <ImageEditor key={current.file} entry={current} /> : <div className="empty">왼쪽에서 그림을 고르세요</div>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- settings

/** Settings section: which game folders are searched for pictures with words in them. */
export function ImageFolderSettings() {
  const [text, setText] = useState('');
  const [defaults, setDefaults] = useState<string[]>([]);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    window.api.images.folders().then((f) => { setText(f.folders.join('\n')); setSaved(f.folders.join('\n')); setDefaults(f.defaults); }, () => undefined);
  }, []);
  const apply = async (folders: string[] | null) => {
    setError(null);
    try {
      await window.api.images.setFolders(folders);
      const f = await window.api.images.folders();
      setText(f.folders.join('\n'));
      setSaved(f.folders.join('\n'));
      await useApp.loadImages();
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <section className="card settings-card" aria-labelledby="set-images">
      <span id="set-images" className="card-title">이미지</span>
      <div className="field"><label htmlFor="image-folders">글자가 있을 만한 그림을 찾을 폴더 (한 줄에 하나)</label>
        <textarea id="image-folders" className="input mono iv-folders" rows={5} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="row-gap">
        <button type="button" className="btn small-btn" disabled={text === saved}
          onClick={() => void apply(text.split('\n').map((l) => l.trim()).filter(Boolean))}>적용</button>
        <button type="button" className="btn ghost small-btn" onClick={() => void apply(null)}>기본값으로</button>
        <span className="hint">{`기본값: ${defaults.join(', ')}`}</span>
      </div>
      {error && <span className="err-text small" role="alert">{error}</span>}
    </section>
  );
}

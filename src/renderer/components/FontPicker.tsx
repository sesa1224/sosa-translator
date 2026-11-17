import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { FontInfo, FontList, OverflowCount, WindowMetrics } from '../../shared/api';
import { num } from '../format';
import { ensureFontFace } from '../preview/fontFace';
import { usePreviewState } from '../preview/usePreview';
import { orderedRows, useApp } from '../state';
import { MIMIC_NOTE } from './GamePreview';
import { SetRow } from './ui';

const HOVER_DELAY = 200;
const SEARCH_DELAY = 150;
const ROW_HEIGHT = 52;
const DEFAULT_SAMPLE = ['월광초를 3개 모아다 줄래?', '보답으로 150골드 줄게.'];
const DEFAULT_CHOICES = ['좋아', '다음에'];
const CODE = /\\[A-Za-z]+(?:\[[^\]\r\n]*\])?|\\[{}.|!><^$\\]/g;

type Kind = 'all' | 'game' | 'system' | 'user';
const KINDS: [Kind, string][] = [['all', '전체'], ['game', '게임에 든 폰트'], ['system', '설치된 폰트'], ['user', '직접 고른 파일']];

const METRIC_FIELDS: [keyof WindowMetrics, string][] = [
  ['boxWidth', '대사창 폭'], ['fontSize', '글자 크기'], ['lineHeight', '줄 높이'], ['maxLines', '최대 줄 수'], ['faceIndent', '얼굴 그림 밀림 폭'],
];

/** CSS family for a font path once it is loaded (null until then or when it fails). */
function useFontFamily(path: string | null): string | null {
  const [family, setFamily] = useState<string | null>(null);
  useEffect(() => {
    setFamily(null);
    if (!path) return;
    let alive = true;
    ensureFontFace(path).then((f) => { if (alive) setFamily(f); }, () => undefined);
    return () => { alive = false; };
  }, [path]);
  return family;
}

function FontRow({ f, chosen, active, onPick, onHover, style, index }: {
  f: FontInfo; chosen: boolean; active: boolean; index: number; style: React.CSSProperties;
  onPick(): void; onHover(): void;
}) {
  const family = useFontFamily(f.path);
  return (
    <div role="option" aria-selected={chosen} id={`font-opt-${index}`} tabIndex={-1} data-index={index}
      className={`fp-row${chosen ? ' on' : ''}${active ? ' active' : ''}`} style={style}
      onMouseEnter={onHover} onFocus={onHover} onClick={onPick}>
      <span className="fp-name" style={{ fontFamily: family ? `"${family}"` : undefined }}>{f.displayName}</span>
      <span className="fp-meta small sub">{f.style}</span>
      {!f.hasHangul && <span className="tag small">한글 없음</span>}
    </div>
  );
}

/** Lines of the longest translated dialogue (codes removed), or the default sample. */
function sampleLines(rows: ReturnType<typeof orderedRows>, maxLines: number): { lines: string[]; choices: string[] } {
  let best: string | null = null;
  for (const r of rows) {
    if (r.kind !== 'dialogue' || r.target === null) continue;
    if (best === null || r.target.length > best.length) best = r.target;
  }
  const lines = best ? best.replace(CODE, '').split('\n').slice(0, Math.max(1, maxLines)) : DEFAULT_SAMPLE;
  const choices = rows.filter((r) => r.kind === 'choice' && r.target).slice(0, 2).map((r) => r.target!.replace(CODE, ''));
  return { lines, choices: choices.length === 2 ? choices : DEFAULT_CHOICES };
}

function MetricsEditor({ metrics, detected, overrides }: { metrics: WindowMetrics; detected: WindowMetrics; overrides: Partial<WindowMetrics> }) {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const v: Record<string, string> = {};
    for (const [k] of METRIC_FIELDS) v[k] = overrides[k] !== undefined ? String(overrides[k]) : '';
    setValues(v);
  }, [JSON.stringify(overrides)]);
  const commit = (k: keyof WindowMetrics) => {
    const raw = (values[k] ?? '').trim();
    const next: Partial<WindowMetrics> = { ...overrides };
    const n = Number(raw);
    if (raw === '' || !Number.isFinite(n) || n <= 0) delete next[k];
    else (next as Record<string, number>)[k] = Math.round(n);
    if (JSON.stringify(next) === JSON.stringify(overrides)) return;
    void window.api.preview.setOverrides(next);
  };
  return (
    <details className="fp-metrics">
      <summary>대사창 치수 고치기</summary>
      <div className="fp-metric-grid">
        {METRIC_FIELDS.map(([k, label]) => (
          <div key={k} className="field">
            <label htmlFor={`metric-${k}`}>{label}</label>
            <input id={`metric-${k}`} className="input mono" inputMode="numeric" placeholder={String(detected[k])} value={values[k] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
              onBlur={() => commit(k)} onKeyDown={(e) => { if (e.key === 'Enter') commit(k); }} />
          </div>
        ))}
      </div>
      <div className="row-between">
        <span className="hint">{`지금 쓰는 값: 폭 ${metrics.boxWidth}, 글자 ${metrics.fontSize}, 줄 높이 ${metrics.lineHeight}, ${metrics.maxLines}줄, 얼굴 ${metrics.faceIndent}`}</span>
        <button type="button" className="btn ghost small-btn" disabled={Object.keys(overrides).length === 0}
          onClick={() => void window.api.preview.setOverrides({})}>자동 값으로 되돌리기</button>
      </div>
    </details>
  );
}

/** "Game font" in the settings: pick the font used for the preview and the pixel-width check. */
export function FontPicker() {
  const app = useApp();
  const state = usePreviewState();
  const [list, setList] = useState<FontList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [hangulOnly, setHangulOnly] = useState(true);
  const [kind, setKind] = useState<Kind>('all');
  const [hovered, setHovered] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const [count, setCount] = useState<{ path: string | null; result: OverflowCount } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chosen = state?.settings.fontPath ?? null;

  useEffect(() => {
    let alive = true;
    window.api.fonts.list().then((l) => { if (alive) setList(l); }, (e) => { if (alive) setLoadError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; if (hoverTimer.current) clearTimeout(hoverTimer.current); };
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim().toLowerCase()), SEARCH_DELAY);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => {
    if (app.fontPickerRequest > 0) sectionRef.current?.scrollIntoView?.({ block: 'start' });
  }, [app.fontPickerRequest]);

  const shown = useMemo(() => (list?.fonts ?? []).filter((f) => {
    if (hangulOnly && !f.hasHangul) return false;
    if (kind !== 'all' && f.source !== kind) return false;
    return search === '' || f.displayName.toLowerCase().includes(search) || f.family.toLowerCase().includes(search);
  }), [list, hangulOnly, kind, search]);

  // The font the preview shows: the one under the pointer, else the chosen one.
  const previewPath = hovered ?? (state?.fontMissing ? null : chosen);
  const family = useFontFamily(previewPath);

  // Overflow count for the shown font (hovered: measured without saving).
  useEffect(() => {
    if (!state) return;
    let alive = true;
    const target = hovered;
    if (!target && !chosen) { setCount(null); return; }
    window.api.preview.countOverflow(target ?? undefined)
      .then((r) => { if (alive) setCount({ path: target, result: r }); }, () => undefined);
    return () => { alive = false; };
  }, [hovered, chosen, state]);

  const v = useVirtualizer({ count: shown.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_HEIGHT, overscan: 6, getItemKey: (i) => shown[i].path });

  const hover = (path: string) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHovered(path), HOVER_DELAY);
  };
  const run = async (job: () => Promise<unknown>) => {
    setError(null);
    try {
      await job();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const pick = (path: string | null) => run(() => window.api.preview.setFont(path));
  const pickFile = () => run(async () => {
    const f = await window.api.fonts.pickFile();
    if (!f) return;
    setList((l) => (l && !l.fonts.some((x) => x.path === f.path) ? { ...l, fonts: [...l.fonts, f] } : l));
    if (!f.hasHangul) setHangulOnly(false);
  });
  const onKey = (e: KeyboardEvent) => {
    if (shown.length === 0) return;
    let next = active;
    if (e.key === 'ArrowDown') next = Math.min(shown.length - 1, active + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, active - 1);
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); void pick(shown[active].path); return; }
    else return;
    e.preventDefault();
    setActive(next);
    v.scrollToIndex(next, { align: 'auto' });
    hover(shown[next].path);
  };

  const sample = sampleLines(orderedRows(app), state?.metrics.maxLines ?? 4);
  const fontStyle = family ? { fontFamily: `"${family}"` } : undefined;
  const result = count?.result;
  let overflowText: string | null = null;
  if (result) {
    if (count.path) overflowText = result.overflowing > 0 ? `이 폰트로 바꾸면 넘치는 줄 ${num(result.overflowing)}개` : '이 폰트로는 넘치는 줄이 없어요';
    else overflowText = result.overflowing > 0 ? `지금 폰트로 넘치는 줄 ${num(result.overflowing)}개` : '지금 폰트로는 넘치는 줄이 없어요';
  }
  const chosenInfo = list?.fonts.find((f) => f.path === chosen);

  return (
    <section ref={sectionRef} className="card settings-card font-picker" aria-labelledby="set-game-font">
      <span id="set-game-font" className="card-title">게임 폰트</span>
      {/* The settings rows first; the list and the sample are a browser, so they stay a block under them. */}
      <div className="set-list">
        <SetRow name="폰트 고르기" desc={<>
          여기서 고른 폰트는 미리보기와 폭 검사에 쓰여요. 게임에 넣는 기능은 아직 없어요.
          {state?.fontMissing && <span className="warn-text small" role="status">고른 폰트 파일을 찾을 수 없어요</span>}
        </>}>
          <button type="button" className="btn small-btn" onClick={() => void pickFile()}>폰트 파일 직접 고르기</button>
          <button type="button" className="btn ghost small-btn" disabled={!chosen} onClick={() => void pick(null)}>폰트 정하지 않기</button>
        </SetRow>
      </div>
      <div className="fp-cols">
        <div className="fp-left">
          <input className="input" type="search" aria-label="폰트 검색" placeholder="폰트 이름" value={query} onChange={(e) => setQuery(e.target.value)} />
          <label className="fp-check small">
            <input type="checkbox" checked={hangulOnly} onChange={(e) => setHangulOnly(e.target.checked)} />
            한글 있는 폰트만
          </label>
          <div className="fp-chips">
            {KINDS.map(([k, label]) => (
              <button key={k} type="button" className={`pill${kind === k ? ' on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>{label}</button>
            ))}
          </div>
          <div className="fp-list" ref={scrollRef} role="listbox" aria-label="폰트 목록" tabIndex={0} onKeyDown={onKey}
            aria-activedescendant={active >= 0 ? `font-opt-${active}` : undefined}>
            {!list && !loadError && <div className="sub small fp-empty">폰트를 읽는 중이에요</div>}
            {loadError && <div className="err-text small fp-empty">{loadError}</div>}
            {list && shown.length === 0 && <div className="sub small fp-empty">맞는 폰트가 없어요</div>}
            <div style={{ height: v.getTotalSize(), position: 'relative' }}>
              {v.getVirtualItems().map((item) => {
                const f = shown[item.index];
                return (
                  <FontRow key={item.key} f={f} index={item.index} chosen={f.path === chosen} active={item.index === active}
                    style={{ position: 'absolute', top: 0, left: 0, right: 0, height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
                    onHover={() => hover(f.path)} onPick={() => { setActive(item.index); void pick(f.path); }} />
                );
              })}
            </div>
          </div>
          {list && list.skippedCollections > 0 && <span className="hint">{`모음 파일(.ttc) ${num(list.skippedCollections)}개는 아직 쓸 수 없어요`}</span>}
        </div>
        <div className="fp-right">
          <span className="label">인게임 미리보기</span>
          <span className="small">
            {previewPath
              ? (hovered ? `올려 본 폰트: ${list?.fonts.find((f) => f.path === hovered)?.displayName ?? hovered}` : `지금 폰트: ${chosenInfo?.displayName ?? state?.settings.fontName ?? chosen}`)
              : '폰트를 정하지 않았어요'}
          </span>
          <div className="fp-window" style={fontStyle}>
            {sample.lines.map((l, i) => <div key={i}>{l}</div>)}
          </div>
          <div className="fp-choices">
            {sample.choices.map((c, i) => <span key={i} className="fp-choice" style={fontStyle}>{c}</span>)}
          </div>
          {overflowText && <span className={result && result.overflowing > 0 ? 'warn-text small' : 'accent-text small'}>{overflowText}</span>}
          {result && result.missingGlyphs > 0 && <span className="warn-text small">{`이 폰트에 없는 글자 ${num(result.missingGlyphs)}개`}</span>}
          <span className="hint">{MIMIC_NOTE}</span>
        </div>
      </div>
      {state && (
        <div className="set-list">
          <SetRow name="대사창 치수" desc="대사창을 바꾸는 플러그인을 쓰는 게임이면 여기서 맞춰 주세요." wide>
            <MetricsEditor metrics={state.metrics} detected={state.detected} overrides={state.settings.overrides} />
          </SetRow>
        </div>
      )}
      {error && <span className="err-text small" role="alert">{error}</span>}
    </section>
  );
}

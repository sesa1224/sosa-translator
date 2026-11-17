import { useEffect, useRef, useState } from 'react';
import { availableWidth, textLeft } from '../../core/preview/windows';
import type { Layout, LaidLine, PreviewState, WindowMetrics } from '../../shared/api';
import { ensureFontFace } from '../preview/fontFace';
import { usePalette, usePreviewState } from '../preview/usePreview';
import { useApp } from '../state';

export const MIMIC_NOTE = '프로그램이 흉내 내어 그린 화면이에요. 실제 확인은 게임에서 해요.';
const LAYOUT_DELAY = 150;

/** Width a line may use without a face picture (the same rule as core availableWidth). */
function plainWidth(m: WindowMetrics): number {
  return availableWidth(m, false);
}

/** Width of the element, followed with a ResizeObserver. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function LineRuns({ line, palette, family }: { line: LaidLine; palette: string[]; family: string | null }) {
  return (
    <>
      {line.runs.map((r, i) => (r.type === 'icon'
        ? <span key={i} className="gp-icon" data-icon={r.index} title={`아이콘 ${r.index}`} />
        : <span key={i} className="gp-run" data-color={r.color}
            style={{ color: palette[r.color] ?? palette[0], fontSize: `${r.size}px`, fontFamily: family ? `"${family}"` : undefined }}>{r.text}</span>))}
    </>
  );
}

/**
 * Draws a laid-out message the way the game's window would: real pixel sizes, scaled down to fit.
 * Overflowing lines stick out of the window; lines past maxLines are drawn under it.
 */
export function MessageWindow({ layout, metrics, palette, family }: { layout: Layout; metrics: WindowMetrics; palette: string[]; family: string | null }) {
  const [ref, outer] = useWidth<HTMLDivElement>();
  const help = layout.window === 'help';
  const withFace = !help && (layout.withFace ?? layout.available < plainWidth(metrics));
  const maxLines = layout.maxLines ?? metrics.maxLines;
  const height = metrics.padding * 2 + metrics.lineHeight * maxLines;
  // The help window draws from the text padding (Window_Help); the message window as the engine does (textLeft).
  const left = help ? metrics.padding + metrics.textPadding : textLeft(metrics, withFace);
  // The window as wide as the line width in use (a width the user set may differ from the detected window).
  const rightMargin = metrics.engine === 'MV' ? metrics.padding : metrics.padding + metrics.textPadding;
  const boxWidth = left + layout.available + rightMargin;
  const shown = layout.lines.slice(0, maxLines);
  const rest = layout.lines.slice(maxLines);
  const restHeight = rest.length > 0 ? 24 + rest.length * metrics.lineHeight : 0;
  // Room for text that sticks out of the window, so the overflow stays visible inside the panel.
  const content = Math.max(boxWidth, left + layout.maxWidth + 16);
  const scale = outer > 0 ? Math.min(1, outer / content) : 1;
  return (
    <div ref={ref} className="gp-frame" style={{ height: (height + restHeight) * scale }}>
      <div className="gp-stage" style={{ width: content, transform: `scale(${scale})` }}>
        <div className="gp-box" role="img" aria-label={help ? '설명창 미리보기' : '대사창 미리보기'} style={{ width: boxWidth, height }}>
          {withFace && (
            <div className="gp-face" aria-hidden="true"
              style={{ left: metrics.padding, top: metrics.padding, width: metrics.faceIndent - 24, height: Math.min(144, height - metrics.padding * 2) }} />
          )}
          {shown.map((line, i) => (
            <div key={i} className="gp-line" style={{ top: metrics.padding + i * metrics.lineHeight, left, height: metrics.lineHeight, lineHeight: `${metrics.lineHeight}px` }}>
              <LineRuns line={line} palette={palette} family={family} />
              {line.overflow > 0 && (
                <span className="gp-overflow" data-testid="overflow-mark" title={`${Math.round(line.overflow)}px 넘침`}
                  style={{ left: layout.available }} />
              )}
            </div>
          ))}
        </div>
        {rest.length > 0 && (
          <div className="gp-rest" style={{ height: restHeight }}>
            <span className="gp-rest-note">{help ? '창에 보이지 않아요' : '다음 창으로 넘어가요'}</span>
            {rest.map((line, i) => (
              <div key={i} className="gp-line gp-line-rest" style={{ top: 24 + i * metrics.lineHeight, left, lineHeight: `${metrics.lineHeight}px` }}>
                <LineRuns line={line} palette={palette.map(() => 'var(--mute)')} family={family} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Width bar, line count and missing glyphs under the window. */
export function LayoutStats({ layout, metrics }: { layout: Layout; metrics: WindowMetrics }) {
  const ratio = layout.available > 0 ? layout.maxWidth / layout.available : 0;
  const over = ratio > 1;
  const lines = layout.lines.length;
  const maxLines = layout.maxLines ?? metrics.maxLines;
  return (
    <div className="gp-stats small">
      <div className="gp-bar-row">
        <div className="gp-bar" role="meter" aria-label="가장 긴 줄 폭" aria-valuemin={0} aria-valuemax={layout.available} aria-valuenow={Math.round(layout.maxWidth)}>
          <div className={`gp-bar-fill${over ? ' over' : ''}`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
        </div>
        <span className={`mono${over ? ' warn-text' : ' sub'}`} data-testid="width-text">{`${Math.round(layout.maxWidth)} / ${layout.available}px`}</span>
      </div>
      <div className="row-between">
        <span className={lines > maxLines ? 'warn-text mono' : 'sub mono'}>{`${lines} / ${maxLines}줄`}</span>
        {layout.missingGlyphs > 0 && <span className="warn-text">{`이 폰트에 없는 글자 ${layout.missingGlyphs}개`}</span>}
      </div>
    </div>
  );
}

/** What the game preview needs to draw one line: the window, its layout, colours and font. */
export interface PreviewLayout {
  state: PreviewState | null;
  layout: Layout | null;
  palette: string[];
  family: string | null;
}

/**
 * Lays out the text in the game's message window, again 150ms after it stops changing. One call serves both
 * the item tab's preview and the large stage, so the two never disagree and typing asks main once.
 */
export function usePreviewLayout(unitId: string, text: string): PreviewLayout {
  const state = usePreviewState();
  const gameKey = useApp().snapshot?.meta.gameDir ?? '';
  const palette = usePalette(gameKey);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [family, setFamily] = useState<string | null>(null);
  const fontPath = state && !state.fontMissing ? state.settings.fontPath : null;

  useEffect(() => {
    if (!fontPath) return;
    let alive = true;
    const t = setTimeout(() => {
      window.api.preview.layout(unitId, text === '' ? undefined : text)
        .then((l) => { if (alive) setLayout(l); }, () => { if (alive) setLayout(null); });
    }, LAYOUT_DELAY);
    return () => { alive = false; clearTimeout(t); };
  }, [unitId, text, fontPath, state]);

  useEffect(() => {
    setFamily(null);
    if (!fontPath) return;
    let alive = true;
    ensureFontFace(fontPath).then((f) => { if (alive) setFamily(f); }, () => undefined);
    return () => { alive = false; };
  }, [fontPath]);

  return { state, layout, palette, family };
}

/** No font picked, the font file gone, or nothing to show yet; null when the window can be drawn. */
export function previewProblem(preview: PreviewLayout): React.ReactNode {
  const { state } = preview;
  if (state && !state.settings.fontPath) {
    return (
      <div className="gp-empty">
        <span className="sub small">게임 폰트를 고르면 실제 폭으로 볼 수 있어요</span>
        <button type="button" className="btn small-btn" onClick={() => useApp.openFontPicker()}>폰트 고르기</button>
      </div>
    );
  }
  if (state?.fontMissing) {
    return (
      <div className="gp-empty">
        <span className="warn-text small">고른 폰트 파일을 찾을 수 없어요</span>
        <button type="button" className="btn small-btn" onClick={() => useApp.openFontPicker()}>폰트 고르기</button>
      </div>
    );
  }
  return null;
}

/** "Game screen preview" on the item tab: the edited text laid out in the game's message window. */
export function GamePreview({ preview, big, onBig }: { preview: PreviewLayout; big?: boolean; onBig?: () => void }) {
  const { state, layout, palette, family } = preview;
  const problem = previewProblem(preview);
  return (
    <section className="field game-preview" aria-label="게임 화면 미리보기">
      <div className="row-between">
        <span className="label">게임 화면 미리보기</span>
        {onBig && <button type="button" className="btn ghost small-btn gp-big-btn" aria-pressed={big ?? false} onClick={onBig}>크게 보며 고치기</button>}
      </div>
      {problem ?? (state && layout && (
        <>
          <MessageWindow layout={layout} metrics={state.metrics} palette={palette} family={family} />
          <LayoutStats layout={layout} metrics={state.metrics} />
        </>
      ))}
      <span className="hint">{MIMIC_NOTE}</span>
    </section>
  );
}

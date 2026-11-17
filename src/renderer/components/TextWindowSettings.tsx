import { useEffect, useState } from 'react';
import { TEXT_WINDOW_LABEL, TEXT_WINDOWS, type RewrapReport, type RewrapScope, type TextWindow, type TextWindowInfo } from '../../shared/api';
import { num } from '../format';
import { usePreviewState } from '../preview/usePreview';
import { SetRow } from './ui';

/** "한글 약 n자" for a line width, or null without a font. */
export function hangulChars(width: number, hangulWidth: number | null): number | null {
  return hangulWidth && hangulWidth > 0 ? Math.floor(width / hangulWidth) : null;
}

/** The question asked before a rewrap, from its plan (null when there is nothing to fix). */
export function rewrapQuestion(plan: RewrapReport, what: string): string | null {
  if (plan.fixed === 0) return null;
  const rest = plan.unfixable > 0 ? ` 자동으로 못 고치는 ${num(plan.unfixable)}줄은 그대로 둬요.` : '';
  return `${what ? `${what} ` : ''}창을 넘는 ${num(plan.fixed)}줄의 줄바꿈을 다시 맞출까요? 글자는 그대로 두고 줄을 나누는 자리만 옮겨요.${rest} 작업 기록에서 한 번에 취소할 수 있어요.`;
}

/** What is said after a rewrap (or when there was nothing to do). */
export function rewrapNote(r: RewrapReport): string {
  const head = r.fixed > 0 ? `${num(r.fixed)}줄의 줄바꿈을 다시 맞췄어요` : '줄바꿈으로 고칠 줄이 없어요';
  return r.unfixable > 0 ? `${head}. 못 고친 ${num(r.unfixable)}줄은 "창 넘침"에서 문장을 줄여 주세요` : head;
}

/**
 * Asks with the plan's numbers, then rewraps. Returns the note to show, or null when the user said no.
 * Shared by the settings card and the button above the text table.
 */
export async function confirmAndRewrap(scope: RewrapScope, what: string): Promise<string | null> {
  const plan = await window.api.project.rewrapPlan(scope);
  const question = rewrapQuestion(plan, what);
  if (question === null) return rewrapNote(plan);
  if (!window.confirm(question)) return null;
  return rewrapNote(await window.api.project.rewrap(scope));
}

function NumberField({ id, label, value, placeholder, onSave }: { id: string; label: string; value: number | undefined; placeholder: number; onSave(v: number | null): void }) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  useEffect(() => { setText(value === undefined ? '' : String(value)); }, [value]);
  const commit = () => {
    const raw = text.trim();
    const n = Number(raw);
    const next = raw === '' || !Number.isFinite(n) || n <= 0 ? null : Math.round(n);
    if ((next ?? undefined) === value) return setText(value === undefined ? '' : String(value));
    onSave(next);
  };
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="input mono" inputMode="numeric" placeholder={String(placeholder)} value={text}
        onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />
    </div>
  );
}

function WindowRow({ w, info, onError }: { w: TextWindow; info: TextWindowInfo; onError(m: string): void }) {
  const label = TEXT_WINDOW_LABEL[w];
  const save = (change: { width?: number | null; maxLines?: number | null }) => {
    window.api.preview.setWindow(w, change).catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)));
  };
  const chars = hangulChars(info.limit.width, info.hangulWidth);
  const hasOverride = info.override.width !== undefined || info.override.maxLines !== undefined;
  // A settings row: the window and how many characters fit on the left, its two numbers and the reset on the right.
  return (
    <SetRow name={label} className="tw-row" role="group" aria-label={label} desc={
      <span className="small tw-chars" data-testid={`tw-${w}-chars`}>
        {chars === null ? '폰트를 고르면 글자 수가 보여요' : `한글 약 ${num(chars)}자`}
        {w === 'message' && <span className="sub">{` · 얼굴 그림이 있으면 ${num(Math.max(0, info.limit.width - info.faceIndent))}px`}</span>}
      </span>
    }>
      <NumberField id={`tw-${w}-width`} label="한 줄 너비(px)" value={info.override.width} placeholder={info.detected.width} onSave={(v) => save({ width: v })} />
      <NumberField id={`tw-${w}-lines`} label="줄 수" value={info.override.maxLines} placeholder={info.detected.maxLines} onSave={(v) => save({ maxLines: v })} />
      <button type="button" className="btn ghost small-btn" disabled={!hasOverride} aria-label={`${label} 기준 지우기`}
        onClick={() => save({ width: null, maxLines: null })}>감지한 값으로</button>
    </SetRow>
  );
}

/** Settings card: each game window's line width and line count, and the rewrap of every line that does not fit. */
export function TextWindowSettings() {
  const state = usePreviewState();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!state?.windows) return null;
  const windows = state.windows;
  const fontReady = !!state.settings.fontPath && !state.fontMissing;
  const rewrap = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const n = await confirmAndRewrap({}, '');
      if (n !== null) setNote(n);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card settings-card" aria-labelledby="set-text-windows">
      <span id="set-text-windows" className="card-title">창 크기와 줄바꿈</span>
      <span className="hint">대사창과 아이템·스킬 설명창은 너비와 줄 수가 달라요. 비워 두면 게임에서 읽은 값(흐린 글자)을 써요.</span>
      <div className="set-list">
        {TEXT_WINDOWS.map((w) => <WindowRow key={w} w={w} info={windows[w]} onError={setError} />)}
        <SetRow name="창을 넘는 줄" desc={<>
          {fontReady ? '글자는 그대로 두고 줄을 나누는 자리만 옮겨요.' : <span className="sub small">게임 폰트를 고르면 쓸 수 있어요</span>}
          {note && <span className="mute small" role="status">{note}</span>}
        </>}>
          <button type="button" className="btn" disabled={!fontReady || busy} onClick={() => void rewrap()}>줄바꿈 다시 맞추기</button>
        </SetRow>
      </div>
      {error && <span className="err-text small" role="alert">{error}</span>}
    </section>
  );
}

import { useEffect, useRef, useState } from 'react';
import type { PromptKind } from '../../shared/api';
import { useApp } from '../state';
import { ScreenHead, Seg } from './ui';

const SAVE_DELAY = 800;

const KINDS: { kind: PromptKind; label: string; what: string }[] = [
  { kind: 'translate', label: '전체 번역', what: '앱에서 번역을 맡길 때 묶음마다 모델이 받는 글이에요.' },
  { kind: 'review', label: '검수', what: '"번역 전체 검수" 때 묶음마다 모델이 받는 글이에요.' },
  { kind: 'export', label: '내보내기', what: '내보내기 파일의 instructions 에 그대로 들어가는 글이에요.' },
];

/** Saving trims the text here and there; a reload that differs only in blank space must not replace what is being typed. */
const loose = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The whole instruction text of each kind, shown and edited as it is sent. */
export function GuideView() {
  const { glossary } = useApp();
  const [kind, setKind] = useState<PromptKind>('translate');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const latest = useRef({ kind, value });
  latest.current = { kind, value };

  const save = (k: PromptKind, text: string | null) =>
    useApp.setPromptText(k, text).then(() => setError(null), (e) => setError(e instanceof Error ? e.message : String(e)));

  useEffect(() => {
    if (pending.current) return;
    let stale = false;
    void useApp.promptText(kind).then((t) => {
      if (!stale && !pending.current) setValue((cur) => (loose(cur) === loose(t) ? cur : t));
    });
    return () => { stale = true; };
  }, [kind, glossary]);

  useEffect(() => {
    if (!pending.current) return;
    const t = setTimeout(() => {
      if (!pending.current) return;
      pending.current = false;
      void save(kind, value);
    }, SAVE_DELAY);
    return () => clearTimeout(t);
  }, [value]);

  // Leaving the screen before the delay must not lose the last edit.
  useEffect(() => () => {
    if (pending.current) void useApp.setPromptText(latest.current.kind, latest.current.value);
  }, []);

  const flush = async () => {
    if (!pending.current) return;
    pending.current = false;
    await save(kind, value);
  };
  const show = async (next: PromptKind) => {
    if (next === kind) return;
    await flush();
    setValue('');
    setKind(next);
  };
  const resetText = async () => {
    if (!window.confirm('이 탭의 글을 처음 문구로 되돌릴까요? 태그 사이의 지침 본문은 그대로 남아요.')) return;
    pending.current = false;
    await save(kind, null);
    setValue(await useApp.promptText(kind));
  };
  const resetGuide = async () => {
    if (!window.confirm('지침 본문을 기본 지침으로 되돌릴까요? 지금 본문은 사라져요.')) return;
    await flush();
    await useApp.setStyleGuide(await useApp.defaultStyleGuide());
    setValue(await useApp.promptText(kind));
  };

  const info = KINDS.find((k) => k.kind === kind)!;
  const edited = glossary?.prompts?.[kind] !== undefined;
  const title = `${info.label}에 보내는 글`;
  return (
    <div className="glossary">
      <ScreenHead title="번역 지침" desc="여기 보이는 글 전체가 그대로 전달돼요. 프로그램이 뒤에서 더 붙이는 문구는 없어요." />
      <div className="row-gap">
        <Seg label="지침 종류">
          {KINDS.map((k) => (
            <button key={k.kind} type="button" aria-pressed={kind === k.kind} className={kind === k.kind ? 'on' : ''}
              onClick={() => void show(k.kind)}>{k.label}</button>
          ))}
        </Seg>
        <span className="sub small">{info.what}</span>
      </div>
      {error && <span className="err-text" role="alert">{error}</span>}
      <section className="card">
        <div className="card-head row-between">
          <span className="card-title">{title}{edited && <span className="tag">고친 문구 사용 중</span>}</span>
          <div className="row-gap">
            <button type="button" className="btn ghost small-btn" disabled={!edited} onClick={() => void resetText()}>처음 문구로 되돌리기</button>
            <button type="button" className="btn ghost small-btn" onClick={() => void resetGuide()}>지침 본문을 기본 지침으로</button>
          </div>
        </div>
        <div className="pad">
          <label htmlFor="guide-text" className="sr-only">{title}</label>
          <textarea id="guide-text" className="textbox edit guide" rows={30} value={value} spellCheck={false}
            onChange={(e) => { pending.current = true; setValue(e.target.value); }} />
          <span className="hint">고치면 잠시 뒤 저장돼요.</span>
          <span className="hint">{'<번역 지침> 과 </번역 지침> 사이는 지침 본문이에요. 세 탭과 채팅, 용어집 초안이 같이 쓰니 어느 탭에서 고쳐도 모두 바뀌어요. 그 밖의 글은 이 탭에만 적용돼요.'}</span>
          <span className="hint">"형식 규칙:" 아래 줄들은 손대지 않으면 용어집 화면의 형식 규칙 값을 따라 바뀌어요. 한 글자라도 고치면 고친 대로 굳어요.</span>
          {kind === 'translate' && <span className="hint">맨 끝의 "previous 가 있으면…" 줄은 게임 업데이트로 원문이 바뀐 문장이 든 묶음에만 붙어요.</span>}
          {kind !== 'export' && <span className="hint">입력·출력을 설명하는 부분을 크게 바꾸면 모델의 답을 읽지 못할 수 있어요. 그 묶음은 오류로 넘어가고 번역표는 그대로예요. "처음 문구로 되돌리기"로 복구해요.</span>}
          {kind === 'export' && <span className="hint">"돌려줄 형식"을 바꾸면 돌려받은 파일을 "외부 번역 가져오기"가 읽지 못할 수 있어요.</span>}
        </div>
      </section>
    </div>
  );
}

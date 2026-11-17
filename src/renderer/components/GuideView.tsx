import { CheckIcon, PencilIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { PromptKind } from '../../shared/api';
import { codeSpans, guideLines, splitGuide, type GuideBlock } from '../guideBlocks';
import { ICON } from '../icons';
import { useApp } from '../state';
import { ScreenHead, Seg } from './ui';

const SAVE_DELAY = 800;

const KINDS: { kind: PromptKind; label: string; what: string; sent: string }[] = [
  { kind: 'translate', label: '전체 번역', what: '앱에서 번역을 맡길 때 묶음마다 모델이 받는 글이에요.', sent: '번역 묶음마다 함께 보내요' },
  { kind: 'review', label: '검수', what: '"번역 전체 검수" 때 묶음마다 모델이 받는 글이에요.', sent: '검수 묶음마다 함께 보내요' },
  { kind: 'export', label: '내보내기', what: '내보내기 파일의 instructions 에 그대로 들어가는 글이에요.', sent: '내보내기 파일에 들어가요' },
];

const count = (n: number) => n.toLocaleString('ko-KR');

function Inline({ text }: { text: string }) {
  return <>{codeSpans(text).map((p, i) => (p.code ? <code key={i} className="g-code">{p.text}</code> : <span key={i}>{p.text}</span>))}</>;
}

/** One block as text to read: rules as a list with their labels standing out, instead of a wall of lines. */
function BlockBody({ block }: { block: GuideBlock }) {
  const lines = guideLines(block);
  if (lines.length === 0) return <p className="mute small g-empty">비어 있어요</p>;
  return (
    <div className="g-read">
      {lines.map((l, i) => {
        if (l.type === 'gap') return <span key={i} className="g-gap" aria-hidden="true" />;
        if (l.type === 'tag') return <code key={i} className="g-tag">{l.text}</code>;
        if (l.type === 'para') return <p key={i}><Inline text={l.text} /></p>;
        return (
          <p key={i} className={`g-rule${l.depth === 1 ? ' sub-rule' : ''}`}>
            {l.key !== null && <b className="g-key">{l.key}</b>}
            <span><Inline text={l.text} /></span>
          </p>
        );
      })}
    </div>
  );
}

/** A block of the text: read by default, turned into an edit box of just that block on request. */
function Block({ block, index, editing, onEdit, onDone, onChange }: {
  block: GuideBlock; index: number; editing: boolean; onEdit: () => void; onDone: () => void; onChange: (text: string) => void;
}) {
  const quiet = block.kind !== 'section';
  // What is typed lives here while the box is open. The whole text is cut again on every keystroke, and a box fed
  // from that cut would lose a line break typed at its end (it reads as the gap between blocks).
  const [draft, setDraft] = useState('');
  useEffect(() => { if (editing) setDraft(block.text.replace(/\s+$/, '')); }, [editing]);
  return (
    <section id={`guide-block-${index}`} className={`g-block${quiet ? ' quiet' : ''}${editing ? ' editing' : ''}`} aria-label={block.title}>
      <header className="g-head">
        <h3>{block.title}</h3>
        <span className="mono small mute">{`${count(block.text.trim().length)}자`}</span>
        <span className="grow" />
        {editing
          ? <button type="button" className="btn soft small-btn" onClick={onDone}><CheckIcon {...ICON} />다 고쳤어요</button>
          : <button type="button" className="btn ghost small-btn" aria-label={`${block.title} 고치기`} onClick={onEdit}><PencilIcon {...ICON} />고치기</button>}
      </header>
      {block.kind === 'outro' && !editing && <p className="hint g-note">모델이 받을 것과 돌려줄 것을 설명하는 부분이에요. 크게 바꾸면 답을 읽지 못할 수 있어요.</p>}
      {editing
        ? <textarea className="textbox edit g-box" aria-label={`${block.title} 본문`} autoFocus spellCheck={false}
            rows={Math.min(28, Math.max(4, draft.split('\n').length + 1))} value={draft} onChange={(e) => { setDraft(e.target.value); onChange(e.target.value); }} />
        : <BlockBody block={block} />}
    </section>
  );
}

/** Saving trims the text here and there; a reload that differs only in blank space must not replace what is being typed. */
const loose = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The whole instruction text of each kind, shown and edited as it is sent. */
export function GuideView() {
  const { glossary } = useApp();
  const [kind, setKind] = useState<PromptKind>('translate');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** split: the text cut at its headings and drawn to read. whole: the one edit box, for changes across blocks. */
  const [mode, setMode] = useState<'split' | 'whole'>('split');
  /**
   * The block being edited, with the text around it as it was when the box opened. Typing rebuilds the whole text
   * as before + box + after, so what is typed can never run into the next block's heading or the closing tag,
   * whatever the new cut of the text looks like.
   */
  const [editing, setEditing] = useState<{ index: number; before: string; after: string } | null>(null);
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
    setEditing(null);
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

  const boxRef = useRef<HTMLTextAreaElement>(null);
  /** Puts the caret on a heading and scrolls the box so the heading is near the top. */
  const goTo = (at: number, line: number) => {
    const box = boxRef.current;
    if (!box) return;
    box.focus();
    box.setSelectionRange(at, at);
    const lh = parseFloat(getComputedStyle(box).lineHeight) || 24;
    box.scrollTop = Math.max(0, line * lh - lh);
  };
  const blocks = splitGuide(value);
  const edit = (text: string) => { pending.current = true; setValue(text); };
  const startEdit = (i: number) => {
    const b = blocks[i];
    const end = b.at + b.text.length;
    const tail = /\s*$/.exec(b.text)![0];
    // A block that ends the text has no line break after it; any other keeps at least one.
    setEditing({ index: i, before: value.slice(0, b.at), after: (tail || (end < value.length ? '\n' : '')) + value.slice(end) });
  };
  /** Headings typed into the open box make new blocks; those are still inside the box, so they are not drawn twice. */
  const inOpenBox = (b: GuideBlock, i: number) =>
    editing !== null && i !== editing.index && b.at > editing.before.length && b.at < value.length - editing.after.length;
  /** In the split view the way to a block is to bring it into view; in the whole box, to put the caret on it. */
  const visit = (i: number) => {
    if (mode === 'whole') goTo(blocks[i].at, blocks[i].line);
    else document.getElementById(`guide-block-${i}`)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
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
        <span className="grow" />
        <Seg label="보기 방식">
          <button type="button" aria-pressed={mode === 'split'} className={mode === 'split' ? 'on' : ''} onClick={() => setMode('split')}>나눠 보기</button>
          <button type="button" aria-pressed={mode === 'whole'} className={mode === 'whole' ? 'on' : ''} onClick={() => { setEditing(null); setMode('whole'); }}>통째로 고치기</button>
        </Seg>
      </div>
      {error && <span className="err-text" role="alert">{error}</span>}
      <div className="guide-cols">
        {/* The text is long and read by section: its own headings make the way around it. */}
        <nav className="guide-toc" aria-label="차례">
          <span className="label">차례</span>
          {blocks.every((b) => b.kind !== 'section') && <span className="mute small">## 제목이 없어요</span>}
          {blocks.map((b, i) => (
            <button key={`${b.line}-${b.title}`} type="button" className={`toc-item${b.kind !== 'section' ? ' quiet' : ''}`} aria-label={b.title} onClick={() => visit(i)}>
              <span>{b.title}</span><span className="mono mute">{count(b.text.trim().length)}</span>
            </button>
          ))}
        </nav>
        <section className="card guide-card">
          <div className="card-head row-between">
            <span className="card-title">{title}{edited && <span className="tag">고친 문구 사용 중</span>}</span>
            <span className="mono small sub">{`약 ${count(value.length)}자 · ${info.sent}`}</span>
          </div>
          <div className="guide-body">
            {mode === 'whole' ? (
              <>
                <label htmlFor="guide-text" className="sr-only">{title}</label>
                <textarea id="guide-text" ref={boxRef} className="textbox edit guide" rows={30} value={value} spellCheck={false}
                  onChange={(e) => edit(e.target.value)} />
              </>
            ) : (
              <div className="g-blocks">
                {blocks.map((b, i) => !inOpenBox(b, i) && (
                  <Block key={i} block={b} index={i} editing={editing?.index === i}
                    onEdit={() => startEdit(i)} onDone={() => setEditing(null)} onChange={(t) => editing && edit(editing.before + t + editing.after)} />
                ))}
              </div>
            )}
            <div className="row-gap">
              <span className="hint">고치면 잠시 뒤 저장돼요.</span>
              <span className="grow" />
              <button type="button" className="btn ghost small-btn" disabled={!edited} onClick={() => void resetText()}>처음 문구로 되돌리기</button>
              <button type="button" className="btn ghost small-btn" onClick={() => void resetGuide()}>지침 본문을 기본 지침으로</button>
            </div>
            <details className="guide-help">
              <summary className="small">고칠 때 알아 둘 것</summary>
              <span className="hint">{'<번역 지침> 과 </번역 지침> 사이는 지침 본문이에요. 세 탭과 채팅, 용어집 초안이 같이 쓰니 어느 탭에서 고쳐도 모두 바뀌어요. 그 밖의 글은 이 탭에만 적용돼요.'}</span>
              <span className="hint">"형식 규칙:" 아래 줄들은 손대지 않으면 용어집 화면의 형식 규칙 값을 따라 바뀌어요. 한 글자라도 고치면 고친 대로 굳어요.</span>
              {kind === 'translate' && <span className="hint">맨 끝의 "previous 가 있으면…" 줄은 게임 업데이트로 원문이 바뀐 문장이 든 묶음에만 붙어요.</span>}
              {kind !== 'export' && <span className="hint">입력·출력을 설명하는 부분을 크게 바꾸면 모델의 답을 읽지 못할 수 있어요. 그 묶음은 오류로 넘어가고 번역표는 그대로예요. "처음 문구로 되돌리기"로 복구해요.</span>}
              {kind === 'export' && <span className="hint">"돌려줄 형식"을 바꾸면 돌려받은 파일을 "외부 번역 가져오기"가 읽지 못할 수 있어요.</span>}
            </details>
          </div>
        </section>
      </div>
    </div>
  );
}

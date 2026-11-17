import { ArrowUpIcon, CheckIcon, CircleCheckIcon, ImageIcon, ImagePlusIcon, ListIcon, SquareIcon, SquarePenIcon, TerminalIcon, Undo2Icon, UsersIcon, WandSparklesIcon, XIcon, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import type { ChatImage, Row } from '../../shared/api';
import { num } from '../format';
import { ICON } from '../icons';
import { eventActions, useApp, type ChatMessage } from '../state';
import { Inkdrop, useInkState } from './Inkdrop';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES = 4;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

type Attachment = ChatImage & { url: string };

/** Short instructions over the input. A press only puts the words in the box: sending (and spending tokens) stays the user's. */
const QUICK: { label: string; text: string; needsLine: boolean }[] = [
  { label: '이 줄 다듬기', text: '이 줄을 더 자연스럽게 다듬어 줘', needsLine: true },
  { label: '말투 맞추기', text: '인물마다 말투가 한결같은지 살피고 어긋난 줄을 맞춰 줘', needsLine: false },
  { label: '더 짧게', text: '이 줄을 창에 맞게 더 짧게 줄여 줘', needsLine: true },
  { label: '용어 확인', text: '용어집과 어긋나게 번역된 줄이 있는지 찾아 줘', needsLine: false },
];

/** Examples on the first-open screen; a press puts the words in the box. */
const EXAMPLES: { icon: LucideIcon; text: string }[] = [
  { icon: WandSparklesIcon, text: '이 줄 좀 더 장난스럽게' },
  { icon: UsersIcon, text: '이 인물의 말투를 처음부터 끝까지 맞춰 줘' },
  { icon: ImageIcon, text: '이 스크린샷에서 글자가 넘치는 곳 찾아 줘' },
];

/** Changed lines a result card spells out before "외 n줄". */
const RESULT_LINES = 2;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('파일을 읽을 수 없습니다'));
    r.readAsDataURL(file);
  });
}

/** Characters of the source the undo note shows. */
const UNDO_NOTE_CHARS = 20;

/** Source on one line, cut to UNDO_NOTE_CHARS with '…', so the note says which line came back. */
function clipSource(text: string): string {
  const chars = [...text.replace(/[ \t]*\r?\n[ \t]*/g, ' ')];
  return chars.length > UNDO_NOTE_CHARS ? `${chars.slice(0, UNDO_NOTE_CHARS).join('')}…` : chars.join('');
}

function filesOf(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const fromFiles = dt.files ? Array.from(dt.files) : [];
  if (fromFiles.length > 0) return fromFiles;
  return Array.from(dt.items ?? []).filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter((f): f is File => f !== null);
}

/** One-line description of a tool call, e.g. '검색 · "記録"', '수정 · Items · 1'. */
export function toolLabel(name: string, input: unknown, rowsById: Record<string, Row>): string {
  const inp = (input ?? {}) as { query?: unknown; id?: unknown };
  const where = () => {
    const id = String(inp.id ?? '');
    return rowsById[id]?.location ?? id;
  };
  switch (name) {
    case 'search_units': return `검색 · "${String(inp.query ?? '')}"`;
    case 'get_unit': return `읽음 · ${where()}`;
    case 'set_translation': return `수정 · ${where()}`;
    case 'set_status': return `상태 변경 · ${where()}`;
    case 'undo_last': return '되돌림';
    case 'list_actions': return '작업 기록 봄';
    case 'cancel_action': return '행동 취소';
    case 'project_status': return '상태 확인';
    default: return name;
  }
}

type ToolMessage = Extract<ChatMessage, { kind: 'tool' }>;

/**
 * The thread as turns: each of my messages, and what came back to it (text, tool calls, errors) as one block beside
 * the helper. Tool calls next to each other become one list of steps.
 */
type Piece = { kind: 'steps'; tools: ToolMessage[] } | { kind: 'text'; text: string } | { kind: 'error'; text: string };
type Turn = { kind: 'user'; m: Extract<ChatMessage, { kind: 'user' }> } | { kind: 'reply'; pieces: Piece[]; tools: ToolMessage[] };

function turnsOf(messages: ChatMessage[]): Turn[] {
  const out: Turn[] = [];
  for (const m of messages) {
    if (m.kind === 'user') {
      out.push({ kind: 'user', m });
      continue;
    }
    let reply = out.at(-1);
    if (!reply || reply.kind !== 'reply') {
      reply = { kind: 'reply', pieces: [], tools: [] };
      out.push(reply);
    }
    const last = reply.pieces.at(-1);
    if (m.kind === 'tool') {
      reply.tools.push(m);
      if (last?.kind === 'steps') last.tools.push(m);
      else reply.pieces.push({ kind: 'steps', tools: [m] });
    } else if (m.kind === 'assistant') {
      reply.pieces.push({ kind: 'text', text: m.text });
    } else {
      reply.pieces.push({ kind: 'error', text: m.text });
    }
  }
  return out;
}

/** The lines a reply changed: successful set_translation calls, one per line, with the last text written. */
function fixesOf(tools: ToolMessage[]): { id: string; target: string }[] {
  const byId = new Map<string, string>();
  for (const t of tools) {
    const inp = t.input as { id?: unknown; target?: unknown } | null;
    if (t.name !== 'set_translation' || !t.done || t.isError || typeof inp?.id !== 'string') continue;
    byId.delete(inp.id);
    byId.set(inp.id, typeof inp.target === 'string' ? inp.target : '');
  }
  return [...byId].map(([id, target]) => ({ id, target }));
}

/** Tool calls as steps down a line: the running one spins and its words shimmer, a finished one gets a check. */
function Steps({ tools, busy, rowsById }: { tools: ToolMessage[]; busy: boolean; rowsById: Record<string, Row> }) {
  return (
    <ol className="steps">
      {tools.map((m) => {
        const state = m.done ? (m.isError ? 'err' : 'ok') : busy ? 'run' : 'stop';
        const label = toolLabel(m.name, m.input, rowsById);
        const cls = m.isError ? 'err-text' : m.name === 'set_translation' && m.done ? 'accent-text' : '';
        const id = (m.input as { id?: unknown } | null)?.id;
        return (
          <li key={m.id} className={`step ${state}`}>
            <span className="step-dot" aria-hidden="true">
              {state === 'ok' && <CheckIcon size={11} strokeWidth={3} />}
              {state === 'err' && <XIcon size={11} strokeWidth={3} />}
            </span>
            {m.name === 'set_translation' && typeof id === 'string'
              ? <button type="button" className={`tool-line link ${cls}`} onClick={() => void useApp.selectRow(id)}>{label}</button>
              : <span className={`tool-line ${cls}`}>{label}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * "n줄을 고쳤어요" after a reply that changed lines: a few of the new texts, the changed lines in the table, and (on the
 * latest reply) taking the whole turn back. A chat turn is logged as one action, so the undo cancels that action;
 * when something else was logged after it, it says so instead of cancelling the wrong one.
 */
function ResultCard({ fixes, latest, rowsById, onNote }: { fixes: { id: string; target: string }[]; latest: boolean; rowsById: Record<string, Row>; onNote: (t: string) => void }) {
  const [undone, setUndone] = useState(false);
  const title = `${num(fixes.length)}줄을 고쳤어요`;
  const undo = async () => {
    await useApp.loadHistory();
    const newest = useApp.get().history?.[0];
    if (!newest || newest.origin !== 'chat' || newest.undoneAt !== undefined) {
      onNote('그 뒤에 다른 변경이 있어요. 작업 기록에서 되돌려 주세요');
      return;
    }
    await useApp.cancelAction(newest.id);
    setUndone(true);
  };
  return (
    <section className="res" aria-label={title}>
      <div className="res-head"><CircleCheckIcon {...ICON} />{title}</div>
      {fixes.slice(0, RESULT_LINES).map((f) => (
        <div key={f.id} className="res-row">
          <span className="mono mute small">{rowsById[f.id]?.location ?? f.id}</span>
          <ins>{f.target}</ins>
        </div>
      ))}
      {fixes.length > RESULT_LINES && <div className="res-row mute small">{`외 ${num(fixes.length - RESULT_LINES)}줄`}</div>}
      <div className="res-foot">
        <button type="button" className="mini" onClick={() => useApp.showRows(fixes.map((f) => f.id))}><ListIcon size={13} aria-hidden="true" />바뀐 줄 보기</button>
        {latest && (
          <button type="button" className="mini" disabled={undone} title="이 대답이 고친 줄을 모두 그 전으로 되돌려요. 작업 기록에 남아요."
            onClick={() => void undo()}><Undo2Icon size={13} aria-hidden="true" />{undone ? '되돌렸어요' : '되돌리기'}</button>
        )}
      </div>
    </section>
  );
}

function UserBubble({ m }: { m: Extract<ChatMessage, { kind: 'user' }> }) {
  return (
    <div className="bubble">
      {m.attached && <span className="tag">{`붙은 항목 · ${m.attached}`}</span>}
      {m.images.length > 0 && (
        <div className="thumbs">
          {m.images.map((img, i) => <img key={i} className="thumb" alt={`보낸 이미지 ${i + 1}`} src={`data:${img.mediaType};base64,${img.base64}`} />)}
        </div>
      )}
      {m.text && <span className="pre">{m.text}</span>}
    </div>
  );
}

export function ChatPanel() {
  const { chat, attachedId, rowsById, settings } = useApp();
  const attachedEvent = useApp().attachedEvent ?? null;
  const chatDraft = useApp().chatDraft ?? null;
  useEffect(() => {
    const d = eventActions.takeChatDraft();
    if (d !== null) setText(d);
  }, [chatDraft]);
  const [text, setText] = useState('');
  const [images, setImages] = useState<Attachment[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [undoNote, setUndoNote] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const msgRef = useRef<HTMLTextAreaElement>(null);
  const countRef = useRef(0); // attached + being read; authoritative for the 4-image limit
  const attached = attachedId ? rowsById[attachedId] : undefined;
  const u = chat.usage;
  const total = u.input + u.output + u.cacheRead + u.cacheCreate;
  const ink = useInkState(chat.busy);
  const turns = useMemo(() => turnsOf(chat.messages), [chat.messages]);

  // Ctrl+V of an image works anywhere while the chat tab is open.
  const addRef = useRef<(files: File[]) => Promise<void>>(async () => undefined);
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = filesOf(e.clipboardData);
      if (files.length > 0) {
        e.preventDefault();
        void addRef.current(files);
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages]);

  const addFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setProblem(null);
    for (const f of files) {
      if (!(IMAGE_TYPES as readonly string[]).includes(f.type)) { setProblem('PNG, JPEG, WebP 이미지만 보낼 수 있어요'); continue; }
      if (f.size > MAX_IMAGE_BYTES) { setProblem('이미지가 너무 큽니다(최대 5MB)'); continue; }
      if (countRef.current >= MAX_IMAGES) { setProblem(`이미지는 한 번에 ${MAX_IMAGES}장까지 보낼 수 있어요`); continue; }
      countRef.current++; // reserve the slot before the async read
      try {
        const url = await readAsDataUrl(f);
        const img: Attachment = { mediaType: f.type as ChatImage['mediaType'], base64: url.slice(url.indexOf(',') + 1), url };
        setImages((cur) => [...cur, img]);
      } catch (e) {
        countRef.current--;
        setProblem(e instanceof Error ? e.message : String(e));
      }
    }
  };
  addRef.current = addFiles;

  const send = () => {
    if (chat.busy) return;
    const t = text.trim();
    if (!t && images.length === 0) return;
    void eventActions.sendChat(t, images.map(({ mediaType, base64 }) => ({ mediaType, base64 })));
    setText('');
    setImages([]);
    countRef.current = 0;
    setProblem(null);
    setUndoNote(null);
    useApp.attach(null);
  };
  /** Puts words in the box (a quick instruction or an example) without sending them. */
  const fill = (words: string) => {
    setText(words);
    msgRef.current?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    void addFiles(filesOf(e.dataTransfer));
  };

  const undo = async () => {
    const ids = await useApp.undoChat();
    const what = (id: string) => {
      const r = rowsById[id];
      return r ? `${r.location} · ${clipSource(r.source)}` : id;
    };
    setUndoNote(ids.length > 0 ? `되돌렸어요 · ${ids.map(what).join(', ')}` : '되돌릴 채팅 변경이 없어요');
  };
  const lastReply = turns.findLastIndex((t) => t.kind === 'reply');

  return (
    <div className="chat" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <div className="chat-head">
        <Inkdrop state={ink} size={32} />
        <div className="chat-id">
          <div className="chat-name-row">
            <span className="chat-name">먹물이</span>
            <span className="mono mute small nowrap">{`이번 대화 ${num(total)} 토큰`}</span>
          </div>
          <label htmlFor="model" className="sr-only">채팅 모델</label>
          <select id="model" className="chat-model" value={settings?.chatModel ?? ''} onChange={(e) => void useApp.setChatModel(e.target.value)}>
            {(settings?.models ?? []).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
        <button type="button" className="ico" aria-label="방금 변경 되돌리기" disabled={chat.busy} onClick={() => void undo()}
          title="채팅이 마지막에 고친 한 줄을 되돌립니다. 작업 기록에 남아 다시 취소할 수 있습니다."><Undo2Icon {...ICON} /></button>
        <button type="button" className="ico" aria-label="새 대화" title="새 대화" onClick={() => void useApp.resetChat()}><SquarePenIcon {...ICON} /></button>
      </div>
      <ClaudeGuide />
      <div className="chat-list" ref={listRef} aria-live="polite">
        {chat.messages.length === 0 && (
          <div className="chat-empty">
            <Inkdrop state={ink} size={84} />
            <h3>무엇을 도와드릴까요?</h3>
            <p>게임 텍스트에 대해 물어보거나 스크린샷을 붙여 넣어 보세요.</p>
            <div className="chat-cards">
              {EXAMPLES.map((x) => (
                <button key={x.text} type="button" onClick={() => fill(x.text)}>
                  <span className="tile" aria-hidden="true"><x.icon {...ICON} /></span><span>{x.text}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => {
          if (t.kind === 'user') return <UserBubble key={i} m={t.m} />;
          const live = chat.busy && i === turns.length - 1;
          const fixes = live ? [] : fixesOf(t.tools);
          return (
            <div key={i} className="ai">
              <Inkdrop size={26} still />
              <div className="ai-body">
                {t.pieces.map((p, k) => (p.kind === 'steps'
                  ? <Steps key={k} tools={p.tools} busy={live} rowsById={rowsById} />
                  : p.kind === 'text'
                    ? <div key={k} className="answer pre">{p.text}</div>
                    : <div key={k} className="err-line err-text" role="alert">{p.text}</div>))}
                {fixes.length > 0 && <ResultCard fixes={fixes} latest={i === lastReply} rowsById={rowsById} onNote={setUndoNote} />}
              </div>
            </div>
          );
        })}
        {undoNote && <span className="sub small">{undoNote}</span>}
      </div>
      <div className="chat-input">
        <div className="sugg" role="group" aria-label="빠른 지시">
          {QUICK.map((q) => (
            <button key={q.label} type="button" disabled={q.needsLine && !attached}
              title={q.needsLine && !attached ? '항목 탭에서 줄을 붙이면 쓸 수 있어요' : q.text} onClick={() => fill(q.text)}>{q.label}</button>
          ))}
        </div>
        <div className="comp">
          <AttachedImage />
          {(attached || attachedEvent || images.length > 0) && (
            <div className="attached">
              {attachedEvent && (
                <span className="att">
                  {`이벤트 · ${attachedEvent.label}`}
                  <button type="button" className="x" aria-label="붙은 이벤트 떼기" onClick={() => eventActions.attachEvent(null)}>×</button>
                </span>
              )}
              {attached && (
                <span className="att">
                  {`붙은 항목 · ${attached.location}`}
                  <button type="button" className="x" aria-label="붙은 항목 떼기" onClick={() => useApp.attach(null)}>×</button>
                </span>
              )}
              {images.map((img, i) => (
                <span key={i} className="thumb-wrap">
                  <img className="thumb" src={img.url} alt={`첨부 ${i + 1}`} />
                  <button type="button" className="x" aria-label={`첨부 ${i + 1} 빼기`} onClick={() => { countRef.current--; setImages((cur) => cur.filter((_, n) => n !== i)); }}>×</button>
                </span>
              ))}
            </div>
          )}
          <label htmlFor="msg" className="sr-only">메시지</label>
          <textarea id="msg" ref={msgRef} className="msg" rows={1} placeholder="먹물이에게 말하기" value={text}
            onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
          <div className="comp-row">
            <button type="button" className="ico" aria-label="스크린샷 첨부" title="스크린샷 첨부" onClick={() => fileRef.current?.click()}><ImagePlusIcon {...ICON} /></button>
            <input ref={fileRef} type="file" accept={IMAGE_TYPES.join(',')} multiple hidden
              onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
            <span className="grow" />
            {chat.busy
              ? <button type="button" className="send stop" aria-label="멈추기" onClick={() => void useApp.stopChat()}><SquareIcon size={13} fill="currentColor" aria-hidden="true" /></button>
              : <button type="button" className="send" aria-label="보내기" onClick={send}><ArrowUpIcon size={17} strokeWidth={2.4} aria-hidden="true" /></button>}
          </div>
        </div>
        {problem && <span className="err-text small" role="alert">{problem}</span>}
      </div>
    </div>
  );
}

/** A picture attached from the image screen. */
function AttachedImage() {
  const { attachedImage } = useApp();
  if (!attachedImage) return null;
  return (
    <div className="attached">
      <span className="att">
        {`이미지: ${attachedImage}`}
        <button type="button" className="x" aria-label="붙은 그림 떼기" onClick={() => useApp.detachImage()}>×</button>
      </span>
    </div>
  );
}

/** How to install and log in to the Claude CLI, shown while the chat cannot work (for people who got the app without the CLI). */
function ClaudeGuide() {
  const { claudeStatus } = useApp();
  useEffect(() => { if (claudeStatus === undefined) void useApp.checkClaude(); }, [claudeStatus]);
  if (!claudeStatus || (claudeStatus.found && claudeStatus.loggedIn !== false)) return null;
  return (
    <section className="cli-guide" aria-label="Claude CLI 안내">
      <div className="cli-top">
        <span className="tile warn" aria-hidden="true"><TerminalIcon {...ICON} /></span>
        <span>채팅과 자동 번역은 Claude CLI 가 있어야 해요. 본인의 Claude 구독으로 동작해요.</span>
      </div>
      <ol className="cli-steps">
        {!claudeStatus.found && <li value={1}>터미널에서 <code className="mono">winget install Anthropic.ClaudeCode</code></li>}
        <li value={2}>터미널에서 <code className="mono">claude</code> 를 실행해 로그인</li>
      </ol>
      <div className="cli-foot">
        <span className="sub small">추출, 손 번역, 빌드는 CLI 없이도 돼요.</span>
        <button type="button" className="btn small-btn" onClick={() => void useApp.checkClaude()}>다시 확인</button>
      </div>
    </section>
  );
}

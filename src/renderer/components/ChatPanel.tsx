import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import type { ChatImage, Row } from '../../shared/api';
import { num } from '../format';
import { useApp, type ChatMessage } from '../state';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES = 4;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

type Attachment = ChatImage & { url: string };

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('파일을 읽을 수 없습니다'));
    r.readAsDataURL(file);
  });
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
    case 'project_status': return '상태 확인';
    default: return name;
  }
}

function Message({ m, rowsById }: { m: ChatMessage; rowsById: Record<string, Row> }) {
  switch (m.kind) {
    case 'user':
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
    case 'assistant':
      return <div className="answer pre">{m.text}</div>;
    case 'tool': {
      const label = toolLabel(m.name, m.input, rowsById);
      const cls = m.isError ? 'err-text' : m.name === 'set_translation' && m.done ? 'accent-text' : '';
      if (m.name === 'set_translation' && typeof (m.input as { id?: unknown })?.id === 'string') {
        const id = (m.input as { id: string }).id;
        return <button type="button" className={`tool-line link ${cls}`} onClick={() => void useApp.selectRow(id)}>{label}</button>;
      }
      return <span className={`tool-line ${cls}`}>{label}</span>;
    }
    case 'error':
      return <div className="err-line err-text" role="alert">{m.text}</div>;
  }
}

export function ChatPanel() {
  const { chat, attachedId, rowsById, settings } = useApp();
  const attachedEvent = useApp().attachedEvent ?? null;
  const [text, setText] = useState('');
  const [images, setImages] = useState<Attachment[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [undoNote, setUndoNote] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const countRef = useRef(0); // attached + being read; authoritative for the 4-image limit
  const attached = attachedId ? rowsById[attachedId] : undefined;
  const u = chat.usage;
  const total = u.input + u.output + u.cacheRead + u.cacheCreate;

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
    setUndoNote(ids.length > 0 ? `되돌렸어요 · ${ids.map((id) => rowsById[id]?.location ?? id).join(', ')}` : '되돌릴 채팅 변경이 없어요');
  };

  return (
    <div className="chat" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <div className="chat-tools">
        <button type="button" className="btn ghost small-btn" onClick={() => void useApp.resetChat()}>새 대화</button>
        <button type="button" className="btn ghost small-btn" disabled={chat.busy} onClick={() => void undo()}>방금 변경 되돌리기</button>
      </div>
      <div className="chat-list" ref={listRef} aria-live="polite">
        {chat.messages.length === 0 && <span className="sub small">게임 텍스트에 대해 물어보거나 스크린샷을 붙여 넣어 보세요.</span>}
        {chat.messages.map((m, i) => <Message key={i} m={m} rowsById={rowsById} />)}
        {undoNote && <span className="sub small">{undoNote}</span>}
      </div>
      <div className="chat-input">
        {(attached || attachedEvent || images.length > 0) && (
          <div className="attached">
            {attachedEvent && (
              <>
                <span className="tag">{`이벤트 · ${attachedEvent.label}`}</span>
                <button type="button" className="x" aria-label="붙은 이벤트 떼기" onClick={() => eventActions.attachEvent(null)}>×</button>
              </>
            )}
            {attached && (
              <>
                <span className="tag">{`붙은 항목 · ${attached.location}`}</span>
                <button type="button" className="x" aria-label="붙은 항목 떼기" onClick={() => useApp.attach(null)}>×</button>
              </>
            )}
            {images.map((img, i) => (
              <span key={i} className="thumb-wrap">
                <img className="thumb" src={img.url} alt={`첨부 ${i + 1}`} />
                <button type="button" className="x" aria-label={`첨부 ${i + 1} 빼기`} onClick={() => { countRef.current--; setImages((cur) => cur.filter((_, n) => n !== i)); }}>×</button>
              </span>
            ))}
          </div>
        )}
        <div className="chat-row">
          <button type="button" className="icon-btn" aria-label="스크린샷 첨부" onClick={() => fileRef.current?.click()}>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 16l5-5 4 4 3-3 6 6" /></svg>
          </button>
          <input ref={fileRef} type="file" accept={IMAGE_TYPES.join(',')} multiple hidden
            onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
          <label htmlFor="msg" className="sr-only">메시지</label>
          <textarea id="msg" className="input msg" rows={1} placeholder="이 줄 좀 더 장난스럽게" value={text}
            onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
          {chat.busy
            ? <button type="button" className="icon-btn stop" aria-label="멈추기" onClick={() => void useApp.stopChat()}>
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
              </button>
            : <button type="button" className="icon-btn send" aria-label="보내기" onClick={send}>
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5" /><path d="M6 11l6-6 6 6" /></svg>
              </button>}
        </div>
        {problem && <span className="err-text small" role="alert">{problem}</span>}
        <div className="chat-foot">
          <label htmlFor="model" className="sub small">채팅 모델</label>
          <select id="model" className="input" value={settings?.chatModel ?? ''} onChange={(e) => void useApp.setChatModel(e.target.value)}>
            {(settings?.models ?? []).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <span className="mono sub small nowrap">{`이번 대화 ${num(total)} 토큰`}</span>
        </div>
      </div>
    </div>
  );
}

// ---- plan 5 ----
import { eventActions } from '../state';

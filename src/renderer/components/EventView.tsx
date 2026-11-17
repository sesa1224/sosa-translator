import { MousePointerClickIcon } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { describeCommand } from '../../core/events/describe';
import { emptyNames } from '../../core/events/nameFormat';
import type { EventCommand, EventDetail, EventFileInfo, EventLine, EventListInfo, EventRef, ListOp, Patch, PathSeg, UsageTarget } from '../../shared/api';
import { eventActions, useApp } from '../state';
import { EmptyState, ScreenHead, Tile } from './ui';

const NO_NAMES = emptyNames();
const samePath = (a: PathSeg[] | null | undefined, b: PathSeg[] | null | undefined) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The kinds of commands the small insert form makes; anything else goes through the chat. */
const INSERT_KINDS = [
  ['switch-on', '스위치 켜기'], ['switch-off', '스위치 끄기'], ['var-set', '변수에 값 넣기'], ['var-add', '변수에 더하기'],
  ['self-on', '셀프 스위치 켜기'], ['self-off', '셀프 스위치 끄기'], ['transfer', '장소 이동'], ['fade-out', '화면 페이드아웃'],
  ['fade-in', '화면 페이드인'], ['erase-picture', '그림 지우기'], ['common-event', '커먼이벤트 실행'],
] as const;
type InsertKind = (typeof INSERT_KINDS)[number][0];
interface InsertValues { id: number; value: number; self: string; map: number; x: number; y: number }

function commandFor(kind: InsertKind, v: InsertValues, indent: number): EventCommand {
  const c = (code: number, parameters: unknown[]): EventCommand => ({ code, indent, parameters });
  switch (kind) {
    case 'switch-on': return c(121, [v.id, v.id, 0]);
    case 'switch-off': return c(121, [v.id, v.id, 1]);
    case 'var-set': return c(122, [v.id, v.id, 0, 0, v.value]);
    case 'var-add': return c(122, [v.id, v.id, 1, 0, v.value]);
    case 'self-on': return c(123, [v.self, 0]);
    case 'self-off': return c(123, [v.self, 1]);
    case 'transfer': return c(201, [0, v.map, v.x, v.y, 0, 0]);
    case 'fade-out': return c(221, []);
    case 'fade-in': return c(222, []);
    case 'erase-picture': return c(235, [v.id]);
    case 'common-event': return c(117, [v.id]);
  }
}

/** Which number the form asks for, by kind. */
const ID_LABEL: Partial<Record<InsertKind, string>> = {
  'switch-on': '스위치 번호', 'switch-off': '스위치 번호', 'var-set': '변수 번호', 'var-add': '변수 번호', 'erase-picture': '그림 번호', 'common-event': '커먼이벤트 번호',
};

type DisplayRow =
  | { kind: 'orig'; line: EventLine; deleted: boolean }
  | { kind: 'add'; key: string; text: string; indent: number };

/** The described lines with a patch's edits laid over them (added lines in place, removed ones marked). */
function overlay(lines: EventLine[], ops: ListOp[] | null): DisplayRow[] {
  if (!ops) return lines.map((line) => ({ kind: 'orig', line, deleted: false }));
  const inserts = new Map<number, EventCommand[]>();
  const removed = new Set<number>();
  const replaced = new Map<number, EventCommand[]>();
  for (const op of ops) {
    if (op.op === 'insert') inserts.set(op.after, [...(inserts.get(op.after) ?? []), ...op.commands]);
    else if (op.op === 'delete') removed.add(op.at);
    else replaced.set(op.at, op.commands);
  }
  let n = 0;
  const added = (cmds: EventCommand[] | undefined): DisplayRow[] =>
    (cmds ?? []).map((c) => ({ kind: 'add', key: `add-${n++}`, text: describeCommand(c, NO_NAMES), indent: c.indent }));
  const out: DisplayRow[] = [...added(inserts.get(-1))];
  for (const line of lines) {
    const covered = Array.from({ length: line.count }, (_, k) => line.index + k);
    out.push({ kind: 'orig', line, deleted: covered.some((i) => removed.has(i) || replaced.has(i)) });
    for (const i of covered) out.push(...added(replaced.get(i)), ...added(inserts.get(i)));
  }
  return out;
}

const NAME_RE = /(스위치|변수|커먼이벤트) (\d+)( \[[^\]]*\])?/g;
const TARGET_TYPE: Record<string, UsageTarget['type']> = { 스위치: 'switch', 변수: 'variable', 커먼이벤트: 'commonEvent' };

/** A line's text with switch, variable and common event names as buttons that look up where they are used. */
function LineText({ text, onName }: { text: string; onName(t: UsageTarget, title: string): void }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(NAME_RE)) {
    if (m.index! > last) parts.push(text.slice(last, m.index));
    const title = m[0];
    parts.push(
      <button key={m.index} type="button" className="ev-name" onClick={() => onName({ type: TARGET_TYPE[m[1]], id: Number(m[2]) }, title)}>{title}</button>,
    );
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function accessWord(type: UsageTarget['type'], access: EventRef['access']): string {
  if (access === 'write') return type === 'switch' ? '켬' : '바꿈';
  if (type === 'commonEvent') return '호출';
  if (type === 'picture') return '표시';
  return '조건';
}

interface FormState { mode: 'insert' | 'delete'; line: EventLine }

function EditForm({ form, patch, detail, file, listPath, onDone }: {
  form: FormState; patch: Patch | null; detail: EventDetail; file: string; listPath: PathSeg[]; onDone(): void;
}) {
  const [kind, setKind] = useState<InsertKind>('switch-on');
  const [vals, setVals] = useState<InsertValues>({ id: 1, value: 1, self: 'A', map: 1, x: 0, y: 0 });
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const num = (k: keyof InsertValues, label: string) => (
    <input type="number" className="input ev-num-input" aria-label={label} value={String(vals[k])}
      onChange={(e) => setVals({ ...vals, [k]: e.target.value === '' ? 0 : Number(e.target.value) })} />
  );
  const line = form.line;
  const ops: ListOp[] = form.mode === 'insert'
    ? [{ op: 'insert', after: line.index + line.count - 1, commands: [commandFor(kind, vals, line.indent)] }]
    : Array.from({ length: line.count }, (_, k) => ({ op: 'delete' as const, at: line.index + k }));

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      if (patch && patch.body.kind === 'event') {
        await eventActions.updatePatch(patch.id, { body: { ...patch.body, ops: [...patch.body.ops, ...ops] } });
      } else {
        const t = title.trim();
        if (!t) throw new Error('수정 제목을 입력하세요');
        await eventActions.addPatch({ title: t, body: { kind: 'event', file, listPath, baseHash: detail.hash, ops } });
      }
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ev-form" role="group" aria-label={form.mode === 'insert' ? '끼워 넣기' : '지우기'}>
      {form.mode === 'insert' ? (
        <div className="ev-form-row">
          <select className="input" aria-label="끼워 넣을 것" value={kind} onChange={(e) => setKind(e.target.value as InsertKind)}>
            {INSERT_KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          {ID_LABEL[kind] && num('id', ID_LABEL[kind]!)}
          {(kind === 'var-set' || kind === 'var-add') && num('value', '값')}
          {(kind === 'self-on' || kind === 'self-off') && (
            <select className="input" aria-label="셀프 스위치" value={vals.self} onChange={(e) => setVals({ ...vals, self: e.target.value })}>
              {['A', 'B', 'C', 'D'].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {kind === 'transfer' && <>{num('map', '맵 번호')}{num('x', 'x')}{num('y', 'y')}</>}
        </div>
      ) : (
        <span className="small">{`이 줄을 지워요: ${line.text}`}{line.count > 1 ? ` (커맨드 ${line.count}개)` : ''}</span>
      )}
      {patch
        ? <span className="sub small">{`수정 내역 '${patch.title}'에 더해요.`}</span>
        : <input className="input" aria-label="수정 제목" placeholder="수정 제목 (예: 이벤트2로 넘어가게 하기)" value={title} onChange={(e) => setTitle(e.target.value)} />}
      <div className="ev-form-row">
        <button type="button" className="btn primary small-btn" disabled={busy} onClick={() => void save()}>수정으로 기록</button>
        <button type="button" className="btn ghost small-btn" onClick={onDone}>취소</button>
        <span className="sub small">복잡한 수정은 채팅에서 말로 시키세요</span>
      </div>
      {error && <span className="err-text small" role="alert">{error}</span>}
    </div>
  );
}

/** Events read as plain lines: pick a file and an event, see where switches are used, and record small fixes. */
export function EventView() {
  const app = useApp();
  const focus = app.eventFocus ?? null;
  const patches = app.patchList?.patches ?? [];
  const statuses = app.patchList?.statuses ?? [];
  const [files, setFiles] = useState<EventFileInfo[]>([]);
  const [file, setFile] = useState<string | null>(null);
  const [events, setEvents] = useState<EventListInfo[]>([]);
  const [filter, setFilter] = useState('');
  const [sel, setSel] = useState<PathSeg[] | null>(null);
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [usage, setUsage] = useState<{ title: string; target: UsageTarget; refs: EventRef[] } | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    eventActions.files().then(setFiles, (e) => setError(errorText(e)));
    void eventActions.loadPatches();
  }, []);
  useEffect(() => {
    if (!focus) return;
    setFile(focus.file);
    setSel(focus.listPath);
    setHighlight(focus.line);
  }, [focus?.seq]);
  useEffect(() => {
    if (!file) return;
    let live = true;
    eventActions.list(file).then((l) => { if (live) setEvents(l); }, (e) => setError(errorText(e)));
    return () => { live = false; };
  }, [file]);
  useEffect(() => {
    setForm(null);
    if (!file || !sel) {
      setDetail(null);
      return;
    }
    let live = true;
    eventActions.read(file, sel).then((d) => { if (live) setDetail(d); }, (e) => setError(errorText(e)));
    return () => { live = false; };
  }, [file, JSON.stringify(sel)]);
  useEffect(() => {
    if (highlight === null) return;
    document.querySelector(`[data-line="${highlight}"]`)?.scrollIntoView?.({ block: 'center' });
  }, [detail, highlight]);

  const patch = useMemo(() => {
    const on = patches.filter((p) => p.body.kind === 'event' && p.body.file === file && samePath(p.body.listPath, sel));
    return on.find((p) => p.enabled) ?? null;
  }, [patches, file, sel]);
  const patchState = patch ? statuses.find((s) => s.id === patch.id) : undefined;
  const rows = detail ? overlay(detail.lines, patch && patch.body.kind === 'event' ? patch.body.ops : null) : [];
  const shown = events.filter((e) => !filter.trim() || e.label.toLowerCase().includes(filter.trim().toLowerCase()));
  const label = detail?.label ?? '';

  const lookUp = async (target: UsageTarget, title: string) => {
    setError(null);
    try {
      setUsage({ title, target, refs: await eventActions.usage(target) });
    } catch (e) {
      setError(errorText(e));
    }
  };
  const open = (f: string, listPath: PathSeg[], line: number | null) => {
    setFile(f);
    setSel(listPath);
    setHighlight(line);
  };

  return (
    <div className="ev-page">
      <ScreenHead title="이벤트" count={files.length > 0 ? `파일 ${files.length}개` : undefined} desc="게임 데이터를 읽기 쉬운 글로 풀어서 보여줘요. Claude도 이 형태로 읽어요." />
      {error && <span className="err-text small" role="alert">{error}</span>}
      <div className="ev-cols">
        <div className="card ev-left">
          <span className="nav-head">파일</span>
          <div className="ev-files">
            {files.map((f) => (
              <button key={f.file} type="button" className={`ev-pick${f.file === file ? ' on' : ''}`} aria-pressed={f.file === file}
                onClick={() => { setFile(f.file); setSel(null); setHighlight(null); }}>
                {`${f.label} · 이벤트 ${f.events}개`}
              </button>
            ))}
          </div>
          {file && (
            <>
              <label htmlFor="ev-filter" className="sr-only">이벤트 찾기</label>
              <input id="ev-filter" className="input" placeholder="이벤트 찾기" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <div className="ev-list">
                {shown.map((e) => (
                  <button key={e.key} type="button" className={`ev-pick${samePath(e.listPath, sel) ? ' on' : ''}`} aria-pressed={samePath(e.listPath, sel)}
                    onClick={() => { setSel(e.listPath); setHighlight(null); }}>
                    <span>{e.label}</span>
                    {e.condition && <span className="mute small ev-cond">{e.condition}</span>}
                  </button>
                ))}
                {shown.length === 0 && <span className="sub small">이벤트가 없어요</span>}
              </div>
            </>
          )}
        </div>

        <div className="card ev-main">
          {!detail ? (
            <EmptyState art={<Tile icon={MousePointerClickIcon} />} title={file ? '왼쪽에서 이벤트를 고르세요' : '왼쪽에서 파일을 고르세요'}>
              줄 아래에 끼워 넣거나 지우면 원본은 그대로 두고 수정 내역에 쌓여요.
            </EmptyState>
          ) : (
            <>
              <div className="card-head ev-head">
                <span className="card-title">{detail.label}</span>
                {detail.condition && <span className="sub small">{`조건: ${detail.condition}`}</span>}
              </div>
              <div className="ev-lines" role="list" aria-label="풀어쓴 줄">
                {rows.length === 0 && <span className="sub small ev-pad">빈 이벤트예요</span>}
                {rows.map((r) => {
                  if (r.kind === 'add') {
                    return (
                      <div key={r.key} role="listitem" className="ev-line ev-add" style={{ paddingLeft: `${12 + r.indent * 20}px` }}>
                        <span className="ev-num mono" aria-hidden="true">+</span>
                        <span className="ev-text">{`+ ${r.text}`}</span>
                      </div>
                    );
                  }
                  const l = r.line;
                  const formHere = form && form.line.index === l.index;
                  return (
                    <div key={`o-${l.index}`} role="listitem">
                      <div data-line={l.index} className={`ev-line${r.deleted ? ' ev-del' : ''}${highlight === l.index ? ' ev-hl' : ''}`}
                        style={{ paddingLeft: `${12 + l.indent * 20}px` }}>
                        <span className="ev-num mono">{l.index}</span>
                        <span className="ev-text">{r.deleted && <span aria-hidden="true">− </span>}<LineText text={l.text} onName={(t, title) => void lookUp(t, title)} /></span>
                        {!r.deleted && (
                          <span className="ev-tools">
                            <button type="button" className="btn ghost small-btn" onClick={() => setForm({ mode: 'insert', line: l })}>이 줄 아래에 끼워 넣기</button>
                            <button type="button" className="btn ghost small-btn" onClick={() => setForm({ mode: 'delete', line: l })}>이 줄 지우기</button>
                          </span>
                        )}
                      </div>
                      {formHere && file && sel && (
                        <EditForm form={form} patch={patch} detail={detail} file={file} listPath={sel} onDone={() => setForm(null)} />
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="ev-foot">
                {patch && (
                  <span className="sub small">
                    {`초록색 줄은 원본에 없던 줄이에요. 수정 내역 '${patch.title}'으로 기록됐어요.`}
                    {patchState?.state === 'conflict' && ` 지금은 충돌이라 빌드에 들어가지 않아요(${patchState.reason ?? ''}).`}
                  </span>
                )}
                <div className="grow" />
                {patch && <button type="button" className="btn ghost small-btn" onClick={() => eventActions.openPatches()}>수정 내역 보기</button>}
                <button type="button" className="btn soft small-btn" onClick={() => file && sel && eventActions.talkAboutEvent({ file, listPath: sel, label })}>채팅으로 말하기</button>
              </div>
            </>
          )}
        </div>

        {usage && (
          <section className="card ev-usage" aria-label="사용처">
            <div className="card-head">
              <span className="card-title">{`${usage.title} 를 쓰는 곳 ${usage.refs.length}`}</span>
              <button type="button" className="x" aria-label="사용처 닫기" onClick={() => setUsage(null)}>×</button>
            </div>
            <div className="ev-usage-list">
              {usage.refs.length === 0 && <span className="sub small ev-pad">쓰는 곳이 없어요</span>}
              {usage.refs.map((u, i) => (
                <button key={i} type="button" className="ev-pick" title={u.text}
                  onClick={() => open(u.file, u.listPath, u.index >= 0 ? u.index : null)}>
                  <span className="mono small">{u.label}</span>
                  <span className={`st ${u.access === 'write' ? 'st-ok' : 'st-none'}`}>{accessWord(usage.target.type, u.access)}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

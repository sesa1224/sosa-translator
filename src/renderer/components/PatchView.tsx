import { DiffIcon, PlayIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ListOp, Patch, PatchStatus, PathSeg } from '../../shared/api';
import { ICON } from '../icons';
import { usePreviewState } from '../preview/usePreview';
import { eventActions, useApp, type AttachedEvent } from '../state';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const seg = (s: PathSeg | undefined): unknown => (typeof s === 'object' && s !== null ? s.key : s);
const baseName = (p: string) => p.replace(/^.*[\\/]/, '');

/** Where a command list is, short: '맵3 이벤트12 2페이지', '커먼이벤트 4', '적 무리 2 1페이지'. */
export function shortListLabel(file: string, listPath: PathSeg[]): string {
  const map = /Map(\d+)\.json$/i.exec(file);
  if (map) return `맵${Number(map[1])} 이벤트${String(seg(listPath[1]))} ${Number(seg(listPath[3])) + 1}페이지`;
  if (/CommonEvents\.json$/i.test(file)) return `커먼이벤트 ${String(seg(listPath[0]))}`;
  if (/Troops\.json$/i.test(file)) return `적 무리 ${String(seg(listPath[0]))} ${Number(seg(listPath[2])) + 1}페이지`;
  return file;
}

function opsSummary(ops: ListOp[]): string {
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const op of ops) {
    if (op.op === 'insert') added += op.commands.length;
    else if (op.op === 'delete') removed++;
    else changed++;
  }
  const parts = [added && `줄 ${added}개 추가`, removed && `줄 ${removed}개 삭제`, changed && `줄 ${changed}개 바꿈`].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : '바뀐 줄 없음';
}

/** One line on what a patch changes and where. */
export function patchWhere(p: Patch): string {
  const b = p.body;
  switch (b.kind) {
    case 'event': return `${shortListLabel(b.file, b.listPath)} · ${opsSummary(b.ops)}`;
    case 'json': return `${baseName(b.file)} · ${b.path.map((s) => String(seg(s))).join('.')}`;
    case 'plugin': return `새 플러그인 ${b.name}.js`;
    case 'font': return `게임 폰트: ${baseName(b.fontPath)}`;
    case 'josa': return '새 플러그인 MVMZ_KoreanJosa.js';
  }
}

const eventOf = (p: Patch): AttachedEvent | null =>
  p.body.kind === 'event' ? { file: p.body.file, listPath: p.body.listPath, label: shortListLabel(p.body.file, p.body.listPath) } : null;

function StateChip({ status }: { status: PatchStatus | undefined }) {
  if (!status) return <span className="st st-none">확인 중</span>;
  if (status.state === 'applied') return <span className="st st-ok">적용됨</span>;
  if (status.state === 'disabled') return <span className="st st-none">꺼짐</span>;
  return <span className="st st-warn">{`충돌 · ${status.reason ?? '확인 필요'}`}</span>;
}

function PatchRow({ p, status }: { p: Patch; status: PatchStatus | undefined }) {
  const [title, setTitle] = useState(p.title);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setTitle(p.title), [p.title]);
  const run = async (job: () => Promise<unknown>) => {
    setError(null);
    try {
      await job();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const saveTitle = () => {
    const t = title.trim();
    if (!t || t === p.title) {
      setTitle(p.title);
      return;
    }
    void run(() => eventActions.updatePatch(p.id, { title: t }));
  };
  const ev = eventOf(p);
  return (
    <div className="patch-row" data-patch={p.id}>
      <div className="patch-main">
        <input className="patch-title" aria-label="수정 제목" value={title} onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle} onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); }} />
        <span className="mono sub small">{patchWhere(p)}</span>
        {p.note && <span className="sub small">{p.note}</span>}
        {error && <span className="err-text small" role="alert">{error}</span>}
      </div>
      <div className="patch-actions">
        <StateChip status={status} />
        <label className="check small"><input type="checkbox" checked={p.originalBug} onChange={(e) => void run(() => eventActions.updatePatch(p.id, { originalBug: e.target.checked }))} />원본 버그</label>
        <label className="check small"><input type="checkbox" role="switch" checked={p.enabled} onChange={(e) => void run(() => eventActions.updatePatch(p.id, { enabled: e.target.checked }))} />적용</label>
        {ev && <button type="button" className="btn ghost small-btn" onClick={() => eventActions.openEvents({ file: ev.file, listPath: ev.listPath, line: null })}>이벤트 보기</button>}
        {status?.state === 'conflict' && (
          <button type="button" className="btn soft small-btn" onClick={() => eventActions.askClaude(`이 수정이 충돌났어: ${p.title}`, ev)}>Claude에게 맡기기</button>
        )}
        {confirming ? (
          <>
            <button type="button" className="btn small-btn danger" onClick={() => void run(() => eventActions.removePatch(p.id))}>정말 삭제</button>
            <button type="button" className="btn ghost small-btn" onClick={() => setConfirming(false)}>취소</button>
          </>
        ) : (
          <button type="button" className="btn ghost small-btn" onClick={() => setConfirming(true)}>삭제</button>
        )}
      </div>
    </div>
  );
}

function ReportDialog({ text, onClose }: { text: string; onClose(): void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog card report-dialog" role="dialog" aria-modal="true" aria-labelledby="report-title">
        <div className="card-head">
          <span id="report-title" className="card-title">제작자 전달용 목록</span>
        </div>
        <pre className="report-text">{text}</pre>
        <div className="ev-foot">
          {copied && <span className="sub small" role="status">복사했어요</span>}
          <div className="grow" />
          <button type="button" className="btn small-btn" onClick={() => { void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => undefined); }}>복사</button>
          <button type="button" className="btn ghost small-btn" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

/** The patches: what changes the build lays over the original game, each with its state. */
export function PatchView() {
  const app = useApp();
  const list = app.patchList;
  const [report, setReport] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void eventActions.loadPatches(); }, []);
  const openReport = async () => {
    setError(null);
    try {
      setReport(await eventActions.creatorReport());
    } catch (e) {
      setError(errorText(e));
    }
  };
  const patches = list?.patches ?? [];
  return (
    <div className="ev-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">수정 내역</h1>
          <span className="sub">원본 대비 바뀐 점만 모아둔 목록이에요. 빌드할 때 원본 위에 얹어요.</span>
        </div>
        <button type="button" className="btn" onClick={() => void openReport()}>제작자 전달용 목록</button>
      </div>
      {error && <span className="err-text small" role="alert">{error}</span>}
      <JosaSection />
      <div className="card">
        {list && patches.length === 0 && <div className="ev-empty sub">아직 수정이 없어요. 이벤트 화면에서 줄을 끼워 넣거나, 채팅에서 버그를 설명해 보세요.</div>}
        {patches.map((p) => <PatchRow key={p.id} p={p} status={list?.statuses.find((s) => s.id === p.id)} />)}
      </div>
      {report !== null && <ReportDialog text={report} onClose={() => setReport(null)} />}
    </div>
  );
}

/** The particle plugin switch, with the game plugins that may get in its way. */
function JosaSection() {
  const app = useApp();
  const josa = app.patchList?.patches.find((p) => p.body.kind === 'josa') ?? null;
  const on = josa !== null && josa.enabled;
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    eventActions.josaConflicts().then((names) => { if (live) setConflicts(names); }, () => undefined);
    return () => { live = false; };
  }, [app.snapshot?.meta.current]);
  const toggle = async () => {
    setError(null);
    try {
      await eventActions.setJosa(!on);
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <section className="card settings-card" aria-labelledby="patch-josa">
      <span id="patch-josa" className="card-title">조사 자동 맞춤</span>
      <label className="check"><input type="checkbox" role="switch" checked={on} onChange={() => void toggle()} />조사 자동 맞춤 켜기</label>
      <span className="hint">%1은(는) 같은 조사를 게임이 이름을 넣은 뒤에 맞춰요</span>
      {conflicts.length > 0 && <span className="warn-text small" role="note">{`이 플러그인 때문에 조사가 안 맞을 수 있어요: ${conflicts.join(', ')}`}</span>}
      {error && <span className="err-text small" role="alert">{error}</span>}
    </section>
  );
}

/** "수정 내역 <수>" in the work menu. */
export function PatchNavButton() {
  const app = useApp();
  const count = app.patchList?.patches.length ?? 0;
  const on = app.view === 'patches';
  useEffect(() => { void eventActions.loadPatches(); }, [app.snapshot?.meta.name]);
  return (
    <button type="button" className={`nav-btn${on ? ' on' : ''}`} aria-current={on ? 'page' : undefined} onClick={() => eventActions.openPatches()}>
      <DiffIcon {...ICON} /><span>수정 내역</span>{count > 0 && <span className="mono sub small">{count}</span>}
    </button>
  );
}

/** Settings: put the chosen game font into the patch (as a font patch). */
export function FontEmbedSection() {
  const app = useApp();
  const preview = usePreviewState();
  const chosen = preview?.settings.fontPath ?? null;
  const name = preview?.settings.fontName ?? (chosen ? baseName(chosen) : null);
  const fontPatch = app.patchList?.patches.find((p) => p.body.kind === 'font') ?? null;
  const [subset, setSubset] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void eventActions.loadPatches(); }, []);
  useEffect(() => {
    if (fontPatch && fontPatch.body.kind === 'font') setSubset(fontPatch.body.subset);
  }, [fontPatch?.id, fontPatch?.body.kind === 'font' ? fontPatch.body.subset : null]);
  const on = fontPatch !== null && fontPatch.enabled;
  const run = async (job: () => Promise<unknown>) => {
    setError(null);
    try {
      await job();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const toggle = () => void run(() => eventActions.setGameFont(on ? null : chosen, subset));
  const changeSubset = (v: boolean) => {
    setSubset(v);
    if (on && fontPatch?.body.kind === 'font') void run(() => eventActions.setGameFont(fontPatch.body.kind === 'font' ? fontPatch.body.fontPath : chosen, v));
  };
  return (
    <section className="card settings-card" aria-labelledby="set-embed">
      <span id="set-embed" className="card-title">폰트를 게임에 넣기</span>
      {!chosen ? (
        <span className="hint">위에서 게임 폰트를 먼저 고르세요</span>
      ) : (
        <>
          <span>{`고른 폰트: ${name}`}</span>
          <label className="check"><input type="checkbox" role="switch" checked={on} onChange={toggle} />이 폰트를 패치에 넣기</label>
          <label className="check"><input type="checkbox" checked={subset} onChange={(e) => changeSubset(e.target.checked)} />쓰는 글자만 남겨 용량 줄이기</label>
          <span className="hint">폰트 파일이 패치에 들어가요. 배포해도 되는 폰트인지 확인하세요(본명조, 본고딕, 나눔 계열, Pretendard 등은 괜찮아요. 윈도우 기본 폰트나 유료 폰트는 안 돼요).</span>
        </>
      )}
      <LastFontEmbed />

      {error && <span className="err-text small" role="alert">{error}</span>}
    </section>
  );
}

/** "게임 실행" in the top bar: copies the game, lays the latest patch on it and starts it. */
export function GameRunButton() {
  const app = useApp();
  const g = app.game ?? { state: 'idle' as const };
  return (
    <div className="game-run">
      {g.state === 'idle' && <button type="button" className="btn" onClick={() => void eventActions.runGame()}><PlayIcon {...ICON} />게임 실행</button>}
      {g.state === 'preparing' && (
        <span className="game-state" role="status">
          <span className="mono small">{`게임 준비 중 ${g.done ?? 0} / ${g.total ?? 0}`}</span>
          {g.firstRun && <span className="sub small">시험용 사본을 만들어요. 처음 한 번은 시간이 걸려요.</span>}
        </span>
      )}
      {g.state === 'running' && (
        <span className="game-state" role="status">
          <span className="small">게임 실행 중</span>
          <button type="button" className="btn small-btn" onClick={() => void eventActions.stopGame()}>끝내기</button>
        </span>
      )}
      {app.gameError && <span className="err-text small" role="alert" title={app.gameError}>{app.gameError}</span>}
    </div>
  );
}

/** "지난 빌드: 폰트 n KB · 이 폰트에 없는 글자 k개" (warned when the font lacks characters). */
function LastFontEmbed() {
  const { fontEmbed, build } = useApp();
  useEffect(() => { void eventActions.loadFontEmbed(); }, [build.kind]);
  if (!fontEmbed) return null;
  return (
    <span className="small">
      {`지난 빌드: 폰트 ${Math.max(1, Math.round(fontEmbed.bytes / 1024)).toLocaleString('ko-KR')} KB · `}
      <span className={fontEmbed.missing > 0 ? 'warn-text' : undefined}>{`이 폰트에 없는 글자 ${fontEmbed.missing}개`}</span>
    </span>
  );
}

import { CheckIcon, ChevronDownIcon, CopyIcon, FolderOpenIcon, PencilIcon, SparklesIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { BuildDiff, BuildRecord } from '../../shared/api';
import { num } from '../format';
import { ICON } from '../icons';
import { jobActive, useApp } from '../state';
import { Inkdrop } from './Inkdrop';
import { EmptyState, ScreenHead } from './ui';

const pad = (n: number) => String(n).padStart(2, '0');
/** Scopes drawn as bars before the rest is folded into one line. */
const SCOPE_BARS = 6;

/** '2026-11-13 21:40' in local time. */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** '3일 전' for a recent build; nothing once the date itself says it better. */
function ago(iso: string): string | null {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const min = Math.floor((Date.now() - t) / 60000);
  if (min < 0) return null;
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  if (min < 60 * 24) return `${Math.floor(min / 60)}시간 전`;
  if (min < 60 * 24 * 30) return `${Math.floor(min / 60 / 24)}일 전`;
  return null;
}

const imageCount = (d: BuildDiff) => d.newImages.length + d.changedImages.length;

/** The numbers a build is judged by. A zero is drawn quiet so the eye lands on what actually changed. */
function Stats({ b }: { b: BuildRecord }) {
  const d = b.diff;
  const items: { label: string; value: number; tone?: 'new' | 'gone' }[] = d
    ? [
        { label: '새 번역', value: d.newTranslations, tone: 'new' },
        { label: '고친 번역', value: d.changedTranslations },
        ...(d.removedTranslations > 0 ? [{ label: '빠진 번역', value: d.removedTranslations, tone: 'gone' as const }] : []),
        { label: '그림', value: imageCount(d) },
        { label: '파일', value: b.files },
      ]
    : [{ label: '파일', value: b.files }];
  return (
    <div className="bv-stats">
      {items.map((i) => (
        <div key={i.label} className={`bv-stat${i.value === 0 ? ' zero' : ''}${i.tone ? ` ${i.tone}` : ''}`}>
          <b className="mono">{num(i.value)}</b>
          <span>{i.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Where the work went: one bar per scope, new lines in the accent colour and changed lines beside them. */
function Scopes({ d }: { d: BuildDiff }) {
  const rows = [...d.byScope].sort((a, b) => b.added + b.changed - (a.added + a.changed));
  if (rows.length === 0) return null;
  const max = Math.max(1, ...rows.map((s) => s.added + s.changed));
  const shown = rows.slice(0, SCOPE_BARS);
  const rest = rows.slice(SCOPE_BARS);
  return (
    <div className="bv-scopes">
      <span className="label">{d.previous === null ? '첫 빌드에 들어간 범위' : `빌드 ${d.previous} 뒤로 손댄 범위`}</span>
      {shown.map((s) => (
        <div key={s.label} className="bv-scope">
          <span className="bv-scope-name">{s.label}</span>
          <span className="bv-bar" aria-hidden="true">
            <i className="new" style={{ width: `${(s.added / max) * 100}%` }} />
            <i style={{ width: `${(s.changed / max) * 100}%` }} />
          </span>
          <span className="mono small sub">{[s.added > 0 && `새 ${num(s.added)}`, s.changed > 0 && `고침 ${num(s.changed)}`].filter(Boolean).join(' · ')}</span>
        </div>
      ))}
      {rest.length > 0 && <span className="small sub">{`그 밖에 ${rest.map((s) => s.label).join(', ')}`}</span>}
    </div>
  );
}

function Files({ d }: { d: BuildDiff }) {
  const groups: [string, string[]][] = [
    ['새 그림', d.newImages], ['바뀐 그림', d.changedImages], ['더해진 파일', d.addedFiles], ['빠진 파일', d.removedFiles],
    ...Object.entries(d.extras).flatMap(([k, x]): [string, string[]][] => [[`${k} 더함`, x.added], [`${k} 뺌`, x.removed]]),
  ];
  const filled = groups.filter(([, items]) => items.length > 0);
  const total = filled.reduce((n, [, items]) => n + items.length, 0);
  if (total === 0) return null;
  return (
    <details className="bv-more">
      <summary className="small">{`바뀐 파일 ${num(total)}개`}</summary>
      <div className="bv-details">
        {filled.map(([title, items]) => (
          <div key={title} className="field"><span className="label">{`${title} ${num(items.length)}`}</span>
            <ul className="bv-list">{items.map((f) => <li key={f} className="mono small">{f}</li>)}</ul>
          </div>
        ))}
      </div>
    </details>
  );
}

/** The patch notes: shown as the text players will read, and turned into an edit box only on request. */
function Notes({ b, model, busy }: { b: BuildRecord; model: string; busy: boolean }) {
  const [text, setText] = useState(b.notes);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => { setText(b.notes); }, [b.notes]);
  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setError(null);
    setDone(null);
    try {
      await fn();
      after?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const [title, ...body] = text.split('\n');
  return (
    <section className="bv-notes-box" aria-label={`빌드 ${b.number} 패치노트 묶음`}>
      <div className="bv-notes-head">
        <span className="label">패치노트</span>
        {done && <span className="accent-text small" role="status">{done}</span>}
        <div className="grow" />
        {!editing && (
          <>
            <button type="button" className="btn ghost small-btn" onClick={() => void run(() => navigator.clipboard.writeText(text), () => setDone('복사했어요'))}><CopyIcon {...ICON} />복사</button>
            <button type="button" className="btn ghost small-btn" aria-label="패치노트 고치기" onClick={() => { setDone(null); setEditing(true); }}><PencilIcon {...ICON} />고치기</button>
          </>
        )}
      </div>
      {editing ? (
        <>
          <textarea className="input bv-notes" aria-label={`빌드 ${b.number} 패치노트`} rows={Math.min(14, Math.max(4, text.split('\n').length + 1))}
            value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row-gap">
            <button type="button" className="btn primary small-btn" disabled={text === b.notes}
              onClick={() => void run(() => useApp.setBuildNotes(b.number, text), () => { setEditing(false); setDone('zip 안의 패치노트도 바꿨어요'); })}><CheckIcon {...ICON} />저장</button>
            <button type="button" className="btn ghost small-btn" onClick={() => { setText(b.notes); setEditing(false); }}>그만두기</button>
            <div className="grow" />
            <span className="sub small">{model}</span>
            <button type="button" className="btn soft small-btn" disabled={busy} onClick={() => void run(() => useApp.polishNotes(b.number))}><SparklesIcon {...ICON} />Claude에게 다듬기 맡기기</button>
          </div>
        </>
      ) : (
        <div className="bv-read">
          <strong>{title}</strong>
          {body.length > 0 && <p>{body.join('\n')}</p>}
        </div>
      )}
      {error && <span className="err-text small" role="alert">{error}</span>}
    </section>
  );
}

function Body({ b, model, busy }: { b: BuildRecord; model: string; busy: boolean }) {
  return (
    <>
      <Stats b={b} />
      {b.diff ? <Scopes d={b.diff} /> : <span className="sub small">이 빌드는 바뀐 점 기록이 없어요</span>}
      <Notes b={b} model={model} busy={busy} />
      {b.diff && <Files d={b.diff} />}
    </>
  );
}

function OpenFolder({ b, primary }: { b: BuildRecord; primary?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const open = () => useApp.openBuildFolder(b.number).then(() => setError(null), (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  return (
    <>
      <button type="button" className={`btn${primary ? ' primary' : ' small-btn'}`} onClick={() => void open()}><FolderOpenIcon {...ICON} />폴더 열기</button>
      {error && <span className="err-text small" role="alert">{error}</span>}
    </>
  );
}

/** The build people came for: the one to hand out. Everything about it is open. */
function LatestBuild({ b, model, busy }: { b: BuildRecord; model: string; busy: boolean }) {
  const rel = ago(b.createdAt);
  return (
    <article className="bv-latest" aria-label={`빌드 ${b.number}`}>
      <header className="bv-latest-head">
        <div className="bv-latest-title">
          <span className="bv-kicker">최신 패치</span>
          <h3>{`빌드 ${b.number}`}</h3>
          <span className="sub small">{rel ? `${rel} · ${when(b.createdAt)}` : when(b.createdAt)}</span>
        </div>
        <OpenFolder b={b} primary />
      </header>
      <Body b={b} model={model} busy={busy} />
    </article>
  );
}

/** An earlier build: one line that says what it was, opened only when someone wants to look back. */
function OlderBuild({ b, model, busy }: { b: BuildRecord; model: string; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const d = b.diff;
  const sum = d
    ? [d.newTranslations > 0 && `새 번역 ${num(d.newTranslations)}`, d.changedTranslations > 0 && `고친 번역 ${num(d.changedTranslations)}`, imageCount(d) > 0 && `그림 ${num(imageCount(d))}`].filter(Boolean).join(' · ') || '번역은 그대로'
    : `파일 ${num(b.files)}개`;
  return (
    <article className={`li bv-row${open ? ' open' : ''}`} aria-label={`빌드 ${b.number}`}>
      <button type="button" className="bv-row-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="bv-row-num">{`빌드 ${b.number}`}</span>
        <span className="mono small sub">{when(b.createdAt)}</span>
        <span className="bv-row-sum small">{sum}</span>
        <ChevronDownIcon {...ICON} className="bv-chev" />
      </button>
      {open && (
        <div className="bv-row-body">
          <Body b={b} model={model} busy={busy} />
          <div className="row-gap"><OpenFolder b={b} /></div>
        </div>
      )}
    </article>
  );
}

/** Every finished build, newest first: the newest one large and open, the earlier ones as a compact log. */
export function BuildsView() {
  const app = useApp();
  const { builds, settings, build } = app;
  useEffect(() => { void useApp.loadBuilds(); }, [build]);
  const modelId = settings?.stageModels.patchNotes ?? '';
  const model = settings?.models.find((m) => m.id === modelId)?.label ?? modelId;
  const busy = jobActive(app);
  const [latest, ...older] = builds ?? [];
  return (
    <div className="builds-view">
      <ScreenHead title="빌드 기록" count={builds && builds.length > 0 ? `${num(builds.length)}개` : undefined}
        desc="빌드할 때마다 지난 빌드와 비교한 패치노트가 자동으로 쓰여 zip 에 들어가요. 고쳐서 저장하면 zip 안의 글도 바뀌어요." />
      {builds === null && <span className="sub small">기록을 읽는 중이에요</span>}
      {builds !== null && builds.length === 0 && (
        <EmptyState art={<Inkdrop size={56} />} title="아직 만든 패치가 없어요">아직 빌드가 없어요. 위의 패치 빌드를 누르면 여기에 기록이 쌓여요.</EmptyState>
      )}
      {latest && <LatestBuild key={latest.number} b={latest} model={model} busy={busy} />}
      {older.length > 0 && (
        <section className="bv-older" aria-labelledby="bv-older-title">
          <h3 id="bv-older-title" className="bv-sec">이전 빌드</h3>
          <div className="list">
            {older.map((b) => <OlderBuild key={b.number} b={b} model={model} busy={busy} />)}
          </div>
        </section>
      )}
    </div>
  );
}

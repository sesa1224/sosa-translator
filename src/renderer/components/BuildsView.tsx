import { PackageIcon, SparklesIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { BuildRecord } from '../../shared/api';
import { num } from '../format';
import { ICON } from '../icons';
import { jobActive, useApp } from '../state';
import { Inkdrop } from './Inkdrop';
import { EmptyState, ScreenHead, Tile } from './ui';

const pad = (n: number) => String(n).padStart(2, '0');

/** '2026-11-13 21:40' in local time. */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Details({ b }: { b: BuildRecord }) {
  const d = b.diff;
  if (!d) return <span className="sub small">이 빌드는 바뀐 점 기록이 없어요</span>;
  const list = (title: string, items: string[]) => items.length > 0 && (
    <div className="field"><span className="label">{`${title} ${num(items.length)}`}</span>
      <ul className="bv-list">{items.map((f) => <li key={f} className="mono small">{f}</li>)}</ul>
    </div>
  );
  return (
    <div className="bv-details">
      <span className="small">{d.previous === null ? '첫 빌드' : `빌드 ${d.previous} 대비`}</span>
      <div className="row-gap">
        <span className="tag">{`새 번역 ${num(d.newTranslations)}`}</span>
        <span className="tag">{`고친 번역 ${num(d.changedTranslations)}`}</span>
        {d.removedTranslations > 0 && <span className="tag">{`빠진 번역 ${num(d.removedTranslations)}`}</span>}
      </div>
      {d.byScope.length > 0 && (
        <table className="bv-table small">
          <thead><tr><th>범위</th><th>새 번역</th><th>고친 번역</th></tr></thead>
          <tbody>{d.byScope.map((s) => <tr key={s.label}><td>{s.label}</td><td className="mono">{num(s.added)}</td><td className="mono">{num(s.changed)}</td></tr>)}</tbody>
        </table>
      )}
      {list('새 그림', d.newImages)}
      {list('바뀐 그림', d.changedImages)}
      {list('더해진 파일', d.addedFiles)}
      {list('빠진 파일', d.removedFiles)}
      {Object.entries(d.extras).map(([k, x]) => (
        <div key={k}>{list(`${k} 더함`, x.added)}{list(`${k} 뺌`, x.removed)}</div>
      ))}
    </div>
  );
}

function BuildCard({ b, model, busy }: { b: BuildRecord; model: string; busy: boolean }) {
  const [text, setText] = useState(b.notes);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setText(b.notes); }, [b.notes]);
  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setError(null);
    try {
      await fn();
      after?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <article className="li bv-card" aria-label={`빌드 ${b.number}`}>
      <div className="bv-head">
        <Tile icon={PackageIcon} />
        <span className="card-title">{`빌드 ${b.number} · ${when(b.createdAt)} · 파일 ${num(b.files)}개`}</span>
      </div>
      <textarea className="input bv-notes" aria-label={`빌드 ${b.number} 패치노트`} rows={Math.min(14, Math.max(4, text.split('\n').length + 1))}
        value={text} onChange={(e) => { setText(e.target.value); setSaved(false); }} />
      <div className="row-gap">
        <button type="button" className="btn small-btn" disabled={text === b.notes} onClick={() => void run(() => useApp.setBuildNotes(b.number, text), () => setSaved(true))}>저장</button>
        {saved && <span className="accent-text small">zip 안의 패치노트도 바꿨어요</span>}
        <button type="button" className="btn soft small-btn" disabled={busy} onClick={() => void run(() => useApp.polishNotes(b.number))}><SparklesIcon {...ICON} />Claude에게 다듬기 맡기기</button>
        <span className="sub small">{model}</span>
        <div className="grow" />
        <button type="button" className="btn ghost small-btn" onClick={() => void run(() => useApp.openBuildFolder(b.number))}>폴더 열기</button>
      </div>
      {error && <span className="err-text small" role="alert">{error}</span>}
      <details className="bv-more">
        <summary className="small">바뀐 점 자세히</summary>
        <Details b={b} />
      </details>
    </article>
  );
}

/** Every finished build with its patch notes, newest first. */
export function BuildsView() {
  const app = useApp();
  const { builds, settings, build } = app;
  useEffect(() => { void useApp.loadBuilds(); }, [build]);
  const modelId = settings?.stageModels.patchNotes ?? '';
  const model = settings?.models.find((m) => m.id === modelId)?.label ?? modelId;
  return (
    <div className="builds-view">
      <ScreenHead title="빌드 기록" count={builds && builds.length > 0 ? `${num(builds.length)}개` : undefined}
        desc="빌드할 때마다 지난 빌드와 비교한 패치노트가 자동으로 쓰여 zip 에 들어가요. 고쳐서 저장하면 zip 안의 글도 바뀌어요." />
      {builds === null && <span className="sub small">기록을 읽는 중이에요</span>}
      {builds !== null && builds.length === 0 && (
        <EmptyState art={<Inkdrop size={56} />} title="아직 만든 패치가 없어요">아직 빌드가 없어요. 위의 패치 빌드를 누르면 여기에 기록이 쌓여요.</EmptyState>
      )}
      {builds !== null && builds.length > 0 && (
        <div className="list">
          {builds.map((b) => <BuildCard key={b.number} b={b} model={model} busy={jobActive(app)} />)}
        </div>
      )}
    </div>
  );
}

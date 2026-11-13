import { num, pct } from '../format';
import { useApp } from '../state';
import { TitleField } from './TitleField';

export function TopBar() {
  const { snapshot, build } = useApp();
  if (!snapshot) return null;
  const { stats, meta } = snapshot;
  const done = stats.total - stats.untranslated;
  const good = stats.needsReview + stats.approved;
  const p = pct(done, stats.total);
  return (
    <header className="topbar">
      <div className="brand">
        <div className="logo" aria-hidden="true">譯</div>
        <div className="brand-text">
          <span className="brand-title">{snapshot.gameTitle ?? meta.name}</span>
          <TitleField />
          <span className="mono sub small">{meta.engine} · {meta.current} · 일본어 → 한국어 · {meta.name}</span>
        </div>
      </div>
      <div className="progress">
        <span className="mono sub small nowrap">{`${num(done)} / ${num(stats.total)}줄 · ${p}%`}</span>
        <div className="bar" aria-hidden="true">
          <div style={{ width: `${(good / Math.max(1, stats.total)) * 100}%`, background: 'var(--accent)' }} />
          <div style={{ width: `${(stats.error / Math.max(1, stats.total)) * 100}%`, background: 'var(--warn)' }} />
        </div>
      </div>
      <div className="top-actions">
        <button type="button" className="btn" onClick={() => void useApp.closeProject()}>프로젝트 닫기</button>
        <button type="button" className="btn primary" disabled={build.kind === 'running'} onClick={() => void useApp.build()}>패치 빌드</button>
      </div>
    </header>
  );
}

/** Result line of the last patch build, under the top bar. */
export function BuildBanner() {
  const { build } = useApp();
  if (build.kind === 'idle') return null;
  if (build.kind === 'running') return <div className="banner" role="status">패치를 만드는 중…</div>;
  if (build.kind === 'failed') {
    return (
      <div className="banner err" role="alert">
        <span>{build.message}</span>
        <button type="button" className="btn ghost small-btn" onClick={() => useApp.dismissBuild()}>닫기</button>
      </div>
    );
  }
  const r = build.result;
  return (
    <div className="banner ok" role="status">
      <span>{`패치를 만들었습니다 · 파일 ${r.files.length}개 · 오류로 뺀 항목 ${r.skippedErrors}개`}</span>
      <span className="mono sub small">{r.zipPath}</span>
      <NotesLink />
      <div className="grow" />
      <button type="button" className="btn small-btn" onClick={() => void useApp.showInFolder(r.zipPath)}>폴더 열기</button>
      <button type="button" className="btn ghost small-btn" onClick={() => useApp.dismissBuild()}>닫기</button>
    </div>
  );
}

// ---- plan 7 ----
/** Opens the build history, where the notes of the build just made are. */
function NotesLink() {
  return <button type="button" className="btn ghost small-btn" onClick={() => useApp.setView('builds')}>패치노트 보기</button>;
}

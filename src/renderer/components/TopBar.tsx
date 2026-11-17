import { PackageIcon } from 'lucide-react';
import { num, pct } from '../format';
import { ICON } from '../icons';
import { updateActions, useApp } from '../state';
import { GameRunButton } from './PatchView';
import { TitleField } from './TitleField';
import { WindowControls } from './WindowControls';

export function TopBar() {
  const { snapshot, build } = useApp();
  if (!snapshot) return null;
  const { stats, meta } = snapshot;
  const done = stats.total - stats.untranslated;
  const good = (stats.translated ?? 0) + stats.needsReview + stats.approved;
  const p = pct(done, stats.total);
  return (
    // The whole bar drags the window (and double-click maximizes); buttons and inputs opt out in theme.css.
    <header className="topbar">
      <div className="logo" aria-hidden="true">譯</div>
      <div className="brand">
        <span className="brand-title">{snapshot.gameTitle ?? meta.name}</span>
        <TitleField />
        <span className="mono mute small nowrap" title={`${meta.engine} · ${meta.current} · 일본어 → 한국어 · ${meta.name}`}>{`${meta.engine} · ${meta.current}`}</span>
      </div>
      {/* Room for the command search in the middle of the bar. */}
      <div className="grow" />
      <span className="mono sub small nowrap">{`${num(done)} / ${num(stats.total)}줄 · ${p}%`}</span>
      <div className="top-actions">
        <button type="button" className="btn" onClick={() => void useApp.closeProject()}>프로젝트 닫기</button>
        <button type="button" className="btn" onClick={() => updateActions.open()}>새 버전 가져오기</button>
        <GameRunButton />
        <button type="button" className="btn primary" disabled={build.kind === 'running'} onClick={() => void useApp.build()}><PackageIcon {...ICON} />패치 빌드</button>
      </div>
      <WindowControls />
      <div className="tb-progress" aria-hidden="true">
        <i style={{ width: `${(good / Math.max(1, stats.total)) * 100}%`, background: 'var(--accent)' }} />
        <i style={{ width: `${(stats.error / Math.max(1, stats.total)) * 100}%`, background: 'var(--warn)' }} />
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

/** Opens the build history, where the notes of the build just made are. */
function NotesLink() {
  return <button type="button" className="btn ghost small-btn" onClick={() => useApp.setView('builds')}>패치노트 보기</button>;
}

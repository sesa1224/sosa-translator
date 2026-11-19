import { DownloadIcon, RefreshCwIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AppUpdateState } from '../../shared/api';
import { ICON } from '../icons';
import { useApp } from '../state';
import { SetRow } from './ui';

// "앱 업데이트" is the app replacing itself with a newer release. It is kept apart from the game update
// (UpdateDialog, UpdateView), which brings in a new version of the game being translated.

/** What the row says under the version; the colour follows the meaning (new = info, done = ok, blocked = err). */
function stateText(s: AppUpdateState): ReactNode {
  switch (s.kind) {
    case 'unsupported': return <span className="mute">설치한 앱에서만 확인할 수 있어요</span>;
    case 'idle': return '새 버전이 있으면 받아 두고, 다시 시작할 때 설치해요.';
    case 'checking': return <span role="status">확인하는 중…</span>;
    case 'available':
      return (
        <span className="appup-progress">
          <span className="info-text" role="status">{`새 버전 ${s.version} 받는 중 ${s.percent}%`}</span>
          <span className="prog appup-bar" role="progressbar" aria-label="받는 중" aria-valuemin={0} aria-valuemax={100} aria-valuenow={s.percent}>
            <i style={{ width: `${s.percent}%` }} />
          </span>
        </span>
      );
    case 'downloaded': return <span className="ok-text" role="status">{`새 버전 ${s.version} 을 받았어요`}</span>;
    case 'upToDate': return <span className="ok-text" role="status">최신 버전이에요</span>;
    case 'error': return <span className="err-text" role="alert">{s.message}</span>;
  }
}

/**
 * The app's version and its update: a quiet "업데이트 확인", or, once a version is downloaded, the button that
 * installs it. primaryInstall: whether that button may be the screen's main one (not on the project list,
 * whose main button is opening a project).
 */
export function AppUpdateRow({ primaryInstall = true }: { primaryInstall?: boolean }) {
  const { appUpdate } = useApp();
  if (!appUpdate) return null;
  const s = appUpdate.state;
  const busy = s.kind === 'checking' || s.kind === 'available';
  return (
    <SetRow name={`앱 버전 ${appUpdate.version}`} desc={stateText(s)} className="appup-row">
      {s.kind === 'downloaded'
        ? (
          <button type="button" className={`btn${primaryInstall ? ' primary' : ''}`} onClick={() => void useApp.installAppUpdate()}>
            <DownloadIcon {...ICON} />다시 시작해서 설치
          </button>
        )
        : (
          <button type="button" className="btn" disabled={busy || s.kind === 'unsupported'} onClick={() => void useApp.checkAppUpdate()}>
            <RefreshCwIcon {...ICON} />업데이트 확인
          </button>
        )}
    </SetRow>
  );
}

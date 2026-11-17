import { useApp } from '../state';

// Drawn as thin strokes so they look like the system buttons at any theme colour (no icon font in the app).
const ICON = { width: 10, height: 10, viewBox: '0 0 10 10', fill: 'none', stroke: 'currentColor', strokeWidth: 1, 'aria-hidden': true } as const;

/** Minimize, maximize/restore and close for the frameless window; sits at the right end of a title bar. */
export function WindowControls() {
  const { windowMaximized } = useApp();
  return (
    <div className="wc">
      <button type="button" aria-label="창 최소화" title="최소화" onClick={() => void useApp.minimizeWindow()}>
        <svg {...ICON}><path d="M0 5.5h10" /></svg>
      </button>
      <button type="button" aria-label={windowMaximized ? '창 이전 크기로' : '창 최대화'} title={windowMaximized ? '이전 크기로' : '최대화'}
        onClick={() => void useApp.toggleMaximizeWindow()}>
        {windowMaximized
          ? <svg {...ICON}><path d="M2.5 2.5V.5h7v7h-2" /><rect x=".5" y="2.5" width="7" height="7" /></svg>
          : <svg {...ICON}><rect x=".5" y=".5" width="9" height="9" /></svg>}
      </button>
      <button type="button" className="wc-close" aria-label="창 닫기" title="닫기" onClick={() => void useApp.closeWindow()}>
        <svg {...ICON}><path d="M.5.5l9 9M9.5.5l-9 9" /></svg>
      </button>
    </div>
  );
}

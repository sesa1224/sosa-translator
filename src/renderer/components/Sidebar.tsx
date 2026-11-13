import { num, pct } from '../format';
import { useApp } from '../state';

export function Sidebar() {
  const { snapshot, view, query, glossary } = useApp();
  if (!snapshot) return null;
  const undecided = glossary ? glossary.terms.filter((t) => t.status === 'provisional').length : 0;
  return (
    <nav className="sidebar" aria-label="작업 메뉴">
      <span className="nav-head">작업</span>
      <button type="button" className={`nav-btn${view === 'text' ? ' on' : ''}`} aria-current={view === 'text' ? 'page' : undefined}
        onClick={() => useApp.setView('text')}>
        <span>텍스트</span><span className="mono sub small">{num(snapshot.stats.untranslated)}</span>
      </button>
      <button type="button" className={`nav-btn${view === 'glossary' ? ' on' : ''}`} aria-current={view === 'glossary' ? 'page' : undefined}
        onClick={() => useApp.setView('glossary')}>
        <span>용어집</span>{undecided > 0 && <span className="mono warn-text small" title="결정 필요">{num(undecided)}</span>}
      </button>
      <button type="button" className={`nav-btn${view === 'settings' ? ' on' : ''}`} aria-current={view === 'settings' ? 'page' : undefined}
        onClick={() => useApp.setView('settings')}>
        <span>설정</span>
      </button>
      <button type="button" className={`nav-btn${view === 'decisions' ? ' on' : ''}`} aria-current={view === 'decisions' ? 'page' : undefined}
        onClick={() => useApp.openDecisions()}>
        <span>판단 필요</span>{(snapshot.stats.undecided ?? 0) > 0 && <span className="mono warn-text small" title="정할 묶음의 줄 수">{num(snapshot.stats.undecided ?? 0)}</span>}
      </button>
      {/* plan 5: events */}
      <button type="button" className={`nav-btn${mainView(useApp.get()) === 'events' ? ' on' : ''}`} aria-current={mainView(useApp.get()) === 'events' ? 'page' : undefined}
        onClick={() => eventActions.openEvents()}>
        <span>이벤트</span>
      </button>

      <span className="nav-head spaced">범위별 진행률</span>
      {snapshot.scopes.map((s) => {
        const p = pct(s.done, s.total);
        const on = query.file === s.file;
        return (
          <button key={s.file} type="button" className={`scope${on ? ' on' : ''}`} aria-pressed={on}
            title={s.file} onClick={() => { useApp.setView('text'); useApp.toggleScope(s.file); }}>
            <span className="scope-line"><span>{s.label}</span><span className="mono sub small">{p}%</span></span>
            <span className="thin-bar" aria-hidden="true"><span style={{ width: `${p}%` }} /></span>
          </button>
        );
      })}

      <div className="grow" />
      <div className="note-box">
        <span>원본 게임은 수정되지 않음</span>
        <span className="mute small">번역과 수정은 따로 쌓았다가 빌드할 때 합쳐요.</span>
      </div>
    </nav>
  );
}

// ---- plan 5 ----
import { eventActions, mainView } from '../state';

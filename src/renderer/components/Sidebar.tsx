import { BookOpenIcon, CircleHelpIcon, GitBranchIcon, HistoryIcon, ImageIcon, PackageIcon, PenLineIcon, RefreshCwIcon, SlidersHorizontalIcon, TextIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { num, pct } from '../format';
import { ICON } from '../icons';
import { eventActions, updateActions, useApp } from '../state';
import { PatchNavButton } from './PatchView';
import { NavCount } from './ui';

/**
 * One highlight behind the picked menu item that slides to the next pick, instead of each item lighting up on its
 * own. Placed after every render from where the picked item really is (items come and go, e.g. 업데이트 결과).
 */
function useNavPill() {
  const navRef = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const nav = navRef.current;
    const pill = pillRef.current;
    if (!nav || !pill) return;
    const on = nav.querySelector<HTMLElement>('.nav-btn.on');
    pill.hidden = !on;
    if (!on) return;
    pill.style.height = `${on.offsetHeight}px`;
    pill.style.transform = `translateY(${on.offsetTop}px)`;
    if (!pill.dataset.placed) {
      // The first place is taken without sliding there from the top: the slide is switched on only after it.
      void pill.offsetWidth;
      pill.dataset.placed = '1';
    }
  });
  return { navRef, pillRef };
}

export function Sidebar() {
  const { snapshot, view, query, glossary } = useApp();
  const { navRef, pillRef } = useNavPill();
  if (!snapshot) return null;
  const undecided = glossary ? glossary.terms.filter((t) => t.status === 'provisional').length : 0;
  // The picture list is read once per opened project (for the count below).
  const meta = snapshot?.meta;
  useEffect(() => { if (meta) void useApp.loadImages(); }, [meta]);
  return (
    <nav className="sidebar" aria-label="작업 메뉴" ref={navRef}>
      <span className="nav-pill" ref={pillRef} aria-hidden="true" />
      <span className="nav-head work-head">작업</span>
      <button type="button" className={`nav-btn${view === 'text' ? ' on' : ''}`} aria-current={view === 'text' ? 'page' : undefined}
        onClick={() => useApp.setView('text')}>
        <TextIcon {...ICON} /><span>텍스트</span><NavCount n={snapshot.stats.untranslated} tone="mute" title="미번역" />
      </button>
      <button type="button" className={`nav-btn${view === 'glossary' ? ' on' : ''}`} aria-current={view === 'glossary' ? 'page' : undefined}
        onClick={() => useApp.setView('glossary')}>
        <BookOpenIcon {...ICON} /><span>용어집</span><NavCount n={undecided} tone="warn" title="결정 필요" />
      </button>
      <button type="button" className={`nav-btn${view === 'guide' ? ' on' : ''}`} aria-current={view === 'guide' ? 'page' : undefined}
        onClick={() => useApp.setView('guide')}>
        <PenLineIcon {...ICON} /><span>번역 지침</span>
      </button>
      <button type="button" className={`nav-btn${view === 'settings' ? ' on' : ''}`} aria-current={view === 'settings' ? 'page' : undefined}
        onClick={() => useApp.setView('settings')}>
        <SlidersHorizontalIcon {...ICON} /><span>설정</span>
      </button>
      <button type="button" className={`nav-btn${view === 'decisions' ? ' on' : ''}`} aria-current={view === 'decisions' ? 'page' : undefined}
        onClick={() => useApp.openDecisions()}>
        <CircleHelpIcon {...ICON} /><span>판단 필요</span><NavCount n={snapshot.stats.undecided ?? 0} tone="warn" title="정할 묶음의 줄 수" />
      </button>
      <button type="button" className={`nav-btn${view === 'events' ? ' on' : ''}`} aria-current={view === 'events' ? 'page' : undefined}
        onClick={() => eventActions.openEvents()}>
        <GitBranchIcon {...ICON} /><span>이벤트</span>
      </button>
      <PatchNavButton />
      <ImagesNavButton />
      <BuildsNavButton />
      <button type="button" className={`nav-btn${view === 'history' ? ' on' : ''}`} aria-current={view === 'history' ? 'page' : undefined}
        onClick={() => useApp.setView('history')}>
        <HistoryIcon {...ICON} /><span>작업 기록</span>
      </button>
      <UpdateNavButton />

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

function ImagesNavButton() {
  const { view, images } = useApp();
  const todo = images ? images.filter((e) => e.status === 'todo').length : 0;
  return (
    <button type="button" className={`nav-btn${view === 'images' ? ' on' : ''}`} aria-current={view === 'images' ? 'page' : undefined}
      onClick={() => useApp.setView('images')}>
      <ImageIcon {...ICON} /><span>이미지</span><NavCount n={todo} tone="warn" title="할 것" />
    </button>
  );
}

function BuildsNavButton() {
  const { view } = useApp();
  return (
    <button type="button" className={`nav-btn${view === 'builds' ? ' on' : ''}`} aria-current={view === 'builds' ? 'page' : undefined}
      onClick={() => useApp.setView('builds')}>
      <PackageIcon {...ICON} /><span>빌드 기록</span>
    </button>
  );
}

/** Shown when the current version came from an update: opens its result again. */
function UpdateNavButton() {
  const app = useApp();
  const meta = app.snapshot?.meta;
  useEffect(() => { if (meta) void updateActions.loadSummary(); }, [meta]);
  if (!app.updateSummary) return null;
  const on = app.view === 'update';
  return (
    <button type="button" className={`nav-btn${on ? ' on' : ''}`} aria-current={on ? 'page' : undefined}
      onClick={() => updateActions.openResult()}>
      <RefreshCwIcon {...ICON} /><span>업데이트 결과</span>
    </button>
  );
}

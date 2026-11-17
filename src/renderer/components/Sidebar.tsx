import { BookOpenIcon, CircleHelpIcon, GitBranchIcon, HistoryIcon, ImageIcon, PackageIcon, PenLineIcon, RefreshCwIcon, SlidersHorizontalIcon, TextIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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

/** Scopes shown before "모두 보기": the least finished first, since those are where the work is. */
const SCOPES_SHOWN = 6;

export function Sidebar() {
  const { snapshot, view, glossary } = useApp();
  const { navRef, pillRef } = useNavPill();
  if (!snapshot) return null;
  const undecided = glossary ? glossary.terms.filter((t) => t.status === 'provisional').length : 0;
  // The picture list is read once per opened project (for the count below).
  const meta = snapshot?.meta;
  useEffect(() => { if (meta) void useApp.loadImages(); }, [meta]);
  return (
    <nav className="sidebar" aria-label="작업 메뉴" ref={navRef}>
      <span className="nav-pill" ref={pillRef} aria-hidden="true" />
      <span className="nav-head work-head">번역</span>
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
      <button type="button" className={`nav-btn${view === 'decisions' ? ' on' : ''}`} aria-current={view === 'decisions' ? 'page' : undefined}
        onClick={() => useApp.openDecisions()}>
        <CircleHelpIcon {...ICON} /><span>판단 필요</span><NavCount n={snapshot.stats.undecided ?? 0} tone="warn" title="정할 묶음의 줄 수" />
      </button>

      <span className="nav-head spaced">게임</span>
      <button type="button" className={`nav-btn${view === 'events' ? ' on' : ''}`} aria-current={view === 'events' ? 'page' : undefined}
        onClick={() => eventActions.openEvents()}>
        <GitBranchIcon {...ICON} /><span>이벤트</span>
      </button>
      <PatchNavButton />
      <ImagesNavButton />

      <span className="nav-head spaced">결과</span>
      <BuildsNavButton />
      <button type="button" className={`nav-btn${view === 'history' ? ' on' : ''}`} aria-current={view === 'history' ? 'page' : undefined}
        onClick={() => useApp.setView('history')}>
        <HistoryIcon {...ICON} /><span>작업 기록</span>
      </button>
      <UpdateNavButton />

      <ScopeProgress />

      <div className="grow" />
      <div className="note-box">
        <span>원본 게임은 수정되지 않음</span>
        <span className="mute small">번역과 수정은 따로 쌓았다가 빌드할 때 합쳐요.</span>
      </div>
      <button type="button" className={`nav-btn nav-settings${view === 'settings' ? ' on' : ''}`} aria-current={view === 'settings' ? 'page' : undefined}
        onClick={() => useApp.setView('settings')}>
        <SlidersHorizontalIcon {...ICON} /><span>설정</span>
      </button>
    </nav>
  );
}

/**
 * Progress per scope. A big game has dozens of scopes, so only the least finished few show; the rest, and every
 * finished scope, fold under "모두 보기". The scope the table is filtered by always shows. Pressing one filters the table.
 */
function ScopeProgress() {
  const { snapshot, query } = useApp();
  const [all, setAll] = useState(false);
  const scopes = snapshot?.scopes ?? [];
  const { shown, folded } = useMemo(() => {
    const ranked = scopes.map((s, i) => ({ s, i, p: s.total > 0 ? s.done / s.total : 1 }))
      .sort((a, b) => a.p - b.p || a.i - b.i);
    const open = ranked.filter((x) => x.p < 1);
    const head = open.slice(0, SCOPES_SHOWN);
    const rest = [...open.slice(SCOPES_SHOWN), ...ranked.filter((x) => x.p >= 1)];
    return { shown: head.map((x) => x.s), folded: rest.map((x) => x.s) };
  }, [scopes]);
  if (scopes.length === 0) return null;
  const picked = folded.find((s) => s.file === query.file);
  const list = all ? [...shown, ...folded] : picked ? [...shown, picked] : shown;
  return (
    <div className="scope-box" role="group" aria-labelledby="scope-head">
      <span id="scope-head" className="nav-head spaced">범위별 진행률</span>
      {list.map((s) => {
        const p = pct(s.done, s.total);
        const on = query.file === s.file;
        return (
          <button key={s.file} type="button" className={`scope${on ? ' on' : ''}${p >= 100 ? ' done' : ''}`} aria-pressed={on}
            title={s.file} onClick={() => { useApp.setView('text'); useApp.toggleScope(s.file); }}>
            <span className="scope-line"><span className="scope-name">{s.label}</span><span className="mono small scope-pct">{p}%</span></span>
            <span className="thin-bar" aria-hidden="true"><span style={{ width: `${p}%` }} /></span>
          </button>
        );
      })}
      {folded.length > 0 && (
        <button type="button" className="scope-more" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? '접기' : <>모두 보기 <span className="mono">{num(folded.length)}</span></>}
        </button>
      )}
    </div>
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

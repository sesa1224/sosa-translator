import { MessagesSquareIcon, PanelRightCloseIcon, SquarePenIcon, XIcon } from 'lucide-react';
import { useEffect, useRef, type ComponentType } from 'react';
import type { Api } from '../shared/api';
import { ICON } from './icons';
import { BuildsView } from './components/BuildsView';
import { ChatPanel } from './components/ChatPanel';
import { CommandPalette } from './components/CommandPalette';
import { DecisionView } from './components/DecisionView';
import { EventView } from './components/EventView';
import { GlossaryView } from './components/GlossaryView';
import { GuideView } from './components/GuideView';
import { HistoryView } from './components/HistoryView';
import { ImageView } from './components/ImageView';
import { ItemPanel } from './components/ItemPanel';
import { JobBar } from './components/JobBar';
import { PatchView } from './components/PatchView';
import { ProjectPicker } from './components/ProjectPicker';
import { SettingsView } from './components/SettingsView';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { TextTable } from './components/TextTable';
import { Toasts } from './components/Toasts';
import { BuildBanner, TopBar } from './components/TopBar';
import { UpdateDialog } from './components/UpdateDialog';
import { UpdateView } from './components/UpdateView';
import { useApp, type AppState } from './state';

declare global {
  interface Window { api: Api }
}

/**
 * The item and chat panel. It folds to a strip at the window's right edge; in a narrow window it opens as a drawer
 * over the middle instead of taking a column. Folded, its content stays mounted and only hidden (and inert): the
 * big preview is drawn by the item panel through a portal and the draft lives in it, and the chat keeps what was typed.
 */
function RightPanel() {
  const { rightTab, rightCollapsed, narrowWindow } = useApp();
  const drawer = narrowWindow && !rightCollapsed;
  // Folding by the panel's own button leaves focus in a pane that just went inert; it goes on to the strip instead.
  const stripRef = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (!rightCollapsed || !refocus.current) return;
    refocus.current = false;
    stripRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [rightCollapsed]);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // A dialog takes Escape for itself.
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      refocus.current = document.getElementById('right-pane')?.contains(document.activeElement) ?? false;
      useApp.setRightCollapsed(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer]);
  const mode = rightCollapsed ? 'collapsed' : drawer ? 'drawer' : 'open';
  const foldName = drawer ? '오른쪽 패널 닫기' : '오른쪽 패널 접기';
  return (
    <aside className={`right ${mode}`} aria-label="항목과 채팅">
      {(rightCollapsed || drawer) && (
        <div className="right-strip" ref={stripRef} inert={drawer}>
          <button type="button" className="strip-btn" aria-label="항목 열기" title="항목 열기" aria-expanded={false} aria-controls="right-pane"
            onClick={() => useApp.openRightPanel('item')}><SquarePenIcon {...ICON} /></button>
          <button type="button" className="strip-btn" aria-label="채팅 열기" title="채팅 열기" aria-expanded={false} aria-controls="right-pane"
            onClick={() => useApp.openRightPanel('chat')}><MessagesSquareIcon {...ICON} /></button>
        </div>
      )}
      <div id="right-pane" className="right-pane" inert={rightCollapsed} role={drawer ? 'region' : undefined} aria-label={drawer ? '항목과 채팅 서랍' : undefined}>
        <div className="right-head">
          <div className="seg tabs" role="tablist" aria-label="오른쪽 탭">
            {/* One background under the picked tab that slides across. */}
            <span className="seg-pill" aria-hidden="true" style={{ transform: rightTab === 'chat' ? 'translateX(100%)' : 'none' }} />
            <button type="button" role="tab" id="tab-item" aria-selected={rightTab === 'item'} aria-controls="panel-right"
              className={rightTab === 'item' ? 'on' : ''} onClick={() => useApp.setRightTab('item')}>항목</button>
            <button type="button" role="tab" id="tab-chat" aria-selected={rightTab === 'chat'} aria-controls="panel-right"
              className={rightTab === 'chat' ? 'on' : ''} onClick={() => useApp.setRightTab('chat')}>채팅</button>
          </div>
          <button type="button" className="icon-btn fold-btn" aria-label={foldName} title={foldName} aria-expanded={!rightCollapsed} aria-controls="right-pane"
            onClick={() => { refocus.current = true; useApp.setRightCollapsed(true); }}>{drawer ? <XIcon {...ICON} /> : <PanelRightCloseIcon {...ICON} />}</button>
        </div>
        <div id="panel-right" role="tabpanel" aria-labelledby={rightTab === 'item' ? 'tab-item' : 'tab-chat'} className="right-body">
          {rightTab === 'item' ? <ItemPanel /> : <ChatPanel />}
        </div>
      </div>
    </aside>
  );
}

/** The screen shown in the middle for each AppState.view. A new screen needs an entry here and in the view union. */
const SCREENS: Record<AppState['view'], ComponentType> = {
  text: TextTable,
  glossary: GlossaryView,
  guide: GuideView,
  settings: SettingsView,
  decisions: DecisionView,
  images: ImageView,
  builds: BuildsView,
  events: EventView,
  patches: PatchView,
  update: UpdateView,
  history: HistoryView,
};

function Workspace() {
  const { view, updateOpen } = useApp();
  const Screen = SCREENS[view];
  return (
    <div className="shell">
      <TopBar />
      <BuildBanner />
      <JobBar />
      <div className="body">
        <Sidebar />
        <main className="main">
          <Screen />
        </main>
        <RightPanel />
      </div>
      <StatusBar />
      {updateOpen && <UpdateDialog />}
      <Toasts />
      <CommandPalette />
    </div>
  );
}

export function App() {
  const { ready, snapshot } = useApp();
  useEffect(() => {
    void useApp.start(window.api);
    // A file dropped where nothing handles it would make Electron open it in place of the app.
    const stopNav = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', stopNav);
    window.addEventListener('drop', stopNav);
    return () => {
      useApp.stop();
      window.removeEventListener('dragover', stopNav);
      window.removeEventListener('drop', stopNav);
    };
  }, []);
  if (!ready) return null;
  return snapshot ? <Workspace /> : <ProjectPicker />;
}


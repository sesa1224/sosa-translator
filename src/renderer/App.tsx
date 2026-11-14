import { useEffect, type ComponentType } from 'react';
import type { Api } from '../shared/api';
import { BuildsView } from './components/BuildsView';
import { ChatPanel } from './components/ChatPanel';
import { DecisionView } from './components/DecisionView';
import { EventView } from './components/EventView';
import { GlossaryView } from './components/GlossaryView';
import { GuideView } from './components/GuideView';
import { ImageView } from './components/ImageView';
import { ItemPanel } from './components/ItemPanel';
import { JobBar } from './components/JobBar';
import { PatchView } from './components/PatchView';
import { ProjectPicker } from './components/ProjectPicker';
import { SettingsView } from './components/SettingsView';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { TextTable } from './components/TextTable';
import { BuildBanner, TopBar } from './components/TopBar';
import { UpdateDialog } from './components/UpdateDialog';
import { UpdateView } from './components/UpdateView';
import { useApp, type AppState } from './state';

declare global {
  interface Window { api: Api }
}

function RightPanel() {
  const { rightTab } = useApp();
  return (
    <aside className="right" aria-label="항목과 채팅">
      <div className="right-head">
        <div className="seg" role="tablist" aria-label="오른쪽 탭">
          <button type="button" role="tab" id="tab-item" aria-selected={rightTab === 'item'} aria-controls="panel-right"
            className={rightTab === 'item' ? 'on' : ''} onClick={() => useApp.setRightTab('item')}>항목</button>
          <button type="button" role="tab" id="tab-chat" aria-selected={rightTab === 'chat'} aria-controls="panel-right"
            className={rightTab === 'chat' ? 'on' : ''} onClick={() => useApp.setRightTab('chat')}>채팅</button>
        </div>
      </div>
      <div id="panel-right" role="tabpanel" aria-labelledby={rightTab === 'item' ? 'tab-item' : 'tab-chat'} className="right-body">
        {rightTab === 'item' ? <ItemPanel /> : <ChatPanel />}
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


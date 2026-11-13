import { useEffect } from 'react';
import type { Api } from '../shared/api';
import { ItemPanel } from './components/ItemPanel';
import { ProjectPicker } from './components/ProjectPicker';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { TextTable } from './components/TextTable';
import { BuildBanner, TopBar } from './components/TopBar';
import { useApp } from './state';

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
        {rightTab === 'item' ? <ItemPanel /> : <AttachedChip />}
      </div>
    </aside>
  );
}

function AttachedChip() {
  const { attachedId, rowsById } = useApp();
  const row = attachedId ? rowsById[attachedId] : undefined;
  if (!row) return null;
  return (
    <div className="attached">
      <span className="tag">{`붙은 항목 · ${row.location}`}</span>
      <button type="button" className="x" aria-label="붙은 항목 떼기" onClick={() => useApp.attach(null)}>×</button>
    </div>
  );
}

function Workspace() {
  const { view } = useApp();
  return (
    <div className="shell">
      <TopBar />
      <BuildBanner />
      <div className="body">
        <Sidebar />
        <main className="main">
          {view === 'text' ? <TextTable /> : <h1 className="page-title">설정</h1>}
        </main>
        <RightPanel />
      </div>
      <StatusBar />
    </div>
  );
}

export function App() {
  const { ready, snapshot } = useApp();
  useEffect(() => {
    void useApp.start(window.api);
    return () => useApp.stop();
  }, []);
  if (!ready) return null;
  return snapshot ? <Workspace /> : <ProjectPicker />;
}

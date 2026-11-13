import { useState, type DragEvent } from 'react';
import type { GameDirCheck } from '../../shared/api';
import { useApp } from '../state';

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

/** Shown when no project is open: existing projects, or create one from a game folder (picked or dropped). */
export function ProjectPicker() {
  const { projects, settings, snapshot } = useApp();
  const [game, setGame] = useState<Extract<GameDirCheck, { ok: true }> | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  const run = async (job: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await job();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** Checks the folder and fills the name from the game title; a folder that is not MV/MZ shows its error. */
  const use = (dir: string) => run(async () => {
    setGame(null);
    const r = await useApp.inspectGameDir(dir);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setGame(r);
    setName(r.suggestedName);
  });

  const pick = () => run(async () => {
    const dir = await useApp.pickGameDir();
    if (dir) await use(dir);
  });

  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e) || snapshot) return;
    e.preventDefault();
    if (!over) setOver(true);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (snapshot || busy) return;   // a project is open: a stray drop changes nothing
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    void use(useApp.pathForDrop(file));
  };

  return (
    <div className={`picker-page${over ? ' drop-on' : ''}`} onDragOver={onDragOver} onDragEnter={onDragOver}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false); }} onDrop={onDrop} data-testid="picker">
      {over && <div className="drop-hint" aria-hidden="true">여기에 게임 폴더를 놓으세요</div>}
      <div className="picker">
      <div className="picker-head">
        <div className="logo" aria-hidden="true">譯</div>
        <h1>프로젝트</h1>
      </div>

      <section className="card picker-section" aria-label="새 프로젝트">
        <span className="card-title">새 프로젝트</span>
        <span className="sub">게임 폴더를 고르거나 이 창에 끌어다 놓으면 원본을 복사해 오고 텍스트를 뽑아요. 원본 게임은 수정되지 않아요.</span>
        <div className="picker-row">
          <button type="button" className="btn" onClick={pick} disabled={busy}>게임 폴더 고르기</button>
          <span className="mono sub picker-path">{game?.dir ?? '아직 고르지 않았어요'}</span>
        </div>
        {game && (
          <>
            <span className="small">{`${game.engine} · ${game.title || '(제목 없음)'}`}</span>
            <div className="field">
              <label htmlFor="project-name">프로젝트 이름</label>
              <input id="project-name" className="input" type="text" value={name} placeholder="예: 약초원"
                onChange={(e) => setName(e.target.value)} disabled={busy} />
              {settings && <span className="hint mono">{settings.projectsDir}</span>}
            </div>
            <div className="picker-row">
              <button type="button" className="btn primary" disabled={busy || !name.trim()}
                onClick={() => run(() => useApp.createProject(game.dir, name.trim()))}>만들기</button>
            </div>
          </>
        )}
        {busy && <span className="sub" role="status">확인하는 중…</span>}
        {error && <span className="err-text" role="alert">{error}</span>}
      </section>

      {projects.length > 0 && (
        <section className="card picker-section" aria-label="기존 프로젝트">
          <span className="card-title">기존 프로젝트</span>
          <ul className="picker-list">
            {projects.map((p) => (
              <li key={p.dir}>
                <div className="picker-item">
                  <span>{p.name}</span>
                  <span className="mono sub">{p.engine} · {p.dir}</span>
                </div>
                <button type="button" className="btn" disabled={busy} onClick={() => run(() => useApp.openProject(p.dir))}
                  aria-label={`${p.name} 열기`}>열기</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      </div>
    </div>
  );
}

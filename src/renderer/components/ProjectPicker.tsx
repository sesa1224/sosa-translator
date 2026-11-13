import { useState } from 'react';
import { useApp } from '../state';

/** Shown when no project is open: existing projects, or create one from a game folder. */
export function ProjectPicker() {
  const { projects, settings } = useApp();
  const [gameDir, setGameDir] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const pick = () => run(async () => {
    const dir = await useApp.pickGameDir();
    if (dir) setGameDir(dir);
  });

  return (
    <div className="picker">
      <div className="picker-head">
        <div className="logo" aria-hidden="true">譯</div>
        <h1>프로젝트</h1>
      </div>

      <section className="card picker-section" aria-label="새 프로젝트">
        <span className="card-title">새 프로젝트</span>
        <span className="sub">게임 폴더를 고르면 원본을 복사해 오고 텍스트를 뽑아요. 원본 게임은 수정되지 않아요.</span>
        <div className="picker-row">
          <button type="button" className="btn" onClick={pick} disabled={busy}>게임 폴더 고르기</button>
          <span className="mono sub picker-path">{gameDir ?? '아직 고르지 않았어요'}</span>
        </div>
        <div className="field">
          <label htmlFor="project-name">프로젝트 이름</label>
          <input id="project-name" className="input" type="text" value={name} placeholder="예: 약초원"
            onChange={(e) => setName(e.target.value)} disabled={busy} />
          {settings && <span className="hint mono">{settings.projectsDir}</span>}
        </div>
        <div className="picker-row">
          <button type="button" className="btn primary" disabled={busy || !gameDir || !name.trim()}
            onClick={() => run(() => useApp.createProject(gameDir!, name.trim()))}>만들기</button>
          {busy && <span className="sub" role="status">가져오는 중…</span>}
        </div>
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
  );
}

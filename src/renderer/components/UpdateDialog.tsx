import { useEffect, useState, type DragEvent } from 'react';
import type { UpdateInspect } from '../../shared/api';
import { updateActions, useApp } from '../state';

type Checked = Extract<UpdateInspect, { ok: true }> & { dir: string };

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

/** Picks (or takes a dropped) folder of the game's new version, shows what it is and takes it. */
export function UpdateDialog() {
  const { snapshot } = useApp();
  const [checked, setChecked] = useState<Checked | null>(null);
  const [label, setLabel] = useState('');
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState<'checking' | 'importing' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [over, setOver] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && busy !== 'importing') updateActions.close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy]);

  const meta = snapshot?.meta;
  const current = meta?.versions.find((v) => v.id === meta.current);
  const currentLabel = current?.label ?? meta?.current ?? '';

  const use = async (dir: string) => {
    setBusy('checking');
    setError(null);
    setFailed(false);
    setChecked(null);
    setForce(false);
    try {
      const r = await updateActions.inspect(dir);
      if (!r.ok) setError(r.error);
      else {
        setChecked({ ...r, dir });
        setLabel(r.suggestedLabel);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const pick = async () => {
    const dir = await updateActions.pickGameDir();
    if (dir) await use(dir);
  };
  const take = async () => {
    if (!checked) return;
    setBusy('importing');
    setError(null);
    setFailed(false);
    try {
      await updateActions.importVersion(checked.dir, label.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setFailed(true);
      setBusy(null);
    }
  };

  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (!over) setOver(true);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (busy) return;
    const file = e.dataTransfer?.files?.[0];
    if (file) void use(updateActions.pathForDrop(file));
  };

  const canTake = !!checked && label.trim() !== '' && (checked.sameGame || force) && busy === null;
  return (
    <div className="dialog-backdrop" onClick={() => { if (busy !== 'importing') updateActions.close(); }}>
      <div className={`dialog card update-dialog${over ? ' drop-on' : ''}`} role="dialog" aria-modal="true" aria-labelledby="update-title"
        onClick={(e) => e.stopPropagation()} onDragOver={onDragOver} onDragEnter={onDragOver}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false); }} onDrop={onDrop} data-testid="update-dialog">
        <span id="update-title" className="card-title">새 버전 가져오기</span>
        <span className="sub small">게임의 새 버전 폴더를 고르거나 여기에 끌어다 놓으세요</span>
        <div className="row-gap">
          <button type="button" className="btn" disabled={busy !== null} onClick={() => void pick()}>폴더 고르기</button>
          <span className="mono sub small picker-path">{checked?.dir ?? '아직 고르지 않았어요'}</span>
        </div>
        <span className="small">{`지금 버전: ${currentLabel}`}</span>
        {checked && (
          <>
            <span className="small">{`${checked.engine} · ${checked.title || '(제목 없음)'}`}</span>
            <div className="field">
              <label htmlFor="update-label" className="label">버전 이름</label>
              <input id="update-label" aria-label="버전 이름" className="input" type="text" value={label}
                onChange={(e) => setLabel(e.target.value)} disabled={busy !== null} />
            </div>
            {!checked.sameGame && (
              <div className="update-warn" role="alert">
                <span className="warn-text">{`다른 게임 같아요: ${checked.reason ?? ''}`}</span>
                <label className="row-gap small">
                  <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} disabled={busy !== null} />
                  <span>그래도 가져오기</span>
                </label>
              </div>
            )}
          </>
        )}
        <span className="sub small">가져오기 전 상태를 남겨 두어서 되돌릴 수 있어요. 원본 게임 폴더는 바꾸지 않아요.</span>
        {busy === 'checking' && <span className="sub small" role="status">확인하는 중…</span>}
        {busy === 'importing' && <span className="sub small" role="status">가져오는 중…</span>}
        {error && (
          <div className="col small" role="alert">
            <span className="err-text">{error}</span>
            {failed && <span className="sub">프로젝트는 그대로예요</span>}
          </div>
        )}
        <div className="row-gap end">
          <button type="button" className="btn ghost" disabled={busy === 'importing'} onClick={() => updateActions.close()}>취소</button>
          <button type="button" className="btn primary" disabled={!canTake} onClick={() => void take()}>가져오기</button>
        </div>
      </div>
    </div>
  );
}

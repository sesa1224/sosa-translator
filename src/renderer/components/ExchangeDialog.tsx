import { DownloadIcon, UploadIcon } from 'lucide-react';
import { useState } from 'react';
import type { ImportPlan } from '../../shared/api';
import { num } from '../format';
import { ICON } from '../icons';
import { useApp } from '../state';

/** Shows what an outside translator's file would change, and imports it. Conflicts are skipped unless chosen. */
export function ExchangeDialog({ plan, onClose }: { plan: ImportPlan; onClose: (written: number | null) => void }) {
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const withErrors = plan.ok.filter((o) => o.issues.some((i) => i.severity === 'error')).length;
  const nothing = plan.ok.length === 0 && (plan.conflicts.length === 0 || !overwrite);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await useApp.applyImport(overwrite);
      onClose(r.written);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <div className="dialog-backdrop">
      <div className="dialog card" role="dialog" aria-modal="true" aria-labelledby="exchange-title">
        <span id="exchange-title" className="card-title">외부 번역 가져오기</span>
        <p>{`넣을 수 있는 번역 ${num(plan.ok.length)}개 · 그중 검사 오류 ${num(withErrors)}개`}</p>
        <p>{`이미 번역이 있고 내용이 다른 항목 ${num(plan.conflicts.length)}개`}</p>
        {plan.conflicts.length > 0 && (
          <div className="decision-modes" role="radiogroup" aria-label="다른 항목 처리">
            <label className="radio-line"><input type="radio" name="exchange-conflict" checked={!overwrite} onChange={() => setOverwrite(false)} /> 건너뛰기</label>
            <label className="radio-line"><input type="radio" name="exchange-conflict" checked={overwrite} onChange={() => setOverwrite(true)} /> 덮어쓰기</label>
          </div>
        )}
        <p className="mute">{`프로젝트에 없는 id ${num(plan.unknownIds.length)}개`}</p>
        <p className="mute">{`모양이 틀린 항목 ${num(plan.invalid)}개`}</p>
        {error && <span className="err-text small" role="alert">{error}</span>}
        <div className="row-gap">
          <button type="button" className="btn primary" disabled={busy || nothing} onClick={() => void go()}>가져오기</button>
          <button type="button" className="btn ghost" disabled={busy} onClick={() => onClose(null)}>취소</button>
        </div>
      </div>
    </div>
  );
}

/** "내보내기" (the rows the table now shows) and "가져오기" above the text table. */
export function ExchangeActions({ ids }: { ids: string[] }) {
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (f: () => Promise<void>) => {
    setError(null);
    setNote(null);
    try {
      await f();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <span className="exchange-actions">
      <span className="grp">
        <button type="button" disabled={ids.length === 0}
          onClick={() => void run(async () => {
            const file = await useApp.exportRows(ids);
            if (file) setNote(`내보냈어요: ${file}`);
          })}><UploadIcon {...ICON} />{`내보내기 (${num(ids.length)})`}</button>
        <button type="button" onClick={() => void run(async () => { setPlan(await useApp.planImport()); })}><DownloadIcon {...ICON} />가져오기</button>
      </span>
      {note && <span className="mute small">{note}</span>}
      {error && <span className="err-text small" role="alert">{error}</span>}
      {plan && <ExchangeDialog plan={plan} onClose={(n) => { setPlan(null); if (n !== null) setNote(`가져온 번역 ${num(n)}개`); }} />}
    </span>
  );
}

import { useEffect, useState } from 'react';
import type { DraftChoice, DraftMode, DraftPlan } from '../../shared/api';
import { num } from '../format';
import { useApp } from '../state';

const MODES: [DraftMode, string, string][] = [
  ['balanced', '적당히 읽고 만들기(권장)', '대본에서 고르게 떨어진 장면들과 주요 인물·신음 장면을 골라 읽어요.'],
  ['full', '대본 전체를 읽고 만들기', '모든 대사를 읽어요. 가장 정확하지만 토큰이 많이 들어요.'],
  ['sample', '표본만 보고 빠르게 만들기', '인물마다 대사 몇 줄만 보고 한 번에 만들어요.'],
];
const AMOUNTS: [number, string][] = [[20000, '적게 (약 2만 자)'], [50000, '보통 (약 5만 자)'], [100000, '많이 (약 10만 자)']];
const DEFAULT_BUDGET = 50000;

/** Picks how the glossary draft reads the script and with which models, shows the estimate, then starts it. */
export function DraftDialog({ onClose, onStart }: { onClose: () => void; onStart: (mode: DraftMode, choice: DraftChoice) => void }) {
  const { settings } = useApp();
  const [mode, setMode] = useState<DraftMode>('balanced');
  const [budget, setBudget] = useState(DEFAULT_BUDGET);
  const [mergeModel, setMergeModel] = useState(settings?.stageModels.glossary ?? '');
  const [readModel, setReadModel] = useState(settings?.stageModels.glossaryRead ?? '');
  const [plan, setPlan] = useState<DraftPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choice = (): DraftChoice => {
    const c: DraftChoice = { mergeModel };
    if (mode === 'balanced') c.budgetChars = budget;
    if (mode !== 'sample') c.readModel = readModel || mergeModel;
    return c;
  };

  useEffect(() => {
    let live = true;
    setPlan(null);
    setError(null);
    useApp.draftPlan(mode, choice()).then((p) => { if (live) setPlan(p); }, (e) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [mode, budget, mergeModel, readModel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const label = (id: string) => settings?.models.find((m) => m.id === id)?.label ?? id;
  const models = settings?.models ?? [];
  let line = '세는 중…';
  if (plan) {
    const who = mode === 'sample' || plan.readModel === plan.model ? `모델 ${label(plan.model)}` : `모델 읽기 ${label(plan.readModel)} · 정리 ${label(plan.model)}`;
    line = mode === 'sample'
      ? `표본 · 약 ${num(plan.chars)}자 · 예상 입력 약 ${num(plan.estimatedInputTokens)} 토큰 · ${who}`
      : `조각 ${num(plan.chunks)}개 · 약 ${num(plan.chars)}자 · 예상 입력 약 ${num(plan.estimatedInputTokens)} 토큰 · ${who}`;
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog card" role="dialog" aria-modal="true" aria-labelledby="draft-title" onClick={(e) => e.stopPropagation()}>
        <span id="draft-title" className="card-title">용어집 초안 받기</span>
        <div className="radio-list" role="radiogroup" aria-label="초안 방식">
          {MODES.map(([m, text, hint]) => (
            <label key={m} className="radio-line">
              <input type="radio" name="draft-mode" aria-label={text} checked={mode === m} onChange={() => setMode(m)} />
              <span>{text}</span>
              <span className="sub small">{hint}</span>
            </label>
          ))}
        </div>
        {mode === 'balanced' && (
          <div className="radio-list" role="radiogroup" aria-label="읽는 양">
            <span className="label">읽는 양</span>
            {AMOUNTS.map(([v, text]) => (
              <label key={v} className="radio-line">
                <input type="radio" name="draft-amount" checked={budget === v} onChange={() => setBudget(v)} />
                <span>{text}</span>
              </label>
            ))}
          </div>
        )}
        <div className="stage-grid">
          {mode !== 'sample' && (
            <div className="field">
              <label htmlFor="draft-read-model">대본 읽기</label>
              <select id="draft-read-model" className="input" value={readModel} onChange={(e) => setReadModel(e.target.value)}>
                <option value="">용어집 정리와 같음</option>
                {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
          )}
          <div className="field">
            <label htmlFor="draft-merge-model">용어집 정리</label>
            <select id="draft-merge-model" className="input" value={mergeModel} onChange={(e) => setMergeModel(e.target.value)}>
              {!models.some((m) => m.id === mergeModel) && <option value={mergeModel}>{mergeModel}</option>}
              {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
        </div>
        <span className="hint">여기서 고른 모델은 이번 한 번만 써요. 기본값은 설정에서 바꿔요.</span>
        <span className="mono small" aria-live="polite">{line}</span>
        {error && <span className="err-text small" role="alert">{error}</span>}
        <div className="row-gap end">
          <button type="button" className="btn ghost" onClick={onClose}>취소</button>
          <button type="button" className="btn primary" disabled={!plan} onClick={() => { onStart(mode, choice()); onClose(); }}>시작</button>
        </div>
      </div>
    </div>
  );
}

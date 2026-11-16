import { useEffect, useState } from 'react';
import type { ReviewPlan, ReviewScopeArg } from '../../shared/api';
import { num } from '../format';
import { useApp } from '../state';

type ScopeKey = ReviewScopeArg['scope'];

/** Picks the review scope, shows the item count and token estimate, then starts the review. */
export function ReviewDialog({ onClose }: { onClose: () => void }) {
  const { query, snapshot, settings } = useApp();
  const skipPassed = settings?.reviewSkipPassed ?? true;
  const [scope, setScope] = useState<ScopeKey>('all');
  const [plan, setPlan] = useState<ReviewPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const file = query.file;
  const fileLabel = file ? snapshot?.scopes.find((s) => s.file === file)?.label ?? file : null;
  const arg = (s: ScopeKey): ReviewScopeArg => (s === 'file' && file ? { scope: 'file', file } : { scope: s });

  useEffect(() => {
    let live = true;
    setPlan(null);
    useApp.reviewPlan(arg(scope)).then((p) => { if (live) setPlan(p); }, (e) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [scope, file, skipPassed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const start = async () => {
    setError(null);
    try {
      await useApp.startReview(arg(scope));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const modelLabel = plan ? settings?.models.find((m) => m.id === plan.model)?.label ?? plan.model : '';
  const options: [ScopeKey, string, boolean][] = [
    ['all', '전체', true], ['unreviewed', '지난 검수 이후 바뀐 것만', true], ['file', '지금 보는 범위', fileLabel !== null],
  ];

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog card" role="dialog" aria-modal="true" aria-labelledby="review-title" onClick={(e) => e.stopPropagation()}>
        <span id="review-title" className="card-title">번역 전체 검수</span>
        <span className="sub small">원문과 번역을 묶음으로 읽고, 문제 있는 줄만 이유와 고친 안을 달아 "검토 필요"로 올려요.</span>
        <div className="radio-list" role="radiogroup" aria-label="검수 범위">
          {options.map(([key, label, enabled]) => (
            <label key={key} className={`radio-line${enabled ? '' : ' mute'}`}>
              <input type="radio" name="review-scope" checked={scope === key} disabled={!enabled} onChange={() => setScope(key)} />
              <span>{label}</span>
              {key === 'file' && <span className="sub small">{fileLabel ?? '왼쪽에서 범위를 고르면 쓸 수 있어요'}</span>}
            </label>
          ))}
        </div>
        <label className="radio-line">
          <input type="checkbox" checked={skipPassed}
            onChange={(e) => { void useApp.updateSettings({ reviewSkipPassed: e.target.checked }).catch((err) => setError(err instanceof Error ? err.message : String(err))); }} />
          <span>넘긴 의견이 달린 줄은 다시 검수하지 않기</span>
        </label>
        <span className="mono small" aria-live="polite">
          {plan ? `항목 ${num(plan.items)}개 · 예상 입력 약 ${num(plan.estimatedInputTokens)} 토큰 · 모델 ${modelLabel}${plan.skippedPassed > 0 ? ` · 넘긴 의견 ${num(plan.skippedPassed)}개 제외` : ''}` : '세는 중…'}
        </span>
        {error && <span className="err-text small" role="alert">{error}</span>}
        <div className="row-gap end">
          <button type="button" className="btn ghost" onClick={onClose}>취소</button>
          <button type="button" className="btn primary" disabled={!plan || plan.items === 0} onClick={() => void start()}>검수 시작</button>
        </div>
      </div>
    </div>
  );
}

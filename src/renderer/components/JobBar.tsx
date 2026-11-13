import type { JobKind } from '../../shared/api';
import { num, pct } from '../format';
import { useApp } from '../state';

const RUNNING_LABEL: Record<JobKind, string> = { draft: '용어집 초안 받는 중', translate: '번역 중', review: '검수 중' };

/** Progress of the translation / review / draft job, shown above the work area while one exists. */
export function JobBar() {
  const { job, jobDismissed, glossary } = useApp();
  if (!job || job.state === 'idle' || jobDismissed) return null;
  const p = pct(job.done, job.total);
  const tokens = job.usage.input + job.usage.cacheRead + job.usage.cacheCreate;
  const counts = (
    <>
      {job.declined > 0 && <span className="warn-text">{`거절 ${num(job.declined)}`}</span>}
      {job.errors > 0 && <span className="err-text">{`오류 ${num(job.errors)}`}</span>}
    </>
  );
  const close = <button type="button" className="btn ghost small-btn" aria-label="작업 알림 닫기" onClick={() => useApp.dismissJob()}>닫기</button>;
  const stop = <button type="button" className="btn ghost small-btn" onClick={() => void useApp.stopJob()}>멈추기</button>;
  const resume = <button type="button" className="btn small-btn" onClick={() => void useApp.resumeJob()}>이어하기</button>;
  const bar = (
    <>
      <span className="job-progress" aria-hidden="true"><span style={{ width: `${p}%` }} /></span>
      <span className="mono small">{`${num(job.done)} / ${num(job.total)}`}</span>
      <span className="mono sub small">{`토큰 입력 ${num(tokens)} · 출력 ${num(job.usage.output)}`}</span>
    </>
  );

  if (job.state === 'done') {
    const undecided = glossary ? glossary.terms.filter((t) => t.status === 'provisional').length : 0;
    const text = job.kind === 'translate'
      ? `끝났어요 · ${num(Math.max(0, job.done - job.declined - job.errors))}개 번역 · 거절 ${num(job.declined)} · 오류 ${num(job.errors)}`
      : job.kind === 'review' ? `검수 끝났어요 · ${num(job.done)}개 확인 · 오류 ${num(job.errors)}` : '용어집 초안을 받았어요';
    return (
      <div className="banner ok job" role="status">
        <span>{text}</span>
        {undecided > 0 && <button type="button" className="btn small-btn" onClick={() => useApp.setView('glossary')}>{`결정 안 한 용어 ${num(undecided)}개`}</button>}
        <div className="grow" />
        {close}
      </div>
    );
  }
  if (job.state === 'failed') {
    return (
      <div className="banner err job" role="alert">
        <span>{job.message ?? '작업이 실패했어요'}</span>
        <div className="grow" />
        {close}
      </div>
    );
  }
  if (job.state === 'stopped') {
    return (
      <div className="banner job" role="status">
        <span>{`멈췄어요 · ${num(job.done)} / ${num(job.total)} · 끝낸 것은 남아 있어요`}</span>
        <div className="grow" />
        {close}
      </div>
    );
  }
  if (job.state === 'paused-limit') {
    return (
      <div className="banner warn job" role="alert">
        <span className="warn-text">사용량 한도 때문에 멈췄어요</span>
        {job.message && <span className="sub small">{job.message}</span>}
        {bar}{counts}
        <div className="grow" />
        {resume}{stop}
      </div>
    );
  }
  const title = job.state === 'paused' ? '일시정지됨' : job.label ? `${RUNNING_LABEL[job.kind]} · ${job.label}` : RUNNING_LABEL[job.kind];
  return (
    <div className="banner job" role="status">
      <span>{title}</span>
      {bar}{counts}
      <div className="grow" />
      {job.state === 'paused'
        ? resume
        : <button type="button" className="btn small-btn" onClick={() => void useApp.pauseJob()}>일시정지</button>}
      {stop}
    </div>
  );
}

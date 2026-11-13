import { clock, num, pct } from '../format';
import { useApp } from '../state';

export function StatusBar() {
  const { claudePath, chat, lastSaved } = useApp();
  const u = chat.usage;
  const input = u.input + u.cacheRead + u.cacheCreate;
  return (
    <footer className="statusbar mono">
      {claudePath
        ? <span className="accent-text" title={claudePath}>Claude CLI 연결됨</span>
        : <span className="warn-text">Claude CLI 없음</span>}
      <span>{`입력 ${num(input)} · 출력 ${num(u.output)} 토큰`}</span>
      <span>{`캐시 적중 ${pct(u.cacheRead, input)}%`}</span>
      {chat.sessionModel && <span>{chat.sessionModel}</span>}
      <div className="grow" />
      <span>{lastSaved ? `자동 저장 ${clock(lastSaved)}` : '자동 저장 대기'}</span>
    </footer>
  );
}

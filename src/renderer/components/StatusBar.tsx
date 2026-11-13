import { useEffect } from 'react';
import { clock, num, pct } from '../format';
import { plan6Actions, useApp } from '../state';

export function StatusBar() {
  const { claudePath, chat, lastSaved, claudeStatus } = useApp();
  const u = chat.usage;
  const input = u.input + u.cacheRead + u.cacheCreate;
  useEffect(() => { void plan6Actions.checkClaude(); }, [claudePath]);
  // Until the check answers, the path alone tells whether the CLI is there.
  const found = claudeStatus ? claudeStatus.found : !!claudePath;
  return (
    <footer className="statusbar mono">
      {!found
        ? <span className="warn-text">Claude CLI 없음</span>
        : claudeStatus?.loggedIn === false
          ? <span className="warn-text" title={claudePath ?? undefined}>로그인 필요</span>
          : <span className="accent-text" title={claudePath ?? undefined}>Claude CLI 연결됨</span>}
      <span>{`입력 ${num(input)} · 출력 ${num(u.output)} 토큰`}</span>
      <span>{`캐시 적중 ${pct(u.cacheRead, input)}%`}</span>
      {chat.sessionModel && <span>{chat.sessionModel}</span>}
      <div className="grow" />
      <span>{lastSaved ? `자동 저장 ${clock(lastSaved)}` : '자동 저장 대기'}</span>
    </footer>
  );
}

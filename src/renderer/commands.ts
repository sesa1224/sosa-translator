// What the command search (Ctrl+K) offers. Everything is one table so a new screen or action is one more line here.
// Commands only call actions state.ts already has; they never add behaviour of their own.
import {
  BookOpenIcon, CircleArrowDownIcon, CircleHelpIcon, DiffIcon, GitBranchIcon, HistoryIcon, ImageIcon, ListFilterIcon, LogOutIcon, PackageIcon, PenLineIcon, PlayIcon,
  RefreshCwIcon, ScanSearchIcon, SlidersHorizontalIcon, SparklesIcon, TextIcon, TriangleAlertIcon, type LucideIcon,
} from 'lucide-react';
import type { StatusFilter } from '../shared/api';
import { eventActions, jobActive, updateActions, useApp, type AppState } from './state';

export interface Command {
  id: string;
  label: string;
  icon: LucideIcon;
  /** More words it is found by (not shown). */
  keywords?: string;
  /** Listed only when this holds (e.g. the update result exists only after an update). */
  shown?: (s: AppState) => boolean;
  /** Why it cannot run now; null when it can. Blocked commands stay listed, dimmed, with this reason. */
  blocked?: (s: AppState) => string | null;
  run: () => void | Promise<unknown>;
}

const go = (id: string, label: string, icon: LucideIcon, view: AppState['view'], run?: () => void, more?: Partial<Command>): Command =>
  ({ id: `go:${id}`, label, icon, keywords: '화면 이동', run: run ?? (() => useApp.setView(view)), ...more });

const filter = (status: StatusFilter, label: string, icon: LucideIcon, keywords: string): Command =>
  ({ id: `filter:${status}`, label, icon, keywords: `표 거르기 ${keywords}`, run: () => updateActions.showStatus(status) });

/** Untranslated lines a translate job would take (lines waiting on a decision are not among them). */
function freshLines(s: AppState): number {
  let n = 0;
  for (const id of s.rowOrder) {
    const r = s.rowsById[id];
    if (r.status === 'untranslated' && !r.needsDecision) n++;
  }
  return n;
}

const BUSY = '다른 작업이 진행 중이에요';

export const COMMANDS: Command[] = [
  // Screens: every entry of the left menu.
  go('text', '텍스트로 가기', TextIcon, 'text'),
  go('glossary', '용어집으로 가기', BookOpenIcon, 'glossary'),
  go('guide', '번역 지침으로 가기', PenLineIcon, 'guide'),
  go('settings', '설정으로 가기', SlidersHorizontalIcon, 'settings', undefined, { keywords: '화면 이동 테마 폰트 모델' }),
  go('decisions', '판단 필요로 가기', CircleHelpIcon, 'decisions', () => useApp.openDecisions()),
  go('events', '이벤트로 가기', GitBranchIcon, 'events', () => eventActions.openEvents()),
  go('patches', '수정 내역으로 가기', DiffIcon, 'patches', () => eventActions.openPatches()),
  go('images', '이미지로 가기', ImageIcon, 'images', undefined, { keywords: '화면 이동 그림' }),
  go('builds', '빌드 기록으로 가기', PackageIcon, 'builds', undefined, { keywords: '화면 이동 패치노트' }),
  go('history', '작업 기록으로 가기', HistoryIcon, 'history', undefined, { keywords: '화면 이동 되돌리기 취소' }),
  go('update', '업데이트 결과로 가기', RefreshCwIcon, 'update', () => updateActions.openResult(), { shown: (s) => !!s.updateSummary }),

  // Actions: the ones the title bar and the text screen already have.
  {
    id: 'translate', label: '미번역 줄 번역하기', icon: SparklesIcon, keywords: '새 문장 번역 맡기기 작업',
    blocked: (s) => (jobActive(s) ? BUSY : s.glossary?.confirmedAt == null ? '용어집을 먼저 확정하세요' : freshLines(s) === 0 ? '번역할 새 문장이 없어요' : null),
    run: () => { useApp.setView('text'); return useApp.translate(undefined); },
  },
  {
    id: 'review', label: '번역 전체 검수', icon: ScanSearchIcon, keywords: '검수하기 작업',
    blocked: (s) => (jobActive(s) ? BUSY : null),
    run: () => { useApp.setView('text'); useApp.openReview(); },
  },
  {
    id: 'build', label: '패치 빌드', icon: PackageIcon, keywords: '패치 만들기 zip',
    blocked: (s) => (s.build.kind === 'running' ? '패치를 만드는 중이에요' : null),
    run: () => useApp.build(),
  },
  {
    id: 'game', label: '게임 실행', icon: PlayIcon, keywords: '시험 플레이 테스트',
    blocked: (s) => (s.game?.state === 'running' ? '게임이 이미 실행 중이에요' : s.game?.state === 'preparing' ? '게임을 준비하는 중이에요' : null),
    run: () => eventActions.runGame(),
  },
  { id: 'update', label: '새 버전 가져오기', icon: RefreshCwIcon, keywords: '게임 업데이트', run: () => updateActions.open() },
  { id: 'close', label: '프로젝트 닫기', icon: LogOutIcon, run: () => useApp.closeProject() },
  // The app's own update, not the game's: it goes to the settings row that shows how the check goes.
  {
    id: 'appUpdate', label: '앱 업데이트 확인', icon: CircleArrowDownIcon, keywords: '프로그램 새 버전 앱 버전 설치',
    blocked: (s) => (s.appUpdate?.state.kind === 'unsupported' ? '설치한 앱에서만 확인할 수 있어요' : null),
    run: () => { useApp.setView('settings'); return useApp.checkAppUpdate(); },
  },

  // Table filters.
  filter('untranslated', '미번역 줄만 보기', ListFilterIcon, '번역 전'),
  filter('needs-review', '검토 필요 줄만 보기', ListFilterIcon, '검수 필요 검수 의견'),
  filter('error', '오류 있는 줄만 보기', TriangleAlertIcon, '검사 오류'),
  filter('overflow', '창 넘침 줄만 보기', ListFilterIcon, '대사창 넘침 줄바꿈'),
];

// ---- matching typed Korean ----

const INITIALS = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';

/** The initial consonants of each Hangul syllable (other characters as they are), so "ㅇㅇㅈ" finds 용어집. */
function initials(text: string): string {
  let out = '';
  for (const ch of text) {
    const c = ch.charCodeAt(0) - 0xac00;
    out += c >= 0 && c < 11172 ? INITIALS[Math.floor(c / 588)] : ch;
  }
  return out;
}

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, '');

/** Whether typed text finds this label: as part of it (spaces ignored), or by the initials of its syllables. */
export function matchesQuery(label: string, query: string): boolean {
  const q = squash(query);
  if (q === '') return true;
  const l = squash(label);
  return l.includes(q) || initials(l).includes(q);
}

/** The commands to list for what is typed, in table order. */
export function listCommands(s: AppState, query: string): Command[] {
  return COMMANDS.filter((c) => (c.shown ? c.shown(s) : true) && matchesQuery(`${c.label} ${c.keywords ?? ''}`, query));
}

/** "문장 찾기": the text screen with the typed text in its search box (the same as typing it there). */
export function findText(text: string): void {
  useApp.setView('text');
  useApp.setQuery({ text });
}

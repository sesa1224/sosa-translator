// Each screen laid out by what people come to it for: what they need first is largest and on top.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { App } from '../../src/renderer/App';
import { expect, test, vi } from 'vitest';
import { useApp } from '../../src/renderer/state';
import type { Glossary, Row } from '../../src/shared/api';
import { baseRows, errorRowId, eventsFake, fakeApi, installApi, itemId, openFakeWith, type FakeApi } from './fakeApi';

let api: FakeApi;
let user: UserEvent;

async function open(o: Parameters<typeof fakeApi>[0] = {}, select?: string) {
  cleanup();
  api = fakeApi(o);
  user = await openFakeWith(api, { select });
}

const before = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

// ---- left menu ----

/** Nine scopes of ten lines; scope n has n lines translated (scope 10 is done). */
function scopedRows(): Row[] {
  const rows: Row[] = [];
  for (let m = 1; m <= 10; m++) {
    for (let i = 0; i < 10; i++) {
      const done = i < m;
      rows.push({ id: `s${m}-${i}`, kind: 'dialogue', source: `台詞${m}-${i}`, target: done ? '번역' : null, status: done ? 'translated' : 'untranslated',
        needsDecision: false, file: `data/Map${String(m).padStart(3, '0')}.json`, location: `맵${m} · 이벤트1`, refCount: 1, usesProvisional: false });
    }
  }
  return rows;
}

test('왼쪽 메뉴는 번역 / 게임 / 결과 묶음으로 나뉘고 설정은 맨 아래에 따로', async () => {
  await open();
  const nav = screen.getByRole('navigation', { name: '작업 메뉴' });
  const heads = [...nav.querySelectorAll('.nav-head')].map((h) => h.textContent);
  expect(heads.slice(0, 3)).toEqual(['번역', '게임', '결과']);
  const names = within(nav).getAllByRole('button').filter((b) => b.classList.contains('nav-btn')).map((b) => b.querySelector('span')?.textContent);
  expect(names).toEqual(['텍스트', '용어집', '번역 지침', '판단 필요', '이벤트', '수정 내역', '이미지', '빌드 기록', '작업 기록', '설정']);
  // Settings comes after the scopes.
  const scopes = within(nav).getByRole('group', { name: '범위별 진행률' });
  expect(before(scopes, within(nav).getByRole('button', { name: '설정' }))).toBe(true);
});

test('범위별 진행률은 덜 끝난 순으로 여섯 개, 모두 보기로 펼치고 다 끝난 범위는 접힌 쪽에', async () => {
  await open({ rows: scopedRows() });
  const group = screen.getByRole('group', { name: '범위별 진행률' });
  const shown = () => within(group).getAllByRole('button', { pressed: false }).map((b) => b.querySelector('.scope-name')?.textContent);
  expect(shown()).toEqual(['맵1', '맵2', '맵3', '맵4', '맵5', '맵6']);
  await user.click(within(group).getByRole('button', { name: '모두 보기 4' }));
  expect(shown()).toEqual(['맵1', '맵2', '맵3', '맵4', '맵5', '맵6', '맵7', '맵8', '맵9', '맵10']);
  await user.click(within(group).getByRole('button', { name: '접기' }));
  expect(shown()).toHaveLength(6);
  // Pressing a scope still filters the table by it.
  await user.click(within(group).getByRole('button', { name: /맵3/ }));
  expect(useApp.get().query.file).toBe('data/Map003.json');
});

test('고른 범위는 접힌 쪽이어도 보인다', async () => {
  await open({ rows: scopedRows() });
  act(() => { useApp.toggleScope('data/Map010.json'); });
  const group = screen.getByRole('group', { name: '범위별 진행률' });
  expect(within(group).getByRole('button', { pressed: true })).toHaveTextContent('맵10');
});

// ---- text screen head ----

test('텍스트 머리: 제목·줄 수·보기 방식·내보내기는 한 줄, 번역 맡기기·검수·찾기는 다음 한 줄', async () => {
  await open({ glossary: { confirmedAt: '2026-11-13T00:00:00.000Z' } });
  const head = document.querySelector('.text-head') as HTMLElement;
  expect(within(head).getByRole('heading', { name: '텍스트' })).toBeVisible();
  expect(within(head).getByRole('group', { name: '보기 방식' })).toBeVisible();
  expect(within(head).getByRole('button', { name: /내보내기/ })).toBeVisible();
  const tools = document.querySelector('.text-tools') as HTMLElement;
  expect(within(tools).getByRole('button', { name: /번역 맡기기/ })).toHaveClass('primary');
  expect(within(tools).getByRole('button', { name: '번역 전체 검수' })).toBeVisible();
  expect(within(tools).getByLabelText('문장 검색')).toBeVisible();
  // The filters keep their three groups under the two lines.
  expect(before(tools, screen.getByRole('group', { name: '상태' }))).toBe(true);
});

// ---- item panel ----

test('항목 패널: 맨 위에 상태 알약, 번역 칸 바로 아래 동작 줄(승인이 주 단추), 그 아래 검사', async () => {
  await open({ rows: baseRows.map((r) => (r.id === itemId ? { ...r, target: '월광초', status: 'translated' as const } : r)) }, itemId);
  const where = document.querySelector('.item-where') as HTMLElement;
  expect(within(where).getByText('번역 완료')).toHaveClass('st', 'st-done');
  const box = screen.getByLabelText('번역');
  const actions = screen.getByRole('group', { name: '줄 동작' });
  const checks = screen.getByRole('group', { name: '검사' });
  expect(before(box, actions)).toBe(true);
  expect(before(actions, checks)).toBe(true);
  expect(within(actions).getByRole('button', { name: '승인' })).toHaveClass('primary');
  expect(within(actions).getByRole('button', { name: '저장' })).not.toHaveClass('primary');
  for (const name of ['다시 번역', '채팅으로 말하기', '지우기']) expect(within(actions).getByRole('button', { name })).toHaveClass('ghost');
  // A passed check carries the ok icon.
  expect(checks.querySelector('.ck-ok')).not.toBeNull();
});

test('항목 패널: 검사 문제는 줄마다 뜻 색 아이콘', async () => {
  await open({}, errorRowId);
  const checks = screen.getByRole('group', { name: '검사' });
  expect(checks.querySelector('.ck-err')).not.toBeNull();
  expect(within(checks).getByText(/제어 코드/)).toHaveClass('err-text');
});

// ---- glossary ----

const term = (id: string, source: string, target: string, status: 'confirmed' | 'provisional' = 'confirmed') =>
  ({ id, source, target, category: 'term' as const, status, candidates: status === 'provisional' ? [{ target, reason: '' }, { target: target + '2', reason: '' }] : [] });

async function openGlossary(g: Partial<Glossary>) {
  await open({ glossary: g });
  act(() => { useApp.setView('glossary'); });
  await screen.findByRole('heading', { name: '용어집' });
}

test('용어집 머리의 요약: 용어 수, 결정 필요(경고색), 인물 카드 수, 확정 여부를 큰 상태로', async () => {
  await openGlossary({ terms: [term('a', '月光草', '월광초'), term('b', '乙女', '오토메', 'provisional')], characters: [{ id: 'c', source: 'リナ', target: '리나', speech: '' }], confirmedAt: '2026-11-13T03:00:00.000Z' });
  const sum = screen.getByRole('group', { name: '용어집 요약' });
  expect(within(sum).getByText('용어').previousElementSibling).toHaveTextContent('2');
  const need = within(sum).getByText('결정 필요').closest('.stat');
  expect(need).toHaveClass('warn');
  expect(within(sum).getByText('인물 카드').previousElementSibling).toHaveTextContent('1');
  expect(within(sum).getByText('확정됨').closest('.stat')).toHaveClass('ok');
  expect(within(sum).getByText('2026-11-13')).toBeVisible();
  await openGlossary({ terms: [term('a', '月光草', '월광초')], confirmedAt: null });
  expect(within(screen.getByRole('group', { name: '용어집 요약' })).getByText('아직 확정 전').closest('.stat')).toHaveClass('warn');
});

test('용어집은 용어 / 인물 카드 / 형식 규칙을 한 번에 하나씩, 기본은 용어', async () => {
  await openGlossary({ terms: [term('a', '月光草', '월광초')], characters: [{ id: 'c', source: 'リナ', target: '리나', speech: '' }] });
  const tabs = screen.getByRole('group', { name: '용어집 보기' });
  expect(within(tabs).getByRole('button', { name: /^용어/ })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getAllByTestId('term-row')).toHaveLength(1);
  expect(screen.queryByLabelText('リナ 말투')).toBeNull();
  await user.click(within(tabs).getByRole('button', { name: /^인물 카드/ }));
  expect(screen.getByLabelText('リナ 말투')).toBeVisible();
  expect(screen.queryAllByTestId('term-row')).toHaveLength(0);
  await user.click(within(tabs).getByRole('button', { name: '형식 규칙' }));
  expect(screen.getByRole('switch', { name: '제어 코드 유지' })).toBeVisible();
});

test('결정이 필요한 용어는 맨 위 묶음에 모이고, 아래 목록에는 나머지만', async () => {
  await openGlossary({ terms: [term('a', '月光草', '월광초'), term('b', '乙女', '오토메', 'provisional')], confirmedAt: null });
  const need = screen.getByRole('region', { name: '결정이 필요한 용어' });
  expect(within(need).getByRole('region', { name: '乙女 결정' })).toBeVisible();
  expect(before(need, screen.getAllByTestId('term-row')[0])).toBe(true);
  expect(screen.getAllByTestId('term-row')).toHaveLength(1);
  // With terms, confirming is the main button.
  expect(screen.getByRole('button', { name: '용어집 확정' })).toHaveClass('primary');
});

test('용어가 없으면 가운데 빈 화면의 초안 받기가 주 단추', async () => {
  await openGlossary({ terms: [], confirmedAt: null });
  const es = document.querySelector('.es') as HTMLElement;
  expect(within(es).getByRole('button', { name: '초안 받기' })).toHaveClass('primary');
  expect(screen.getAllByRole('button', { name: '초안 받기' })).toHaveLength(1);
  expect(screen.getByRole('button', { name: '용어집 확정' })).not.toHaveClass('primary');
});

// ---- translation guide ----

test('번역 지침: ## 제목으로 만든 차례를 누르면 편집칸이 그 줄로 가고, 머리에 글자 수', async () => {
  await open();
  act(() => { useApp.setView('guide'); });
  await screen.findByRole('heading', { name: '번역 지침' });
  const box = () => screen.getByLabelText(/에 보내는 글$/) as HTMLTextAreaElement;
  await user.click(screen.getByRole('button', { name: '통째로 고치기' }));
  await vi.waitFor(() => expect(box().value).toContain('## 기본 태도'));
  const toc = screen.getByRole('navigation', { name: '차례' });
  await user.click(within(toc).getByRole('button', { name: '기본 태도' }));
  expect(box().selectionStart).toBe(box().value.indexOf('## 기본 태도'));
  expect(document.activeElement).toBe(box());
  expect(screen.getByText(`약 ${box().value.length.toLocaleString('ko-KR')}자 · 번역 묶음마다 함께 보내요`)).toBeVisible();
});

// ---- decisions ----

test('판단 필요: 정하지 않은 묶음이 위, 종류별 머리글, 정한 줄은 체크 타일과 ok 색 번역함', async () => {
  cleanup();
  api = fakeApi();
  api.groupsValue = [
    { key: 'param:Menu:title', label: 'Menu · title', kind: 'plugin-param', count: 3, samples: ['記録'], hints: { fileNames: 0 },
      decision: { translate: true, keep: { mode: 'whole' }, status: 'confirmed', by: 'user' } },
    { key: 'mv:D_TEXT', label: 'D_TEXT', kind: 'plugin-command', count: 2, samples: ['D_TEXT 筋力'], hints: { fileNames: 0 }, decision: null },
    { key: 'note:SG', label: 'SG説明', kind: 'note', count: 1, samples: ['夜に光る草'], hints: { fileNames: 0 },
      decision: { translate: true, keep: { mode: 'whole' }, status: 'suggested', by: 'claude', reason: '보이는 글' } },
  ];
  user = await openFakeWith(api);
  act(() => { void useApp.openDecisions(); });
  await screen.findByRole('heading', { name: '판단 필요' });
  const labels = (await screen.findAllByTestId('decision-card')).map((c) => c.getAttribute('aria-label'));
  expect(labels).toEqual(['D_TEXT', 'SG説明', 'Menu · title']);
  const open = screen.getByRole('region', { name: '정할 묶음' });
  expect(within(open).getByText('플러그인 커맨드', { selector: '.dv-kind' })).toBeVisible();
  expect(within(open).getByText('메모란', { selector: '.dv-kind' })).toBeVisible();
  const done = screen.getByRole('region', { name: '정한 묶음' });
  expect(within(done).getByText('플러그인 설정', { selector: '.dv-kind' })).toBeVisible();
  const menu = within(done).getByTestId('decision-card');
  expect(menu.querySelector('.tile')).toHaveClass('ok');
  expect(within(menu).getByRole('button', { name: '번역함' })).toHaveClass('on');
  // Claude's suggestion is new and not yet seen by a person: the info colour.
  expect(screen.getAllByTestId('decision-card')[1].querySelector('.tile')).toHaveClass('info');
});

// ---- patches ----

test('수정 내역: 적용된 수정은 종류 타일이 ok 색, 꺼진 수정은 흐림', async () => {
  cleanup();
  api = fakeApi();
  const ev = eventsFake(api);
  const body = { kind: 'event' as const, file: 'data/Map001.json', listPath: ['events', 1, 'pages', 0, 'list'], baseHash: 'h', ops: [] };
  ev.patches = [
    { id: 'p1', title: '켜진 수정', note: '', enabled: true, originalBug: false, createdBy: 'user', createdAt: '', body },
    { id: 'p2', title: '꺼진 수정', note: '', enabled: false, originalBug: false, createdBy: 'user', createdAt: '', body },
  ];
  ev.statuses = [{ id: 'p1', state: 'applied' }, { id: 'p2', state: 'disabled' }];
  user = await openFakeWith(api);
  await user.click(within(screen.getByRole('navigation', { name: '작업 메뉴' })).getByRole('button', { name: /^수정 내역/ }));
  const on = (await screen.findByDisplayValue('켜진 수정')).closest('.li') as HTMLElement;
  expect(on.querySelector('.tile')).toHaveClass('ok');
  const off = screen.getByDisplayValue('꺼진 수정').closest('.li') as HTMLElement;
  expect(off.querySelector('.tile')).toHaveClass('mute');
});

// ---- settings ----

test('설정: 왼쪽 차례로 그 묶음에 가고, 묶음 안은 이름·설명 왼쪽 조절 칸 오른쪽의 줄 목록', async () => {
  await open();
  act(() => { useApp.setView('settings'); });
  await screen.findByRole('heading', { name: '설정' });
  const toc = screen.getByRole('navigation', { name: '설정 차례' });
  const names = within(toc).getAllByRole('button').map((b) => b.textContent);
  expect(names).toEqual(['테마', '움직임', '단계별 모델', '모델', 'Claude CLI', '프로젝트 폴더 위치', '게임 폰트', '창 크기와 줄바꿈', '폰트를 게임에 넣기', '이미지']);
  const go = vi.fn();
  const target = document.getElementById('set-stages')!.closest('section') as HTMLElement;
  target.scrollIntoView = go;
  await user.click(within(toc).getByRole('button', { name: '단계별 모델' }));
  expect(go).toHaveBeenCalled();
  // A setting is a row: the words on the left, the control on the right.
  const row = screen.getByLabelText('대본 읽기').closest('.set-row') as HTMLElement;
  expect(row.querySelector('.set-l')).toHaveTextContent('대본 읽기');
  expect(row.querySelector('.set-c select')).toBe(screen.getByLabelText('대본 읽기'));
  expect(screen.getByRole('switch', { name: '움직임 켜기' }).closest('.set-row')).not.toBeNull();
});

// ---- project picker ----

test('프로젝트 고르기: 가장 최근 프로젝트를 이어서 하기로 크게, 나머지는 한 줄 목록, 새 프로젝트 영역은 아래', async () => {
  cleanup();
  api = fakeApi();
  api.project.list = async () => [
    { dir: 'C:/p/옛것', name: '옛것', engine: 'MV', touchedAt: 1000 },
    { dir: 'C:/p/약초원', name: '약초원', engine: 'MZ', touchedAt: 5000 },
    { dir: 'C:/p/기사', name: '기사', engine: 'MV', touchedAt: 3000 },
  ];
  installApi(api);
  render(<App />);
  const resume = await screen.findByRole('region', { name: '이어서 하기' });
  expect(within(resume).getByText('약초원')).toHaveClass('picker-name');
  expect(within(resume).getByText('MZ')).toHaveClass('eng');
  expect(within(resume).getByRole('button', { name: '약초원 열기' })).toHaveClass('primary');
  const rest = screen.getByRole('region', { name: '기존 프로젝트' });
  expect(within(rest).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['기사 열기', '옛것 열기']);
  const fresh = screen.getByRole('region', { name: '새 프로젝트' });
  expect(fresh).toHaveClass('drop-zone');
  expect(within(fresh).getByRole('button', { name: '게임 폴더 고르기' })).not.toHaveClass('primary');
  expect(before(rest, fresh)).toBe(true);
  await userEvent.setup().click(within(resume).getByRole('button', { name: '약초원 열기' }));
  expect(api.calls).toContainEqual(['project.open', 'C:/p/약초원']);
});

test('프로젝트가 없으면 새 프로젝트 영역이 위에, 고르기가 주 단추', async () => {
  cleanup();
  api = fakeApi();
  installApi(api);
  render(<App />);
  const fresh = await screen.findByRole('region', { name: '새 프로젝트' });
  expect(within(fresh).getByRole('button', { name: '게임 폴더 고르기' })).toHaveClass('primary');
  expect(screen.queryByRole('region', { name: '이어서 하기' })).toBeNull();
});

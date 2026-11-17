// Each screen laid out by what people come to it for: what they need first is largest and on top.
import { act, cleanup, screen, within } from '@testing-library/react';
import { type UserEvent } from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { useApp } from '../../src/renderer/state';
import type { Row } from '../../src/shared/api';
import { baseRows, errorRowId, fakeApi, itemId, openFakeWith, type FakeApi } from './fakeApi';

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

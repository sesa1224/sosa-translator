import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { useApp } from '../../src/renderer/state';
import type { EventDetail, EventLine, Patch } from '../../src/shared/api';
import { eventsFake, fakeApi, openFakeWith, type FakeApi } from './fakeApi';

const MAP = 'data/Map001.json';
const LP1 = ['events', 1, 'pages', 0, 'list'];
const LP2 = ['events', 2, 'pages', 0, 'list'];
const line = (index: number, text: string, code: number, o: Partial<EventLine> = {}): EventLine => ({ index, indent: 0, text, code, count: 1, ...o });

const EV1: EventDetail = {
  label: '맵1 · 이벤트1 · 1페이지', condition: '스위치 3 [문 열림] 켜짐', hash: 'h1', raw: [],
  lines: [
    line(0, '대사 [リナ] あれ？ / こんな夜に', 101, { count: 3 }),
    line(3, '선택지: いいよ / また今度', 102),
    line(4, '└ "いいよ" 를 고르면', 402),
    line(5, '대사 [リナ] やった！', 101, { indent: 1, count: 2 }),
    line(11, '스위치 45 [기록1 완료] = 켬', 121),
  ],
};
const EV2: EventDetail = { label: '맵1 · 이벤트2 · 1페이지', condition: null, hash: 'h2', raw: [], lines: [line(0, '화면 페이드인', 222)] };

let api: FakeApi;
beforeEach(() => {
  api = fakeApi();
  const ev = eventsFake(api);
  ev.files = [{ file: MAP, label: '맵1 [MAP001]', events: 2 }, { file: 'data/CommonEvents.json', label: '커먼이벤트', events: 1 }];
  ev.lists = {
    [MAP]: [
      { key: JSON.stringify(LP1), label: '이벤트 1 · 1페이지', listPath: LP1, pages: 1, condition: '스위치 3 [문 열림] 켜짐', commandCount: 13 },
      { key: JSON.stringify(LP2), label: '이벤트 2 · 1페이지', listPath: LP2, pages: 1, condition: null, commandCount: 2 },
    ],
  };
  ev.read = (_file, listPath) => (JSON.stringify(listPath) === JSON.stringify(LP2) ? EV2 : EV1);
  ev.usage = () => [
    { file: MAP, listPath: LP1, label: '맵1 · 이벤트1 · 1페이지', index: 11, text: '스위치 45 [기록1 완료] = 켬', access: 'write' },
    { file: MAP, listPath: LP2, label: '맵1 · 이벤트2 · 1페이지', index: -1, text: '페이지 조건', access: 'read' },
    { file: 'data/CommonEvents.json', listPath: [1, 'list'], label: '커먼이벤트1', index: 0, text: '만약 스위치 45 이 켜짐이면', access: 'read' },
  ];
});

async function openEvent(label = '이벤트 1 · 1페이지') {
  const user = await openFakeWith(api);
  await user.click(screen.getByRole('button', { name: /^이벤트/ }));
  await user.click(await screen.findByRole('button', { name: /맵1 \[MAP001\]/ }));
  await user.click(await screen.findByRole('button', { name: new RegExp(`^${label}`) }));
  // A line of dialogue shows its speaker as a pill apart from the words.
  await screen.findByText('あれ？ / こんな夜に');
  return user;
}

const rowOf = (n: number) => document.querySelector(`[data-line="${n}"]`) as HTMLElement;

test('파일과 이벤트를 고르면 풀어쓴 줄이 원본 번호와 함께 보인다', async () => {
  await openEvent();
  expect(api.calls).toContainEqual(['events.read', MAP, LP1]);
  expect(within(rowOf(3)).getByText('3')).toBeInTheDocument();
  expect(rowOf(3)).toHaveTextContent('선택지: いいよ / また今度');
  expect(rowOf(11)).toHaveTextContent('11');
  expect(screen.getByText('조건: 스위치 3 [문 열림] 켜짐')).toBeInTheDocument();
  // The number stays in its own margin; only the command moves in with its indent.
  const body = (n: number) => rowOf(n).querySelector('.ev-body') as HTMLElement;
  expect(body(5).style.paddingLeft).not.toBe(body(3).style.paddingLeft);
});

test('명령은 종류별로 구별된다: 대사(화자 알약), 선택지와 분기, 플러그인 커맨드, 그 밖', async () => {
  eventsFake(api).read = () => ({ ...EV1, lines: [...EV1.lines, line(12, '플러그인 커맨드: ShowRecord 記録', 356)] });
  await openEvent();
  expect(rowOf(0)).toHaveClass('ev-k-talk');
  expect(within(rowOf(0)).getByText('リナ')).toHaveClass('ev-who');
  expect(rowOf(3)).toHaveClass('ev-k-flow');
  expect(rowOf(4)).toHaveClass('ev-k-flow');
  expect(rowOf(11)).toHaveClass('ev-k-misc');
  expect(rowOf(12)).toHaveClass('ev-k-plugin');
  // The number comes first, in the quiet fixed-width margin, before the indented body.
  expect(rowOf(5).firstElementChild).toHaveClass('ev-num');
  expect(rowOf(5).querySelector('.ev-body')).toHaveStyle({ '--ind': '1' });
});

test('대사와 선택지 안의 제어문자는 텍스트 표처럼 칩으로, 플러그인 커맨드는 글자 그대로', async () => {
  eventsFake(api).read = () => ({ ...EV1, lines: [
    line(0, '대사 [\\N[1]] あれ？\\C[2]月光草\\C[0] / こんな夜に', 101, { count: 3 }),
    line(3, '선택지: \\C[4]いいよ\\C[0] / また今度', 102),
    line(4, '└ "\\C[4]いいよ\\C[0]" 를 고르면', 402),
    line(11, '스위치 45 [기록1 완료] = 켬', 121),
    line(12, '플러그인 커맨드: Show \\C[2]', 356),
  ] });
  const user = await openFakeWith(api);
  await user.click(screen.getByRole('button', { name: /^이벤트/ }));
  await user.click(await screen.findByRole('button', { name: /맵1 \[MAP001\]/ }));
  await user.click(await screen.findByRole('button', { name: /^이벤트 1 · 1페이지/ }));
  await waitFor(() => expect(rowOf(0)).not.toBeNull());
  const chips = (n: number) => [...rowOf(n).querySelectorAll('code.chip')].map((c) => c.textContent);
  expect(chips(0)).toEqual(['\\N[1]', '\\C[2]', '\\C[0]']);
  expect(rowOf(0).querySelector('.ev-who code.chip')).not.toBeNull();
  expect(chips(3)).toEqual(['\\C[4]', '\\C[0]']);
  expect(chips(4)).toEqual(['\\C[4]', '\\C[0]']);
  expect(chips(12)).toEqual([]);
  // The switch name is still a button that looks up where it is used.
  expect(within(rowOf(11)).getByRole('button', { name: '스위치 45 [기록1 완료]' })).toBeInTheDocument();
});

test('수정이 걸린 이벤트: 끼워 넣은 줄에 + 와 강조, 지운 줄에 취소선', async () => {
  const p: Patch = {
    id: 'p1', title: '스위치 켜기', note: '', enabled: true, originalBug: true, createdBy: 'user', createdAt: '',
    body: { kind: 'event', file: MAP, listPath: LP1, baseHash: 'h1', ops: [{ op: 'insert', after: 3, commands: [{ code: 121, indent: 0, parameters: [45, 45, 0] }] }, { op: 'delete', at: 11 }] },
  };
  eventsFake(api).patches = [p];
  eventsFake(api).statuses = [{ id: 'p1', state: 'applied' }];
  await openEvent();
  const added = await screen.findByText(/^\+ 스위치 45/);
  const addRow = added.closest('.ev-line') as HTMLElement;
  expect(addRow).toHaveClass('ev-add');
  expect(addRow.compareDocumentPosition(rowOf(4)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(rowOf(11)).toHaveClass('ev-del');
  expect(screen.getByText(/초록색 줄은 원본에 없던 줄이에요\. 수정 내역 '스위치 켜기'으로 기록됐어요\./)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '수정 내역 보기' })).toBeInTheDocument();
});

test('스위치 이름을 누르면 사용처가 뜨고 결과를 누르면 그 이벤트가 열린다', async () => {
  const user = await openEvent();
  await user.click(screen.getByRole('button', { name: '스위치 45 [기록1 완료]' }));
  expect(api.calls).toContainEqual(['events.usage', { type: 'switch', id: 45 }]);
  const panel = await screen.findByRole('region', { name: '사용처' });
  expect(within(panel).getByText('스위치 45 [기록1 완료] 를 쓰는 곳 3')).toBeInTheDocument();
  const items = within(panel).getAllByRole('button').filter((b) => b.getAttribute('aria-label') !== '사용처 닫기');
  expect(items.map((b) => b.textContent)).toEqual([
    expect.stringContaining('켬'), expect.stringContaining('조건'), expect.stringContaining('조건'),
  ]);
  await user.click(items[1]);
  await waitFor(() => expect(api.calls).toContainEqual(['events.read', MAP, LP2]));
  expect(await screen.findByText('화면 페이드인')).toBeInTheDocument();
});

test('이 줄 아래에 스위치 켜기를 끼워 넣으면 patches.add 가 불린다', async () => {
  const user = await openEvent();
  await user.click(within(rowOf(3)).getByRole('button', { name: '이 줄 아래에 끼워 넣기' }));
  await user.selectOptions(screen.getByLabelText('끼워 넣을 것'), 'switch-on');
  await user.clear(screen.getByLabelText('스위치 번호'));
  await user.type(screen.getByLabelText('스위치 번호'), '45');
  await user.type(screen.getByLabelText('수정 제목'), '스위치 켜기');
  await user.click(screen.getByRole('button', { name: '수정으로 기록' }));
  await waitFor(() => expect(api.calls.find((c) => c[0] === 'patches.add')).toBeTruthy());
  const call = api.calls.find((c) => c[0] === 'patches.add')!;
  expect(call[1]).toEqual({
    title: '스위치 켜기',
    body: { kind: 'event', file: MAP, listPath: LP1, baseHash: 'h1', ops: [{ op: 'insert', after: 3, commands: [{ code: 121, indent: 0, parameters: [45, 45, 0] }] }] },
  });
});

test('이미 수정이 있는 목록이면 patches.update 로 연산을 더한다', async () => {
  const p: Patch = {
    id: 'p1', title: '앞선 수정', note: '', enabled: true, originalBug: false, createdBy: 'user', createdAt: '',
    body: { kind: 'event', file: MAP, listPath: LP1, baseHash: 'h1', ops: [{ op: 'delete', at: 4 }] },
  };
  eventsFake(api).patches = [p];
  eventsFake(api).statuses = [{ id: 'p1', state: 'applied' }];
  const user = await openEvent();
  await user.click(within(rowOf(5)).getByRole('button', { name: '이 줄 아래에 끼워 넣기' }));
  await user.selectOptions(screen.getByLabelText('끼워 넣을 것'), 'fade-in');
  expect(screen.queryByLabelText('수정 제목')).toBeNull();
  await user.click(screen.getByRole('button', { name: '수정으로 기록' }));
  await waitFor(() => expect(api.calls.find((c) => c[0] === 'patches.update')).toBeTruthy());
  const call = api.calls.find((c) => c[0] === 'patches.update')!;
  expect(call[1]).toBe('p1');
  expect((call[2] as any).body.ops).toEqual([{ op: 'delete', at: 4 }, { op: 'insert', after: 6, commands: [{ code: 222, indent: 1, parameters: [] }] }]);
});

test('이 줄 지우기: 합쳐진 대사는 묶음의 커맨드를 모두 지운다', async () => {
  const user = await openEvent();
  await user.click(within(rowOf(0)).getByRole('button', { name: '이 줄 지우기' }));
  await user.type(screen.getByLabelText('수정 제목'), '대사 빼기');
  await user.click(screen.getByRole('button', { name: '수정으로 기록' }));
  await waitFor(() => expect(api.calls.find((c) => c[0] === 'patches.add')).toBeTruthy());
  const call = api.calls.find((c) => c[0] === 'patches.add')!;
  expect((call[1] as any).body.ops).toEqual([{ op: 'delete', at: 0 }, { op: 'delete', at: 1 }, { op: 'delete', at: 2 }]);
});

test('채팅으로 말하기는 채팅 탭으로 가고 이벤트를 붙인다', async () => {
  const user = await openEvent();
  await user.click(screen.getByRole('button', { name: '채팅으로 말하기' }));
  expect(useApp.get().rightTab).toBe('chat');
  expect(screen.getByText('이벤트 · 맵1 · 이벤트1 · 1페이지')).toBeInTheDocument();
  await user.type(screen.getByLabelText('메시지'), '여기 고쳐줘{Enter}');
  await waitFor(() => expect(api.calls.find((c) => c[0] === 'chat.send')).toBeTruthy());
  const sent = api.calls.find((c) => c[0] === 'chat.send')!;
  expect(sent[1]).toBe(`[이벤트] file=${MAP} listPath=${JSON.stringify(LP1)} 라벨=맵1 · 이벤트1 · 1페이지\n\n여기 고쳐줘`);
});

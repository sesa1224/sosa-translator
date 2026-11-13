import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { App } from '../../src/renderer/App';
import { expect, test } from 'vitest';
import { useApp } from '../../src/renderer/state';
import type { ImportPlan, Row } from '../../src/shared/api';
import { baseRows, fakeApi, installApi, type FakeApi } from './fakeApi';

let api: FakeApi;
let user: UserEvent;

const titleRow: Row = { id: 'r-title', kind: 'system', source: '霧の薬草園', target: null, status: 'untranslated', needsDecision: false, file: 'data/System.json', location: '시스템', refCount: 1, usesProvisional: false, decision: null, external: false };
const dRow = (id: string, decision: Row['decision'], target: string | null = null, extra: Partial<Row> = {}): Row => ({
  id, kind: 'plugin-command', source: `ShowRecord 記録${id}`, target, status: target ? 'needs-review' : 'untranslated', needsDecision: true,
  file: 'data/Map001.json', location: '맵1 · 이벤트1', refCount: 1, usesProvisional: false, decision, external: false, decisionKey: 'mv:ShowRecord', ...extra,
});
const decisionRows: Row[] = [
  dRow('d-none', 'none'),
  dRow('d-skip', 'skip', 'ShowRecord 기록'),
  dRow('d-stx', 'suggested-translate'),
  dRow('d-ssk', 'suggested-skip'),
  dRow('d-tr', 'translate', 'ShowRecord 번역됨'),
];

async function open(rows: Row[] = [...baseRows, titleRow], select?: string) {
  cleanup();
  api = fakeApi({ rows });
  // Like openFakeWith, but the title may also show in the table and the title field.
  api.opened = true;
  installApi(api);
  user = userEvent.setup();
  render(<App />);
  await screen.findAllByText('霧の薬草園');
  if (select) await act(async () => { await useApp.selectRow(select); });
}

test('게임 제목: Enter 로 저장, Esc 는 취소', async () => {
  await open();
  expect(screen.getByText('제목 번역 없음')).toBeVisible();
  expect(screen.getByText('작업표시줄과 타이틀 화면에 이 이름이 보여요')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '게임 제목 고치기' }));
  await user.type(screen.getByLabelText('번역 제목'), '다른 제목{Escape}');
  expect(api.calls.some((c) => c[0] === 'project.setGameTitle')).toBe(false);
  expect(screen.queryByLabelText('번역 제목')).toBeNull();
  await user.click(screen.getByRole('button', { name: '게임 제목 고치기' }));
  await user.type(screen.getByLabelText('번역 제목'), '안개 약초원{Enter}');
  expect(api.calls).toContainEqual(['project.setGameTitle', '안개 약초원']);
});

test('번역 제목이 있으면 원래 제목 아래에 보인다', async () => {
  await open([...baseRows, { ...titleRow, target: '안개 약초원', status: 'approved' }]);
  expect(within(screen.getByRole('banner')).getByText('안개 약초원')).toBeVisible();
});

test('내보내기는 지금 필터의 id 로, 0개면 꺼진다', async () => {
  await open();
  await user.click(screen.getByRole('button', { name: /^오류 1/ }));
  await user.click(screen.getByRole('button', { name: '내보내기 (1)' }));
  expect(api.calls).toContainEqual(['exchange.export', ['r-item-desc']]);
  await user.type(screen.getByLabelText('문장 검색'), '없는 글자');
  await screen.findByText('맞는 줄이 없어요');
  expect(screen.getByRole('button', { name: '내보내기 (0)' })).toBeDisabled();
});

test('가져오기 대화상자: 네 가지 수와 기본 건너뛰기', async () => {
  await open();
  const plan: ImportPlan = {
    ok: [{ id: 'r-actor', target: '리나', issues: [] }, { id: 'r-map-2', target: '해냈다', issues: [{ rule: 'leftover-japanese', severity: 'error', message: 'x' }] }],
    conflicts: [{ id: 'r-item-desc', current: 'a', incoming: 'b' }],
    unknownIds: ['zz1', 'zz2', 'zz3'],
    invalid: 4,
  };
  api.importPlanValue = plan;
  await user.click(screen.getByRole('button', { name: '가져오기' }));
  const dlg = await screen.findByRole('dialog', { name: '외부 번역 가져오기' });
  expect(within(dlg).getByText('넣을 수 있는 번역 2개 · 그중 검사 오류 1개')).toBeVisible();
  expect(within(dlg).getByText('이미 번역이 있고 내용이 다른 항목 1개')).toBeVisible();
  expect(within(dlg).getByText('프로젝트에 없는 id 3개')).toBeVisible();
  expect(within(dlg).getByText('모양이 틀린 항목 4개')).toBeVisible();
  expect(within(dlg).getByLabelText('건너뛰기')).toBeChecked();
  await user.click(within(dlg).getByRole('button', { name: '가져오기' }));
  expect(api.calls).toContainEqual(['exchange.applyImport', false]);
});

test('번역 칸의 글이 결정 상태에 따라 다섯 가지', async () => {
  await open(decisionRows);   // few rows: all of them are drawn
  const cell = (id: string) => {
    const row = screen.getAllByRole('row').find((r) => within(r).queryByText(`ShowRecord 記録${id}`))!;
    return within(row).getAllByRole('cell')[3].textContent;
  };
  expect(cell('d-none')).toBe('판단 대기');
  expect(cell('d-skip')).toBe('번역 안 함');
  expect(cell('d-stx')).toBe('추천: 번역함');
  expect(cell('d-ssk')).toBe('추천: 번역 안 함');
  expect(cell('d-tr')).toBe('ShowRecord 번역됨');
});

test('외부 번역·번역 안 함 칩은 있을 때만', async () => {
  await open([...baseRows, ...decisionRows, { ...titleRow, target: '안개', external: true, status: 'needs-review' }]);
  expect(screen.getByRole('button', { name: '외부 번역 1' })).toBeVisible();
  expect(screen.getByRole('button', { name: '번역 안 함 1' })).toBeVisible();
  await open([...baseRows]);
  expect(screen.queryByRole('button', { name: /외부 번역/ })).toBeNull();
});

test('항목 탭: 이 줄만 따로 정하기, 묶음 보기, 외부 번역 표시', async () => {
  await open([...baseRows, ...decisionRows], 'd-none');
  const panel = screen.getByRole('tabpanel');
  expect(within(panel).getByText('ShowRecord', { selector: '.mono' })).toBeVisible();
  await user.click(within(panel).getByRole('button', { name: '이 줄만 따로 정하기' }));
  await user.click(within(panel).getByRole('button', { name: '이 줄 번역 안 함' }));
  expect(api.calls).toContainEqual(['decisions.set', 'unit:d-none', { translate: false, keep: { mode: 'whole' } }]);
  await user.click(within(panel).getByRole('button', { name: '묶음 보기' }));
  expect(useApp.get().view).toBe('decisions');
  expect(useApp.get().decisionFocus).toBe('mv:ShowRecord');

  await open([...baseRows, { ...titleRow, target: '안개', external: true, status: 'needs-review' }], 'r-title');
  expect(within(screen.getByRole('tabpanel')).getByText('외부에서 가져온 번역')).toBeVisible();
});

test('설정에 판단 필요 추천 모델 칸', async () => {
  await open();
  act(() => { useApp.setView('settings'); });
  const sel = await screen.findByLabelText('판단 필요 추천');
  await user.selectOptions(sel, 'claude-haiku-5-5');
  expect(api.calls.some((c) => c[0] === 'settings.set' && (c[1] as any).stageModels?.decide === 'claude-haiku-5-5')).toBe(true);
});

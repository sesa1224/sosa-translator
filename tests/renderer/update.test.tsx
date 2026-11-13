// 새 버전 가져오기 화면 (계획 6)
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { useApp } from '../../src/renderer/state';
import { computeScopes, computeStats } from '../../src/shared/rows';
import type { Row } from '../../src/shared/api';
import { baseRows, fakeApi, openFakeWith, sampleSummary, updateFake, type FakeApi } from './fakeApi';

let api: FakeApi;
beforeEach(() => {
  api = fakeApi();
});

async function openDialog() {
  const user = await openFakeWith(api);
  await user.click(screen.getByRole('button', { name: '새 버전 가져오기' }));
  const dialog = await screen.findByRole('dialog', { name: '새 버전 가져오기' });
  expect(within(dialog).getByText('게임의 새 버전 폴더를 고르거나 여기에 끌어다 놓으세요')).toBeVisible();
  return { user, dialog };
}

test('폴더를 고르면 확인하고 버전 이름을 채운 뒤 가져온다', async () => {
  updateFake(api).summary = sampleSummary();
  const { user, dialog } = await openDialog();
  expect(within(dialog).getByText('지금 버전: v1')).toBeVisible();
  expect(within(dialog).getByRole('button', { name: '가져오기' })).toBeDisabled();
  await user.click(within(dialog).getByRole('button', { name: '폴더 고르기' }));
  expect(api.calls).toContainEqual(['update.inspect', 'C:/games/v2']);
  expect(((await within(dialog).findByLabelText('버전 이름')) as HTMLInputElement).value).toBe('1.1');
  expect(within(dialog).getByText('가져오기 전 상태를 남겨 두어서 되돌릴 수 있어요. 원본 게임 폴더는 바꾸지 않아요.')).toBeVisible();
  await user.click(within(dialog).getByRole('button', { name: '가져오기' }));
  expect(api.calls).toContainEqual(['update.import', 'C:/games/v2', '1.1']);
  expect(await screen.findByRole('heading', { name: 'v1 → 1.1' })).toBeVisible();
  expect(screen.queryByRole('dialog', { name: '새 버전 가져오기' })).toBeNull();
});

test('끌어다 놓은 폴더도 확인한다', async () => {
  const { dialog } = await openDialog();
  const dataTransfer = { files: [Object.assign(new File([''], 'v2'), { path: 'C:/games/dropped' })], types: ['Files'] };
  fireEvent.dragOver(dialog, { dataTransfer });
  fireEvent.drop(dialog, { dataTransfer });
  await waitFor(() => expect(api.calls).toContainEqual(['update.inspect', 'C:/games/dropped']));
});

test('다른 게임 같으면 이유가 보이고 체크해야 가져오기가 켜진다', async () => {
  updateFake(api).inspect = () => ({ ok: true, engine: 'MV', title: '別のゲーム', suggestedLabel: 'v2', sameGame: false, overlap: 0.1, reason: '엔진이 달라요(지금 MZ, 새 폴더 MV)' });
  const { user, dialog } = await openDialog();
  await user.click(within(dialog).getByRole('button', { name: '폴더 고르기' }));
  expect(await within(dialog).findByText(/엔진이 달라요\(지금 MZ, 새 폴더 MV\)/)).toBeVisible();
  const take = within(dialog).getByRole('button', { name: '가져오기' });
  expect(take).toBeDisabled();
  await user.click(within(dialog).getByRole('checkbox', { name: '그래도 가져오기' }));
  expect(take).toBeEnabled();
});

test('가져오기가 실패하면 오류와 프로젝트는 그대로라는 글', async () => {
  updateFake(api).importError = '추출 실패';
  const { user, dialog } = await openDialog();
  await user.click(within(dialog).getByRole('button', { name: '폴더 고르기' }));
  await within(dialog).findByLabelText('버전 이름');
  await user.click(within(dialog).getByRole('button', { name: '가져오기' }));
  expect(await within(dialog).findByText('추출 실패')).toBeVisible();
  expect(within(dialog).getByText('프로젝트는 그대로예요')).toBeVisible();
});

async function openResult() {
  updateFake(api).summary = sampleSummary();
  const user = await openFakeWith(api);
  await user.click(await within(screen.getByRole('navigation', { name: '작업 메뉴' })).findByRole('button', { name: '업데이트 결과' }));
  await screen.findByRole('heading', { name: 'v1 → 1.1' });
  return user;
}

test('결과 화면의 카드가 요약의 숫자를 보인다', async () => {
  await openResult();
  const card = (name: string) => within(screen.getByRole('region', { name }));
  expect(card('그대로인 문장').getByText('그대로인 문장 40개 · 번역 30개를 이어받았어요')).toBeVisible();
  expect(card('새 문장').getByText('새 문장 5개')).toBeVisible();
  expect(card('바뀐 문장').getByText('바뀐 문장 3개 · 이전 번역을 참고로 붙였어요')).toBeVisible();
  expect(card('바뀐 문장').getByText('그중 1개는 문장부호만 달라서 이전 번역을 미리 넣었어요(검토 필요)')).toBeVisible();
  expect(card('사라진 문장').getByText('사라진 문장 2개 · 번역 1개는 보관했어요')).toBeVisible();
  expect(card('수정').getByText('수정: 그대로 1 · 자리를 옮김 1 · 충돌 1')).toBeVisible();
  expect(card('수정').getByText('문 열기')).toBeVisible();
  expect(card('수정').getByText('수정이 가리키던 줄이 새 버전에 없어요(6번: 대사 やった！)')).toBeVisible();
  expect(card('그림').getByText('원본이 바뀐 그림 1장')).toBeVisible();
  expect(card('그림').getByText('새 그림 4장')).toBeVisible();
  expect(card('판단 필요').getByText('판단 필요: 새 묶음 2개')).toBeVisible();
  expect(within(screen.getByRole('region', { name: '경고' })).getByText('따옴표가 닫히지 않은 문자열이 있습니다')).toBeVisible();
});

test('바뀐 문장 보기는 텍스트 화면의 바뀐 문장 필터로', async () => {
  const user = await openResult();
  await user.click(screen.getByRole('button', { name: '바뀐 문장 보기' }));
  await screen.findByRole('heading', { name: '텍스트' });
  expect(useApp.get().query.status).toBe('changed');
});

test('Claude에게 맡기기는 채팅 입력칸을 채운다', async () => {
  const user = await openResult();
  await user.click(screen.getByRole('button', { name: 'Claude에게 맡기기' }));
  await waitFor(() => expect((document.getElementById('msg') as HTMLTextAreaElement).value).toBe('업데이트 뒤 충돌난 수정을 고쳐줘'));
});

test('되돌리기는 확인을 누른 뒤에만', async () => {
  const user = await openResult();
  await user.click(screen.getByRole('button', { name: '이 업데이트 되돌리기' }));
  const confirm = await screen.findByRole('alertdialog');
  expect(within(confirm).getByText('이 업데이트 뒤에 한 번역과 수정도 함께 사라져요')).toBeVisible();
  await user.click(within(confirm).getByRole('button', { name: '취소' }));
  expect(api.calls.some((c) => c[0] === 'update.rollback')).toBe(false);
  await user.click(screen.getByRole('button', { name: '이 업데이트 되돌리기' }));
  await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '되돌리기' }));
  await waitFor(() => expect(api.calls.some((c) => c[0] === 'update.rollback')).toBe(true));
});

const changedRow: Row = {
  id: 'r-changed', kind: 'dialogue', source: 'こんな夜更けに来るなんて', target: null, status: 'untranslated', needsDecision: false,
  file: 'data/Map001.json', location: '맵1 · 이벤트1', refCount: 1, usesProvisional: false,
  previous: { source: 'こんな夜に来るなんて', target: '이런 밤에 오다니' },
};

test('항목 탭: 이전 문장과 번역이 보이고 바뀐 글자만 강조, 가져오기는 편집 칸만 채운다', async () => {
  api = fakeApi({ rows: [...baseRows, changedRow] });
  const user = await openFakeWith(api, { select: 'r-changed' });
  const box = within(await screen.findByRole('region', { name: '이전 버전의 문장' }));
  expect(box.getByLabelText('이전 원문').textContent).toBe('こんな夜に来るなんて');
  expect(box.getByLabelText('지금 원문').textContent).toBe('こんな夜更けに来るなんて');
  const added = box.getByLabelText('지금 원문').querySelectorAll('ins');
  expect([...added].map((e) => e.textContent)).toEqual(['更け']);
  expect(box.getByLabelText('이전 원문').querySelectorAll('del')).toHaveLength(0);
  expect(box.getByText('이런 밤에 오다니')).toBeVisible();
  await user.click(box.getByRole('button', { name: '이전 번역 가져오기' }));
  expect((screen.getByLabelText('번역') as HTMLTextAreaElement).value).toBe('이런 밤에 오다니');
  expect(api.calls.some((c) => c[0] === 'unit.setTranslation')).toBe(false);
});

test('미리 채운 줄에는 확인하고 승인하라는 글', async () => {
  api = fakeApi({ rows: [...baseRows, { ...changedRow, source: 'やった！！', previous: { source: 'やった！', target: '해냈다!' }, target: '해냈다!', status: 'needs-review', carried: true }] });
  await openFakeWith(api, { select: 'r-changed' });
  expect(await screen.findByText('문장부호만 달라서 이전 번역을 넣어 뒀어요. 확인하고 승인하세요.')).toBeVisible();
});

test('바뀐 문장 칩은 0이면 숨고, 있으면 그 줄들만 보인다', async () => {
  const user = await openFakeWith(api);
  expect(screen.queryByRole('button', { name: /^바뀐 문장 / })).toBeNull();
  act(() => { useApp.setView('text'); });
  const rows = [...baseRows, changedRow];
  api.emit('project:reloaded', { meta: (await api.project.snapshot())!.meta, gameTitle: '霧の薬草園', rows, stats: computeStats(rows), scopes: computeScopes(rows) });
  await user.click(await screen.findByRole('button', { name: '바뀐 문장 1' }));
  expect(screen.getAllByRole('row').some((r) => r.textContent?.includes('こんな夜更けに来るなんて'))).toBe(true);
  expect(screen.getAllByRole('row').some((r) => r.textContent?.includes('月光草'))).toBe(false);
});

test('project:reloaded 뒤 표의 줄이 새 스냅숏의 것이고 선택과 필터가 비워진다', async () => {
  await openFakeWith(api, { select: baseRows[1].id });
  act(() => { useApp.setQuery({ status: 'untranslated', text: '月' }); });
  const rows: Row[] = [{ ...changedRow, id: 'only', source: '星の砂', previous: undefined }];
  api.emit('project:reloaded', { meta: { ...(await api.project.snapshot())!.meta, current: 'v2' }, gameTitle: '霧の薬草園', rows, stats: computeStats(rows), scopes: computeScopes(rows) });
  await waitFor(() => expect(useApp.get().rowOrder).toEqual(['only']));
  expect(useApp.get().selectedId).toBeNull();
  expect(useApp.get().query).toEqual({ status: 'all' });
  expect(screen.getAllByRole('row').some((r) => r.textContent?.includes('星の砂'))).toBe(true);
});

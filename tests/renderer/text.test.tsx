import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { type UserEvent } from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';
import { CodeText } from '../../src/renderer/components/CodeText';
import { useApp } from '../../src/renderer/state';
import type { Row } from '../../src/shared/api';
import { errorRowId, fakeApi, itemId, manyRows, openFakeWith, type FakeApi } from './fakeApi';

let api: FakeApi;
let user: UserEvent;
const openFake = async (o: { rows?: Row[]; select?: string } = {}) => {
  api = fakeApi({ rows: o.rows });
  user = await openFakeWith(api, { select: o.select });
};

beforeEach(() => { api = fakeApi(); });

test('제어문자 칩', () => {
  const { container } = render(<CodeText text={'月光草を\\C[4]3本\\C[0]\n%1 G'} />);
  expect([...container.querySelectorAll('code.chip')].map(e => e.textContent)).toEqual(['\\C[4]', '\\C[0]', '%1']); expect(container.querySelectorAll('br')).toHaveLength(1);
});
test('7000줄이어도 보이는 줄만 그린다', async () => { await openFake({ rows: manyRows(7000) }); expect(screen.getAllByRole('row').length).toBeLessThan(80); });
test('필터 칩과 검색', async () => {
  await openFake(); await user.click(screen.getByRole('button', { name: /미번역 7/ })); expect(useApp.get().query.status).toBe('untranslated');
  await user.type(screen.getByLabelText('문장 검색'), '月光'); await waitFor(() => expect(useApp.get().query.text).toBe('月光'));
});
test('고치고 저장', async () => {
  await openFake(); await user.click(screen.getByText('月光草')); const box = screen.getByLabelText('번역');
  await user.clear(box); await user.type(box, '월광초{Control>}{Enter}{/Control}'); expect(api.calls).toContainEqual(['unit.setTranslation', itemId, '월광초']);
});
test('오류 상태는 승인할 수 없다', async () => {
  await openFake({ select: errorRowId }); expect(screen.getByRole('button', { name: '승인' })).toBeDisabled(); expect(screen.getByText(/제어 코드/)).toBeVisible();
});
test('채팅으로 말하기는 항목을 붙인다', async () => {
  await openFake({ select: itemId }); await user.click(screen.getByRole('button', { name: '채팅으로 말하기' }));
  expect(useApp.get().rightTab).toBe('chat'); expect(screen.getByText(/붙은 항목 · Items · 1/)).toBeVisible();
});

// Extra coverage beyond the plan's assertions.
test('화살표로 선택 이동, 빈 선택 안내, 번역 전 표시', async () => {
  await openFake();
  expect(screen.getByText('줄을 고르면 여기에 자세한 내용이 나와요')).toBeVisible();
  expect(screen.getAllByText('번역 전').length).toBeGreaterThan(0);
  expect(screen.getByText('판단 대기')).toBeVisible();
  await user.click(screen.getByText('月光草'));
  expect(useApp.get().selectedId).toBe(itemId);
  await user.keyboard('{ArrowDown}');
  expect(useApp.get().selectedId).toBe(errorRowId);
  await user.keyboard('{ArrowUp}{ArrowUp}');
  expect(useApp.get().selectedId).toBe('r-actor');
});
test('번역이 없으면 승인 불가 이유, 지우기', async () => {
  await openFake({ select: itemId });
  expect(screen.getByRole('button', { name: '승인' })).toBeDisabled();
  expect(screen.getByText('번역이 있어야 승인할 수 있어요')).toBeVisible();
  cleanup(); await openFake({ select: errorRowId });
  await user.click(screen.getByRole('button', { name: '지우기' }));
  expect(api.calls).toContainEqual(['unit.clear', errorRowId]);
});
test('7000줄 표도 첫 화면 줄은 그린다', async () => {
  await openFake({ rows: manyRows(7000) });
  const n = screen.getAllByRole('row').length;
  expect(n).toBeGreaterThan(5); expect(screen.getByText('台詞0')).toBeVisible();
});

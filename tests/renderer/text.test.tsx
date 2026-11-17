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

test('표기 경고 칩은 경고가 있을 때만 나오고 그 줄만 거른다', async () => {
  await openFake();
  expect(screen.queryByRole('button', { name: /표기 경고/ })).toBeNull();
  cleanup();
  const marked: Row = { id: 'n1', kind: 'dialogue', source: 'あ…', target: '아…', status: 'translated', needsDecision: false, file: 'data/Map001.json', location: '맵1', refCount: 1, usesProvisional: false, notation: true };
  await openFake({ rows: [marked] });
  await user.click(screen.getByRole('button', { name: '표기 경고 1' }));
  expect(useApp.get().query.status).toBe('notation');
});
test('거르기 단추는 상태, 살펴볼 것, 그 밖으로 묶이고 색과 흐림으로 구별된다', async () => {
  const many = manyRows(1200).map((r, i): Row => (i < 3 ? { ...r, status: 'error', target: 'x' } : i < 1100 ? { ...r, status: 'translated', target: 'y' } : r));
  await openFake({ rows: [...many, { ...many[0], id: 'ext', external: true, status: 'translated', target: 'z' }] });
  const group = (name: string) => screen.getByRole('group', { name });
  const status = group('상태'); const attention = group('살펴볼 것'); const other = group('그 밖');
  expect(status).toContainElement(screen.getByRole('button', { name: '전체 1,201' }));
  expect(status).toContainElement(screen.getByRole('button', { name: '번역 완료 1,098' }));
  expect(attention).toContainElement(screen.getByRole('button', { name: '오류 3' }));
  expect(other).toContainElement(screen.getByRole('button', { name: '외부 번역 1' }));
  // A count worth a look stands out; an empty button dims but can still be pressed.
  expect(screen.getByRole('button', { name: '오류 3' })).toHaveClass('hot', 'tone-err');
  const none = screen.getByRole('button', { name: '판단 필요 0' });
  expect(none).toHaveClass('zero'); expect(none).not.toHaveClass('hot'); expect(none).toBeEnabled();
  expect(screen.getByRole('button', { name: '검토 필요 0' })).toHaveClass('zero');
  // The number reads in the fixed-width face, apart from the name.
  expect(screen.getByRole('button', { name: '오류 3' }).querySelector('.fc-num')?.textContent).toBe('3');
  // The progress bar under "상태" is decoration, with each part's share of all lines.
  const bar = status.querySelector('.fg-bar') as HTMLElement;
  expect(bar).toHaveAttribute('aria-hidden', 'true');
  expect([...bar.children].map((c) => [c.className, (c as HTMLElement).style.width])).toEqual([
    ['tone-none', `${(100 * 100 / 1201).toFixed(3)}%`], ['tone-done', `${(100 * 1098 / 1201).toFixed(3)}%`]]);
  await user.click(screen.getByRole('button', { name: '오류 3' }));
  expect(screen.getByRole('button', { name: '오류 3' })).toHaveClass('on');
  expect(screen.getByLabelText('문장 검색')).toHaveAttribute('placeholder', '원문이나 번역에서 찾기');
});
test('표 오른쪽 띠에 오류와 검수 필요 줄의 위치', async () => {
  const rows = manyRows(400).map((r, i) => (i === 0 ? { ...r, status: 'error' as const, target: 'x' } : i === 399 ? { ...r, status: 'needs-review' as const, target: 'y' } : r));
  await openFake({ rows });
  const marks = [...document.querySelectorAll('.scroll-marks > i')] as HTMLElement[];
  expect(marks.map((m) => [m.className, m.style.top])).toEqual([['err', '0.25%'], ['warn', '99.75%']]);
  await user.click(screen.getByRole('button', { name: /^오류 / }));
  expect([...document.querySelectorAll('.scroll-marks > i')].map((m) => [m.className, (m as HTMLElement).style.top])).toEqual([['err', '50%']]);
});

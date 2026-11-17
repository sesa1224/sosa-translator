import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { errorRowId, fakeApi, itemId, openFakeWith } from './fakeApi';

const similarTo = (api: ReturnType<typeof fakeApi>) => {
  api.similarValue[errorRowId] = [
    { id: 'r-old', source: '夜に光る花。\\C[2]貴重\\C[0]だ', target: '밤에 빛나는 꽃. \\C[2]귀하\\C[0]다', score: 82, location: 'Items · 7' },
    { id: 'r-old-2', source: '夜に光る石だ', target: '밤에 빛나는 돌이다', score: 61, location: '맵2 · 이벤트5' },
  ];
};

test('비슷한 번역: 일치율, 위치, 다른 부분, 번역이 보인다', async () => {
  const api = fakeApi();
  similarTo(api);
  await openFakeWith(api, { select: errorRowId });
  const box = within(await screen.findByRole('region', { name: '비슷한 번역' }));
  expect(api.calls).toContainEqual(['similar.find', errorRowId]);
  expect(box.getByText('82%')).toBeVisible();
  expect(box.getByText('61%')).toBeVisible();
  expect(box.getByText('Items · 7')).toBeVisible();
  expect(box.getByText('밤에 빛나는 돌이다')).toBeVisible();
  // The part of the earlier source that differs from the selected line's is marked.
  const marked = [...box.getAllByLabelText('비슷한 원문')[0].querySelectorAll('ins.diff-add')].map((e) => e.textContent);
  expect(marked).toEqual(['花']);
  expect(box.getAllByRole('button', { name: '가져오기' })).toHaveLength(2);
});

test('가져오기는 번역 칸의 초안만 바꾸고 저장하지 않는다', async () => {
  const api = fakeApi();
  similarTo(api);
  const user = await openFakeWith(api, { select: errorRowId });
  const box = within(await screen.findByRole('region', { name: '비슷한 번역' }));
  await user.click(box.getAllByRole('button', { name: '가져오기' })[1]);
  expect(screen.getByLabelText('번역')).toHaveValue('밤에 빛나는 돌이다');
  expect(api.calls.some((c) => c[0] === 'unit.setTranslation')).toBe(false);
  expect(screen.getByRole('button', { name: '저장' })).toBeEnabled();
});

test('비슷한 번역이 없으면 묶음을 그리지 않는다', async () => {
  const api = fakeApi();
  await openFakeWith(api, { select: itemId });
  await screen.findByLabelText('번역');
  expect(api.calls).toContainEqual(['similar.find', itemId]);
  expect(screen.queryByRole('region', { name: '비슷한 번역' })).toBeNull();
});

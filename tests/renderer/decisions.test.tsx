import { act, cleanup, screen, within } from '@testing-library/react';
import { type UserEvent } from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { useApp } from '../../src/renderer/state';
import type { DecisionGroup, Row } from '../../src/shared/api';
import { baseRows, fakeApi, openFakeWith, type FakeApi } from './fakeApi';

let api: FakeApi;
let user: UserEvent;

const groups: DecisionGroup[] = [
  { key: 'mv:D_TEXT', label: 'D_TEXT', kind: 'plugin-command', count: 225, samples: ['D_TEXT 筋力\\V[22] 32', 'D_TEXT 体力 10', 'D_TEXT 32'], hints: { fileNames: 0 }, decision: null },
  { key: 'mz:Pic:show:name', label: 'Pic · show · name', kind: 'plugin-command', count: 40, samples: ['立ち絵1', '立ち絵2', '立ち絵3', '立ち絵4', '背景'],
    hints: { fileNames: 4, metaType: 'string', metaText: '画像', metaDesc: '表示する画像' },
    decision: { translate: false, keep: { mode: 'whole' }, status: 'suggested', by: 'meta', reason: '그림·소리 파일 이름과 같음' } },
  { key: 'param:Menu:title', label: 'Menu · title', kind: 'plugin-param', count: 3, samples: ['記録'], hints: { fileNames: 0 },
    decision: { translate: true, keep: { mode: 'whole' }, status: 'confirmed', by: 'user' } },
  { key: 'js:Chronus.js', label: 'Chronus.js', kind: 'plugin-js', count: 2, samples: ['朝', '夜'], hints: { fileNames: 0 }, decision: null },
];
const jsRows: Row[] = [
  { id: 'js1', kind: 'plugin-js', source: '朝', target: null, status: 'untranslated', needsDecision: true, file: 'js/plugins/Chronus.js', location: 'js/plugins/Chronus.js', refCount: 1, usesProvisional: false, decision: 'none', decisionKey: 'js:Chronus.js' },
  { id: 'js2', kind: 'plugin-js', source: '夜', target: null, status: 'untranslated', needsDecision: true, file: 'js/plugins/Chronus.js', location: 'js/plugins/Chronus.js', refCount: 1, usesProvisional: false, decision: 'none', decisionKey: 'js:Chronus.js' },
];

async function openDecisions() {
  cleanup();
  api = fakeApi({ rows: [...baseRows.map((r) => (r.needsDecision ? { ...r, decision: 'none' as const } : r)), ...jsRows] });
  api.groupsValue = groups;
  user = await openFakeWith(api);
  await user.click(within(screen.getByRole('navigation', { name: '작업 메뉴' })).getByRole('button', { name: /판단 필요/ }));
  await screen.findByRole('heading', { name: '판단 필요' });
}
const card = (label: string) => screen.getAllByTestId('decision-card').find((c) => within(c).queryByText(label, { selector: '.decision-label' }))!;

test('묶음 카드: 라벨, 개수, 표본, 추천', async () => {
  await openDecisions();
  const d = card('D_TEXT');
  expect(within(d).getByText('225곳')).toBeVisible();
  expect(within(d).getAllByTestId('decision-sample')).toHaveLength(3);
  const pic = card('Pic · show · name');
  expect(within(pic).getByText(/추천: 번역 안 함 — 그림·소리 파일 이름과 같음/)).toBeVisible();
  expect(within(pic).getByText(/플러그인 주석/)).toBeVisible();
  expect(within(pic).getByText('플러그인 설명: 画像 · 表示する画像')).toBeVisible();
  expect(within(pic).getByText('표본 5개 중 4개가 그림·소리 파일 이름과 같아요')).toBeVisible();
});

test('번역함 → 앞뒤 조각은 그대로 → 뒤 1개 → 확인', async () => {
  await openDecisions();
  const d = card('D_TEXT');
  await user.click(within(d).getByRole('button', { name: '번역함' }));
  await user.click(within(d).getByLabelText('앞뒤 조각은 그대로'));
  const back = within(d).getByLabelText('뒤에서 그대로 둘 조각 수');
  await user.clear(back);
  await user.type(back, '1');
  // The highlighted part follows the chosen rule.
  const first = within(d).getAllByTestId('decision-sample')[0];
  expect(within(first).getAllByTestId('translate-part').map((e) => e.textContent)).toEqual(['筋力\\V[22]']);
  expect(within(d).getByText('이 줄은 번역할 부분이 없어 그대로 둬요')).toBeVisible();
  await user.click(within(d).getByRole('button', { name: '확인' }));
  expect(api.calls).toContainEqual(['decisions.set', 'mv:D_TEXT', { translate: true, keep: { mode: 'args', from: 1, dropLast: 1 } }]);
});

test('방식에 따라 강조가 달라진다', async () => {
  await openDecisions();
  const d = card('D_TEXT');
  await user.click(within(d).getByRole('button', { name: '번역함' }));
  const first = () => within(d).getAllByTestId('decision-sample')[0];
  // MV command default: first piece kept.
  expect(within(first()).getAllByTestId('translate-part').map((e) => e.textContent)).toEqual(['筋力\\V[22] 32']);
  await user.click(within(d).getByLabelText('전체'));
  expect(within(first()).getAllByTestId('translate-part').map((e) => e.textContent)).toEqual(['D_TEXT 筋力\\V[22] 32']);
  await user.click(within(d).getByLabelText('일본어 부분만'));
  expect(within(first()).getAllByTestId('translate-part').map((e) => e.textContent)).toEqual(['筋力']);
});

test('번역 안 함, 추천 전부 받아들이기, Claude에게 추천 받기', async () => {
  await openDecisions();
  await user.click(within(card('D_TEXT')).getByRole('button', { name: '번역 안 함' }));
  expect(api.calls).toContainEqual(['decisions.set', 'mv:D_TEXT', { translate: false, keep: { mode: 'whole' } }]);
  await user.click(screen.getByRole('button', { name: '추천 전부 받아들이기 (1)' }));
  expect(api.calls).toContainEqual(['decisions.confirm']);
  await user.click(screen.getByRole('button', { name: 'Claude에게 추천 받기' }));
  expect(api.calls).toContainEqual(['job.decide']);
});

test('필터 칩과 사이드바 숫자', async () => {
  await openDecisions();
  expect(screen.getAllByTestId('decision-card')).toHaveLength(4);
  await user.click(screen.getByRole('button', { name: '추천 받음 1' }));
  expect(screen.getAllByTestId('decision-card')).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: '번역함 1' }));
  expect(screen.getAllByTestId('decision-card').map((c) => within(c).getByText(/./, { selector: '.decision-label' }).textContent)).toEqual(['Menu · title']);
  await user.click(screen.getByRole('button', { name: '정할 것 2' }));
  expect(screen.getAllByTestId('decision-card')).toHaveLength(2);
  const undecided = useApp.get().snapshot!.stats.undecided;
  expect(within(screen.getByRole('navigation', { name: '작업 메뉴' })).getByRole('button', { name: new RegExp(`판단 필요\\s*${undecided}`) })).toBeVisible();
});

test('JS 파일 묶음은 문자열마다 정하고, 줄 보기는 텍스트 화면으로', async () => {
  await openDecisions();
  const js = card('Chronus.js');
  await user.click(within(js).getByRole('button', { name: '문자열 하나씩 보기' }));
  const items = within(js).getAllByTestId('js-string');
  expect(items).toHaveLength(2);
  await user.click(within(items[1]).getByRole('button', { name: '번역함' }));
  expect(api.calls).toContainEqual(['decisions.set', 'unit:js2', { translate: true, keep: { mode: 'whole' } }]);
  await user.click(within(card('D_TEXT')).getByRole('button', { name: '이 묶음의 줄 보기' }));
  expect(useApp.get().view).toBe('text');
  expect(useApp.get().query.decisionKey).toBe('mv:D_TEXT');
  act(() => { useApp.setQuery({ decisionKey: undefined }); });
});

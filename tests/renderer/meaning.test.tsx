// Meaning colours: every theme has done (--ok) and new/Claude's (--info) beside --warn and --err, readable on their
// own tints and on the page, and far enough in hue from the accent that "done" never reads as "picked".
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, cleanup, screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { useApp } from '../../src/renderer/state';
import { errorRowId, fakeApi, itemId, openFakeWith, row1 } from './fakeApi';

const css = readFileSync(path.resolve(__dirname, '../../src/renderer/theme.css'), 'utf8');
const THEMES = ['dark', 'light', 'moon', 'ember', 'murim', 'deep', 'rpg', 'hanji'];

function tokens(theme: string): Record<string, string> {
  const m = new RegExp(`:root\\[data-theme="${theme}"\\][^{]*\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`no block for ${theme}`);
  const out: Record<string, string> = {};
  for (const [, k, v] of m[1].matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[k] = v.trim();
  return out;
}
function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
function lum(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
function hue(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => c / 255);
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
const apart = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

test.each(THEMES)('%s 테마: 뜻 색이 있고 제 바탕과 판 위에서 읽히며 강조색과 색상이 벌어져 있다', (theme) => {
  const t = tokens(theme);
  for (const k of ['--ok', '--ok-bg', '--info', '--info-bg']) expect(t[k], k).toMatch(/^#[0-9A-Fa-f]{6}$/);
  expect(contrast(t['--ok'], t['--ok-bg'])).toBeGreaterThanOrEqual(4.5);
  expect(contrast(t['--info'], t['--info-bg'])).toBeGreaterThanOrEqual(4.5);
  expect(contrast(t['--ok'], t['--panel'])).toBeGreaterThanOrEqual(4.5);
  expect(contrast(t['--info'], t['--panel'])).toBeGreaterThanOrEqual(4.5);
  // The tints must be told apart from the page they sit on.
  expect(contrast(t['--ok-bg'], t['--panel'])).toBeGreaterThan(1.08);
  expect(contrast(t['--info-bg'], t['--panel'])).toBeGreaterThan(1.08);
  expect(apart(hue(t['--ok']), hue(t['--accent']))).toBeGreaterThanOrEqual(35);
  expect(apart(hue(t['--info']), hue(t['--accent']))).toBeGreaterThanOrEqual(35);
  expect(apart(hue(t['--ok']), hue(t['--info']))).toBeGreaterThanOrEqual(60);
});

test('표의 상태 알약과 거르기 색: 번역 완료는 info, 승인은 ok', () => {
  expect(css).toMatch(/\.st-done \{[^}]*var\(--info-bg\)[^}]*var\(--info\)/);
  expect(css).toMatch(/\.st-ok \{[^}]*var\(--ok-bg\)[^}]*var\(--ok\)/);
  expect(css).toMatch(/\.tone-done \{ --tone: var\(--info\); \}/);
  expect(css).toMatch(/\.tone-ok \{ --tone: var\(--ok\); \}/);
  expect(css).toMatch(/\.bv-stat\.new b \{ color: var\(--info\); \}/);
});

test('검사 통과는 ok 색', async () => {
  cleanup();
  const api = fakeApi({ rows: [{ ...row1, target: '리나', status: 'translated' }] });
  await openFakeWith(api, { select: row1.id });
  const checks = screen.getByRole('group', { name: '검사' });
  expect(within(checks).getByText(/통과/)).toHaveClass('ok-text');
});

test('왼쪽 메뉴의 수 배지는 뜻 색: 미번역 수는 흐리게, 판단 필요는 경고색', async () => {
  cleanup();
  const api = fakeApi();
  await openFakeWith(api);
  act(() => { useApp.setView('text'); });
  const nav = screen.getByRole('navigation', { name: '작업 메뉴' });
  const text = within(nav).getByRole('button', { name: /텍스트/ });
  expect(text.querySelector('.nb')).toHaveClass('nb-mute');
  const decisions = within(nav).getByRole('button', { name: /판단 필요/ });
  expect(decisions.querySelector('.nb')).toHaveClass('nb-warn');
  void itemId; void errorRowId;
});

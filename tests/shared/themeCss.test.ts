// theme.css as text: the jsdom tests do not load the stylesheet, so the rules about fonts and tokens are read here.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const css = readFileSync(join(__dirname, '../../src/renderer/theme.css'), 'utf8');
const THEMES = ['dark', 'light', 'moon', 'ember', 'murim', 'deep', 'rpg', 'hanji'];

/** Declarations of every rule whose selector list names the given class (comments stripped). */
function rulesFor(cls: string): string[] {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: string[] = [];
  for (const m of plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(',').some((s) => new RegExp(`\\.${cls}(?![\\w-])`).test(s))) out.push(m[2]);
  }
  return out;
}
function themeBlock(name: string): string {
  const m = new RegExp(`:root\\[data-theme="${name}"\\][^{]*\\{([^}]*)\\}`).exec(css);
  return m ? m[1] : '';
}

test('게임 제목은 장식 글꼴이 아니라 일본어·한자가 든 글꼴 순서로 고정된다', () => {
  for (const cls of ['brand-title', 'title-field', 'picker-name']) {
    const rules = rulesFor(cls);
    expect(rules.join(';'), cls).not.toContain('--tfont');
    expect(rules.some((r) => /font-family:\s*var\(--gfont\)/.test(r)), cls).toBe(true);
  }
  const gfont = /--gfont:\s*([^;]+);/.exec(css)?.[1] ?? '';
  // A Japanese font comes before the Korean body font, so kana and kanji come from one face.
  expect(gfont.indexOf('Yu Gothic')).toBeGreaterThanOrEqual(0);
  expect(gfont.indexOf('Yu Gothic')).toBeLessThan(gfont.indexOf('IBM Plex Sans KR'));
});

test('화면 제목은 28px 를 기준으로 테마마다 보정한다(붓글씨는 크게)', () => {
  expect(rulesFor('page-title').join(';')).toMatch(/font-size:\s*calc\(28px \* var\(--tscale\)\)/);
  const scale = (name: string) => Number(/--tscale:\s*([\d.]+)/.exec(themeBlock(name))?.[1] ?? '1');
  expect(scale('murim')).toBeGreaterThan(1.2);
  expect(scale('dark')).toBe(1);
});

test('그림자와 올린 판 색은 여덟 테마 모두에 있다', () => {
  for (const t of THEMES) {
    expect(themeBlock(t), t).toMatch(/--shadow:/);
    expect(themeBlock(t), t).toMatch(/--raise:/);
  }
});

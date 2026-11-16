import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { checkTranslation } from '../../src/core/check/format.js';
import { upgradeStyleGuide } from '../../src/core/glossary/guideUpgrade.js';
import { finalPrompt } from '../../src/core/glossary/prompts.js';
import { planRename } from '../../src/core/glossary/rename.js';
import { DEFAULT_STYLE_GUIDE, defaultGlossary, normalizeGlossary, termId } from '../../src/core/glossary/store.js';
import type { Glossary, Term } from '../../src/core/glossary/types.js';
import { SPEAKER_PRESETS } from '../../src/core/text/speaker.js';
import { toHalfWidth } from '../../src/core/text/width.js';
import type { TextUnit, TranslationEntry } from '../../src/core/types.js';
import { buildTranslatePrompt, type Batch } from '../../src/main/translate/batches.js';
import { buildReviewPrompt } from '../../src/main/translate/review.js';

const PATTERN = SPEAKER_PRESETS[0].pattern;
const T = (source: string, target: string, extra: Partial<Term> = {}): Term => ({ id: termId(source), source, target, category: 'name', status: 'confirmed', candidates: [], ...extra });
const D = (id: string, source: string, extra: Partial<TextUnit> = {}): TextUnit => ({ id, kind: 'dialogue', source, needsDecision: false, refs: [], ...extra });
const check = (u: TextUnit, target: string, terms: Term[]) =>
  checkTranslation(u, target, defaultGlossary().rules, { terms, maxLineWidthChars: null, speakerPattern: PATTERN });

test('전각 문장부호·숫자·영문은 반각으로, 괄호와 제어문자가 될 글자는 그대로', () => {
  expect(toHalfWidth('알고 있었어？')).toBe('알고 있었어?');
  expect(toHalfWidth('「！？」')).toBe('「!?」');
  expect(toHalfWidth('（무슨 냄새지……？）')).toBe('（무슨 냄새지……?）');
  expect(toHalfWidth('ＨＰ＋１０：ＯＫ～')).toBe('HP+10:OK~');
  expect(toHalfWidth('（어라」')).toBe('（어라」');   // an unmatched pair stays as the source has it
  expect(toHalfWidth('１００％ ＼ ［Ａ］ ｛Ｂ｝')).toBe('100％ ＼ ［A］ ｛B｝');
  expect(toHalfWidth('\\C[2]리나\\C[0]！ %1')).toBe('\\C[2]리나\\C[0]! %1');
  expect(toHalfWidth('%１')).toBe('%１');   // would turn into a placeholder the source does not have
});

test('반각으로 쓴 번역은 형식 검사에 걸리지 않는다', () => {
  expect(check(D('a', '「知ってた？」'), '「알고 있었어?」', [])).toEqual([]);
  expect(check(D('b', '（何の匂い・・？）'), '(무슨 냄새지……?)', [])).toEqual([]);
  expect(check(D('c', '「！？」'), '「!?」', [])).toEqual([]);
});

test('화자 이름에만 쓰는 용어는 화자 자리에서만 검사한다', () => {
  const sensei = T('先生', '선생', { scope: 'speaker' });
  const terms = [sensei, T('ドン', '돈')];
  expect(check(D('a', '【ドン】\n「先生、もう…」'), '【돈】\n「선생님, ……」', terms)).toEqual([]);
  expect(check(D('b', '【先生】\n「おはよう」'), '【선생님】\n「좋은 아침」', terms)).toEqual([
    { rule: 'glossary', severity: 'warning', message: '화자 이름 "先生"는 "선생"(으)로 옮깁니다' },
  ]);
  expect(check(D('c', '【先生】\n「おはよう」'), '【선생】\n「좋은 아침」', terms)).toEqual([]);
  // The MZ name box is a value of its own.
  expect(check(D('d', '先生', { kind: 'db' }), '선생님', terms)).toHaveLength(1);
  expect(check(D('e', '先生の家', { kind: 'db' }), '선생님의 집', terms)).toEqual([]);
  // Without a scope a term is checked everywhere, as before.
  expect(check(D('f', '【ドン】\n「先生、もう…」'), '【돈】\n「스승님, ……」', [T('先生', '선생')])).toHaveLength(1);
  expect(check(D('g', '【ドン】\n「先生、もう…」'), '【돈】\n「스승님, ……」', terms)).toEqual([]);
});

test('화자 이름에만 쓰는 용어를 바꾸면 화자 자리만 바뀐다', () => {
  const units = [D('a', '【ドン】\n「先生、もう…」'), D('b', '【先生】\n「先生だよ」'), D('c', '先生', { kind: 'db' }), D('d', '【不良】\n「先生よぉ」')];
  const entries: Record<string, string> = { a: '【돈】\n「선생님, ……」', b: '【선생】\n「선생이야」', c: '선생', d: '【불량배】\n「선생 말이야」' };
  const entryOf = (id: string): TranslationEntry => ({ target: entries[id] ?? null, status: 'translated', updatedAt: 't' });
  const scoped = planRename(T('先生', '선생', { scope: 'speaker' }), '선생님', units, entryOf, PATTERN);
  expect(scoped.map((p) => [p.id, p.newTarget])).toEqual([['b', '【선생님】\n「선생이야」'], ['c', '선생님']]);
  // Without a scope every use follows, as before.
  expect(planRename(T('先生', '선생'), '교사', units, entryOf, PATTERN).map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
});

test('범위는 저장되고, 없던 용어집은 그대로 읽힌다', () => {
  const g = normalizeGlossary({ terms: [{ source: '先生', target: '선생', category: 'name', scope: 'speaker' }, { source: 'ドン', target: '돈', scope: 'x' }], rules: { maxLines: 3 } });
  expect(g.terms[0].scope).toBe('speaker'); expect('scope' in g.terms[1]).toBe(false);
  expect(g.rules.halfWidth).toBe(true);
  expect(normalizeGlossary({ rules: { halfWidth: false } }).rules.halfWidth).toBe(false);
});

const batchOf = (text: string, speaker: string | null): Batch => ({
  label: 'x', file: 'f', context: [], items: [{ i: 0, id: 'a', kind: 'dialogue', speaker, speakerLine: speaker ? `【${speaker}】` : null, text }],
});

test('화자 이름에만 쓰는 용어는 본문 용어로 보내지 않고, 호칭은 인물 카드가 앞선다', () => {
  const g: Glossary = {
    ...defaultGlossary(),
    terms: [T('先生', '선생', { scope: 'speaker' }), T('アーテル', '아텔')],
    characters: [{ id: 'd', source: 'ドン', target: '돈', speech: '공손한 존댓말', addressing: '아텔 선생님/선생님' }],
  };
  const tr = buildTranslatePrompt(batchOf('「アーテル先生、もう…」', 'ドン'), g);
  expect(JSON.parse(tr.user).terms).toEqual([{ source: 'アーテル', target: '아텔' }]);
  expect(tr.system).toContain('호칭과 말투는 인물 카드(characters)가 용어집(terms)보다 우선한다');
  const rv = buildReviewPrompt({ label: 'x', file: 'f', items: [{ i: 0, id: 'a', kind: 'dialogue', speaker: 'ドン', speakerLine: '【ドン】', source: '「アーテル先生、もう…」', target: '「아텔 선생님, ……」' }] }, g);
  expect(JSON.parse(rv.user).terms).toEqual([{ source: 'アーテル', target: '아텔' }]);
  expect(JSON.parse(rv.user).characters[0].addressing).toBe('아텔 선생님/선생님');
  expect(rv.system).toContain('호칭과 말투는 인물 카드(characters)가 용어집(terms)보다 우선한다');
});

test('반각 규칙과 남기는 말투가 번역·검수 글에 들어간다', () => {
  const g = defaultGlossary();
  for (const kind of ['translate', 'review', 'export'] as const) {
    const text = finalPrompt(kind, g);
    expect(text).toContain('전각을 반각으로 바꾼 것은 원문을 바꾼 것이 아니다');
    expect(text).toContain('## 남기는 말투');
    expect(text).toContain('어이어이');
  }
  expect(finalPrompt('review', g)).toContain('남기는 말투');
  expect(finalPrompt('review', { ...g, rules: { ...g.rules, halfWidth: false } })).not.toContain('반각으로 쓴다');
  // The guide no longer tells the reviewer to turn every interjection into a Korean one.
  expect(DEFAULT_STYLE_GUIDE).not.toContain('| 일본식 감탄사 직역(え? あれ? ほら) |');
  expect(DEFAULT_STYLE_GUIDE).toContain('시오후키');
  expect(DEFAULT_STYLE_GUIDE).toContain('싸지다');
});

test('옛 기본 지침은 새 문구로 올라가고, 고친 줄과 게임별 내용은 남는다', () => {
  const body = (file: string) => {
    const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    return text.slice(text.search(/^## /m)).trim() + '\n';
  };
  const old = body(path.join(__dirname, '..', 'fixtures', 'style-guide-1.2.0.md'));
  expect(upgradeStyleGuide(old)).toBe(DEFAULT_STYLE_GUIDE);
  expect(upgradeStyleGuide(DEFAULT_STYLE_GUIDE)).toBe(DEFAULT_STYLE_GUIDE);
  const mine = old.replace('- 한자, 히라가나, 가타카나를 결과에 남기지 않는다.', '- 내가 고친 줄.') + '\n## 이 게임의 말투\n어둡고 건조하다.\n';
  const up = upgradeStyleGuide(mine);
  expect(up).toContain('- 내가 고친 줄.'); expect(up).toContain('## 이 게임의 말투\n어둡고 건조하다.');
  expect(up).toContain('## 남기는 말투'); expect(up.indexOf('## 남기는 말투')).toBeLessThan(up.indexOf('## 의성어, 의태어, 신음'));
  // A guide the user rewrote is left alone.
  expect(upgradeStyleGuide('## 내 지침\n- 자연스럽게\n')).toBe('## 내 지침\n- 자연스럽게\n');
  expect(normalizeGlossary({ styleGuide: old }).styleGuide).toBe(DEFAULT_STYLE_GUIDE);
});

test('1.3.0 기본 지침에는 말끝 끊김과 말더듬 규칙이 더해진다', () => {
  const text = readFileSync(path.join(__dirname, '..', 'fixtures', 'style-guide-1.3.0.md'), 'utf8').replace(/\r\n/g, '\n');
  const old = text.slice(text.search(/^## /m)).trim() + '\n';
  expect(upgradeStyleGuide(old)).toBe(DEFAULT_STYLE_GUIDE);
  expect(DEFAULT_STYLE_GUIDE).toContain('닿고 있어읏');
  expect(DEFAULT_STYLE_GUIDE).toContain('노…… 놓으라고');
  const mine = old + '\n## 이 게임의 말투\n- 말끝 끊김을 "읏"으로 붙인다.\n';
  const up = upgradeStyleGuide(mine);
  expect(up).toContain('## 이 게임의 말투\n- 말끝 끊김을 "읏"으로 붙인다.');
  expect(upgradeStyleGuide(up)).toBe(up);
});

test('1.4.0 기본 지침에는 성 관련 용어 대응표가 더해진다', () => {
  const text = readFileSync(path.join(__dirname, '..', 'fixtures', 'style-guide-1.4.0.md'), 'utf8').replace(/\r\n/g, '\n');
  const old = text.slice(text.search(/^## /m)).trim() + '\n';
  expect(old).not.toContain('## 성 관련 용어');
  expect(upgradeStyleGuide(old)).toBe(DEFAULT_STYLE_GUIDE);
  expect(DEFAULT_STYLE_GUIDE).toContain('| チンポ, ちんぽ, おちんぽ | 자지 | 대사 기본값 |');
  expect(DEFAULT_STYLE_GUIDE.indexOf('## 성 관련 용어')).toBeLessThan(DEFAULT_STYLE_GUIDE.indexOf('## 형식'));
  // The table's own words are not translationese, even where they follow the original's sound.
  expect(DEFAULT_STYLE_GUIDE).toContain('번역투로 보지 않는다');
  // Per-game additions stay, and a guide without the "형식" section gets the table at the end.
  const mine = old.replace(/## 형식[\s\S]*$/, '') + '## 이 게임의 말투\n어둡고 건조하다.\n';
  const up = upgradeStyleGuide(mine);
  expect(up).toContain('## 이 게임의 말투\n어둡고 건조하다.'); expect(up).toContain('## 성 관련 용어'); expect(upgradeStyleGuide(up)).toBe(up);
  // A guide written from scratch is left alone.
  expect(upgradeStyleGuide('## 내 지침\n- 자연스럽게\n')).toBe('## 내 지침\n- 자연스럽게\n');
});

test('1.4.1 기본 지침은 절 단위로 새 지침이 되고, 고친 절은 그대로 남는다', () => {
  const text = readFileSync(path.join(__dirname, '..', '..', 'src', 'core', 'glossary', 'guide-1.4.1.md'), 'utf8').replace(/\r\n/g, '\n');
  const old = text.slice(text.search(/^## /m)).trim() + '\n';
  expect(upgradeStyleGuide(old)).toBe(DEFAULT_STYLE_GUIDE);
  // The contradictions of 1.4.1 are gone: sound words written by ear, line breaking against the format rules.
  expect(DEFAULT_STYLE_GUIDE).not.toContain('쮸봅쮸봅');
  expect(DEFAULT_STYLE_GUIDE).not.toContain('창을 넘치지 않게 줄을 나눈다');
  expect(DEFAULT_STYLE_GUIDE).toContain('## 글의 종류별 문체');
  expect(DEFAULT_STYLE_GUIDE).toContain('## 가린 글자');
  expect(DEFAULT_STYLE_GUIDE.indexOf('## 가린 글자')).toBeLessThan(DEFAULT_STYLE_GUIDE.indexOf('## 성 관련 용어'));
  // An edited section keeps the user's wording and does not get the section that follows it; the others move up.
  const mine = old.replace('| じゅぽじゅぽ | 쮸봅쮸봅 |', '| じゅぽじゅぽ | 쥬폽쥬폽 |') + '\n## 이 게임의 말투\n어둡고 건조하다.\n';
  const up = upgradeStyleGuide(mine);
  expect(up).toContain('쥬폽쥬폽'); expect(up).not.toContain('## 가린 글자');
  expect(up).toContain('## 글의 종류별 문체'); expect(up).toContain('| 中出し | 질내사정 / 안에 싸다 |');
  expect(up).toContain('## 이 게임의 말투\n어둡고 건조하다.');
  expect(upgradeStyleGuide(up)).toBe(up);
});

test('괄호 규칙을 켜면 （ ） 도 반각이 되고, 물결표 〜 는 늘 ~ 가 된다', () => {
  expect(toHalfWidth('（무슨 냄새지……？）', { brackets: true })).toBe('(무슨 냄새지……?)');
  expect(toHalfWidth('（어라」', { brackets: true })).toBe('(어라」');
  expect(toHalfWidth('「【이름】『책』」 ［Ａ］ ｛Ｂ｝ １００％', { brackets: true })).toBe('「【이름】『책』」 ［A］ ｛B｝ 100％');
  expect(toHalfWidth('（%１）', { brackets: true })).toBe('（%１）');   // the placeholder guard still wins
  expect(toHalfWidth('으응〜♥ 좋아～')).toBe('으응~♥ 좋아~');
  expect(toHalfWidth('（응〜）')).toBe('（응~）');
});

test('괄호 규칙은 새 프로젝트에서 켜져 있고, 값이 없는 기존 용어집에서는 꺼져 있다', () => {
  expect(defaultGlossary().rules.halfWidthBrackets).toBe(true);
  expect(normalizeGlossary({ rules: { halfWidth: true } }).rules.halfWidthBrackets).toBe(false);
  expect(normalizeGlossary({}).rules.halfWidthBrackets).toBe(false);
  expect(normalizeGlossary({ rules: { halfWidthBrackets: true } }).rules.halfWidthBrackets).toBe(true);
});

test('지침의 괄호 문장은 규칙을 따른다', () => {
  const g = defaultGlossary();
  const on = '（ ） 는 반각 ( ) 로 쓴다';
  const off = '괄호 「 」 『 』 （ ） 【 】 는 원문에 쓰인 글자 그대로 두고';
  for (const kind of ['translate', 'review', 'export'] as const) {
    expect(finalPrompt(kind, g)).toContain(on);
    expect(finalPrompt(kind, g)).toContain('「 」 『 』 【 】 는 원문에 쓰인 글자 그대로');
    expect(finalPrompt(kind, g)).not.toContain(off);
    const kept = finalPrompt(kind, { ...g, rules: { ...g.rules, halfWidthBrackets: false } });
    expect(kept).toContain(off); expect(kept).not.toContain(on);
    // The bracket rule is part of the half-width rule: without that one nothing is said about width.
    expect(finalPrompt(kind, { ...g, rules: { ...g.rules, halfWidth: false } })).not.toContain(on);
  }
});

test('이름으로 쓰일 때만: 본문 검사는 하지 않고 화자 자리에서는 맞추며, 모델에는 표시해서 보낸다', () => {
  const hana = T('ハナ', '하나', { scope: 'name', note: '주인공 여동생' });
  // The body may use the ordinary word: the program cannot tell, so it does not check.
  expect(check(D('a', '「ハナが咲いた」'), '「꽃이 피었다」', [hana])).toEqual([]);
  // As the speaker it is enforced like a speaker term.
  expect(check(D('b', '【ハナ】\n「おはよう」'), '【꽃】\n「좋은 아침」', [hana])).toEqual([
    expect.objectContaining({ rule: 'glossary', severity: 'warning' }),
  ]);
  expect(check(D('c', '【ハナ】\n「おはよう」'), '【하나】\n「좋은 아침」', [hana])).toEqual([]);
  expect(check(D('d', 'ハナ', { kind: 'db' }), '꽃', [hana])).toHaveLength(1);
  // A rename treats it like a term without a scope.
  const units = [D('e', '「ハナが咲いた」')];
  expect(planRename(hana, '한아', units, () => ({ target: '「하나가 피었다」', status: 'translated', updatedAt: '' }), PATTERN)).toEqual([
    { id: 'e', newTarget: '「한아가 피었다」', certain: true },
  ]);
  const g: Glossary = { ...defaultGlossary(), terms: [hana, T('アーテル', '아텔', { note: '  ' })] };
  const sent = [{ source: 'ハナ', target: '하나', onlyWhenUsedAsName: true, note: '주인공 여동생' }, { source: 'アーテル', target: '아텔' }];
  expect(JSON.parse(buildTranslatePrompt(batchOf('「ハナとアーテル」', null), g).user).terms).toEqual(sent);
  const rv = buildReviewPrompt({ label: 'x', file: 'f', items: [{ i: 0, id: 'a', kind: 'dialogue', speaker: null, speakerLine: null, source: '「ハナとアーテル」', target: '「꽃과 아텔」' }] }, g);
  expect(JSON.parse(rv.user).terms).toEqual(sent);
  expect(normalizeGlossary({ terms: [{ source: 'ハナ', target: '하나', scope: 'name' }] }).terms[0].scope).toBe('name');
});

test('번역·검수·내보내기 글이 이름 표시와 메모를 설명한다', () => {
  for (const kind of ['translate', 'review', 'export'] as const) {
    const text = finalPrompt(kind, defaultGlossary());
    expect(text).toContain('onlyWhenUsedAsName');
    expect(text).toContain('note');
  }
});

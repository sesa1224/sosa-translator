import vm from 'node:vm';
import { describe, expect, test } from 'vitest';
import { JOSA_PLUGIN_JS } from '../../src/core/patches/josa.js';

// The same behaviour as RPG Maker MV's rpg_core.js / rpg_windows.js, cut down to what the plugin touches.
const FAKE_CORE = String.raw`
String.prototype.format = function() {
  var args = arguments;
  return this.replace(/%([0-9]+)/g, function(s, n) { return args[Number(n) - 1]; });
};
var calls = { format: 0, convert: 0 };
var _countedFormat = String.prototype.format;
String.prototype.format = function() { calls.format++; return _countedFormat.apply(this, arguments); };
var ACTORS = { 1: '티아루시', 2: '슬라임', 3: 'Bob', 4: 'ティア' };
var VARS = { 1: 3, 2: 12 };
function Window_Base() {}
Window_Base.prototype.convertEscapeCharacters = function(text) {
  calls.convert++;
  text = text.replace(/\\/g, '\x1b');
  text = text.replace(/\x1b\x1b/g, '\\');
  text = text.replace(/\x1bV\[(\d+)\]/gi, function() { return VARS[parseInt(arguments[1])]; });
  text = text.replace(/\x1bN\[(\d+)\]/gi, function() { return ACTORS[parseInt(arguments[1])]; });
  return text;
};
`;

function game(before = '', after = '') {
  const ctx = vm.createContext({});
  vm.runInContext(FAKE_CORE + before, ctx);
  vm.runInContext(JOSA_PLUGIN_JS, ctx);
  vm.runInContext(after, ctx);
  return {
    run: (code: string): unknown => vm.runInContext(code, ctx),
    format: (s: string, ...args: string[]): string => vm.runInContext(`(${JSON.stringify(s)}).format.apply(${JSON.stringify(s)}, ${JSON.stringify(args)})`, ctx) as string,
    convert: (s: string): string => vm.runInContext(`new Window_Base().convertEscapeCharacters(${JSON.stringify(s)})`, ctx) as string,
  };
}

describe('조사 자동 맞춤 플러그인', () => {
  test('시스템 문구의 %1 뒤 조사', () => {
    const g = game();
    expect(g.format('%1은(는) 싸움에서 패배했다.', '티아루시')).toBe('티아루시는 싸움에서 패배했다.');
    expect(g.format('%1은(는) 싸움에서 패배했다.', '슬라임')).toBe('슬라임은 싸움에서 패배했다.');
  });

  test.each([
    ['%1은(는)', '시는', '임은'], ['%1는(은)', '시는', '임은'],
    ['%1이(가)', '시가', '임이'], ['%1가(이)', '시가', '임이'],
    ['%1을(를)', '시를', '임을'], ['%1를(을)', '시를', '임을'],
    ['%1과(와)', '시와', '임과'], ['%1와(과)', '시와', '임과'],
    ['%1(으)로', '시로', '임으로'],
    ['%1(이)라', '시라', '임이라'], ['%1(이)나', '시나', '임이나'], ['%1(이)랑', '시랑', '임이랑'],
    ['%1(이)야', '시야', '임이야'], ['%1(이)여', '시여', '임이여'],
    ['%1아(야)', '시야', '임아'], ['%1야(아)', '시야', '임아'],
    ['%1(이)고', '시고', '임이고'], ['%1(이)다', '시다', '임이다'], ['%1(이)든', '시든', '임이든'], ['%1(이)면', '시면', '임이면'],
  ])('%s', (form, vowel, consonant) => {
    const g = game();
    expect(g.format(form, '티아루시').slice(-vowel.length)).toBe(vowel);
    expect(g.format(form, '슬라임').slice(-consonant.length)).toBe(consonant);
  });

  test('(으)로 는 ㄹ 받침 뒤에서 로', () => {
    expect(game().format('%1(으)로 간다', '마을')).toBe('마을로 간다');
    expect(game().format('%1(으)로 간다', '숲')).toBe('숲으로 간다');
  });

  test('숫자는 읽는 소리로', () => {
    const g = game();
    expect(g.format('%1은(는)', '3')).toBe('3은');
    expect(g.format('%1은(는)', '2')).toBe('2는');
    expect(g.format('%1은(는)', '10')).toBe('10은');
    expect(g.format('%1(으)로', '7')).toBe('7로');
    expect(g.format('%1(으)로', '6')).toBe('6으로');
    expect(g.format('%1(으)로', '9')).toBe('9로');
    expect(g.format('%1이(가)', '1')).toBe('1이');
    expect(g.format('%1이(가)', '5')).toBe('5가');
  });

  test('영문은 끝 글자로 어림한다', () => {
    const g = game();
    expect(g.format('%1은(는)', 'Bob')).toBe('Bob는');
    expect(g.format('%1은(는)', 'Tom')).toBe('Tom은');
    expect(g.format('%1(으)로', 'Bill')).toBe('Bill로');
    expect(g.format('%1(으)로', 'Ken')).toBe('Ken으로');
  });

  test('가나·한자·앞 글자 없음은 그대로', () => {
    const g = game();
    expect(g.format('%1은(는)', 'ティア')).toBe('ティア은(는)');
    expect(g.format('%1은(는)', '王')).toBe('王은(는)');
    expect(g.format('은(는) 없다')).toBe('은(는) 없다');
    expect(g.format('%1 은(는)', '티아')).toBe('티아 은(는)');
  });

  test('색 코드와 닫는 괄호를 건너뛴다', () => {
    const g = game();
    expect(g.format('\x1bC[2]%1\x1bC[0]은(는)', '티아루시')).toBe('\x1bC[2]티아루시\x1bC[0]는');
    expect(g.format('\\C[2]%1\\C[0]은(는)', '슬라임')).toBe('\\C[2]슬라임\\C[0]은');
    expect(g.format('「%1」은(는)', '티아루시')).toBe('「티아루시」는');
    expect(g.format('『%1』(으)로', '마을')).toBe('『마을』로');
    expect(g.format('%1)이(가)', '슬라임')).toBe('슬라임)이');
  });

  test('아직 바뀌지 않은 \\N[1] 뒤는 그대로 두고, 대사 처리에서 맞춘다', () => {
    const g = game();
    expect(g.format('\\N[1]은(는) %1', 'x')).toBe('\\N[1]은(는) x');
    expect(g.convert('\\N[1]은(는) 웃었다.')).toBe('티아루시는 웃었다.');
    expect(g.convert('\\C[2]\\N[2]\\C[0]이(가) 나타났다!')).toBe('\x1bC[2]슬라임\x1bC[0]이 나타났다!');
    expect(g.convert('\\V[2]개(이)다')).toBe('12개다');
    expect(g.convert('\\V[1](으)로')).toBe('3으로');
    expect(g.convert('\\N[3]을(를)')).toBe('Bob를');
  });

  test('꼴이 없는 글자는 그대로, 원래 함수는 불린다', () => {
    const g = game();
    const s = 'HP %1 (최대) 회복 은 는 (는) 은() ';
    expect(g.format(s, '10')).toBe('HP 10 (최대) 회복 은 는 (는) 은() ');
    expect(g.format('%1%2', 'a', 'b')).toBe('ab');
    expect(g.run('calls.format')).toBe(2);
    expect(g.convert('보통 글자')).toBe('보통 글자');
    expect(g.run('calls.convert')).toBe(1);
  });

  test('다른 플러그인이 먼저 감싼 함수를 그대로 부른다', () => {
    const g = game(`
      var _prev = Window_Base.prototype.convertEscapeCharacters;
      Window_Base.prototype.convertEscapeCharacters = function(text) { return '[' + _prev.call(this, text) + ']'; };
    `);
    expect(g.convert('\\N[1]은(는)')).toBe('[티아루시는]');
  });

  test('원래 함수가 던지면 그대로 던지고, 조사 처리 오류는 삼킨다', () => {
    const g = game(`
      Window_Base.prototype.convertEscapeCharacters = function() { throw new Error('boom'); };
    `);
    expect(() => g.convert('x')).toThrow('boom');
    // The original format does not use charCodeAt; the plugin's own work does, so only the plugin fails here.
    const swallow = game('', `String.prototype.charCodeAt = function() { throw new Error('inner'); };`);
    expect(swallow.format('%1은(는)', '티아루시')).toBe('티아루시은(는)');
  });

  test('결과가 문자열이 아니면 손대지 않는다', () => {
    const odd = game(`String.prototype.format = function() { return { not: 'a string' }; };`);
    expect(odd.run(`typeof 'a(는)'.format()`)).toBe('object');
  });

  test('함수가 없는 엔진이면 감싸지 않고 넘어간다', () => {
    const ctx = vm.createContext({});
    expect(() => vm.runInContext(JOSA_PLUGIN_JS, ctx)).not.toThrow();
    expect(vm.runInContext('typeof String.prototype.format', ctx)).toBe('undefined');
  });

  test('ES5 로만 쓰였다', () => {
    expect(JOSA_PLUGIN_JS).not.toMatch(/=>|\blet |\bconst |`|\.includes\(/);
    expect(JOSA_PLUGIN_JS).toMatch(/@plugindesc/);
  });
});

import { jsKey } from '../decisions/keys.js';
import { hasJapanese } from '../text/japanese.js';
import type { RawUnit } from './events.js';

export interface JsString { start: number; end: number; quote: '"' | "'" | '`' }

/** Words after which a '/' starts a regular expression rather than a division. */
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

class ScanError extends Error {}

/**
 * Finds the string literals of a JS file outside comments and regex literals: '…', "…", and `…` without ${}.
 * Offsets are the inside of the quotes (UTF-16). A broken file gives an error instead of throwing.
 */
export function scanJsStrings(js: string): { strings: JsString[]; error: string | null } {
  const strings: JsString[] = [];
  const n = js.length;

  // prev: last significant token ('w:<word>' for words/numbers, the character for punctuation), null at the start.
  const scan = (from: number, inExpr: boolean, collect: boolean): number => {
    let i = from;
    let depth = 0;
    let prev: string | null = null;
    while (i < n) {
      const c = js[i];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '﻿' || c === ' ') { i++; continue; }
      if (c === '/' && js[i + 1] === '/') {
        const nl = js.indexOf('\n', i);
        i = nl < 0 ? n : nl;
        continue;
      }
      if (c === '/' && js[i + 1] === '*') {
        const close = js.indexOf('*/', i + 2);
        if (close < 0) throw new ScanError('닫히지 않은 주석이 있습니다');
        i = close + 2;
        continue;
      }
      if (c === '"' || c === "'") {
        let j = i + 1;
        for (;;) {
          if (j >= n || js[j] === '\n' || js[j] === '\r') throw new ScanError(`따옴표가 닫히지 않은 문자열이 있습니다 (${i}번째 글자)`);
          if (js[j] === '\\') { j += js[j + 1] === '\r' && js[j + 2] === '\n' ? 3 : 2; continue; }
          if (js[j] === c) break;
          j++;
        }
        if (collect) strings.push({ start: i + 1, end: j, quote: c });
        i = j + 1;
        prev = 'w:';
        continue;
      }
      if (c === '`') {
        let j = i + 1;
        let subst = false;
        for (;;) {
          if (j >= n) throw new ScanError(`따옴표가 닫히지 않은 템플릿 문자열이 있습니다 (${i}번째 글자)`);
          if (js[j] === '\\') { j += 2; continue; }
          if (js[j] === '`') break;
          if (js[j] === '$' && js[j + 1] === '{') { subst = true; j = scan(j + 2, true, false); continue; }
          j++;
        }
        if (collect && !subst) strings.push({ start: i + 1, end: j, quote: '`' });
        i = j + 1;
        prev = 'w:';
        continue;
      }
      if (c === '/') {
        const regexAllowed = prev === null || (prev.startsWith('w:') ? REGEX_AFTER_WORD.has(prev.slice(2)) : prev !== ')' && prev !== ']');
        if (regexAllowed) {
          let j = i + 1;
          let inClass = false;
          let ok = false;
          while (j < n && js[j] !== '\n' && js[j] !== '\r') {
            const d = js[j];
            if (d === '\\') { j += 2; continue; }
            if (d === '[') inClass = true;
            else if (d === ']') inClass = false;
            else if (d === '/' && !inClass) { ok = true; break; }
            j++;
          }
          if (ok) {
            j++;
            while (j < n && /[A-Za-z]/.test(js[j])) j++;
            i = j;
            prev = 'w:';
            continue;
          }
        }
        i++;
        prev = '/';
        continue;
      }
      if (/[\w$]/.test(c) || c.charCodeAt(0) > 0x7f) {
        let j = i + 1;
        while (j < n && (/[\w$]/.test(js[j]) || js.charCodeAt(j) > 0x7f)) j++;
        prev = 'w:' + js.slice(i, j);
        i = j;
        continue;
      }
      if (inExpr) {
        if (c === '{') depth++;
        else if (c === '}') {
          if (depth === 0) return i + 1;
          depth--;
        }
      }
      prev = c;
      i++;
    }
    if (inExpr) throw new ScanError('닫히지 않은 템플릿 문자열이 있습니다');
    return i;
  };

  try {
    scan(0, false, true);
    return { strings, error: null };
  } catch (e) {
    if (e instanceof ScanError) return { strings: [], error: e.message };
    throw e;
  }
}

/** Japanese string literals of a plugin file, with the warning when the file cannot be read as JS (then no units). */
export function extractJsStringsDetailed(js: string, file: string): { units: RawUnit[]; error: string | null } {
  const { strings, error } = scanJsStrings(js);
  if (error !== null) return { units: [], error };
  const name = file.replace(/^.*\//, '');
  const seen = new Map<string, number>();
  const units: RawUnit[] = [];
  for (const s of strings) {
    const source = js.slice(s.start, s.end);
    if (!hasJapanese(source)) continue;
    const nth = seen.get(source) ?? 0;
    seen.set(source, nth + 1);
    units.push({
      kind: 'plugin-js', source, needsDecision: true, decisionKey: jsKey(name),
      ref: { type: 'js', file, start: s.start, end: s.end, quote: s.quote },
      distinct: `${file}#${nth}`,
    });
  }
  return { units, error: null };
}

/** Japanese string literals (inside of the quotes, escapes kept) of a plugin file. A broken file gives []. */
export function extractJsStrings(js: string, file: string): RawUnit[] {
  return extractJsStringsDetailed(js, file).units;
}

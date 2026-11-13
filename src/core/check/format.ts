import { checkGlossary, lineWidthChars } from '../glossary/match.js';
import type { Term } from '../glossary/types.js';
import type { TranslationStore } from '../store/translations.js';
import { controlCodes } from '../text/controlCodes.js';
import { hasJapanese } from '../text/japanese.js';
import type { Issue, TextUnit } from '../types.js';

import { DEFAULT_RULES, type FormatRules } from './rules.js';

export { DEFAULT_RULES, type FormatRules };

/** Multiset difference a - b. */
function minus(a: string[], b: string[]): string[] {
  const rest = [...b];
  const out: string[] = [];
  for (const x of a) {
    const i = rest.indexOf(x);
    if (i >= 0) rest.splice(i, 1);
    else out.push(x);
  }
  return out;
}

function lineCount(s: string): number {
  return s.split('\n').length;
}

/** Glossary consistency and line-width limit (optional part of the check). */
export interface GlossaryCheck { terms: Term[]; maxLineWidthChars: number | null }

/** Checks one translation against the format rules. Pixel-width checks come in plan 4. */
export function checkTranslation(unit: TextUnit, target: string, rules: FormatRules = DEFAULT_RULES, glossary?: GlossaryCheck): Issue[] {
  if (target.trim() === '') {
    return [{ rule: 'empty', severity: 'error', message: '번역이 비어 있습니다' }];
  }
  const issues: Issue[] = [];

  if (rules.controlCodes) {
    const src = controlCodes(unit.source);
    const dst = controlCodes(target);
    const missing = minus(src, dst);
    const added = minus(dst, src);
    if (missing.length > 0 || added.length > 0) {
      const parts: string[] = [];
      if (missing.length > 0) parts.push(`빠짐: ${missing.join(' ')}`);
      if (added.length > 0) parts.push(`더해짐: ${added.join(' ')}`);
      issues.push({ rule: 'control-codes', severity: 'error', message: `제어문자가 원문과 다릅니다 (${parts.join(', ')})` });
    }
  }

  if (rules.noLeftoverJapanese && hasJapanese(target)) {
    issues.push({ rule: 'leftover-japanese', severity: 'error', message: '번역에 일본어 글자가 남아 있습니다' });
  }

  const srcLines = lineCount(unit.source);
  const dstLines = lineCount(target);
  if (rules.sameLineCount && srcLines !== dstLines) {
    issues.push({ rule: 'line-count', severity: 'error', message: `줄 수가 원문(${srcLines}줄)과 다릅니다: ${dstLines}줄` });
  }
  if (rules.maxLines !== null && unit.kind === 'dialogue' && dstLines > rules.maxLines) {
    issues.push({ rule: 'line-count', severity: 'warning', message: `대사가 ${rules.maxLines}줄을 넘습니다: ${dstLines}줄` });
  }
  if (glossary) {
    issues.push(...checkGlossary(unit.source, target, glossary.terms));
    const max = glossary.maxLineWidthChars;
    if (max !== null) {
      const srcLines = unit.source.split('\n');
      target.split('\n').forEach((line, i) => {
        const w = lineWidthChars(line);
        const src = srcLines[i];
        // A line the source already overflows is the game's own layout: not reported.
        if (w > max && (src === undefined || lineWidthChars(src) <= max)) {
          issues.push({ rule: 'line-width', severity: 'warning', message: `${i + 1}번째 줄이 ${max}자를 넘습니다: ${w}자` });
        }
      });
    }
  }
  return issues;
}

/**
 * Checks every translated unit. Returns only units with issues.
 * Units with an error get status 'error'; a unit marked 'error' that now passes goes back to 'needs-review'.
 */
export function checkAll(
  units: TextUnit[],
  store: TranslationStore,
  rules: FormatRules = DEFAULT_RULES,
): { id: string; issues: Issue[] }[] {
  const out: { id: string; issues: Issue[] }[] = [];
  for (const u of units) {
    const entry = store.get(u.id);
    if (entry.target === null) continue;
    const issues = checkTranslation(u, entry.target, rules);
    const hasError = issues.some((i) => i.severity === 'error');
    if (hasError && entry.status !== 'error') store.setStatus(u.id, 'error');
    else if (!hasError && entry.status === 'error') store.setStatus(u.id, 'needs-review');
    if (issues.length > 0) out.push({ id: u.id, issues });
  }
  return out;
}

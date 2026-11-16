// The format check run on every translation: control codes, leftover Japanese, line count and width, glossary
// terms, notation (notation.ts), and for needs-decision values the skeleton check. ProjectService runs it on every write and marks
// a translation with an error as 'error' (left out of builds); the CLI's check command runs checkAll.
import { checkedBodyTerms, checkGlossary, checkSpeakerTerms, lineWidthChars } from '../glossary/match.js';
import { splitSpeaker } from '../text/speaker.js';
import type { Term } from '../glossary/types.js';
import type { TranslationStore } from '../store/translations.js';
import { controlCodes } from '../text/controlCodes.js';
import { hasJapanese } from '../text/japanese.js';
import type { Issue, TextUnit } from '../types.js';

import { DEFAULT_RULES, type FormatRules } from './rules.js';
import { notationIssues } from './notation.js';
import type { Layout, TextWindow } from '../preview/types.js';
import { TEXT_WINDOW_LABEL } from '../preview/windows.js';
import { keepPieces } from '../decisions/keys.js';
import { checkSkeleton, translatedParts } from '../decisions/skeleton.js';
import type { Decisions, KeepRule } from '../decisions/types.js';
import { confirmedDecisionFor } from '../decisions/store.js';

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
export interface GlossaryCheck { terms: Term[]; maxLineWidthChars: number | null; speakerPattern?: string | null }

/**
 * Checks one translation against the format rules. The last argument is either a pixel-width check (dialogue shown in the message window) or a keep rule
 * (a needs-decision value where only part is translated). A unit never needs both: keep rules apply to
 * plugin commands, scripts and the like, which are not laid out in the message window.
 */
export function checkTranslation(unit: TextUnit, target: string, rules: FormatRules = DEFAULT_RULES, glossary?: GlossaryCheck, extra?: PxCheck | KeepRule): Issue[] {
  const pxIn = extra && 'layout' in extra ? extra : undefined;
  const keep = extra && 'mode' in extra ? extra : undefined;
  if (target.trim() === '') {
    return [{ rule: 'empty', severity: 'error', message: '번역이 비어 있습니다' }];
  }
  const issues: Issue[] = [];
  // With a keep rule, the kept pieces must be unchanged, and the code and Japanese checks look at the translated parts only.
  let srcText = unit.source;
  let dstText = target;
  if (keep) {
    const skeleton = checkSkeleton(unit.source, target, keep);
    issues.push(...skeleton);
    const pieces = keepPieces(unit.source, keep);
    const srcParts = pieces && translatedParts(unit.source, pieces);
    const dstParts = pieces && translatedParts(target, pieces);
    if (skeleton.length === 0 && srcParts && dstParts) {
      srcText = srcParts.join(' ');
      dstText = dstParts.join(' ');
    }
  }

  if (rules.controlCodes) {
    const src = controlCodes(srcText);
    const dst = controlCodes(dstText);
    const missing = minus(src, dst);
    const added = minus(dst, src);
    if (missing.length > 0 || added.length > 0) {
      const parts: string[] = [];
      if (missing.length > 0) parts.push(`빠짐: ${missing.join(' ')}`);
      if (added.length > 0) parts.push(`더해짐: ${added.join(' ')}`);
      issues.push({ rule: 'control-codes', severity: 'error', message: `제어문자가 원문과 다릅니다 (${parts.join(', ')})` });
    }
  }

  if (rules.noLeftoverJapanese && hasJapanese(dstText)) {
    issues.push({ rule: 'leftover-japanese', severity: 'error', message: '번역에 일본어 글자가 남아 있습니다' });
  }

  const srcLines = lineCount(unit.source);
  const dstLines = lineCount(target);
  if (rules.sameLineCount && srcLines !== dstLines) {
    issues.push({ rule: 'line-count', severity: 'error', message: `줄 수가 원문(${srcLines}줄)과 다릅니다: ${dstLines}줄` });
  }
  const px = pxIn && (pxIn.window !== undefined || unit.kind === 'dialogue') ? pxIn : undefined;
  // The window's own line count replaces the rule's for text the program lays out in its window.
  if (rules.maxLines !== null && unit.kind === 'dialogue' && !px && dstLines > rules.maxLines) {
    issues.push({ rule: 'line-count', severity: 'warning', message: `대사가 ${rules.maxLines}줄을 넘습니다: ${dstLines}줄` });
  }
  if (glossary) {
    // Moans in a character's line follow that character's style, so sound-effect terms are not enforced there.
    const said = splitSpeaker(unit.source, unit.kind === 'dialogue' ? glossary.speakerPattern ?? null : null);
    const spoken = unit.kind === 'dialogue' && (!!unit.speaker || said.speaker !== null);
    const everywhere = checkedBodyTerms(glossary.terms);
    issues.push(...checkGlossary(unit.source, target, spoken ? everywhere.filter((t) => t.category !== 'sfx') : everywhere));
    // A speaker-only term is held to the places where it is the speaker's name; as a form of address in the text the character card decides.
    if (said.speaker !== null) {
      const name = splitSpeaker(target, glossary.speakerPattern ?? null).speaker;
      // A first line the pattern no longer reads is a different problem; the name check needs the name.
      if (name !== null) issues.push(...checkSpeakerTerms(said.speaker, name, glossary.terms));
    } else if (unit.kind !== 'dialogue') issues.push(...checkSpeakerTerms(unit.source.trim(), target.trim(), glossary.terms));
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
  // A needs-decision value may be read by code; its symbols are not for the style guide to judge.
  if (rules.notationCheck && !unit.needsDecision) {
    issues.push(...notationIssues(unit.source, target, { unmask: rules.unmask !== false, brackets: rules.halfWidth === true && rules.halfWidthBrackets === true }));
  }
  if (px) {
    // The pixel check replaces the character count. The whole text is laid out, so an MV speaker line counts as a line too.
    for (let i = issues.length - 1; i >= 0; i--) if (issues[i].rule === 'line-width') issues.splice(i, 1);
    const window = px.window ?? 'message';
    const layout = px.layout(target, px.withFace);
    const pxIssue = pixelWidthIssue(layout, window);
    if (pxIssue) issues.push(pxIssue);
    const lines = windowLinesIssue(layout, window);
    if (lines) issues.push(lines);
  }
  return issues;
}

/** Rules of the warnings about text that does not fit its window (the "창 넘침" filter and the rewrap look at these). */
export const WINDOW_OVERFLOW_RULES: readonly Issue['rule'][] = ['line-width-px', 'window-lines'];

/**
 * Checks every translated unit. Returns only units with issues.
 * Units with an error get status 'error'; a unit marked 'error' that now passes goes back to 'translated'.
 */
export function checkAll(
  units: TextUnit[],
  store: TranslationStore,
  rules: FormatRules = DEFAULT_RULES,
  decisions?: Decisions,
): { id: string; issues: Issue[] }[] {
  const out: { id: string; issues: Issue[] }[] = [];
  for (const u of units) {
    const entry = store.get(u.id);
    if (entry.target === null) continue;
    // A unit confirmed as translated with a keep rule also gets the skeleton check.
    const dec = decisions && u.needsDecision ? confirmedDecisionFor(u, decisions) : null;
    const issues = checkTranslation(u, entry.target, rules, undefined, dec?.translate ? dec.keep : undefined);
    const hasError = issues.some((i) => i.severity === 'error');
    if (hasError && entry.status !== 'error') store.setStatus(u.id, 'error');
    else if (!hasError && entry.status === 'error') store.setStatus(u.id, 'translated');
    if (issues.length > 0) out.push({ id: u.id, issues });
  }
  return out;
}

/**
 * Lays out a text in the game window it is drawn in, with the chosen font. withFace: the narrowest place it is shown.
 * window: which window (missing = the message window, checked for dialogue only, as before windows had names).
 * maxLines: that window's line count (what layout's lineOverflow counts against). fixable: the text is drawn only in
 * this window, so its line breaks may be moved.
 */
export interface PxCheck { layout: (text: string, withFace: boolean) => Layout; withFace: boolean; window?: TextWindow; maxLines?: number; fixable?: boolean }

/** Warning for the line that overflows the window the most, or null. */
export function pixelWidthIssue(l: Layout, window: TextWindow = 'message'): Issue | null {
  let worst = -1;
  l.lines.forEach((line, i) => {
    if (line.overflow > 0 && (worst < 0 || line.overflow > l.lines[worst].overflow)) worst = i;
  });
  if (worst < 0) return null;
  return { rule: 'line-width-px', severity: 'warning', message: `${worst + 1}번째 줄이 ${TEXT_WINDOW_LABEL[window]}을 ${Math.ceil(l.lines[worst].overflow)}px 넘어요` };
}

/** Warning for more lines than the window shows, or null. */
export function windowLinesIssue(l: Layout, window: TextWindow = 'message'): Issue | null {
  if (l.lineOverflow <= 0) return null;
  const n = l.lines.length;
  return { rule: 'window-lines', severity: 'warning', message: `${TEXT_WINDOW_LABEL[window]}은 ${n - l.lineOverflow}줄인데 ${n}줄이에요` };
}

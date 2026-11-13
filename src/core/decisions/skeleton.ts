// The skeleton check for partly translated values (a script or plugin command where only the Japanese inside
// is translated). The kept pieces must appear unchanged and in order, with something between each two:
// a change to the code around the text would break the game while looking like a translation.
import type { Issue } from '../types.js';
import { keepPieces } from './keys.js';
import type { KeepRule } from './types.js';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Regex for pieces[0] + (one or more chars) + pieces[1] + … + pieces[upTo]; anchored at the end only when upTo is the last piece. */
function skeletonRegExp(pieces: string[], upTo: number): RegExp {
  let src = '^' + escapeRegExp(pieces[0]);
  for (let i = 1; i <= upTo; i++) src += '([\\s\\S]+?)' + escapeRegExp(pieces[i]);
  if (upTo === pieces.length - 1) src += '$';
  return new RegExp(src);
}

/** The translated parts of text (between the kept pieces), or null when text does not keep them. */
export function translatedParts(text: string, pieces: string[]): string[] | null {
  const m = skeletonRegExp(pieces, pieces.length - 1).exec(text);
  return m ? m.slice(1) : null;
}

/** Checks that target keeps every piece of source the rule leaves untouched, unchanged and in order. */
export function checkSkeleton(source: string, target: string, keep: KeepRule): Issue[] {
  const pieces = keepPieces(source, keep);
  if (pieces === null) return [{ rule: 'skeleton', severity: 'error', message: '번역할 부분이 없습니다' }];
  if (translatedParts(target, pieces) !== null) return [];
  let bad = pieces.length - 1;
  for (let i = 0; i < pieces.length; i++) {
    if (!skeletonRegExp(pieces, i).test(target)) {
      bad = i;
      break;
    }
  }
  return [{ rule: 'skeleton', severity: 'error', message: `그대로 둬야 하는 부분이 바뀌었습니다: "${pieces[bad]}"` }];
}

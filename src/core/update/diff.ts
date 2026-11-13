import { stripControlCodes } from '../text/controlCodes.js';
import type { TextUnit, UnitRef } from '../types.js';
import type { ChangedPair, UnitDiff } from './types.js';

/** Units in the same file and of the same kind at least this similar are taken for one changed sentence. */
export const SIMILAR_ENOUGH = 0.75;

/**
 * Bigrams with a start and an end mark. The marks make the first and last characters count as much as the
 * middle ones, so a word put into a short sentence ('月光草を集める' → '月光草を三本集める') still reads as similar.
 */
function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  const chars = ['\u0002', ...s, '\u0003'];
  for (let i = 0; i + 1 < chars.length; i++) {
    const g = chars[i] + chars[i + 1];
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

function dice(a: Map<string, number>, b: Map<string, number>): number {
  let total = 0;
  let common = 0;
  for (const n of a.values()) total += n;
  for (const n of b.values()) total += n;
  for (const [g, n] of a) common += Math.min(n, b.get(g) ?? 0);
  return total === 0 ? 1 : (2 * common) / total;
}

/** Dice coefficient (0..1) of the character bigrams, control codes left out. Under 2 characters each: 1 when equal, else 0. */
export function similarity(a: string, b: string): number {
  const x = stripControlCodes(a);
  const y = stripControlCodes(b);
  if ([...x].length < 2 && [...y].length < 2) return x === y ? 1 : 0;
  return dice(bigrams(x), bigrams(y));
}

const PUNCTUATION = /[\s　、。，．！？…‥・「」『』（）〈〉《》【】［］｛｝〔〕〜～ー―—─♥❤♡♪☆★“”‘’!-/:-@[-`{-~]/g;

/** The text without spaces, line breaks, punctuation and symbols. Control codes stay. */
export function stripPunctuation(s: string): string {
  // Control codes are made of ASCII punctuation too: keep them by taking them out before stripping.
  const parts = s.split(/(\\[A-Za-z]+(?:\[[^\]\r\n]*\])?|\\[{}.|!><^$\\]|%\d+)/);
  return parts.map((p, i) => (i % 2 === 1 ? p : p.replace(PUNCTUATION, ''))).join('');
}

/** Keys of the places a ref points at: a unit at the same place in the other version is its counterpart. */
function placeKey(r: UnitRef): string | null {
  switch (r.type) {
    case 'lines': return JSON.stringify(['lines', r.file, r.listPath, r.start]);
    case 'choice': return JSON.stringify(['choice', r.file, r.listPath, r.index, r.choice]);
    case 'value': return JSON.stringify(['value', r.file, r.path]);
    case 'note': return JSON.stringify(['note', r.file, r.path, r.tag, r.index]);
    default: return null;   // a JS string's offsets move with every edit of the file
  }
}

interface Candidate { o: TextUnit; n: TextUnit; sim: number }

/** Takes candidates from the most similar down, each unit at most once. */
function pickPairs(cands: Candidate[], usedOld: Set<string>, usedNew: Set<string>, out: ChangedPair[]): void {
  cands.sort((a, b) => b.sim - a.sim);
  for (const c of cands) {
    if (usedOld.has(c.o.id) || usedNew.has(c.n.id)) continue;
    usedOld.add(c.o.id);
    usedNew.add(c.n.id);
    out.push({ oldId: c.o.id, newId: c.n.id, similarity: c.sim, punctuationOnly: stripPunctuation(c.o.source) === stripPunctuation(c.n.source) });
  }
}

/**
 * Compares the units of two versions. Ids come from kind, speaker and source, so a sentence whose source is the same
 * is kept wherever it moved. Of the rest, units at the same place are paired first, then units of the same kind in the
 * same file that are at least 75% similar.
 *
 * Plugin JS strings get their id from the file and the n-th occurrence of the same source (not from offsets), so
 * pairing the n-th with the n-th gives the same id: they land in kept and moved stays empty.
 */
export function diffUnits(oldUnits: TextUnit[], newUnits: TextUnit[]): UnitDiff {
  const oldIds = new Set(oldUnits.map((u) => u.id));
  const newIds = new Set(newUnits.map((u) => u.id));
  const kept = newUnits.filter((u) => oldIds.has(u.id)).map((u) => u.id);
  const restOld = oldUnits.filter((u) => !newIds.has(u.id));
  const restNew = newUnits.filter((u) => !oldIds.has(u.id));

  const changed: ChangedPair[] = [];
  const usedOld = new Set<string>();
  const usedNew = new Set<string>();

  // 1. Same place.
  const byPlace = new Map<string, TextUnit[]>();
  for (const o of restOld) {
    for (const r of o.refs) {
      const k = placeKey(r);
      if (k === null) continue;
      const key = `${o.kind}\u0000${k}`;
      const list = byPlace.get(key) ?? [];
      if (!list.includes(o)) list.push(o);
      byPlace.set(key, list);
    }
  }
  const placeCands: Candidate[] = [];
  const seen = new Set<string>();
  for (const n of restNew) {
    for (const r of n.refs) {
      const k = placeKey(r);
      if (k === null) continue;
      for (const o of byPlace.get(`${n.kind}\u0000${k}`) ?? []) {
        const pair = `${o.id}\u0000${n.id}`;
        if (seen.has(pair)) continue;
        seen.add(pair);
        placeCands.push({ o, n, sim: similarity(o.source, n.source) });
      }
    }
  }
  pickPairs(placeCands, usedOld, usedNew, changed);

  // 2. Similar sentences of the same kind in the same file.
  const files = (u: TextUnit) => new Set(u.refs.map((r) => r.file));
  const grams = new Map<string, Map<string, number>>();
  const gramsOf = (u: TextUnit) => {
    let g = grams.get(u.id);
    if (!g) {
      const s = stripControlCodes(u.source);
      g = bigrams(s);
      grams.set(u.id, g);
    }
    return g;
  };
  const byFileKind = new Map<string, TextUnit[]>();
  for (const o of restOld) {
    if (usedOld.has(o.id)) continue;
    for (const f of files(o)) {
      const key = `${o.kind}\u0000${f}`;
      const list = byFileKind.get(key) ?? [];
      list.push(o);
      byFileKind.set(key, list);
    }
  }
  const simCands: Candidate[] = [];
  const comparedPairs = new Set<string>();
  for (const n of restNew) {
    if (usedNew.has(n.id)) continue;
    for (const f of files(n)) {
      for (const o of byFileKind.get(`${n.kind}\u0000${f}`) ?? []) {
        const pair = `${o.id}\u0000${n.id}`;
        if (comparedPairs.has(pair)) continue;
        comparedPairs.add(pair);
        const short = [...stripControlCodes(o.source)].length < 2 && [...stripControlCodes(n.source)].length < 2;
        const sim = short ? similarity(o.source, n.source) : dice(gramsOf(o), gramsOf(n));
        if (sim >= SIMILAR_ENOUGH) simCands.push({ o, n, sim });
      }
    }
  }
  pickPairs(simCands, usedOld, usedNew, changed);

  return {
    kept,
    added: restNew.filter((u) => !usedNew.has(u.id)).map((u) => u.id),
    removed: restOld.filter((u) => !usedOld.has(u.id)).map((u) => u.id),
    changed,
    moved: [],
  };
}

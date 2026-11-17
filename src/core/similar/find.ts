// Finds earlier translations of sentences that read like the one being translated, so the user can start from
// them. The program measures this itself (no model call): two-character pieces (bigrams) shared between the
// sentences, as a Dice coefficient. Control codes and spaces are left out so a colour code or a line break does
// not make two sentences look different.
import { stripControlCodes } from '../text/controlCodes.js';

/** A translated sentence that can be offered. An empty target means not translated and is passed by. */
export interface SimilarCandidate { id: string; source: string; target: string }
/** One offered sentence; score is the match in percent (0~100, whole). */
export interface SimilarHit { id: string; source: string; target: string; score: number }

export interface SimilarOptions {
  /** Lowest match in percent to offer (default 60). */
  minScore?: number;
  /** Most sentences to offer, best first (default 3). */
  limit?: number;
  /** The sentence being translated, so it does not offer itself. */
  excludeId?: string;
}

export const SIMILAR_MIN_SCORE = 60;
export const SIMILAR_LIMIT = 3;
/** Shorter sentences ("はい", "うん") match too much of everything to be worth offering. */
export const SIMILAR_MIN_LENGTH = 4;

/** The text that is compared: control codes and all white space removed. */
export function similarityKey(source: string): string {
  return stripControlCodes(source).replace(/\s+/g, '');
}

/** Bigram -> how often it occurs; characters by code point so surrogate pairs stay whole. */
function bigrams(key: string): Map<string, number> {
  const chars = Array.from(key);
  const out = new Map<string, number>();
  for (let i = 0; i + 1 < chars.length; i++) {
    const b = chars[i] + chars[i + 1];
    out.set(b, (out.get(b) ?? 0) + 1);
  }
  return out;
}

/**
 * Bigram -> the candidates holding it, built once so a lookup touches only the candidates that share a bigram
 * instead of comparing against every sentence. Throw it away when the translations change.
 */
export interface SimilarIndex {
  readonly candidates: readonly SimilarCandidate[];
  /** Number of bigrams of each candidate (with repeats), the size used by the Dice coefficient. */
  readonly sizes: Uint32Array;
  readonly postings: Map<string, { at: number[]; count: number[] }>;
}

export function buildSimilarIndex(candidates: readonly SimilarCandidate[]): SimilarIndex {
  const kept = candidates.filter((c) => c.target !== '');
  const sizes = new Uint32Array(kept.length);
  const postings = new Map<string, { at: number[]; count: number[] }>();
  kept.forEach((c, i) => {
    let size = 0;
    for (const [b, n] of bigrams(similarityKey(c.source))) {
      size += n;
      let p = postings.get(b);
      if (!p) postings.set(b, (p = { at: [], count: [] }));
      p.at.push(i);
      p.count.push(n);
    }
    sizes[i] = size;
  });
  return { candidates: kept, sizes, postings };
}

function isIndex(x: readonly SimilarCandidate[] | SimilarIndex): x is SimilarIndex {
  return !Array.isArray(x);
}

/** Translated sentences like source, best first. Pure: the same input gives the same answer. */
export function findSimilar(source: string, candidates: readonly SimilarCandidate[] | SimilarIndex, opts: SimilarOptions = {}): SimilarHit[] {
  const minScore = opts.minScore ?? SIMILAR_MIN_SCORE;
  const limit = opts.limit ?? SIMILAR_LIMIT;
  const key = similarityKey(source);
  if (Array.from(key).length < SIMILAR_MIN_LENGTH || limit <= 0) return [];
  const index = isIndex(candidates) ? candidates : buildSimilarIndex(candidates);
  const query = bigrams(key);
  let querySize = 0;
  for (const n of query.values()) querySize += n;

  const shared = new Map<number, number>();
  for (const [b, n] of query) {
    const p = index.postings.get(b);
    if (!p) continue;
    for (let k = 0; k < p.at.length; k++) shared.set(p.at[k], (shared.get(p.at[k]) ?? 0) + Math.min(n, p.count[k]));
  }

  const scored: { i: number; raw: number }[] = [];
  for (const [i, common] of shared) {
    const c = index.candidates[i];
    if (c.id === opts.excludeId || c.source === source) continue;
    const raw = (200 * common) / (querySize + index.sizes[i]);
    if (raw >= minScore) scored.push({ i, raw });
  }
  scored.sort((a, b) => b.raw - a.raw || a.i - b.i);
  return scored.slice(0, limit).map(({ i, raw }) => {
    const c = index.candidates[i];
    return { id: c.id, source: c.source, target: c.target, score: Math.min(100, Math.round(raw)) };
  });
}

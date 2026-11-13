import { speakerNames, splitSpeaker } from '../../core/text/speaker.js';
import type { TextUnit } from '../../core/types.js';

/** What the glossary draft is written from. Gathered by the program, no tokens spent. */
export interface Material {
  names: { name: string; count: number }[];                 // speakers + actor names (count = lines spoken, 0 for actors only)
  properNouns: { text: string; count: number }[];           // katakana runs or words inside 【】『』, 3+ times, most first, up to 80
  sfx: { text: string; count: number }[];                   // a 2-4 kana chunk repeated back to back, 2+ times, most first, up to 60
  samples: { speaker: string; lines: string[]; moans: string[] }[]; // up to 12 most talkative speakers, up to 8 lines and 4 moan/exclamation lines each
  menuTerms: string[];                                      // sources of kind 'system'
  narrationSamples: string[];                               // up to 10 lines with no speaker
}

const PROPER_NOUN_MIN = 3;
const PROPER_NOUN_MAX = 80;
const SFX_MIN = 2;
const SFX_MAX = 60;
const SAMPLE_SPEAKERS = 12;
const SAMPLE_LINES = 8;
const SAMPLE_MIN_LEN = 10;
const SAMPLE_MAX_LEN = 80;
const NARRATION_MAX = 10;
const MOAN_MAX = 4;
const MOAN_RATIO = 0.7;
/** Kana, long-vowel marks, small tsu, punctuation, hearts and ellipses: what moans and exclamations are made of. */
const MOAN_CHAR = /[ぁ-ゖァ-ヺー〜～…‥・、。，．！？!?♥❤♡♪「」『』（）()〝〟"'ｰ\-—―~]/;

/** Marks that show a sound rather than plain speech: ellipses, hearts, small kana, long-vowel marks. */
const MOAN_MARK = /[…‥♥❤♡っッぁぃぅぇぉァィゥェォゃャー〜～]/;

/**
 * A line made (70%+) of kana, long marks, punctuation, hearts and ellipses: mostly moans or exclamations.
 * It must also carry a sound mark, so plain kana-only speech ("ちゃんと払うわ") does not count.
 */
export function isMoanLine(body: string): boolean {
  const chars = [...body.replace(/\s+/g, '')];
  if (chars.length === 0 || !MOAN_MARK.test(body)) return false;
  return chars.filter((c) => MOAN_CHAR.test(c)).length / chars.length >= MOAN_RATIO;
}

const KATAKANA_RUN = /[ァ-ヺ][ァ-ヺー]+/g;
const BRACKETED = /[【『]([^【】『』\n]+)[】』]/g;
const REPEATED_KANA = /([ぁ-ゖァ-ヺー]{2,4})\1/g;

function isActorName(u: TextUnit): boolean {
  const ref = u.refs[0];
  return ref?.type === 'value' && ref.file === 'data/Actors.json' && ref.path.at(-1) === 'name';
}

function bump(m: Map<string, number>, key: string): void {
  m.set(key, (m.get(key) ?? 0) + 1);
}

function ranked(m: Map<string, number>, min: number, max: number, skip: Set<string>): { text: string; count: number }[] {
  return [...m.entries()]
    .filter(([text, count]) => count >= min && !skip.has(text))
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([text, count]) => ({ text, count }));
}

/** Up to n items taken at evenly spaced positions, in order. */
function spread<T>(list: T[], n: number): T[] {
  if (list.length <= n) return [...list];
  const out: T[] = [];
  for (let k = 0; k < n; k++) out.push(list[Math.round((k * (list.length - 1)) / (n - 1))]);
  return out;
}

export function collectMaterial(units: TextUnit[], pattern: string | null): Material {
  const usable = units.filter((u) => !u.needsDecision);

  const spoken = speakerNames(usable, pattern);
  const names = [...spoken];
  const known = new Set(spoken.map((s) => s.name));
  for (const u of usable) {
    if (isActorName(u) && u.source.trim() !== '' && !known.has(u.source)) {
      known.add(u.source);
      names.push({ name: u.source, count: 0 });
    }
  }

  const nouns = new Map<string, number>();
  const sfx = new Map<string, number>();
  const linesBySpeaker = new Map<string, string[]>();
  const moansBySpeaker = new Map<string, string[]>();
  const narration: string[] = [];
  const menuTerms: string[] = [];

  for (const u of usable) {
    const s = u.source;
    const bracketSpans = new Set<string>();
    for (const m of s.matchAll(BRACKETED)) {
      bump(nouns, m[1]);
      bracketSpans.add(`${m.index! + 1}:${m[1].length}`);
    }
    for (const m of s.matchAll(KATAKANA_RUN)) {
      if (!bracketSpans.has(`${m.index}:${m[0].length}`)) bump(nouns, m[0]);
    }
    for (const m of s.matchAll(REPEATED_KANA)) bump(sfx, m[0]);

    if (u.kind === 'system') menuTerms.push(s);
    if (u.kind !== 'dialogue') continue;
    const split = splitSpeaker(s, pattern);
    const speaker = u.speaker ? u.speaker : split.speaker;
    const body = u.speaker ? s : split.body;
    if (speaker) {
      if (isMoanLine(body)) {
        const list = moansBySpeaker.get(speaker) ?? [];
        list.push(body);
        moansBySpeaker.set(speaker, list);
      }
      if (body.length >= SAMPLE_MIN_LEN && body.length <= SAMPLE_MAX_LEN) {
        const list = linesBySpeaker.get(speaker) ?? [];
        list.push(body);
        linesBySpeaker.set(speaker, list);
      }
    } else if (body.trim() !== '') narration.push(body);
  }

  const samples = spoken
    .filter((s) => (linesBySpeaker.get(s.name)?.length ?? 0) > 0 || (moansBySpeaker.get(s.name)?.length ?? 0) > 0)
    .slice(0, SAMPLE_SPEAKERS)
    .map((s) => ({ speaker: s.name, lines: spread(linesBySpeaker.get(s.name) ?? [], SAMPLE_LINES), moans: spread(moansBySpeaker.get(s.name) ?? [], MOAN_MAX) }));

  return {
    names,
    properNouns: ranked(nouns, PROPER_NOUN_MIN, PROPER_NOUN_MAX, known),
    sfx: ranked(sfx, SFX_MIN, SFX_MAX, new Set()),
    samples,
    menuTerms: [...new Set(menuTerms)],
    narrationSamples: spread(narration, NARRATION_MAX),
  };
}

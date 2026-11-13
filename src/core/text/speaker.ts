import type { TextUnit } from '../types.js';

/** Common ways games put the speaker's name on the first line of a message (MV has no name box). */
export const SPEAKER_PRESETS: { id: string; label: string; pattern: string }[] = [
  { id: 'bracket', label: '【이름】 (색 코드 허용)', pattern: '^(?:\\\\[A-Za-z]+\\[\\d+\\])*【(.+?)】(?:\\\\[A-Za-z]+\\[\\d+\\])*$' },
  { id: 'name-code', label: '\\N<이름>', pattern: '^\\\\[Nn]<(.+?)>$' },
  { id: 'colon', label: '이름:', pattern: '^(.{1,12})[:：]$' },
];

const MIN_COVERAGE = 0.3;
const cache = new Map<string, RegExp | null>();

function compile(pattern: string): RegExp | null {
  let re = cache.get(pattern);
  if (re === undefined) {
    try {
      re = new RegExp(pattern);
    } catch {
      re = null;   // a broken user pattern matches nothing
    }
    cache.set(pattern, re);
  }
  return re;
}

function multiLineDialogue(units: TextUnit[]): TextUnit[] {
  return units.filter((u) => u.kind === 'dialogue' && u.source.includes('\n'));
}

/** The preset that matches the first line of the most multi-line dialogues; null under 30%. */
export function detectSpeakerPattern(units: TextUnit[]): { pattern: string; presetId: string; coverage: number } | null {
  const list = multiLineDialogue(units);
  if (list.length === 0) return null;
  let best: { pattern: string; presetId: string; coverage: number } | null = null;
  for (const p of SPEAKER_PRESETS) {
    const re = compile(p.pattern)!;
    const hits = list.filter((u) => re.test(u.source.slice(0, u.source.indexOf('\n')))).length;
    const coverage = hits / list.length;
    if (!best || coverage > best.coverage) best = { pattern: p.pattern, presetId: p.id, coverage };
  }
  return best && best.coverage >= MIN_COVERAGE ? best : null;
}

/**
 * Splits off the speaker line. A message with a single line, or whose first line does not match,
 * keeps everything as body.
 */
export function splitSpeaker(source: string, pattern: string | null): { speakerLine: string | null; speaker: string | null; body: string } {
  const none = { speakerLine: null, speaker: null, body: source };
  if (pattern === null) return none;
  const nl = source.indexOf('\n');
  if (nl < 0) return none;
  const re = compile(pattern);
  const first = source.slice(0, nl);
  const m = re?.exec(first);
  if (!m || m[1] === undefined || m[1] === '') return none;
  return { speakerLine: first, speaker: m[1], body: source.slice(nl + 1) };
}

/** Puts the translated name into the speaker line (codes and brackets kept) and joins the body. */
export function composeSpeaker(speakerLine: string, speaker: string, speakerTarget: string, body: string): string {
  const at = speakerLine.indexOf(speaker);
  const line = at < 0 ? speakerLine : speakerLine.slice(0, at) + speakerTarget + speakerLine.slice(at + speaker.length);
  return line + '\n' + body;
}

/** Speaker names from the MZ name box and from speaker lines, most frequent first. */
export function speakerNames(units: TextUnit[], pattern: string | null): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const u of units) {
    if (u.kind !== 'dialogue') continue;
    const name = u.speaker ? u.speaker : splitSpeaker(u.source, pattern).speaker;
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

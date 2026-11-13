import { termId } from '../../core/glossary/store.js';
import type { CharacterCard, Glossary, Term, TermCategory } from '../../core/glossary/types.js';
import { stripControlCodes } from '../../core/text/controlCodes.js';
import { hasJapanese } from '../../core/text/japanese.js';
import { detectSpeakerPattern } from '../../core/text/speaker.js';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { TextUnit } from '../../core/types.js';
import { readJsonFile, writeJsonFile } from '../../core/util/json.js';
import { BatchJob, type JobOptions } from './job.js';
import {
  buildReadPrompt, isReadNote, knownSummary, mergeReadNotes, pickExcerpts, planReadChunks, READ_SCHEMA, splitChunk,
  type ReadChunk, type ReadNote, type ReadSummary,
} from './read.js';
import { estimateTokens } from './review.js';
import { collectMaterial, type Material } from './material.js';

export interface DraftResult {
  terms: { source: string; category: TermCategory; candidates: { target: string; reason: string }[] }[];
  characters: { source: string; target: string; speech: string; firstPerson?: string; addressing?: string; moanStyle?: string }[];
  styleNotes: string;
}

const CATEGORIES: TermCategory[] = ['name', 'place', 'term', 'sfx', 'other'];
const MAX_CANDIDATES = 3;
/** Heading of the per-game section the draft adds to the style guide. */
export const GAME_STYLE_HEADING = '## 이 게임의 말투';

export const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    terms: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          source: { type: 'string' },
          category: { type: 'string', enum: CATEGORIES },
          candidates: {
            type: 'array',
            items: { type: 'object', properties: { target: { type: 'string' }, reason: { type: 'string' } }, required: ['target', 'reason'] },
          },
        },
        required: ['source', 'category', 'candidates'],
      },
    },
    characters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          source: { type: 'string' }, target: { type: 'string' }, speech: { type: 'string' },
          firstPerson: { type: 'string' }, addressing: { type: 'string' }, moanStyle: { type: 'string' },
        },
        required: ['source', 'target', 'speech'],
      },
    },
    styleNotes: { type: 'string' },
  },
  required: ['terms', 'characters', 'styleNotes'],
} as const;

const isStr = (v: unknown): v is string => typeof v === 'string';
const optStr = (v: unknown) => v === undefined || typeof v === 'string';

export function isDraftResult(v: unknown): v is DraftResult {
  if (!v || typeof v !== 'object') return false;
  const d = v as any;
  return Array.isArray(d.terms) && Array.isArray(d.characters) && isStr(d.styleNotes)
    && d.terms.every((t: any) => t && isStr(t.source) && CATEGORIES.includes(t.category) && Array.isArray(t.candidates)
      && t.candidates.every((c: any) => c && isStr(c.target) && optStr(c.reason)))
    && d.characters.every((c: any) => c && isStr(c.source) && isStr(c.target) && isStr(c.speech) && optStr(c.firstPerson) && optStr(c.addressing) && optStr(c.moanStyle));
}

/** Frequency data sent with read notes (the samples are left out: the notes replace them). */
function frequencyOnly(m: Material) {
  return { names: m.names, properNouns: m.properNouns, sfx: m.sfx, menuTerms: m.menuTerms };
}

/**
 * The draft prompt. Without notes it works from the samples ('sample' mode); with notes from reading the
 * script ('balanced' / 'full') the notes replace the samples.
 */
export function buildDraftPrompt(material: Material, styleGuide: string, notes?: ReadSummary): { system: string; user: string } {
  const input = notes
    ? [
        '- names: 화자와 인물 이름. count 는 그 인물의 대사 수',
        '- properNouns: 여러 번 나온 고유명사 후보와 나온 횟수',
        '- sfx: 효과음·의성어 후보와 나온 횟수',
        '- menuTerms: 메뉴와 시스템 용어',
        '- readNotes: 대본을 읽으며 모은 메모. characters 는 인물별 성격(traits), 말투(speech), 신음과 감탄 소리의 결(moans), terms 는 고유명사, sfx 는 효과음, style 은 문체와 분위기다. 인물과 말투는 이 메모를 가장 중요한 근거로 삼는다.',
      ]
    : [
        '- names: 화자와 인물 이름. count 는 그 인물의 대사 수',
        '- properNouns: 여러 번 나온 고유명사 후보와 나온 횟수',
        '- sfx: 효과음·의성어 후보와 나온 횟수',
        '- samples: 인물별 대사 표본(lines)과 신음·감탄 위주 대사(moans)',
        '- menuTerms: 메뉴와 시스템 용어',
        '- narrationSamples: 화자 없는 지문 표본',
      ];
  const evidence = notes ? '대본 메모' : '대사 표본';
  const system = [
    '너는 RPG Maker 게임 번역에 쓸 용어집과 말투 지침의 초안을 쓴다. 아래 번역 지침이 기준이다.',
    '',
    '<번역 지침>',
    styleGuide.trim(),
    '</번역 지침>',
    '',
    '입력은 프로그램이 게임 원문에서 모은 자료(JSON)다.',
    ...input,
    '',
    '할 일:',
    '- 자료에 나온 이름·고유명사·효과음마다 번역을 정해 terms 에 넣는다. category 는 name(인물 이름), place(지명), term(그 밖의 고유명사와 용어), sfx(효과음, 의성어), other 중 하나다.',
    '- 읽는 법이나 뜻이 둘 이상으로 갈릴 수 있으면 후보를 2~3개 내고 가장 권하는 것을 첫 번째에 둔다. 후보마다 reason 에 이유를 한 줄로 적는다.',
    '- 확실하면 후보를 1개만 낸다.',
    '- 효과음은 지침의 원칙대로 한국어 소리말로 정한다. 신음은 인물마다 다르게 옮기므로 terms 에 넣지 않는다.',
    '- properNouns 에 섞여 들어온 일반 낱말(흔한 외래어 등)은 terms 에 넣지 않아도 된다.',
    `- ${evidence}를 보고 인물마다 말투를 한두 문장으로 적어 characters 에 넣는다. source 는 원문 이름, target 은 번역 이름, speech 는 말투, firstPerson 은 1인칭, addressing 은 남을 부르는 말이다. 알 수 없는 칸은 비워 둔다.`,
    `- 인물마다 성격에 맞는 신음·감탄 소리의 결을 moanStyle 에 한두 문장으로 적는다(예: 참다가 새는 짧은 소리, 받침으로 끊는다). ${evidence}에 그런 대사가 없으면 성격에서 미루어 적는다.`,
    '- 게임 전체의 분위기와 문체에서 지침에 더할 점을 styleNotes 에 적는다. 지침에 이미 있는 내용은 되풀이하지 않는다.',
    '- menuTerms 는 지침의 메뉴 용어 기준을 따르면 되므로 terms 에 넣지 않아도 된다.',
  ].join('\n');
  return { system, user: JSON.stringify(notes ? { ...frequencyOnly(material), readNotes: notes } : material) };
}

function withGameStyle(styleGuide: string, notes: string): string {
  const text = notes.trim();
  if (text === '') return styleGuide;
  const at = styleGuide.indexOf(`${GAME_STYLE_HEADING}\n`);
  if (at < 0) return `${styleGuide.trimEnd()}\n\n${GAME_STYLE_HEADING}\n${text}\n`;
  const bodyStart = at + GAME_STYLE_HEADING.length + 1;
  const next = styleGuide.slice(bodyStart).search(/^## /m);
  const tail = next < 0 ? '' : '\n' + styleGuide.slice(bodyStart + next);
  return `${styleGuide.slice(0, bodyStart)}${text}\n${tail}`;
}

/**
 * Adds the draft to the glossary. Terms and characters already there were set by the user and are kept.
 * One candidate → confirmed; two or more → provisional on the first. confirmedAt is not touched.
 */
export function mergeDraft(g: Glossary, draft: DraftResult, pattern: string | null): Glossary {
  const terms: Term[] = [...g.terms];
  const seen = new Set(terms.map((t) => t.source));
  for (const d of draft.terms) {
    // Control codes are not terms: \C[2]月光草\C[0] is the term 月光草, and \N[1] alone is nothing to translate.
    const source = stripControlCodes(d.source).trim();
    if (!hasJapanese(source)) continue;
    const candidates = d.candidates
      .map((c) => ({ target: stripControlCodes(c.target).trim(), reason: (c.reason ?? '').trim() }))
      .filter((c) => c.target !== '')
      .slice(0, MAX_CANDIDATES);
    if (source === '' || candidates.length === 0 || seen.has(source)) continue;
    seen.add(source);
    const t: Term = candidates.length === 1
      ? { id: termId(source), source, target: candidates[0].target, category: d.category, status: 'confirmed', candidates: [] }
      : { id: termId(source), source, target: candidates[0].target, category: d.category, status: 'provisional', candidates };
    if (candidates.length === 1 && candidates[0].reason) t.note = candidates[0].reason;
    terms.push(t);
  }

  const characters: CharacterCard[] = [...g.characters];
  const known = new Set(characters.map((c) => c.source));
  for (const c of draft.characters) {
    const source = c.source.trim();
    if (source === '' || known.has(source)) continue;
    known.add(source);
    const card: CharacterCard = { id: termId(source), source, target: c.target.trim(), speech: c.speech.trim() };
    if (c.firstPerson?.trim()) card.firstPerson = c.firstPerson.trim();
    if (c.addressing?.trim()) card.addressing = c.addressing.trim();
    if (c.moanStyle?.trim()) card.moanStyle = c.moanStyle.trim();
    characters.push(card);
  }

  return {
    ...g,
    terms,
    characters,
    styleGuide: withGameStyle(g.styleGuide, draft.styleNotes),
    rules: { ...g.rules, speakerPattern: g.rules.speakerPattern ?? pattern },
  };
}

export type DraftMode = 'balanced' | 'full' | 'sample';
export interface DraftOptions { budgetChars?: number; readModel?: string; mergeModel?: string }
export const DRAFT_NOTES_FILE = 'draft-notes.json';
const READ_SYSTEM_CHARS = 900;   // rough size of the read prompt's fixed text

type DraftStep = { kind: 'read'; chunk: ReadChunk } | { kind: 'merge' };

/** The pieces of script a draft would read, for the mode. */
export function draftChunks(units: TextUnit[], pattern: string | null, mode: DraftMode, budgetChars?: number, maxChars?: number): ReadChunk[] {
  if (mode === 'sample') return [];
  return mode === 'full' ? planReadChunks(units, pattern, { maxChars }) : pickExcerpts(units, pattern, { budgetChars, maxChars });
}

/** What a draft would read and roughly cost, shown before it starts. */
export function planDraft(units: TextUnit[], g: Glossary, mode: DraftMode, budgetChars?: number): { chunks: number; chars: number; estimatedInputTokens: number } {
  const pattern = g.rules.speakerPattern ?? detectSpeakerPattern(units)?.pattern ?? null;
  const chunks = draftChunks(units, pattern, mode, budgetChars);
  const material = collectMaterial(units, pattern);
  const chars = chunks.reduce((n, c) => n + c.chars, 0);
  const notesGuess = mode === 'sample' ? 0 : Math.min(chars, chunks.length * 3000);
  const mergeInput = buildDraftPrompt(material, g.styleGuide, mode === 'sample' ? undefined : { characters: [], terms: [], sfx: [], style: '' });
  const mergeChars = mergeInput.system.length + mergeInput.user.length + notesGuess;
  const readChars = chars + chunks.length * READ_SYSTEM_CHARS;
  return { chunks: chunks.length, chars: mode === 'sample' ? mergeInput.user.length : chars, estimatedInputTokens: estimateTokens(readChars + mergeChars) };
}

interface SavedNotes { chunks: { index: number; hash: string; note: ReadNote }[] }

async function loadNotes(projectDir: string): Promise<SavedNotes> {
  const file = path.join(projectDir, DRAFT_NOTES_FILE);
  if (!existsSync(file)) return { chunks: [] };
  try {
    const v = (await readJsonFile(file)) as SavedNotes;
    return Array.isArray(v?.chunks) ? { chunks: v.chunks.filter((c) => c && typeof c.hash === 'string' && isReadNote(c.note)) } : { chunks: [] };
  } catch {
    return { chunks: [] };
  }
}

/**
 * Writes the glossary draft. 'sample' sends the gathered samples once. 'balanced' and 'full' first read
 * the script piece by piece (notes are kept in draft-notes.json by content hash, so a resumed or repeated
 * draft does not read a piece twice), then send the merged notes once and merge the answer into the glossary.
 */
export class DraftJob extends BatchJob<DraftStep> {
  private readonly mode: DraftMode;
  private readonly opts: DraftOptions;
  private pattern: string | null = null;
  private detected: string | null = null;
  private saved: SavedNotes = { chunks: [] };
  private notes = new Map<string, ReadNote>();   // by chunk hash, in reading order
  private reads = 0;
  private readsDone = 0;

  private readonly chunkChars: number | undefined;

  /** chunkChars: size of a read piece (default about 20,000 characters; smaller in tests). */
  constructor(o: JobOptions & { mode?: DraftMode; chunkChars?: number } & DraftOptions) {
    super(o, 'draft');
    this.mode = o.mode ?? 'balanced';
    this.opts = { budgetChars: o.budgetChars, readModel: o.readModel, mergeModel: o.mergeModel };
    this.chunkChars = o.chunkChars;
  }

  protected plan(): { batches: DraftStep[]; total: number } {
    const svc = this.o.svc;
    const g = svc.glossary();
    this.detected = g.rules.speakerPattern === null ? detectSpeakerPattern(svc.units())?.pattern ?? null : null;
    this.pattern = g.rules.speakerPattern ?? this.detected;
    const chunks = draftChunks(svc.units(), this.pattern, this.mode, this.opts.budgetChars, this.chunkChars);
    this.reads = chunks.length;
    return { batches: [...chunks.map((chunk): DraftStep => ({ kind: 'read', chunk })), { kind: 'merge' }], total: chunks.length + 1 };
  }

  protected async runBatch(step: DraftStep, signal: AbortSignal): Promise<'next' | 'limit' | 'failed' | 'stopped'> {
    if (this.saved.chunks.length === 0 && this.reads > 0 && this.readsDone === 0) this.saved = await loadNotes(this.o.svc.projectDir);
    return step.kind === 'read' ? this.read(step.chunk, signal) : this.merge(signal);
  }

  private summary(): ReadSummary {
    return mergeReadNotes([...this.notes.values()]);
  }

  private async read(chunk: ReadChunk, signal: AbortSignal): Promise<'next' | 'limit' | 'failed' | 'stopped'> {
    this.update({ label: `대본 읽는 중 (${this.readsDone + 1}/${this.reads})` });
    const reuse = this.saved.chunks.find((c) => c.hash === chunk.hash);
    if (reuse) {
      this.notes.set(chunk.hash, reuse.note);
      return this.readDone();
    }
    const prompt = buildReadPrompt(chunk, knownSummary(this.summary()));
    let retried = false;
    for (;;) {
      const r = await this.call({ system: prompt.system, user: prompt.user, schema: READ_SCHEMA, validate: isReadNote, signal, model: this.opts.readModel });
      if (r.ok) {
        this.notes.set(chunk.hash, r.data);
        this.saved.chunks = [...this.saved.chunks.filter((c) => c.hash !== chunk.hash), { index: chunk.index, hash: chunk.hash, note: r.data }];
        await writeJsonFile(path.join(this.o.svc.projectDir, DRAFT_NOTES_FILE), this.saved);
        return this.readDone();
      }
      const what = this.failure(r, retried);
      if (what === 'retry') {
        retried = true;
        continue;
      }
      if (what === 'split') {
        const halves = splitChunk(chunk);
        if (halves) {
          this.reads += 1;
          this.queue.splice(0, 1, ...halves.map((c): DraftStep => ({ kind: 'read', chunk: c })));
          this.update({ total: this.p.total + 1 });
          return 'next';
        }
        this.update({ errors: this.p.errors + 1 });   // a single line the model will not read: skipped
        return this.readDone();
      }
      return what;
    }
  }

  private readDone(): 'next' {
    this.readsDone++;
    this.update({ done: this.p.done + 1 });
    return 'next';
  }

  private async merge(signal: AbortSignal): Promise<'next' | 'limit' | 'failed' | 'stopped'> {
    const svc = this.o.svc;
    this.update({ label: this.mode === 'sample' ? '용어집 초안' : '용어집 정리 중' });
    const material = collectMaterial(svc.units(), this.pattern);
    const prompt = buildDraftPrompt(material, svc.glossary().styleGuide, this.mode === 'sample' ? undefined : this.summary());
    let retried = false;
    for (;;) {
      const r = await this.call({ system: prompt.system, user: prompt.user, schema: DRAFT_SCHEMA, validate: isDraftResult, signal, model: this.opts.mergeModel });
      if (r.ok) {
        await svc.setGlossary(mergeDraft(svc.glossary(), r.data, this.detected));
        this.update({ done: this.p.done + 1 });
        return 'next';
      }
      const what = this.failure(r, retried);
      if (what === 'retry' && !retried) {
        retried = true;
        continue;
      }
      if (what === 'split' || what === 'retry') {
        this.p.message = r.message || '용어집 초안을 받지 못했습니다';
        return 'failed';
      }
      return what;
    }
  }
}

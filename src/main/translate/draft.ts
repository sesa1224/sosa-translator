import { termId } from '../../core/glossary/store.js';
import type { CharacterCard, Glossary, Term, TermCategory } from '../../core/glossary/types.js';
import { detectSpeakerPattern } from '../../core/text/speaker.js';
import { BatchJob, type JobOptions } from './job.js';
import { collectMaterial, type Material } from './material.js';

export interface DraftResult {
  terms: { source: string; category: TermCategory; candidates: { target: string; reason: string }[] }[];
  characters: { source: string; target: string; speech: string; firstPerson?: string; addressing?: string }[];
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
          firstPerson: { type: 'string' }, addressing: { type: 'string' },
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
    && d.characters.every((c: any) => c && isStr(c.source) && isStr(c.target) && isStr(c.speech) && optStr(c.firstPerson) && optStr(c.addressing));
}

export function buildDraftPrompt(material: Material, styleGuide: string): { system: string; user: string } {
  const system = [
    '너는 RPG Maker 게임 번역에 쓸 용어집과 말투 지침의 초안을 쓴다. 아래 번역 지침이 기준이다.',
    '',
    '<번역 지침>',
    styleGuide.trim(),
    '</번역 지침>',
    '',
    '입력은 프로그램이 게임 원문에서 모은 자료(JSON)다.',
    '- names: 화자와 인물 이름. count 는 그 인물의 대사 수',
    '- properNouns: 여러 번 나온 고유명사 후보와 나온 횟수',
    '- sfx: 효과음·의성어 후보와 나온 횟수',
    '- samples: 인물별 대사 표본',
    '- menuTerms: 메뉴와 시스템 용어',
    '- narrationSamples: 화자 없는 지문 표본',
    '',
    '할 일:',
    '- 자료에 나온 이름·고유명사·효과음마다 번역을 정해 terms 에 넣는다. category 는 name(인물 이름), place(지명), term(그 밖의 고유명사와 용어), sfx(효과음, 의성어, 신음), other 중 하나다.',
    '- 읽는 법이나 뜻이 둘 이상으로 갈릴 수 있으면 후보를 2~3개 내고 가장 권하는 것을 첫 번째에 둔다. 후보마다 reason 에 이유를 한 줄로 적는다.',
    '- 확실하면 후보를 1개만 낸다.',
    '- 효과음은 지침의 원칙대로 한국어 소리말로 정한다.',
    '- properNouns 에 섞여 들어온 일반 낱말(흔한 외래어 등)은 terms 에 넣지 않아도 된다.',
    '- 대사 표본을 보고 인물마다 말투를 한두 문장으로 적어 characters 에 넣는다. source 는 원문 이름, target 은 번역 이름, speech 는 말투, firstPerson 은 1인칭, addressing 은 남을 부르는 말이다. 알 수 없는 칸은 비워 둔다.',
    '- 게임 전체의 분위기와 문체에서 지침에 더할 점을 styleNotes 에 적는다. 지침에 이미 있는 내용은 되풀이하지 않는다.',
    '- menuTerms 는 지침의 메뉴 용어 기준을 따르면 되므로 terms 에 넣지 않아도 된다.',
  ].join('\n');
  return { system, user: JSON.stringify(material) };
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
    const source = d.source.trim();
    const candidates = d.candidates
      .map((c) => ({ target: c.target.trim(), reason: (c.reason ?? '').trim() }))
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

/** One call that writes the glossary draft and merges it into the project's glossary. */
export class DraftJob extends BatchJob<'draft'> {
  constructor(o: JobOptions) {
    super(o, 'draft');
  }

  protected plan(): { batches: 'draft'[]; total: number } {
    return { batches: ['draft'], total: 1 };
  }

  protected async runBatch(_b: 'draft', signal: AbortSignal): Promise<'next' | 'limit' | 'failed' | 'stopped'> {
    const svc = this.o.svc;
    const g = svc.glossary();
    const detected = g.rules.speakerPattern === null ? detectSpeakerPattern(svc.units())?.pattern ?? null : null;
    const prompt = buildDraftPrompt(collectMaterial(svc.units(), g.rules.speakerPattern ?? detected), g.styleGuide);
    let retried = false;
    for (;;) {
      this.update({ label: '용어집 초안' });
      const r = await this.call({ system: prompt.system, user: prompt.user, schema: DRAFT_SCHEMA, validate: isDraftResult, signal });
      if (r.ok) {
        await svc.setGlossary(mergeDraft(svc.glossary(), r.data, detected));
        this.update({ done: 1 });
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

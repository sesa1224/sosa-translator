import { z } from 'zod';
import type { TextUnit } from '../core/types.js';
import type { Row } from '../shared/api.js';
import { computeStats, filterRows, toRow } from '../shared/rows.js';
import type { ProjectService } from './projectService.js';
import type { KeepRule } from '../core/decisions/types.js';

export interface ToolDef { name: string; description: string; inputSchema: z.ZodObject<any> }

export type ToolResult = { ok: true; data: unknown } | { ok: false; error: string };

const SEARCH_DEFAULT = 20;
const SEARCH_MAX = 50;
const CONTEXT_KINDS = new Set(['dialogue', 'scroll']);

const statusFilter = z.enum(['all', 'untranslated', 'needs-review', 'approved', 'error', 'declined', 'needs-decision', 'provisional']);
const termCategory = z.enum(['name', 'place', 'term', 'sfx', 'other']);
const GLOSSARY_SEARCH_MAX = 30;

export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'project_status',
    description: '프로젝트 이름, 엔진, 상태별 줄 수를 볼 때 쓴다.',
    inputSchema: z.object({}),
  },
  {
    name: 'search_units',
    description: '번역 항목을 찾을 때 쓴다. 원문, 번역, 화자에서 글자 그대로 찾는다(정규식 아님, 대소문자 무시). 빈 검색어는 전체.',
    inputSchema: z.object({
      query: z.string().describe('찾을 글자'),
      status: statusFilter.optional().describe('상태로 좁히기'),
      limit: z.number().int().positive().optional().describe(`돌려받을 최대 개수 (기본 ${SEARCH_DEFAULT}, 최대 ${SEARCH_MAX})`),
    }),
  },
  {
    name: 'get_unit',
    description: '한 항목의 자세한 내용(검사 결과, 같은 파일의 앞뒤 대사)을 읽을 때 쓴다.',
    inputSchema: z.object({ id: z.string().describe('항목 id') }),
  },
  {
    name: 'set_translation',
    description: '한 항목의 번역을 쓰거나 고칠 때 쓴다. 형식 검사 결과를 돌려준다.',
    inputSchema: z.object({ id: z.string().describe('항목 id'), target: z.string().describe('번역문') }),
  },
  {
    name: 'set_status',
    description: '한 항목을 승인하거나 다시 검토 필요로 돌릴 때 쓴다.',
    inputSchema: z.object({ id: z.string().describe('항목 id'), status: z.enum(['approved', 'needs-review']) }),
  },
  {
    name: 'undo_last',
    description: '채팅에서 한 가장 최근 변경 하나를 되돌릴 때 쓴다.',
    inputSchema: z.object({}),
  },
  {
    name: 'glossary_search',
    description: '용어집의 용어와 인물 카드를 찾을 때 쓴다. 원문과 번역에서 글자 그대로 찾는다(대소문자 무시). 빈 검색어는 전체.',
    inputSchema: z.object({ query: z.string().describe('찾을 글자') }),
  },
  {
    name: 'glossary_set_term',
    description: '용어의 번역을 정하거나 바꿀 때 쓴다. 확정 상태로 저장되고, 번역이 바뀌면 그 용어가 들어간 번역문도 조사까지 맞춰 바뀐다.',
    inputSchema: z.object({
      source: z.string().describe('원문 용어'),
      target: z.string().describe('번역'),
      category: termCategory.optional().describe('name 이름, place 지명, term 용어, sfx 효과음, other 기타 (새 용어의 기본값 term)'),
    }),
  },
  {
    name: 'list_decisions',
    description: '판단 필요 항목(플러그인 커맨드, 스크립트, 플러그인 설정, 메모란, 플러그인 JS 문자열)의 묶음을 볼 때 쓴다. 키, 이름, 쓰인 곳 수, 표본, 힌트, 지금 결정을 돌려준다.',
    inputSchema: z.object({ query: z.string().optional().describe('키, 이름, 표본에서 글자 그대로 찾기 (대소문자 무시)') }),
  },
  {
    name: 'set_decision',
    description: '판단 필요 묶음(또는 unit:<id> 로 항목 하나)을 번역할지 정할 때 쓴다. 바로 확정된다. 화면에 보이는 글자라는 근거가 있을 때만 translate true 로 한다.',
    inputSchema: z.object({
      key: z.string().describe('list_decisions 의 key, 또는 unit:<항목 id>'),
      translate: z.boolean().describe('번역하면 true, 코드가 읽는 값이면 false'),
      mode: z.enum(['whole', 'args', 'spans']).optional().describe('whole 값 전체, args MV 커맨드의 앞뒤 조각은 그대로, spans 일본어 부분만 (기본 whole)'),
      from: z.number().int().min(0).optional().describe('args: 앞에서 그대로 둘 조각 수 (기본 1)'),
      dropLast: z.number().int().min(0).optional().describe('args: 뒤에서 그대로 둘 조각 수 (기본 0)'),
      reason: z.string().optional().describe('이유'),
    }),
  },
];

function brief(r: Row) {
  return {
    id: r.id, kind: r.kind, speaker: r.speaker ?? null, location: r.location,
    source: r.source, target: r.target, status: r.status, needsDecision: r.needsDecision,
  };
}

function rowOf(svc: ProjectService, u: TextUnit): Row {
  return toRow(u, svc.entry(u.id));
}

function allRows(svc: ProjectService): Row[] {
  return svc.units().map((u) => rowOf(svc, u));
}

function context(svc: ProjectService, unit: TextUnit) {
  const file = unit.refs[0]?.file;
  const list = svc.units().filter((u) => u.id === unit.id || (u.refs[0]?.file === file && CONTEXT_KINDS.has(u.kind)));
  const i = list.findIndex((u) => u.id === unit.id);
  const pick = (us: TextUnit[]) => us.map((u) => ({ source: u.source, target: svc.entry(u.id).target }));
  return { before: pick(list.slice(Math.max(0, i - 2), i)), after: pick(list.slice(i + 1, i + 3)) };
}

type Handler = (svc: ProjectService, input: any) => Promise<unknown>;

const HANDLERS: Record<string, Handler> = {
  async project_status(svc) {
    return { name: svc.meta.name, engine: svc.meta.engine, stats: computeStats(allRows(svc)) };
  },
  async search_units(svc, input: { query: string; status?: z.infer<typeof statusFilter>; limit?: number }) {
    const found = filterRows(allRows(svc), { text: input.query, status: input.status });
    const limit = Math.min(input.limit ?? SEARCH_DEFAULT, SEARCH_MAX);
    return { total: found.length, items: found.slice(0, limit).map(brief) };
  },
  async get_unit(svc, input: { id: string }) {
    const unit = svc.unit(input.id);
    if (!unit) throw new Error(`없는 항목입니다: ${input.id}`);
    const row = rowOf(svc, unit);
    return { ...brief(row), refCount: row.refCount, issues: svc.issues(unit.id), ...context(svc, unit) };
  },
  async set_translation(svc, input: { id: string; target: string }) {
    const issues = await svc.setTranslation(input.id, input.target, 'chat');
    return { status: svc.entry(input.id).status, issues };
  },
  async set_status(svc, input: { id: string; status: 'approved' | 'needs-review' }) {
    await svc.setStatus(input.id, input.status, 'chat');
    return { status: svc.entry(input.id).status };
  },
  async undo_last(svc) {
    return { ids: await svc.undo('chat') };
  },
  async glossary_search(svc, input: { query: string }) {
    const q = input.query.toLowerCase();
    const g = svc.glossary();
    const has = (...s: (string | undefined)[]) => q === '' || s.some((x) => x !== undefined && x.toLowerCase().includes(q));
    const terms = g.terms.filter((t) => has(t.source, t.target)).slice(0, GLOSSARY_SEARCH_MAX)
      .map((t) => ({ source: t.source, target: t.target, category: t.category, status: t.status, candidates: t.candidates }));
    const characters = g.characters.filter((c) => has(c.source, c.target)).slice(0, GLOSSARY_SEARCH_MAX)
      .map(({ id: _id, ...c }) => c);
    return { terms, characters };
  },
  async glossary_set_term(svc, input: { source: string; target: string; category?: z.infer<typeof termCategory> }) {
    const source = input.source.trim();
    const existing = svc.glossary().terms.find((t) => t.source === source);
    if (!existing) {
      const t = await svc.upsertTerm({ source, target: input.target, category: input.category ?? 'term', status: 'confirmed', candidates: [] });
      return { term: t, changed: [], uncertain: [] };
    }
    if (input.category && input.category !== existing.category) await svc.upsertTerm({ ...existing, category: input.category });
    const r = await svc.chooseCandidate(existing.id, input.target);
    return { term: svc.glossary().terms.find((t) => t.id === existing.id), ...r };
  },
};

HANDLERS.list_decisions = async (svc, input: { query?: string }) => {
  const q = (input.query ?? '').toLowerCase();
  const groups = svc.decisionGroups().filter((g) => q === '' || [g.key, g.label, ...g.samples].some((s) => s.toLowerCase().includes(q)));
  return { total: groups.length, groups: groups.slice(0, GLOSSARY_SEARCH_MAX).map((g) => ({ key: g.key, label: g.label, count: g.count, samples: g.samples, hints: g.hints, decision: g.decision })) };
};
HANDLERS.set_decision = async (svc, input: { key: string; translate: boolean; mode?: 'whole' | 'args' | 'spans'; from?: number; dropLast?: number; reason?: string }) => {
  const mode = input.mode ?? 'whole';
  const keep: KeepRule = mode === 'args' ? { mode, from: input.from ?? 1, dropLast: input.dropLast ?? 0 } : { mode };
  await svc.setDecision(input.key, { translate: input.translate, keep, ...(input.reason !== undefined ? { reason: input.reason } : {}) }, 'claude');
  return { key: input.key, decision: svc.decisions()[input.key] };
};

/** Runs one tool for the chat. All writes use origin 'chat'. Never throws. */
export async function callTool(svc: ProjectService, name: string, input: unknown): Promise<ToolResult> {
  const def = TOOL_DEFS.find((d) => d.name === name);
  if (!def) return { ok: false, error: `모르는 도구입니다: ${name}` };
  const parsed = def.inputSchema.safeParse(input ?? {});
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.') || '(입력)'}: ${i.message}`).join('; ');
    return { ok: false, error: `입력이 올바르지 않습니다: ${detail}` };
  }
  try {
    return { ok: true, data: await HANDLERS[name](svc, parsed.data) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---- plan 5: events and patches (appended; the tools above are unchanged) ----
const RAW_MAX = 30;
const USAGE_MAX = 50;
const pathSeg = z.union([z.string(), z.number().int()]);
const eventCommand = z.object({ code: z.number().int(), indent: z.number().int().min(0), parameters: z.array(z.any()) });
const listOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('insert'), after: z.number().int().describe('원본 번호. -1 이면 맨 앞'), commands: z.array(eventCommand).min(1) }),
  z.object({ op: z.literal('delete'), at: z.number().int().describe('원본 번호') }),
  z.object({ op: z.literal('replace'), at: z.number().int().describe('원본 번호'), commands: z.array(eventCommand).min(1) }),
]);

TOOL_DEFS.push(
  {
    name: 'event_files',
    description: '이벤트가 있는 파일(맵, 커먼이벤트, 전투 이벤트)의 목록을 볼 때 쓴다.',
    inputSchema: z.object({}),
  },
  {
    name: 'event_list',
    description: '한 파일의 이벤트 목록(맵은 페이지마다 한 줄)과 조건, listPath 를 볼 때 쓴다.',
    inputSchema: z.object({ file: z.string().describe('event_files 의 file (예: data/Map001.json)') }),
  },
  {
    name: 'event_read',
    description: '이벤트 하나를 풀어쓴 글로 읽을 때 쓴다. 줄마다 원본 번호(index)가 있고, 수정에 쓸 해시를 준다. raw true 와 from/to 로 그 범위의 원본 커맨드를 최대 30줄 받는다.',
    inputSchema: z.object({
      file: z.string(), listPath: z.array(pathSeg).describe('event_list 의 listPath'),
      raw: z.boolean().optional().describe('원본 커맨드를 받으려면 true'),
      from: z.number().int().min(0).optional().describe('raw: 첫 원본 번호 (기본 0)'),
      to: z.number().int().min(0).optional().describe('raw: 끝 원본 번호 (포함)'),
    }),
  },
  {
    name: 'usage_search',
    description: '스위치, 변수, 커먼이벤트, 아이템, 그림이 어디서 켜지고(write) 읽히는지(read) 찾을 때 쓴다. 페이지 조건은 index -1.',
    inputSchema: z.object({
      type: z.enum(['switch', 'variable', 'commonEvent', 'item', 'picture']),
      id: z.union([z.number().int(), z.string()]).describe('번호, 그림은 파일 이름'),
    }),
  },
  {
    name: 'event_patch',
    description: '이벤트를 고칠 때 쓴다. 원본 번호 기준의 연산(insert after, delete at, replace at)을 낸다. 같은 이벤트에 수정이 있으면 그 수정의 연산을 이것으로 바꾼다.',
    inputSchema: z.object({
      title: z.string().describe('수정 제목 (사용자에게 보인다)'),
      file: z.string(), listPath: z.array(pathSeg), baseHash: z.string().describe('event_read 의 hash'),
      ops: z.array(listOp).min(1),
      note: z.string().optional().describe('무엇을 왜 고쳤는지'),
      originalBug: z.boolean().optional().describe('게임 원본의 결함을 고친 것이면 true'),
    }),
  },
);

HANDLERS.event_files = async (svc) => ({ files: await eventFiles(svc.projectDir) });
HANDLERS.event_list = async (svc, input: { file: string }) => {
  const events = await listEvents(svc.projectDir, input.file);
  return { total: events.length, events: events.map(({ key: _key, ...e }) => e) };
};
HANDLERS.event_read = async (svc, input: { file: string; listPath: PathSeg[]; raw?: boolean; from?: number; to?: number }) => {
  const ev = await readEvent(svc.projectDir, input.file, input.listPath);
  const key = JSON.stringify([input.file, input.listPath]);
  const patch = svc.patches().find((p) => p.body.kind === 'event' && JSON.stringify([p.body.file, p.body.listPath]) === key);
  const out: Record<string, unknown> = {
    label: ev.label, condition: ev.condition, hash: ev.hash, commandCount: ev.raw.length,
    lines: ev.lines.map((l) => ({ index: l.index, indent: l.indent, text: l.text })),
  };
  if (patch && patch.body.kind === 'event') out.patch = { title: patch.title, enabled: patch.enabled, ops: patch.body.ops };
  if (input.raw) {
    const from = input.from ?? 0;
    const to = Math.min(input.to ?? from + RAW_MAX - 1, from + RAW_MAX - 1, ev.raw.length - 1);
    const raw = [];
    for (let i = from; i <= to; i++) raw.push({ index: i, ...ev.raw[i] });
    out.raw = raw;
  }
  return out;
};
HANDLERS.usage_search = async (svc, input: { type: UsageTarget['type']; id: number | string }) => {
  const found = await findUsage(svc.projectDir, { type: input.type, id: input.id });
  return { total: found.length, items: found.slice(0, USAGE_MAX).map(({ file, listPath, label, index, text, access }) => ({ file, listPath, label, index, text, access })) };
};
HANDLERS.event_patch = async (svc, input: { title: string; file: string; listPath: PathSeg[]; baseHash: string; ops: ListOp[]; note?: string; originalBug?: boolean }) => {
  const body: PatchBody = { kind: 'event', file: input.file, listPath: input.listPath, baseHash: input.baseHash, ops: input.ops };
  const key = JSON.stringify([input.file, input.listPath]);
  const same = svc.patches().filter((p) => p.body.kind === 'event' && JSON.stringify([p.body.file, p.body.listPath]) === key);
  const existing = same.find((p) => p.enabled) ?? same[0];
  const p = existing
    ? await svc.updatePatch(existing.id, { body, enabled: true, ...(input.note !== undefined ? { note: input.note } : {}), ...(input.originalBug !== undefined ? { originalBug: input.originalBug } : {}) })
    : await svc.addPatch({ title: input.title, note: input.note, originalBug: input.originalBug, body }, 'claude');
  const status = (await svc.patchStatuses()).find((s) => s.id === p.id);
  return { id: p.id, title: p.title, updated: !!existing, state: status?.state ?? 'applied', reason: status?.reason };
};

import { eventFiles, listEvents, readEvent } from '../core/events/browse.js';
import { findUsage, type UsageTarget } from '../core/events/usage.js';
import type { PathSeg } from '../core/types.js';
import type { ListOp, PatchBody } from '../core/patches/types.js';

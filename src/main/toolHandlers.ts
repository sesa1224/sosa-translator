import { z } from 'zod';
import type { TextUnit, UnitRef } from '../core/types.js';
import type { Row } from '../shared/api.js';
import { computeStats, filterRows, locationLabel, toRow } from '../shared/rows.js';
import { clipLine } from '../core/history/store.js';
import type { ActionSummary, CancelResult } from '../core/history/types.js';
import type { ProjectService } from './projectService.js';
import type { KeepRule } from '../core/decisions/types.js';
import type { Region } from '../core/images/types.js';
import type { PathSeg } from '../core/types.js';
import type { ListOp, PatchBody } from '../core/patches/types.js';
import { eventFiles, listEvents, readEvent } from '../core/events/browse.js';
import { findUsage, type UsageTarget } from '../core/events/usage.js';
import { imageServiceOf } from './images.js';
import { previewServiceOf } from './preview.js';
import { NEED_FONT } from './projectService.js';

// The chat's tools: their names, Korean descriptions and input schemas (TOOL_DEFS), and what each one does
// (HANDLERS). The MCP server in src/mcp lists TOOL_DEFS to the Claude CLI and forwards each call here through
// the local bridge (src/main/bridge.ts). Every write goes through ProjectService; translations are written
// with origin 'chat' so the chat's undo_last takes back only the chat's changes. Names and descriptions are what
// the model sees, and the system prompt (src/main/claude/prompt.ts) and --allowedTools (args.ts) name tools too.

export interface ToolDef { name: string; description: string; inputSchema: z.ZodObject<any> }

export type ToolResult = { ok: true; data: unknown; images?: ToolImage[] } | { ok: false; error: string };
/** A picture a tool sends back to the model. */
export interface ToolImage { mediaType: 'image/png'; base64: string }

const SEARCH_DEFAULT = 20;
const SEARCH_MAX = 50;
const CONTEXT_KINDS = new Set(['dialogue', 'scroll']);

const statusFilter = z.enum(['all', 'untranslated', 'translated', 'needs-review', 'approved', 'error', 'declined', 'needs-decision', 'provisional', 'overflow']);
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
      status: statusFilter.optional().describe('상태로 좁히기 (overflow: 게임 창을 넘는 번역)'),
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
    description: '한 항목을 승인하거나(approved), 사람이 다시 봐야 할 때 검토 필요로 올리거나(needs-review), 번역 완료로 되돌릴 때(translated) 쓴다.',
    inputSchema: z.object({ id: z.string().describe('항목 id'), status: z.enum(['approved', 'needs-review', 'translated']) }),
  },
  {
    name: 'undo_last',
    description: '채팅이 방금 고친 것을 통째로 되돌린다: 이번 턴의 변경, 없으면 채팅의 직전 행동. 무엇을 몇 줄 되돌렸는지 준다.',
    inputSchema: z.object({}),
  },
  {
    name: 'glossary_search',
    description: '용어집의 용어와 인물 카드를 찾을 때 쓴다. 원문과 번역에서 글자 그대로 찾는다(대소문자 무시). 빈 검색어는 전체.',
    inputSchema: z.object({ query: z.string().describe('찾을 글자') }),
  },
  {
    name: 'glossary_set_term',
    description: '용어의 번역을 정하거나 바꿀 때 쓴다. 확정 상태로 저장되고, 번역이 바뀌면 그 용어가 들어간 번역문도 조사까지 맞춰 바뀐다. scope 가 speaker 인 용어는 화자 이름 자리의 번역문만 바뀐다.',
    inputSchema: z.object({
      source: z.string().describe('원문 용어'),
      target: z.string().describe('번역'),
      category: termCategory.optional().describe('name 이름, place 지명, term 용어, sfx 효과음, other 기타 (새 용어의 기본값 term)'),
      scope: z.enum(['all', 'speaker', 'name']).optional().describe('speaker: 화자 이름 자리(화자 줄, 이름 칸)에만 맞춘다. 先生 처럼 남들이 호칭으로도 쓰는 화자 이름에 쓴다. name: 그 말이 이름으로 쓰인 곳에만 맞춘다. 보통 낱말과 글자가 같은 인물 이름에 쓴다. all: 어디서나(기본)'),
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
  {
    name: 'list_actions',
    description: '작업 기록의 최근 행동 10개(id, 시각, 출처, 제목, 줄 수, 취소됐는지)를 볼 때 쓴다.',
    inputSchema: z.object({}),
  },
  {
    name: 'cancel_action',
    description: '작업 기록의 행동 하나만 취소할 때 쓴다. 그 뒤에 다시 바뀐 줄은 건드리지 않는다.',
    inputSchema: z.object({ id: z.string().describe('list_actions 의 id') }),
  },
];

const THIS_TURN = '이번 턴에 채팅에서 바꾼 것';
const ACTIONS_MAX = 10;
const UNDO_LINES = 5;
const UNDO_SOURCE_CHARS = 30;

/**
 * What a take-back did, for the model to tell the user: the action, the counts, and the first few lines. Only ids
 * once let the chat wipe lines without knowing which.
 */
function undoReport(svc: ProjectService, action: { id?: string; label: string; at?: string; origin: string }, r: CancelResult, unitIds: string[]) {
  const lines = unitIds.slice(0, UNDO_LINES).map((id) => {
    const u = svc.unit(id);
    return { location: u ? locationLabel(u) : '', source: u ? clipLine(u.source, UNDO_SOURCE_CHARS) : null };
  });
  return { undone: true, action, restored: r.restored, skipped: r.skipped, lines, more: Math.max(0, unitIds.length - lines.length) };
}

async function cancelReport(svc: ProjectService, a: ActionSummary) {
  const r = await svc.cancelAction(a.id);
  const unitIds = svc.actionDetail(a.id, 0, UNDO_LINES).lines.map((l) => l.unitId);
  // The detail is one page; the count of the whole action comes from the summary.
  const report = undoReport(svc, { id: a.id, label: a.label, at: a.at, origin: a.origin }, r, unitIds);
  return { ...report, more: Math.max(0, a.count - report.lines.length) };
}

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
    // Laying out every row costs more than the other filters, so only this filter does it.
    const found = input.status === 'overflow'
      ? filterRows(svc.units().filter((u) => svc.hasWindowOverflow(u.id)).map((u) => rowOf(svc, u)), { text: input.query })
      : filterRows(allRows(svc), { text: input.query, status: input.status });
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
    const target = svc.autoWrap(input.id, input.target);
    const issues = await svc.setTranslation(input.id, target, 'chat');
    // The model is told when its line breaks were moved, so it does not "fix" them back.
    return { status: svc.entry(input.id).status, issues, ...(target !== input.target ? { rewrapped: target } : {}) };
  },
  async set_status(svc, input: { id: string; status: 'approved' | 'needs-review' | 'translated' }) {
    await svc.setStatus(input.id, input.status, 'chat');
    return { status: svc.entry(input.id).status };
  },
  async undo_last(svc) {
    const open = await svc.revertOpenAction('chat');
    if (open) return undoReport(svc, { label: THIS_TURN, origin: 'chat' }, open, open.unitIds);
    const last = svc.actions().find((a) => a.origin === 'chat' && a.undoneAt === undefined);
    if (!last) return { undone: false, reason: '되돌릴 채팅 변경이 없습니다' };
    return cancelReport(svc, last);
  },
  async glossary_search(svc, input: { query: string }) {
    const q = input.query.toLowerCase();
    const g = svc.glossary();
    const has = (...s: (string | undefined)[]) => q === '' || s.some((x) => x !== undefined && x.toLowerCase().includes(q));
    const terms = g.terms.filter((t) => has(t.source, t.target)).slice(0, GLOSSARY_SEARCH_MAX)
      .map((t) => ({ source: t.source, target: t.target, category: t.category, status: t.status, candidates: t.candidates, ...(t.scope ? { scope: t.scope } : {}) }));
    const characters = g.characters.filter((c) => has(c.source, c.target)).slice(0, GLOSSARY_SEARCH_MAX)
      .map(({ id: _id, ...c }) => c);
    return { terms, characters };
  },
  async glossary_set_term(svc, input: { source: string; target: string; category?: z.infer<typeof termCategory>; scope?: 'all' | 'speaker' | 'name' }) {
    const source = input.source.trim();
    const existing = svc.glossary().terms.find((t) => t.source === source);
    const scope = input.scope === 'speaker' || input.scope === 'name' ? { scope: input.scope } : {};
    if (!existing) {
      const t = await svc.upsertTerm({ source, target: input.target, category: input.category ?? 'term', status: 'confirmed', candidates: [], ...scope });
      return { term: t, changed: [], uncertain: [] };
    }
    const wanted = input.scope === undefined ? existing.scope : input.scope === 'all' ? undefined : input.scope;
    if ((input.category && input.category !== existing.category) || wanted !== existing.scope) {
      const { scope: _old, ...plain } = existing;
      // The scope is set before the rename, so the rename already follows it.
      await svc.upsertTerm({ ...plain, category: input.category ?? existing.category, ...(wanted ? { scope: wanted } : {}) });
    }
    const r = await svc.chooseCandidate(existing.id, input.target);
    return { term: svc.glossary().terms.find((t) => t.id === existing.id), ...r };
  },
};

HANDLERS.list_actions = async (svc) => {
  const all = svc.actions();
  return {
    total: all.length,
    actions: all.slice(0, ACTIONS_MAX).map((a) => ({ id: a.id, at: a.at, origin: a.origin, label: a.label, count: a.count, undone: a.undoneAt !== undefined })),
  };
};
HANDLERS.cancel_action = async (svc, input: { id: string }) => {
  const a = svc.actions().find((x) => x.id === input.id);
  if (!a) throw new Error(`없는 행동입니다: ${input.id}`);
  if (a.undoneAt !== undefined) throw new Error('이미 취소한 행동입니다');
  return cancelReport(svc, a);
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
    const out = await HANDLERS[name](svc, parsed.data);
    if (out instanceof WithImages) return { ok: true, data: out.data, images: out.images };
    return { ok: true, data: out };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---- events and patches ----
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
      version: z.string().optional().describe('옛 버전 id (예: v1). 게임 업데이트 뒤 충돌난 수정을 볼 때. 없으면 지금 버전'),
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

// ---- pictures ----

/** A handler result that also carries pictures for the model. */
export class WithImages {
  constructor(readonly data: unknown, readonly images: ToolImage[]) {}
}

const pngImage = (png: Uint8Array): ToolImage => ({ mediaType: 'image/png', base64: Buffer.from(png).toString('base64') });
const IMAGE_LIST_DEFAULT = 50;
const IMAGE_LIST_MAX = 200;
const imageStatus = z.enum(['none', 'todo', 'done', 'manual', 'skip']);
const hexColor = z.string().describe("'#rrggbb' 또는 반투명 '#rrggbbaa'");
const regionInput = z.object({
  rect: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).describe('원본 그림의 픽셀 좌표'),
  erase: z.enum(['none', 'fill', 'sample']).optional().describe('none 안 지움, fill fillColor 로 채움, sample 영역 바로 바깥 색으로 채움 (기본 sample)'),
  fillColor: hexColor.optional(),
  text: z.string().optional().describe('넣을 번역문. 줄바꿈은 \n. 빈 글이면 지우기만'),
  source: z.string().optional().describe('그림에 원래 적혀 있던 글'),
  fontPath: z.string().optional().describe('보통 비워 둔다(기본 폰트)'),
  size: z.number().optional().describe('글자 크기 px (원본 기준, 기본 24)'),
  color: hexColor.optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  valign: z.enum(['top', 'middle', 'bottom']).optional(),
  lineHeight: z.number().optional().describe('줄 높이 배수 (기본 1.25)'),
  bold: z.boolean().optional(),
  stroke: z.object({ color: hexColor, width: z.number() }).optional().describe('글자 테두리'),
  shadow: z.object({ color: hexColor, dx: z.number(), dy: z.number(), blur: z.number() }).optional(),
});

TOOL_DEFS.push(
  {
    name: 'image_sheet',
    description: '게임 그림을 번호 붙은 썸네일 격자(모음판) 한 장으로 볼 때 쓴다. 한 장에 20개, 글자가 있는 그림을 고를 때 먼저 본다.',
    inputSchema: z.object({
      folder: z.string().optional().describe("폴더로 좁히기, 예 'img/pictures'"),
      status: imageStatus.optional().describe('상태로 좁히기 (none 아직 안 봄)'),
      page: z.number().int().positive().optional().describe('쪽 번호 (기본 1)'),
    }),
  },
  {
    name: 'image_view',
    description: '그림 한 장을 크게 볼 때 쓴다. rendered 는 지시서대로 찍은 결과. 긴 변 1568px 이하로 줄여 보내므로 좌표는 scale 로 나눠 원본 좌표로 바꾼다.',
    inputSchema: z.object({ file: z.string().describe("그림 파일, 예 'img/pictures/menu.png'"), which: z.enum(['original', 'rendered']).optional().describe('기본 original') }),
  },
  {
    name: 'image_set_recipe',
    description: '그림의 작업 지시서(글자 영역마다 지우는 방식, 번역문, 크기, 색, 정렬)를 쓸 때 쓴다. 이 그림의 영역 전체를 바꾼다. 좌표는 원본 픽셀.',
    inputSchema: z.object({
      file: z.string().describe('그림 파일'),
      regions: z.array(regionInput).describe('글자 영역들'),
      done: z.boolean().optional().describe('true 면 끝남으로 표시해 패치에 넣는다'),
    }),
  },
  {
    name: 'image_set_status',
    description: '그림의 상태를 바꿀 때 쓴다. 글자가 없는 그림은 skip, 다시 할 것은 todo, 다 된 것은 done.',
    inputSchema: z.object({ file: z.string().describe('그림 파일'), status: z.enum(['todo', 'done', 'skip']) }),
  },
  {
    name: 'image_list',
    description: '그림 목록을 글로만 볼 때 쓴다(그림 없음). 파일, 크기, 상태, 문제, 이벤트에서 쓰인 횟수.',
    inputSchema: z.object({
      status: imageStatus.optional(), folder: z.string().optional(),
      limit: z.number().int().positive().optional().describe(`최대 개수 (기본 ${IMAGE_LIST_DEFAULT}, 최대 ${IMAGE_LIST_MAX})`),
    }),
  },
);

HANDLERS.event_files = async (svc) => ({ files: await eventFiles(svc.projectDir) });
HANDLERS.event_list = async (svc, input: { file: string }) => {
  const events = await listEvents(svc.projectDir, input.file);
  return { total: events.length, events: events.map(({ key: _key, ...e }) => e) };
};
HANDLERS.event_read = async (svc, input: { file: string; listPath: PathSeg[]; raw?: boolean; from?: number; to?: number; version?: string }) => {
  const ev = await readEvent(svc.projectDir, input.file, input.listPath, input.version);
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

TOOL_DEFS.push({
  name: 'set_josa_plugin',
  description: '조사 자동 맞춤을 켜고 끈다. 게임이 이름·숫자를 넣은 뒤 은(는)·이(가) 같은 꼴을 받침에 맞춰 고르는 작은 플러그인이 패치에 들어간다.',
  inputSchema: z.object({ enabled: z.boolean() }),
});
HANDLERS.set_josa_plugin = async (svc, input: { enabled: boolean }) => {
  await svc.setJosaPatch(input.enabled, 'claude');
  const conflictingPlugins = await svc.josaConflicts();
  if (!input.enabled) return { enabled: false, conflictingPlugins };
  const p = svc.patches().find((x) => x.body.kind === 'josa');
  const status = p ? (await svc.patchStatuses()).find((s) => s.id === p.id) : undefined;
  return { enabled: true, state: status?.state ?? 'applied', ...(status?.reason ? { reason: status.reason } : {}), conflictingPlugins };
};

function needImages(svc: ProjectService) {
  const images = imageServiceOf(svc);
  if (!images) throw new Error('그림 기능을 쓸 수 없습니다(게임 폴더를 찾을 수 없음)');
  return images;
}

const compactRegion = (r: Region) => ({ id: r.id, rect: r.rect, text: r.text, ...(r.source ? { source: r.source } : {}), size: r.size, erase: r.erase });

HANDLERS.image_sheet = async (svc, input: { folder?: string; status?: z.infer<typeof imageStatus>; page?: number }) => {
  const s = await needImages(svc).sheet({ folder: input.folder, status: input.status, page: input.page ?? 1 });
  const data = { page: input.page ?? 1, pages: s.pages, items: s.items };
  return s.items.length > 0 ? new WithImages(data, [pngImage(s.png)]) : data;
};
HANDLERS.image_view = async (svc, input: { file: string; which?: 'original' | 'rendered' }) => {
  const images = needImages(svc);
  const which = input.which ?? 'original';
  const entry = await images.entry(input.file);
  if (!entry) throw new Error(`없는 그림입니다: ${input.file}`);
  const v = await images.view(input.file, which);
  const recipe = images.recipe(input.file);
  const data = {
    file: input.file, which, width: entry.width, height: entry.height, scale: Math.round(v.scale * 10000) / 10000, status: entry.status,
    ...(entry.problem ? { problem: entry.problem } : {}),
    ...(recipe ? { regions: recipe.regions.map(compactRegion) } : {}),
  };
  return new WithImages(data, [pngImage(v.png)]);
};
HANDLERS.image_set_recipe = async (svc, input: { file: string; regions: (Partial<Region> & { rect: Region['rect'] })[]; done?: boolean }) => {
  const images = needImages(svc);
  // Only fonts the user can see in the font list (or the default) may be named; anything else is made up.
  const known = new Set([...images.knownFonts(), ...(images.defaultFontPath ? [images.defaultFontPath] : [])].map((p) => p.toLowerCase()));
  const regions = input.regions.map((r) => ({ ...r, fontPath: r.fontPath && known.has(r.fontPath.toLowerCase()) ? r.fontPath : null }));
  let recipe = await images.setRecipe(input.file, regions, 'claude');
  if (input.done) {
    await images.setStatus(input.file, 'done');
    recipe = images.recipe(input.file)!;
  }
  const overflow = await images.overflow(input.file);
  return {
    file: input.file, status: recipe.status, regions: recipe.regions.map(compactRegion),
    overflow: Object.fromEntries(Object.entries(overflow).filter(([, o]) => o.overflowX || o.overflowY)),
    ...(recipe.note ? { glossaryNote: recipe.note } : {}),
  };
};
HANDLERS.image_set_status = async (svc, input: { file: string; status: 'todo' | 'done' | 'skip' }) => {
  const images = needImages(svc);
  await images.setStatus(input.file, input.status);
  return { file: input.file, status: images.recipe(input.file)?.status ?? input.status };
};
HANDLERS.image_list = async (svc, input: { status?: z.infer<typeof imageStatus>; folder?: string; limit?: number }) => {
  const folder = input.folder ? input.folder.replace(/\/+$/, '') + '/' : '';
  const all = (await needImages(svc).list()).filter((e) => (!folder || e.file.startsWith(folder)) && (!input.status || e.status === input.status));
  const limit = Math.min(input.limit ?? IMAGE_LIST_DEFAULT, IMAGE_LIST_MAX);
  return {
    total: all.length,
    items: all.slice(0, limit).map((e) => ({ file: e.file, width: e.width, height: e.height, status: e.status, ...(e.problem ? { problem: e.problem } : {}), usedByEvents: e.usedByEvents })),
  };
};

// ---- finding text in the game ----
const FIND_MAX = 10;

TOOL_DEFS.push(
  {
    name: 'find_game_text',
    description: '화면 글자가 게임의 어디에 있는지 찾을 때 쓴다. 글자 전체가 같은 문자열을 먼저, 세 글자 이상이면 글의 일부로 든 곳(data 파일·메모 칸, 플러그인 설정 값)도 찾는다. 자리와 번역 항목인지를 준다.',
    inputSchema: z.object({ text: z.string().min(1).describe('찾을 글자') }),
  },
  {
    name: 'add_extract_text',
    description: '일본어가 없어 번역 항목이 아닌 글자를 항목으로 넣을 때 쓴다. 플러그인 설정에 있을 때만 넣는다. 넣은 뒤 번역은 판단 필요 항목처럼 한다.',
    inputSchema: z.object({ text: z.string().min(1).describe('넣을 글자') }),
  },
);

type Place = Awaited<ReturnType<ProjectService['findGameText']>>[number];

const sameRef = (a: UnitRef, b: UnitRef) => JSON.stringify(a) === JSON.stringify(b);

const pathKeys = (p: PathSeg[]) => JSON.stringify(p.map((s) => (typeof s === 'object' ? s.key : s)));

/** Whether ref writes the data string at path (a whole value, or one line or choice of an event command list). */
function refCovers(ref: UnitRef, file: string, at: PathSeg[]): boolean {
  if (ref.file !== file) return false;
  if (ref.type === 'value') return pathKeys(ref.path) === pathKeys(at);
  if (ref.type !== 'lines' && ref.type !== 'choice') return false;
  const n = ref.listPath.length;
  if (at.length <= n || pathKeys(at.slice(0, n)) !== pathKeys(ref.listPath)) return false;
  const i = at[n];
  if (typeof i !== 'number') return false;
  return ref.type === 'lines' ? i >= ref.start && i < ref.start + ref.count : i === ref.index;
}

/** The unit at a place, if it is one already. */
function unitAt(svc: ProjectService, text: string, p: Place): TextUnit | undefined {
  if (p.where === 'plugin-value' || p.where === 'plugin-key' || p.where === 'plugin-value-part') return svc.units().find((u) => u.refs.some((r) => sameRef(r, p.ref)));
  if (p.where === 'data-part') {
    if (p.note) {
      const ref: UnitRef = { type: 'note', file: p.file, path: p.path, tag: p.note.tag, index: p.note.index };
      return svc.units().find((u) => u.refs.some((r) => sameRef(r, ref)));
    }
    return svc.units().find((u) => u.source.includes(text) && u.refs.some((r) => refCovers(r, p.file, p.path)));
  }
  return svc.units().find((u) => u.source === text && u.refs.some((r) => r.file === p.file));
}

/** 'n번 항목의 note' for a database row's field, otherwise the path itself. */
function fieldLabel(at: PathSeg[]): string {
  const keys = at.map((s) => (typeof s === 'object' ? s.key : s));
  if (keys.length === 2 && typeof keys[0] === 'number') return `${keys[0]}번 항목의 ${keys[1]}`;
  return keys.join(' › ');
}

/** Places as the model sees them, at most FIND_MAX. */
function describePlaces(svc: ProjectService, text: string, places: Place[]) {
  return places.slice(0, FIND_MAX).map((p) => {
    const u = unitAt(svc, text, p);
    const unit = u ? { id: u.id, status: svc.entry(u.id).status, target: svc.entry(u.id).target } : null;
    if (p.where === 'plugin-value' || p.where === 'plugin-key') {
      return { where: p.where === 'plugin-key' ? '플러그인 설정의 열쇠 이름' : '플러그인 설정 값', plugin: p.plugin, setting: p.setting, unit };
    }
    if (p.where === 'plugin-value-part') return { where: '플러그인 설정 값의 일부', plugin: p.plugin, setting: p.setting, snippet: p.snippet, unit };
    if (p.where === 'data-part') {
      return { where: 'data 파일 문자열의 일부', file: p.file, field: fieldLabel(p.path), ...(p.note ? { tag: p.note.tag } : {}), snippet: p.snippet, unit };
    }
    return { where: p.where === 'data' ? 'data 파일' : '플러그인 JS 문자열', file: p.file, count: p.count, unit };
  });
}

HANDLERS.find_game_text = async (svc, input: { text: string }) => {
  const places = await svc.findGameText(input.text);
  return { total: places.length, places: describePlaces(svc, input.text, places) };
};
HANDLERS.add_extract_text = async (svc, input: { text: string }) => {
  const text = input.text;
  const places = await svc.findGameText(text);
  const inPlugins = places.filter((p) => p.where === 'plugin-value' || p.where === 'plugin-key');
  if (inPlugins.length === 0) {
    return { added: false, reason: places.length === 0 ? '게임에서 찾지 못했습니다' : '플러그인 설정에 없어 넣지 않았습니다', total: places.length, places: describePlaces(svc, text, places) };
  }
  if (inPlugins.every((p) => unitAt(svc, text, p))) {
    return { added: false, reason: '이미 번역 항목입니다', total: places.length, places: describePlaces(svc, text, places) };
  }
  await svc.addExtraString(text);
  return { added: true, total: places.length, places: describePlaces(svc, text, places) };
};

// ---- game updates ----
TOOL_DEFS.push({
  name: 'update_summary',
  description: '게임을 새 버전으로 가져온 뒤 무엇이 바뀌었는지(문장 수, 수정 옮기기 결과, 그림, 경고)와 충돌난 수정의 목록(제목, 이유, 파일, listPath)을 볼 때 쓴다.',
  inputSchema: z.object({}),
});
HANDLERS.update_summary = async (svc) => {
  const s = await svc.updateSummary();
  if (!s) throw new Error('가져온 업데이트가 없습니다');
  const byId = new Map(svc.patches().map((p) => [p.id, p]));
  const conflicts = s.patches.filter((m) => m.result === 'conflict').map((m) => {
    const b = byId.get(m.id)?.body;
    return { id: m.id, title: m.title, reason: m.reason ?? '', ...(b && b.kind === 'event' ? { file: b.file, listPath: b.listPath } : b && b.kind === 'json' ? { file: b.file, path: b.path } : {}) };
  });
  const { patches: _all, ...rest } = s;
  return { ...rest, patches: { unchanged: s.patches.filter((m) => m.result === 'unchanged').length, moved: s.patches.filter((m) => m.result === 'moved').length, conflict: conflicts.length }, conflicts };
};

// ---- text that does not fit the game window ----
const UNFIXED_MAX = 10;
const textWindow = z.enum(['message', 'help']);

TOOL_DEFS.push(
  {
    name: 'set_text_window',
    description: '게임 창에서 글자가 잘릴 때 그 창의 한 줄 길이(와 줄 수)를 정한다. 대사창(message)과 설명창(help: 아이템·무기·방어구·스킬 설명)은 따로다. 길이는 chars, fits, px 가운데 하나로 준다.',
    inputSchema: z.object({
      window: textWindow,
      chars: z.number().positive().optional().describe('한 줄에 들어가는 한글 글자 수'),
      fits: z.string().optional().describe('게임에서 한 줄에 딱 맞게 들어간 글'),
      px: z.number().positive().optional().describe('한 줄 너비 px'),
      maxLines: z.number().int().positive().optional().describe('창의 줄 수'),
      withFace: z.boolean().optional().describe('얼굴 그림이 있는 대사로 잰 길이면 true (대사창만)'),
    }),
  },
  {
    name: 'rewrap_overflow',
    description: '게임 창을 넘는 번역의 줄바꿈 위치를 프로그램이 다시 맞춘다(글자는 바꾸지 않는다). 못 고친 줄은 문장을 줄여 고친다.',
    inputSchema: z.object({ window: textWindow.optional().describe('한 창만 (없으면 전부)') }),
  },
);

function needPreview(svc: ProjectService) {
  const p = previewServiceOf(svc);
  if (!p || !p.settings().fontPath || p.fontMissing) throw new Error(NEED_FONT);
  return p;
}

HANDLERS.set_text_window = async (svc, input: { window: 'message' | 'help'; chars?: number; fits?: string; px?: number; maxLines?: number; withFace?: boolean }) => {
  const p = needPreview(svc);
  const given = [input.chars, input.fits, input.px].filter((v) => v !== undefined).length;
  if (given > 1) throw new Error('chars, fits, px 가운데 하나만 주세요');
  if (given === 0 && input.maxLines === undefined) throw new Error('chars, fits, px 가운데 하나나 maxLines 를 주세요');
  const hangul = p.windows()[input.window].hangulWidth ?? 0;
  let width: number | undefined;
  if (input.chars !== undefined) width = input.chars * hangul;
  else if (input.fits !== undefined) width = p.measureLine(input.fits.split('\n')[0], input.window) ?? undefined;
  else if (input.px !== undefined) width = input.px;
  // A length measured beside a face picture is the window's width less the face.
  if (width !== undefined && input.window === 'message' && input.withFace) width += p.metrics().faceIndent;
  await p.setWindow(input.window, { ...(width !== undefined ? { width: Math.ceil(width) } : {}), ...(input.maxLines !== undefined ? { maxLines: input.maxLines } : {}) });
  const info = p.windows()[input.window];
  const plan = svc.planRewrap({ window: input.window });
  return {
    window: input.window, width: info.limit.width,
    ...(input.window === 'message' ? { widthWithFace: info.limit.width - info.faceIndent } : {}),
    maxLines: info.limit.maxLines, hangulChars: hangul > 0 ? Math.floor(info.limit.width / hangul) : null,
    overflowing: plan.fixed + plan.unfixable, canRewrap: plan.fixed,
  };
};

HANDLERS.rewrap_overflow = async (svc, input: { window?: 'message' | 'help' }) => {
  needPreview(svc);
  const r = await svc.rewrapOverflow(input.window ? { window: input.window } : {}, 'chat');
  return { fixed: r.fixed, unfixable: r.unfixable, unfixableIds: r.unfixableIds.slice(0, UNFIXED_MAX), reasons: r.reasons };
};

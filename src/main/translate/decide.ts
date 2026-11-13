import { autoDecide } from '../../core/decisions/auto.js';
import type { Decision, DecisionGroup, Decisions, KeepRule } from '../../core/decisions/types.js';
import type { UnitKind } from '../../core/types.js';
import { BatchJob, type JobOptions } from './job.js';

/** Groups per call, and plugin JS strings per call. */
export const DECIDE_GROUPS_PER_CALL = 30;
export const DECIDE_STRINGS_PER_CALL = 40;
const JS_CONTEXT = 60;

export const DECIDE_SCHEMA = {
  type: 'object',
  properties: {
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          translate: { type: 'boolean' },
          mode: { type: 'string', enum: ['whole', 'args', 'spans'] },
          from: { type: 'integer' },
          dropLast: { type: 'integer' },
          reason: { type: 'string' },
        },
        required: ['key', 'translate', 'mode', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['decisions'],
  additionalProperties: false,
} as const;

export interface DecideAnswer {
  decisions: { key: string; translate: boolean; mode: 'whole' | 'args' | 'spans'; from?: number; dropLast?: number; reason: string }[];
}

const isInt = (v: unknown) => v === undefined || (typeof v === 'number' && Number.isInteger(v));

export function isDecideAnswer(v: unknown): v is DecideAnswer {
  if (!v || typeof v !== 'object' || !Array.isArray((v as DecideAnswer).decisions)) return false;
  return (v as DecideAnswer).decisions.every((d) => !!d && typeof d === 'object'
    && typeof d.key === 'string' && typeof d.translate === 'boolean' && typeof d.reason === 'string'
    && (d.mode === 'whole' || d.mode === 'args' || d.mode === 'spans') && isInt(d.from) && isInt(d.dropLast));
}

/** One thing to decide: a group, or a single plugin JS string ('unit:<id>') with the code around it. */
export interface DecideEntry {
  key: string; label: string; kind: UnitKind; count: number; samples: string[];
  hints?: DecisionGroup['hints'];
  context?: { before: string; after: string };
}
export interface DecideBatch { label: string; entries: DecideEntry[] }

const SYSTEM = [
  'RPG Maker MV/MZ 게임의 플러그인 커맨드·스크립트·설정값 묶음을 보고, 화면에 보이는 글자인지 코드가 읽는 값인지 판단한다.',
  '화면에 보이면 translate true. 그림·소리·영상 파일 이름, 스위치나 변수 이름, 코드가 비교하는 키, 태그 이름은 translate false.',
  '값의 일부만 표시 글자면 mode 를 정한다: MV 커맨드에서 앞의 몇 조각과 뒤의 몇 조각이 설정값이면 args(from, dropLast), 문자열 안에 코드와 글자가 섞였으면 spans, 값 전체가 글자면 whole.',
  '확신이 없으면 translate false 로 하고 reason 에 이유를 적는다(잘못 번역하면 게임이 깨지고, 안 번역하면 일본어가 남을 뿐이다).',
  '',
  '입력: { "groups": [...] }. 각 묶음의 key, label(커맨드 이름이나 플러그인·인자 이름), kind, count(쓰인 곳 수), samples(서로 다른 원문 최대 5개), hints(fileNames = 표본 중 게임의 그림·소리 파일 이름과 같은 수, metaType·metaText·metaDesc = 플러그인 주석의 @type·@text·@desc).',
  'key 가 unit: 으로 시작하는 항목은 플러그인 JS 파일 안의 문자열 하나이고, context.before / context.after 는 그 앞뒤 코드다.',
  'args 의 from 은 앞에서 그대로 둘 조각 수(공백으로 나눈 조각, 커맨드 이름 포함), dropLast 는 뒤에서 그대로 둘 조각 수다.',
  '답: { "decisions": [{ "key", "translate", "mode", "from"?, "dropLast"?, "reason" }] }. 받은 key 마다 하나씩, reason 은 한국어로 짧게.',
].join('\n');

/** System and user text for one decide call. */
export function buildDecidePrompt(groups: (DecisionGroup | DecideEntry)[]): { system: string; user: string } {
  const out = groups.map((g) => {
    const e: Record<string, unknown> = { key: g.key, label: g.label, kind: g.kind, count: g.count, samples: g.samples };
    if (g.hints) e.hints = g.hints;
    if ('context' in g && g.context) e.context = g.context;
    return e;
  });
  return { system: SYSTEM, user: JSON.stringify({ groups: out }) };
}

/** Turns one answer line into a suggested decision by Claude. */
export function toDecision(d: DecideAnswer['decisions'][number]): Decision {
  const keep: KeepRule = d.mode === 'args'
    ? { mode: 'args', from: Math.max(0, d.from ?? 1), dropLast: Math.max(0, d.dropLast ?? 0) }
    : { mode: d.mode };
  return { translate: d.translate, keep, status: 'suggested', by: 'claude', reason: d.reason };
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/**
 * Suggests decisions for needs-decision groups. First the certain ones from plugin headers and file names
 * (no call), then the groups still without any decision go to Claude in batches; plugin JS strings go one
 * by one ('unit:<id>'). Results are saved as suggestions; confirmed decisions are never changed.
 */
export class DecideJob extends BatchJob<DecideBatch> {
  private prepared = false;

  constructor(o: JobOptions) {
    super(o, 'decide');
  }

  /** Saves the automatic suggestions before planning the calls. */
  override async start(): Promise<void> {
    if (!this.prepared) {
      this.prepared = true;
      const auto = autoDecide(this.o.svc.decisionGroups());
      if (Object.keys(auto).length > 0) await this.o.svc.addSuggestions(auto);
    }
    return super.start();
  }

  protected plan(): { batches: DecideBatch[]; total: number } {
    const svc = this.o.svc;
    const d: Decisions = svc.decisions();
    const groups = svc.decisionGroups();
    const batches: DecideBatch[] = [];

    const plain = groups.filter((g) => !g.key.startsWith('js:') && !d[g.key]);
    chunk(plain, DECIDE_GROUPS_PER_CALL).forEach((entries, i, all) => {
      batches.push({ label: all.length > 1 ? `판단 필요 묶음 ${i + 1}/${all.length}` : '판단 필요 묶음', entries: entries.map((g) => ({ ...g, hints: { ...g.hints } })) });
    });

    // Plugin JS strings: one entry per string, unless the whole file (or the string) already has a decision.
    const jsEntries = new Map<string, DecideEntry[]>();
    for (const u of svc.units()) {
      if (!u.needsDecision || u.kind !== 'plugin-js' || !u.decisionKey) continue;
      const key = `unit:${u.id}`;
      if (d[u.decisionKey] || d[key]) continue;
      const ref = u.refs[0];
      const entry: DecideEntry = { key, label: u.decisionKey.slice(3), kind: u.kind, count: u.refs.length, samples: [u.source] };
      if (ref?.type === 'js') {
        const text = svc.originalText(ref.file);
        if (text !== null) entry.context = { before: text.slice(Math.max(0, ref.start - 1 - JS_CONTEXT), Math.max(0, ref.start - 1)), after: text.slice(ref.end + 1, ref.end + 1 + JS_CONTEXT) };
      }
      const list = jsEntries.get(u.decisionKey) ?? [];
      list.push(entry);
      jsEntries.set(u.decisionKey, list);
    }
    for (const [key, entries] of jsEntries) {
      chunk(entries, DECIDE_STRINGS_PER_CALL).forEach((part, i, all) => {
        batches.push({ label: all.length > 1 ? `${key.slice(3)} ${i + 1}/${all.length}` : key.slice(3), entries: part });
      });
    }
    return { batches, total: batches.reduce((n, b) => n + b.entries.length, 0) };
  }

  protected async runBatch(batch: DecideBatch, signal: AbortSignal): Promise<'next' | 'limit' | 'failed' | 'stopped'> {
    this.update({ label: batch.label });
    const prompt = buildDecidePrompt(batch.entries);
    let retried = false;
    for (;;) {
      const r = await this.call({ system: prompt.system, user: prompt.user, schema: DECIDE_SCHEMA, validate: isDecideAnswer, signal });
      if (r.ok) {
        const sent = new Set(batch.entries.map((e) => e.key));
        const out: Decisions = {};
        for (const a of r.data.decisions) {
          if (sent.has(a.key) && !out[a.key]) out[a.key] = toDecision(a);   // keys never sent are dropped
        }
        if (Object.keys(out).length > 0) await this.o.svc.addSuggestions(out);
        this.update({ done: this.p.done + batch.entries.length });
        return 'next';
      }
      const what = this.failure(r, retried);
      if (what === 'retry') {
        retried = true;
        continue;
      }
      if (what === 'split') {
        // A refused or broken answer: this batch is skipped.
        this.update({ done: this.p.done + batch.entries.length, errors: this.p.errors + batch.entries.length });
        return 'next';
      }
      return what;
    }
  }
}

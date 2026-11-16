import { autoDecide } from '../../core/decisions/auto.js';
import { isKeyNamesKey } from '../../core/decisions/keys.js';
import { headerBlockRanges } from '../../core/extract/pluginMeta.js';
import { hasJapanese } from '../../core/text/japanese.js';
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
  /** Lines of the plugin's file that read the setting (key names and strings without Japanese only). */
  code?: string;
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

/** Sent only with batches holding key names or strings without Japanese, so other calls do not pay for it. */
const CODE_SYSTEM = [
  'code 는 그 설정을 읽는 플러그인 코드 조각이다(줄 번호: 코드). 판단의 근거로 쓴다.',
  'key 가 param-keys: 로 시작하는 묶음은 값이 아니라 객체의 열쇠 이름이다. code 에서 그 이름을 화면에 찍기만 하면(Object.keys 로 목록을 보여 주는 등) translate true. Object.keys 로 얻은 이름으로 같은 객체를 다시 찾는 것(obj[Object.keys(obj)[i]])은 이름이 바뀌어도 동작하므로 화면 표시로 본다. 그 이름이 code 에 글자 그대로 적혀 있거나(obj["이름"], === "이름") 이름 자체를 저장하면 translate false, code 로 알 수 없으면 translate false.',
].join('\n');

/** System and user text for one decide call. */
export function buildDecidePrompt(groups: (DecisionGroup | DecideEntry)[]): { system: string; user: string } {
  let withCode = false;
  const out = groups.map((g) => {
    const e: Record<string, unknown> = { key: g.key, label: g.label, kind: g.kind, count: g.count, samples: g.samples };
    if (g.hints) e.hints = g.hints;
    if ('context' in g && g.context) e.context = g.context;
    if ('code' in g && g.code) {
      e.code = g.code;
      withCode = true;
    }
    if (isKeyNamesKey(g.key)) withCode = true;
    return e;
  });
  return { system: withCode ? `${SYSTEM}\n${CODE_SYSTEM}` : SYSTEM, user: JSON.stringify({ groups: out }) };
}

/** Limits of the code sent with a group: the whole file would cost far more tokens than the decision is worth. */
export const SNIPPET_MAX_CHARS = 800;
export const SNIPPET_MAX_LINE = 160;
const SNIPPET_USES = 6;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The lines of a plugin file that read one of its settings, outside the header comments: lines naming the setting
 * in quotes (or as .name), and when such a line stores it (var X = …, X = …) a few lines using X. Numbered, each
 * cut at SNIPPET_MAX_LINE, SNIPPET_MAX_CHARS in all. Empty when the setting is not named in the code.
 */
export function pluginCodeSnippet(js: string, setting: string): string {
  const lines = js.split(/\r?\n/);
  const starts: number[] = [];
  let at = 0;
  for (const l of lines) {
    starts.push(at);
    at += l.length + 1;
  }
  const blocks = headerBlockRanges(js.replace(/\r\n/g, '\n'));
  const inHeader = (i: number) => blocks.some((b) => starts[i] >= b.start && starts[i] < b.end);
  const quoted = new RegExp(`(["'\`])${escapeRe(setting)}\\1`);
  const dotted = /^[A-Za-z_$][\w$]*$/.test(setting) ? new RegExp(`\\.${escapeRe(setting)}\\b`) : null;
  const hits: number[] = [];
  const vars = new Set<string>();
  lines.forEach((l, i) => {
    if (inHeader(i) || !(quoted.test(l) || (dotted?.test(l) ?? false))) return;
    hits.push(i);
    const m = /^\s*(?:(?:var|let|const)\s+)?([A-Za-z_$][\w$.]*)\s*=(?!=)/.exec(l);
    if (m) vars.add(m[1]);
  });
  const uses: number[] = [];
  for (const v of vars) {
    const re = new RegExp(`(^|[^\\w$.])${escapeRe(v)}(?![\\w$])`);
    let n = 0;
    lines.forEach((l, i) => {
      if (n >= SNIPPET_USES || hits.includes(i) || uses.includes(i) || inHeader(i) || !re.test(l)) return;
      uses.push(i);
      n++;
    });
  }
  const chosen: number[] = [];
  let total = 0;
  for (const i of [...hits, ...uses]) {
    const text = `${i + 1}: ${lines[i].trim().slice(0, SNIPPET_MAX_LINE)}`;
    if (total + text.length + 1 > SNIPPET_MAX_CHARS) break;
    chosen.push(i);
    total += text.length + 1;
  }
  return chosen.sort((a, b) => a - b).map((i) => `${i + 1}: ${lines[i].trim().slice(0, SNIPPET_MAX_LINE)}`).join('\n');
}

/** Plugin and setting names of a plugin parameter group key ('param:' or 'param-keys:'), or null. */
export function settingOf(key: string): { plugin: string; setting: string } | null {
  const m = /^param(?:-keys)?:([^:]*):(.*)$/.exec(key);
  if (!m) return null;
  const setting = m[2].split(/\.|\[\*\]/)[0];
  return setting ? { plugin: m[1], setting } : null;
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

    // Key names and strings the user added without Japanese say little by themselves: the code reading them goes along.
    const needsCode = new Set<string>();
    for (const u of svc.units()) {
      if (u.needsDecision && u.decisionKey && (isKeyNamesKey(u.decisionKey) || !hasJapanese(u.source))) needsCode.add(u.decisionKey);
    }
    const withCode = (g: DecisionGroup): DecideEntry => {
      const e: DecideEntry = { ...g, hints: { ...g.hints } };
      const s = needsCode.has(g.key) ? settingOf(g.key) : null;
      const js = s && !/[\\/]/.test(s.plugin) ? svc.originalText(`js/plugins/${s.plugin}.js`) : null;
      const code = js !== null && s ? pluginCodeSnippet(js, s.setting) : '';
      if (code) e.code = code;
      return e;
    };
    const plain = groups.filter((g) => !g.key.startsWith('js:') && !d[g.key]);
    chunk(plain, DECIDE_GROUPS_PER_CALL).forEach((entries, i, all) => {
      batches.push({ label: all.length > 1 ? `판단 필요 묶음 ${i + 1}/${all.length}` : '판단 필요 묶음', entries: entries.map(withCode) });
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

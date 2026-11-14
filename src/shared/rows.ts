import type { PathSeg, TextUnit, TranslationEntry, UnitRef } from '../core/types.js';
import type { Row, RowQuery, Scope, Stats } from './api.js';
import type { RowDecision } from './api.js';
import type { Decision } from '../core/decisions/types.js';

/** How a decision shows in a row. */
export function rowDecisionOf(d: Decision | null): RowDecision {
  if (!d) return 'none';
  if (d.status === 'confirmed') return d.translate ? 'translate' : 'skip';
  return d.translate ? 'suggested-translate' : 'suggested-skip';
}

/**
 * Decision state of needs-decision units, kept up to date by the main process's ProjectService so that
 * every toRow call (also the ones that do not pass a decision) shows it. Units not in it count as 'none'.
 */
export const unitRowDecisions = new WeakMap<TextUnit, RowDecision>();

function segValue(s: PathSeg | undefined): string | number | undefined {
  if (s === undefined) return undefined;
  return typeof s === 'object' ? s.key : s;
}

function refPath(ref: UnitRef): PathSeg[] {
  if (ref.type === 'note') return ref.path;
  if (ref.type === 'js') return [];
  return ref.type === 'value' ? ref.path : ref.listPath;
}

function dataName(file: string): string | null {
  const m = /^data\/(.+)\.json$/i.exec(file);
  return m ? m[1] : null;
}

function mapNumber(name: string): number | null {
  const m = /^Map(\d+)$/i.exec(name);
  return m ? Number(m[1]) : null;
}

/** Short name of a file for the scope list: '맵4', '커먼이벤트', '플러그인 설정', 'Items'. */
export function scopeLabel(file: string): string {
  if (file === 'js/plugins.js') return '플러그인 설정';
  const name = dataName(file);
  if (name === null) return file;
  const map = mapNumber(name);
  if (map !== null) return `맵${map}`;
  if (name === 'CommonEvents') return '커먼이벤트';
  return name;
}

/** Human-readable location of a unit's first ref, e.g. '맵4 · 이벤트3 · 2페이지', 'Items · 1'. */
export function locationLabel(unit: TextUnit): string {
  const ref = unit.refs[0];
  if (!ref) return '';
  const file = ref.file;
  if (file === 'js/plugins.js') return '플러그인 설정';
  const name = dataName(file);
  if (name === null) return file;
  const p = refPath(ref);
  const map = mapNumber(name);
  if (map !== null) {
    let s = `맵${map}`;
    if (segValue(p[0]) === 'events' && typeof segValue(p[1]) === 'number') {
      s += ` · 이벤트${segValue(p[1])}`;
      const page = segValue(p[3]);
      if (segValue(p[2]) === 'pages' && typeof page === 'number' && page > 0) s += ` · ${page + 1}페이지`;
    }
    return s;
  }
  if (name === 'CommonEvents') {
    const n = segValue(p[0]);
    return typeof n === 'number' ? `커먼이벤트${n}` : '커먼이벤트';
  }
  if (name === 'System') return '시스템';
  const first = segValue(p[0]);
  return typeof first === 'number' ? `${name} · ${first}` : name;
}

/** usesProvisional: whether the unit's source holds a provisional term (only counts when translated). */
export function toRow(unit: TextUnit, entry: TranslationEntry, usesProvisional = false, decision?: RowDecision): Row {
  const row: Row = {
    id: unit.id,
    kind: unit.kind,
    ...(unit.speaker !== undefined ? { speaker: unit.speaker } : {}),
    source: unit.source,
    target: entry.target,
    status: entry.status,
    needsDecision: unit.needsDecision,
    file: unit.refs[0]?.file ?? '',
    location: locationLabel(unit),
    refCount: unit.refs.length,
    usesProvisional: usesProvisional && entry.target !== null,
    decision: unit.needsDecision ? (decision ?? unitRowDecisions.get(unit) ?? 'none') : null,
    external: entry.external === true,
  };
  if (unit.decisionKey !== undefined) row.decisionKey = unit.decisionKey;
  if (entry.declinedReason !== undefined) row.declinedReason = entry.declinedReason;
  if (entry.review !== undefined) row.review = { ...entry.review };
  if (entry.previous !== undefined) row.previous = { source: entry.previous.source, target: entry.previous.target };
  if (entry.carried) row.carried = true;
  return row;
}

/** Plain-text (not regex), case-insensitive search over source, target and speaker; plus status and file filters. */
export function filterRows(rows: Row[], q: RowQuery): Row[] {
  const text = (q.text ?? '').toLowerCase();
  const status = q.status ?? 'all';
  return rows.filter((r) => {
    if (q.file && r.file !== q.file) return false;
    if (q.decisionKey && r.decisionKey !== q.decisionKey) return false;
    if (status === 'needs-decision') {
      if (!r.needsDecision) return false;
    } else if (status === 'provisional') {
      if (!r.usesProvisional) return false;
    } else if (status === 'external') {
      if (!r.external) return false;
    } else if (status === 'skipped') {
      if (r.decision !== 'skip') return false;
    } else if (status === 'changed') {
      if (!r.previous) return false;
    } else if (status !== 'all' && r.status !== status) return false;
    if (text === '') return true;
    return r.source.toLowerCase().includes(text)
      || (r.target !== null && r.target.toLowerCase().includes(text))
      || (r.speaker !== undefined && r.speaker.toLowerCase().includes(text));
  });
}

export function computeStats(rows: Row[]): Stats {
  const s: Stats = { total: rows.length, untranslated: 0, needsReview: 0, approved: 0, error: 0, needsDecision: 0, declined: 0, provisional: 0, external: 0, undecided: 0, changed: 0, carried: 0, translated: 0 };
  for (const r of rows) {
    if (r.status === 'untranslated') s.untranslated++;
    else if (r.status === 'translated') s.translated++;
    else if (r.status === 'needs-review') s.needsReview++;
    else if (r.status === 'approved') s.approved++;
    else if (r.status === 'error') s.error++;
    else if (r.status === 'declined') s.declined++;
    if (r.needsDecision) s.needsDecision++;
    if (r.usesProvisional) s.provisional++;
    if (r.external) s.external++;
    if (r.needsDecision && r.decision !== 'translate' && r.decision !== 'skip') s.undecided++;
    if (r.previous) s.changed++;
    if (r.carried) s.carried++;
  }
  return s;
}

/** Per-file progress, in the order files first appear. */
export function computeScopes(rows: Row[]): Scope[] {
  const byFile = new Map<string, Scope>();
  for (const r of rows) {
    let s = byFile.get(r.file);
    if (!s) {
      s = { file: r.file, label: scopeLabel(r.file), total: 0, done: 0 };
      byFile.set(r.file, s);
    }
    s.total++;
    if (r.target !== null) s.done++;
  }
  return [...byFile.values()];
}

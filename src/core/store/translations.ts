// translations.json: the translation table, keyed by TextUnit.id. Keying by an id made from the source text
// (not by file and position) lets the same sentence share one translation and keeps translations through
// re-extraction and game updates. Only ProjectService writes it in the app; the CLI writes it directly.
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { TextUnit, TranslationEntry, TranslationStatus, UnitKind } from '../types.js';
import { readJsonFile, writeJsonFile } from '../util/json.js';

export const TRANSLATIONS_FILE = 'translations.json';

/** Source-keyed translation table: unit id -> entry. Stored at <projectDir>/translations.json. */
export class TranslationStore {
  private constructor(
    private readonly projectDir: string,
    private readonly table: Record<string, TranslationEntry>,
  ) {}

  /** Loads the table; a missing file gives an empty table. */
  static async load(projectDir: string): Promise<TranslationStore> {
    const file = path.join(projectDir, TRANSLATIONS_FILE);
    const table = existsSync(file) ? ((await readJsonFile(file)) as Record<string, TranslationEntry>) : {};
    // 'needs-review' used to be where every translation started. Entries nobody sent there on purpose
    // (no remark, not carried, not flagged) are plain translations now.
    for (const e of Object.values(table)) {
      if (e && e.status === 'needs-review' && !e.review && !e.carried && !e.flagged) e.status = 'translated';
    }
    return new TranslationStore(projectDir, table);
  }

  get(id: string): TranslationEntry {
    const e = this.table[id];
    return e ? { ...e } : { target: null, status: 'untranslated', updatedAt: '' };
  }

  /** A new translation. The older version's sentence (previous) and the last handled remark stay as references; a carried mark goes. */
  set(id: string, target: string, status: TranslationStatus = 'translated'): void {
    const previous = this.table[id]?.previous;
    const pastReview = this.table[id]?.pastReview;
    this.table[id] = {
      target, status, updatedAt: new Date().toISOString(),
      ...(previous ? { previous } : {}), ...(pastReview ? { pastReview } : {}), ...(status === 'needs-review' ? { flagged: true as const } : {}),
    };
  }

  /** Approving a carried translation means someone looked at it: the carried mark goes. */
  setStatus(id: string, status: TranslationStatus): void {
    const e = this.get(id);
    const next: TranslationEntry = { ...e, status, updatedAt: new Date().toISOString() };
    if (status === 'approved') delete next.carried;
    if (status === 'needs-review') next.flagged = true;
    else delete next.flagged;
    this.table[id] = next;
  }

  entries(): Record<string, TranslationEntry> {
    return { ...this.table };
  }

  /** Puts an entry back exactly as given (used by undo). An empty untranslated entry removes the record. */
  restore(id: string, entry: TranslationEntry): void {
    if (entry.target === null && entry.status === 'untranslated' && entry.updatedAt === '') delete this.table[id];
    else this.table[id] = { ...entry };
  }

  async save(): Promise<void> {
    await writeJsonFile(path.join(this.projectDir, TRANSLATIONS_FILE), this.table);
  }
}

export interface ExportItem { id: string; kind: UnitKind; speaker?: string; source: string }

/** Units with no translation yet. needsDecision units are left out unless includeNeedsDecision. */
export function exportUntranslated(
  units: TextUnit[],
  store: TranslationStore,
  opts: { includeNeedsDecision?: boolean } = {},
): ExportItem[] {
  const out: ExportItem[] = [];
  for (const u of units) {
    if (store.get(u.id).target !== null) continue;
    if (u.needsDecision && !opts.includeNeedsDecision) continue;
    const item: ExportItem = { id: u.id, kind: u.kind, source: u.source };
    if (u.speaker !== undefined) item.speaker = u.speaker;
    out.push(item);
  }
  return out;
}

/** Stores translations for known ids; ids not in units are returned instead of stored. */
export function importTranslations(
  units: TextUnit[],
  store: TranslationStore,
  items: { id: string; target: string }[],
): { applied: number; unknownIds: string[] } {
  const known = new Set(units.map((u) => u.id));
  let applied = 0;
  const unknownIds: string[] = [];
  for (const it of items) {
    if (!known.has(it.id)) {
      unknownIds.push(it.id);
      continue;
    }
    store.set(it.id, it.target);
    applied++;
  }
  return { applied, unknownIds };
}

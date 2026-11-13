import { EventEmitter } from 'node:events';
import {
  buildPatch,
  checkTranslation,
  createProject,
  extractAll,
  loadUnits,
  openProject,
  TranslationStore,
  type BuildContributor,
  type BuildResult,
  type Issue,
  type ProjectMeta,
  type TextUnit,
  type TranslationEntry,
  type ReviewNote,
  type TranslationStatus,
} from '../core/index.js';
import { loadGlossary, saveGlossary, termId } from '../core/glossary/store.js';
import { termsIn } from '../core/glossary/match.js';
import { planRename } from '../core/glossary/rename.js';
import type { CharacterCard, Glossary, ProjectRules, Term } from '../core/glossary/types.js';
import type { ChangeEvent, Origin } from '../shared/api.js';
import type { PxCheck } from '../core/check/format.js';
import { existsSync, readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { groupDecisions } from '../core/decisions/keys.js';
import { mergeSuggestions } from '../core/decisions/auto.js';
import { decisionFor, DECISIONS_FILE, saveDecisions } from '../core/decisions/store.js';
import type { Decision, DecisionGroup, Decisions, PluginMeta } from '../core/decisions/types.js';
import { pluginMetaFromDir } from '../core/extract/pluginMeta.js';
import { ensureOriginals, FILES_LIST } from '../core/project/originals.js';
import { originalDir } from '../core/project/project.js';
import { readFile, writeFile } from 'node:fs/promises';
import { confirmedDecisionFor } from '../core/decisions/store.js';
import type { KeepRule } from '../core/decisions/types.js';
import { buildPackage, planImport, type ImportPlan } from '../core/exchange/package.js';
import { rowDecisionOf, unitRowDecisions } from '../shared/rows.js';

const UNDO_LIMIT = 200;

interface UndoRecord { id: string; before: TranslationEntry; origin: Origin }

/** Reason stored for terms the model brought up while translating. */
export const NEW_TERM_REASON = '번역 중 새로 나옴';

export interface ProjectService {
  on(event: 'changed', listener: (e: ChangeEvent) => void): this;
  on(event: 'glossary-changed', listener: (g: Glossary) => void): this;
  off(event: 'changed', listener: (e: ChangeEvent) => void): this;
  off(event: 'glossary-changed', listener: (g: Glossary) => void): this;
  emit(event: 'changed', e: ChangeEvent): boolean;
  emit(event: 'glossary-changed', g: Glossary): boolean;
  on(event: 'decisions-changed', listener: (d: Decisions) => void): this;
  off(event: 'decisions-changed', listener: (d: Decisions) => void): this;
  emit(event: 'decisions-changed', d: Decisions): boolean;
}

/**
 * Sole owner of an open project. Every write goes through an internal queue,
 * runs one at a time, saves translations.json and then emits 'changed'.
 */
export class ProjectService extends EventEmitter {
  private readonly byId: Map<string, TextUnit>;
  private readonly history: UndoRecord[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    readonly projectDir: string,
    readonly meta: ProjectMeta,
    private readonly unitList: TextUnit[],
    private readonly store: TranslationStore,
    private gloss: Glossary,
  ) {
    super();
    this.byId = new Map(unitList.map((u) => [u.id, u]));
    this.loadDecisionData();
  }

  // ---- decisions (plan 3b) ----
  private dec: Decisions = {};
  private pluginMeta: Record<string, PluginMeta> = {};
  private gameFileNames = new Set<string>();

  /** Reads decisions.json, the plugins' header comments and the game file names (small files, read once). */
  private loadDecisionData(): void {
    const decFile = nodePath.join(this.projectDir, DECISIONS_FILE);
    try {
      const d = existsSync(decFile) ? JSON.parse(readFileSync(decFile, 'utf8').replace(/^﻿/, '')) : {};
      this.dec = d && typeof d === 'object' && !Array.isArray(d) ? d : {};
    } catch {
      this.dec = {};
    }
    this.refreshRowDecisions();
    const root = originalDir(this.projectDir, this.meta);
    this.pluginMeta = pluginMetaFromDir(root);
    try {
      const list = JSON.parse(readFileSync(nodePath.join(root, FILES_LIST), 'utf8')) as unknown;
      if (Array.isArray(list)) {
        for (const f of list) if (typeof f === 'string') this.gameFileNames.add(f.replace(/^.*\//, '').replace(/\.[^.]*$/, ''));
      }
    } catch {
      // no files.json: no file-name hints
    }
  }

  /** A copy of the project's decisions. */
  decisions(): Decisions {
    return structuredClone(this.dec);
  }

  /** Needs-decision units grouped by decision key, largest first. */
  decisionGroups(): DecisionGroup[] {
    return groupDecisions(this.unitList, this.dec, { fileNames: this.gameFileNames, meta: this.pluginMeta });
  }

  /** The decision that applies to a unit (its own one first), suggestions included. */
  decisionOf(id: string): Decision | null {
    const u = this.byId.get(id);
    return u ? decisionFor(u, this.dec) : null;
  }

  /** Text of a file in the original copy (for context around plugin JS strings), or null. */
  originalText(file: string): string | null {
    try {
      return readFileSync(nodePath.join(originalDir(this.projectDir, this.meta), ...file.split('/')), 'utf8');
    } catch {
      return null;
    }
  }

  /** Merges suggestions (confirmed decisions stay), saves decisions.json and announces the change. */
  addSuggestions(suggested: Decisions): Promise<void> {
    return this.writeDecisions(() => mergeSuggestions(this.dec, suggested), Object.keys(suggested));
  }

  /** Confirms a decision for a group key or 'unit:<id>' (by the user, or by Claude in the chat). */
  setDecision(key: string, d: Omit<Decision, 'status' | 'by'>, by: 'user' | 'claude'): Promise<void> {
    if (!this.knowsKey(key)) return Promise.reject(new Error(`없는 판단 키입니다: ${key}`));
    const decision: Decision = { translate: d.translate, keep: structuredClone(d.keep), status: 'confirmed', by };
    if (d.reason !== undefined) decision.reason = d.reason;
    return this.writeDecisions(() => ({ ...this.dec, [key]: decision }), [key]);
  }

  /** Turns suggestions into confirmed decisions (all of them, or those of the given keys). */
  confirmSuggestions(keys?: string[]): Promise<void> {
    const want = keys ? new Set(keys) : null;
    const touched = Object.keys(this.dec).filter((k) => this.dec[k].status === 'suggested' && (!want || want.has(k)));
    return this.writeDecisions(() => {
      const next = { ...this.dec };
      for (const k of touched) next[k] = { ...next[k], status: 'confirmed' };
      return next;
    }, touched);
  }

  /** Removes the decision of a key (its units need a decision again). */
  clearDecision(key: string): Promise<void> {
    return this.writeDecisions(() => {
      const { [key]: _gone, ...rest } = this.dec;
      return rest;
    }, [key]);
  }

  /** Whether key is a decision key of some unit, or 'unit:<id>' of a needs-decision unit. */
  knowsKey(key: string): boolean {
    if (key.startsWith('unit:')) return this.byId.get(key.slice(5))?.needsDecision === true;
    return this.unitList.some((u) => u.decisionKey === key);
  }

  /** The keep rule that applies when the unit is confirmed as translated (for the skeleton check), or undefined. */
  keepRuleOf(unit: TextUnit): KeepRule | undefined {
    if (!unit.needsDecision) return undefined;
    const d = confirmedDecisionFor(unit, this.dec);
    return d?.translate ? d.keep : undefined;
  }

  /** Writes the translated game title (System.json gameTitle) as approved. */
  setGameTitle(target: string): Promise<void> {
    const unit = this.unitList.find((u) => u.refs.some((r) => r.type === 'value' && r.file === 'data/System.json' && r.path.length === 1 && r.path[0] === 'gameTitle'));
    if (!unit) return Promise.reject(new Error('게임 제목 항목이 없습니다'));
    const text = target.trim();
    if (!text) return Promise.reject(new Error('제목을 입력하세요'));
    return this.mutate('user', () => {
      this.remember(unit.id, 'user');
      this.store.set(unit.id, text, 'approved');
      return { ids: [unit.id], result: undefined };
    });
  }

  /** Writes an exchange package for the given ids to filePath (UTF-8 JSON). */
  async exportPackage(ids: string[], filePath: string): Promise<void> {
    const pkg = buildPackage({ meta: this.meta, units: this.unitList, entryOf: (id) => this.store.get(id), glossary: this.gloss, decisions: this.dec, ids });
    await writeFile(filePath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  }

  /** Reads a translator's reply (a JSON array, or an object with an items array) and sorts it. Never applies anything. */
  async importPackage(filePath: string): Promise<ImportPlan> {
    let raw: unknown;
    try {
      raw = JSON.parse((await readFile(filePath, 'utf8')).replace(/^﻿/, ''));
    } catch {
      return { ok: [], conflicts: [], unknownIds: [], invalid: 1 };
    }
    const items = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : raw;
    return planImport(this.unitList, (id) => this.store.get(id), this.gloss, this.dec, items as { id: string; target: string }[]);
  }

  /** Writes an import plan's translations (origin 'external', marked external). Conflicts only when overwriteConflicts. */
  applyImport(plan: ImportPlan, overwriteConflicts: boolean): Promise<{ written: number }> {
    return this.mutate('external', () => {
      const todo = [...plan.ok.map((o) => ({ id: o.id, target: o.target })), ...(overwriteConflicts ? plan.conflicts.map((c) => ({ id: c.id, target: c.incoming })) : [])];
      const ids: string[] = [];
      for (const t of todo) {
        const unit = this.byId.get(t.id);
        if (!unit) continue;
        const status: TranslationStatus = this.check(unit, t.target).some((i) => i.severity === 'error') ? 'error' : 'needs-review';
        this.remember(t.id, 'external');
        this.store.restore(t.id, { target: t.target, status, updatedAt: new Date().toISOString(), external: true });
        ids.push(t.id);
      }
      return { ids, result: { written: ids.length } };
    });
  }

  /** Puts every needs-decision unit's decision state where toRow reads it. */
  private refreshRowDecisions(): void {
    for (const u of this.unitList) if (u.needsDecision) unitRowDecisions.set(u, rowDecisionOf(decisionFor(u, this.dec)));
  }

  /** Replaces the decisions, saves them, emits 'decisions-changed' and a change for the units of the touched keys. */
  private writeDecisions(next: () => Decisions, keys: string[]): Promise<void> {
    return this.enqueue(async () => {
      this.dec = next();
      this.refreshRowDecisions();
      await saveDecisions(this.projectDir, this.dec);
      this.emit('decisions-changed', this.decisions());
      const touched = new Set(keys);
      const ids = this.unitList
        .filter((u) => u.needsDecision && (touched.has(`unit:${u.id}`) || (u.decisionKey !== undefined && touched.has(u.decisionKey))))
        .map((u) => u.id);
      if (ids.length > 0) this.emit('changed', { ids, origin: 'user' });
    });
  }

  /** createProject + extractAll, then opens it. */
  static async create(gameDir: string, projectDir: string, name: string): Promise<ProjectService> {
    const meta = await createProject(gameDir, projectDir, name);
    const { units } = await extractAll(projectDir);
    const store = await TranslationStore.load(projectDir);
    return new ProjectService(projectDir, meta, units, store, await loadGlossary(projectDir));
  }

  static async open(projectDir: string): Promise<ProjectService> {
    const meta = await openProject(projectDir);
    await ensureOriginals(projectDir);
    const units = await loadUnits(projectDir);
    // Projects extracted before decision keys existed are extracted again from the original copy (ids do not change).
    if (units.some((u) => u.needsDecision && u.decisionKey === undefined)) units.splice(0, units.length, ...(await extractAll(projectDir)).units);
    const store = await TranslationStore.load(projectDir);
    return new ProjectService(projectDir, meta, units, store, await loadGlossary(projectDir));
  }

  units(): TextUnit[] {
    return this.unitList;
  }

  unit(id: string): TextUnit | undefined {
    return this.byId.get(id);
  }

  entry(id: string): TranslationEntry {
    return this.store.get(id);
  }

  /** A copy of the project's glossary. */
  glossary(): Glossary {
    return structuredClone(this.gloss);
  }

  /** Replaces the glossary, saves glossary.json and emits 'glossary-changed'. */
  setGlossary(g: Glossary): Promise<void> {
    return this.enqueue(async () => {
      this.gloss = structuredClone(g);
      await saveGlossary(this.projectDir, this.gloss);
      this.emit('glossary-changed', this.glossary());
    });
  }

  /** Whether the unit's source holds a term still going on its recommended candidate. */
  usesProvisional(id: string): boolean {
    const u = this.byId.get(id);
    if (!u) return false;
    const provisional = this.gloss.terms.filter((t) => t.status === 'provisional');
    return provisional.length > 0 && termsIn(u.source, provisional).length > 0;
  }

  /** Adds terms the model brought up as provisional, skipping sources already in the glossary. Returns the added terms. */
  async addTermCandidates(terms: { source: string; target: string }[]): Promise<Term[]> {
    const known = new Set(this.gloss.terms.map((t) => t.source));
    const added: Term[] = [];
    for (const n of terms) {
      const source = n.source.trim();
      const target = n.target.trim();
      if (!source || !target || known.has(source)) continue;
      known.add(source);
      added.push({ id: termId(source), source, target, category: 'term', status: 'provisional', candidates: [{ target, reason: NEW_TERM_REASON }] });
    }
    if (added.length > 0) await this.setGlossary({ ...this.gloss, terms: [...this.gloss.terms, ...added] });
    return added;
  }

  /** Adds a term, or replaces the one with the same source. The translations are not touched. */
  async upsertTerm(t: Omit<Term, 'id'>): Promise<Term> {
    const source = t.source.trim();
    if (!source) throw new Error('용어 원문을 입력하세요');
    const term: Term = { ...t, id: termId(source), source, target: t.target.trim(), candidates: t.candidates.map((c) => ({ ...c })) };
    const terms = this.gloss.terms.filter((x) => x.id !== term.id);
    const at = this.gloss.terms.findIndex((x) => x.id === term.id);
    terms.splice(at < 0 ? terms.length : at, 0, term);
    await this.setGlossary({ ...this.gloss, terms });
    return structuredClone(term);
  }

  async removeTerm(id: string): Promise<void> {
    if (!this.gloss.terms.some((t) => t.id === id)) return;
    await this.setGlossary({ ...this.gloss, terms: this.gloss.terms.filter((t) => t.id !== id) });
  }

  /**
   * Settles a term on target (status 'confirmed'). When the target changes, every translation using the
   * old one is rewritten with particles fixed: certain rewrites keep their status, uncertain ones go to
   * 'needs-review' and are listed in uncertain.
   */
  async chooseCandidate(id: string, target: string): Promise<{ changed: string[]; uncertain: string[] }> {
    const term = this.gloss.terms.find((t) => t.id === id);
    if (!term) throw new Error(`없는 용어입니다: ${id}`);
    const next = target.trim();
    if (!next) throw new Error('번역을 입력하세요');
    const plan = planRename(term, next, this.unitList, (uid) => this.store.get(uid));
    await this.setGlossary({ ...this.gloss, terms: this.gloss.terms.map((t) => (t.id === id ? { ...t, target: next, status: 'confirmed' } : t)) });
    if (plan.length === 0) return { changed: [], uncertain: [] };
    return this.mutate('user', () => {
      const changed: string[] = [];
      const uncertain: string[] = [];
      for (const p of plan) {
        const unit = this.require(p.id);
        const before = this.store.get(p.id);
        const hasError = this.check(unit, p.newTarget).some((i) => i.severity === 'error');
        const status: TranslationStatus = hasError ? 'error' : !p.certain ? 'needs-review' : before.status === 'error' ? 'needs-review' : before.status;
        this.remember(p.id, 'user');
        this.store.set(p.id, p.newTarget, status);
        changed.push(p.id);
        if (!p.certain) uncertain.push(p.id);
      }
      return { ids: changed, result: { changed, uncertain } };
    });
  }

  setCharacters(cards: CharacterCard[]): Promise<void> {
    return this.setGlossary({ ...this.gloss, characters: cards.map((c) => ({ ...c, id: c.id || termId(c.source) })) });
  }

  setStyleGuide(text: string): Promise<void> {
    return this.setGlossary({ ...this.gloss, styleGuide: text });
  }

  setRules(rules: Partial<ProjectRules>): Promise<void> {
    return this.setGlossary({ ...this.gloss, rules: { ...this.gloss.rules, ...rules } });
  }

  /** Marks the glossary as confirmed now (needed before the full translation). */
  confirmGlossary(): Promise<void> {
    return this.setGlossary({ ...this.gloss, confirmedAt: new Date().toISOString() });
  }

  /** Marks a unit the model would not translate. */
  setDeclined(id: string, reason: string, origin: Origin): Promise<void> {
    return this.mutate(origin, () => {
      this.require(id);
      this.remember(id, origin);
      this.store.restore(id, { target: null, status: 'declined', updatedAt: new Date().toISOString(), declinedReason: reason });
      return { ids: [id], result: undefined };
    });
  }

  /**
   * Puts a reviewer's remark on a translated unit (status back to 'needs-review'), or removes it (null).
   * The translation and its updatedAt are kept; reviewedAt is set.
   */
  setReview(id: string, review: ReviewNote | null, origin: Origin): Promise<void> {
    return this.mutate(origin, () => {
      this.require(id);
      const e = this.store.get(id);
      if (e.target === null) throw new Error('번역이 없는 항목입니다');
      this.remember(id, origin);
      const next: TranslationEntry = { ...e, reviewedAt: new Date().toISOString() };
      if (review) {
        next.review = { ...review };
        next.status = 'needs-review';
      } else delete next.review;
      this.store.restore(id, next);
      return { ids: [id], result: undefined };
    });
  }

  /** Writes the reviewer's suggestion as the translation (origin 'review') and removes the remark. */
  acceptReview(id: string): Promise<Issue[]> {
    return this.mutate('review', () => {
      const unit = this.require(id);
      const e = this.store.get(id);
      if (!e.review) throw new Error('검수 의견이 없습니다');
      const issues = this.check(unit, e.review.suggestion);
      const status: TranslationStatus = issues.some((i) => i.severity === 'error') ? 'error' : 'needs-review';
      this.remember(id, 'review');
      const now = new Date().toISOString();
      this.store.restore(id, { target: e.review.suggestion, status, updatedAt: now, reviewedAt: now });
      return { ids: [id], result: issues };
    });
  }

  /** Removes the reviewer's remark and keeps the translation. */
  rejectReview(id: string): Promise<void> {
    return this.mutate('user', () => {
      this.require(id);
      const e = this.store.get(id);
      if (!e.review) return { ids: [], result: undefined };
      this.remember(id, 'user');
      const { review: _dropped, ...rest } = e;
      this.store.restore(id, rest);
      return { ids: [id], result: undefined };
    });
  }

  /** Records that a review looked at these units (status and translation unchanged, not undoable). */
  markReviewed(ids: string[], origin: Origin): Promise<void> {
    return this.mutate(origin, () => {
      const now = new Date().toISOString();
      const done: string[] = [];
      for (const id of ids) {
        this.require(id);
        const e = this.store.get(id);
        if (e.target === null) continue;
        this.store.restore(id, { ...e, reviewedAt: now });
        done.push(id);
      }
      return { ids: done, result: undefined };
    });
  }

  private check(unit: TextUnit, target: string): Issue[] {
    const g = this.gloss;
    const px = this.pxChecker?.(unit);
    if (px) return checkTranslation(unit, target, g.rules, { terms: g.terms, maxLineWidthChars: g.rules.maxLineWidthChars, speakerPattern: g.rules.speakerPattern }, px);
    // A unit confirmed as translated with a keep rule also gets the skeleton check.
    const keep = this.keepRuleOf(unit);
    if (keep) return checkTranslation(unit, target, g.rules, { terms: g.terms, maxLineWidthChars: g.rules.maxLineWidthChars, speakerPattern: g.rules.speakerPattern }, keep);
    return checkTranslation(unit, target, g.rules, { terms: g.terms, maxLineWidthChars: g.rules.maxLineWidthChars, speakerPattern: g.rules.speakerPattern });
  }

  setTranslation(id: string, target: string, origin: Origin): Promise<Issue[]> {
    return this.mutate(origin, () => {
      const unit = this.require(id);
      const issues = this.check(unit, target);
      const status: TranslationStatus = issues.some((i) => i.severity === 'error') ? 'error' : 'needs-review';
      this.remember(id, origin);
      this.store.set(id, target, status);
      return { ids: [id], result: issues };
    });
  }

  setStatus(id: string, status: TranslationStatus, origin: Origin): Promise<void> {
    return this.mutate(origin, () => {
      this.require(id);
      this.remember(id, origin);
      this.store.setStatus(id, status);
      return { ids: [id], result: undefined };
    });
  }

  clearTranslation(id: string, origin: Origin): Promise<void> {
    return this.mutate(origin, () => {
      this.require(id);
      this.remember(id, origin);
      this.store.restore(id, { target: null, status: 'untranslated', updatedAt: new Date().toISOString() });
      return { ids: [id], result: undefined };
    });
  }

  /** Check result for the current target ([] when there is none). */
  issues(id: string): Issue[] {
    const unit = this.require(id);
    const target = this.store.get(id).target;
    return target === null ? [] : this.check(unit, target);
  }

  /** Reverts the most recent change (of that origin, if given). Returns the changed ids, or []. */
  undo(origin?: Origin): Promise<string[]> {
    return this.mutate(origin ?? 'user', () => {
      let i = this.history.length - 1;
      while (i >= 0 && origin !== undefined && this.history[i].origin !== origin) i--;
      if (i < 0) return { ids: [], result: [] };
      const [rec] = this.history.splice(i, 1);
      this.store.restore(rec.id, rec.before);
      return { ids: [rec.id], result: [rec.id] };
    });
  }

  /** Builds a patch zip. Status changes made by the build's check are saved and announced. */
  /** Parts of the app that add files to each patch (fonts, images, notes) register here. Append only. */
  readonly buildContributors: BuildContributor[] = [];

  build(): Promise<BuildResult> {
    return this.enqueue(async () => {
      const before = this.store.entries();
      try {
        return await buildPatch(this.projectDir, this.unitList, this.store, { contributors: this.buildContributors });
      } finally {
        const after = this.store.entries();
        const ids = Object.keys(after).filter((id) => before[id]?.status !== after[id].status);
        if (ids.length > 0) {
          await this.store.save();
          this.emit('changed', { ids, origin: 'user' });
        }
      }
    });
  }

  /** Waits for pending writes to finish. */
  async close(): Promise<void> {
    await this.queue.catch(() => undefined);
    this.removeAllListeners();
  }

  private require(id: string): TextUnit {
    const u = this.byId.get(id);
    if (!u) throw new Error(`없는 항목입니다: ${id}`);
    return u;
  }

  private remember(id: string, origin: Origin): void {
    this.history.push({ id, before: this.store.get(id), origin });
    if (this.history.length > UNDO_LIMIT) this.history.shift();
  }

  // ---- plan 4: pixel-width check ----
  private pxChecker: PxChecker | null = null;

  /**
   * Makes setTranslation and issues use the pixel-width check (null = back to the character count).
   * Announces every translated dialogue as changed, since its warnings may differ now.
   */
  setPxChecker(fn: PxChecker | null, announce = true): void {
    this.pxChecker = fn;
    const ids = this.unitList.filter((u) => u.kind === 'dialogue' && this.store.get(u.id).target !== null).map((u) => u.id);
    if (announce && ids.length > 0) this.emit('changed', { ids, origin: 'user' });
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private mutate<T>(origin: Origin, apply: () => { ids: string[]; result: T }): Promise<T> {
    return this.enqueue(async () => {
      const { ids, result } = apply();
      if (ids.length > 0) {
        await this.store.save();
        this.emit('changed', { ids, origin });
      }
      return result;
    });
  }

  // ---- plan 7: build notes ----
  /** Other parts of the app summarise what they put into each patch (key → lines) for the patch notes. Append only. */
  readonly buildSummaries: (() => Promise<Record<string, string[]>>)[] = [];
}

/** Gives the pixel-width check for a unit (only dialogue is checked), or undefined to use the character count. */
export type PxChecker = (unit: TextUnit) => PxCheck | undefined;

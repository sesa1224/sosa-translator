import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import nodePath from 'node:path';
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
import type { PathSeg } from '../core/types.js';
import { readJsonFile } from '../core/util/json.js';
import { loadGlossary, saveGlossary, termId } from '../core/glossary/store.js';
import { termsIn } from '../core/glossary/match.js';
import { planRename } from '../core/glossary/rename.js';
import type { CharacterCard, Glossary, ProjectRules, Term } from '../core/glossary/types.js';
import type { PxCheck } from '../core/check/format.js';
import { groupDecisions } from '../core/decisions/keys.js';
import { mergeSuggestions } from '../core/decisions/auto.js';
import { confirmedDecisionFor, decisionFor, DECISIONS_FILE, saveDecisions } from '../core/decisions/store.js';
import type { Decision, DecisionGroup, Decisions, KeepRule, PluginMeta } from '../core/decisions/types.js';
import { getAtPath } from '../core/extract/plugins.js';
import { pluginMetaFromDir } from '../core/extract/pluginMeta.js';
import { ensureOriginals, FILES_LIST } from '../core/project/originals.js';
import { originalDir } from '../core/project/project.js';
import { buildPackage, planImport, type ImportPlan } from '../core/exchange/package.js';
import type { EventCommand, Patch, PatchBody, PatchStatus } from '../core/patches/types.js';
import { listHash, sameContent } from '../core/patches/hash.js';
import { validateOps } from '../core/patches/listOps.js';
import { newPatchId, PATCHES_FILE, savePatches } from '../core/patches/store.js';
import {
  patchStatuses as corePatchStatuses, REASON_BAD_PLUGIN_NAME, REASON_CHANGED, REASON_NO_EVENT, REASON_NO_FILE, REASON_VALUE_CHANGED, validPluginName,
} from '../core/patches/apply.js';
import { loadNames } from '../core/events/names.js';
import { describeCommand } from '../core/events/describe.js';
import { listLabel } from '../core/events/browse.js';
import { importVersion as coreImportVersion, readUpdateSummary, rollbackVersion as coreRollbackVersion, versionsOf } from '../core/update/importVersion.js';
import type { UpdateSummary, VersionInfo } from '../core/update/types.js';
import type { ChangeEvent, Origin } from '../shared/api.js';
import { rowDecisionOf, unitRowDecisions } from '../shared/rows.js';
import { registerFontContributor } from './fontEmbed.js';

const UNDO_LIMIT = 200;

interface UndoRecord { id: string; before: TranslationEntry; origin: Origin }

/** Reason stored for terms the model brought up while translating. */
export const NEW_TERM_REASON = '번역 중 새로 나옴';

/** Events the service emits. The IPC layer turns them into push events for the screens. */
export interface ProjectService {
  on(event: 'changed', listener: (e: ChangeEvent) => void): this;
  on(event: 'glossary-changed', listener: (g: Glossary) => void): this;
  on(event: 'decisions-changed', listener: (d: Decisions) => void): this;
  on(event: 'patches-changed', listener: (p: Patch[]) => void): this;
  /** After a game update or a rollback replaced the project files. */
  on(event: 'reloaded', listener: () => void): this;
  off(event: 'changed', listener: (e: ChangeEvent) => void): this;
  off(event: 'glossary-changed', listener: (g: Glossary) => void): this;
  off(event: 'decisions-changed', listener: (d: Decisions) => void): this;
  off(event: 'patches-changed', listener: (p: Patch[]) => void): this;
  off(event: 'reloaded', listener: () => void): this;
  emit(event: 'changed', e: ChangeEvent): boolean;
  emit(event: 'glossary-changed', g: Glossary): boolean;
  emit(event: 'decisions-changed', d: Decisions): boolean;
  emit(event: 'patches-changed', p: Patch[]): boolean;
  emit(event: 'reloaded'): boolean;
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
    private store: TranslationStore,
    private gloss: Glossary,
  ) {
    super();
    this.byId = new Map(unitList.map((u) => [u.id, u]));
    this.loadDecisionData();
    registerFontContributor(this); // font and plugin files of patches go into every build
    // The patch notes list the fixes that went into each build.
    this.buildSummaries.push(async () => {
      const applied = new Set((await this.patchStatuses()).filter((x) => x.state === 'applied').map((x) => x.id));
      return { patches: this.patches().filter((p) => applied.has(p.id)).map((p) => p.title) };
    });
  }

  // ---- decisions ----
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
      const buildsBefore = await numberedBuildFolders(this.projectDir);
      try {
        return await buildPatch(this.projectDir, this.unitList, this.store, { contributors: this.buildContributors });
      } catch (e) {
        // A contributor may have written into builds/NNN before the build failed. A folder without a manifest left
        // behind would take the number, so the next build would skip it: remove the ones this build made.
        for (const n of await numberedBuildFolders(this.projectDir)) {
          if (buildsBefore.has(n)) continue;
          const dir = nodePath.join(this.projectDir, 'builds', n);
          if (!existsSync(nodePath.join(dir, 'manifest.json'))) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
        }
        throw e;
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

  // ---- pixel-width check ----
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

  // ---- patches (bug fixes and additions recorded as changes against the original) ----
  private patchCache: Patch[] | null = null;

  /** The patch list, read from patches.json the first time. */
  private patchList(): Patch[] {
    if (this.patchCache === null) {
      try {
        const file = nodePath.join(this.projectDir, PATCHES_FILE);
        const raw = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')) as unknown) : [];
        this.patchCache = Array.isArray(raw) ? (raw as Patch[]) : [];
      } catch {
        this.patchCache = [];
      }
    }
    return this.patchCache;
  }

  /** A copy of the project's patches. */
  patches(): Patch[] {
    return structuredClone(this.patchList());
  }

  /** Whether each patch is applied, off, or in conflict with the original copy now. */
  patchStatuses(): Promise<PatchStatus[]> {
    return corePatchStatuses(this.projectDir, this.patchList());
  }

  /** The original command list a patch body points at, or null. */
  private async originalList(file: string, listPath: PathSeg[]): Promise<EventCommand[] | null> {
    try {
      const root = await readJsonFile(nodePath.join(originalDir(this.projectDir, this.meta), ...file.split('/')));
      const list = getAtPath(root, listPath);
      return Array.isArray(list) ? (list as EventCommand[]) : null;
    } catch {
      return null;
    }
  }

  /** Checks a body against the original copy; fills an empty baseHash (event) or a missing baseValue (json). */
  private async checkedBody(body: PatchBody): Promise<PatchBody> {
    const b = structuredClone(body);
    if (b.kind === 'event') {
      const list = await this.originalList(b.file, b.listPath);
      if (!list) throw new Error(REASON_NO_EVENT);
      const hash = listHash(list);
      if (!b.baseHash) b.baseHash = hash;
      else if (b.baseHash !== hash) throw new Error(REASON_CHANGED);
      const problem = validateOps(list, b.ops);
      if (problem) throw new Error(problem);
    } else if (b.kind === 'json') {
      let root: unknown;
      try {
        root = await readJsonFile(nodePath.join(originalDir(this.projectDir, this.meta), ...b.file.split('/')));
      } catch {
        throw new Error(REASON_NO_FILE);
      }
      const now = getAtPath(root, b.path);
      if (b.baseValue === undefined) b.baseValue = structuredClone(now);
      else if (!sameContent(now, b.baseValue)) throw new Error(REASON_VALUE_CHANGED);
    } else if (b.kind === 'plugin') {
      if (!validPluginName(b.name)) throw new Error(REASON_BAD_PLUGIN_NAME);
    }
    return b;
  }

  /** Another enabled event patch on the same command list (one per list keeps the ops readable). */
  private sameListPatch(body: PatchBody, exceptId?: string): Patch | undefined {
    if (body.kind !== 'event') return undefined;
    const key = JSON.stringify([body.file, body.listPath]);
    return this.patchList().find((p) => p.id !== exceptId && p.enabled && p.body.kind === 'event' && JSON.stringify([p.body.file, p.body.listPath]) === key);
  }

  private async savePatchList(next: Patch[]): Promise<void> {
    this.patchCache = next;
    await savePatches(this.projectDir, next);
    this.emit('patches-changed', this.patches());
  }

  /** Records a new patch after checking it against the original copy. */
  addPatch(p: { title: string; note?: string; originalBug?: boolean; body: PatchBody }, by: 'user' | 'claude'): Promise<Patch> {
    return this.enqueue(async () => {
      const body = await this.checkedBody(p.body);
      if (this.sameListPatch(body)) throw new Error('이 이벤트에는 이미 수정이 있습니다. 그 수정을 고치세요');
      const title = String(p.title ?? '').trim() || '이름 없는 수정';
      const patch: Patch = {
        id: newPatchId(), title, note: p.note ?? '', enabled: true, originalBug: p.originalBug === true,
        createdBy: by, createdAt: new Date().toISOString(), body,
      };
      await this.savePatchList([...this.patchList(), patch]);
      return structuredClone(patch);
    });
  }

  /** Changes a patch's title, note, switches or body (a new body is checked like a new patch). */
  updatePatch(id: string, change: Partial<Pick<Patch, 'title' | 'note' | 'enabled' | 'originalBug'>> & { body?: PatchBody }): Promise<Patch> {
    return this.enqueue(async () => {
      const list = this.patchList();
      const at = list.findIndex((p) => p.id === id);
      if (at < 0) throw new Error(`없는 수정입니다: ${id}`);
      const next: Patch = { ...structuredClone(list[at]) };
      if (change.title !== undefined) next.title = String(change.title).trim() || next.title;
      if (change.note !== undefined) next.note = String(change.note);
      if (change.enabled !== undefined) next.enabled = change.enabled === true;
      if (change.originalBug !== undefined) next.originalBug = change.originalBug === true;
      if (change.body !== undefined) next.body = await this.checkedBody(change.body);
      if (next.enabled && this.sameListPatch(next.body, id)) throw new Error('이 이벤트에는 이미 수정이 있습니다. 그 수정을 고치세요');
      await this.savePatchList(list.map((p, i) => (i === at ? next : p)));
      return structuredClone(next);
    });
  }

  removePatch(id: string): Promise<void> {
    return this.enqueue(async () => {
      const list = this.patchList();
      if (!list.some((p) => p.id === id)) return;
      await this.savePatchList(list.filter((p) => p.id !== id));
    });
  }

  /** Keeps at most one font patch: the given font (null removes it). */
  setGameFontPatch(fontPath: string | null, subset: boolean): Promise<void> {
    return this.enqueue(async () => {
      const rest = this.patchList().filter((p) => p.body.kind !== 'font');
      if (fontPath === null) {
        if (rest.length !== this.patchList().length) await this.savePatchList(rest);
        return;
      }
      const old = this.patchList().find((p) => p.body.kind === 'font');
      const patch: Patch = {
        id: old?.id ?? newPatchId(), title: `게임 폰트: ${nodePath.basename(fontPath)}`, note: old?.note ?? '', enabled: true,
        originalBug: false, createdBy: 'user', createdAt: old?.createdAt ?? new Date().toISOString(), body: { kind: 'font', fontPath, subset: subset === true },
      };
      await this.savePatchList([...rest, patch]);
    });
  }

  /** The patches marked as bugs of the original game, as Markdown for the game's creator. */
  async creatorReport(): Promise<string> {
    const names = await loadNames(this.projectDir);
    const bugs = this.patchList().filter((p) => p.originalBug);
    const lines = [`# ${this.meta.name} 원본 버그 수정 목록`, ''];
    if (bugs.length === 0) lines.push('원본 버그로 표시된 수정이 없습니다.');
    for (const [i, p] of bugs.entries()) {
      lines.push(`## ${i + 1}. ${p.title}`, '');
      const b = p.body;
      if (b.kind === 'event') {
        lines.push(`- 위치: ${listLabel(b.file, b.listPath)} (${b.file})`);
        lines.push(`- 무엇을 왜: ${p.note.trim() || '(설명 없음)'}`, '- 바꾼 내용:');
        const original = (await this.originalList(b.file, b.listPath)) ?? [];
        const said = (c: EventCommand | undefined) => (c ? describeCommand(c, names) : '(없는 줄)');
        for (const op of b.ops) {
          if (op.op === 'insert') {
            lines.push(`  - ${op.after < 0 ? '맨 앞에' : `${op.after}번 줄 뒤에`} 끼워 넣음`);
            for (const c of op.commands) lines.push(`    + ${describeCommand(c, names)}`);
          } else if (op.op === 'delete') {
            lines.push(`  - ${op.at}번 줄 지움`, `    − ${said(original[op.at])}`);
          } else {
            lines.push(`  - ${op.at}번 줄 바꿈`, `    − ${said(original[op.at])}`);
            for (const c of op.commands) lines.push(`    + ${describeCommand(c, names)}`);
          }
        }
      } else if (b.kind === 'json') {
        const where = b.path.map((s) => (typeof s === 'object' ? s.key : s)).join('.');
        lines.push(`- 위치: ${b.file} · ${where}`, `- 무엇을 왜: ${p.note.trim() || '(설명 없음)'}`, `- 바꾼 내용: ${JSON.stringify(b.baseValue)} → ${JSON.stringify(b.value)}`);
      } else if (b.kind === 'plugin') {
        lines.push(`- 위치: js/plugins/${b.name}.js (새 플러그인)`, `- 무엇을 왜: ${p.note.trim() || b.description || '(설명 없음)'}`);
      } else {
        lines.push(`- 게임 폰트: ${nodePath.basename(b.fontPath)}`, `- 무엇을 왜: ${p.note.trim() || '(설명 없음)'}`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  // ---- game updates ----
  private busyCheck: () => boolean = () => false;

  /** Tells the service how to see that a job is running (the IPC layer owns the jobs). */
  setBusyCheck(fn: () => boolean): void {
    this.busyCheck = fn;
  }

  /** The project's versions, oldest first (label and folder filled in for older projects). */
  versions(): VersionInfo[] {
    return versionsOf(this.meta);
  }

  /** The summary of the update that brought the current version, or null. */
  updateSummary(): Promise<UpdateSummary | null> {
    return readUpdateSummary(this.projectDir);
  }

  /** Takes a new version of the game, reads everything again and emits 'reloaded'. Refused while a job runs. */
  importVersion(gameDir: string, label: string): Promise<UpdateSummary> {
    if (this.busyCheck()) return Promise.reject(new Error(UPDATE_BUSY));
    return this.enqueue(async () => {
      const summary = await coreImportVersion(this.projectDir, gameDir, String(label ?? '').trim() || 'v?');
      await this.reloadFromDisk();
      this.emit('reloaded');
      return summary;
    });
  }

  /** Undoes the latest update, reads everything again and emits 'reloaded'. Refused while a job runs. */
  rollbackVersion(): Promise<{ restored: string }> {
    if (this.busyCheck()) return Promise.reject(new Error(UPDATE_BUSY));
    return this.enqueue(async () => {
      const r = await coreRollbackVersion(this.projectDir);
      await this.reloadFromDisk();
      this.emit('reloaded');
      return r;
    });
  }

  /** Reads the project files again after an update replaced them. Undo records point at the old units and are dropped. */
  private async reloadFromDisk(): Promise<void> {
    const meta = await openProject(this.projectDir);
    const units = await loadUnits(this.projectDir);
    const store = await TranslationStore.load(this.projectDir);
    const gloss = await loadGlossary(this.projectDir);
    // A new object, not an in-place change: snapshots handed out earlier keep the meta they were made with.
    (this as { meta: ProjectMeta }).meta = meta;
    this.unitList.splice(0, this.unitList.length, ...units);
    this.byId.clear();
    for (const u of units) this.byId.set(u.id, u);
    this.store = store;
    this.gloss = gloss;
    this.history.length = 0;
    this.gameFileNames = new Set();
    this.loadDecisionData();
    this.patchCache = null;
  }

  // ---- build notes ----
  /** Other parts of the app summarise what they put into each patch (key → lines) for the patch notes. Append only. */
  readonly buildSummaries: (() => Promise<Record<string, string[]>>)[] = [];
}

/** Gives the pixel-width check for a unit (only dialogue is checked), or undefined to use the character count. */
export type PxChecker = (unit: TextUnit) => PxCheck | undefined;

/** Same text as the IPC layer's busy error. */
const UPDATE_BUSY = '다른 작업이 진행 중입니다';

/** Names of the numbered folders under builds/. */
async function numberedBuildFolders(projectDir: string): Promise<Set<string>> {
  try {
    return new Set((await readdir(nodePath.join(projectDir, 'builds'))).filter((n) => /^\d+$/.test(n)));
  } catch {
    return new Set();
  }
}

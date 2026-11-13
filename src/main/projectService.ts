import { EventEmitter } from 'node:events';
import {
  buildPatch,
  checkTranslation,
  createProject,
  extractAll,
  loadUnits,
  openProject,
  TranslationStore,
  type BuildResult,
  type Issue,
  type ProjectMeta,
  type TextUnit,
  type TranslationEntry,
  type TranslationStatus,
} from '../core/index.js';
import type { ChangeEvent, Origin } from '../shared/api.js';

const UNDO_LIMIT = 200;

interface UndoRecord { id: string; before: TranslationEntry; origin: Origin }

export interface ProjectService {
  on(event: 'changed', listener: (e: ChangeEvent) => void): this;
  off(event: 'changed', listener: (e: ChangeEvent) => void): this;
  emit(event: 'changed', e: ChangeEvent): boolean;
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
  ) {
    super();
    this.byId = new Map(unitList.map((u) => [u.id, u]));
  }

  /** createProject + extractAll, then opens it. */
  static async create(gameDir: string, projectDir: string, name: string): Promise<ProjectService> {
    const meta = await createProject(gameDir, projectDir, name);
    const { units } = await extractAll(projectDir);
    const store = await TranslationStore.load(projectDir);
    return new ProjectService(projectDir, meta, units, store);
  }

  static async open(projectDir: string): Promise<ProjectService> {
    const meta = await openProject(projectDir);
    const units = await loadUnits(projectDir);
    const store = await TranslationStore.load(projectDir);
    return new ProjectService(projectDir, meta, units, store);
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

  setTranslation(id: string, target: string, origin: Origin): Promise<Issue[]> {
    return this.mutate(origin, () => {
      const unit = this.require(id);
      const issues = checkTranslation(unit, target);
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
    return target === null ? [] : checkTranslation(unit, target);
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
  build(): Promise<BuildResult> {
    return this.enqueue(async () => {
      const before = this.store.entries();
      try {
        return await buildPatch(this.projectDir, this.unitList, this.store);
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
}

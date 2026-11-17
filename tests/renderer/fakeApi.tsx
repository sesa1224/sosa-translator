import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../src/renderer/App';
import { useApp } from '../../src/renderer/state';
import {
  DEFAULT_MODELS, DEFAULT_STAGE_MODELS, type Api, type ChooseResult, type GameDirCheck, type Glossary, type ReviewPlan, type SpeakerDetection, type AppSettings, type BuildResult, type ProjectMeta, type PushChannel, type Row, type Snapshot, type UnitDetail,
} from '../../src/shared/api';
import type { FontInfo, FontList, Layout, OverflowCount, PreviewState, RewrapReport, WindowMetrics } from '../../src/shared/api';
import type { SceneInfo } from '../../src/shared/api';
import { computeScopes, computeStats } from '../../src/shared/rows';
import type { ActionLine, ActionSummary, CancelResult, DecisionGroup, ImportPlan } from '../../src/shared/api';
import type { BuildRecord, ImageEntry, ImageRecipe, Region, RegionOverflow } from '../../src/shared/api';
import type { EventDetail, EventFileInfo, EventListInfo, EventRef, NewPatch, Patch, PatchChange, PatchStatus, UsageTarget } from '../../src/shared/api';
import type { SimilarTranslation } from '../../src/shared/api';
import type { ClaudeStatus, FontEmbedInfo, UpdateInspect, UpdateSummary, VersionInfo } from '../../src/shared/api';

export const settings: AppSettings = { theme: 'dark', models: DEFAULT_MODELS, chatModel: 'claude-fable-5-2', claudePath: null, projectsDir: 'C:/projects', stageModels: { ...DEFAULT_STAGE_MODELS }, reviewSkipPassed: true };

const meta: ProjectMeta = {
  name: '약초원', engine: 'MZ', gameDir: 'C:/game', contentPrefix: '', sourceLang: 'ja', targetLang: 'ko',
  versions: [{ id: 'v1', importedAt: '2026-11-13T00:00:00.000Z' }], current: 'v1',
};

function row(p: Partial<Row> & { id: string; source: string }): Row {
  return { kind: 'dialogue', target: null, status: 'untranslated', needsDecision: false, file: 'data/Map001.json', location: '맵1 · 이벤트1', refCount: 1, usesProvisional: false, ...p };
}

export const itemId = 'r-item-name';
export const errorRowId = 'r-item-desc';
export const row1 = row({ id: 'r-actor', kind: 'db', source: 'リナ', file: 'data/Actors.json', location: 'Actors · 1' });
export const row2 = row({ id: 'r-map-1', speaker: 'リナ', source: 'あれ？\\N[1]じゃない！\nこんな夜に来るなんて' });
export const baseRows: Row[] = [
  row1,
  row({ id: itemId, kind: 'db', source: '月光草', file: 'data/Items.json', location: 'Items · 1' }),
  row({ id: errorRowId, kind: 'db', source: '夜に光る草。\\C[2]貴重\\C[0]だ', target: '밤에 빛나는 풀', status: 'error', file: 'data/Items.json', location: 'Items · 1' }),
  row2,
  row({ id: 'r-choice-1', kind: 'choice', source: 'いいよ' }),
  row({ id: 'r-choice-2', kind: 'choice', source: 'また今度' }),
  row({ id: 'r-map-2', speaker: 'リナ', source: 'やった！' }),
  row({ id: 'r-cmd', kind: 'plugin-command', source: 'ShowRecord 記録', needsDecision: true }),
];
export const stats = computeStats(baseRows);
export const scopes = computeScopes(baseRows);

export function manyRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => row({ id: `many-${i}`, source: `台詞${i}`, location: `맵1 · 이벤트${i}` }));
}

export const defaultFakeGlossary = (): Glossary => ({
  terms: [], characters: [], styleGuide: '## 기본 태도\n- 자연스럽게', confirmedAt: null,
  rules: { controlCodes: true, noLeftoverJapanese: true, sameLineCount: false, maxLines: 4, maxLineWidthChars: null, speakerPattern: null, halfWidth: true, halfWidthBrackets: true, notationCheck: true, unmask: true, autoRewrap: true },
});

export type FakeApi = Api & {
  calls: unknown[][]; emit(channel: PushChannel, payload: unknown): void; opened: boolean; rows: Row[];
  inspect(dir: string): GameDirCheck;
  glossaryValue: Glossary; chooseResult: ChooseResult; speakerDetection: SpeakerDetection | null; reviewPlanValue: ReviewPlan;
  groupsValue: DecisionGroup[]; importPlanValue: ImportPlan | null; exportPath: string | null;
  historyValue: ActionSummary[]; historyResult: CancelResult;
  /** Changed lines per action id; history.detail pages them like the main process (at most 100). */
  historyLines: Record<string, ActionLine[]>;
  /** What similar.find answers, per line id (none when missing). */
  similarValue: Record<string, SimilarTranslation[]>;
};

export function fakeApi(o: { opened?: boolean; rows?: Row[]; settings?: Partial<AppSettings>; glossary?: Partial<Glossary> } = {}): FakeApi {
  let current: AppSettings = { ...settings, ...o.settings };
  const listeners = new Map<string, Set<(p: any) => void>>();
  const calls: unknown[][] = [];
  const rec = <T,>(name: string, result: (...a: any[]) => T) => async (...a: any[]): Promise<T> => { calls.push([name, ...a]); return result(...a); };
  const snapshot = (): Snapshot | null => fake.opened
    ? { meta, gameTitle: '霧の薬草園', rows: fake.rows, stats: computeStats(fake.rows), scopes: computeScopes(fake.rows) }
    : null;
  const build: BuildResult = { number: 1, zipPath: 'C:/projects/약초원/builds/001/약초원_patch_001.zip', files: [{ path: 'a', sha1: '' }, { path: 'b', sha1: '' }, { path: 'c', sha1: '' }], skippedErrors: 1, warnings: [] };
  const detail = (id: string): UnitDetail => {
    const r = fake.rows.find((x) => x.id === id)!;
    const issues = r.status === 'error'
      ? [{ rule: 'control-codes' as const, severity: 'error' as const, message: '제어문자가 원문과 다릅니다 (빠짐: \\C[2] \\C[0])' }]
      : [];
    return { row: r, issues, refs: [r.location] };
  };
  const ev = (): EventsFake => evState;
  const fake: FakeApi = {
    calls,
    opened: o.opened ?? false,
    rows: o.rows ?? baseRows,
    glossaryValue: { ...defaultFakeGlossary(), ...o.glossary },
    chooseResult: { changed: [], uncertain: [] },
    speakerDetection: null,
    reviewPlanValue: { items: 0, estimatedInputTokens: 0, model: 'claude-fable-5-2', skippedPassed: 0 },
    groupsValue: [],
    importPlanValue: null,
    exportPath: 'C:/out/약초원.json',
    historyValue: [],
    historyResult: { restored: 0, skipped: 0 },
    historyLines: {},
    similarValue: {},
    inspect: (dir: string): GameDirCheck => ({ ok: true, dir, engine: 'MZ', title: '霧の薬草園', suggestedName: '霧の薬草園' }),
    emit(channel, payload) {
      act(() => { for (const cb of listeners.get(channel) ?? []) cb(payload); });
    },
    settings: { get: rec('settings.get', () => current), set: rec('settings.set', (p) => (current = { ...current, ...p })) },
    project: {
      list: rec('project.list', () => []),
      pickGameDir: rec('project.pickGameDir', () => 'C:/game'),
      inspectGameDir: rec('project.inspectGameDir', (dir: string) => fake.inspect(dir)),
      unpackGame: rec('project.unpackGame', (exe: string) => `C:/projects/_풀린 게임/${exe.split('/').slice(-2, -1)[0]}`),
      pathForDrop: (file: File) => { calls.push(['project.pathForDrop', file.name]); return (file as File & { path?: string }).path ?? `C:/dropped/${file.name}`; },
      create: rec('project.create', () => { fake.opened = true; }),
      open: rec('project.open', () => { fake.opened = true; }),
      close: rec('project.close', () => { fake.opened = false; }),
      snapshot: rec('project.snapshot', snapshot),
      undo: rec('project.undo', () => []),
      build: rec('project.build', () => build),
      setGameTitle: rec('project.setGameTitle', () => undefined),
      rewrapPlan: rec('project.rewrapPlan', () => pv.rewrapPlan),
      rewrap: rec('project.rewrap', () => pv.rewrapResult),
    },
    unit: {
      get: rec('unit.get', detail),
      setTranslation: rec('unit.setTranslation', () => []),
      setStatus: rec('unit.setStatus', () => undefined),
      clear: rec('unit.clear', () => undefined),
      acceptReview: rec('unit.acceptReview', () => []),
      rejectReview: rec('unit.rejectReview', () => undefined),
      switchPastReview: rec('unit.switchPastReview', () => []),
      acceptReviews: rec('unit.acceptReviews', (ids: string[]) => ids.length),
      rejectReviews: rec('unit.rejectReviews', (ids: string[]) => ids.length),
    },
    similar: {
      find: rec('similar.find', (id: string) => fake.similarValue[id] ?? []),
    },
    glossary: {
      get: rec('glossary.get', () => fake.glossaryValue),
      upsertTerm: rec('glossary.upsertTerm', (t) => ({ id: 'new', ...t })),
      removeTerm: rec('glossary.removeTerm', () => undefined),
      choose: rec('glossary.choose', () => fake.chooseResult),
      setCharacters: rec('glossary.setCharacters', () => undefined),
      setStyleGuide: rec('glossary.setStyleGuide', () => undefined),
      setRules: rec('glossary.setRules', () => undefined),
      confirm: rec('glossary.confirm', () => undefined),
      detectSpeakerPattern: rec('glossary.detectSpeakerPattern', () => fake.speakerDetection),
      defaultStyleGuide: rec('glossary.defaultStyleGuide', () => '기본 지침'),
      promptText: rec('glossary.promptText', (kind) => `${kind} 머리말\n<번역 지침>\n${fake.glossaryValue.styleGuide}\n</번역 지침>`),
      setPromptText: rec('glossary.setPromptText', () => undefined),
    },
    job: {
      draft: rec('job.draft', () => undefined),
      draftPlan: rec('job.draftPlan', (mode: string) => ({ chunks: mode === 'sample' ? 0 : 3, chars: 48000, estimatedInputTokens: 62000, model: 'claude-fable-5-2', readModel: 'claude-fable-5-2' })),
      translate: rec('job.translate', () => undefined),
      reviewPlan: rec('job.reviewPlan', () => fake.reviewPlanValue),
      review: rec('job.review', () => undefined),
      pause: rec('job.pause', () => undefined),
      resume: rec('job.resume', () => undefined),
      stop: rec('job.stop', () => undefined),
      current: rec('job.current', () => null),
      decide: rec('job.decide', () => undefined),
    },
    chat: {
      send: rec('chat.send', () => undefined),
      stop: rec('chat.stop', () => undefined),
      reset: rec('chat.reset', () => undefined),
      setModel: rec('chat.setModel', () => undefined),
      undo: rec('chat.undo', () => []),
    },
    app: { claudePath: rec('app.claudePath', () => 'C:/claude.exe'), showItemInFolder: rec('app.showItemInFolder', () => undefined), claudeStatus: rec('app.claudeStatus', () => upState.claude) },
    decisions: {
      groups: rec('decisions.groups', () => fake.groupsValue),
      set: rec('decisions.set', () => undefined),
      confirm: rec('decisions.confirm', () => undefined),
      clear: rec('decisions.clear', () => undefined),
    },
    exchange: {
      export: rec('exchange.export', () => fake.exportPath),
      planImport: rec('exchange.planImport', () => fake.importPlanValue),
      applyImport: rec('exchange.applyImport', () => ({ written: fake.importPlanValue?.ok.length ?? 0 })),
    },
    on(channel, cb) {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel)!.add(cb as any);
      return () => { listeners.get(channel)!.delete(cb as any); };
    },
    preview: {
      get: rec('preview.get', () => pv.state),
      layout: rec('preview.layout', (id: string, text?: string) => pv.layout(id, text)),
      setFont: rec('preview.setFont', (p: string | null) => { pv.state = { ...pv.state, settings: { ...pv.state.settings, fontPath: p } }; }),
      setOverrides: rec('preview.setOverrides', () => undefined),
      countOverflow: rec('preview.countOverflow', (p?: string | null) => pv.overflow(p)),
      windowSkin: rec('preview.windowSkin', () => null),
      setWindow: rec('preview.setWindow', () => undefined),
    },
    fonts: {
      list: rec('fonts.list', () => pv.fontList),
      bytes: rec('fonts.bytes', () => new Uint8Array([0, 1, 0, 0])),
      pickFile: rec('fonts.pickFile', () => pv.picked),
    },
    story: {
      scenes: rec('story.scenes', (file: string) => pv.scenes[file] ?? []),
    },
    // events, patches, game
    events: {
      files: rec('events.files', () => ev().files),
      list: rec('events.list', (file: string) => ev().lists[file] ?? []),
      read: rec('events.read', (file: string, listPath: unknown[]) => ev().read(file, listPath)),
      usage: rec('events.usage', (target: UsageTarget) => ev().usage(target)),
    },
    patches: {
      list: rec('patches.list', () => ({ patches: ev().patches, statuses: ev().statuses })),
      add: rec('patches.add', (p: NewPatch) => ({ id: 'new-patch', note: '', enabled: true, originalBug: false, createdBy: 'user' as const, createdAt: '', ...p })),
      update: rec('patches.update', (id: string, p: PatchChange) => ({ ...ev().patches.find((x) => x.id === id)!, ...p })),
      remove: rec('patches.remove', () => undefined),
      setGameFont: rec('patches.setGameFont', (fontPath: string | null, subset: boolean) => {
        const rest = ev().patches.filter((x) => x.body.kind !== 'font');
        ev().patches = fontPath ? [...rest, { id: 'font', title: '게임 폰트', note: '', enabled: true, originalBug: false, createdBy: 'user', createdAt: '', body: { kind: 'font', fontPath, subset } }] : rest;
      }),
      creatorReport: rec('patches.creatorReport', () => ev().report),
      lastFontEmbed: rec('patches.lastFontEmbed', () => upState.fontEmbed),
      setJosa: rec('patches.setJosa', (enabled: boolean) => {
        const rest = ev().patches.filter((x) => x.body.kind !== 'josa');
        ev().patches = enabled ? [...rest, { id: 'josa', title: '조사 자동 맞춤', note: '', enabled: true, originalBug: false, createdBy: 'user', createdAt: '', body: { kind: 'josa' } }] : rest;
      }),
      josaConflicts: rec('patches.josaConflicts', () => ev().josaConflicts),
    },
    game: {
      run: rec('game.run', () => { if (ev().runError) throw new Error(ev().runError!); }),
      stop: rec('game.stop', () => undefined),
    },
    // pictures and build history
    images: {
      list: rec('images.list', () => im.entries),
      recipe: rec('images.recipe', (file: string) => im.recipes[file] ?? null),
      thumb: rec('images.thumb', () => new Uint8Array([1])),
      full: rec('images.full', () => new Uint8Array([2])),
      setRecipe: rec('images.setRecipe', (file: string, regions: (Partial<Region> & { rect: Region['rect'] })[]) => {
        const r: ImageRecipe = { file, baseHash: 'h', status: im.recipes[file]?.status ?? 'todo', regions: regions.map((x, i) => ({ ...defaultRegion(), id: `r${i}`, ...x })) };
        im.recipes[file] = r;
        return r;
      }),
      setStatus: rec('images.setStatus', () => undefined),
      pickManual: rec('images.pickManual', () => true),
      clearManual: rec('images.clearManual', () => undefined),
      acceptBase: rec('images.acceptBase', () => undefined),
      setDefaultFont: rec('images.setDefaultFont', (p: string | null) => { im.defaultFont = p; }),
      rerenderAll: rec('images.rerenderAll', () => undefined),
      defaultFont: rec('images.defaultFont', () => im.defaultFont),
      overflow: rec('images.overflow', (file: string) => im.overflow[file] ?? {}),
      failure: rec('images.failure', (file: string) => im.failure[file] ?? null),
      folders: rec('images.folders', () => ({ folders: im.folders, defaults: ['img/pictures', 'img/titles1', 'img/titles2', 'img/system', 'img/parallaxes'] })),
      setFolders: rec('images.setFolders', (f: string[] | null) => { im.folders = f ?? ['img/pictures', 'img/titles1', 'img/titles2', 'img/system', 'img/parallaxes']; }),
      exportOriginals: rec('images.exportOriginals', (files: string[]) => (im.exportDir === null ? null : { dir: im.exportDir, written: files.length - im.exportFailed, failed: im.exportFailed })),
    },
    builds: {
      list: rec('builds.list', () => im.builds),
      setNotes: rec('builds.setNotes', () => undefined),
      polishNotes: rec('builds.polishNotes', () => undefined),
      openFolder: rec('builds.openFolder', () => undefined),
    },
    update: {
      inspect: rec('update.inspect', (dir: string) => upState.inspect(dir)),
      pickGameDir: rec('update.pickGameDir', () => upState.picked),
      import: rec('update.import', () => {
        if (upState.importError) throw new Error(upState.importError);
        return upState.summary!;
      }),
      rollback: rec('update.rollback', () => ({ restored: 'v1' })),
      summary: rec('update.summary', () => upState.summary),
      versions: rec('update.versions', () => upState.versions),
    },
    history: {
      list: rec('history.list', () => fake.historyValue),
      cancel: rec('history.cancel', () => fake.historyResult),
      rollback: rec('history.rollback', () => fake.historyResult),
      detail: rec('history.detail', (id: string, offset = 0, limit = 100) => {
        const all = fake.historyLines[id] ?? [];
        return { id, total: all.length, offset, lines: all.slice(offset, offset + Math.min(limit, 100)) };
      }),
    },
  };
  const upState = defaultUpdateFake();
  updateFakes.set(fake, upState);
  const pv = defaultPreviewFake();
  const evState = defaultEventsFake();
  eventsFakes.set(fake, evState);
  previewFakes.set(fake, pv);
  const im = defaultImagesFake();
  imagesFakes.set(fake, im);
  return fake;
}

/** Installs a fake as window.api. */
export function installApi(api: FakeApi): void {
  (window as unknown as { api: Api }).api = api;
}

/** Renders the app with a project already open and waits for the main screen. */
export async function openFakeWith(api: FakeApi, o: { select?: string; rightTab?: 'item' | 'chat' } = {}) {
  api.opened = true;
  installApi(api);
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText('霧の薬草園');
  if (o.select) await act(async () => { await useApp.selectRow(o.select!); });
  if (o.rightTab) act(() => { useApp.setRightTab(o.rightTab!); });
  return user;
}

// ---- preview and fonts ----
export const MZ_METRICS: WindowMetrics = { engine: 'MZ', boxWidth: 808, padding: 12, textPadding: 8, fontSize: 26, lineHeight: 36, maxLines: 4, faceIndent: 164, iconWidth: 36, sizeStep: 12 };
/** What the fake's preview and fonts calls give back; tests change these. */
export interface PreviewFake {
  state: PreviewState;
  layout: (id: string, text?: string) => Layout | null;
  overflow: (path?: string | null) => OverflowCount;
  fontList: FontList;
  picked: FontInfo | null;
  /** Scenes per file for story.scenes. */
  scenes: Record<string, SceneInfo[]>;
  /** What project.rewrapPlan and project.rewrap give back. */
  rewrapPlan: RewrapReport; rewrapResult: RewrapReport;
}
export const emptyRewrap = (): RewrapReport => ({ fixed: 0, unfixable: 0, byWindow: { message: { fixed: 0, unfixable: 0 }, help: { fixed: 0, unfixable: 0 } }, unfixableIds: [], reasons: {} });
function defaultPreviewFake(): PreviewFake {
  return {
    rewrapPlan: emptyRewrap(), rewrapResult: emptyRewrap(),
    state: { settings: { fontPath: null, fontName: null, overrides: {} }, metrics: MZ_METRICS, detected: MZ_METRICS, fontMissing: false, context: { actorNames: {}, variables: {}, currencyUnit: 'G', partyNames: {} } },
    layout: () => null,
    overflow: () => ({ overflowing: 0, checked: 0, missingGlyphs: 0 }),
    fontList: { fonts: [], skippedCollections: 0 },
    picked: null,
    scenes: {},
  };
}
const previewFakes = new WeakMap<FakeApi, PreviewFake>();
/** The preview state behind a fake api. */
export function previewFake(api: FakeApi): PreviewFake {
  return previewFakes.get(api)!;
}

// ---- events, patches, game ----
/** What the fake's events, patches and game calls give back; tests change these. */
export interface EventsFake {
  files: EventFileInfo[];
  lists: Record<string, EventListInfo[]>;
  read: (file: string, listPath: unknown[]) => EventDetail;
  usage: (target: UsageTarget) => EventRef[];
  patches: Patch[];
  statuses: PatchStatus[];
  report: string;
  runError: string | null;
  /** What patches.josaConflicts gives back. */
  josaConflicts: string[];
}
function defaultEventsFake(): EventsFake {
  return {
    files: [], lists: {},
    read: () => ({ label: '', condition: null, hash: '', lines: [], raw: [] }),
    usage: () => [],
    patches: [], statuses: [], report: '', runError: null, josaConflicts: [],
  };
}
const eventsFakes = new WeakMap<FakeApi, EventsFake>();
/** The events/patches state behind a fake api. */
export function eventsFake(api: FakeApi): EventsFake {
  return eventsFakes.get(api)!;
}
// ---- pictures and build history ----
/** What the fake's images and builds calls give back; tests change these. */
export interface ImagesFake {
  entries: ImageEntry[]; recipes: Record<string, ImageRecipe>; overflow: Record<string, Record<string, RegionOverflow>>;
  defaultFont: string | null; failure: Record<string, string>; builds: BuildRecord[]; folders: string[];
  /** The folder exportOriginals "picks" (null = cancelled) and how many of the files it reports as failed. */
  exportDir: string | null; exportFailed: number;
}
export function defaultRegion(): Region {
  return { id: 'r0', rect: { x: 0, y: 0, w: 10, h: 10 }, erase: 'sample', text: '', fontPath: null, size: 24, color: '#ffffff', align: 'center', valign: 'middle', lineHeight: 1.25, bold: false, stroke: null, shadow: null };
}
function defaultImagesFake(): ImagesFake {
  return { entries: [], recipes: {}, overflow: {}, defaultFont: null, failure: {}, builds: [], folders: ['img/pictures', 'img/titles1', 'img/titles2', 'img/system', 'img/parallaxes'], exportDir: 'C:\\내보낸 그림', exportFailed: 0 };
}
const imagesFakes = new WeakMap<FakeApi, ImagesFake>();
/** The images state behind a fake api. */
export function imagesFake(api: FakeApi): ImagesFake {
  return imagesFakes.get(api)!;
}

// ---- game updates ----
/** What the fake's update calls give back; tests change these. */
export interface UpdateFake {
  inspect: (dir: string) => UpdateInspect;
  picked: string | null;
  summary: UpdateSummary | null;
  importError: string | null;
  versions: VersionInfo[];
  /** app.claudeStatus and patches.lastFontEmbed. */
  claude: ClaudeStatus;
  fontEmbed: FontEmbedInfo | null;
}
export function sampleSummary(): UpdateSummary {
  return {
    from: 'v1', to: 'v2', fromLabel: 'v1', toLabel: '1.1', kept: 40, keptTranslated: 30, added: 5, changed: 3, carried: 1, removed: 2, removedTranslated: 1,
    patches: [{ id: 'p-1', title: '스위치 켜기', result: 'unchanged' }, { id: 'p-2', title: '대사 고치기', result: 'moved' }, { id: 'p-3', title: '문 열기', result: 'conflict', reason: '수정이 가리키던 줄이 새 버전에 없어요(6번: 대사 やった！)' }],
    images: { changed: ['img/pictures/menu.png'], added: 4, removed: 0 },
    decisions: { newGroups: 2 },
    warnings: [{ file: 'js/plugins/Broken.js', message: '따옴표가 닫히지 않은 문자열이 있습니다' }],
  };
}
function defaultUpdateFake(): UpdateFake {
  return {
    inspect: (dir) => ({ ok: true, engine: 'MZ', title: `霧の薬草園 ver1.1 (${dir})`, suggestedLabel: '1.1', sameGame: true, overlap: 1 }),
    picked: 'C:/games/v2',
    summary: null,
    importError: null,
    versions: [{ id: 'v1', label: 'v1', importedAt: '2026-11-13T00:00:00.000Z', gameDir: 'C:/game' }],
    claude: { found: true, path: 'C:/claude.exe', loggedIn: true },
    fontEmbed: null,
  };
}
const updateFakes = new WeakMap<FakeApi, UpdateFake>();
/** The update state behind a fake api. */
export function updateFake(api: FakeApi): UpdateFake {
  return updateFakes.get(api)!;
}

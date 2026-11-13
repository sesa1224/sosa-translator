import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../src/renderer/App';
import { useApp } from '../../src/renderer/state';
import {
  DEFAULT_MODELS, DEFAULT_STAGE_MODELS, type Api, type ChooseResult, type GameDirCheck, type Glossary, type ReviewPlan, type SpeakerDetection, type AppSettings, type BuildResult, type ProjectMeta, type PushChannel, type Row, type Snapshot, type UnitDetail,
} from '../../src/shared/api';
import { computeScopes, computeStats } from '../../src/shared/rows';

export const settings: AppSettings = { theme: 'dark', models: DEFAULT_MODELS, chatModel: 'claude-fable-5-2', claudePath: null, projectsDir: 'C:/projects', stageModels: { ...DEFAULT_STAGE_MODELS } };

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
  rules: { controlCodes: true, noLeftoverJapanese: true, sameLineCount: false, maxLines: 4, maxLineWidthChars: null, speakerPattern: null },
});

export type FakeApi = Api & {
  calls: unknown[][]; emit(channel: PushChannel, payload: unknown): void; opened: boolean; rows: Row[];
  inspect(dir: string): GameDirCheck;
  glossaryValue: Glossary; chooseResult: ChooseResult; speakerDetection: SpeakerDetection | null; reviewPlanValue: ReviewPlan;
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
  const fake: FakeApi = {
    calls,
    opened: o.opened ?? false,
    rows: o.rows ?? baseRows,
    glossaryValue: { ...defaultFakeGlossary(), ...o.glossary },
    chooseResult: { changed: [], uncertain: [] },
    speakerDetection: null,
    reviewPlanValue: { items: 0, estimatedInputTokens: 0, model: 'claude-fable-5-2' },
    inspect: (dir: string): GameDirCheck => ({ ok: true, dir, engine: 'MZ', title: '霧の薬草園', suggestedName: '霧の薬草園' }),
    emit(channel, payload) {
      act(() => { for (const cb of listeners.get(channel) ?? []) cb(payload); });
    },
    settings: { get: rec('settings.get', () => current), set: rec('settings.set', (p) => (current = { ...current, ...p })) },
    project: {
      list: rec('project.list', () => []),
      pickGameDir: rec('project.pickGameDir', () => 'C:/game'),
      inspectGameDir: rec('project.inspectGameDir', (dir: string) => fake.inspect(dir)),
      pathForDrop: (file: File) => { calls.push(['project.pathForDrop', file.name]); return (file as File & { path?: string }).path ?? `C:/dropped/${file.name}`; },
      create: rec('project.create', () => { fake.opened = true; }),
      open: rec('project.open', () => { fake.opened = true; }),
      close: rec('project.close', () => { fake.opened = false; }),
      snapshot: rec('project.snapshot', snapshot),
      undo: rec('project.undo', () => []),
      build: rec('project.build', () => build),
    },
    unit: {
      get: rec('unit.get', detail),
      setTranslation: rec('unit.setTranslation', () => []),
      setStatus: rec('unit.setStatus', () => undefined),
      clear: rec('unit.clear', () => undefined),
      acceptReview: rec('unit.acceptReview', () => []),
      rejectReview: rec('unit.rejectReview', () => undefined),
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
    },
    chat: {
      send: rec('chat.send', () => undefined),
      stop: rec('chat.stop', () => undefined),
      reset: rec('chat.reset', () => undefined),
      setModel: rec('chat.setModel', () => undefined),
      undo: rec('chat.undo', () => []),
    },
    app: { claudePath: rec('app.claudePath', () => 'C:/claude.exe'), showItemInFolder: rec('app.showItemInFolder', () => undefined) },
    on(channel, cb) {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel)!.add(cb as any);
      return () => { listeners.get(channel)!.delete(cb as any); };
    },
  };
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

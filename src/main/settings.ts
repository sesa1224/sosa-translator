import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJsonFile, writeJsonFile } from '../core/util/json.js';
import { DEFAULT_MODELS, DEFAULT_STAGE_MODELS, type AppSettings, type StageModels } from '../shared/api.js';

const SETTINGS_FILE = 'settings.json';
export const PROJECTS_FOLDER_NAME = 'MVMZ 번역 작업실';

export function defaultSettings(documentsDir = path.join(os.homedir(), 'Documents')): AppSettings {
  return {
    theme: 'dark',
    models: DEFAULT_MODELS.map((m) => ({ ...m })),
    chatModel: 'claude-fable-5-2',
    claudePath: null,
    projectsDir: path.join(documentsDir, PROJECTS_FOLDER_NAME),
    stageModels: { ...DEFAULT_STAGE_MODELS },
    reviewSkipPassed: true,
  };
}

function isModelList(v: unknown): v is AppSettings['models'] {
  return Array.isArray(v) && v.length > 0
    && v.every((m) => m && typeof m === 'object' && typeof m.id === 'string' && m.id && typeof m.label === 'string');
}

function readStageModels(v: any, d: StageModels): StageModels {
  const pick = (k: 'glossary' | 'translate' | 'review' | 'patchNotes') => (v && typeof v === 'object' && typeof v[k] === 'string' && v[k] ? v[k] : d[k]);
  const out: StageModels = { glossary: pick('glossary'), translate: pick('translate'), review: pick('review'), patchNotes: pick('patchNotes') };
  if (v && typeof v.glossaryRead === 'string' && v.glossaryRead) out.glossaryRead = v.glossaryRead;
  if (v && typeof v.decide === 'string' && v.decide) out.decide = v.decide;
  return out;
}

/** Reads <dir>/settings.json. A missing or broken file (or broken field) gives the default for it. */
export async function loadSettings(dir: string, documentsDir?: string): Promise<AppSettings> {
  const d = defaultSettings(documentsDir);
  const file = path.join(dir, SETTINGS_FILE);
  if (!existsSync(file)) return d;
  let raw: any;
  try {
    raw = await readJsonFile(file);
  } catch {
    return d;
  }
  if (!raw || typeof raw !== 'object') return d;
  return {
    theme: raw.theme === 'light' || raw.theme === 'dark' ? raw.theme : d.theme,
    models: isModelList(raw.models) ? raw.models.map((m: { id: string; label: string }) => ({ id: m.id, label: m.label })) : d.models,
    chatModel: typeof raw.chatModel === 'string' && raw.chatModel ? raw.chatModel : d.chatModel,
    claudePath: typeof raw.claudePath === 'string' && raw.claudePath ? raw.claudePath : null,
    projectsDir: typeof raw.projectsDir === 'string' && raw.projectsDir ? raw.projectsDir : d.projectsDir,
    stageModels: readStageModels(raw.stageModels, d.stageModels),
    reviewSkipPassed: typeof raw.reviewSkipPassed === 'boolean' ? raw.reviewSkipPassed : d.reviewSkipPassed,
  };
}

export async function saveSettings(dir: string, s: AppSettings): Promise<void> {
  if (!s.models || s.models.length === 0) throw new Error('모델이 하나 이상 있어야 합니다');
  await writeJsonFile(path.join(dir, SETTINGS_FILE), s);
}

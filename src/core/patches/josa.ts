// The Korean particle plugin: a small game plugin that picks 은/는, 이/가 ... after the game puts a name or a
// number into a translated line ("%1은(는)" → "티아루시는"). The JS is bundled with the app and never stored in
// patches.json, so a newer app puts its newer plugin into the next build.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parsePluginsFile } from '../extract/plugins.js';
import { openProject, originalDir } from '../project/project.js';
import pluginJs from './josaPlugin.js?raw';

export const JOSA_PLUGIN_NAME = 'MVMZ_KoreanJosa';
export const JOSA_PLUGIN_JS: string = pluginJs;
export const JOSA_PLUGIN_DESCRIPTION = '한국어 조사 자동 맞춤 (MVMZ 번역 작업실)';
export const JOSA_PATCH_TITLE = '조사 자동 맞춤';

const TARGETS = [
  { assign: /String\.prototype\.format\s*=(?!=)/, keep: /=\s*String\.prototype\.format\s*(?:[;,)]|$)/m, name: /\bformat\b/ },
  {
    assign: /Window_Base\.prototype\.convertEscapeCharacters\s*=(?!=)/,
    keep: /=\s*Window_Base\.prototype\.convertEscapeCharacters\s*(?:[;,)]|$)/m,
    name: /convertEscapeCharacters/,
  },
];
const CALLS_THROUGH = /\.(?:call|apply)\(\s*this\b/;

/**
 * Whether a plugin's JS replaces String.prototype.format or Window_Base.prototype.convertEscapeCharacters
 * without keeping the old one. A guess from the text: a file that also stores the old function in a variable,
 * or calls something by that name with .call(this / .apply(this, is taken as wrapping it. A plugin loaded
 * before ours that replaces the function is still wrapped by ours; the risk is that it drops the game's own
 * name replacement or changes the text in a way the particle step does not expect.
 */
export function josaConflictsIn(js: string): boolean {
  const lines = js.split(/\r?\n/);
  return TARGETS.some((t) => {
    if (!t.assign.test(js)) return false;
    if (t.keep.test(js)) return false;
    return !lines.some((l) => t.name.test(l) && CALLS_THROUGH.test(l));
  });
}

/** Names of the enabled plugins of the original copy that may keep the particle plugin from working. */
export async function findJosaConflicts(projectDir: string): Promise<string[]> {
  const js = path.join(originalDir(projectDir, await openProject(projectDir)), 'js');
  let plugins: unknown[];
  try {
    let text = await readFile(path.join(js, 'plugins.js'), 'utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    plugins = parsePluginsFile(text).plugins;
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const p of plugins) {
    if (!p || typeof p !== 'object') continue;
    const { name, status } = p as { name?: unknown; status?: unknown };
    if (status !== true || typeof name !== 'string' || name === JOSA_PLUGIN_NAME) continue;
    const file = path.join(js, 'plugins', `${name}.js`);
    if (!existsSync(file)) continue;
    try {
      if (josaConflictsIn(await readFile(file, 'utf8'))) out.push(name);
    } catch {
      // an unreadable file is not ours to judge
    }
  }
  return out;
}

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ParamMeta, PluginMeta } from '../decisions/types.js';
import { openProject, originalDir } from '../project/project.js';
import { parsePluginsFile } from './plugins.js';

export type { ParamMeta, PluginMeta };

/** Header comment blocks: '/*:', '/*:ja', '/*~struct~Name:', '/*~struct~Name:ja'. */
const BLOCK = /\/\*(?:~struct~([^:\s*]+))?:([A-Za-z_-]*)([\s\S]*?)\*\//g;

/** Bodies to read in order: the default block (else the first), then the Japanese one, which overrides it. */
function pick(blocks: { lang: string; body: string }[]): string[] {
  const base = blocks.find((b) => b.lang === '') ?? blocks.find((b) => b.lang !== 'ja');
  const ja = blocks.find((b) => b.lang === 'ja');
  return [base, ja].filter((b) => b !== undefined).map((b) => b.body);
}

function tagLines(body: string): { tag: string; value: string }[] {
  const out: { tag: string; value: string }[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const m = /^\s*\*?\s*@(\w+)\s*(.*?)\s*$/.exec(raw);
    if (m) out.push({ tag: m[1], value: m[2] });
  }
  return out;
}

function readMain(body: string, meta: PluginMeta): void {
  let target: ParamMeta | { text?: string; desc?: string } | null = null;
  let command: PluginMeta['commands'][string] | null = null;
  for (const { tag, value } of tagLines(body)) {
    switch (tag) {
      case 'param':
        command = null;
        target = meta.params[value] ??= {};
        break;
      case 'command':
        command = meta.commands[value] ??= { args: {} };
        target = command;
        break;
      case 'arg':
        if (command) {
          const args: Record<string, ParamMeta> = command.args;
          target = args[value] ??= {};
        } else target = null;
        break;
      case 'type':
        if (target && target !== command) (target as ParamMeta).type = value;
        break;
      case 'text':
        if (target) target.text = value;
        break;
      case 'desc':
        if (target) target.desc = value;
        break;
      default:
        break;
    }
  }
}

function readStruct(body: string, fields: Record<string, ParamMeta>): Record<string, ParamMeta> {
  let target: ParamMeta | null = null;
  for (const { tag, value } of tagLines(body)) {
    if (tag === 'param') target = fields[value] ??= {};
    else if (target && (tag === 'type' || tag === 'text' || tag === 'desc')) target[tag] = value;
  }
  return fields;
}

/** Reads @param, @command, @arg, @type, @text and @desc from a plugin's header comments (a '/*:ja' block wins over the default one). */
export function parsePluginMeta(js: string): PluginMeta {
  const main: { lang: string; body: string }[] = [];
  const structs = new Map<string, { lang: string; body: string }[]>();
  for (const m of js.matchAll(BLOCK)) {
    const block = { lang: m[2], body: m[3] };
    if (m[1] !== undefined) structs.set(m[1], [...(structs.get(m[1]) ?? []), block]);
    else main.push(block);
  }
  const meta: PluginMeta = { params: {}, commands: {}, structs: {} };
  for (const body of pick(main)) readMain(body, meta);
  for (const [name, blocks] of structs) {
    const fields: Record<string, ParamMeta> = {};
    for (const body of pick(blocks)) readStruct(body, fields);
    meta.structs![name] = fields;
  }
  return meta;
}

/** Plugin name -> header comment, read from an original copy folder (synchronous; the files are small). */
export function pluginMetaFromDir(root: string): Record<string, PluginMeta> {
  const out: Record<string, PluginMeta> = {};
  const pluginsPath = path.join(root, 'js', 'plugins.js');
  if (!existsSync(pluginsPath)) return out;
  let plugins: unknown[];
  try {
    plugins = parsePluginsFile(readFileSync(pluginsPath, 'utf8')).plugins;
  } catch {
    return out;
  }
  for (const p of plugins) {
    const name = p && typeof p === 'object' ? (p as Record<string, unknown>).name : undefined;
    if (typeof name !== 'string' || /[\\/]/.test(name)) continue;
    const file = path.join(root, 'js', 'plugins', `${name}.js`);
    if (!existsSync(file)) continue;
    out[name] = parsePluginMeta(readFileSync(file, 'utf8'));
  }
  return out;
}

/** Plugin name -> header comment, for every plugin listed in js/plugins.js whose file is in the original copy. */
export async function loadPluginMeta(projectDir: string): Promise<Record<string, PluginMeta>> {
  const meta = await openProject(projectDir);
  return pluginMetaFromDir(originalDir(projectDir, meta));
}

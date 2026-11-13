import { hasJapanese } from '../text/japanese.js';
import type { PathSeg, UnitKind, UnitRef } from '../types.js';
import { mvCommandKey, mzArgKey, shapeKey } from '../decisions/keys.js';

export interface RawUnit { kind: UnitKind; source: string; speaker?: string; needsDecision: boolean; ref: UnitRef; decisionKey?: string; distinct?: string }

interface Command { code: number; indent?: number; parameters: unknown[] }

function asCommand(c: unknown): Command | null {
  if (!c || typeof c !== 'object') return null;
  const o = c as Record<string, unknown>;
  if (typeof o.code !== 'number') return null;
  return { code: o.code, indent: typeof o.indent === 'number' ? o.indent : undefined, parameters: Array.isArray(o.parameters) ? o.parameters : [] };
}

/** Text of the n-th parameter if it is a string. */
function strParam(cmd: Command, n: number): string | null {
  const v = cmd.parameters[n];
  return typeof v === 'string' ? v : null;
}

/** Extracts translatable text from an event command list. Skips null entries and non-array lists. */
export function extractFromList(list: unknown, file: string, listPath: PathSeg[]): RawUnit[] {
  if (!Array.isArray(list)) return [];
  const cmds = list.map(asCommand);
  const out: RawUnit[] = [];
  const valueRef = (i: number, ...rest: PathSeg[]): UnitRef => ({ type: 'value', file, path: [...listPath, i, 'parameters', ...rest] });
  const pushValue = (kind: UnitKind, source: string | null, needsDecision: boolean, ref: UnitRef) => {
    if (source !== null && hasJapanese(source)) out.push({ kind, source, needsDecision, ref });
  };
  const pushKeyed = (kind: UnitKind, source: string | null, ref: UnitRef, key: (s: string) => string) => {
    if (source !== null && hasJapanese(source)) out.push({ kind, source, needsDecision: true, ref, decisionKey: key(source) });
  };

  // Collects the run of `code` commands starting at `from`; returns their texts.
  const run = (from: number, code: 401 | 405): string[] => {
    const lines: string[] = [];
    for (let j = from; j < cmds.length; j++) {
      const c = cmds[j];
      if (!c || c.code !== code) break;
      lines.push(strParam(c, 0) ?? '');
    }
    return lines;
  };

  for (let i = 0; i < cmds.length; i++) {
    const cmd = cmds[i];
    if (!cmd) continue;
    switch (cmd.code) {
      case 101: {
        const name = strParam(cmd, 4);
        const speaker = name !== null && name !== '' ? name : undefined;
        if (name !== null) pushValue('db', name, false, valueRef(i, 4));
        const lines = run(i + 1, 401);
        if (lines.length > 0) {
          const source = lines.join('\n');
          if (hasJapanese(source)) {
            const unit: RawUnit = {
              kind: 'dialogue', source, needsDecision: false,
              ref: { type: 'lines', file, listPath: [...listPath], start: i + 1, count: lines.length, code: 401 },
            };
            if (speaker !== undefined) unit.speaker = speaker;
            out.push(unit);
          }
          i += lines.length;
        }
        break;
      }
      case 105: {
        const lines = run(i + 1, 405);
        if (lines.length > 0) {
          const source = lines.join('\n');
          if (hasJapanese(source)) {
            out.push({
              kind: 'scroll', source, needsDecision: false,
              ref: { type: 'lines', file, listPath: [...listPath], start: i + 1, count: lines.length, code: 405 },
            });
          }
          i += lines.length;
        }
        break;
      }
      case 102: {
        const choices = cmd.parameters[0];
        if (Array.isArray(choices)) {
          choices.forEach((c, n) => {
            if (typeof c === 'string' && hasJapanese(c)) {
              out.push({ kind: 'choice', source: c, needsDecision: false, ref: { type: 'choice', file, listPath: [...listPath], index: i, choice: n } });
            }
          });
        }
        break;
      }
      case 320: case 324: case 325:
        pushValue('name-change', strParam(cmd, 1), false, valueRef(i, 1));
        break;
      case 356:
        pushKeyed('plugin-command', strParam(cmd, 0), valueRef(i, 0), mvCommandKey);
        break;
      case 357: {
        const args = cmd.parameters[3];
        if (args && typeof args === 'object' && !Array.isArray(args)) {
          for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
            if (typeof v === 'string') pushKeyed('plugin-command', v, valueRef(i, 3, k), () => mzArgKey(strParam(cmd, 0) ?? '', strParam(cmd, 1) ?? '', k));
          }
        }
        break;
      }
      case 355: case 655:
        pushKeyed('script', strParam(cmd, 0), valueRef(i, 0), shapeKey);
        break;
      case 108: case 408:
        pushKeyed('comment', strParam(cmd, 0), valueRef(i, 0), shapeKey);
        break;
      default:
        break;
    }
  }
  return out;
}

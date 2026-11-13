import { hasJapanese } from '../text/japanese.js';
import type { PathSeg, UnitKind } from '../types.js';
import { extractFromList, type RawUnit } from './events.js';
import { extractNotes } from './notes.js';

const DB_FIELDS: Record<string, string[]> = {
  'Actors.json': ['name', 'nickname', 'profile'],
  'Classes.json': ['name'],
  'Enemies.json': ['name'],
  'Skills.json': ['name', 'description', 'message1', 'message2'],
  'Items.json': ['name', 'description'],
  'Weapons.json': ['name', 'description'],
  'Armors.json': ['name', 'description'],
  'States.json': ['name', 'message1', 'message2', 'message3', 'message4'],
};

const SYSTEM_ARRAYS = ['elements', 'skillTypes', 'weaponTypes', 'armorTypes', 'equipTypes'];
const MAP_FILE = /^Map\d+\.json$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Extracts translatable text from one data file.
 * fileName is the bare name (e.g. 'Actors.json'); refs use 'data/<fileName>'.
 */
export function extractFromDataFile(fileName: string, json: unknown): RawUnit[] {
  const file = `data/${fileName}`;
  const out: RawUnit[] = [];
  const value = (kind: UnitKind, v: unknown, path: PathSeg[]) => {
    if (typeof v === 'string' && hasJapanese(v)) out.push({ kind, source: v, needsDecision: false, ref: { type: 'value', file, path } });
  };

  const fields = DB_FIELDS[fileName];
  if (fields) {
    if (!Array.isArray(json)) return out;
    json.forEach((row, i) => {
      if (!isObject(row)) return;
      for (const f of fields) value('db', row[f], [i, f]);
      out.push(...extractNotes(row.note as string, file, [i, 'note']));
    });
    return out;
  }

  if (fileName === 'System.json') {
    if (!isObject(json)) return out;
    value('system', json.gameTitle, ['gameTitle']);
    value('system', json.currencyUnit, ['currencyUnit']);
    const terms = json.terms;
    if (isObject(terms)) {
      for (const key of ['basic', 'commands', 'params']) {
        const arr = terms[key];
        if (Array.isArray(arr)) arr.forEach((v, i) => value('system', v, ['terms', key, i]));
      }
      if (isObject(terms.messages)) {
        for (const [k, v] of Object.entries(terms.messages)) value('system', v, ['terms', 'messages', k]);
      }
    }
    for (const key of SYSTEM_ARRAYS) {
      const arr = json[key];
      if (Array.isArray(arr)) arr.forEach((v, i) => value('system', v, [key, i]));
    }
    return out;
  }

  if (MAP_FILE.test(fileName)) {
    if (!isObject(json)) return out;
    value('map-name', json.displayName, ['displayName']);
    const events = json.events;
    if (Array.isArray(events)) {
      events.forEach((ev, i) => {
        if (!isObject(ev) || !Array.isArray(ev.pages)) return;
        out.push(...extractNotes(ev.note as string, file, ['events', i, 'note']));
        ev.pages.forEach((page, j) => {
          if (isObject(page)) out.push(...extractFromList(page.list, file, ['events', i, 'pages', j, 'list']));
        });
      });
    }
    return out;
  }

  if (fileName === 'CommonEvents.json') {
    if (!Array.isArray(json)) return out;
    json.forEach((ev, i) => {
      if (isObject(ev)) out.push(...extractFromList(ev.list, file, [i, 'list']));
    });
    return out;
  }

  if (fileName === 'Troops.json') {
    if (!Array.isArray(json)) return out;
    json.forEach((troop, i) => {
      if (!isObject(troop) || !Array.isArray(troop.pages)) return;
      troop.pages.forEach((page, j) => {
        if (isObject(page)) out.push(...extractFromList(page.list, file, [i, 'pages', j, 'list']));
      });
    });
    return out;
  }

  return out;
}

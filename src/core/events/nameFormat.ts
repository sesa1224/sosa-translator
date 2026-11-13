// Name helpers without Node imports, so the renderer can describe commands too.

/** Names of game data by id (index = id), read from the original copy. Missing entries are ''. */
export interface NameTable {
  switches: string[]; variables: string[]; actors: string[]; items: string[]; weapons: string[]; armors: string[];
  skills: string[]; states: string[]; commonEvents: string[]; maps: Record<number, string>; troops: string[]; enemies: string[];
}

export function emptyNames(): NameTable {
  return { switches: [], variables: [], actors: [], items: [], weapons: [], armors: [], skills: [], states: [], commonEvents: [], maps: {}, troops: [], enemies: [] };
}

/** ' [name]' when the table has a non-empty name for id, else ''. */
export function bracketName(list: string[] | Record<number, string>, id: unknown): string {
  if (typeof id !== 'number') return '';
  const n = (list as Record<number, string>)[id];
  return typeof n === 'string' && n !== '' ? ` [${n}]` : '';
}

/** 'id [name]' or just the id. */
export function idName(list: string[] | Record<number, string>, id: unknown): string {
  return `${String(id)}${bracketName(list, id)}`;
}

import type { Decision, DecisionGroup, Decisions } from './types.js';

/** Plugin parameter types that hold a value the code reads (a file, a database id, a number, a choice). */
const CODE_TYPES = new Set([
  'file', 'animation', 'actor', 'class', 'skill', 'item', 'weapon', 'armor', 'enemy', 'troop', 'state',
  'tileset', 'common_event', 'switch', 'variable', 'number', 'boolean', 'select', 'combo',
]);
const TEXT_TYPES = new Set(['string', 'multiline_string', 'note']);
const DISPLAY_WORDS = ['表示', 'テキスト', 'メッセージ', '名前', 'タイトル', '説明', 'text', 'message', 'label', 'title', 'name'];

function suggestion(translate: boolean, reason: string): Decision {
  return { translate, keep: { mode: 'whole' }, status: 'suggested', by: 'meta', reason };
}

/** Suggests decisions only where the plugin's header or the game's file names make it certain. Confirmed groups are left out. */
export function autoDecide(groups: DecisionGroup[]): Decisions {
  const out: Decisions = {};
  for (const g of groups) {
    if (g.decision?.status === 'confirmed') continue;
    const type = g.hints.metaType;
    const base = type?.replace(/(\[\])+$/, '');
    if (type !== undefined && base !== undefined && (CODE_TYPES.has(base) || type.startsWith('file'))) {
      out[g.key] = suggestion(false, `플러그인이 이 값을 ${type} 로 선언함`);
      continue;
    }
    if (g.samples.length > 0 && g.hints.fileNames / g.samples.length >= 0.8) {
      out[g.key] = suggestion(false, '그림·소리 파일 이름과 같음');
      continue;
    }
    if (base !== undefined && TEXT_TYPES.has(base)) {
      const words = `${g.hints.metaText ?? ''} ${g.hints.metaDesc ?? ''}`.toLowerCase();
      if (DISPLAY_WORDS.some((w) => words.includes(w.toLowerCase()))) out[g.key] = suggestion(true, '플러그인 설명에 표시용 글자라고 적힘');
    }
  }
  return out;
}

/** Merges new suggestions into existing decisions: confirmed ones stay, suggestions are replaced. */
export function mergeSuggestions(existing: Decisions, suggested: Decisions): Decisions {
  const out: Decisions = { ...existing };
  for (const [k, d] of Object.entries(suggested)) {
    if (existing[k]?.status === 'confirmed') continue;
    out[k] = d;
  }
  return out;
}

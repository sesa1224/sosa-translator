/** Format rules the program checks (kept free of imports so the renderer can use the types). */
export interface FormatRules { controlCodes: boolean; noLeftoverJapanese: boolean; sameLineCount: boolean; maxLines: number | null }

export const DEFAULT_RULES: FormatRules = { controlCodes: true, noLeftoverJapanese: true, sameLineCount: false, maxLines: 4 };

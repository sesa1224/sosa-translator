/**
 * Format rules the program checks (kept free of imports so the renderer can use the types).
 * The optional fields are project rules (ProjectRules) the check also reads; a caller without them, such as the
 * CLI's check with DEFAULT_RULES, gets no notation warnings.
 */
export interface FormatRules {
  controlCodes: boolean; noLeftoverJapanese: boolean; sameLineCount: boolean; maxLines: number | null;
  notationCheck?: boolean; unmask?: boolean; halfWidth?: boolean; halfWidthBrackets?: boolean;
}

export const DEFAULT_RULES: FormatRules = { controlCodes: true, noLeftoverJapanese: true, sameLineCount: false, maxLines: 4 };

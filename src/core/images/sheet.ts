// Pure sizes for contact sheets and pictures sent to Claude (shared by the main process and the render worker).

/** Longest side of any picture sent to Claude: larger ones cost more tokens without being seen in more detail. */
export const MAX_CLAUDE_SIDE = 1568;
/** Height of the number-and-label strip under each cell of a contact sheet. */
export const SHEET_LABEL_HEIGHT = 22;

/** Grid of a contact sheet before and after shrinking it to MAX_CLAUDE_SIDE. */
export function sheetLayout(count: number, columns: number, cellSize: number): {
  columns: number; rows: number; width: number; height: number; scale: number; outWidth: number; outHeight: number;
} {
  const cols = Math.max(1, Math.min(columns, count));
  const rows = Math.max(1, Math.ceil(count / cols));
  const width = cols * cellSize;
  const height = rows * (cellSize + SHEET_LABEL_HEIGHT);
  const scale = Math.min(1, MAX_CLAUDE_SIDE / Math.max(width, height));
  return { columns: cols, rows, width, height, scale, outWidth: Math.max(1, Math.round(width * scale)), outHeight: Math.max(1, Math.round(height * scale)) };
}

/** Size of a picture shrunk so its longer side is at most maxSide (never enlarged). */
export function fitInside(width: number, height: number, maxSide: number): { width: number; height: number; scale: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

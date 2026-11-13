/** Pixel rectangle in the original picture's coordinates. */
export interface Rect { x: number; y: number; w: number; h: number }

/** One text area of a picture: what to erase and what to write there. */
export interface Region {
  id: string;
  rect: Rect;
  erase: 'none' | 'fill' | 'sample';      // sample = average colour of the 1px band just outside the rect
  fillColor?: string;                      // '#rrggbb' or '#rrggbbaa' when erase is 'fill'
  text: string;                            // '\n' breaks lines; empty = erase only
  fontPath: string | null;                 // null = the project's default picture font
  size: number;                            // px
  color: string;
  align: 'left' | 'center' | 'right';
  valign: 'top' | 'middle' | 'bottom';
  lineHeight: number;                      // multiple of size, default 1.25
  bold: boolean;
  stroke: { color: string; width: number } | null;
  shadow: { color: string; dx: number; dy: number; blur: number } | null;
  source?: string;                         // text that was there (as Claude read it); for the glossary check and the record
}

/** manual = a PNG the user fixed by hand is used instead of rendering. */
export type ImageStatus = 'todo' | 'done' | 'manual' | 'skip';

/** The "work order" of a picture: rendered again whenever it or the font changes. */
export interface ImageRecipe { file: string; baseHash: string; regions: Region[]; status: ImageStatus; manualFile?: string; note?: string }

/** images.json. recipes are keyed by file. */
export interface ImagesFile { defaultFontPath: string | null; recipes: Record<string, ImageRecipe>; folders?: string[] }   // folders: the user's choice of folders to look in

export interface ImageEntry {
  file: string;                // content-relative, plain name, e.g. 'img/pictures/menu.png'
  sourceFile: string;          // the actual file, e.g. 'img/pictures/menu.png_'
  encrypted: boolean; width: number; height: number; bytes: number; hash: string;   // hash = sha1 of the plain PNG
  usedByEvents: number;        // times a Show Picture (231) command uses it
  status: ImageStatus | 'none'; problem?: 'base-changed' | 'font-missing' | 'render-failed';
}

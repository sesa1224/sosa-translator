import raw from '../../../docs/default-style-guide.md?raw';

/** Body of a guide file: the top heading and the note paragraph under it are left out, so the text starts at the first '## ' section. */
export function guideBody(file: string): string {
  const text = file.replace(/\r\n/g, '\n');
  const i = text.search(/^## /m);
  return (i >= 0 ? text.slice(i) : text).trim() + '\n';
}

/** Body of docs/default-style-guide.md (taken in at build time). */
export const DEFAULT_STYLE_GUIDE: string = guideBody(raw);

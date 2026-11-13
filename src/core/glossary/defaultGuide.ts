import raw from '../../../docs/default-style-guide.md?raw';

/**
 * Body of docs/default-style-guide.md (taken in at build time): the file's top heading and the
 * note paragraph under it are left out, so the text starts at the first '## ' section.
 */
export const DEFAULT_STYLE_GUIDE: string = (() => {
  const text = raw.replace(/\r\n/g, '\n');
  const i = text.search(/^## /m);
  return (i >= 0 ? text.slice(i) : text).trim() + '\n';
})();

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { INDEX_HTML, TOP_PACKAGE } from '../project/originals.js';
import { openProject, originalDir } from '../project/project.js';

/** Key of the top-level package.json in titleFiles' result (it goes into the patch without the content prefix). */
export const TOP_PACKAGE_KEY = '<top>/package.json';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Files that carry the game title: index.html (its <title>) and, when its window.title is set, the top-level
 * package.json (key TOP_PACKAGE_KEY; 'name' is never changed). Empty without a title or without the originals.
 */
export async function titleFiles(projectDir: string, titleTarget: string | null): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (titleTarget === null) return out;
  const meta = await openProject(projectDir);
  const root = originalDir(projectDir, meta);

  const htmlPath = path.join(root, INDEX_HTML);
  if (existsSync(htmlPath)) {
    const html = await readFile(htmlPath, 'utf8');
    const m = /(<title[^>]*>)([\s\S]*?)(<\/title>)/i.exec(html);
    if (m) out.set(INDEX_HTML, html.slice(0, m.index) + m[1] + escapeHtml(titleTarget) + m[3] + html.slice(m.index + m[0].length));
  }

  const pkgPath = path.join(root, TOP_PACKAGE);
  if (existsSync(pkgPath)) {
    let text = await readFile(pkgPath, 'utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    try {
      const pkg = JSON.parse(text) as Record<string, unknown>;
      const win = pkg.window as Record<string, unknown> | undefined;
      if (win && typeof win === 'object' && typeof win.title === 'string' && win.title !== '') {
        win.title = titleTarget;
        out.set(TOP_PACKAGE_KEY, JSON.stringify(pkg, null, 2) + '\n');
      }
    } catch {
      // An unreadable package.json is left alone.
    }
  }
  return out;
}

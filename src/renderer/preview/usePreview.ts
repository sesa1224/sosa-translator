import { useEffect, useState } from 'react';
import type { PreviewState } from '../../shared/api';
import { DEFAULT_PALETTE, paletteFromSkin } from './palette';

/** The open project's preview settings and window size; follows 'preview:changed'. null while loading. */
export function usePreviewState(): PreviewState | null {
  const [state, setState] = useState<PreviewState | null>(null);
  useEffect(() => {
    let alive = true;
    const off = window.api.on('preview:changed', (s) => { if (alive) setState(s); });
    window.api.preview.get().then((s) => { if (alive) setState(s); }, () => undefined);
    return () => { alive = false; off(); };
  }, []);
  return state;
}

const palettes = new Map<string, Promise<string[]>>();

/** Text colors from the game's window skin (read once per game folder), DEFAULT_PALETTE until then. */
export function usePalette(gameKey: string): string[] {
  const [palette, setPalette] = useState<string[]>(DEFAULT_PALETTE);
  useEffect(() => {
    let alive = true;
    let p = palettes.get(gameKey);
    if (!p) {
      p = window.api.preview.windowSkin()
        .then((png) => (png ? paletteFromSkin(png) : DEFAULT_PALETTE))
        .catch(() => DEFAULT_PALETTE);
      palettes.set(gameKey, p);
    }
    void p.then((v) => { if (alive) setPalette(v); });
    return () => { alive = false; };
  }, [gameKey]);
  return palette;
}

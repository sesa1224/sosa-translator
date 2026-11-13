// Hidden worker page: draws pictures with a canvas for the main process (no native image library).
import { layoutRegionText, sampleBorderColor } from '../../core/images/layoutText.js';
import { fitInside, SHEET_LABEL_HEIGHT, sheetLayout } from '../../core/images/sheet.js';
import type { Region } from '../../core/images/types.js';
import type { RenderBridge, RenderRequest } from '../../shared/renderProtocol.js';

declare global {
  interface Window { renderBridge: RenderBridge }
}

/** Font key (sha1 of the bytes) → loaded family name. */
const families = new Map<string, string>();
let familyCount = 0;

async function loadFonts(fonts: Record<string, Uint8Array>): Promise<void> {
  for (const [key, bytes] of Object.entries(fonts)) {
    if (families.has(key)) continue;
    const name = `mvmz-img-${familyCount++}`;
    const face = new FontFace(name, bytes as Uint8Array<ArrayBuffer>);
    try {
      await face.load();
    } catch {
      throw new Error('폰트 파일을 읽을 수 없습니다');
    }
    document.fonts.add(face);
    families.set(key, name);
  }
}

async function decode(png: Uint8Array, resize?: { width: number; height: number }): Promise<ImageBitmap> {
  const blob = new Blob([png as BlobPart], { type: 'image/png' });
  try {
    return await createImageBitmap(blob, {
      premultiplyAlpha: 'none', colorSpaceConversion: 'none',
      ...(resize ? { resizeWidth: resize.width, resizeHeight: resize.height, resizeQuality: 'high' as const } : {}),
    });
  } catch {
    throw new Error('그림을 읽을 수 없습니다');
  }
}

async function encode(canvas: OffscreenCanvas): Promise<Uint8Array> {
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

function context(c: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('캔버스를 만들 수 없습니다');
  return ctx;
}

function drawText(ctx: OffscreenCanvasRenderingContext2D, r: Region, family: string): void {
  ctx.font = `${r.bold ? 'bold ' : ''}${r.size}px "${family}"`;
  ctx.textAlign = r.align;
  ctx.textBaseline = 'middle';
  const layout = layoutRegionText(r, (t) => ctx.measureText(t).width);
  for (const line of layout.lines) {
    if (r.shadow) {
      ctx.save();
      ctx.shadowColor = r.shadow.color;
      ctx.shadowOffsetX = r.shadow.dx;
      ctx.shadowOffsetY = r.shadow.dy;
      ctx.shadowBlur = r.shadow.blur;
      ctx.fillStyle = r.color;
      ctx.fillText(line.text, line.x, line.y);
      ctx.restore();
    }
    if (r.stroke && r.stroke.width > 0) {
      ctx.lineJoin = 'round';
      // The stroke is centred on the outline; twice the width leaves `width` pixels outside the letters.
      ctx.lineWidth = r.stroke.width * 2;
      ctx.strokeStyle = r.stroke.color;
      ctx.strokeText(line.text, line.x, line.y);
    }
    ctx.fillStyle = r.color;
    ctx.fillText(line.text, line.x, line.y);
  }
}

async function render(req: Extract<RenderRequest, { kind: 'render' }>): Promise<Uint8Array> {
  await loadFonts(req.fonts);
  const base = await decode(req.base);
  const c = new OffscreenCanvas(base.width, base.height);
  const ctx = context(c);
  ctx.drawImage(base, 0, 0);
  base.close();
  // Sampled colours come from the untouched picture, not from areas already erased.
  const pixels = req.regions.some((r) => r.erase === 'sample') ? ctx.getImageData(0, 0, c.width, c.height).data : null;
  for (const r of req.regions) {
    if (r.erase === 'none') continue;
    const color = r.erase === 'fill' ? r.fillColor ?? '#000000' : sampleBorderColor(pixels!, c.width, c.height, r.rect);
    // Clear first so a half-transparent colour replaces the old pixels instead of blending with them.
    ctx.clearRect(r.rect.x, r.rect.y, r.rect.w, r.rect.h);
    ctx.fillStyle = color;
    ctx.fillRect(r.rect.x, r.rect.y, r.rect.w, r.rect.h);
  }
  for (const r of req.regions) {
    if (r.text.trim() === '') continue;
    const fontPath = r.fontPath ?? req.defaultFontPath;
    const key = fontPath ? req.fontKeys[fontPath] : undefined;
    const family = key ? families.get(key) : undefined;
    if (!family) throw new Error(`폰트가 없습니다: ${fontPath ?? '(기본 폰트 없음)'}`);
    drawText(ctx, r, family);
  }
  return encode(c);
}

function checker(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = '#26292f';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#1b1d22';
  const s = 8;
  for (let y = 0; y < h; y += s) for (let x = (y / s) % 2 === 0 ? 0 : s; x < w; x += s * 2) ctx.fillRect(x, y, s, s);
}

function fitLabel(ctx: OffscreenCanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`…${t}`).width > maxW) t = t.slice(1);
  return `…${t}`;
}

async function sheet(req: Extract<RenderRequest, { kind: 'sheet' }>): Promise<Uint8Array> {
  const L = sheetLayout(req.cells.length, req.columns, req.cellSize);
  const c = new OffscreenCanvas(L.width, L.height);
  const ctx = context(c);
  checker(ctx, L.width, L.height);
  const pad = 4;
  const rowH = req.cellSize + SHEET_LABEL_HEIGHT;
  for (let i = 0; i < req.cells.length; i++) {
    const cx = (i % L.columns) * req.cellSize;
    const cy = Math.floor(i / L.columns) * rowH;
    try {
      const bmp = await decode(req.cells[i].png);
      const s = Math.min((req.cellSize - pad * 2) / bmp.width, (req.cellSize - pad * 2) / bmp.height, 1);
      const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, cx + (req.cellSize - w) / 2, cy + (req.cellSize - h) / 2, w, h);
      bmp.close();
    } catch {
      ctx.fillStyle = '#ff6b6b';
      ctx.fillText('?', cx + req.cellSize / 2, cy + req.cellSize / 2);
    }
    ctx.fillStyle = '#0d0e11';
    ctx.fillRect(cx, cy + req.cellSize, req.cellSize, SHEET_LABEL_HEIGHT);
    ctx.font = '13px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(fitLabel(ctx, `${i + 1}. ${req.cells[i].label}`, req.cellSize - 6), cx + 3, cy + req.cellSize + SHEET_LABEL_HEIGHT / 2);
    ctx.strokeStyle = '#4a4f59';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx + 0.5, cy + 0.5, req.cellSize - 1, rowH - 1);
  }
  if (L.scale >= 1) return encode(c);
  const out = new OffscreenCanvas(L.outWidth, L.outHeight);
  const octx = context(out);
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(c, 0, 0, L.outWidth, L.outHeight);
  return encode(out);
}

async function thumbnail(req: Extract<RenderRequest, { kind: 'thumbnail' }>): Promise<Uint8Array> {
  const probe = await decode(req.png);
  const fit = fitInside(probe.width, probe.height, req.maxSide);
  probe.close();
  if (fit.scale >= 1) return req.png;
  const bmp = await decode(req.png, fit);
  const c = new OffscreenCanvas(fit.width, fit.height);
  context(c).drawImage(bmp, 0, 0);
  bmp.close();
  return encode(c);
}

window.renderBridge.onJob((req) => {
  const run = req.kind === 'render' ? render(req) : req.kind === 'sheet' ? sheet(req) : thumbnail(req);
  run.then(
    (png) => window.renderBridge.done({ id: req.id, ok: true, png }),
    (e) => window.renderBridge.done({ id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) }),
  );
});

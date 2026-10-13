import {
  BlendMode,
  PDFDocument,
  StandardFonts,
  degrees,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import { pdfFontkit } from './pdfFontkit';
import type { PagePlanEntry } from '../types/pdfEdit';
import type { PdfGraphic, WatermarkConfig } from '../types/pdfGraphics';
import { loadFontBytes } from './fontLoader';
import { getVisiblePageGeometry, withVisualSpace } from './pageGeometry';
import { clampOpacity, toOptionalRgb, toRgb } from './pdfColor';

export { getVisiblePageGeometry, visualToPdf } from './pageGeometry';

function drawGraphic(page: PDFPage, graphic: PdfGraphic, image?: PDFImage) {
  const { x, y, width, height, lineWidth } = graphic;
  if (![x, y, width, height, lineWidth].every(Number.isFinite)) {
    throw new Error(`「${graphic.label}」の位置またはサイズが不正です`);
  }
  const isLine = graphic.kind === 'line' || graphic.kind === 'arrow';
  if ((!isLine && (width <= 0 || height <= 0)) || lineWidth < 0) {
    throw new Error(`「${graphic.label}」のサイズは正の数を指定してください`);
  }
  const alpha = clampOpacity(graphic.opacity);
  const stroke = toRgb(graphic.color);
  const fill = toOptionalRgb(graphic.fillColor);
  if ((isLine && lineWidth === 0) ||
      ((graphic.kind === 'rectangle' || graphic.kind === 'ellipse') && lineWidth === 0 && !fill)) return;
  withVisualSpace(page, ({ height: visualHeight }) => {
    const bottom = visualHeight - y - height;
    if (graphic.kind === 'image') {
      if (!image) throw new Error('追加する画像を選択してください');
      page.drawImage(image, { x, y: bottom, width, height, opacity: alpha });
    } else if (isLine) {
      const start = { x, y: visualHeight - y };
      const end = { x: x + width, y: bottom };
      page.drawLine({ start, end, thickness: lineWidth, color: stroke, opacity: alpha });
      if (graphic.kind === 'arrow' && Math.hypot(width, height) > 0) {
        const angle = Math.atan2(-height, width);
        const head = Math.min(Math.hypot(width, height) / 2, Math.max(8, lineWidth * 4));
        for (const side of [-1, 1]) {
          page.drawLine({
            start: end,
            end: {
              x: end.x - head * Math.cos(angle + side * Math.PI / 6),
              y: end.y - head * Math.sin(angle + side * Math.PI / 6),
            },
            thickness: lineWidth, color: stroke, opacity: alpha,
          });
        }
      }
    } else if (graphic.kind === 'ellipse') {
      page.drawEllipse({
        x: x + width / 2, y: bottom + height / 2, xScale: width / 2, yScale: height / 2,
        color: fill, borderColor: lineWidth > 0 ? stroke : undefined, borderWidth: lineWidth,
        opacity: alpha, borderOpacity: alpha,
      });
    } else {
      const highlight = graphic.kind === 'highlight';
      page.drawRectangle({
        x, y: bottom, width, height,
        color: highlight ? (fill ?? stroke) : fill,
        borderColor: highlight || lineWidth === 0 ? undefined : stroke,
        borderWidth: highlight ? 0 : lineWidth,
        opacity: alpha, borderOpacity: alpha,
        blendMode: highlight ? BlendMode.Multiply : BlendMode.Normal,
      });
    }
  });
}

/** Adds flattened, visible marks; image signatures are not digital signatures. */
export async function applyPdfGraphics(
  pdfBytes: ArrayBuffer | Uint8Array,
  graphics: PdfGraphic[],
  watermark: WatermarkConfig,
): Promise<Uint8Array> {
  const document = await PDFDocument.load(pdfBytes);
  const pages = document.getPages();
  const images = new Map<string, PDFImage>();
  for (const graphic of graphics) {
    const targets = graphic.pageIndex === -1 ? pages : [pages[graphic.pageIndex]].filter(Boolean);
    if (targets.length === 0) continue;
    let image: PDFImage | undefined;
    if (graphic.kind === 'image') {
      const source = graphic.imageDataUrl;
      if (!source || !/^data:image\/(png|jpe?g);base64,/i.test(source)) {
        throw new Error('画像はPNGまたはJPEGを選択してください');
      }
      image = images.get(source);
      if (!image) {
        image = /^data:image\/png;/i.test(source)
          ? await document.embedPng(source)
          : await document.embedJpg(source);
        images.set(source, image);
      }
    }
    for (const page of targets) drawGraphic(page, graphic, image);
  }

  const text = watermark.text.replace(/\s+/g, ' ').trim();
  const watermarkTargets = watermark.pageIndex === -1 ? pages : [pages[watermark.pageIndex]].filter(Boolean);
  if (watermark.enabled && text && watermarkTargets.length > 0) {
    if (!Number.isFinite(watermark.fontSize) || watermark.fontSize <= 0 || !Number.isFinite(watermark.rotation)) {
      throw new Error('透かしの文字サイズまたは角度が不正です');
    }
    // Shapes/images never fetch a font. ASCII-only watermarks use a standard font.
    const needsUnicode = /[^\x20-\x7e]/.test(text);
    if (needsUnicode) document.registerFontkit(pdfFontkit);
    const font = needsUnicode
      ? await document.embedFont(await loadFontBytes(), { subset: true })
      : await document.embedFont(StandardFonts.HelveticaBold);
    for (const page of watermarkTargets) {
      const { visualWidth, visualHeight } = getVisiblePageGeometry(page);
      const textWidth = font.widthOfTextAtSize(text, watermark.fontSize);
      const ascent = font.heightAtSize(watermark.fontSize, { descender: false });
      const descent = font.heightAtSize(watermark.fontSize) - ascent;
      const angle = watermark.rotation * Math.PI / 180;
      const localX = -textWidth / 2;
      const localY = -(ascent - descent) / 2;
      withVisualSpace(page, () => {
        page.drawText(text, {
          x: visualWidth / 2 + localX * Math.cos(angle) - localY * Math.sin(angle),
          y: visualHeight / 2 + localX * Math.sin(angle) + localY * Math.cos(angle),
          size: watermark.fontSize, font, color: toRgb(watermark.color),
          opacity: clampOpacity(watermark.opacity), rotate: degrees(watermark.rotation),
        });
      });
    }
  }
  return document.save();
}

/** Keep each mark attached to its stable page entry after reorder/removal. */
export function remapGraphicsForPages(
  graphics: PdfGraphic[], previousEntries: PagePlanEntry[], nextEntries: PagePlanEntry[],
): PdfGraphic[] {
  const nextIndexById = new Map(nextEntries.map((entry, index) => [entry.id, index]));
  return graphics.flatMap((graphic) => {
    if (graphic.pageIndex === -1) return [graphic];
    const source = previousEntries[graphic.pageIndex];
    const nextIndex = source ? nextIndexById.get(source.id) : undefined;
    return nextIndex === undefined ? [] : [{ ...graphic, pageIndex: nextIndex }];
  });
}

/** For duplicatePagePlanSelection: new copies immediately follow their originals. */
export function duplicateGraphicsForPages(
  graphics: PdfGraphic[], previousEntries: PagePlanEntry[], nextEntries: PagePlanEntry[],
): PdfGraphic[] {
  const previousIndexById = new Map(previousEntries.map((entry, index) => [entry.id, index]));
  const nextIndexById = new Map(nextEntries.map((entry, index) => [entry.id, index]));
  const copiesBySourceIndex = new Map<number, number[]>();
  for (let index = 1; index < nextEntries.length; index++) {
    const entry = nextEntries[index];
    const previous = nextEntries[index - 1];
    if (previousIndexById.has(entry.id)) continue;
    const sourceIndex = previousIndexById.get(previous.id);
    if (sourceIndex === undefined || entry.sourcePageIndex !== previous.sourcePageIndex ||
        entry.rotation !== previous.rotation || entry.width !== previous.width || entry.height !== previous.height) continue;
    copiesBySourceIndex.set(sourceIndex, [...(copiesBySourceIndex.get(sourceIndex) ?? []), index]);
  }
  // Insert each copy beside its source layer so global layers retain their z-order.
  return graphics.flatMap((graphic) => {
    if (graphic.pageIndex === -1) return [graphic];
    const source = previousEntries[graphic.pageIndex];
    const nextIndex = source ? nextIndexById.get(source.id) : undefined;
    if (nextIndex === undefined) return [];
    return [
      { ...graphic, pageIndex: nextIndex },
      ...(copiesBySourceIndex.get(graphic.pageIndex) ?? []).map((pageIndex) => ({
        ...graphic, id: crypto.randomUUID(), pageIndex,
      })),
    ];
  });
}

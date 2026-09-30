import {
  BlendMode,
  PDFDocument,
  PDFName,
  PDFNumber,
  StandardFonts,
  concatTransformationMatrix,
  degrees,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { PagePlanEntry } from '../types/pdfEdit';
import type { PdfGraphic, WatermarkConfig } from '../types/pdfGraphics';
import { loadFontBytes } from './fontLoader';

type Box = { x: number; y: number; width: number; height: number };

function normalizeBox(box: Box): Box {
  return {
    x: Math.min(box.x, box.x + box.width),
    y: Math.min(box.y, box.y + box.height),
    width: Math.abs(box.width),
    height: Math.abs(box.height),
  };
}

/** Matches PDF.js's visible page bounds, including cropped and scaled PDFs. */
export function getVisiblePageGeometry(page: PDFPage) {
  const media = normalizeBox(page.getMediaBox());
  const crop = normalizeBox(page.getCropBox());
  const left = Math.max(media.x, crop.x);
  const bottom = Math.max(media.y, crop.y);
  const right = Math.min(media.x + media.width, crop.x + crop.width);
  const top = Math.min(media.y + media.height, crop.y + crop.height);
  // PDF.js falls back to MediaBox when the two boxes have no area in common.
  const bounds = right > left && top > bottom
    ? { x: left, y: bottom, width: right - left, height: top - bottom }
    : media;
  const rawRotation = ((page.getRotation().angle % 360) + 360) % 360;
  const rotation = (rawRotation % 90 === 0 ? rawRotation : 0) as 0 | 90 | 180 | 270;
  const unitObject = page.node.lookup(PDFName.of('UserUnit'));
  const rawUnit = unitObject instanceof PDFNumber ? unitObject.asNumber() : 1;
  const userUnit = Number.isFinite(rawUnit) && rawUnit > 0 ? rawUnit : 1;
  const swapped = rotation === 90 || rotation === 270;
  return {
    ...bounds,
    rotation,
    userUnit,
    visualWidth: (swapped ? bounds.height : bounds.width) * userUnit,
    visualHeight: (swapped ? bounds.width : bounds.height) * userUnit,
  };
}

/** Visible top-left coordinates (PDF.js scale 1) to unrotated PDF user space. */
export function visualToPdf(page: PDFPage, visualX: number, visualY: number) {
  const g = getVisiblePageGeometry(page);
  const x = visualX / g.userUnit;
  const y = visualY / g.userUnit;
  switch (g.rotation) {
    case 90: return { x: g.x + y, y: g.y + x };
    case 180: return { x: g.x + g.width - x, y: g.y + y };
    case 270: return { x: g.x + g.width - y, y: g.y + g.height - x };
    default: return { x: g.x + x, y: g.y + g.height - y };
  }
}

function color(hex: string) {
  const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  return match
    ? rgb(parseInt(match[1], 16) / 255, parseInt(match[2], 16) / 255, parseInt(match[3], 16) / 255)
    : rgb(0, 0, 0);
}

function opacity(value: number) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}

/** Establish a bottom-left physical-point drawing space aligned with the view. */
function beginVisualSpace(page: PDFPage) {
  const { visualHeight, userUnit, rotation } = getVisiblePageGeometry(page);
  const origin = visualToPdf(page, 0, visualHeight);
  const scale = 1 / userUnit;
  const matrices = {
    0: [scale, 0, 0, scale],
    90: [0, scale, -scale, 0],
    180: [-scale, 0, 0, -scale],
    270: [0, -scale, scale, 0],
  } as const;
  const [a, b, c, d] = matrices[rotation];
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(a, b, c, d, origin.x, origin.y));
  return visualHeight;
}

function drawGraphic(page: PDFPage, graphic: PdfGraphic, image?: PDFImage) {
  const { x, y, width, height, lineWidth } = graphic;
  if (![x, y, width, height, lineWidth].every(Number.isFinite)) {
    throw new Error(`「${graphic.label}」の位置またはサイズが不正です`);
  }
  const isLine = graphic.kind === 'line' || graphic.kind === 'arrow';
  if ((!isLine && (width <= 0 || height <= 0)) || lineWidth < 0) {
    throw new Error(`「${graphic.label}」のサイズは正の数を指定してください`);
  }
  const alpha = opacity(graphic.opacity);
  const stroke = color(graphic.color);
  const fill = graphic.fillColor === 'transparent' || !graphic.fillColor
    ? undefined : color(graphic.fillColor);
  if ((isLine && lineWidth === 0) ||
      ((graphic.kind === 'rectangle' || graphic.kind === 'ellipse') && lineWidth === 0 && !fill)) return;
  const visualHeight = beginVisualSpace(page);
  const bottom = visualHeight - y - height;
  try {
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
  } finally {
    page.pushOperators(popGraphicsState());
  }
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
    if (needsUnicode) document.registerFontkit(fontkit);
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
      beginVisualSpace(page);
      page.drawText(text, {
        x: visualWidth / 2 + localX * Math.cos(angle) - localY * Math.sin(angle),
        y: visualHeight / 2 + localX * Math.sin(angle) + localY * Math.cos(angle),
        size: watermark.fontSize, font, color: color(watermark.color),
        opacity: opacity(watermark.opacity), rotate: degrees(watermark.rotation),
      });
      page.pushOperators(popGraphicsState());
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
  const result = remapGraphicsForPages(graphics, previousEntries, nextEntries);
  const previousIndexById = new Map(previousEntries.map((entry, index) => [entry.id, index]));
  for (let index = 1; index < nextEntries.length; index++) {
    const entry = nextEntries[index];
    const previous = nextEntries[index - 1];
    if (previousIndexById.has(entry.id)) continue;
    const sourceIndex = previousIndexById.get(previous.id);
    if (sourceIndex === undefined || entry.sourcePageIndex !== previous.sourcePageIndex ||
        entry.rotation !== previous.rotation || entry.width !== previous.width || entry.height !== previous.height) continue;
    for (const graphic of graphics) {
      if (graphic.pageIndex === sourceIndex) {
        result.push({ ...graphic, id: crypto.randomUUID(), pageIndex: index });
      }
    }
  }
  return result;
}

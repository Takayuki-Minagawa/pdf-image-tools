import { PDFDocument, degrees, rgb, PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type {
  TextBoxConfig,
  HeaderFooterSettings,
  PageNumberingConfig,
  NumberingFormat,
  PdfEditState,
} from '../types/pdfEdit';
import { loadFontBytes } from './fontLoader';

export function toRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return rgb(0, 0, 0);
  return rgb(
    parseInt(result[1], 16) / 255,
    parseInt(result[2], 16) / 255,
    parseInt(result[3], 16) / 255,
  );
}

function pageVisualGeometry(page: PDFPage) {
  const { width, height } = page.getSize();
  const x = page.getX();
  const y = page.getY();
  const rotation = ((page.getRotation().angle % 360) + 360) % 360 as 0 | 90 | 180 | 270;
  const swapsDimensions = rotation === 90 || rotation === 270;
  return {
    x,
    y,
    width,
    height,
    rotation,
    visualWidth: swapsDimensions ? height : width,
    visualHeight: swapsDimensions ? width : height,
  };
}

/** 回転後に見えるページの左上座標を、PDFユーザー空間へ戻す。 */
export function visualPointToPdf(page: PDFPage, visualX: number, visualY: number) {
  const geometry = pageVisualGeometry(page);
  switch (geometry.rotation) {
    case 90:
      return { x: geometry.x + visualY, y: geometry.y + visualX };
    case 180:
      return { x: geometry.x + geometry.width - visualX, y: geometry.y + visualY };
    case 270:
      return {
        x: geometry.x + geometry.width - visualY,
        y: geometry.y + geometry.height - visualX,
      };
    default:
      return { x: geometry.x + visualX, y: geometry.y + geometry.height - visualY };
  }
}

function isCjkChar(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    (code >= 0x2E80 && code <= 0x9FFF) ||
    (code >= 0xF900 && code <= 0xFAFF) ||
    (code >= 0xFE30 && code <= 0xFE4F) ||
    (code >= 0xFF00 && code <= 0xFFEF) ||
    (code >= 0x20000 && code <= 0x2FA1F)
  );
}

/**
 * CJK対応テキスト折り返し。measureWidth に幅計測関数を渡すことで
 * pdf-lib (font.widthOfTextAtSize) / Canvas (ctx.measureText) 両方で使える。
 */
export function wrapTextByWidth(
  text: string,
  measureWidth: (text: string) => number,
  maxWidth: number,
): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }

    let currentLine = '';

    for (const char of paragraph) {
      const testLine = currentLine + char;

      if (measureWidth(testLine) <= maxWidth) {
        currentLine = testLine;
        continue;
      }

      // Exceeded maxWidth — need to break
      if (currentLine === '') {
        // Single char exceeds width; push it anyway to avoid infinite loop
        lines.push(char);
        continue;
      }

      if (isCjkChar(char) || char === ' ') {
        // CJK or space: break right before this char
        lines.push(currentLine);
        currentLine = char === ' ' ? '' : char;
        continue;
      }

      // Non-CJK: try to break at last space
      const lastSpace = currentLine.lastIndexOf(' ');
      if (lastSpace > 0) {
        lines.push(currentLine.slice(0, lastSpace));
        currentLine = currentLine.slice(lastSpace + 1) + char;
      } else {
        // No space — force break
        lines.push(currentLine);
        currentLine = char;
      }
    }

    if (currentLine) lines.push(currentLine);
  }

  return lines.length === 0 ? [''] : lines;
}

function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  return wrapTextByWidth(text, (t) => font.widthOfTextAtSize(t, fontSize), maxWidth);
}

function toRoman(num: number, upper: boolean): string {
  const vals = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const syms = ['m', 'cm', 'd', 'cd', 'c', 'xc', 'l', 'xl', 'x', 'ix', 'v', 'iv', 'i'];
  let result = '';
  for (let i = 0; i < vals.length; i++) {
    while (num >= vals[i]) {
      result += syms[i];
      num -= vals[i];
    }
  }
  return upper ? result.toUpperCase() : result;
}

export function formatPageNumber(
  num: number,
  format: NumberingFormat,
  prefix: string,
  suffix: string,
): string {
  let formatted: string;
  switch (format) {
    case 'numeric':
      formatted = String(num);
      break;
    case 'roman-lower':
      formatted = toRoman(num, false);
      break;
    case 'roman-upper':
      formatted = toRoman(num, true);
      break;
    case 'dash-numeric':
      return `- ${num} -`;
    default:
      formatted = String(num);
  }
  return `${prefix}${formatted}${suffix}`;
}

export function resolvePlaceholders(
  template: string,
  pageNum: number,
  totalPages: number,
  fileName: string,
): string {
  const now = new Date();
  const dateStr = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;

  return template
    .replace(/\{\{page\}\}/g, String(pageNum))
    .replace(/\{\{total\}\}/g, String(totalPages))
    .replace(/\{\{date\}\}/g, dateStr)
    .replace(/\{\{filename\}\}/g, fileName);
}

function applyTextBoxes(pdfDoc: PDFDocument, textBoxes: TextBoxConfig[], font: PDFFont) {
  const pageCount = pdfDoc.getPageCount();

  for (const box of textBoxes) {
    const pagesToApply: number[] = [];
    if (box.pageIndex === -1) {
      for (let i = 0; i < pageCount; i++) pagesToApply.push(i);
    } else if (box.pageIndex >= 0 && box.pageIndex < pageCount) {
      pagesToApply.push(box.pageIndex);
    }

    for (const pageIdx of pagesToApply) {
      const page = pdfDoc.getPage(pageIdx);
      const rotation = pageVisualGeometry(page).rotation;
      const rectangleOrigin = visualPointToPdf(page, box.x, box.y + box.height);

      // Draw background
      if (box.backgroundColor !== 'transparent' && box.backgroundColor !== '') {
        page.drawRectangle({
          x: rectangleOrigin.x,
          y: rectangleOrigin.y,
          width: box.width,
          height: box.height,
          color: toRgb(box.backgroundColor),
          rotate: degrees(rotation),
        });
      }

      // Draw border
      if (box.borderStyle !== 'none' && box.borderWidth > 0) {
        const borderDashArray =
          box.borderStyle === 'dashed'
            ? [4, 4]
            : box.borderStyle === 'dotted'
              ? [1, 2]
              : undefined;

        page.drawRectangle({
          x: rectangleOrigin.x,
          y: rectangleOrigin.y,
          width: box.width,
          height: box.height,
          borderColor: toRgb(box.borderColor),
          borderWidth: box.borderWidth,
          borderDashArray,
          rotate: degrees(rotation),
        });
      }

      // Draw text
      if (box.text) {
        const padding = 4;
        const maxWidth = box.width - padding * 2;
        const lines = wrapText(box.text, font, box.fontSize, maxWidth);
        const lineHeight = box.fontSize * 1.3;

        for (let i = 0; i < lines.length; i++) {
          const visualBaselineY = box.y + padding + box.fontSize + i * lineHeight;
          if (visualBaselineY > box.y + box.height - padding) break;
          const textOrigin = visualPointToPdf(page, box.x + padding, visualBaselineY);

          page.drawText(lines[i], {
            x: textOrigin.x,
            y: textOrigin.y,
            size: box.fontSize,
            font,
            color: toRgb(box.fontColor),
            rotate: degrees(rotation),
          });
        }
      }
    }
  }
}

function applyHeaderFooter(
  pdfDoc: PDFDocument,
  settings: HeaderFooterSettings,
  font: PDFFont,
  fileName: string,
) {
  const pageCount = pdfDoc.getPageCount();

  for (let i = 0; i < pageCount; i++) {
    const page = pdfDoc.getPage(i);
    const geometry = pageVisualGeometry(page);
    const pageNum = i + 1;

    const drawSection = (config: HeaderFooterSettings['header'], isHeader: boolean) => {
      const { fontSize, fontColor, margin, marginHorizontal, left, center, right } = config;

      // drawText positions by baseline; offset by ascent (header) / descent (footer)
      // so the text edge aligns with the margin
      let visualY: number;
      if (isHeader) {
        const ascent = font.heightAtSize(fontSize, { descender: false });
        visualY = margin + ascent;
      } else {
        const descent =
          font.heightAtSize(fontSize) - font.heightAtSize(fontSize, { descender: false });
        visualY = geometry.visualHeight - margin - descent;
      }

      const draw = (text: string, align: 'left' | 'center' | 'right') => {
        if (!text) return;
        const resolved = resolvePlaceholders(text, pageNum, pageCount, fileName);
        const textWidth = font.widthOfTextAtSize(resolved, fontSize);
        let x: number;
        if (align === 'left') x = marginHorizontal;
        else if (align === 'center') x = (geometry.visualWidth - textWidth) / 2;
        else x = geometry.visualWidth - marginHorizontal - textWidth;

        const origin = visualPointToPdf(page, x, visualY);
        page.drawText(resolved, {
          x: origin.x,
          y: origin.y,
          size: fontSize,
          font,
          color: toRgb(fontColor),
          rotate: degrees(geometry.rotation),
        });
      };

      draw(left, 'left');
      draw(center, 'center');
      draw(right, 'right');
    };

    if (settings.header.enabled) drawSection(settings.header, true);
    if (settings.footer.enabled) drawSection(settings.footer, false);
  }
}

function applyPageNumbers(pdfDoc: PDFDocument, config: PageNumberingConfig, font: PDFFont) {
  const pageCount = pdfDoc.getPageCount();

  for (let i = config.startPage - 1; i < pageCount; i++) {
    const page = pdfDoc.getPage(i);
    const geometry = pageVisualGeometry(page);

    const displayNum = config.startNumber + (i - (config.startPage - 1));
    const text = formatPageNumber(displayNum, config.format, config.prefix, config.suffix);
    const textWidth = font.widthOfTextAtSize(text, config.fontSize);

    let x: number;
    if (config.position.includes('left')) {
      x = config.margin;
    } else if (config.position.includes('right')) {
      x = geometry.visualWidth - config.margin - textWidth;
    } else {
      x = (geometry.visualWidth - textWidth) / 2;
    }

    let visualY: number;
    if (config.position.startsWith('top')) {
      const ascent = font.heightAtSize(config.fontSize, { descender: false });
      visualY = config.margin + ascent;
    } else {
      const descent = font.heightAtSize(config.fontSize) - font.heightAtSize(config.fontSize, { descender: false });
      visualY = geometry.visualHeight - config.margin - descent;
    }

    const origin = visualPointToPdf(page, x, visualY);

    page.drawText(text, {
      x: origin.x,
      y: origin.y,
      size: config.fontSize,
      font,
      color: toRgb(config.fontColor),
      rotate: degrees(geometry.rotation),
    });
  }
}

export async function applyPdfEdits(
  pdfBytes: ArrayBuffer | Uint8Array,
  editState: PdfEditState,
  fileName: string,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  pdfDoc.registerFontkit(fontkit);
  const fontBytes = await loadFontBytes();
  const font = await pdfDoc.embedFont(fontBytes, { subset: true });

  if (editState.textBoxes.length > 0) {
    applyTextBoxes(pdfDoc, editState.textBoxes, font);
  }

  if (editState.headerFooter.header.enabled || editState.headerFooter.footer.enabled) {
    applyHeaderFooter(pdfDoc, editState.headerFooter, font, fileName);
  }

  if (editState.pageNumbering.enabled) {
    applyPageNumbers(pdfDoc, editState.pageNumbering, font);
  }

  return pdfDoc.save();
}

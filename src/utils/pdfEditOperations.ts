import { PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib';
import { pdfFontkit } from './pdfFontkit';
import type {
  TextBoxConfig,
  HeaderFooterSettings,
  PageNumberingConfig,
  NumberingFormat,
  PdfEditState,
} from '../types/pdfEdit';
import { loadFontBytes } from './fontLoader';
import { withVisualSpace } from './pageGeometry';
import { toOptionalRgb, toRgb } from './pdfColor';

export { toRgb } from './pdfColor';
/** @deprecated `visualToPdf` (pageGeometry) を使用。CropBox と UserUnit を考慮する。 */
export { visualToPdf as visualPointToPdf } from './pageGeometry';

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

/** 対象ページ（-1 は全ページ）を 0 始まりの配列へ展開する。範囲外は無視。 */
export function expandPageTargets(pageIndex: number, pageCount: number): number[] {
  if (pageIndex === -1) return Array.from({ length: pageCount }, (_, index) => index);
  return pageIndex >= 0 && pageIndex < pageCount ? [pageIndex] : [];
}

/** 1つのテキストボックスを、表示と一致する座標系（左上原点・物理pt）で描画する。 */
export function drawTextBox(page: PDFPage, box: TextBoxConfig, font: PDFFont) {
  withVisualSpace(page, ({ height: visualHeight }) => {
    const bottom = visualHeight - box.y - box.height;
    const background = toOptionalRgb(box.backgroundColor);
    if (background) {
      page.drawRectangle({ x: box.x, y: bottom, width: box.width, height: box.height, color: background });
    }

    if (box.borderStyle !== 'none' && box.borderWidth > 0) {
      const borderDashArray =
        box.borderStyle === 'dashed' ? [4, 4] : box.borderStyle === 'dotted' ? [1, 2] : undefined;
      page.drawRectangle({
        x: box.x,
        y: bottom,
        width: box.width,
        height: box.height,
        borderColor: toRgb(box.borderColor),
        borderWidth: box.borderWidth,
        borderDashArray,
      });
    }

    if (box.text) {
      const padding = 4;
      const maxWidth = box.width - padding * 2;
      const lines = wrapText(box.text, font, box.fontSize, maxWidth);
      const lineHeight = box.fontSize * 1.3;
      for (let i = 0; i < lines.length; i++) {
        const visualBaselineY = box.y + padding + box.fontSize + i * lineHeight;
        if (visualBaselineY > box.y + box.height - padding) break;
        page.drawText(lines[i], {
          x: box.x + padding,
          y: visualHeight - visualBaselineY,
          size: box.fontSize,
          font,
          color: toRgb(box.fontColor),
        });
      }
    }
  });
}

function applyTextBoxes(pdfDoc: PDFDocument, textBoxes: TextBoxConfig[], font: PDFFont) {
  const pageCount = pdfDoc.getPageCount();
  for (const box of textBoxes) {
    for (const pageIdx of expandPageTargets(box.pageIndex, pageCount)) {
      drawTextBox(pdfDoc.getPage(pageIdx), box, font);
    }
  }
}

/** 表示座標系で、上端または下端の余白に揃えたテキストを配置する。 */
function drawAlignedText(
  page: PDFPage,
  font: PDFFont,
  text: string,
  options: {
    fontSize: number;
    color: string;
    align: 'left' | 'center' | 'right';
    edge: 'top' | 'bottom';
    margin: number;
    marginHorizontal: number;
  },
) {
  if (!text) return;
  withVisualSpace(page, ({ width: visualWidth, height: visualHeight }) => {
    const { fontSize, align, edge, margin, marginHorizontal } = options;
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    const x = align === 'left'
      ? marginHorizontal
      : align === 'center'
        ? (visualWidth - textWidth) / 2
        : visualWidth - marginHorizontal - textWidth;

    // drawText positions by baseline; offset by ascent (top) / descent (bottom)
    // so the text edge aligns with the margin.
    const ascent = font.heightAtSize(fontSize, { descender: false });
    const descent = font.heightAtSize(fontSize) - ascent;
    const visualY = edge === 'top' ? margin + ascent : visualHeight - margin - descent;

    page.drawText(text, {
      x,
      y: visualHeight - visualY,
      size: fontSize,
      font,
      color: toRgb(options.color),
    });
  });
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
    const pageNum = i + 1;

    const drawSection = (config: HeaderFooterSettings['header'], isHeader: boolean) => {
      const { fontSize, fontColor, margin, marginHorizontal, left, center, right } = config;
      const sections = [[left, 'left'], [center, 'center'], [right, 'right']] as const;
      for (const [template, align] of sections) {
        if (!template) continue;
        drawAlignedText(page, font, resolvePlaceholders(template, pageNum, pageCount, fileName), {
          fontSize,
          color: fontColor,
          align,
          edge: isHeader ? 'top' : 'bottom',
          margin,
          marginHorizontal,
        });
      }
    };

    if (settings.header.enabled) drawSection(settings.header, true);
    if (settings.footer.enabled) drawSection(settings.footer, false);
  }
}

function applyPageNumbers(pdfDoc: PDFDocument, config: PageNumberingConfig, font: PDFFont) {
  const pageCount = pdfDoc.getPageCount();
  const startIndex = Math.max(0, config.startPage - 1);

  for (let i = startIndex; i < pageCount; i++) {
    const displayNum = config.startNumber + (i - startIndex);
    const text = formatPageNumber(displayNum, config.format, config.prefix, config.suffix);
    const align = config.position.includes('left')
      ? 'left'
      : config.position.includes('right') ? 'right' : 'center';
    drawAlignedText(pdfDoc.getPage(i), font, text, {
      fontSize: config.fontSize,
      color: config.fontColor,
      align,
      edge: config.position.startsWith('top') ? 'top' : 'bottom',
      margin: config.margin,
      marginHorizontal: config.margin,
    });
  }
}

export function hasTextEdits(editState: PdfEditState): boolean {
  return (
    editState.textBoxes.length > 0 ||
    editState.headerFooter.header.enabled ||
    editState.headerFooter.footer.enabled ||
    editState.pageNumbering.enabled
  );
}

/**
 * テキストボックス・ヘッダー/フッター・ページ番号を描画する。
 * フォントは `loadFontBytes`（`setFontBytesSource` で差し替え可能）から取得する。
 */
export async function applyPdfEdits(
  pdfBytes: ArrayBuffer | Uint8Array,
  editState: PdfEditState,
  fileName: string,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  pdfDoc.registerFontkit(pdfFontkit);
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

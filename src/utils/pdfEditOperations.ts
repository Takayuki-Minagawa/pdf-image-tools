import { PDFDocument, StandardFonts, rgb, PDFFont } from 'pdf-lib';
import type {
  TextBoxConfig,
  HeaderFooterSettings,
  PageNumberingConfig,
  NumberingFormat,
  PdfEditState,
} from '../types/pdfEdit';

function toRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return rgb(0, 0, 0);
  return rgb(
    parseInt(result[1], 16) / 255,
    parseInt(result[2], 16) / 255,
    parseInt(result[3], 16) / 255,
  );
}

function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  const paragraphs = text.split('\n');

  for (const paragraph of paragraphs) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }
    const words = paragraph.split(/\s+/);
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const width = font.widthOfTextAtSize(testLine, fontSize);

      if (width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);
  }

  return lines.length === 0 ? [''] : lines;
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
      const { height: pageHeight } = page.getSize();

      // Convert from top-origin Y to bottom-origin Y
      const pdfY = pageHeight - box.y - box.height;

      // Draw background
      if (box.backgroundColor !== 'transparent' && box.backgroundColor !== '') {
        page.drawRectangle({
          x: box.x,
          y: pdfY,
          width: box.width,
          height: box.height,
          color: toRgb(box.backgroundColor),
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
          x: box.x,
          y: pdfY,
          width: box.width,
          height: box.height,
          borderColor: toRgb(box.borderColor),
          borderWidth: box.borderWidth,
          borderDashArray,
        });
      }

      // Draw text
      if (box.text) {
        const padding = 4;
        const maxWidth = box.width - padding * 2;
        const lines = wrapText(box.text, font, box.fontSize, maxWidth);
        const lineHeight = box.fontSize * 1.3;

        for (let i = 0; i < lines.length; i++) {
          const textY = pdfY + box.height - padding - box.fontSize - i * lineHeight;
          if (textY < pdfY + padding) break;

          page.drawText(lines[i], {
            x: box.x + padding,
            y: textY,
            size: box.fontSize,
            font,
            color: toRgb(box.fontColor),
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
    const { width: pageWidth, height: pageHeight } = page.getSize();
    const pageNum = i + 1;

    if (settings.header.enabled) {
      const { fontSize, fontColor, margin, marginHorizontal, left, center, right } =
        settings.header;
      const y = pageHeight - margin;

      const draw = (text: string, align: 'left' | 'center' | 'right') => {
        if (!text) return;
        const resolved = resolvePlaceholders(text, pageNum, pageCount, fileName);
        const textWidth = font.widthOfTextAtSize(resolved, fontSize);
        let x: number;
        if (align === 'left') x = marginHorizontal;
        else if (align === 'center') x = (pageWidth - textWidth) / 2;
        else x = pageWidth - marginHorizontal - textWidth;

        page.drawText(resolved, { x, y, size: fontSize, font, color: toRgb(fontColor) });
      };

      draw(left, 'left');
      draw(center, 'center');
      draw(right, 'right');
    }

    if (settings.footer.enabled) {
      const { fontSize, fontColor, margin, marginHorizontal, left, center, right } =
        settings.footer;
      const y = margin;

      const draw = (text: string, align: 'left' | 'center' | 'right') => {
        if (!text) return;
        const resolved = resolvePlaceholders(text, pageNum, pageCount, fileName);
        const textWidth = font.widthOfTextAtSize(resolved, fontSize);
        let x: number;
        if (align === 'left') x = marginHorizontal;
        else if (align === 'center') x = (pageWidth - textWidth) / 2;
        else x = pageWidth - marginHorizontal - textWidth;

        page.drawText(resolved, { x, y, size: fontSize, font, color: toRgb(fontColor) });
      };

      draw(left, 'left');
      draw(center, 'center');
      draw(right, 'right');
    }
  }
}

function applyPageNumbers(pdfDoc: PDFDocument, config: PageNumberingConfig, font: PDFFont) {
  const pageCount = pdfDoc.getPageCount();

  for (let i = config.startPage - 1; i < pageCount; i++) {
    const page = pdfDoc.getPage(i);
    const { width: pageWidth, height: pageHeight } = page.getSize();

    const displayNum = config.startNumber + (i - (config.startPage - 1));
    const text = formatPageNumber(displayNum, config.format, config.prefix, config.suffix);
    const textWidth = font.widthOfTextAtSize(text, config.fontSize);

    let x: number;
    if (config.position.includes('left')) {
      x = config.margin;
    } else if (config.position.includes('right')) {
      x = pageWidth - config.margin - textWidth;
    } else {
      x = (pageWidth - textWidth) / 2;
    }

    let y: number;
    if (config.position.startsWith('top')) {
      y = pageHeight - config.margin;
    } else {
      y = config.margin;
    }

    page.drawText(text, {
      x,
      y,
      size: config.fontSize,
      font,
      color: toRgb(config.fontColor),
    });
  }
}

export async function applyPdfEdits(
  pdfBytes: ArrayBuffer,
  editState: PdfEditState,
  fileName: string,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

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

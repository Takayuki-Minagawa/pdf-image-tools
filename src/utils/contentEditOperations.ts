import { PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type {
  ContentEdit,
  PagePoint,
  PathContentEdit,
  TextContentEdit,
} from '../types/contentEdit';
import { toRgb } from './pdfEditOperations';
import { loadFontBytes } from './fontLoader';

// テキストのカバー矩形: ベースラインからディセンダー分を下に、文字高+αを上に確保
export const TEXT_COVER_DESCENT_RATIO = 0.25;
export const TEXT_COVER_ASCENT_RATIO = 1.05;
const TEXT_COVER_PADDING = 1;

// パス消去時に元の線より太く塗ってアンチエイリアスの残りを消す
export const PATH_ERASE_EXTRA_WIDTH = 1.5;

function buildSvgPath(points: PagePoint[], closed: boolean, pageHeight: number): string {
  const commands = points.map(
    (p, index) => `${index === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${(pageHeight - p.y).toFixed(2)}`,
  );
  if (closed) commands.push('Z');
  return commands.join(' ');
}

function applyTextEdit(page: PDFPage, edit: TextContentEdit, font: PDFFont | null) {
  const target = edit.target;

  page.drawRectangle({
    x: target.x - TEXT_COVER_PADDING,
    y: target.y - target.fontSize * TEXT_COVER_DESCENT_RATIO - TEXT_COVER_PADDING,
    width: target.width + TEXT_COVER_PADDING * 2,
    height: target.fontSize * (TEXT_COVER_DESCENT_RATIO + TEXT_COVER_ASCENT_RATIO) +
      TEXT_COVER_PADDING * 2,
    color: toRgb(edit.coverColor),
  });

  if (edit.action === 'replace' && edit.newText && font) {
    page.drawText(edit.newText, {
      x: target.x,
      y: target.y,
      size: edit.fontSize,
      font,
      color: toRgb(edit.fontColor),
      lineHeight: edit.fontSize * 1.2,
    });
  }
}

function applyPathEdit(page: PDFPage, edit: PathContentEdit) {
  const target = edit.target;
  const pageHeight = page.getHeight();
  const svg = buildSvgPath(target.points, target.closed, pageHeight);

  // 元の図形をカバー色で上書きして消す。
  // fillは開いたパスでも暗黙に閉じて塗られる（PDF仕様）ため closed は条件にしない。
  page.drawSvgPath(svg, {
    x: 0,
    y: pageHeight,
    borderColor: toRgb(edit.coverColor),
    borderWidth: Math.max(target.lineWidth, 0.5) + PATH_ERASE_EXTRA_WIDTH,
    ...(target.filled ? { color: toRgb(edit.coverColor) } : {}),
  });

  if (edit.action === 'restyle') {
    page.drawSvgPath(svg, {
      x: 0,
      y: pageHeight,
      ...(target.stroked
        ? { borderColor: toRgb(edit.strokeColor), borderWidth: Math.max(edit.lineWidth, 0.1) }
        : {}),
      ...(target.filled ? { color: toRgb(edit.fillColor) } : {}),
    });
  }
}

/**
 * 認識済みコンテンツへの編集（置換 / スタイル変更 / 削除）を適用する。
 * 元要素はカバー色で塗り潰し、新しい内容を上から描画する方式。
 * ページインデックスは元PDF基準のため、ページ並び替え前に適用すること。
 */
export async function applyContentEdits(
  pdfBytes: ArrayBuffer | Uint8Array,
  edits: ContentEdit[],
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes);

  let font: PDFFont | null = null;
  const needsFont = edits.some(
    (edit) => edit.kind === 'text' && edit.action === 'replace' && edit.newText,
  );
  if (needsFont) {
    pdfDoc.registerFontkit(fontkit);
    font = await pdfDoc.embedFont(await loadFontBytes(), { subset: true });
  }

  const pageCount = pdfDoc.getPageCount();
  for (const edit of edits) {
    const { pageIndex } = edit.target;
    if (pageIndex < 0 || pageIndex >= pageCount) continue;

    const page = pdfDoc.getPage(pageIndex);
    if (edit.kind === 'text') {
      applyTextEdit(page, edit, font);
    } else {
      applyPathEdit(page, edit);
    }
  }

  return pdfDoc.save();
}

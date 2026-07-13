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
import { redactTextFromPage } from './contentStreamRedaction';
import { findResidualRedactions } from './redactionVerification';
import type { RecognizedTextItem } from '../types/contentEdit';
import { saveReachablePdfDocument } from './pdfSerialization';

export class RedactionVerificationError extends Error {
  readonly residual: RecognizedTextItem[];
  readonly coveredPdfBytes: Uint8Array;

  constructor(residual: RecognizedTextItem[], coveredPdfBytes: Uint8Array) {
    super(`${residual.length}件の文字データを完全削除できませんでした`);
    this.name = 'RedactionVerificationError';
    this.residual = residual;
    this.coveredPdfBytes = coveredPdfBytes;
  }
}

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
 * redact アクションのテキスト編集について、対象文字をコンテンツストリームから
 * 物理削除する。ページ単位でまとめて処理し、除去を保証できなかった対象を返す。
 */
function applyRedactions(
  pdfDoc: PDFDocument,
  edits: ContentEdit[],
  pageCount: number,
): RecognizedTextItem[] {
  const byPage = new Map<number, RecognizedTextItem[]>();
  for (const edit of edits) {
    if (edit.kind !== 'text' || edit.action !== 'redact') continue;
    const { pageIndex } = edit.target;
    if (pageIndex < 0 || pageIndex >= pageCount) continue;
    const list = byPage.get(pageIndex) ?? [];
    list.push(edit.target);
    byPage.set(pageIndex, list);
  }

  const unmatched: RecognizedTextItem[] = [];
  for (const [pageIndex, targets] of byPage) {
    const result = redactTextFromPage(pdfDoc, pageIndex, targets);
    unmatched.push(...result.unmatched);
  }
  return unmatched;
}

/**
 * 認識済みコンテンツへの編集（置換 / スタイル変更 / 削除 / 完全削除）を適用する。
 *
 * - delete / replace / restyle: 元要素をカバー色で塗り潰し、新しい内容を上から描画する。
 * - redact: 対象テキストの描画オペランドをコンテンツストリームから物理削除した上で
 *   カバー色で塗り潰す。テキスト抽出（AI読み込み等）からも復元できなくなる。
 *
 * ページインデックスは元PDF基準のため、ページ並び替え前に適用すること。
 * 除去を保証できなかった redact 対象があれば onWarn に渡す（視覚的なカバーは行われる）。
 */
export async function applyContentEdits(
  pdfBytes: ArrayBuffer | Uint8Array,
  edits: ContentEdit[],
  onWarn?: (unmatched: RecognizedTextItem[]) => void,
  options: { failOnResidual?: boolean } = {},
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

  // 物理削除はカバー描画より先に、元のストリームに対して行う
  applyRedactions(pdfDoc, edits, pageCount);

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

  // 完全削除は事後検証する: 対象文字が抽出可能なまま残っていれば「保証できなかった」
  // として通知する（マッチング任せにせず実測で確認する）。
  const redactTargets = edits
    .filter((e): e is typeof e & { kind: 'text' } => e.kind === 'text' && e.action === 'redact')
    .map((e) => e.target);
  const bytes = redactTargets.length > 0
    ? await saveReachablePdfDocument(pdfDoc)
    : await pdfDoc.save();
  if (redactTargets.length > 0) {
    const residual = await findResidualRedactions(bytes, redactTargets);
    if (residual.length > 0) {
      console.warn(
        `[redact] ${residual.length}件のテキストはデータから除去できませんでした（カバーのみ適用）`,
        residual.map((t) => t.text),
      );
      onWarn?.(residual);
      if (options.failOnResidual) {
        throw new RedactionVerificationError(residual, bytes);
      }
    }
  }

  return bytes;
}

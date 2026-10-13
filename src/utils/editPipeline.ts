/**
 * 編集内容を元PDFへ適用して最終バイト列を得る共通パイプライン。
 *
 * 適用順序（PdfEditor・バッチ処理・CLI で同一）:
 *   1. ページ計画（並び替え・削除・複製・回転・空白ページ）
 *   2. 既存コンテンツ編集（置換・削除・完全削除・スタイル変更）
 *   3. テキストボックス・ヘッダー/フッター・ページ番号
 *   4. 図形・画像・サイン・透かし
 */
import type { ContentEdit } from '../types/contentEdit';
import type {
  HeaderFooterSettings,
  PageNumberingConfig,
  PagePlanEntry,
  TextBoxConfig,
} from '../types/pdfEdit';
import type { PdfGraphic, WatermarkConfig } from '../types/pdfGraphics';
import { PDFDocument } from 'pdf-lib';
import { applyContentEdits, RedactionVerificationError } from './contentEditOperations';
import { applyPdfEdits, hasTextEdits } from './pdfEditOperations';
import { buildPdfFromPagePlan, copyPdfBytes } from './pdfEditor';
import { applyPdfGraphics } from './pdfGraphics';

export interface PdfEditSnapshot {
  pageEntries: PagePlanEntry[];
  textBoxes: TextBoxConfig[];
  headerFooter: HeaderFooterSettings;
  pageNumbering: PageNumberingConfig;
  contentEdits: ContentEdit[];
  graphics: PdfGraphic[];
  watermark: WatermarkConfig;
}

export interface BuildEditedPdfOptions {
  /** ヘッダー/フッターの {{filename}} に使う */
  fileName: string;
  /** 元PDFのページ数。省略時は読み込んで数える */
  originalPageCount?: number;
  /** 完全削除の事後検証に失敗してもカバーのみで続行する */
  allowCoverOnly?: boolean;
}

export function createIdentityPagePlan(pageCount: number): PagePlanEntry[] {
  return Array.from({ length: pageCount }, (_, sourcePageIndex) => ({
    id: crypto.randomUUID(),
    sourcePageIndex,
    rotation: 0,
  }));
}

/** ページ計画が元PDFと異なる（並び・数・回転のいずれかが変わった）か */
export function hasPagePlanChanges(entries: PagePlanEntry[], originalPageCount: number): boolean {
  return (
    entries.length > 0 &&
    (entries.length !== originalPageCount ||
      entries.some((entry, index) => entry.sourcePageIndex !== index || entry.rotation !== 0))
  );
}

/**
 * ページ計画を適用した後の最終ページ番号へ、コンテンツ編集の対象ページを変換する。
 * 同じ元ページを複製した場合も、pageEntryId により選択したコピーだけを編集できる。
 */
export function scopeContentEditsToPlan(contentEdits: ContentEdit[], pageEntries: PagePlanEntry[]): ContentEdit[] {
  return contentEdits.flatMap((edit) => {
    const pageIndex = edit.pageEntryId
      ? pageEntries.findIndex((entry) => entry.id === edit.pageEntryId)
      : pageEntries.findIndex((entry) => entry.sourcePageIndex === edit.target.pageIndex);
    return pageIndex === -1 ? [] : [{ ...edit, target: { ...edit.target, pageIndex } } as ContentEdit];
  });
}

export async function buildEditedPdf(
  pdfBytes: ArrayBuffer | Uint8Array,
  snapshot: PdfEditSnapshot,
  options: BuildEditedPdfOptions,
): Promise<Uint8Array> {
  const originalPageCount = options.originalPageCount ??
    (await PDFDocument.load(pdfBytes, { updateMetadata: false })).getPageCount();
  const pageEntries = snapshot.pageEntries.length > 0
    ? snapshot.pageEntries
    : createIdentityPagePlan(originalPageCount);

  let working: ArrayBuffer | Uint8Array = pdfBytes;

  if (hasPagePlanChanges(pageEntries, originalPageCount)) {
    working = await buildPdfFromPagePlan(working, pageEntries);
  }

  const scopedContentEdits = scopeContentEditsToPlan(snapshot.contentEdits, pageEntries);
  if (scopedContentEdits.length > 0) {
    try {
      working = await applyContentEdits(working, scopedContentEdits, undefined, { failOnResidual: true });
    } catch (error) {
      if (!(error instanceof RedactionVerificationError) || !options.allowCoverOnly) throw error;
      working = error.coveredPdfBytes;
    }
  }

  const textState = {
    textBoxes: snapshot.textBoxes,
    headerFooter: snapshot.headerFooter,
    pageNumbering: snapshot.pageNumbering,
  };
  if (hasTextEdits(textState)) {
    working = await applyPdfEdits(working, textState, options.fileName);
  }

  if (snapshot.graphics.length > 0 || snapshot.watermark.enabled) {
    working = await applyPdfGraphics(working, snapshot.graphics, snapshot.watermark);
  }

  return copyPdfBytes(working);
}

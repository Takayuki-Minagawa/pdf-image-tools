import { PDFDocument, degrees } from 'pdf-lib';
import type { PagePlanEntry } from '../types/pdfEdit';
import { saveReachablePdfDocument } from './pdfSerialization';

export async function deletePdfPages(
  pdfBytes: ArrayBuffer | Uint8Array,
  pageIndicesToDelete: number[]
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  
  // 降順でソートして、後ろから削除（インデックスがずれないように）
  const sortedIndices = [...pageIndicesToDelete].sort((a, b) => b - a);
  
  for (const index of sortedIndices) {
    pdfDoc.removePage(index);
  }
  
  return pdfDoc.save();
}

export async function reorderPdfPages(
  pdfBytes: ArrayBuffer | Uint8Array,
  newOrder: number[]
): Promise<Uint8Array> {
  const srcDoc = await PDFDocument.load(pdfBytes);
  const newDoc = await PDFDocument.create();
  
  for (const pageIndex of newOrder) {
    const [copiedPage] = await newDoc.copyPages(srcDoc, [pageIndex]);
    newDoc.addPage(copiedPage);
  }
  
  return newDoc.save();
}

/**
 * 元PDFとページ計画から新しいPDFを構築する。ページの複製、回転、空白ページを
 * 一つの処理で扱うため、単純な page index 配列より安全に編集状態を表現できる。
 */
export async function buildPdfFromPagePlan(
  pdfBytes: ArrayBuffer | Uint8Array,
  entries: PagePlanEntry[],
): Promise<Uint8Array> {
  if (entries.length === 0) throw new Error('PDFには1ページ以上必要です');

  // 同じドキュメントのページツリーだけを組み替えることで、メタデータ、しおり、
  // 添付、フォームなどの文書レベル構造を維持する。
  const nextDoc = await PDFDocument.load(pdfBytes);
  const copySource = await PDFDocument.load(pdfBytes);
  const originalPages = [...nextDoc.getPages()];
  for (let index = nextDoc.getPageCount() - 1; index >= 0; index--) nextDoc.removePage(index);
  const reusedOriginalPages = new Set<number>();

  for (const entry of entries) {
    if (entry.sourcePageIndex === null) {
      const page = nextDoc.addPage([entry.width ?? 595.28, entry.height ?? 841.89]);
      if (entry.rotation) page.setRotation(degrees(entry.rotation));
      continue;
    }

    if (entry.sourcePageIndex < 0 || entry.sourcePageIndex >= originalPages.length) {
      throw new Error(`存在しない元ページです: ${entry.sourcePageIndex + 1}`);
    }

    let page;
    if (!reusedOriginalPages.has(entry.sourcePageIndex)) {
      page = originalPages[entry.sourcePageIndex];
      reusedOriginalPages.add(entry.sourcePageIndex);
    } else {
      [page] = await nextDoc.copyPages(copySource, [entry.sourcePageIndex]);
    }
    const originalRotation = page.getRotation().angle;
    page.setRotation(degrees((originalRotation + entry.rotation) % 360));
    nextDoc.addPage(page);
  }

  return saveReachablePdfDocument(nextDoc);
}

export async function extractPdfPageIndices(
  pdfBytes: ArrayBuffer | Uint8Array,
  pageIndices: number[],
): Promise<Uint8Array> {
  const srcDoc = await PDFDocument.load(pdfBytes);
  const uniqueIndices = pageIndices.filter(
    (value, index) => pageIndices.indexOf(value) === index && value >= 0 && value < srcDoc.getPageCount(),
  );
  if (uniqueIndices.length === 0) throw new Error('抽出するページを選択してください');

  const nextDoc = await PDFDocument.create();
  const pages = await nextDoc.copyPages(srcDoc, uniqueIndices);
  pages.forEach((page) => nextDoc.addPage(page));
  return nextDoc.save();
}

export async function extractPdfPages(
  pdfBytes: ArrayBuffer | Uint8Array,
  startPage: number,
  endPage: number
): Promise<Uint8Array> {
  const srcDoc = await PDFDocument.load(pdfBytes);
  const pageCount = srcDoc.getPageCount();
  
  // 範囲チェック
  if (startPage < 0 || endPage >= pageCount || startPage > endPage) {
    throw new Error(`Invalid page range: ${startPage + 1} to ${endPage + 1}. PDF has ${pageCount} pages.`);
  }
  
  const newDoc = await PDFDocument.create();
  
  const pageIndices: number[] = [];
  for (let i = startPage; i <= endPage; i++) {
    pageIndices.push(i);
  }
  
  const copiedPages = await newDoc.copyPages(srcDoc, pageIndices);
  for (const page of copiedPages) {
    newDoc.addPage(page);
  }
  
  return newDoc.save();
}

export function downloadPdf(pdfBytes: Uint8Array, filename: string) {
  const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

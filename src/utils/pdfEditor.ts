import { PDFDocument } from 'pdf-lib';

export async function deletePdfPages(
  pdfBytes: ArrayBuffer,
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
  pdfBytes: ArrayBuffer,
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

export async function extractPdfPages(
  pdfBytes: ArrayBuffer,
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

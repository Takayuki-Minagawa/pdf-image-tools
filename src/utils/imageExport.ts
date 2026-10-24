import { DEFAULT_IMAGE_EXPORT_OPTIONS } from '../types/pdfEdit';
import type { PdfImageExportOptions } from '../types/pdfEdit';
import { pageRangeToIndices } from './arrayUtils';
import { downloadDataUrlsAsZip, sanitizeFilename } from './download';

export const IMAGE_EXPORT_STORAGE_KEY = 'pdf-image-tools:pdf-image-export';

export function readStoredImageExportOptions(): PdfImageExportOptions {
  try {
    const stored = JSON.parse(localStorage.getItem(IMAGE_EXPORT_STORAGE_KEY) ?? '{}') as Partial<PdfImageExportOptions>;
    return { ...DEFAULT_IMAGE_EXPORT_OPTIONS, ...stored };
  } catch {
    return DEFAULT_IMAGE_EXPORT_OPTIONS;
  }
}

export function imageExportBaseName(options: Pick<PdfImageExportOptions, 'filename'>): string {
  return sanitizeFilename(options.filename, 'edited-pages');
}

export function imageExportFileName(
  options: Pick<PdfImageExportOptions, 'filename' | 'format'>,
  pageNumber: number,
): string {
  const extension = options.format === 'jpeg' ? 'jpg' : options.format;
  return `${imageExportBaseName(options)}_page_${pageNumber}.${extension}`;
}

/**
 * 画像出力の対象ページ（0始まり）を決める。全ページ出力では undefined を返す。
 * 範囲指定は表示ページ数に収め、空になる場合はエラーにする。
 */
export function resolveImageExportPageIndices(
  options: Pick<PdfImageExportOptions, 'pageMode' | 'rangeStart' | 'rangeEnd'>,
  selectedPages: ReadonlySet<number>,
  pageCount: number,
): number[] | undefined {
  if (options.pageMode === 'selected') return [...selectedPages].sort((a, b) => a - b);
  if (options.pageMode === 'range') {
    const start = Math.max(1, options.rangeStart);
    const end = Math.min(pageCount, options.rangeEnd);
    if (start > end) throw new Error('画像出力のページ範囲が正しくありません');
    return pageRangeToIndices(start, end);
  }
  return undefined;
}

export function downloadImagesAsZip(
  images: Array<{ pageNumber: number; dataUrl: string }>,
  options: Pick<PdfImageExportOptions, 'filename' | 'format'>,
) {
  return downloadDataUrlsAsZip(
    images.map((image) => ({ filename: imageExportFileName(options, image.pageNumber), dataUrl: image.dataUrl })),
    imageExportBaseName(options),
  );
}

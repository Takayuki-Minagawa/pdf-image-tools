import * as pdfjsLib from 'pdfjs-dist';
import { throwIfAborted as throwIfSignalAborted } from './async';
import { ensurePdfjsWorker } from './pdfjsWorker';

export interface ConvertedImage {
  pageNumber: number;
  dataUrl: string;
  width: number;
  height: number;
  format?: 'png' | 'jpeg' | 'webp';
}

export interface PdfToImagesOptions {
  scale?: number;
  format?: 'png' | 'jpeg' | 'webp';
  quality?: number;
  /** 0-based page indices. Omit to export every page. */
  pageIndices?: number[];
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

const CANCELLED_MESSAGE = '画像出力をキャンセルしました';

function throwIfAborted(signal?: AbortSignal) {
  throwIfSignalAborted(signal, CANCELLED_MESSAGE);
}

function formatToMime(format: NonNullable<PdfToImagesOptions['format']>) {
  return format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
}

export async function pdfBytesToImages(
  pdfBytes: ArrayBuffer | Uint8Array,
  scaleOrOptions: number | PdfToImagesOptions = 2,
  legacyOnProgress?: (progress: number) => void,
): Promise<ConvertedImage[]> {
  const options: PdfToImagesOptions = typeof scaleOrOptions === 'number'
    ? { scale: scaleOrOptions, onProgress: legacyOnProgress }
    : scaleOrOptions;
  const scale = Math.min(4, Math.max(0.25, options.scale ?? 2));
  const format = options.format ?? 'png';
  const quality = Math.min(1, Math.max(0.1, options.quality ?? 0.92));
  throwIfAborted(options.signal);
  ensurePdfjsWorker();
  const pdf = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
  const images: ConvertedImage[] = [];
  try {
    const pageIndices = (options.pageIndices ?? Array.from({ length: pdf.numPages }, (_, index) => index))
      .filter((index, position, values) =>
        index >= 0 && index < pdf.numPages && values.indexOf(index) === position,
      );

    if (pageIndices.length === 0) throw new Error('出力するページがありません');

    for (let position = 0; position < pageIndices.length; position++) {
      throwIfAborted(options.signal);
      const pageIndex = pageIndices[position];
      const page = await pdf.getPage(pageIndex + 1);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      try {
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvasを初期化できません');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const renderTask = page.render({ canvasContext: context, viewport, canvas });
        const cancelRender = () => renderTask.cancel();
        options.signal?.addEventListener('abort', cancelRender, { once: true });
        try {
          await renderTask.promise;
        } catch (error) {
          throwIfAborted(options.signal);
          throw error;
        } finally {
          options.signal?.removeEventListener('abort', cancelRender);
        }
        throwIfAborted(options.signal);

        const dataUrl = canvas.toDataURL(formatToMime(format), quality);
        images.push({
          pageNumber: pageIndex + 1,
          dataUrl,
          width: viewport.width,
          height: viewport.height,
          format,
        });
        options.onProgress?.(((position + 1) / pageIndices.length) * 100);
      } finally {
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
      }
    }
    return images;
  } finally {
    await pdf.destroy();
  }
}

export async function pdfToImages(
  file: File,
  scaleOrOptions: number | PdfToImagesOptions = 2,
  onProgress?: (progress: number) => void,
): Promise<ConvertedImage[]> {
  const arrayBuffer = await file.arrayBuffer();
  return pdfBytesToImages(arrayBuffer, scaleOrOptions, onProgress);
}

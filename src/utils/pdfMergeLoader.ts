import * as pdfjsLib from 'pdfjs-dist';
import { throwIfAborted } from './async';
import { validatePdfFile } from './pdfMergeUtils';
import type { PdfLoadErrorInfo } from './pdfMergeUtils';
import { ensurePdfjsWorker } from './pdfjsWorker';

export interface MergePage {
  id: string;
  fileId: string;
  sourcePageIndex: number;
  thumbnail: string;
  excluded: boolean;
}

export interface PdfFileEntry {
  id: string;
  file: File;
  name: string;
  status: 'loading' | 'ready' | 'error';
  bytes?: ArrayBuffer;
  signature?: string;
  pageCount?: number;
  thumbnail?: string;
  pages: MergePage[];
  error?: PdfLoadErrorInfo;
  duplicateOf?: string;
}

export interface LoadedPdf {
  bytes: ArrayBuffer;
  signature: string;
  pageCount: number;
  thumbnail: string;
  pages: MergePage[];
}

export function newLoadingEntry(file: File): PdfFileEntry {
  return {
    id: crypto.randomUUID(),
    file,
    name: file.name,
    status: 'loading',
    pages: [],
  };
}

export function isPageOfFile(pageId: string, fileId: string): boolean {
  return pageId.startsWith(`${fileId}-page-`);
}

async function createSignature(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice(0));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

/** PDFを読み込み、重複判定用の署名と全ページのサムネイルを作る。 */
export async function loadPdfFile(fileId: string, file: File, signal: AbortSignal): Promise<LoadedPdf> {
  validatePdfFile(file);
  throwIfAborted(signal);

  const sourceBytes = await file.arrayBuffer();
  const bytes = sourceBytes.slice(0);
  const signaturePromise = createSignature(bytes);
  throwIfAborted(signal);

  ensurePdfjsWorker();
  const loadingTask = pdfjsLib.getDocument({ data: sourceBytes });
  const abortLoading = () => {
    void loadingTask.destroy();
  };
  signal.addEventListener('abort', abortLoading, { once: true });

  try {
    const pdf = await loadingTask.promise;
    const pages: MergePage[] = [];
    try {
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        throwIfAborted(signal);
        const page = await pdf.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(0.3, 150 / Math.max(baseViewport.width, 1));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas context is unavailable');
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        pages.push({
          id: `${fileId}-page-${pageNumber}`,
          fileId,
          sourcePageIndex: pageNumber - 1,
          thumbnail: canvas.toDataURL('image/jpeg', 0.76),
          excluded: false,
        });
        page.cleanup();
      }
    } finally {
      await pdf.destroy();
    }
    throwIfAborted(signal);
    return {
      bytes,
      signature: await signaturePromise,
      pageCount: pages.length,
      thumbnail: pages[0]?.thumbnail ?? '',
      pages,
    };
  } finally {
    signal.removeEventListener('abort', abortLoading);
  }
}

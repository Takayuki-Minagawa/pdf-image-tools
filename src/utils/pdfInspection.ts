/**
 * PDF の構造（テキスト・ベクターパス）を機械可読に取り出す。
 * CLI の `inspect`、バッチ処理・レシピのコンテンツ編集ルール解決で共有する。
 */
import * as pdfjsLib from 'pdfjs-dist';
import type { RecognizedItem } from '../types/contentEdit';
import { recognizePageContent } from './contentRecognition';
import { ensurePdfjsWorker } from './pdfjsWorker';
import { getPdfjsDocumentOptions } from './pdfjsDocumentOptions';

export interface InspectedPageInfo {
  /** 1始まり */
  pageNumber: number;
  /** 回転を反映した表示サイズ（pt） */
  width: number;
  height: number;
  /** /Rotate（度） */
  rotation: number;
}

export interface InspectedPage extends InspectedPageInfo {
  items: RecognizedItem[];
}

export interface PdfInspection {
  pageCount: number;
  pages: InspectedPage[];
}

export interface OpenedPdf {
  pageCount: number;
  pageInfo: (pageIndex: number) => Promise<InspectedPageInfo>;
  /** 認識結果はページ単位でキャッシュされる */
  readPage: (pageIndex: number) => Promise<RecognizedItem[]>;
  destroy: () => Promise<void>;
}

/** pdf.js で開き、ページ解析関数を返す。使用後は destroy() すること。 */
export async function openPdfForInspection(bytes: ArrayBuffer | Uint8Array): Promise<OpenedPdf> {
  ensurePdfjsWorker();
  // pdf.js は渡したバッファを Worker へ転送（detach）するためコピーを渡す
  const copy = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes.slice(0));
  const document = await pdfjsLib.getDocument({ data: copy, ...getPdfjsDocumentOptions() }).promise;
  const cache = new Map<number, Promise<RecognizedItem[]>>();

  const assertRange = (pageIndex: number) => {
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= document.numPages) {
      throw new Error(`ページ ${pageIndex + 1} は存在しません（1〜${document.numPages}）`);
    }
  };

  return {
    pageCount: document.numPages,
    async pageInfo(pageIndex) {
      assertRange(pageIndex);
      const page = await document.getPage(pageIndex + 1);
      const viewport = page.getViewport({ scale: 1 });
      return { pageNumber: pageIndex + 1, width: viewport.width, height: viewport.height, rotation: page.rotate };
    },
    readPage(pageIndex) {
      assertRange(pageIndex);
      let pending = cache.get(pageIndex);
      if (!pending) {
        pending = document.getPage(pageIndex + 1).then(recognizePageContent);
        cache.set(pageIndex, pending);
      }
      return pending;
    },
    destroy: () => document.destroy(),
  };
}

/** 指定ページ（省略時は全ページ）のテキスト・ベクター要素を取り出す。 */
export async function inspectPdf(
  bytes: ArrayBuffer | Uint8Array,
  pageIndices?: number[],
): Promise<PdfInspection> {
  const opened = await openPdfForInspection(bytes);
  try {
    const indices = pageIndices ?? Array.from({ length: opened.pageCount }, (_, index) => index);
    const pages: InspectedPage[] = [];
    for (const pageIndex of indices) {
      const [info, items] = await Promise.all([opened.pageInfo(pageIndex), opened.readPage(pageIndex)]);
      pages.push({ ...info, items });
    }
    return { pageCount: opened.pageCount, pages };
  } finally {
    await opened.destroy();
  }
}

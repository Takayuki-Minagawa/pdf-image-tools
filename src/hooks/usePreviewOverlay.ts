import { useEffect } from 'react';
import type { RefObject } from 'react';
import type { PageViewport } from 'pdfjs-dist';
import type { ContentEdit, RecognizedItem } from '../types/contentEdit';
import type { HeaderFooterSettings, PageNumberingConfig, TextBoxConfig } from '../types/pdfEdit';
import {
  drawContentEditsOverlay,
  drawHeaderFooterOverlay,
  drawPageNumberOverlay,
  drawRecognizedItemsOverlay,
  drawTextBoxesOverlay,
  type OverlayContext,
} from '../utils/overlayRenderer';

interface UsePreviewOverlayOptions {
  overlayCanvasRef: RefObject<HTMLCanvasElement | null>;
  pageSize: { width: number; height: number };
  scale: number;
  pageViewport: PageViewport | null;
  /** 表示中ページ番号（1始まり） */
  pageNumber: number;
  pageCount: number;
  fileName: string;
  contentEdits: ContentEdit[];
  /** 認識結果の枠を表示する場合だけ渡す */
  recognizedItems: RecognizedItem[] | null;
  selectedContentId: string | null;
  textBoxes: TextBoxConfig[];
  activeTextBoxId: string | null;
  headerFooter: HeaderFooterSettings;
  pageNumbering: PageNumberingConfig;
}

/** プレビューのオーバーレイキャンバスへ、未保存の編集内容を重ねて描く。 */
export function usePreviewOverlay({
  overlayCanvasRef,
  pageSize,
  scale,
  pageViewport,
  pageNumber,
  pageCount,
  fileName,
  contentEdits,
  recognizedItems,
  selectedContentId,
  textBoxes,
  activeTextBoxId,
  headerFooter,
  pageNumbering,
}: UsePreviewOverlayOptions) {
  useEffect(() => {
    const overlayCanvas = overlayCanvasRef.current;
    if (!overlayCanvas || pageSize.width === 0) return;

    const ctx = overlayCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    const overlay: OverlayContext = {
      ctx,
      scale,
      canvasWidth: overlayCanvas.width,
      canvasHeight: overlayCanvas.height,
      viewport: pageViewport,
    };

    // コンテンツ編集（カバー+再描画）は元ページ内容の変更を模すため最初に描く
    drawContentEditsOverlay(overlay, contentEdits);
    if (recognizedItems) {
      drawRecognizedItemsOverlay(overlay, recognizedItems, selectedContentId);
    }

    drawTextBoxesOverlay(overlay, textBoxes, pageNumber - 1, activeTextBoxId);
    drawHeaderFooterOverlay(overlay, headerFooter, pageNumber, pageCount, fileName);
    drawPageNumberOverlay(overlay, pageNumbering, pageNumber);
  }, [
    overlayCanvasRef,
    pageSize,
    scale,
    pageViewport,
    pageNumber,
    pageCount,
    fileName,
    contentEdits,
    recognizedItems,
    selectedContentId,
    textBoxes,
    activeTextBoxId,
    headerFooter,
    pageNumbering,
  ]);
}

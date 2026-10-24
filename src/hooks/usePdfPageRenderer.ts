import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { PageViewport, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import type { PagePlanEntry } from '../types/pdfEdit';

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

interface UsePdfPageRendererOptions {
  pdf: PDFDocumentProxy | null;
  /** 表示するページ構成エントリー（未指定なら描画しない） */
  entry: PagePlanEntry | undefined;
  scale: number;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  overlayCanvasRef: RefObject<HTMLCanvasElement | null>;
}

/**
 * ページ構成の1ページをキャンバスへ描画し、オーバーレイキャンバスの大きさを合わせる。
 * 空白ページは白で塗りつぶす。
 */
export function usePdfPageRenderer({ pdf, entry, scale, canvasRef, overlayCanvasRef }: UsePdfPageRendererOptions) {
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  // 表示中ページのviewport。ユーザー空間⇔キャンバス座標の変換に使う
  // （CropBox原点や回転を考慮するため、scaleによる単純な換算では不十分）。
  // 描画元の文書と組で持ち、別のPDFを開いたら描画が終わるまで前の文書のviewportを使わない。
  const [rendered, setRendered] = useState<{ pdf: PDFDocumentProxy; viewport: PageViewport } | null>(null);
  const pageViewport = rendered && rendered.pdf === pdf ? rendered.viewport : null;

  useEffect(() => {
    let cancelled = false;
    let renderTask: RenderTask | null = null;

    const renderPage = async () => {
      if (!pdf || !canvasRef.current || !entry) return;

      const canvas = canvasRef.current;
      const context = canvas.getContext('2d')!;
      if (entry.sourcePageIndex === null) {
        const baseWidth = entry.width ?? A4_WIDTH;
        const baseHeight = entry.height ?? A4_HEIGHT;
        const rotated = entry.rotation === 90 || entry.rotation === 270;
        const width = (rotated ? baseHeight : baseWidth) * scale;
        const height = (rotated ? baseWidth : baseHeight) * scale;
        canvas.width = width;
        canvas.height = height;
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, width, height);
        setPageSize({ width: rotated ? baseHeight : baseWidth, height: rotated ? baseWidth : baseHeight });
        setRendered(null);
        return;
      }

      const page = await pdf.getPage(entry.sourcePageIndex + 1);
      if (cancelled) return;
      const rotation = (page.rotate + entry.rotation) % 360;
      const viewport = page.getViewport({ scale, rotation });
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const originalViewport = page.getViewport({ scale: 1, rotation });
      setPageSize({ width: originalViewport.width, height: originalViewport.height });
      setRendered({ pdf, viewport });

      renderTask = page.render({
        canvasContext: context,
        viewport,
        canvas,
      });
      await renderTask.promise;
    };

    void renderPage().catch((error) => {
      if (cancelled || (error instanceof Error && error.name === 'RenderingCancelledException')) return;
      console.error(error);
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdf, entry, scale, canvasRef]);

  useEffect(() => {
    const base = canvasRef.current;
    const overlay = overlayCanvasRef.current;
    if (!base || !overlay) return;

    overlay.width = base.width;
    overlay.height = base.height;
  }, [pageSize, scale, canvasRef, overlayCanvasRef]);

  return { pageSize, pageViewport };
}

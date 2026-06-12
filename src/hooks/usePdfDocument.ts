import { useEffect, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const THUMBNAIL_SCALE = 0.3;

/**
 * PDFファイルの読み込み（pdf.jsドキュメント + 元バイト列）と
 * 全ページサムネイル生成を管理するフック。
 */
export function usePdfDocument(pdfFile: File | null) {
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [isGeneratingThumbnails, setIsGeneratingThumbnails] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadPdf = async () => {
      if (!pdfFile) {
        setPdf(null);
        setPdfBytes(null);
        setThumbnails([]);
        return;
      }

      setIsLoading(true);

      const arrayBuffer = await pdfFile.arrayBuffer();
      const bufferCopy = arrayBuffer.slice(0);
      const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

      if (cancelled) return;

      setPdfBytes(bufferCopy);
      setPdf(pdfDoc);
      setThumbnails([]);
      setIsLoading(false);
    };

    loadPdf();

    return () => {
      cancelled = true;
    };
  }, [pdfFile]);

  useEffect(() => {
    if (!pdf) return;

    let cancelled = false;

    const generateThumbnails = async () => {
      setIsGeneratingThumbnails(true);

      const nextThumbnails: string[] = [];
      for (let index = 0; index < pdf.numPages; index++) {
        const page = await pdf.getPage(index + 1);
        const viewport = page.getViewport({ scale: THUMBNAIL_SCALE });

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d')!;
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({
          canvasContext: context,
          viewport,
          canvas,
        }).promise;

        nextThumbnails.push(canvas.toDataURL('image/png'));
      }

      if (!cancelled) {
        setThumbnails(nextThumbnails);
        setIsGeneratingThumbnails(false);
      }
    };

    generateThumbnails();

    return () => {
      cancelled = true;
    };
  }, [pdf]);

  return { pdf, pdfBytes, isLoading, thumbnails, isGeneratingThumbnails };
}

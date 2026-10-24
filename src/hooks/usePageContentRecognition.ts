import { useEffect, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { RecognizedItem } from '../types/contentEdit';
import { recognizePageContent } from '../utils/contentRecognition';

/**
 * 元PDFのページ内容（テキスト・図形）を認識し、元ページ番号ごとにキャッシュする。
 * enabled の間だけ、表示中ページを未解析なら解析する。
 */
export function usePageContentRecognition(
  pdf: PDFDocumentProxy | null,
  sourcePageIndex: number,
  enabled: boolean,
) {
  const [recognizedByPage, setRecognizedByPage] = useState<Map<number, RecognizedItem[]>>(
    () => new Map(),
  );
  const [isRecognizing, setIsRecognizing] = useState(false);

  useEffect(() => {
    if (!enabled || !pdf || sourcePageIndex < 0) return;
    if (recognizedByPage.has(sourcePageIndex)) return;

    let cancelled = false;

    const recognize = async () => {
      setIsRecognizing(true);
      try {
        const page = await pdf.getPage(sourcePageIndex + 1);
        const items = await recognizePageContent(page);
        if (!cancelled) {
          setRecognizedByPage((prev) => new Map(prev).set(sourcePageIndex, items));
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setRecognizedByPage((prev) => new Map(prev).set(sourcePageIndex, []));
        }
      } finally {
        if (!cancelled) setIsRecognizing(false);
      }
    };

    void recognize();

    return () => {
      cancelled = true;
    };
  }, [enabled, pdf, sourcePageIndex, recognizedByPage]);

  return { recognizedByPage, setRecognizedByPage, isRecognizing };
}

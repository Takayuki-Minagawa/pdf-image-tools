import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument } from 'pdf-lib';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const THUMBNAIL_SCALE = 0.3;
const INITIAL_THUMBNAIL_COUNT = 12;

export type PdfLoadErrorCode =
  | 'password'
  | 'invalid'
  | 'missing'
  | 'memory'
  | 'unknown';

export interface PdfLoadIssue {
  code: PdfLoadErrorCode;
  message: string;
  action: string;
}

function classifyPdfError(error: unknown): PdfLoadIssue {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'PasswordException' || /password/i.test(message)) {
    return {
      code: 'password',
      message: 'このPDFはパスワードで保護されています。',
      action: 'パスワード保護を解除したPDFを選ぶか、対応するパスワードを確認してください。',
    };
  }
  if (name === 'InvalidPDFException' || /invalid|corrupt/i.test(message)) {
    return {
      code: 'invalid',
      message: 'PDFが破損しているか、対応していない形式です。',
      action: '別のPDFビューアーで開けるか確認し、再保存してからお試しください。',
    };
  }
  if (name === 'MissingPDFException') {
    return {
      code: 'missing',
      message: 'PDFデータを読み取れませんでした。',
      action: 'ファイルをもう一度選択してください。',
    };
  }
  if (/memory|allocation|Array buffer/i.test(message)) {
    return {
      code: 'memory',
      message: 'PDFを展開するためのメモリが不足しました。',
      action: '他のタブを閉じるか、ページ数の少ないPDFに分割してください。',
    };
  }
  return {
    code: 'unknown',
    message: 'PDFの読み込み中にエラーが発生しました。',
    action: '再試行するか、別のファイルを選択してください。',
  };
}

async function rasterizeUnlockedPdf(pdf: pdfjsLib.PDFDocumentProxy) {
  const output = await PDFDocument.create();
  for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex++) {
    const sourcePage = await pdf.getPage(pageIndex + 1);
    const pageSize = sourcePage.getViewport({ scale: 1 });
    const renderViewport = sourcePage.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    try {
      canvas.width = Math.ceil(renderViewport.width);
      canvas.height = Math.ceil(renderViewport.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvasを初期化できません');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await sourcePage.render({ canvas, canvasContext: context, viewport: renderViewport }).promise;
      const image = await output.embedJpg(canvas.toDataURL('image/jpeg', 0.92));
      const page = output.addPage([pageSize.width, pageSize.height]);
      page.drawImage(image, { x: 0, y: 0, width: pageSize.width, height: pageSize.height });
    } finally {
      canvas.width = 0;
      canvas.height = 0;
      sourcePage.cleanup();
    }
  }
  const bytes = await output.save();
  return new Uint8Array(bytes).slice().buffer;
}

/** PDFの読み込みと、必要になったページだけのサムネイル生成を管理する。 */
export function usePdfDocument(pdfFile: File | null) {
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
  const [loadedFile, setLoadedFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('PDFを読み込み中...');
  const [passwordRasterized, setPasswordRasterized] = useState(false);
  const [error, setError] = useState<PdfLoadIssue | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);
  const [passwordRequired, setPasswordRequired] = useState(false);
  const passwordSubmitRef = useRef<((password: string) => void) | null>(null);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const thumbnailsRef = useRef<string[]>([]);
  const [isGeneratingThumbnails, setIsGeneratingThumbnails] = useState(false);
  const [thumbnailProgress, setThumbnailProgress] = useState(0);
  const pendingThumbnailsRef = useRef(new Map<number, Promise<string | null>>());
  const generationRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let loadedPdf: pdfjsLib.PDFDocumentProxy | null = null;
    let loadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;
    const pendingThumbnails = pendingThumbnailsRef.current;

    const loadPdf = async () => {
      generationRef.current += 1;
      pendingThumbnails.clear();
      thumbnailsRef.current = [];
      setThumbnails([]);
      setThumbnailProgress(0);
      setError(null);
      setPasswordRequired(false);
      setPasswordRasterized(false);
      setLoadingMessage('PDFを読み込み中...');
      passwordSubmitRef.current = null;
      setPdf(null);
      setPdfBytes(null);
      setLoadedFile(null);

      if (!pdfFile) {
        setPdf(null);
        setPdfBytes(null);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      let wasPasswordProtected = false;
      try {
        const arrayBuffer = await pdfFile.arrayBuffer();
        const bufferCopy = arrayBuffer.slice(0);
        loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        loadingTask.onPassword = (updatePassword: (password: string) => void) => {
          if (cancelled) return;
          wasPasswordProtected = true;
          passwordSubmitRef.current = updatePassword;
          setPasswordRequired(true);
        };
        loadedPdf = await loadingTask.promise;
        if (cancelled) {
          return;
        }
        let editableBytes = bufferCopy;
        if (wasPasswordProtected) {
          setLoadingMessage('保護されたPDFを編集可能な画像PDFへ変換中...');
          editableBytes = await rasterizeUnlockedPdf(loadedPdf);
          setPasswordRasterized(true);
        }
        setPdfBytes(editableBytes);
        setPdf(loadedPdf);
        setLoadedFile(pdfFile);
        setPasswordRequired(false);
        passwordSubmitRef.current = null;
      } catch (loadError) {
        console.error(loadError);
        if (!cancelled) {
          setPdf(null);
          setPdfBytes(null);
          setLoadedFile(null);
          setError(classifyPdfError(loadError));
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void loadPdf();
    return () => {
      cancelled = true;
      generationRef.current += 1;
      pendingThumbnails.clear();
      passwordSubmitRef.current = null;
      if (loadingTask) void loadingTask.destroy();
    };
  }, [pdfFile, retryVersion]);

  const ensureThumbnail = useCallback((pageIndex: number) => {
    if (!pdf || pageIndex < 0 || pageIndex >= pdf.numPages) return Promise.resolve(null);
    if (thumbnailsRef.current[pageIndex]) {
      return Promise.resolve(thumbnailsRef.current[pageIndex]);
    }
    const pending = pendingThumbnailsRef.current.get(pageIndex);
    if (pending) return pending;

    const generation = generationRef.current;
    const task = (async () => {
      setIsGeneratingThumbnails(true);
      try {
        const page = await pdf.getPage(pageIndex + 1);
        const viewport = page.getViewport({ scale: THUMBNAIL_SCALE });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvasを初期化できません');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: context, viewport, canvas }).promise;
        if (generation !== generationRef.current) return null;
        const dataUrl = canvas.toDataURL('image/webp', 0.78);
        canvas.width = 0;
        canvas.height = 0;
        setThumbnails((current) => {
          const next = [...current];
          next[pageIndex] = dataUrl;
          thumbnailsRef.current = next;
          setThumbnailProgress((next.filter(Boolean).length / pdf.numPages) * 100);
          return next;
        });
        return dataUrl;
      } catch (thumbnailError) {
        if (generation === generationRef.current) console.error(thumbnailError);
        return null;
      } finally {
        pendingThumbnailsRef.current.delete(pageIndex);
        if (pendingThumbnailsRef.current.size === 0) setIsGeneratingThumbnails(false);
      }
    })();

    pendingThumbnailsRef.current.set(pageIndex, task);
    return task;
  }, [pdf]);

  // 最初の数ページだけ先読みし、それ以降はサムネイルカードが可視になった時に生成する。
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    const warmUp = async () => {
      for (let index = 0; index < Math.min(INITIAL_THUMBNAIL_COUNT, pdf.numPages); index++) {
        if (cancelled) return;
        await ensureThumbnail(index);
      }
    };
    void warmUp();
    return () => {
      cancelled = true;
    };
  }, [ensureThumbnail, pdf]);

  const cancelThumbnailGeneration = useCallback(() => {
    generationRef.current += 1;
    pendingThumbnailsRef.current.clear();
    setIsGeneratingThumbnails(false);
  }, []);

  const retry = useCallback(() => setRetryVersion((current) => current + 1), []);
  const submitPassword = useCallback((password: string) => {
    const submit = passwordSubmitRef.current;
    if (!submit) return false;
    setPasswordRequired(false);
    submit(password);
    return true;
  }, []);
  const estimatedMemoryBytes = pdfFile ? Math.max(pdfFile.size * 4, thumbnails.length * 120_000) : 0;

  return {
    pdf,
    pdfBytes,
    loadedFile,
    isLoading,
    loadingMessage,
    error,
    retry,
    passwordRequired,
    submitPassword,
    passwordRasterized,
    thumbnails,
    ensureThumbnail,
    isGeneratingThumbnails,
    thumbnailProgress,
    cancelThumbnailGeneration,
    estimatedMemoryBytes,
  };
}

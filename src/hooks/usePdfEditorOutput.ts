import { useCallback, useRef, useState } from 'react';
import type { PdfImageExportOptions } from '../types/pdfEdit';
import { pageRangeToIndices } from '../utils/arrayUtils';
import { isAbortError } from '../utils/async';
import { RedactionVerificationError } from '../utils/contentEditOperations';
import { sanitizeFilename } from '../utils/download';
import { formatBytes, getErrorMessage } from '../utils/format';
import { downloadImagesAsZip, imageExportFileName, resolveImageExportPageIndices } from '../utils/imageExport';
import { downloadPdf, extractPdfPageIndices } from '../utils/pdfEditor';
import { pdfBytesToImages, type ConvertedImage } from '../utils/pdfToImages';

type RedactionFailureOperation = 'save' | 'extract-range' | 'extract-selected' | 'export-images';

export interface RedactionFailureState {
  error: RedactionVerificationError;
  operation: RedactionFailureOperation;
}

interface UsePdfEditorOutputOptions {
  /** 現在の編集内容を適用したPDFを作る。allowCoverOnly で完全削除の検証失敗を許容する */
  buildEditedPdf: (allowCoverOnly?: boolean) => Promise<Uint8Array>;
  sourceFileName: string | undefined;
  outputName: string;
  pageCount: number;
  selectedPages: ReadonlySet<number>;
  extractStart: string;
  extractEnd: string;
  imageExportOptions: PdfImageExportOptions;
  hasRedactions: boolean;
  snapshotSignature: string;
  /** PDF保存のダウンロード直前に呼ぶ（下書きの削除など）。失敗すると保存を中止する */
  beforeSaveDownload: () => Promise<void>;
  /** PDF保存が完了した後に呼ぶ */
  onSaved: () => void;
  setOutputError: (message: string | null) => void;
  setOutputMessage: (message: string | null) => void;
}

/**
 * 編集済みPDFの保存・ページ抽出・画像出力と、完全削除の検証に失敗した場合の再試行を扱う。
 */
export function usePdfEditorOutput({
  buildEditedPdf,
  sourceFileName,
  outputName,
  pageCount,
  selectedPages,
  extractStart,
  extractEnd,
  imageExportOptions,
  hasRedactions,
  snapshotSignature,
  beforeSaveDownload,
  onSaved,
  setOutputError,
  setOutputMessage,
}: UsePdfEditorOutputOptions) {
  const [isSavingPdf, setIsSavingPdf] = useState(false);
  const [isExportingImages, setIsExportingImages] = useState(false);
  const [imageProgress, setImageProgress] = useState(0);
  const [images, setImages] = useState<ConvertedImage[]>([]);
  const [redactionFailure, setRedactionFailure] = useState<RedactionFailureState | null>(null);
  // 完全削除を検証した編集内容の署名と日時。編集内容が変われば未検証として扱う。
  const [redactionVerification, setRedactionVerification] = useState<{ signature: string; at: number } | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);

  const redactionVerifiedAt = hasRedactions && redactionVerification?.signature === snapshotSignature
    ? redactionVerification.at
    : null;

  const clearImages = useCallback(() => setImages([]), []);

  const resetOutput = useCallback(() => {
    setImages([]);
    setImageProgress(0);
  }, []);

  const reportFailure = (
    error: unknown,
    operation: RedactionFailureOperation,
    describe: (error: unknown) => string,
  ) => {
    console.error(error);
    if (error instanceof RedactionVerificationError) {
      setRedactionFailure({ error, operation });
    } else {
      setOutputError(describe(error));
    }
  };

  const extractRange = async (allowCoverOnly = false) => {
    if (!sourceFileName) return;

    const start = parseInt(extractStart, 10);
    const end = parseInt(extractEnd, 10);

    if (
      Number.isNaN(start) ||
      Number.isNaN(end) ||
      start < 1 ||
      end > pageCount ||
      start > end
    ) {
      alert(`有効なページ範囲を指定してください (1〜${pageCount})`);
      return;
    }

    try {
      const editedPdf = await buildEditedPdf(allowCoverOnly);
      const extractedPdf = await extractPdfPageIndices(editedPdf, pageRangeToIndices(start, end));
      downloadPdf(extractedPdf, `${sourceFileName.replace('.pdf', '')}_pages_${start}-${end}.pdf`);
      setRedactionFailure(null);
    } catch (err) {
      reportFailure(err, 'extract-range', (error) => '抽出中にエラーが発生しました: ' + getErrorMessage(error));
    }
  };

  const extractSelected = async (allowCoverOnly = false) => {
    if (selectedPages.size === 0) return;
    setOutputError(null);
    try {
      const editedPdf = await buildEditedPdf(allowCoverOnly);
      const pageIndices = [...selectedPages].sort((a, b) => a - b);
      const extractedPdf = await extractPdfPageIndices(editedPdf, pageIndices);
      downloadPdf(extractedPdf, `${sanitizeFilename(outputName, 'selected-pages')}_selected.pdf`);
      setRedactionFailure(null);
      setOutputMessage(`${pageIndices.length}ページを抽出しました`);
    } catch (error) {
      reportFailure(error, 'extract-selected', (reason) => getErrorMessage(reason, '選択ページを抽出できませんでした'));
    }
  };

  const savePdf = async (allowCoverOnly = false) => {
    if (!sourceFileName) return;

    setIsSavingPdf(true);
    setOutputError(null);
    setOutputMessage(null);

    try {
      const result = await buildEditedPdf(allowCoverOnly);
      const filename = `${sanitizeFilename(outputName, 'edited')}.pdf`;
      await beforeSaveDownload();
      downloadPdf(result, filename);
      onSaved();
      setRedactionFailure(null);
      setRedactionVerification(hasRedactions && !allowCoverOnly
        ? { signature: snapshotSignature, at: Date.now() }
        : null);
      setOutputMessage(`${filename}（${formatBytes(result.byteLength)}）を保存しました`);
    } catch (err) {
      reportFailure(err, 'save', (error) => 'PDF保存中にエラーが発生しました: ' + getErrorMessage(error));
    } finally {
      setIsSavingPdf(false);
    }
  };

  const exportImages = async (allowCoverOnly = false) => {
    if (!sourceFileName) return;

    setIsExportingImages(true);
    setOutputError(null);
    setOutputMessage(null);
    setImageProgress(0);
    setImages([]);
    const controller = new AbortController();
    exportAbortRef.current = controller;

    try {
      const result = await buildEditedPdf(allowCoverOnly);
      const pageIndices = resolveImageExportPageIndices(imageExportOptions, selectedPages, pageCount);
      const converted = await pdfBytesToImages(result, {
        scale: imageExportOptions.scale,
        format: imageExportOptions.format,
        quality: imageExportOptions.quality,
        pageIndices,
        onProgress: setImageProgress,
        signal: controller.signal,
      });
      setImages(converted);
      setRedactionFailure(null);
      if (imageExportOptions.zip && converted.length > 1) {
        await downloadImagesAsZip(converted, imageExportOptions);
        setOutputMessage(`${converted.length}ページをZIPで保存しました`);
      } else {
        setOutputMessage(`${converted.length}ページの画像を生成しました`);
      }
    } catch (err) {
      if (isAbortError(err)) {
        setOutputMessage('画像出力をキャンセルしました');
      } else {
        reportFailure(err, 'export-images', (error) => '画像出力中にエラーが発生しました: ' + getErrorMessage(error));
      }
    } finally {
      setIsExportingImages(false);
      exportAbortRef.current = null;
    }
  };

  const cancelImageExport = () => exportAbortRef.current?.abort();

  /** 完全削除の検証に失敗した操作を、カバーのみ（文字データが残る）で再実行する。 */
  const retryWithCoverOnly = async () => {
    if (!redactionFailure) return;
    switch (redactionFailure.operation) {
      case 'extract-range':
        await extractRange(true);
        break;
      case 'extract-selected':
        await extractSelected(true);
        break;
      case 'export-images':
        await exportImages(true);
        break;
      default:
        await savePdf(true);
    }
  };

  const downloadImage = useCallback(
    (image: ConvertedImage) => {
      const link = document.createElement('a');
      link.href = image.dataUrl;
      link.download = imageExportFileName(imageExportOptions, image.pageNumber);
      link.click();
    },
    [imageExportOptions],
  );

  const downloadAllImages = useCallback(async () => {
    if (images.length === 1 && !imageExportOptions.zip) {
      downloadImage(images[0]);
      return;
    }
    await downloadImagesAsZip(images, imageExportOptions);
  }, [downloadImage, imageExportOptions, images]);

  return {
    isSavingPdf,
    isExportingImages,
    imageProgress,
    images,
    clearImages,
    resetOutput,
    redactionFailure,
    dismissRedactionFailure: () => setRedactionFailure(null),
    redactionVerifiedAt,
    extractRange,
    extractSelected,
    savePdf,
    exportImages,
    cancelImageExport,
    retryWithCoverOnly,
    downloadImage,
    downloadAllImages,
  };
}

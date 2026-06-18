import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  RotateCcw,
  FileUp,
} from 'lucide-react';
import { Dropzone } from './Dropzone';
import { ImagePreview } from './ImagePreview';
import { ProgressBar } from './ProgressBar';
import { PageManagementPanel } from './pdfEdit/PageManagementPanel';
import { PdfEditorSidebar, type EditorSubTab } from './pdfEdit/PdfEditorSidebar';
import { PdfEditorPreview } from './pdfEdit/PdfEditorPreview';
import { applyPdfEdits } from '../utils/pdfEditOperations';
import { reorderPdfPages, extractPdfPages, downloadPdf } from '../utils/pdfEditor';
import { pdfBytesToImages } from '../utils/pdfToImages';
import { usePdfDocument } from '../hooks/usePdfDocument';
import { remapTextBoxesForPageOrder, isIdentityPageOrder } from '../utils/pageOrderUtils';
import {
  drawTextBoxesOverlay,
  drawHeaderFooterOverlay,
  drawPageNumberOverlay,
  drawRecognizedItemsOverlay,
  drawContentEditsOverlay,
  type OverlayContext,
} from '../utils/overlayRenderer';
import { recognizePageContent, hitTestRecognizedItems } from '../utils/contentRecognition';
import { applyContentEdits } from '../utils/contentEditOperations';
import type { ConvertedImage } from '../utils/pdfToImages';
import type { TextBoxConfig, HeaderFooterSettings, PageNumberingConfig } from '../types/pdfEdit';
import { DEFAULT_HEADER_FOOTER, DEFAULT_PAGE_NUMBERING } from '../types/pdfEdit';
import type { ContentEdit, RecognizedItem } from '../types/contentEdit';
import type { PageViewport } from 'pdfjs-dist';

export default function PdfEditor() {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const { pdf, pdfBytes, isLoading, thumbnails, isGeneratingThumbnails } =
    usePdfDocument(pdfFile);
  const originalTotalPages = pdf?.numPages ?? 0;

  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  // 表示中ページのviewport。ユーザー空間⇔キャンバス座標の変換に使う
  // （CropBox原点や回転を考慮するため、scaleによる単純な換算では不十分）。
  const [pageViewport, setPageViewport] = useState<PageViewport | null>(null);
  const [pageInputValue, setPageInputValue] = useState('1');

  const [activeSubTab, setActiveSubTab] = useState<EditorSubTab>('page-number');
  const [textBoxes, setTextBoxes] = useState<TextBoxConfig[]>([]);
  const [headerFooter, setHeaderFooter] = useState<HeaderFooterSettings>(DEFAULT_HEADER_FOOTER);
  const [pageNumbering, setPageNumbering] = useState<PageNumberingConfig>(DEFAULT_PAGE_NUMBERING);
  const [activeTextBoxId, setActiveTextBoxId] = useState<string | null>(null);

  const [contentEdits, setContentEdits] = useState<ContentEdit[]>([]);
  const [recognizedByPage, setRecognizedByPage] = useState<Map<number, RecognizedItem[]>>(
    new Map(),
  );
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [selectedContentId, setSelectedContentId] = useState<string | null>(null);

  const [pageOrder, setPageOrder] = useState<number[]>([]);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const draggedIndexRef = useRef<number | null>(null);
  const pageOrderRef = useRef<number[]>([]);
  const [extractStart, setExtractStart] = useState('');
  const [extractEnd, setExtractEnd] = useState('');

  const [isSavingPdf, setIsSavingPdf] = useState(false);
  const [isExportingPng, setIsExportingPng] = useState(false);
  const [pngProgress, setPngProgress] = useState(0);
  const [pngImages, setPngImages] = useState<ConvertedImage[]>([]);
  const [outputError, setOutputError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const displayPageCount = pageOrder.length;
  const currentOriginalPageIndex = pageOrder[currentPage - 1] ?? -1;
  const currentPageItems =
    currentOriginalPageIndex >= 0
      ? (recognizedByPage.get(currentOriginalPageIndex) ?? null)
      : null;
  const selectedContentItem = selectedContentId
    ? (currentPageItems?.find((item) => item.id === selectedContentId) ?? null)
    : null;
  const currentPageContentEdits = useMemo(
    () => contentEdits.filter((edit) => edit.target.pageIndex === currentOriginalPageIndex),
    [contentEdits, currentOriginalPageIndex],
  );
  const hasPageChanges =
    pageOrder.length > 0 &&
    (pageOrder.length !== originalTotalPages || !isIdentityPageOrder(pageOrder));
  const hasOverlayEdits =
    textBoxes.length > 0 ||
    headerFooter.header.enabled ||
    headerFooter.footer.enabled ||
    pageNumbering.enabled;

  useEffect(() => {
    pageOrderRef.current = pageOrder;
  }, [pageOrder]);

  useEffect(() => {
    if (!pdf) {
      setPageOrder([]);
      return;
    }

    setPageOrder(Array.from({ length: pdf.numPages }, (_, index) => index));
    setSelectedPages(new Set());
    setCurrentPage(1);
    setPageInputValue('1');
    setExtractStart('');
    setExtractEnd('');
    setContentEdits([]);
    setRecognizedByPage(new Map());
    setSelectedContentId(null);
    setPageViewport(null);
  }, [pdf]);

  // コンテンツ編集タブで表示中のページを解析する（ページ単位でキャッシュ）
  useEffect(() => {
    if (activeSubTab !== 'content' || !pdf || currentOriginalPageIndex < 0) return;
    if (recognizedByPage.has(currentOriginalPageIndex)) return;

    let cancelled = false;

    const recognize = async () => {
      setIsRecognizing(true);
      try {
        const page = await pdf.getPage(currentOriginalPageIndex + 1);
        const items = await recognizePageContent(page);
        if (!cancelled) {
          setRecognizedByPage((prev) => new Map(prev).set(currentOriginalPageIndex, items));
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setRecognizedByPage((prev) => new Map(prev).set(currentOriginalPageIndex, []));
        }
      } finally {
        if (!cancelled) setIsRecognizing(false);
      }
    };

    recognize();

    return () => {
      cancelled = true;
    };
  }, [activeSubTab, pdf, currentOriginalPageIndex, recognizedByPage]);

  useEffect(() => {
    const renderPage = async () => {
      if (!pdf || !canvasRef.current || displayPageCount === 0) return;

      const pageIndex = pageOrder[currentPage - 1];
      if (pageIndex === undefined) return;

      const page = await pdf.getPage(pageIndex + 1);
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d')!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const originalViewport = page.getViewport({ scale: 1 });
      setPageSize({ width: originalViewport.width, height: originalViewport.height });
      setPageViewport(viewport);

      await page.render({
        canvasContext: context,
        viewport,
        canvas,
      }).promise;
    };

    renderPage();
  }, [pdf, currentPage, scale, pageOrder, displayPageCount]);

  useEffect(() => {
    const base = canvasRef.current;
    const overlay = overlayCanvasRef.current;
    if (!base || !overlay) return;

    overlay.width = base.width;
    overlay.height = base.height;
  }, [pageSize, scale]);

  const drawOverlay = useCallback(() => {
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
    drawContentEditsOverlay(overlay, currentPageContentEdits);
    if (activeSubTab === 'content' && currentPageItems) {
      drawRecognizedItemsOverlay(overlay, currentPageItems, selectedContentId);
    }

    drawTextBoxesOverlay(overlay, textBoxes, currentPage - 1, activeTextBoxId);
    drawHeaderFooterOverlay(
      overlay,
      headerFooter,
      currentPage,
      displayPageCount,
      pdfFile?.name || '',
    );
    drawPageNumberOverlay(overlay, pageNumbering, currentPage);
  }, [
    textBoxes,
    headerFooter,
    pageNumbering,
    currentPage,
    displayPageCount,
    scale,
    pageSize,
    pageViewport,
    pdfFile,
    activeTextBoxId,
    activeSubTab,
    currentPageItems,
    currentPageContentEdits,
    selectedContentId,
  ]);

  useEffect(() => {
    drawOverlay();
  }, [drawOverlay]);

  useEffect(() => {
    setPageInputValue(String(currentPage));
  }, [currentPage]);

  useEffect(() => {
    if (displayPageCount === 0) return;

    if (currentPage > displayPageCount) {
      setCurrentPage(displayPageCount);
    }
  }, [currentPage, displayPageCount]);

  useEffect(() => {
    if (displayPageCount === 0) return;

    setPageNumbering((prev) =>
      prev.startPage > displayPageCount ? { ...prev, startPage: displayPageCount } : prev,
    );
  }, [displayPageCount]);

  const handlePageInputCommit = () => {
    const page = parseInt(pageInputValue, 10);
    if (!Number.isNaN(page) && page >= 1 && page <= displayPageCount) {
      setCurrentPage(page);
    } else {
      setPageInputValue(String(currentPage));
    }
  };

  const handlePageInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
      handlePageInputCommit();
    }
  };

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;

      if (activeSubTab === 'content') {
        if (!currentPageItems || !pageViewport) return;

        // キャンバス座標 → PDFユーザー空間（CropBox原点・回転を含めてviewportで逆変換）
        const [pageX, pageY] = pageViewport.convertToPdfPoint(canvasX, canvasY);
        const hit = hitTestRecognizedItems(currentPageItems, { x: pageX, y: pageY });
        setSelectedContentId(hit?.id ?? null);
        return;
      }

      if (!activeTextBoxId || activeSubTab !== 'textbox') return;

      const pdfX = Math.round(canvasX / scale);
      const pdfY = Math.round(canvasY / scale);

      setTextBoxes((prev) =>
        prev.map((box) => (box.id === activeTextBoxId ? { ...box, x: pdfX, y: pdfY } : box)),
      );
    },
    [activeTextBoxId, activeSubTab, scale, currentPageItems, pageViewport],
  );

  const handleFileDrop = (files: File[]) => {
    const nextPdfFile = files.find((file) => file.type === 'application/pdf');
    if (!nextPdfFile) return;

    setPdfFile(nextPdfFile);
    setTextBoxes([]);
    setHeaderFooter(DEFAULT_HEADER_FOOTER);
    setPageNumbering(DEFAULT_PAGE_NUMBERING);
    setActiveTextBoxId(null);
    setContentEdits([]);
    setRecognizedByPage(new Map());
    setSelectedContentId(null);
    setPngImages([]);
    setOutputError(null);
    setPngProgress(0);
  };

  const handleReset = () => {
    setPdfFile(null);
    setCurrentPage(1);
    setPageInputValue('1');
    setPageOrder([]);
    setSelectedPages(new Set());
    setDraggedIndex(null);
    draggedIndexRef.current = null;
    setExtractStart('');
    setExtractEnd('');
    setTextBoxes([]);
    setHeaderFooter(DEFAULT_HEADER_FOOTER);
    setPageNumbering(DEFAULT_PAGE_NUMBERING);
    setActiveTextBoxId(null);
    setContentEdits([]);
    setRecognizedByPage(new Map());
    setSelectedContentId(null);
    setPngImages([]);
    setOutputError(null);
    setPngProgress(0);
  };

  const upsertContentEdit = useCallback((edit: ContentEdit) => {
    setContentEdits((prev) => {
      const index = prev.findIndex((e) => e.target.id === edit.target.id);
      if (index === -1) return [...prev, edit];
      const next = [...prev];
      next[index] = edit;
      return next;
    });
  }, []);

  const removeContentEdit = useCallback((targetId: string) => {
    setContentEdits((prev) => prev.filter((edit) => edit.target.id !== targetId));
  }, []);

  const updatePageOrder = useCallback(
    (nextOrder: number[]) => {
      const prevOrder = pageOrderRef.current;
      pageOrderRef.current = nextOrder;
      setPageOrder(nextOrder);
      setSelectedPages((prevSelectedPages) => {
        const nextSelectedPages = new Set<number>();

        prevSelectedPages.forEach((displayIndex) => {
          const originalPageIndex = prevOrder[displayIndex];
          const nextDisplayIndex = nextOrder.indexOf(originalPageIndex);
          if (nextDisplayIndex !== -1) nextSelectedPages.add(nextDisplayIndex);
        });

        return nextSelectedPages;
      });
      setTextBoxes((prevTextBoxes) => {
        const nextTextBoxes = remapTextBoxesForPageOrder(prevTextBoxes, prevOrder, nextOrder);

        if (activeTextBoxId && !nextTextBoxes.some((box) => box.id === activeTextBoxId)) {
          setActiveTextBoxId(null);
        }

        return nextTextBoxes;
      });
    },
    [activeTextBoxId],
  );

  const togglePageSelection = (displayIndex: number) => {
    const nextSelected = new Set(selectedPages);
    if (nextSelected.has(displayIndex)) nextSelected.delete(displayIndex);
    else nextSelected.add(displayIndex);
    setSelectedPages(nextSelected);
  };

  const toggleSelectAll = () => {
    if (selectedPages.size === displayPageCount) {
      setSelectedPages(new Set());
    } else {
      setSelectedPages(new Set(pageOrder.map((_, index) => index)));
    }
  };

  const deleteSelectedPages = () => {
    if (selectedPages.size === 0) return;
    if (selectedPages.size === displayPageCount) {
      alert('すべてのページを削除することはできません');
      return;
    }

    const nextOrder = pageOrder.filter((_, index) => !selectedPages.has(index));
    updatePageOrder(nextOrder);
    setSelectedPages(new Set());
    setPngImages([]);
    setOutputError(null);

    if (currentPage > nextOrder.length) {
      setCurrentPage(nextOrder.length);
    }
  };

  const resetPageChanges = () => {
    const identityOrder = Array.from({ length: originalTotalPages }, (_, index) => index);
    updatePageOrder(identityOrder);
    setSelectedPages(new Set());
    setCurrentPage(1);
    setExtractStart('');
    setExtractEnd('');
    setPngImages([]);
    setOutputError(null);
  };

  const handleDragStart = (displayIndex: number) => {
    draggedIndexRef.current = displayIndex;
    setDraggedIndex(displayIndex);
  };

  const handleDragOver = (e: React.DragEvent, displayIndex: number) => {
    e.preventDefault();
    const fromIndex = draggedIndexRef.current;
    if (fromIndex === null || fromIndex === displayIndex) return;

    const nextOrder = [...pageOrderRef.current];
    const [draggedPage] = nextOrder.splice(fromIndex, 1);
    nextOrder.splice(displayIndex, 0, draggedPage);
    updatePageOrder(nextOrder);
    draggedIndexRef.current = displayIndex;
    setDraggedIndex(displayIndex);
    setPngImages([]);
    setOutputError(null);
  };

  const handleDragEnd = () => {
    draggedIndexRef.current = null;
    setDraggedIndex(null);
  };

  const buildEditedPdf = useCallback(async () => {
    if (!pdfBytes || !pdfFile) {
      throw new Error('PDFが読み込まれていません');
    }

    let workingPdf: ArrayBuffer | Uint8Array = pdfBytes;

    // コンテンツ編集は元PDFのページインデックス基準なので、並び替えより先に適用する
    if (contentEdits.length > 0) {
      workingPdf = await applyContentEdits(workingPdf, contentEdits, (unmatched) => {
        const names = unmatched.map((t) => `「${t.text}」`).join('、');
        alert(
          `次のテキストはデータからの完全削除ができませんでした（カバーのみ適用、テキスト抽出で読める可能性があります）:\n${names}`,
        );
      });
    }

    if (hasPageChanges) {
      workingPdf = await reorderPdfPages(workingPdf, pageOrder);
    }

    if (hasOverlayEdits) {
      return applyPdfEdits(
        workingPdf,
        { textBoxes, headerFooter, pageNumbering },
        pdfFile.name,
      );
    }

    return workingPdf instanceof Uint8Array ? workingPdf : new Uint8Array(workingPdf);
  }, [
    pdfBytes,
    pdfFile,
    hasOverlayEdits,
    hasPageChanges,
    pageOrder,
    textBoxes,
    headerFooter,
    pageNumbering,
    contentEdits,
  ]);

  const handleExtract = async () => {
    if (!pdfFile) return;

    const start = parseInt(extractStart, 10);
    const end = parseInt(extractEnd, 10);

    if (
      Number.isNaN(start) ||
      Number.isNaN(end) ||
      start < 1 ||
      end > displayPageCount ||
      start > end
    ) {
      alert(`有効なページ範囲を指定してください (1〜${displayPageCount})`);
      return;
    }

    try {
      const editedPdf = await buildEditedPdf();
      const extractedPdf = await extractPdfPages(editedPdf, start - 1, end - 1);
      downloadPdf(extractedPdf, `${pdfFile.name.replace('.pdf', '')}_pages_${start}-${end}.pdf`);
    } catch (err) {
      console.error(err);
      alert('抽出中にエラーが発生しました: ' + (err instanceof Error ? err.message : '不明なエラー'));
    }
  };

  const handleSavePdf = async () => {
    if (!pdfFile) return;

    setIsSavingPdf(true);
    setOutputError(null);

    try {
      const result = await buildEditedPdf();
      downloadPdf(result, `${pdfFile.name.replace('.pdf', '')}_edited.pdf`);
    } catch (err) {
      console.error(err);
      setOutputError('PDF保存中にエラーが発生しました');
    } finally {
      setIsSavingPdf(false);
    }
  };

  const handleExportPng = async () => {
    if (!pdfFile) return;

    setIsExportingPng(true);
    setOutputError(null);
    setPngProgress(0);
    setPngImages([]);

    try {
      const result = await buildEditedPdf();
      const images = await pdfBytesToImages(result, 2, setPngProgress);
      setPngImages(images);
    } catch (err) {
      console.error(err);
      setOutputError('PNG出力中にエラーが発生しました');
    } finally {
      setIsExportingPng(false);
    }
  };

  const handleDownloadPng = useCallback(
    (image: ConvertedImage) => {
      if (!pdfFile) return;

      const link = document.createElement('a');
      link.href = image.dataUrl;
      link.download = `${pdfFile.name.replace('.pdf', '')}_edited_page_${image.pageNumber}.png`;
      link.click();
    },
    [pdfFile],
  );

  const handleDownloadAllPng = useCallback(() => {
    pngImages.forEach((image) => {
      handleDownloadPng(image);
    });
  }, [pngImages, handleDownloadPng]);

  if (!pdfFile) {
    return (
      <Dropzone
        accept={['.pdf']}
        onDrop={handleFileDrop}
        title="PDFファイルをドロップ"
        description="または クリックしてファイルを選択"
      />
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center rounded-lg bg-gray-100">
        <div className="text-gray-500">PDFを読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 p-3">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <FileUp className="h-5 w-5 shrink-0 text-amber-600" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-700">{pdfFile.name}</p>
              <p className="text-xs text-gray-500">
                {displayPageCount} ページ表示中 / 元ファイル {originalTotalPages} ページ
              </p>
            </div>
          </div>
        </div>
        <button
          onClick={handleReset}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-amber-100 hover:text-gray-800"
        >
          <RotateCcw className="h-4 w-4" />
          ファイルを変更
        </button>
      </div>

      <PageManagementPanel
        displayPageCount={displayPageCount}
        selectedPages={selectedPages}
        hasPageChanges={hasPageChanges}
        extractStart={extractStart}
        extractEnd={extractEnd}
        isGeneratingThumbnails={isGeneratingThumbnails}
        pageOrder={pageOrder}
        thumbnails={thumbnails}
        draggedIndex={draggedIndex}
        onToggleSelectAll={toggleSelectAll}
        onDeleteSelectedPages={deleteSelectedPages}
        onResetPageChanges={resetPageChanges}
        onExtractStartChange={setExtractStart}
        onExtractEndChange={setExtractEnd}
        onExtract={handleExtract}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onTogglePageSelection={togglePageSelection}
      />

      <div className="flex flex-col gap-4 lg:flex-row">
        <PdfEditorSidebar
          activeSubTab={activeSubTab}
          onActiveSubTabChange={setActiveSubTab}
          textBoxes={textBoxes}
          onTextBoxesChange={setTextBoxes}
          totalPages={displayPageCount}
          activeTextBoxId={activeTextBoxId}
          onActiveTextBoxChange={setActiveTextBoxId}
          headerFooter={headerFooter}
          onHeaderFooterChange={setHeaderFooter}
          pageNumbering={pageNumbering}
          onPageNumberingChange={setPageNumbering}
          isRecognizing={isRecognizing}
          hasRecognized={currentPageItems !== null}
          recognizedItems={currentPageItems ?? []}
          selectedContentItem={selectedContentItem}
          contentEdits={contentEdits}
          onUpsertContentEdit={upsertContentEdit}
          onRemoveContentEdit={removeContentEdit}
          onSelectContentItem={setSelectedContentId}
          onSavePdf={handleSavePdf}
          onExportPng={handleExportPng}
          isSavingPdf={isSavingPdf}
          isExportingPng={isExportingPng}
        />

        <PdfEditorPreview
          currentPage={currentPage}
          displayPageCount={displayPageCount}
          pageInputValue={pageInputValue}
          onPageInputValueChange={setPageInputValue}
          onPageInputCommit={handlePageInputCommit}
          onPageInputKeyDown={handlePageInputKeyDown}
          onPrevPage={() => setCurrentPage((page) => Math.max(1, page - 1))}
          onNextPage={() => setCurrentPage((page) => Math.min(displayPageCount, page + 1))}
          scale={scale}
          onZoomOut={() => setScale((value) => Math.max(0.25, value - 0.25))}
          onZoomIn={() => setScale((value) => Math.min(3, value + 0.25))}
          onScaleChange={setScale}
          containerRef={containerRef}
          canvasRef={canvasRef}
          overlayCanvasRef={overlayCanvasRef}
          onCanvasClick={handleCanvasClick}
          isTextPlacementActive={Boolean(activeTextBoxId && activeSubTab === 'textbox')}
          isContentSelectionActive={activeSubTab === 'content'}
          pageSize={pageSize}
        />
      </div>

      {outputError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-600">
          {outputError}
        </div>
      )}

      {isExportingPng && <ProgressBar progress={pngProgress} label="編集結果をPNGに変換中..." />}

      <ImagePreview
        images={pngImages}
        onDownload={handleDownloadPng}
        onDownloadAll={handleDownloadAllPng}
        onClear={() => setPngImages([])}
      />
    </div>
  );
}

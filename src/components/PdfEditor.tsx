import { useState, useRef, useEffect, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
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
import { applyPdfEdits, wrapTextByWidth } from '../utils/pdfEditOperations';
import { resolvePlaceholders, formatPageNumber } from '../utils/pdfEditOperations';
import { reorderPdfPages, extractPdfPages, downloadPdf } from '../utils/pdfEditor';
import { pdfBytesToImages } from '../utils/pdfToImages';
import type { ConvertedImage } from '../utils/pdfToImages';
import type { TextBoxConfig, HeaderFooterSettings, PageNumberingConfig } from '../types/pdfEdit';
import { DEFAULT_HEADER_FOOTER, DEFAULT_PAGE_NUMBERING } from '../types/pdfEdit';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

type ThumbnailDataUrls = string[];

function remapTextBoxesForPageOrder(
  textBoxes: TextBoxConfig[],
  prevOrder: number[],
  nextOrder: number[],
) {
  return textBoxes.flatMap((box) => {
    if (box.pageIndex === -1) return [box];

    const originalPageIndex = prevOrder[box.pageIndex];
    if (originalPageIndex === undefined) return [];

    const nextDisplayIndex = nextOrder.indexOf(originalPageIndex);
    if (nextDisplayIndex === -1) return [];

    return [{ ...box, pageIndex: nextDisplayIndex }];
  });
}

function isIdentityPageOrder(pageOrder: number[]) {
  return pageOrder.every((pageIndex, index) => pageIndex === index);
}

export default function PdfEditor() {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [originalTotalPages, setOriginalTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingThumbnails, setIsGeneratingThumbnails] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [pageInputValue, setPageInputValue] = useState('1');

  const [activeSubTab, setActiveSubTab] = useState<EditorSubTab>('page-number');
  const [textBoxes, setTextBoxes] = useState<TextBoxConfig[]>([]);
  const [headerFooter, setHeaderFooter] = useState<HeaderFooterSettings>(DEFAULT_HEADER_FOOTER);
  const [pageNumbering, setPageNumbering] = useState<PageNumberingConfig>(DEFAULT_PAGE_NUMBERING);
  const [activeTextBoxId, setActiveTextBoxId] = useState<string | null>(null);

  const [thumbnails, setThumbnails] = useState<ThumbnailDataUrls>([]);
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
    if (!pdfFile) return;

    const loadPdf = async () => {
      setIsLoading(true);
      setOutputError(null);
      setPngImages([]);
      setPngProgress(0);

      const arrayBuffer = await pdfFile.arrayBuffer();
      const bufferCopy = arrayBuffer.slice(0);
      const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const order = Array.from({ length: pdfDoc.numPages }, (_, index) => index);

      setPdfBytes(bufferCopy);
      setPdf(pdfDoc);
      setOriginalTotalPages(pdfDoc.numPages);
      setPageOrder(order);
      setThumbnails([]);
      setSelectedPages(new Set());
      setCurrentPage(1);
      setPageInputValue('1');
      setExtractStart('');
      setExtractEnd('');
      setIsLoading(false);
    };

    loadPdf();
  }, [pdfFile]);

  useEffect(() => {
    if (!pdf) return;

    let cancelled = false;

    const generateThumbnails = async () => {
      setIsGeneratingThumbnails(true);

      const nextThumbnails: ThumbnailDataUrls = [];
      for (let index = 0; index < pdf.numPages; index++) {
        const page = await pdf.getPage(index + 1);
        const viewport = page.getViewport({ scale: 0.3 });

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
    const overlay = overlayCanvasRef.current;
    if (!overlay || pageSize.width === 0) return;

    const ctx = overlay.getContext('2d')!;
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    for (const box of textBoxes) {
      if (box.pageIndex !== -1 && box.pageIndex !== currentPage - 1) continue;

      const x = box.x * scale;
      const y = box.y * scale;
      const width = box.width * scale;
      const height = box.height * scale;

      if (box.backgroundColor !== 'transparent' && box.backgroundColor !== '') {
        ctx.fillStyle = box.backgroundColor;
        ctx.globalAlpha = 0.8;
        ctx.fillRect(x, y, width, height);
        ctx.globalAlpha = 1;
      }

      if (box.borderStyle !== 'none' && box.borderWidth > 0) {
        ctx.strokeStyle = box.borderColor;
        ctx.lineWidth = box.borderWidth * scale;
        if (box.borderStyle === 'dashed') ctx.setLineDash([5 * scale, 5 * scale]);
        else if (box.borderStyle === 'dotted') ctx.setLineDash([2 * scale, 2 * scale]);
        else ctx.setLineDash([]);
        ctx.strokeRect(x, y, width, height);
        ctx.setLineDash([]);
      }

      if (box.id === activeTextBoxId) {
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(x - 2, y - 2, width + 4, height + 4);
        ctx.setLineDash([]);
      }

      if (box.text) {
        ctx.fillStyle = box.fontColor;
        ctx.font = `${box.fontSize * scale}px sans-serif`;
        ctx.textBaseline = 'top';
        const padding = 4 * scale;
        const maxTextWidth = width - padding * 2;
        const lines = wrapTextByWidth(
          box.text,
          (text) => ctx.measureText(text).width,
          maxTextWidth,
        );
        const lineHeight = box.fontSize * 1.3 * scale;

        for (let index = 0; index < lines.length; index++) {
          const textY = y + padding + index * lineHeight;
          if (textY + lineHeight > y + height) break;
          ctx.fillText(lines[index], x + padding, textY);
        }
      }
    }

    const canvasWidth = overlay.width;
    const canvasHeight = overlay.height;
    const fileName = pdfFile?.name || '';

    if (headerFooter.header.enabled) {
      const header = headerFooter.header;
      const y = header.margin * scale;
      ctx.fillStyle = header.fontColor;
      ctx.font = `${header.fontSize * scale}px sans-serif`;
      ctx.textBaseline = 'top';

      const resolve = (text: string) =>
        resolvePlaceholders(text, currentPage, displayPageCount, fileName);

      if (header.left) {
        ctx.textAlign = 'left';
        ctx.fillText(resolve(header.left), header.marginHorizontal * scale, y);
      }
      if (header.center) {
        ctx.textAlign = 'center';
        ctx.fillText(resolve(header.center), canvasWidth / 2, y);
      }
      if (header.right) {
        ctx.textAlign = 'right';
        ctx.fillText(resolve(header.right), canvasWidth - header.marginHorizontal * scale, y);
      }
      ctx.textAlign = 'left';
    }

    if (headerFooter.footer.enabled) {
      const footer = headerFooter.footer;
      const y = canvasHeight - footer.margin * scale;
      ctx.fillStyle = footer.fontColor;
      ctx.font = `${footer.fontSize * scale}px sans-serif`;
      ctx.textBaseline = 'bottom';

      const resolve = (text: string) =>
        resolvePlaceholders(text, currentPage, displayPageCount, fileName);

      if (footer.left) {
        ctx.textAlign = 'left';
        ctx.fillText(resolve(footer.left), footer.marginHorizontal * scale, y);
      }
      if (footer.center) {
        ctx.textAlign = 'center';
        ctx.fillText(resolve(footer.center), canvasWidth / 2, y);
      }
      if (footer.right) {
        ctx.textAlign = 'right';
        ctx.fillText(resolve(footer.right), canvasWidth - footer.marginHorizontal * scale, y);
      }
      ctx.textAlign = 'left';
    }

    if (pageNumbering.enabled && currentPage >= pageNumbering.startPage) {
      const displayNumber = pageNumbering.startNumber + (currentPage - pageNumbering.startPage);
      const text = formatPageNumber(
        displayNumber,
        pageNumbering.format,
        pageNumbering.prefix,
        pageNumbering.suffix,
      );

      ctx.fillStyle = pageNumbering.fontColor;
      ctx.font = `${pageNumbering.fontSize * scale}px sans-serif`;

      let x: number;
      if (pageNumbering.position.includes('left')) {
        ctx.textAlign = 'left';
        x = pageNumbering.margin * scale;
      } else if (pageNumbering.position.includes('right')) {
        ctx.textAlign = 'right';
        x = canvasWidth - pageNumbering.margin * scale;
      } else {
        ctx.textAlign = 'center';
        x = canvasWidth / 2;
      }

      let y: number;
      if (pageNumbering.position.startsWith('top')) {
        ctx.textBaseline = 'top';
        y = pageNumbering.margin * scale;
      } else {
        ctx.textBaseline = 'bottom';
        y = canvasHeight - pageNumbering.margin * scale;
      }

      ctx.fillText(text, x, y);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
    }
  }, [
    textBoxes,
    headerFooter,
    pageNumbering,
    currentPage,
    displayPageCount,
    scale,
    pageSize,
    pdfFile,
    activeTextBoxId,
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
      if (!activeTextBoxId || activeSubTab !== 'textbox') return;

      const rect = e.currentTarget.getBoundingClientRect();
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;
      const pdfX = Math.round(canvasX / scale);
      const pdfY = Math.round(canvasY / scale);

      setTextBoxes((prev) =>
        prev.map((box) => (box.id === activeTextBoxId ? { ...box, x: pdfX, y: pdfY } : box)),
      );
    },
    [activeTextBoxId, activeSubTab, scale],
  );

  const handleFileDrop = (files: File[]) => {
    const nextPdfFile = files.find((file) => file.type === 'application/pdf');
    if (!nextPdfFile) return;

    setPdfFile(nextPdfFile);
    setTextBoxes([]);
    setHeaderFooter(DEFAULT_HEADER_FOOTER);
    setPageNumbering(DEFAULT_PAGE_NUMBERING);
    setActiveTextBoxId(null);
  };

  const handleReset = () => {
    setPdfFile(null);
    setPdf(null);
    setPdfBytes(null);
    setOriginalTotalPages(0);
    setCurrentPage(1);
    setPageInputValue('1');
    setPageOrder([]);
    setThumbnails([]);
    setSelectedPages(new Set());
    setDraggedIndex(null);
    draggedIndexRef.current = null;
    setExtractStart('');
    setExtractEnd('');
    setTextBoxes([]);
    setHeaderFooter(DEFAULT_HEADER_FOOTER);
    setPageNumbering(DEFAULT_PAGE_NUMBERING);
    setActiveTextBoxId(null);
    setPngImages([]);
    setOutputError(null);
    setPngProgress(0);
  };

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

    if (hasPageChanges) {
      workingPdf = await reorderPdfPages(pdfBytes, pageOrder);
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

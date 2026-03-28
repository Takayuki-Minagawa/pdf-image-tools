import { useState, useRef, useEffect, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Download,
  Type,
  BookOpen,
  Hash,
  RotateCcw,
  FileUp,
} from 'lucide-react';
import { Dropzone } from './Dropzone';
import { TextBoxEditor } from './pdfEdit/TextBoxEditor';
import { HeaderFooterEditor } from './pdfEdit/HeaderFooterEditor';
import { PageNumberEditor } from './pdfEdit/PageNumberEditor';
import { applyPdfEdits } from '../utils/pdfEditOperations';
import { resolvePlaceholders, formatPageNumber } from '../utils/pdfEditOperations';
import { downloadPdf } from '../utils/pdfEditor';
import type { TextBoxConfig, HeaderFooterSettings, PageNumberingConfig } from '../types/pdfEdit';
import { DEFAULT_HEADER_FOOTER, DEFAULT_PAGE_NUMBERING } from '../types/pdfEdit';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

type SubTab = 'textbox' | 'header-footer' | 'page-number';

export function PdfEditor() {
  // File state
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  // Preview state
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [pageInputValue, setPageInputValue] = useState('1');

  // Edit state
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('page-number');
  const [textBoxes, setTextBoxes] = useState<TextBoxConfig[]>([]);
  const [headerFooter, setHeaderFooter] = useState<HeaderFooterSettings>(DEFAULT_HEADER_FOOTER);
  const [pageNumbering, setPageNumbering] = useState<PageNumberingConfig>(DEFAULT_PAGE_NUMBERING);
  const [activeTextBoxId, setActiveTextBoxId] = useState<string | null>(null);

  // Processing
  const [isProcessing, setIsProcessing] = useState(false);

  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load PDF
  useEffect(() => {
    if (!pdfFile) return;
    const loadPdf = async () => {
      setIsLoading(true);
      const arrayBuffer = await pdfFile.arrayBuffer();
      const bufferCopy = arrayBuffer.slice(0);
      setPdfBytes(bufferCopy);
      const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      setPdf(pdfDoc);
      setTotalPages(pdfDoc.numPages);
      setCurrentPage(1);
      setIsLoading(false);
    };
    loadPdf();
  }, [pdfFile]);

  // Render base page
  useEffect(() => {
    const renderPage = async () => {
      if (!pdf || !canvasRef.current) return;
      const page = await pdf.getPage(currentPage);
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
  }, [pdf, currentPage, scale]);

  // Sync overlay canvas size
  useEffect(() => {
    const base = canvasRef.current;
    const overlay = overlayCanvasRef.current;
    if (!base || !overlay) return;
    overlay.width = base.width;
    overlay.height = base.height;
  }, [pageSize, scale]);

  // Draw overlay
  const drawOverlay = useCallback(() => {
    const overlay = overlayCanvasRef.current;
    if (!overlay || pageSize.width === 0) return;

    const ctx = overlay.getContext('2d')!;
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    // Text boxes
    for (const box of textBoxes) {
      if (box.pageIndex !== -1 && box.pageIndex !== currentPage - 1) continue;

      const x = box.x * scale;
      const y = box.y * scale;
      const w = box.width * scale;
      const h = box.height * scale;

      // Background
      if (box.backgroundColor !== 'transparent' && box.backgroundColor !== '') {
        ctx.fillStyle = box.backgroundColor;
        ctx.globalAlpha = 0.8;
        ctx.fillRect(x, y, w, h);
        ctx.globalAlpha = 1;
      }

      // Border
      if (box.borderStyle !== 'none' && box.borderWidth > 0) {
        ctx.strokeStyle = box.borderColor;
        ctx.lineWidth = box.borderWidth * scale;
        if (box.borderStyle === 'dashed') ctx.setLineDash([5 * scale, 5 * scale]);
        else if (box.borderStyle === 'dotted') ctx.setLineDash([2 * scale, 2 * scale]);
        else ctx.setLineDash([]);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
      }

      // Active indicator
      if (box.id === activeTextBoxId) {
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
        ctx.setLineDash([]);
      }

      // Text
      if (box.text) {
        ctx.fillStyle = box.fontColor;
        ctx.font = `${box.fontSize * scale}px sans-serif`;
        ctx.textBaseline = 'top';
        const padding = 4 * scale;
        const lines = box.text.split('\n');
        const lineHeight = box.fontSize * 1.3 * scale;
        for (let i = 0; i < lines.length; i++) {
          const textY = y + padding + i * lineHeight;
          if (textY + lineHeight > y + h) break;
          ctx.fillText(lines[i], x + padding, textY, w - padding * 2);
        }
      }
    }

    const canvasW = overlay.width;
    const canvasH = overlay.height;
    const fileName = pdfFile?.name || '';

    // Header
    if (headerFooter.header.enabled) {
      const hdr = headerFooter.header;
      const y = hdr.margin * scale;
      ctx.fillStyle = hdr.fontColor;
      ctx.font = `${hdr.fontSize * scale}px sans-serif`;
      ctx.textBaseline = 'top';

      const resolve = (t: string) => resolvePlaceholders(t, currentPage, totalPages, fileName);

      if (hdr.left) {
        ctx.textAlign = 'left';
        ctx.fillText(resolve(hdr.left), hdr.marginHorizontal * scale, y);
      }
      if (hdr.center) {
        ctx.textAlign = 'center';
        ctx.fillText(resolve(hdr.center), canvasW / 2, y);
      }
      if (hdr.right) {
        ctx.textAlign = 'right';
        ctx.fillText(resolve(hdr.right), canvasW - hdr.marginHorizontal * scale, y);
      }
      ctx.textAlign = 'left';
    }

    // Footer
    if (headerFooter.footer.enabled) {
      const ftr = headerFooter.footer;
      const y = canvasH - ftr.margin * scale;
      ctx.fillStyle = ftr.fontColor;
      ctx.font = `${ftr.fontSize * scale}px sans-serif`;
      ctx.textBaseline = 'bottom';

      const resolve = (t: string) => resolvePlaceholders(t, currentPage, totalPages, fileName);

      if (ftr.left) {
        ctx.textAlign = 'left';
        ctx.fillText(resolve(ftr.left), ftr.marginHorizontal * scale, y);
      }
      if (ftr.center) {
        ctx.textAlign = 'center';
        ctx.fillText(resolve(ftr.center), canvasW / 2, y);
      }
      if (ftr.right) {
        ctx.textAlign = 'right';
        ctx.fillText(resolve(ftr.right), canvasW - ftr.marginHorizontal * scale, y);
      }
      ctx.textAlign = 'left';
    }

    // Page numbers
    if (pageNumbering.enabled && currentPage >= pageNumbering.startPage) {
      const displayNum = pageNumbering.startNumber + (currentPage - pageNumbering.startPage);
      const text = formatPageNumber(
        displayNum,
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
        x = canvasW - pageNumbering.margin * scale;
      } else {
        ctx.textAlign = 'center';
        x = canvasW / 2;
      }

      let y: number;
      if (pageNumbering.position.startsWith('top')) {
        ctx.textBaseline = 'top';
        y = pageNumbering.margin * scale;
      } else {
        ctx.textBaseline = 'bottom';
        y = canvasH - pageNumbering.margin * scale;
      }

      ctx.fillText(text, x, y);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
    }
  }, [textBoxes, headerFooter, pageNumbering, currentPage, totalPages, scale, pageSize, pdfFile, activeTextBoxId]);

  useEffect(() => {
    drawOverlay();
  }, [drawOverlay]);

  // Page navigation
  useEffect(() => {
    setPageInputValue(String(currentPage));
  }, [currentPage]);

  const handlePageInputCommit = () => {
    const num = parseInt(pageInputValue, 10);
    if (!isNaN(num) && num >= 1 && num <= totalPages) {
      setCurrentPage(num);
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

  // Canvas click for text box placement
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

  // File handling
  const handleFileDrop = (files: File[]) => {
    const pdfFiles = files.filter((f) => f.type === 'application/pdf');
    if (pdfFiles.length > 0) {
      setPdfFile(pdfFiles[0]);
      setTextBoxes([]);
      setHeaderFooter(DEFAULT_HEADER_FOOTER);
      setPageNumbering(DEFAULT_PAGE_NUMBERING);
      setActiveTextBoxId(null);
    }
  };

  const handleReset = () => {
    setPdfFile(null);
    setPdf(null);
    setPdfBytes(null);
    setTotalPages(0);
    setCurrentPage(1);
    setTextBoxes([]);
    setHeaderFooter(DEFAULT_HEADER_FOOTER);
    setPageNumbering(DEFAULT_PAGE_NUMBERING);
    setActiveTextBoxId(null);
  };

  // Save
  const handleSave = async () => {
    if (!pdfBytes || !pdfFile) return;
    setIsProcessing(true);
    try {
      const editState = { textBoxes, headerFooter, pageNumbering };
      const result = await applyPdfEdits(pdfBytes, editState, pdfFile.name);
      downloadPdf(result, `${pdfFile.name.replace('.pdf', '')}_edited.pdf`);
    } catch (err) {
      console.error(err);
      alert('保存中にエラーが発生しました: ' + (err instanceof Error ? err.message : '不明なエラー'));
    } finally {
      setIsProcessing(false);
    }
  };

  // No file loaded
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
      <div className="flex items-center justify-center h-96 bg-gray-100 rounded-lg">
        <div className="text-gray-500">PDFを読み込み中...</div>
      </div>
    );
  }

  const subTabs: { key: SubTab; label: string; icon: typeof Type }[] = [
    { key: 'textbox', label: 'テキストボックス', icon: Type },
    { key: 'header-footer', label: 'ヘッダー/フッター', icon: BookOpen },
    { key: 'page-number', label: 'ページ番号', icon: Hash },
  ];

  return (
    <div className="space-y-4">
      {/* File info */}
      <div className="flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded-lg">
        <div className="flex items-center gap-3 min-w-0">
          <FileUp className="w-5 h-5 text-amber-600 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-700 truncate">{pdfFile.name}</p>
            <p className="text-xs text-gray-500">{totalPages} ページ</p>
          </div>
        </div>
        <button
          onClick={handleReset}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 hover:bg-amber-100 rounded-lg transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
          変更
        </button>
      </div>

      {/* Layout: sidebar + preview */}
      <div className="flex flex-col lg:flex-row gap-4">
        {/* Sidebar */}
        <div className="lg:w-80 shrink-0 space-y-3">
          {/* Sub-tabs */}
          <div className="flex border border-gray-200 rounded-lg overflow-hidden">
            {subTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveSubTab(tab.key)}
                  className={`flex-1 flex items-center justify-center gap-1 px-2 py-2.5 text-xs font-medium transition-colors ${
                    activeSubTab === tab.key
                      ? 'bg-amber-500 text-white'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Active editor */}
          <div className="border border-gray-200 rounded-lg p-3 max-h-[500px] overflow-auto">
            {activeSubTab === 'textbox' && (
              <TextBoxEditor
                textBoxes={textBoxes}
                onChange={setTextBoxes}
                totalPages={totalPages}
                activeTextBoxId={activeTextBoxId}
                onActiveChange={setActiveTextBoxId}
              />
            )}
            {activeSubTab === 'header-footer' && (
              <HeaderFooterEditor settings={headerFooter} onChange={setHeaderFooter} />
            )}
            {activeSubTab === 'page-number' && (
              <PageNumberEditor
                config={pageNumbering}
                onChange={setPageNumbering}
                totalPages={totalPages}
              />
            )}
          </div>

          {/* Save button */}
          <button
            onClick={handleSave}
            disabled={isProcessing}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50 font-medium"
          >
            <Download className="w-5 h-5" />
            {isProcessing ? '処理中...' : '編集済みPDFを保存'}
          </button>
        </div>

        {/* Preview */}
        <div className="flex-1 min-w-0 space-y-3">
          {/* Preview toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-gray-100 rounded-lg">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="p-1.5 bg-white rounded-lg shadow-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-1 text-sm">
                <input
                  type="text"
                  inputMode="numeric"
                  value={pageInputValue}
                  onChange={(e) => setPageInputValue(e.target.value)}
                  onBlur={handlePageInputCommit}
                  onKeyDown={handlePageInputKeyDown}
                  className="w-10 text-center border border-gray-300 rounded-md px-1 py-0.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 text-sm"
                />
                <span className="text-gray-500">/ {totalPages}</span>
              </div>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="p-1.5 bg-white rounded-lg shadow-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setScale((s) => Math.max(0.25, s - 0.25))}
                disabled={scale <= 0.25}
                className="p-1.5 bg-white rounded-lg shadow-sm hover:bg-gray-50 disabled:opacity-50"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <select
                value={scale}
                onChange={(e) => setScale(parseFloat(e.target.value))}
                className="px-2 py-1 bg-white border border-gray-300 rounded-lg text-sm min-w-[80px]"
              >
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => (
                  <option key={v} value={v}>
                    {Math.round(v * 100)}%
                  </option>
                ))}
              </select>
              <button
                onClick={() => setScale((s) => Math.min(3, s + 0.25))}
                disabled={scale >= 3}
                className="p-1.5 bg-white rounded-lg shadow-sm hover:bg-gray-50 disabled:opacity-50"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Canvas area */}
          <div
            ref={containerRef}
            className="overflow-auto bg-gray-200 rounded-lg p-4 max-h-[600px]"
          >
            <div className="flex justify-center">
              <div className="relative inline-block">
                <canvas ref={canvasRef} className="shadow-lg bg-white" />
                <canvas
                  ref={overlayCanvasRef}
                  onClick={handleCanvasClick}
                  className={`absolute inset-0 ${
                    activeTextBoxId && activeSubTab === 'textbox'
                      ? 'cursor-crosshair'
                      : 'pointer-events-none'
                  }`}
                />
              </div>
            </div>
          </div>

          {/* Page info */}
          <div className="text-xs text-gray-500 text-center">
            ページサイズ: {Math.round(pageSize.width)} x {Math.round(pageSize.height)} pt |
            ズーム: {Math.round(scale * 100)}%
          </div>
        </div>
      </div>
    </div>
  );
}

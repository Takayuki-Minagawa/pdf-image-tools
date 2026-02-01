import { useState, useRef, useEffect, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Download,
  MousePointer2,
  Maximize,
  Fullscreen,
  Trash2,
  GripVertical,
  Scissors,
  Save,
  RotateCcw,
  Eye,
  Grid3X3,
} from 'lucide-react';
import { reorderPdfPages, extractPdfPages, downloadPdf } from '../utils/pdfEditor';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface PdfViewerProps {
  file: File;
  onConvert: () => void;
  isConverting: boolean;
}

interface MousePosition {
  x: number;
  y: number;
  pdfX: number;
  pdfY: number;
}

interface PageThumbnail {
  pageNumber: number;
  dataUrl: string;
  selected: boolean;
}

type FitMode = 'custom' | 'fit-width' | 'fit-page';
type ViewMode = 'viewer' | 'thumbnails';

const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

export function PdfViewer({ file, onConvert, isConverting }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  const [fitMode, setFitMode] = useState<FitMode>('custom');
  const [mousePos, setMousePos] = useState<MousePosition | null>(null);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('viewer');
  const [thumbnails, setThumbnails] = useState<PageThumbnail[]>([]);
  const [pageOrder, setPageOrder] = useState<number[]>([]);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [extractStart, setExtractStart] = useState<string>('');
  const [extractEnd, setExtractEnd] = useState<string>('');
  const [hasChanges, setHasChanges] = useState(false);

  // PDFを読み込む
  useEffect(() => {
    const loadPdf = async () => {
      setIsLoading(true);
      const arrayBuffer = await file.arrayBuffer();
      // ArrayBufferをコピーして保持（detached問題を回避）
      const bufferCopy = arrayBuffer.slice(0);
      setPdfBytes(bufferCopy);
      const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      setPdf(pdfDoc);
      setTotalPages(pdfDoc.numPages);
      setCurrentPage(1);
      
      // ページ順序を初期化
      const order = Array.from({ length: pdfDoc.numPages }, (_, i) => i);
      setPageOrder(order);
      setSelectedPages(new Set());
      setHasChanges(false);
      
      setIsLoading(false);
    };
    loadPdf();
  }, [file]);

  // サムネイルを生成
  useEffect(() => {
    const generateThumbnails = async () => {
      if (!pdf || viewMode !== 'thumbnails') return;

      const thumbs: PageThumbnail[] = [];
      for (let i = 0; i < pageOrder.length; i++) {
        const pageIndex = pageOrder[i];
        const page = await pdf.getPage(pageIndex + 1);
        const viewport = page.getViewport({ scale: 0.3 });

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d')!;
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({
          canvasContext: context,
          viewport: viewport,
          canvas: canvas,
        }).promise;

        thumbs.push({
          pageNumber: pageIndex + 1,
          dataUrl: canvas.toDataURL('image/png'),
          selected: selectedPages.has(i),
        });
      }
      setThumbnails(thumbs);
    };
    generateThumbnails();
  }, [pdf, viewMode, pageOrder, selectedPages]);

  // フィットモードに応じてスケールを計算
  const calculateFitScale = useCallback(async () => {
    if (!pdf || !containerRef.current || fitMode === 'custom') return;

    const page = await pdf.getPage(currentPage);
    const originalViewport = page.getViewport({ scale: 1 });
    const container = containerRef.current;
    const containerWidth = container.clientWidth - 32;
    const containerHeight = 500;

    let newScale: number;
    if (fitMode === 'fit-width') {
      newScale = containerWidth / originalViewport.width;
    } else {
      const scaleX = containerWidth / originalViewport.width;
      const scaleY = containerHeight / originalViewport.height;
      newScale = Math.min(scaleX, scaleY);
    }

    setScale(Math.max(0.25, Math.min(5, newScale)));
  }, [pdf, currentPage, fitMode]);

  useEffect(() => {
    calculateFitScale();
  }, [calculateFitScale]);

  useEffect(() => {
    if (fitMode === 'custom') return;
    const handleResize = () => calculateFitScale();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [fitMode, calculateFitScale]);

  // ページをレンダリング
  useEffect(() => {
    const renderPage = async () => {
      if (!pdf || !canvasRef.current || viewMode !== 'viewer') return;

      const pageIndex = pageOrder[currentPage - 1];
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
        viewport: viewport,
        canvas: canvas,
      }).promise;
    };
    renderPage();
  }, [pdf, currentPage, scale, viewMode, pageOrder]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pdfX = x / scale;
    const pdfY = y / scale;

    setMousePos({
      x: Math.round(x),
      y: Math.round(y),
      pdfX: Math.round(pdfX * 100) / 100,
      pdfY: Math.round(pdfY * 100) / 100,
    });
  }, [scale]);

  const handleMouseLeave = useCallback(() => {
    setMousePos(null);
  }, []);

  const prevPage = () => setCurrentPage((p) => Math.max(1, p - 1));
  const nextPage = () => setCurrentPage((p) => Math.min(pageOrder.length, p + 1));

  const zoomIn = () => {
    setFitMode('custom');
    setScale((s) => Math.min(5, s + 0.25));
  };

  const zoomOut = () => {
    setFitMode('custom');
    setScale((s) => Math.max(0.25, s - 0.25));
  };

  const handleScaleChange = (newScale: number) => {
    setFitMode('custom');
    setScale(newScale);
  };

  const handleFitWidth = () => setFitMode('fit-width');
  const handleFitPage = () => setFitMode('fit-page');

  // ページ選択
  const togglePageSelection = (index: number) => {
    const newSelected = new Set(selectedPages);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedPages(newSelected);
  };

  // 全選択/解除
  const toggleSelectAll = () => {
    if (selectedPages.size === pageOrder.length) {
      setSelectedPages(new Set());
    } else {
      setSelectedPages(new Set(pageOrder.map((_, i) => i)));
    }
  };

  // 選択ページを削除
  const deleteSelectedPages = () => {
    if (selectedPages.size === 0) return;
    if (selectedPages.size === pageOrder.length) {
      alert('すべてのページを削除することはできません');
      return;
    }

    const newOrder = pageOrder.filter((_, i) => !selectedPages.has(i));
    setPageOrder(newOrder);
    setSelectedPages(new Set());
    setHasChanges(true);
    
    if (currentPage > newOrder.length) {
      setCurrentPage(newOrder.length);
    }
  };

  // ドラッグ&ドロップで並び替え
  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newOrder = [...pageOrder];
    const [draggedItem] = newOrder.splice(draggedIndex, 1);
    newOrder.splice(index, 0, draggedItem);
    setPageOrder(newOrder);
    setDraggedIndex(index);
    setHasChanges(true);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  // ページ抽出
  const handleExtract = async () => {
    if (!pdfBytes) return;
    
    const start = parseInt(extractStart);
    const end = parseInt(extractEnd);
    
    if (isNaN(start) || isNaN(end) || start < 1 || end > totalPages || start > end) {
      alert(`有効なページ範囲を指定してください (1〜${totalPages})`);
      return;
    }

    try {
      // ページ番号は1始まりなので、インデックスに変換（-1）
      const extractedPdf = await extractPdfPages(pdfBytes, start - 1, end - 1);
      downloadPdf(extractedPdf, `${file.name.replace('.pdf', '')}_pages_${start}-${end}.pdf`);
    } catch (err) {
      console.error(err);
      alert('抽出中にエラーが発生しました: ' + (err instanceof Error ? err.message : '不明なエラー'));
    }
  };

  // 変更を保存
  const saveChanges = async () => {
    if (!pdfBytes) return;

    try {
      const reorderedPdf = await reorderPdfPages(pdfBytes, pageOrder);
      downloadPdf(reorderedPdf, `${file.name.replace('.pdf', '')}_edited.pdf`);
    } catch (err) {
      console.error(err);
      alert('保存中にエラーが発生しました');
    }
  };

  // 変更をリセット
  const resetChanges = () => {
    const order = Array.from({ length: totalPages }, (_, i) => i);
    setPageOrder(order);
    setSelectedPages(new Set());
    setHasChanges(false);
    setCurrentPage(1);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96 bg-gray-100 rounded-lg">
        <div className="text-gray-500">PDFを読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* モード切り替えタブ */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setViewMode('viewer')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            viewMode === 'viewer'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-600 hover:text-gray-800'
          }`}
        >
          <Eye className="w-4 h-4" />
          ビューワー
        </button>
        <button
          onClick={() => setViewMode('thumbnails')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            viewMode === 'thumbnails'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-600 hover:text-gray-800'
          }`}
        >
          <Grid3X3 className="w-4 h-4" />
          ページ編集
          {hasChanges && <span className="w-2 h-2 bg-orange-500 rounded-full" />}
        </button>
      </div>

      {viewMode === 'viewer' ? (
        <>
          {/* ビューワーツールバー */}
          <div className="flex flex-wrap items-center justify-between gap-4 p-3 bg-gray-100 rounded-lg">
            <div className="flex items-center gap-2">
              <button
                onClick={prevPage}
                disabled={currentPage <= 1}
                className="p-2 bg-white rounded-lg shadow-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span className="text-sm font-medium min-w-[100px] text-center">
                {currentPage} / {pageOrder.length} ページ
              </span>
              <button
                onClick={nextPage}
                disabled={currentPage >= pageOrder.length}
                className="p-2 bg-white rounded-lg shadow-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button onClick={zoomOut} disabled={scale <= 0.25} className="p-2 bg-white rounded-lg shadow-sm hover:bg-gray-50 disabled:opacity-50" title="縮小">
                <ZoomOut className="w-5 h-5" />
              </button>
              <select
                value={fitMode === 'custom' ? scale.toString() : fitMode}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'fit-width') handleFitWidth();
                  else if (val === 'fit-page') handleFitPage();
                  else handleScaleChange(parseFloat(val));
                }}
                className="px-2 py-1.5 bg-white border border-gray-300 rounded-lg text-sm font-medium min-w-[120px] cursor-pointer"
              >
                <option value="fit-width">幅に合わせる</option>
                <option value="fit-page">全体表示</option>
                <optgroup label="ズーム倍率">
                  {ZOOM_PRESETS.map((preset) => (
                    <option key={preset} value={preset}>{Math.round(preset * 100)}%</option>
                  ))}
                </optgroup>
              </select>
              <button onClick={zoomIn} disabled={scale >= 5} className="p-2 bg-white rounded-lg shadow-sm hover:bg-gray-50 disabled:opacity-50" title="拡大">
                <ZoomIn className="w-5 h-5" />
              </button>
              <button onClick={handleFitWidth} className={`p-2 rounded-lg shadow-sm transition-colors ${fitMode === 'fit-width' ? 'bg-blue-100 text-blue-600' : 'bg-white hover:bg-gray-50'}`} title="幅に合わせる">
                <Maximize className="w-5 h-5" />
              </button>
              <button onClick={handleFitPage} className={`p-2 rounded-lg shadow-sm transition-colors ${fitMode === 'fit-page' ? 'bg-blue-100 text-blue-600' : 'bg-white hover:bg-gray-50'}`} title="全体表示">
                <Fullscreen className="w-5 h-5" />
              </button>
            </div>

            <button
              onClick={onConvert}
              disabled={isConverting}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              {isConverting ? '変換中...' : 'PNGに変換'}
            </button>
          </div>

          {/* ページ情報 */}
          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600 bg-gray-50 p-3 rounded-lg">
            <div><span className="font-medium">ページサイズ:</span> {Math.round(pageSize.width)} × {Math.round(pageSize.height)} pt</div>
            <div className="text-gray-400">|</div>
            <div><span className="font-medium">表示サイズ:</span> {Math.round(pageSize.width * scale)} × {Math.round(pageSize.height * scale)} px</div>
            <div className="text-gray-400">|</div>
            <div>
              <span className="font-medium">ズーム:</span> {Math.round(scale * 100)}%
              {fitMode !== 'custom' && <span className="ml-1 text-blue-600">({fitMode === 'fit-width' ? '幅に合わせる' : '全体表示'})</span>}
            </div>
          </div>

          {/* 座標表示 */}
          <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <MousePointer2 className="w-5 h-5 text-blue-600" />
            {mousePos ? (
              <div className="flex flex-wrap gap-4 text-sm">
                <div>
                  <span className="font-medium text-blue-700">PDF座標:</span>{' '}
                  <span className="font-mono bg-blue-100 px-2 py-0.5 rounded">X: {mousePos.pdfX} pt, Y: {mousePos.pdfY} pt</span>
                </div>
                <div>
                  <span className="font-medium text-gray-600">表示座標:</span>{' '}
                  <span className="font-mono bg-gray-100 px-2 py-0.5 rounded">X: {mousePos.x} px, Y: {mousePos.y} px</span>
                </div>
              </div>
            ) : (
              <span className="text-sm text-blue-600">PDF上にマウスを移動すると座標が表示されます</span>
            )}
          </div>

          {/* PDF表示エリア */}
          <div ref={containerRef} className="overflow-auto bg-gray-200 rounded-lg p-4 max-h-[600px]">
            <div className="flex justify-center">
              <canvas
                ref={canvasRef}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                className="shadow-lg cursor-crosshair bg-white"
              />
            </div>
          </div>
        </>
      ) : (
        <>
          {/* サムネイルモードツールバー */}
          <div className="flex flex-wrap items-center justify-between gap-4 p-3 bg-gray-100 rounded-lg">
            <div className="flex items-center gap-2">
              <button
                onClick={toggleSelectAll}
                className="px-3 py-2 bg-white rounded-lg shadow-sm hover:bg-gray-50 text-sm font-medium"
              >
                {selectedPages.size === pageOrder.length ? '選択解除' : '全選択'}
              </button>
              <span className="text-sm text-gray-600">
                {selectedPages.size > 0 ? `${selectedPages.size}ページ選択中` : `${pageOrder.length}ページ`}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={deleteSelectedPages}
                disabled={selectedPages.size === 0}
                className="flex items-center gap-2 px-3 py-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-4 h-4" />
                削除
              </button>
            </div>

            <div className="flex items-center gap-2">
              {hasChanges && (
                <>
                  <button
                    onClick={resetChanges}
                    className="flex items-center gap-2 px-3 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                  >
                    <RotateCcw className="w-4 h-4" />
                    リセット
                  </button>
                  <button
                    onClick={saveChanges}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                  >
                    <Save className="w-4 h-4" />
                    保存
                  </button>
                </>
              )}
            </div>
          </div>

          {/* ページ抽出 */}
          <div className="flex flex-wrap items-center gap-3 p-3 bg-purple-50 border border-purple-200 rounded-lg">
            <Scissors className="w-5 h-5 text-purple-600" />
            <span className="text-sm font-medium text-purple-700">ページ抽出:</span>
            <input
              type="number"
              min={1}
              max={totalPages}
              value={extractStart}
              onChange={(e) => setExtractStart(e.target.value)}
              placeholder="開始"
              className="w-20 px-2 py-1 border border-purple-300 rounded-lg text-sm"
            />
            <span className="text-gray-500">〜</span>
            <input
              type="number"
              min={1}
              max={totalPages}
              value={extractEnd}
              onChange={(e) => setExtractEnd(e.target.value)}
              placeholder="終了"
              className="w-20 px-2 py-1 border border-purple-300 rounded-lg text-sm"
            />
            <span className="text-sm text-gray-500">ページ</span>
            <button
              onClick={handleExtract}
              disabled={!extractStart || !extractEnd}
              className="flex items-center gap-2 px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 text-sm"
            >
              <Download className="w-4 h-4" />
              抽出
            </button>
          </div>

          {/* 操作説明 */}
          <div className="text-sm text-gray-500 bg-gray-50 p-3 rounded-lg">
            💡 ドラッグ＆ドロップでページを並び替え、クリックで選択して削除できます
          </div>

          {/* サムネイル一覧 */}
          <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 p-4 bg-gray-100 rounded-lg max-h-[500px] overflow-auto">
            {thumbnails.map((thumb, index) => (
              <div
                key={`${thumb.pageNumber}-${index}`}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                onClick={() => togglePageSelection(index)}
                className={`relative group bg-white rounded-lg shadow-md overflow-hidden cursor-pointer transition-all ${
                  draggedIndex === index ? 'opacity-50 scale-95' : ''
                } ${selectedPages.has(index) ? 'ring-2 ring-blue-500' : 'hover:ring-2 hover:ring-gray-300'}`}
              >
                <div className="absolute top-1 left-1 z-10 p-1 bg-white/80 rounded shadow cursor-grab active:cursor-grabbing">
                  <GripVertical className="w-3 h-3 text-gray-500" />
                </div>
                <div className="absolute top-1 right-1 z-10 bg-gray-800 text-white text-xs px-1.5 py-0.5 rounded">
                  {index + 1}
                </div>
                {selectedPages.has(index) && (
                  <div className="absolute inset-0 bg-blue-500/20 z-5" />
                )}
                <img
                  src={thumb.dataUrl}
                  alt={`Page ${index + 1}`}
                  className="w-full h-32 object-contain bg-gray-50"
                />
                <div className="p-1 text-center text-xs text-gray-500 bg-gray-50 truncate">
                  元ページ {thumb.pageNumber}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

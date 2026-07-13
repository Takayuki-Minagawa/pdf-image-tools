import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';
import type { KeyboardEvent, MouseEvent, RefObject } from 'react';

interface PdfEditorPreviewProps {
  currentPage: number;
  displayPageCount: number;
  pageInputValue: string;
  onPageInputValueChange: (value: string) => void;
  onPageInputCommit: () => void;
  onPageInputKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  scale: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onScaleChange: (value: number) => void;
  containerRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  overlayCanvasRef: RefObject<HTMLCanvasElement | null>;
  onCanvasClick: (e: MouseEvent<HTMLCanvasElement>) => void;
  isTextPlacementActive: boolean;
  isContentSelectionActive: boolean;
  pageSize: { width: number; height: number };
}

const SCALE_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function PdfEditorPreview({
  currentPage,
  displayPageCount,
  pageInputValue,
  onPageInputValueChange,
  onPageInputCommit,
  onPageInputKeyDown,
  onPrevPage,
  onNextPage,
  scale,
  onZoomOut,
  onZoomIn,
  onScaleChange,
  containerRef,
  canvasRef,
  overlayCanvasRef,
  onCanvasClick,
  isTextPlacementActive,
  isContentSelectionActive,
  pageSize,
}: PdfEditorPreviewProps) {
  return (
    <div className="min-w-0 flex-1 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-gray-100 p-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onPrevPage}
            disabled={currentPage <= 1}
            aria-label="前のページ"
            className="rounded-lg bg-white p-1.5 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-1 text-sm">
            <input
              aria-label="表示するページ番号"
              type="text"
              inputMode="numeric"
              value={pageInputValue}
              onChange={(e) => onPageInputValueChange(e.target.value)}
              onBlur={onPageInputCommit}
              onKeyDown={onPageInputKeyDown}
              className="w-10 rounded-md border border-gray-300 bg-white px-1 py-0.5 text-center text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
            <span className="text-gray-500">/ {displayPageCount}</span>
          </div>
          <button
            type="button"
            onClick={onNextPage}
            disabled={currentPage >= displayPageCount}
            aria-label="次のページ"
            className="rounded-lg bg-white p-1.5 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onZoomOut}
            disabled={scale <= 0.25}
            aria-label="縮小"
            className="rounded-lg bg-white p-1.5 shadow-sm hover:bg-gray-50 disabled:opacity-50"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <select
            aria-label="ズーム倍率"
            value={scale}
            onChange={(e) => onScaleChange(parseFloat(e.target.value))}
            className="min-w-[80px] rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm"
          >
            {SCALE_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {Math.round(value * 100)}%
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onZoomIn}
            disabled={scale >= 3}
            aria-label="拡大"
            className="rounded-lg bg-white p-1.5 shadow-sm hover:bg-gray-50 disabled:opacity-50"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        aria-label={`PDFプレビュー ${currentPage}/${displayPageCount}ページ`}
        className="max-h-[600px] overflow-auto rounded-lg bg-gray-200 p-4"
      >
        <div className="flex justify-center">
          <div className="relative inline-block">
            <canvas ref={canvasRef} className="bg-white shadow-lg" aria-label={`${currentPage}ページ目の内容`} />
            <canvas
              ref={overlayCanvasRef}
              onClick={onCanvasClick}
              aria-label={isTextPlacementActive ? 'テキストボックスの配置位置を選択' : isContentSelectionActive ? '編集するコンテンツを選択' : undefined}
              className={`absolute inset-0 ${
                isTextPlacementActive
                  ? 'cursor-crosshair'
                  : isContentSelectionActive
                    ? 'cursor-pointer'
                    : 'pointer-events-none'
              }`}
            />
          </div>
        </div>
      </div>

      <div className="text-center text-xs text-gray-500">
        ページサイズ: {Math.round(pageSize.width)} x {Math.round(pageSize.height)} pt |
        ズーム: {Math.round(scale * 100)}%
      </div>
    </div>
  );
}

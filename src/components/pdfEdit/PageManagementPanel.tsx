import { Download, GripVertical, LayoutGrid, RotateCcw, Scissors, Trash2 } from 'lucide-react';

interface PageManagementPanelProps {
  displayPageCount: number;
  selectedPages: Set<number>;
  hasPageChanges: boolean;
  extractStart: string;
  extractEnd: string;
  isGeneratingThumbnails: boolean;
  pageOrder: number[];
  thumbnails: string[];
  draggedIndex: number | null;
  onToggleSelectAll: () => void;
  onDeleteSelectedPages: () => void;
  onResetPageChanges: () => void;
  onExtractStartChange: (value: string) => void;
  onExtractEndChange: (value: string) => void;
  onExtract: () => void;
  onDragStart: (displayIndex: number) => void;
  onDragOver: (e: React.DragEvent, displayIndex: number) => void;
  onDragEnd: () => void;
  onTogglePageSelection: (displayIndex: number) => void;
}

export function PageManagementPanel({
  displayPageCount,
  selectedPages,
  hasPageChanges,
  extractStart,
  extractEnd,
  isGeneratingThumbnails,
  pageOrder,
  thumbnails,
  draggedIndex,
  onToggleSelectAll,
  onDeleteSelectedPages,
  onResetPageChanges,
  onExtractStartChange,
  onExtractEndChange,
  onExtract,
  onDragStart,
  onDragOver,
  onDragEnd,
  onTogglePageSelection,
}: PageManagementPanelProps) {
  return (
    <div className="rounded-xl border border-gray-200">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
            <LayoutGrid className="h-4 w-4 text-amber-600" />
            ページ編集
          </div>
          <p className="mt-1 text-sm text-gray-500">
            並び替え・削除は編集済みPDF保存とPNG出力の両方に反映されます。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onToggleSelectAll}
            className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-gray-200 transition-colors hover:bg-gray-50"
          >
            {selectedPages.size === displayPageCount ? '選択解除' : '全選択'}
          </button>
          <button
            onClick={onDeleteSelectedPages}
            disabled={selectedPages.size === 0}
            className="flex items-center gap-2 rounded-lg bg-red-100 px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            削除
          </button>
          {hasPageChanges && (
            <button
              onClick={onResetPageChanges}
              className="flex items-center gap-2 rounded-lg bg-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-300"
            >
              <RotateCcw className="h-4 w-4" />
              ページ編集をリセット
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3">
        <Scissors className="h-5 w-5 text-purple-600" />
        <span className="text-sm font-medium text-purple-700">抽出</span>
        <input
          type="number"
          min={1}
          max={displayPageCount}
          value={extractStart}
          onChange={(e) => onExtractStartChange(e.target.value)}
          placeholder="開始"
          className="w-20 rounded-lg border border-purple-300 px-2 py-1 text-sm"
        />
        <span className="text-gray-500">〜</span>
        <input
          type="number"
          min={1}
          max={displayPageCount}
          value={extractEnd}
          onChange={(e) => onExtractEndChange(e.target.value)}
          placeholder="終了"
          className="w-20 rounded-lg border border-purple-300 px-2 py-1 text-sm"
        />
        <span className="text-sm text-gray-500">現在の並び順でPDFを抽出</span>
        <button
          onClick={onExtract}
          disabled={!extractStart || !extractEnd}
          className="flex items-center gap-2 rounded-lg bg-purple-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-purple-700 disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          抽出
        </button>
      </div>

      <div className="p-4">
        {isGeneratingThumbnails ? (
          <div className="rounded-lg bg-gray-50 p-6 text-center text-sm text-gray-500">
            サムネイルを生成中...
          </div>
        ) : (
          <div className="grid max-h-[380px] grid-cols-3 gap-4 overflow-auto rounded-lg bg-gray-100 p-4 md:grid-cols-4 lg:grid-cols-6">
            {pageOrder.map((pageIndex, displayIndex) => (
              <div
                key={pageIndex}
                draggable
                onDragStart={() => onDragStart(displayIndex)}
                onDragOver={(e) => onDragOver(e, displayIndex)}
                onDragEnd={onDragEnd}
                onClick={() => onTogglePageSelection(displayIndex)}
                className={`relative cursor-pointer overflow-hidden rounded-lg bg-white shadow-md transition-all ${
                  draggedIndex === displayIndex ? 'scale-95 opacity-50' : ''
                } ${
                  selectedPages.has(displayIndex)
                    ? 'ring-2 ring-amber-500'
                    : 'hover:ring-2 hover:ring-gray-300'
                }`}
              >
                <div className="absolute left-1 top-1 z-10 rounded bg-white/80 p-1 shadow">
                  <GripVertical className="h-3 w-3 text-gray-500" />
                </div>
                <div className="absolute right-1 top-1 z-10 rounded bg-gray-800 px-1.5 py-0.5 text-xs text-white">
                  {displayIndex + 1}
                </div>
                {selectedPages.has(displayIndex) && (
                  <div className="absolute inset-0 z-[5] bg-amber-500/15" />
                )}
                {thumbnails[pageIndex] && (
                  <img
                    src={thumbnails[pageIndex]}
                    alt={`Page ${displayIndex + 1}`}
                    className="h-32 w-full bg-gray-50 object-contain"
                  />
                )}
                <div className="truncate bg-gray-50 p-1 text-center text-xs text-gray-500">
                  元ページ {pageIndex + 1}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

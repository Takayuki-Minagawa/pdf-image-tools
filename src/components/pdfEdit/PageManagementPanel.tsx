import { useEffect, useRef } from 'react';
import {
  Copy,
  Download,
  GripVertical,
  LayoutGrid,
  Plus,
  RotateCcw,
  RotateCw,
  Scissors,
  Trash2,
  X,
} from 'lucide-react';
import type { PagePlanEntry } from '../../types/pdfEdit';

interface PageManagementPanelProps {
  displayPageCount: number;
  selectedPages: Set<number>;
  hasPageChanges: boolean;
  extractStart: string;
  extractEnd: string;
  isGeneratingThumbnails: boolean;
  thumbnailProgress?: number;
  pageEntries: PagePlanEntry[];
  thumbnails: string[];
  draggedIndex: number | null;
  onRequestThumbnail?: (pageIndex: number) => Promise<string | null>;
  onCancelThumbnails?: () => void;
  onToggleSelectAll: () => void;
  onSelectPattern: (pattern: 'odd' | 'even' | 'none') => void;
  onDeleteSelectedPages: () => void;
  onRotateSelectedPages: () => void;
  onDuplicateSelectedPages: () => void;
  onInsertBlankPage: () => void;
  onResetPageChanges: () => void;
  onExtractStartChange: (value: string) => void;
  onExtractEndChange: (value: string) => void;
  onExtract: () => void;
  onExtractSelected: () => void;
  onDragStart: (displayIndex: number) => void;
  onDragOver: (e: React.DragEvent, displayIndex: number) => void;
  onDragEnd: () => void;
  onMovePage: (displayIndex: number, direction: -1 | 1) => void;
  onTogglePageSelection: (displayIndex: number, extend?: boolean) => void;
}

function LazyThumbnail({
  sourcePageIndex,
  thumbnail,
  displayIndex,
  onRequest,
}: {
  sourcePageIndex: number | null;
  thumbnail?: string;
  displayIndex: number;
  onRequest?: (pageIndex: number) => Promise<string | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (sourcePageIndex === null || thumbnail || !onRequest || !ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void onRequest(sourcePageIndex);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [onRequest, sourcePageIndex, thumbnail]);

  return (
    <div ref={ref} className="flex h-32 w-full items-center justify-center bg-gray-50">
      {sourcePageIndex === null ? (
        <div className="flex h-24 w-16 items-center justify-center border border-gray-300 bg-white text-xs text-gray-400">
          空白
        </div>
      ) : thumbnail ? (
        <img
          src={thumbnail}
          alt={`${displayIndex + 1}ページ目のサムネイル`}
          className="h-32 w-full bg-gray-50 object-contain"
        />
      ) : (
        <div className="h-20 w-14 animate-pulse rounded bg-gray-200" aria-label="サムネイルを生成中" />
      )}
    </div>
  );
}

export function PageManagementPanel({
  displayPageCount,
  selectedPages,
  hasPageChanges,
  extractStart,
  extractEnd,
  isGeneratingThumbnails,
  thumbnailProgress = 0,
  pageEntries,
  thumbnails,
  draggedIndex,
  onRequestThumbnail,
  onCancelThumbnails,
  onToggleSelectAll,
  onSelectPattern,
  onDeleteSelectedPages,
  onRotateSelectedPages,
  onDuplicateSelectedPages,
  onInsertBlankPage,
  onResetPageChanges,
  onExtractStartChange,
  onExtractEndChange,
  onExtract,
  onExtractSelected,
  onDragStart,
  onDragOver,
  onDragEnd,
  onMovePage,
  onTogglePageSelection,
}: PageManagementPanelProps) {
  return (
    <section className="rounded-xl border border-gray-200" aria-labelledby="page-editor-title">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
        <div>
          <div id="page-editor-title" className="flex items-center gap-2 text-sm font-semibold text-gray-800">
            <LayoutGrid className="h-4 w-4 text-amber-600" />
            ページ編集
          </div>
          <p className="mt-1 text-sm text-gray-500">
            選択、並び替え、回転、複製、削除はPDF保存と画像出力に反映されます。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onToggleSelectAll} className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-gray-200 hover:bg-gray-50">
            {selectedPages.size === displayPageCount ? '選択解除' : '全選択'}
          </button>
          <details className="relative">
            <summary className="cursor-pointer rounded-lg bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-gray-200">選択方法</summary>
            <div className="absolute right-0 z-30 mt-1 w-36 rounded-lg border border-gray-200 bg-white p-1 shadow-xl">
              <button type="button" onClick={() => onSelectPattern('odd')} className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-gray-50">奇数ページ</button>
              <button type="button" onClick={() => onSelectPattern('even')} className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-gray-50">偶数ページ</button>
              <button type="button" onClick={() => onSelectPattern('none')} className="flex w-full items-center gap-1 rounded px-3 py-2 text-left text-sm hover:bg-gray-50"><X className="h-3.5 w-3.5" />選択解除</button>
            </div>
          </details>
          <button type="button" onClick={onRotateSelectedPages} disabled={selectedPages.size === 0} className="flex items-center gap-1 rounded-lg bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-40">
            <RotateCw className="h-4 w-4" />90°回転
          </button>
          <button type="button" onClick={onDuplicateSelectedPages} disabled={selectedPages.size === 0} className="flex items-center gap-1 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-40">
            <Copy className="h-4 w-4" />複製
          </button>
          <button type="button" onClick={onInsertBlankPage} className="flex items-center gap-1 rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">
            <Plus className="h-4 w-4" />空白
          </button>
          <button type="button" onClick={onDeleteSelectedPages} disabled={selectedPages.size === 0} className="flex items-center gap-2 rounded-lg bg-red-100 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-200 disabled:opacity-40">
            <Trash2 className="h-4 w-4" />削除
          </button>
          {hasPageChanges && (
            <button type="button" onClick={onResetPageChanges} className="flex items-center gap-2 rounded-lg bg-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300">
              <RotateCcw className="h-4 w-4" />リセット
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3">
        <Scissors className="h-5 w-5 text-purple-600" />
        <span className="text-sm font-medium text-purple-700">抽出</span>
        <label className="sr-only" htmlFor="extract-start">抽出開始ページ</label>
        <input id="extract-start" type="number" min={1} max={displayPageCount} value={extractStart} onChange={(event) => onExtractStartChange(event.target.value)} placeholder="開始" className="w-20 rounded-lg border border-purple-300 px-2 py-1 text-sm" />
        <span className="text-gray-500">〜</span>
        <label className="sr-only" htmlFor="extract-end">抽出終了ページ</label>
        <input id="extract-end" type="number" min={1} max={displayPageCount} value={extractEnd} onChange={(event) => onExtractEndChange(event.target.value)} placeholder="終了" className="w-20 rounded-lg border border-purple-300 px-2 py-1 text-sm" />
        <button type="button" onClick={onExtract} disabled={!extractStart || !extractEnd} className="flex items-center gap-2 rounded-lg bg-purple-600 px-3 py-1.5 text-sm text-white hover:bg-purple-700 disabled:opacity-50">
          <Download className="h-4 w-4" />範囲を抽出
        </button>
        <button type="button" onClick={onExtractSelected} disabled={selectedPages.size === 0} className="flex items-center gap-2 rounded-lg border border-purple-300 bg-white px-3 py-1.5 text-sm text-purple-700 hover:bg-purple-50 disabled:opacity-50">
          <Download className="h-4 w-4" />選択ページを抽出
        </button>
      </div>

      {isGeneratingThumbnails && (
        <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-2 text-xs text-gray-500" aria-live="polite">
          <span>表示中のサムネイルを生成中（{Math.round(thumbnailProgress)}%）</span>
          {onCancelThumbnails && <button type="button" onClick={onCancelThumbnails} className="text-red-600 underline">キャンセル</button>}
        </div>
      )}

      <div className="p-4">
        <div role="listbox" aria-multiselectable="true" aria-label="PDFページ一覧" className="grid max-h-[380px] grid-cols-2 gap-4 overflow-auto rounded-lg bg-gray-100 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {pageEntries.map((entry, displayIndex) => (
            <div
              key={entry.id}
              role="option"
              aria-selected={selectedPages.has(displayIndex)}
              tabIndex={0}
              draggable
              onDragStart={() => onDragStart(displayIndex)}
              onDragOver={(event) => onDragOver(event, displayIndex)}
              onDragEnd={onDragEnd}
              onClick={(event) => onTogglePageSelection(displayIndex, event.shiftKey)}
              onKeyDown={(event) => {
                if (event.key === ' ' || event.key === 'Enter') {
                  event.preventDefault();
                  onTogglePageSelection(displayIndex, event.shiftKey);
                } else if (event.altKey && event.key === 'ArrowLeft') {
                  event.preventDefault();
                  onMovePage(displayIndex, -1);
                } else if (event.altKey && event.key === 'ArrowRight') {
                  event.preventDefault();
                  onMovePage(displayIndex, 1);
                }
              }}
              className={`relative cursor-pointer overflow-hidden rounded-lg bg-white shadow-md outline-none transition-all focus-visible:ring-2 focus-visible:ring-blue-500 ${draggedIndex === displayIndex ? 'scale-95 opacity-50' : ''} ${selectedPages.has(displayIndex) ? 'ring-2 ring-amber-500' : 'hover:ring-2 hover:ring-gray-300'}`}
            >
              <div className="absolute left-1 top-1 z-10 rounded bg-white/80 p-1 shadow" aria-hidden="true"><GripVertical className="h-3 w-3 text-gray-500" /></div>
              <div className="absolute right-1 top-1 z-10 rounded bg-gray-800 px-1.5 py-0.5 text-xs text-white">{displayIndex + 1}</div>
              {entry.rotation !== 0 && <div className="absolute bottom-7 right-1 z-10 rounded bg-blue-600 px-1 py-0.5 text-[10px] text-white">{entry.rotation}°</div>}
              {selectedPages.has(displayIndex) && <div className="pointer-events-none absolute inset-0 z-[5] bg-amber-500/15" />}
              <LazyThumbnail sourcePageIndex={entry.sourcePageIndex} thumbnail={entry.sourcePageIndex === null ? undefined : thumbnails[entry.sourcePageIndex]} displayIndex={displayIndex} onRequest={onRequestThumbnail} />
              <div className="truncate bg-gray-50 p-1 text-center text-xs text-gray-500">
                {entry.sourcePageIndex === null ? '空白ページ' : `元ページ ${entry.sourcePageIndex + 1}`}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-500">Alt + ←/→でページ移動、Shift + 選択で範囲選択できます。</p>
      </div>
    </section>
  );
}

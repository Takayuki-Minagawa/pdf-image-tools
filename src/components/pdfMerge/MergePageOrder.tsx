import { useState } from 'react';
import { ChevronLeft, ChevronRight, Layers, Shuffle } from 'lucide-react';
import type { MergePage } from '../../utils/pdfMergeLoader';

interface MergePageOrderProps {
  pages: MergePage[];
  getFileName: (fileId: string) => string;
  canInterleave: boolean;
  isMerging: boolean;
  onInterleave: () => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onToggleExcluded: (pageId: string) => void;
}

export function MergePageOrder({
  pages,
  getFileName,
  canInterleave,
  isMerging,
  onInterleave,
  onReorder,
  onToggleExcluded,
}: MergePageOrderProps) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  return (
    <section className="space-y-3 rounded-xl border border-purple-200 bg-purple-50/40 p-4" aria-labelledby="page-order-title">
      <div className="flex flex-wrap items-center justify-between gap-3 text-left">
        <div>
          <h3 id="page-order-title" className="flex items-center gap-2 font-bold text-gray-800">
            <Layers className="h-5 w-5 text-purple-600" aria-hidden="true" /> 結合ページ順
          </h3>
          <p className="text-sm text-gray-600">ファイルをまたいでドラッグできます。Alt＋左右矢印でも移動できます。</p>
        </div>
        <button
          type="button"
          onClick={onInterleave}
          disabled={!canInterleave || isMerging}
          className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-medium text-purple-700 shadow-sm hover:bg-purple-100 disabled:opacity-40"
        >
          <Shuffle className="h-4 w-4" aria-hidden="true" /> 交互に差し込む
        </button>
      </div>
      <ol className="flex gap-3 overflow-x-auto pb-3" aria-label="結合するページの順番">
        {pages.map((page, index) => {
          const fileName = getFileName(page.fileId);
          return (
            <li
              key={page.id}
              draggable={!isMerging}
              tabIndex={0}
              onDragStart={() => setDraggedIndex(index)}
              onDragOver={(event) => {
                event.preventDefault();
                if (draggedIndex !== null && draggedIndex !== index) {
                  onReorder(draggedIndex, index);
                  setDraggedIndex(index);
                }
              }}
              onDragEnd={() => setDraggedIndex(null)}
              onKeyDown={(event) => {
                if (!event.altKey) return;
                if (event.key === 'ArrowLeft' && index > 0) {
                  event.preventDefault();
                  onReorder(index, index - 1);
                }
                if (event.key === 'ArrowRight' && index < pages.length - 1) {
                  event.preventDefault();
                  onReorder(index, index + 1);
                }
              }}
              className={`w-28 flex-none rounded-lg border bg-white p-2 text-center focus-visible:outline-2 focus-visible:outline-purple-600 ${
                page.excluded ? 'border-gray-200 opacity-45' : 'border-purple-200'
              }`}
              aria-label={`${index + 1}番、${fileName}の${page.sourcePageIndex + 1}ページ${page.excluded ? '、除外中' : ''}`}
            >
              <div className="mb-1 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => onReorder(index, index - 1)}
                  disabled={index === 0 || isMerging}
                  className="rounded p-1 hover:bg-gray-100 disabled:opacity-20"
                  aria-label="前へ移動"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </button>
                <span className="text-xs font-bold text-purple-700">{index + 1}</span>
                <button
                  type="button"
                  onClick={() => onReorder(index, index + 1)}
                  disabled={index === pages.length - 1 || isMerging}
                  className="rounded p-1 hover:bg-gray-100 disabled:opacity-20"
                  aria-label="次へ移動"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <img src={page.thumbnail} alt="" className="h-28 w-full object-contain" />
              <p className="mt-1 truncate text-xs text-gray-600" title={fileName}>
                {fileName}
              </p>
              <button
                type="button"
                onClick={() => onToggleExcluded(page.id)}
                disabled={isMerging}
                className={`mt-1 w-full rounded px-2 py-1 text-xs font-medium ${
                  page.excluded ? 'bg-gray-200 text-gray-700' : 'bg-purple-100 text-purple-700'
                }`}
              >
                {page.excluded ? '含める' : '除外'}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

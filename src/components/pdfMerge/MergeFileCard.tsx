import type { DragEvent } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FileText,
  GripVertical,
  LoaderCircle,
  RotateCcw,
  Trash2,
  XCircle,
} from 'lucide-react';
import { formatBytes } from '../../utils/format';
import type { PdfFileEntry } from '../../utils/pdfMergeLoader';

interface MergeFileCardProps {
  pdfFile: PdfFileEntry;
  index: number;
  fileCount: number;
  isExpanded: boolean;
  isDragged: boolean;
  isLoading: boolean;
  isMerging: boolean;
  onDragStart: () => void;
  onDragOver: (event: DragEvent) => void;
  onDragEnd: () => void;
  onMove: (fromIndex: number, toIndex: number) => void;
  onToggleWholeFile: () => void;
  onToggleExpanded: () => void;
  onRemove: () => void;
  onRetry: () => void;
  onTogglePageExcluded: (pageId: string) => void;
}

export function MergeFileCard({
  pdfFile,
  index,
  fileCount,
  isExpanded,
  isDragged,
  isLoading,
  isMerging,
  onDragStart,
  onDragOver,
  onDragEnd,
  onMove,
  onToggleWholeFile,
  onToggleExpanded,
  onRemove,
  onRetry,
  onTogglePageExcluded,
}: MergeFileCardProps) {
  const allExcluded = pdfFile.pages.length > 0 && pdfFile.pages.every((page) => page.excluded);

  return (
    <li
      draggable={!isMerging}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      className={`rounded-xl border bg-white text-left transition ${
        isDragged ? 'border-purple-400 opacity-60' : 'border-gray-200'
      }`}
    >
      <div className="flex flex-wrap items-center gap-3 p-3">
        <span className="cursor-grab p-1 text-gray-400" aria-hidden="true">
          <GripVertical className="h-5 w-5" />
        </span>
        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-purple-100 text-sm font-bold text-purple-700">
          {index + 1}
        </span>
        <div className="h-16 w-12 flex-none overflow-hidden rounded bg-gray-100">
          {pdfFile.thumbnail ? (
            <img src={pdfFile.thumbnail} alt="" className="h-full w-full object-contain" />
          ) : (
            <FileText className="m-3 h-6 w-6 text-gray-400" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-40 flex-1">
          <p className="truncate font-medium text-gray-800">{pdfFile.name}</p>
          <p className="text-sm text-gray-500">
            {formatBytes(pdfFile.file.size)}
            {pdfFile.pageCount !== undefined && `・${pdfFile.pageCount}ページ`}
          </p>
          {pdfFile.status === 'loading' && (
            <span className="mt-1 inline-flex items-center gap-1 text-sm text-blue-700">
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> 読み込み中
            </span>
          )}
          {pdfFile.status === 'ready' && !pdfFile.duplicateOf && (
            <span className="mt-1 inline-flex items-center gap-1 text-sm text-green-700">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> 読み込み完了
            </span>
          )}
          {pdfFile.duplicateOf && (
            <span className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-amber-700">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" /> 「{pdfFile.duplicateOf}」と内容が重複
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onMove(index, index - 1)}
            disabled={index === 0 || isMerging}
            className="rounded p-2 hover:bg-gray-100 disabled:opacity-30"
            aria-label={`${pdfFile.name}を上へ移動`}
          >
            <ChevronUp className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onMove(index, index + 1)}
            disabled={index === fileCount - 1 || isMerging}
            className="rounded p-2 hover:bg-gray-100 disabled:opacity-30"
            aria-label={`${pdfFile.name}を下へ移動`}
          >
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {pdfFile.status === 'ready' && (
          <>
            <button
              type="button"
              onClick={onToggleWholeFile}
              disabled={isMerging}
              className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
            >
              {allExcluded ? '全ページを含める' : '全ページを除外'}
            </button>
            <button
              type="button"
              onClick={onToggleExpanded}
              aria-expanded={isExpanded}
              aria-controls={`pages-${pdfFile.id}`}
              className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-purple-700 hover:bg-purple-50"
            >
              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              ページ
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onRemove}
          disabled={isMerging}
          className="rounded-lg p-2 text-red-600 hover:bg-red-50 disabled:opacity-40"
          aria-label={`${pdfFile.name}を除外`}
        >
          <Trash2 className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      {pdfFile.status === 'error' && pdfFile.error && (
        <div className="mx-3 mb-3 flex flex-wrap items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3" role="alert">
          <XCircle className="mt-0.5 h-5 w-5 flex-none text-red-600" aria-hidden="true" />
          <div className="min-w-48 flex-1">
            <p className="font-medium text-red-800">{pdfFile.error.title}</p>
            <p className="text-sm text-red-700">{pdfFile.error.message}</p>
            <p className="mt-1 text-sm text-gray-600">{pdfFile.error.suggestion}</p>
          </div>
          <button
            type="button"
            onClick={onRetry}
            disabled={isLoading}
            className="flex items-center gap-1 rounded-lg bg-white px-3 py-2 text-sm font-medium text-red-700 shadow-sm hover:bg-red-100 disabled:opacity-40"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> 再試行
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-white"
          >
            <Ban className="h-4 w-4" aria-hidden="true" /> 除外
          </button>
        </div>
      )}

      {pdfFile.status === 'ready' && isExpanded && (
        <div id={`pages-${pdfFile.id}`} className="border-t border-gray-100 p-3">
          <ul className="flex gap-3 overflow-x-auto pb-2" aria-label={`${pdfFile.name}のページ`}>
            {pdfFile.pages.map((page) => (
              <li key={page.id} className={`w-24 flex-none ${page.excluded ? 'opacity-50' : ''}`}>
                <button
                  type="button"
                  onClick={() => onTogglePageExcluded(page.id)}
                  disabled={isMerging}
                  aria-pressed={page.excluded}
                  className="w-full rounded-lg border border-gray-200 p-2 text-center hover:border-purple-400 focus-visible:outline-2 focus-visible:outline-purple-600"
                >
                  <img src={page.thumbnail} alt="" className="mx-auto h-24 w-full object-contain" />
                  <span className="mt-1 block text-xs text-gray-700">
                    {page.sourcePageIndex + 1}ページ・{page.excluded ? '除外中' : '含める'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

import { CheckCircle2, Clock3, FileUp, Redo2, RotateCcw, ShieldCheck, Trash2, Undo2 } from 'lucide-react';
import { formatBytes } from '../../utils/format';

export type DraftStatus = 'idle' | 'saving' | 'saved' | 'error';

interface PdfEditorFileBarProps {
  file: File;
  displayPageCount: number;
  originalPageCount: number;
  isDirty: boolean;
  /** 墨消しの完全削除を検証した日時（未検証なら null） */
  redactionVerifiedAt: number | null;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  autoSaveEnabled: boolean;
  onAutoSaveChange: (enabled: boolean) => void;
  draftStatus: DraftStatus;
  draftSavedAt: number | null;
  storageSummary: { usage: number; quota: number };
  onDeleteDraft: () => void;
  onChangeFile: () => void;
}

export function PdfEditorFileBar({
  file,
  displayPageCount,
  originalPageCount,
  isDirty,
  redactionVerifiedAt,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  autoSaveEnabled,
  onAutoSaveChange,
  draftStatus,
  draftSavedAt,
  storageSummary,
  onDeleteDraft,
  onChangeFile,
}: PdfEditorFileBarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <FileUp className="h-5 w-5 shrink-0 text-amber-600" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-gray-700">{file.name}</p>
            <p className="text-xs text-gray-500">
              {displayPageCount} ページ / 元ファイル {originalPageCount} ページ / {formatBytes(file.size)}
            </p>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${isDirty ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`} aria-live="polite">
          {isDirty ? <Clock3 className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          {isDirty ? '未保存' : '保存済み'}
        </span>
        {redactionVerifiedAt && (
          <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800" title={`最終検証: ${new Date(redactionVerifiedAt).toLocaleString('ja-JP')}`}>
            <ShieldCheck className="h-3.5 w-3.5" />完全削除を検証済み
          </span>
        )}
        <button type="button" onClick={onUndo} disabled={!canUndo} title="元に戻す (Ctrl/Cmd+Z)" className="rounded-lg bg-white p-2 text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-40"><Undo2 className="h-4 w-4" /></button>
        <button type="button" onClick={onRedo} disabled={!canRedo} title="やり直す (Ctrl/Cmd+Shift+Z)" className="rounded-lg bg-white p-2 text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-40"><Redo2 className="h-4 w-4" /></button>
        <label className="flex items-center gap-1.5 rounded-lg bg-white px-2 py-1.5 text-xs text-gray-600 shadow-sm" title="元PDFと編集内容をこの端末内のIndexedDBに保存します">
          <input type="checkbox" checked={autoSaveEnabled} onChange={(event) => onAutoSaveChange(event.target.checked)} />
          自動保存
          {draftStatus === 'saving' && '中…'}
          {draftStatus === 'saved' && draftSavedAt && ` ${new Date(draftSavedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`}
          {draftStatus === 'error' && ' 失敗'}
        </label>
        {storageSummary.quota > 0 && (
          <span className="text-[11px] text-gray-500" title="ブラウザ保存領域の使用量">
            {formatBytes(storageSummary.usage)} / {formatBytes(storageSummary.quota)}
          </span>
        )}
        <button
          type="button"
          onClick={onDeleteDraft}
          title="ローカル下書きを削除して自動保存をオフにする"
          aria-label="ローカル下書きを削除"
          className="rounded-lg bg-white p-2 text-gray-500 shadow-sm hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-4 w-4" />
        </button>
        <button type="button" onClick={onChangeFile} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-amber-100 hover:text-gray-800">
          <RotateCcw className="h-4 w-4" />ファイルを変更
        </button>
      </div>
    </div>
  );
}

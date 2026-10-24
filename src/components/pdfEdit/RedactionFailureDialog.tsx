import { AlertTriangle, X } from 'lucide-react';
import type { RedactionVerificationError } from '../../utils/contentEditOperations';

interface RedactionFailureDialogProps {
  error: RedactionVerificationError;
  isBusy: boolean;
  onClose: () => void;
  onBackToEdit: () => void;
  onRetryWithCover: () => void;
}

export function RedactionFailureDialog({
  error,
  isBusy,
  onClose,
  onBackToEdit,
  onRetryWithCover,
}: RedactionFailureDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="redaction-failure-title">
      <div className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-7 w-7 shrink-0 text-red-600" />
            <div>
              <h2 id="redaction-failure-title" className="text-lg font-bold text-gray-900">完全削除を確認できないため保存を停止しました</h2>
              <p className="mt-2 text-sm text-gray-600">見た目は隠れても、次の文字データを抽出できる可能性があります。</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="閉じる" className="rounded p-1 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>
        <ul className="mt-4 max-h-52 space-y-2 overflow-auto rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error.residual.map((item) => (
            <li key={item.id}>ページ {item.pageIndex + 1}: 「{item.text}」</li>
          ))}
        </ul>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onBackToEdit} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">編集へ戻る</button>
          <button type="button" onClick={onRetryWithCover} disabled={isBusy} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50">リスクを理解してカバーのみで再試行</button>
        </div>
        <p className="mt-3 text-xs text-gray-500">カバーのみの保存では、コピー、検索、AIによる抽出などで元の文字が取得される場合があります。</p>
      </div>
    </div>
  );
}

import { AlertTriangle } from 'lucide-react';
import type { PdfLoadIssue } from '../../hooks/usePdfDocument';
import { formatBytes } from '../../utils/format';

interface PdfLoadErrorPanelProps {
  error: PdfLoadIssue | null;
  file: File;
  onRetry: () => void;
  onChooseAnother: () => void;
}

export function PdfLoadErrorPanel({ error, file, onRetry, onChooseAnother }: PdfLoadErrorPanelProps) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-6" role="alert">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-red-600" />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-red-900">{error?.message ?? 'PDFを開けませんでした'}</h2>
          <p className="mt-1 text-sm text-red-700">{error?.action}</p>
          <p className="mt-2 truncate text-xs text-red-600">{file.name}（{formatBytes(file.size)}）</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={onRetry} className="rounded-lg bg-red-700 px-4 py-2 text-sm text-white hover:bg-red-800">再試行</button>
            <button type="button" onClick={onChooseAnother} className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm text-red-700 hover:bg-red-100">別のファイルを選ぶ</button>
          </div>
        </div>
      </div>
    </div>
  );
}

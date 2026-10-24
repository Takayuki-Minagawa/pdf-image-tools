import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { ProgressBar } from '../ProgressBar';

interface PdfOutputStatusProps {
  error: string | null;
  message: string | null;
  /** 画像出力中の進捗（0〜100）。出力中でなければ null */
  imageExportProgress: number | null;
  imageExportFormat: string;
  onCancelImageExport: () => void;
}

export function PdfOutputStatus({
  error,
  message,
  imageExportProgress,
  imageExportFormat,
  onCancelImageExport,
}: PdfOutputStatusProps) {
  return (
    <>
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {message && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-4 text-green-700" role="status">
          <CheckCircle2 className="h-4 w-4 shrink-0" />{message}
        </div>
      )}

      {imageExportProgress !== null && (
        <div className="space-y-2 rounded-lg border border-blue-100 bg-blue-50 p-3">
          <ProgressBar progress={imageExportProgress} label={`編集結果を${imageExportFormat.toUpperCase()}に変換中...`} />
          <button type="button" onClick={onCancelImageExport} className="text-sm text-red-600 underline">画像出力をキャンセル</button>
        </div>
      )}
    </>
  );
}

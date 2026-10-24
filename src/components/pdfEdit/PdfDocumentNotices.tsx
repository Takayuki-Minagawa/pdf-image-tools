import { HardDrive, ShieldCheck } from 'lucide-react';
import { formatBytes } from '../../utils/format';

const MEMORY_WARNING_BYTES = 100 * 1024 * 1024;

interface PdfDocumentNoticesProps {
  estimatedMemoryBytes: number;
  passwordRasterized: boolean;
}

export function PdfDocumentNotices({ estimatedMemoryBytes, passwordRasterized }: PdfDocumentNoticesProps) {
  return (
    <>
      {estimatedMemoryBytes > MEMORY_WARNING_BYTES && (
        <div className="flex items-start gap-2 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
          <HardDrive className="mt-0.5 h-4 w-4 shrink-0" />
          <span>推定メモリ使用量は約{formatBytes(estimatedMemoryBytes)}です。サムネイルは表示範囲だけ遅延生成されます。</span>
        </div>
      )}

      {passwordRasterized && (
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>パスワード保護PDFは編集可能な画像PDFへ変換しました。元のテキスト層は出力に残らず、画質とファイル容量が変わる場合があります。</span>
        </div>
      )}
    </>
  );
}

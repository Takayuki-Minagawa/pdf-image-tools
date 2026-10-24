import { CheckCircle2, Download } from 'lucide-react';
import { formatBytes } from '../../utils/format';
import { sendPdfToEditor } from '../../utils/workflowHandoff';

export interface MergeCompletion {
  url: string;
  blob: Blob;
  filename: string;
  pageCount: number;
  byteLength: number;
  elapsedMs: number;
}

export function MergeCompletionPanel({ completion }: { completion: MergeCompletion }) {
  return (
    <section className="rounded-xl border border-green-300 bg-green-50 p-5 text-left" aria-labelledby="merge-complete-title">
      <div className="flex flex-wrap items-center gap-4">
        <CheckCircle2 className="h-9 w-9 flex-none text-green-600" aria-hidden="true" />
        <div className="min-w-48 flex-1">
          <h3 id="merge-complete-title" className="font-bold text-green-900">PDFを作成しました</h3>
          <p className="text-sm text-green-800">
            {completion.filename}・{completion.pageCount}ページ・{formatBytes(completion.byteLength)}・
            {(completion.elapsedMs / 1000).toFixed(1)}秒
          </p>
        </div>
        <a
          href={completion.url}
          download={completion.filename}
          className="flex items-center gap-2 rounded-lg bg-green-700 px-5 py-2.5 font-medium text-white hover:bg-green-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-800"
        >
          <Download className="h-5 w-5" aria-hidden="true" /> ダウンロード
        </a>
        <button
          type="button"
          onClick={() => sendPdfToEditor(completion.blob, completion.filename)}
          className="rounded-lg px-3 py-2 text-sm font-medium text-green-800 hover:bg-green-100"
        >
          続けて編集
        </button>
      </div>
    </section>
  );
}

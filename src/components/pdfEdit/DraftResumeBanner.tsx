import { Clock3 } from 'lucide-react';
import type { StoredPdfDraft } from '../../utils/draftStorage';

interface DraftResumeBannerProps {
  draft: StoredPdfDraft;
  onResume: () => void;
  onDiscard: () => void;
}

export function DraftResumeBanner({ draft, onResume, onDiscard }: DraftResumeBannerProps) {
  return (
    <section className="rounded-xl border border-blue-200 bg-blue-50 p-4" aria-labelledby="draft-resume-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="draft-resume-title" className="flex items-center gap-2 font-semibold text-blue-900"><Clock3 className="h-5 w-5" />前回の作業を再開できます</h2>
          <p className="mt-1 text-sm text-blue-800">{draft.fileName}・{draft.snapshot.pageEntries.length}ページ・{new Date(draft.savedAt).toLocaleString('ja-JP')}</p>
          <p className="mt-1 text-xs text-blue-700">下書きはこの端末内だけに保存されています。</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onResume} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800">再開</button>
          <button type="button" onClick={onDiscard} className="rounded-lg border border-blue-300 bg-white px-4 py-2 text-sm text-blue-800 hover:bg-blue-100">破棄</button>
        </div>
      </div>
    </section>
  );
}

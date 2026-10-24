interface HistoryEntry {
  index: number;
  label: string;
  createdAt: number;
  active: boolean;
}

interface PdfOutputNameBarProps {
  outputName: string;
  onOutputNameChange: (value: string) => void;
  historyEntries: HistoryEntry[];
  onRestoreHistory: (index: number) => void;
}

export function PdfOutputNameBar({
  outputName,
  onOutputNameChange,
  historyEntries,
  onRestoreHistory,
}: PdfOutputNameBarProps) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-3">
      <label className="min-w-56 flex-1 text-xs text-gray-600">
        PDF出力名
        <div className="mt-1 flex items-center gap-1">
          <input value={outputName} onChange={(event) => onOutputNameChange(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800" />
          <span>.pdf</span>
        </div>
      </label>
      <details className="relative">
        <summary className="cursor-pointer rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700">操作履歴 ({historyEntries.length})</summary>
        <ol className="absolute right-0 z-40 mt-1 max-h-60 w-64 overflow-auto rounded-lg border border-gray-200 bg-white p-2 shadow-xl">
          {historyEntries.map((entry) => (
            <li key={`${entry.createdAt}-${entry.index}`}>
              <button type="button" onClick={() => onRestoreHistory(entry.index)} className={`w-full rounded px-2 py-1.5 text-left text-xs hover:bg-gray-50 ${entry.active ? 'bg-blue-50 font-semibold text-blue-700' : 'text-gray-600'}`}>
                {entry.label}・{new Date(entry.createdAt).toLocaleTimeString('ja-JP')}
              </button>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

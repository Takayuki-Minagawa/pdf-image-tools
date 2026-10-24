import { useId } from 'react';
import { FileText, RotateCcw } from 'lucide-react';
import { isSameMetadata, type PdfDocumentMetadata } from '../../utils/pdfMetadata';

interface DocumentPropertiesEditorProps {
  metadata: PdfDocumentMetadata;
  originalMetadata: PdfDocumentMetadata;
  onChange: (metadata: PdfDocumentMetadata) => void;
}

const FIELDS: Array<{ key: keyof PdfDocumentMetadata; label: string; placeholder: string }> = [
  { key: 'title', label: 'タイトル', placeholder: '例: 2026年10月 月次報告' },
  { key: 'author', label: '作成者', placeholder: '例: 総務部' },
  { key: 'subject', label: 'サブタイトル', placeholder: '例: 社内向け資料' },
  { key: 'keywords', label: 'キーワード', placeholder: '例: 報告, 予算' },
];

/** PDFの文書情報（ビューアーの「プロパティ」に表示される項目）を編集する。 */
export function DocumentPropertiesEditor({ metadata, originalMetadata, onChange }: DocumentPropertiesEditorProps) {
  const idPrefix = useId();
  const changed = !isSameMetadata(metadata, originalMetadata);

  return (
    <details className="relative">
      <summary className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700">
        <FileText className="h-4 w-4" aria-hidden="true" />
        文書情報
        {changed && <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-700">変更あり</span>}
      </summary>
      <div className="absolute right-0 z-40 mt-1 w-72 space-y-2 rounded-lg border border-gray-200 bg-white p-3 shadow-xl">
        {FIELDS.map((field) => (
          <label key={field.key} htmlFor={`${idPrefix}-${field.key}`} className="block text-xs text-gray-600">
            {field.label}
            <input
              id={`${idPrefix}-${field.key}`}
              value={metadata[field.key]}
              onChange={(event) => onChange({ ...metadata, [field.key]: event.target.value })}
              placeholder={field.placeholder}
              className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-800"
            />
          </label>
        ))}
        <p className="text-xs text-gray-500">
          PDF保存・抽出・分割の出力に書き込みます。空欄の項目は削除されます。
        </p>
        {changed && (
          <button
            type="button"
            onClick={() => onChange(originalMetadata)}
            className="flex items-center gap-1 text-xs text-gray-600 underline hover:text-gray-900"
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />元の文書情報に戻す
          </button>
        )}
      </div>
    </details>
  );
}

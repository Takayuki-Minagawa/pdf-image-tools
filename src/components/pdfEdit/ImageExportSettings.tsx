import type { PdfImageExportOptions } from '../../types/pdfEdit';

interface ImageExportSettingsProps {
  options: PdfImageExportOptions;
  totalPages: number;
  selectedCount: number;
  onChange: (options: PdfImageExportOptions) => void;
}

export function ImageExportSettings({ options, totalPages, selectedCount, onChange }: ImageExportSettingsProps) {
  const update = <Key extends keyof PdfImageExportOptions>(key: Key, value: PdfImageExportOptions[Key]) => {
    onChange({ ...options, [key]: value });
  };

  return (
    <details className="rounded-lg border border-blue-200 bg-blue-50/50">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-blue-800">画像出力設定</summary>
      <div className="grid grid-cols-2 gap-3 border-t border-blue-100 p-3 text-xs">
        <label className="col-span-2 space-y-1">
          <span className="block text-gray-600">出力名</span>
          <input value={options.filename} onChange={(event) => update('filename', event.target.value)} className="w-full rounded border border-gray-300 bg-white px-2 py-1.5" />
        </label>
        <label className="space-y-1">
          <span className="block text-gray-600">形式</span>
          <select value={options.format} onChange={(event) => update('format', event.target.value as PdfImageExportOptions['format'])} className="w-full rounded border border-gray-300 bg-white px-2 py-1.5">
            <option value="png">PNG（ロスレス）</option>
            <option value="jpeg">JPEG</option>
            <option value="webp">WebP</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-gray-600">解像度</span>
          <select value={options.scale} onChange={(event) => update('scale', Number(event.target.value))} className="w-full rounded border border-gray-300 bg-white px-2 py-1.5">
            <option value={1}>標準（約72dpi）</option>
            <option value={1.5}>中（約108dpi）</option>
            <option value={2}>高（約144dpi）</option>
            <option value={3}>印刷（約216dpi）</option>
            <option value={4}>最高（約288dpi）</option>
          </select>
        </label>
        {options.format !== 'png' && (
          <label className="col-span-2 space-y-1">
            <span className="flex justify-between text-gray-600"><span>画質</span><span>{Math.round(options.quality * 100)}%</span></span>
            <input type="range" min={0.3} max={1} step={0.05} value={options.quality} onChange={(event) => update('quality', Number(event.target.value))} className="w-full" />
          </label>
        )}
        <fieldset className="col-span-2 space-y-1">
          <legend className="text-gray-600">ページ</legend>
          <div className="flex flex-wrap gap-2">
            {([
              ['all', `すべて (${totalPages})`],
              ['selected', `選択 (${selectedCount})`],
              ['range', '範囲'],
            ] as const).map(([value, label]) => (
              <label key={value} className="flex items-center gap-1">
                <input type="radio" name="image-page-mode" value={value} checked={options.pageMode === value} disabled={value === 'selected' && selectedCount === 0} onChange={() => update('pageMode', value)} />{label}
              </label>
            ))}
          </div>
        </fieldset>
        {options.pageMode === 'range' && (
          <div className="col-span-2 flex items-center gap-2">
            <input aria-label="画像出力の開始ページ" type="number" min={1} max={totalPages} value={options.rangeStart} onChange={(event) => update('rangeStart', Number(event.target.value))} className="w-20 rounded border border-gray-300 px-2 py-1" />
            <span>〜</span>
            <input aria-label="画像出力の終了ページ" type="number" min={1} max={totalPages} value={options.rangeEnd} onChange={(event) => update('rangeEnd', Number(event.target.value))} className="w-20 rounded border border-gray-300 px-2 py-1" />
          </div>
        )}
        <label className="col-span-2 flex items-center gap-2 text-gray-700">
          <input type="checkbox" checked={options.zip} onChange={(event) => update('zip', event.target.checked)} />複数ページをZIPでまとめる
        </label>
      </div>
    </details>
  );
}

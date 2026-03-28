import type { PageNumberingConfig, NumberingFormat, NumberingPosition } from '../../types/pdfEdit';

interface PageNumberEditorProps {
  config: PageNumberingConfig;
  onChange: (config: PageNumberingConfig) => void;
  totalPages: number;
}

const FORMAT_OPTIONS: { value: NumberingFormat; label: string; example: string }[] = [
  { value: 'numeric', label: '数字', example: '1, 2, 3...' },
  { value: 'roman-lower', label: 'ローマ数字 (小文字)', example: 'i, ii, iii...' },
  { value: 'roman-upper', label: 'ローマ数字 (大文字)', example: 'I, II, III...' },
  { value: 'dash-numeric', label: 'ダッシュ付き', example: '- 1 -, - 2 -...' },
];

const POSITION_OPTIONS: { value: NumberingPosition; label: string }[] = [
  { value: 'top-left', label: '左上' },
  { value: 'top-center', label: '中央上' },
  { value: 'top-right', label: '右上' },
  { value: 'bottom-left', label: '左下' },
  { value: 'bottom-center', label: '中央下' },
  { value: 'bottom-right', label: '右下' },
];

export function PageNumberEditor({ config, onChange, totalPages }: PageNumberEditorProps) {
  const update = (updates: Partial<PageNumberingConfig>) => {
    onChange({ ...config, ...updates });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">ページ番号</h3>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
            className="rounded text-amber-600 focus:ring-amber-500"
          />
          <span className="text-sm text-gray-600">有効</span>
        </label>
      </div>

      {config.enabled && (
        <div className="space-y-4">
          {/* Start page & start number */}
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
            <p className="text-xs font-medium text-blue-700">
              開始設定 (例: 3ページ目から「1」として番号を振る)
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  開始ページ (何ページ目から表示)
                </label>
                <input
                  type="number"
                  min={1}
                  max={totalPages}
                  value={config.startPage}
                  onChange={(e) => update({ startPage: Math.max(1, parseInt(e.target.value) || 1) })}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  開始番号 (最初に表示する数字)
                </label>
                <input
                  type="number"
                  min={0}
                  value={config.startNumber}
                  onChange={(e) => update({ startNumber: parseInt(e.target.value) || 1 })}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
            </div>
            {config.startPage > 1 && (
              <p className="text-xs text-blue-600">
                {config.startPage}ページ目から「{config.startNumber}」として番号を表示します。
                1〜{config.startPage - 1}ページには番号は付きません。
              </p>
            )}
          </div>

          {/* Format */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">表示形式</label>
            <div className="space-y-1">
              {FORMAT_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer border transition-colors ${
                    config.format === opt.value
                      ? 'border-amber-400 bg-amber-50'
                      : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="numberFormat"
                    value={opt.value}
                    checked={config.format === opt.value}
                    onChange={() => update({ format: opt.value })}
                    className="text-amber-600 focus:ring-amber-500"
                  />
                  <span className="text-sm text-gray-700">{opt.label}</span>
                  <span className="text-xs text-gray-400 ml-auto">{opt.example}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Position */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">配置位置</label>
            <div className="grid grid-cols-3 gap-1">
              {POSITION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => update({ position: opt.value })}
                  className={`px-2 py-2 text-xs font-medium rounded border transition-colors ${
                    config.position === opt.value
                      ? 'bg-amber-500 text-white border-amber-500'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Prefix / Suffix (hidden for dash-numeric) */}
          {config.format !== 'dash-numeric' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">接頭辞</label>
                <input
                  type="text"
                  value={config.prefix}
                  onChange={(e) => update({ prefix: e.target.value })}
                  placeholder='例: "Page "'
                  className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">接尾辞</label>
                <input
                  type="text"
                  value={config.suffix}
                  onChange={(e) => update({ suffix: e.target.value })}
                  placeholder='例: " ページ"'
                  className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
            </div>
          )}

          {/* Font settings */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">フォントサイズ</label>
              <input
                type="number"
                min={6}
                max={24}
                value={config.fontSize}
                onChange={(e) => update({ fontSize: parseInt(e.target.value) || 10 })}
                className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">文字色</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={config.fontColor}
                  onChange={(e) => update({ fontColor: e.target.value })}
                  className="w-8 h-8 rounded border border-gray-300 cursor-pointer"
                />
                <span className="text-xs text-gray-500 font-mono">{config.fontColor}</span>
              </div>
            </div>
          </div>

          {/* Margin */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">端からの距離 (pt)</label>
            <input
              type="number"
              min={5}
              max={200}
              value={config.margin}
              onChange={(e) => update({ margin: parseInt(e.target.value) || 30 })}
              className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
        </div>
      )}
    </div>
  );
}

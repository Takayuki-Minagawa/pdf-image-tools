import type { WatermarkConfig } from '../../types/pdfGraphics';

interface WatermarkEditorProps {
  config: WatermarkConfig;
  onChange: (config: WatermarkConfig) => void;
  currentPageIndex: number;
  totalPages: number;
}

const inputClass = 'w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-400';

export function WatermarkEditor({ config, onChange, currentPageIndex, totalPages }: WatermarkEditorProps) {
  const update = (changes: Partial<WatermarkConfig>) => onChange({ ...config, ...changes });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">透かし</h3>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={config.enabled} onChange={(event) => update({ enabled: event.target.checked })} />
          透かしを表示
        </label>
      </div>
      <p className="text-xs text-gray-500">「社外秘」「DRAFT」などの文字をページ中央に重ねます。</p>
      {config.enabled && (
        <div className="space-y-3">
          <label className="block text-xs font-medium text-gray-600">
            透かしの文字
            <input className={`${inputClass} mt-1`} value={config.text} maxLength={200} placeholder="例: 社外秘" onChange={(event) => update({ text: event.target.value })} />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            透かしの対象ページ
            <select className={`${inputClass} mt-1`} value={config.pageIndex} onChange={(event) => update({ pageIndex: Number(event.target.value) })}>
              <option value={-1}>全ページ</option>
              {Array.from({ length: totalPages }, (_, index) => (
                <option key={index} value={index}>{index + 1} ページ{index === currentPageIndex ? '（表示中）' : ''}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs font-medium text-gray-600">
              文字サイズ (pt)
              <input type="number" min={8} max={200} className={`${inputClass} mt-1`} value={config.fontSize} onChange={(event) => {
                const value = event.target.valueAsNumber;
                if (Number.isFinite(value)) update({ fontSize: Math.min(200, Math.max(8, value)) });
              }} />
            </label>
            <label className="block text-xs font-medium text-gray-600">
              文字色
              <input type="color" className="block w-full h-9 mt-1 rounded border border-gray-300" value={config.color} onChange={(event) => update({ color: event.target.value })} />
            </label>
          </div>
          <label className="block text-xs font-medium text-gray-600">
            不透明度: {Math.round(config.opacity * 100)}%
            <input type="range" min={5} max={100} step={1} className="block w-full mt-2 accent-amber-500" value={Math.round(config.opacity * 100)} onChange={(event) => update({ opacity: Number(event.target.value) / 100 })} />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            回転角度 (°)
            <input type="number" min={-180} max={180} className={`${inputClass} mt-1`} value={config.rotation} onChange={(event) => {
              const value = event.target.valueAsNumber;
              if (Number.isFinite(value)) update({ rotation: Math.min(180, Math.max(-180, value)) });
            }} />
          </label>
        </div>
      )}
    </div>
  );
}

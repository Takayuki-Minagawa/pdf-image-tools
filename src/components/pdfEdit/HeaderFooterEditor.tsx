import { useRef } from 'react';
import { AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import type { HeaderFooterSettings, HeaderFooterConfig } from '../../types/pdfEdit';

interface HeaderFooterEditorProps {
  settings: HeaderFooterSettings;
  onChange: (settings: HeaderFooterSettings) => void;
}

const PLACEHOLDERS = [
  { label: 'ページ番号', value: '{{page}}' },
  { label: '総ページ数', value: '{{total}}' },
  { label: '日付', value: '{{date}}' },
  { label: 'ファイル名', value: '{{filename}}' },
];

function SectionEditor({
  label,
  config,
  onChange,
}: {
  label: string;
  config: HeaderFooterConfig;
  onChange: (config: HeaderFooterConfig) => void;
}) {
  const leftRef = useRef<HTMLInputElement>(null);
  const centerRef = useRef<HTMLInputElement>(null);
  const rightRef = useRef<HTMLInputElement>(null);
  const lastFocusedRef = useRef<HTMLInputElement | null>(null);

  const insertPlaceholder = (placeholder: string) => {
    const target = lastFocusedRef.current;
    if (!target) return;

    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? target.value.length;
    const newValue = target.value.slice(0, start) + placeholder + target.value.slice(end);

    const field = target === leftRef.current ? 'left' : target === centerRef.current ? 'center' : 'right';
    onChange({ ...config, [field]: newValue });

    requestAnimationFrame(() => {
      target.focus();
      const newPos = start + placeholder.length;
      target.setSelectionRange(newPos, newPos);
    });
  };

  const handleFocus = (ref: React.RefObject<HTMLInputElement | null>) => {
    lastFocusedRef.current = ref.current;
  };

  return (
    <div className={`border rounded-lg p-3 space-y-3 ${config.enabled ? 'border-amber-300 bg-amber-50/30' : 'border-gray-200'}`}>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(e) => onChange({ ...config, enabled: e.target.checked })}
          className="rounded text-amber-600 focus:ring-amber-500"
        />
        <span className="text-sm font-semibold text-gray-700">{label}を有効にする</span>
      </label>

      {config.enabled && (
        <>
          {/* Placeholder buttons */}
          <div className="flex flex-wrap gap-1">
            {PLACEHOLDERS.map((ph) => (
              <button
                key={ph.value}
                onClick={() => insertPlaceholder(ph.value)}
                className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded hover:bg-amber-100 hover:text-amber-700 transition-colors border border-gray-200"
              >
                {ph.label}
              </button>
            ))}
          </div>

          {/* Left / Center / Right inputs */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <AlignLeft className="w-4 h-4 text-gray-400 shrink-0" />
              <input
                ref={leftRef}
                type="text"
                value={config.left}
                onChange={(e) => onChange({ ...config, left: e.target.value })}
                onFocus={() => handleFocus(leftRef)}
                placeholder="左"
                className="flex-1 px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <div className="flex items-center gap-2">
              <AlignCenter className="w-4 h-4 text-gray-400 shrink-0" />
              <input
                ref={centerRef}
                type="text"
                value={config.center}
                onChange={(e) => onChange({ ...config, center: e.target.value })}
                onFocus={() => handleFocus(centerRef)}
                placeholder="中央"
                className="flex-1 px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <div className="flex items-center gap-2">
              <AlignRight className="w-4 h-4 text-gray-400 shrink-0" />
              <input
                ref={rightRef}
                type="text"
                value={config.right}
                onChange={(e) => onChange({ ...config, right: e.target.value })}
                onFocus={() => handleFocus(rightRef)}
                placeholder="右"
                className="flex-1 px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
          </div>

          {/* Font & Margin settings */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">フォントサイズ</label>
              <input
                type="number"
                min={6}
                max={24}
                value={config.fontSize}
                onChange={(e) => onChange({ ...config, fontSize: parseInt(e.target.value) || 10 })}
                className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">文字色</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={config.fontColor}
                  onChange={(e) => onChange({ ...config, fontColor: e.target.value })}
                  className="w-8 h-8 rounded border border-gray-300 cursor-pointer"
                />
                <span className="text-xs text-gray-500 font-mono">{config.fontColor}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {label === 'ヘッダー' ? '上端からの距離' : '下端からの距離'} (pt)
              </label>
              <input
                type="number"
                min={5}
                max={200}
                value={config.margin}
                onChange={(e) => onChange({ ...config, margin: parseInt(e.target.value) || 30 })}
                className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">左右余白 (pt)</label>
              <input
                type="number"
                min={5}
                max={200}
                value={config.marginHorizontal}
                onChange={(e) => onChange({ ...config, marginHorizontal: parseInt(e.target.value) || 40 })}
                className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function HeaderFooterEditor({ settings, onChange }: HeaderFooterEditorProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-700">ヘッダー / フッター</h3>

      <SectionEditor
        label="ヘッダー"
        config={settings.header}
        onChange={(header) => onChange({ ...settings, header })}
      />

      <SectionEditor
        label="フッター"
        config={settings.footer}
        onChange={(footer) => onChange({ ...settings, footer })}
      />

      <div className="text-xs text-gray-400 bg-gray-50 p-2 rounded space-y-1">
        <p className="font-medium text-gray-500">使用可能なプレースホルダー:</p>
        <p>{'{{page}}'} ... 現在のページ番号</p>
        <p>{'{{total}}'} ... 総ページ数</p>
        <p>{'{{date}}'} ... 今日の日付 (YYYY/MM/DD)</p>
        <p>{'{{filename}}'} ... ファイル名</p>
      </div>
    </div>
  );
}

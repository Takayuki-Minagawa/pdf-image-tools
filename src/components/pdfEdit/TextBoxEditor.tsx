import { Plus, Trash2, ChevronDown, ChevronUp, MousePointer2 } from 'lucide-react';
import type { TextBoxConfig, BorderStyle } from '../../types/pdfEdit';
import { createDefaultTextBox } from '../../types/pdfEdit';

interface TextBoxEditorProps {
  textBoxes: TextBoxConfig[];
  onChange: (textBoxes: TextBoxConfig[]) => void;
  totalPages: number;
  activeTextBoxId: string | null;
  onActiveChange: (id: string | null) => void;
}

export function TextBoxEditor({
  textBoxes,
  onChange,
  totalPages,
  activeTextBoxId,
  onActiveChange,
}: TextBoxEditorProps) {
  const addTextBox = () => {
    const newBox = createDefaultTextBox(0);
    onChange([...textBoxes, newBox]);
    onActiveChange(newBox.id);
  };

  const removeTextBox = (id: string) => {
    onChange(textBoxes.filter((b) => b.id !== id));
    if (activeTextBoxId === id) onActiveChange(null);
  };

  const updateTextBox = (id: string, updates: Partial<TextBoxConfig>) => {
    onChange(textBoxes.map((b) => (b.id === id ? { ...b, ...updates } : b)));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">テキストボックス</h3>
        <button
          onClick={addTextBox}
          className="flex items-center gap-1 px-3 py-1.5 bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 transition-colors text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          追加
        </button>
      </div>

      {textBoxes.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-4">
          テキストボックスがありません。「追加」ボタンで作成してください。
        </p>
      )}

      {textBoxes.map((box) => {
        const isOpen = activeTextBoxId === box.id;
        return (
          <div
            key={box.id}
            className={`border rounded-lg overflow-hidden transition-colors ${
              isOpen ? 'border-amber-400 bg-amber-50/50' : 'border-gray-200'
            }`}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-gray-50"
              onClick={() => onActiveChange(isOpen ? null : box.id)}
            >
              <div className="flex items-center gap-2 text-sm font-medium text-gray-700 min-w-0">
                {isOpen ? <ChevronUp className="w-4 h-4 shrink-0" /> : <ChevronDown className="w-4 h-4 shrink-0" />}
                <span className="truncate">{box.text || '(空)'}</span>
                <span className="text-xs text-gray-400 shrink-0">
                  {box.pageIndex === -1 ? '全ページ' : `P.${box.pageIndex + 1}`}
                </span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeTextBox(box.id);
                }}
                className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            {isOpen && (
              <div className="px-3 pb-3 space-y-3 border-t border-gray-100">
                {/* Placement hint */}
                <div className="flex items-center gap-1.5 mt-2 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded">
                  <MousePointer2 className="w-3 h-3" />
                  プレビュー上をクリックして位置を設定できます
                </div>

                {/* Text */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">テキスト</label>
                  <textarea
                    value={box.text}
                    onChange={(e) => updateTextBox(box.id, { text: e.target.value })}
                    rows={2}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>

                {/* Page */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">対象ページ</label>
                  <select
                    value={box.pageIndex}
                    onChange={(e) => updateTextBox(box.id, { pageIndex: parseInt(e.target.value) })}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  >
                    <option value={-1}>全ページ</option>
                    {Array.from({ length: totalPages }, (_, i) => (
                      <option key={i} value={i}>
                        {i + 1} ページ
                      </option>
                    ))}
                  </select>
                </div>

                {/* Position */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">X (pt)</label>
                    <input
                      type="number"
                      value={box.x}
                      onChange={(e) => updateTextBox(box.id, { x: parseFloat(e.target.value) || 0 })}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Y (pt)</label>
                    <input
                      type="number"
                      value={box.y}
                      onChange={(e) => updateTextBox(box.id, { y: parseFloat(e.target.value) || 0 })}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                </div>

                {/* Size */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">幅 (pt)</label>
                    <input
                      type="number"
                      min={10}
                      value={box.width}
                      onChange={(e) => updateTextBox(box.id, { width: parseFloat(e.target.value) || 10 })}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">高さ (pt)</label>
                    <input
                      type="number"
                      min={10}
                      value={box.height}
                      onChange={(e) => updateTextBox(box.id, { height: parseFloat(e.target.value) || 10 })}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                </div>

                {/* Font */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">フォントサイズ</label>
                    <input
                      type="number"
                      min={4}
                      max={72}
                      value={box.fontSize}
                      onChange={(e) => updateTextBox(box.id, { fontSize: parseInt(e.target.value) || 12 })}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">文字色</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={box.fontColor}
                        onChange={(e) => updateTextBox(box.id, { fontColor: e.target.value })}
                        className="w-8 h-8 rounded border border-gray-300 cursor-pointer"
                      />
                      <span className="text-xs text-gray-500 font-mono">{box.fontColor}</span>
                    </div>
                  </div>
                </div>

                {/* Background */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">背景色</label>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-gray-600">
                      <input
                        type="checkbox"
                        checked={box.backgroundColor === 'transparent'}
                        onChange={(e) =>
                          updateTextBox(box.id, {
                            backgroundColor: e.target.checked ? 'transparent' : '#ffffff',
                          })
                        }
                        className="rounded"
                      />
                      透明
                    </label>
                    {box.backgroundColor !== 'transparent' && (
                      <input
                        type="color"
                        value={box.backgroundColor}
                        onChange={(e) => updateTextBox(box.id, { backgroundColor: e.target.value })}
                        className="w-8 h-8 rounded border border-gray-300 cursor-pointer"
                      />
                    )}
                  </div>
                </div>

                {/* Border */}
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-gray-500">枠線</label>
                  <div className="grid grid-cols-3 gap-2">
                    <select
                      value={box.borderStyle}
                      onChange={(e) => updateTextBox(box.id, { borderStyle: e.target.value as BorderStyle })}
                      className="px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    >
                      <option value="solid">実線</option>
                      <option value="dashed">破線</option>
                      <option value="dotted">点線</option>
                      <option value="none">なし</option>
                    </select>
                    {box.borderStyle !== 'none' && (
                      <>
                        <input
                          type="number"
                          min={0.5}
                          max={10}
                          step={0.5}
                          value={box.borderWidth}
                          onChange={(e) =>
                            updateTextBox(box.id, { borderWidth: parseFloat(e.target.value) || 1 })
                          }
                          placeholder="太さ"
                          className="px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                        <input
                          type="color"
                          value={box.borderColor}
                          onChange={(e) => updateTextBox(box.id, { borderColor: e.target.value })}
                          className="w-full h-8 rounded border border-gray-300 cursor-pointer"
                        />
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

import { Loader2, MousePointer2, Trash2, Undo2 } from 'lucide-react';
import type {
  ContentEdit,
  PathContentEdit,
  RecognizedItem,
  RecognizedPathItem,
  RecognizedShape,
  RecognizedTextItem,
  TextContentEdit,
} from '../../types/contentEdit';
import { createPathEdit, createTextEdit } from '../../types/contentEdit';

interface ContentEditPanelProps {
  isRecognizing: boolean;
  hasRecognized: boolean;
  items: RecognizedItem[];
  selectedItem: RecognizedItem | null;
  edits: ContentEdit[];
  onUpsertEdit: (edit: ContentEdit) => void;
  onRemoveEdit: (targetId: string) => void;
  onSelectItem: (id: string | null) => void;
}

const SHAPE_LABELS: Record<RecognizedShape, string> = {
  line: 'ライン',
  polyline: 'ポリライン',
  polygon: 'ポリゴン',
  rectangle: '矩形',
};

function summarizeEdit(edit: ContentEdit): string {
  if (edit.kind === 'text') {
    const label = edit.target.text.length > 12 ? `${edit.target.text.slice(0, 12)}…` : edit.target.text;
    return edit.action === 'delete' ? `「${label}」を削除` : `「${label}」を置換`;
  }
  const label = SHAPE_LABELS[edit.target.shape];
  return edit.action === 'delete' ? `${label}を削除` : `${label}のスタイル変更`;
}

const inputClass =
  'w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-400';
const labelClass = 'block text-xs font-medium text-gray-500 mb-1';

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-8 h-8 rounded border border-gray-300 cursor-pointer"
        />
        <span className="text-xs text-gray-500 font-mono">{value}</span>
      </div>
    </div>
  );
}

function TextEditForm({
  target,
  edit,
  onUpsertEdit,
}: {
  target: RecognizedTextItem;
  edit: TextContentEdit | null;
  onUpsertEdit: (edit: ContentEdit) => void;
}) {
  const current = edit ?? createTextEdit(target);
  const update = (patch: Partial<TextContentEdit>) =>
    onUpsertEdit({ ...current, action: 'replace', ...patch });

  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>元のテキスト</label>
        <p className="px-2 py-1.5 bg-gray-50 border border-gray-200 rounded-md text-sm text-gray-600 break-all">
          {target.text}
        </p>
      </div>

      <div>
        <label className={labelClass}>新しいテキスト</label>
        <textarea
          value={edit ? edit.newText : target.text}
          onChange={(e) => update({ newText: e.target.value })}
          rows={2}
          className={`${inputClass} resize-none`}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass}>フォントサイズ</label>
          <input
            type="number"
            min={4}
            max={144}
            value={current.fontSize}
            onChange={(e) => update({ fontSize: parseFloat(e.target.value) || target.fontSize })}
            className={inputClass}
          />
        </div>
        <ColorField
          label="文字色"
          value={current.fontColor}
          onChange={(fontColor) => update({ fontColor })}
        />
      </div>

      <ColorField
        label="カバー色（元の文字を塗り潰す色）"
        value={current.coverColor}
        onChange={(coverColor) => update({ coverColor })}
      />
    </div>
  );
}

function PathEditForm({
  target,
  edit,
  onUpsertEdit,
}: {
  target: RecognizedPathItem;
  edit: PathContentEdit | null;
  onUpsertEdit: (edit: ContentEdit) => void;
}) {
  const current = edit ?? createPathEdit(target);
  const update = (patch: Partial<PathContentEdit>) =>
    onUpsertEdit({ ...current, action: 'restyle', ...patch });

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        種類: {SHAPE_LABELS[target.shape]}（{target.points.length}点
        {target.stroked ? ' / 線あり' : ''}
        {target.filled ? ' / 塗りあり' : ''}）
      </p>

      {target.stroked && (
        <div className="grid grid-cols-2 gap-2">
          <ColorField
            label="線色"
            value={current.strokeColor}
            onChange={(strokeColor) => update({ strokeColor })}
          />
          <div>
            <label className={labelClass}>線幅 (pt)</label>
            <input
              type="number"
              min={0.1}
              max={20}
              step={0.1}
              value={current.lineWidth}
              onChange={(e) => update({ lineWidth: parseFloat(e.target.value) || target.lineWidth })}
              className={inputClass}
            />
          </div>
        </div>
      )}

      {target.filled && (
        <ColorField
          label="塗り色"
          value={current.fillColor}
          onChange={(fillColor) => update({ fillColor })}
        />
      )}

      <ColorField
        label="カバー色（元の図形を塗り潰す色）"
        value={current.coverColor}
        onChange={(coverColor) => update({ coverColor })}
      />
    </div>
  );
}

export function ContentEditPanel({
  isRecognizing,
  hasRecognized,
  items,
  selectedItem,
  edits,
  onUpsertEdit,
  onRemoveEdit,
  onSelectItem,
}: ContentEditPanelProps) {
  const textCount = items.filter((item) => item.kind === 'text').length;
  const pathCount = items.length - textCount;

  const selectedEdit = selectedItem
    ? (edits.find((edit) => edit.target.id === selectedItem.id) ?? null)
    : null;

  const handleDelete = () => {
    if (!selectedItem) return;
    const base =
      selectedItem.kind === 'text' ? createTextEdit(selectedItem) : createPathEdit(selectedItem);
    onUpsertEdit({ ...(selectedEdit ?? base), action: 'delete' } as ContentEdit);
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-700">コンテンツ編集</h3>

      {isRecognizing ? (
        <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          ページを解析中...
        </div>
      ) : hasRecognized ? (
        <p className="text-xs text-gray-500">
          このページで テキスト {textCount}件 / 図形 {pathCount}件 を認識しました。
        </p>
      ) : (
        <p className="text-xs text-gray-500">ページを解析するとここに結果が表示されます。</p>
      )}

      {hasRecognized && !isRecognizing && items.length > 0 && !selectedItem && (
        <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 px-2 py-1.5 rounded">
          <MousePointer2 className="w-3 h-3 shrink-0" />
          プレビュー上の要素をクリックして選択してください
        </div>
      )}

      {selectedItem && (
        <div className="border border-amber-300 bg-amber-50/40 rounded-lg p-3 space-y-3">
          {selectedEdit?.action === 'delete' ? (
            <p className="text-sm text-red-600 font-medium">この要素は削除されます。</p>
          ) : selectedItem.kind === 'text' ? (
            <TextEditForm
              target={selectedItem}
              edit={selectedEdit?.kind === 'text' ? selectedEdit : null}
              onUpsertEdit={onUpsertEdit}
            />
          ) : (
            <PathEditForm
              target={selectedItem}
              edit={selectedEdit?.kind === 'path' ? selectedEdit : null}
              onUpsertEdit={onUpsertEdit}
            />
          )}

          <div className="flex gap-2">
            {selectedEdit?.action !== 'delete' && (
              <button
                onClick={handleDelete}
                className="flex flex-1 items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                この要素を削除
              </button>
            )}
            {selectedEdit && (
              <button
                onClick={() => onRemoveEdit(selectedItem.id)}
                className="flex flex-1 items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                <Undo2 className="w-3.5 h-3.5" />
                編集を取り消す
              </button>
            )}
            <button
              onClick={() => onSelectItem(null)}
              className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700"
            >
              選択解除
            </button>
          </div>
        </div>
      )}

      {edits.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold text-gray-600">編集一覧（{edits.length}件）</h4>
          {edits.map((edit) => (
            <div
              key={edit.target.id}
              className="flex items-center justify-between gap-2 px-2 py-1.5 bg-gray-50 border border-gray-200 rounded-md"
            >
              <button
                onClick={() => onSelectItem(edit.target.id)}
                className="min-w-0 flex-1 text-left text-xs text-gray-600 hover:text-gray-800 truncate"
              >
                P.{edit.target.pageIndex + 1} {summarizeEdit(edit)}
              </button>
              <button
                onClick={() => onRemoveEdit(edit.target.id)}
                className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded shrink-0"
                title="この編集を取り消す"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-gray-400">
        編集は「元の要素をカバー色で塗り潰し、新しい内容を上書きする」方式で保存されます。
        背景が単色でない箇所では塗り潰し跡が見える場合があります。
      </p>
    </div>
  );
}

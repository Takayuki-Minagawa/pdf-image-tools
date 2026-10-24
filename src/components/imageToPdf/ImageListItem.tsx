import { useState } from 'react';
import type { DragEvent } from 'react';
import { ChevronDown, ChevronUp, Crop, FileImage, GripVertical, Palette, RotateCw, Trash2 } from 'lucide-react';
import { getEffectiveImageDimensions, getImageAdjustments } from '../../utils/imagesToPdf';
import type { ImageAdjustments, ImageFile } from '../../utils/imagesToPdf';
import { ImageAdjustmentPanel } from './ImageAdjustmentPanel';
import { imagePreviewStyle } from './imagePreviewStyle';

interface ImageListItemProps {
  image: ImageFile;
  index: number;
  imageCount: number;
  isDragged: boolean;
  isCropEditorOpen: boolean;
  onDragStart: () => void;
  onDragOver: (event: DragEvent) => void;
  onDragEnd: () => void;
  /** 0始まりの位置へ移動する（範囲外は無視される） */
  onMoveTo: (toIndex: number) => void;
  onRotate: () => void;
  onAdjust: (update: Partial<ImageAdjustments>) => void;
  onToggleCropEditor: () => void;
  onRemove: () => void;
}

export function ImageListItem({
  image,
  index,
  imageCount,
  isDragged,
  isCropEditorOpen,
  onDragStart,
  onDragOver,
  onDragEnd,
  onMoveTo,
  onRotate,
  onAdjust,
  onToggleCropEditor,
  onRemove,
}: ImageListItemProps) {
  const [isEditingPosition, setIsEditingPosition] = useState(false);
  const [positionValue, setPositionValue] = useState('');
  const adjustments = getImageAdjustments(image);
  const effectiveDimensions = getEffectiveImageDimensions(image);

  const startEditingPosition = () => {
    setIsEditingPosition(true);
    setPositionValue(String(index + 1));
  };

  const commitPosition = () => {
    const target = Number.parseInt(positionValue, 10);
    if (Number.isFinite(target)) onMoveTo(target - 1);
    setIsEditingPosition(false);
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      className={`bg-white border rounded-xl transition-all ${
        isDragged ? 'opacity-50 border-green-400' : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      <div className="flex flex-wrap items-center gap-3 p-3">
        <div className="cursor-grab active:cursor-grabbing p-1 text-gray-400" aria-label="ドラッグして並び替え">
          <GripVertical className="w-5 h-5" />
        </div>

        {isEditingPosition ? (
          <input
            type="number"
            min={1}
            max={imageCount}
            value={positionValue}
            onChange={(event) => setPositionValue(event.target.value)}
            onBlur={commitPosition}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitPosition();
              if (event.key === 'Escape') setIsEditingPosition(false);
            }}
            autoFocus
            aria-label={`${image.file.name}の移動先`}
            className="w-11 h-9 text-center bg-green-50 border-2 border-green-400 text-green-700 font-bold rounded-lg text-sm outline-none"
          />
        ) : (
          <button
            onClick={startEditingPosition}
            className="w-9 h-9 flex items-center justify-center bg-green-100 text-green-700 font-bold rounded-lg text-sm hover:bg-green-200"
            title="クリックして移動先を指定"
          >
            {index + 1}
          </button>
        )}

        <div className="w-20 h-20 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
          <img
            src={image.preview}
            alt={image.file.name}
            className="w-full h-full object-contain transition-transform"
            style={imagePreviewStyle(adjustments)}
          />
        </div>

        <div className="flex-1 min-w-44">
          <div className="flex items-center gap-2">
            <FileImage className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <span className="font-medium text-gray-800 truncate">{image.file.name}</span>
          </div>
          <div className="text-sm text-gray-500">
            {Math.round(effectiveDimensions.width)} × {Math.round(effectiveDimensions.height)} px
            {adjustments.rotation !== 0 && `・${adjustments.rotation}°`}
            {adjustments.grayscale && '・白黒'}
          </div>
          <div className="text-xs text-gray-400">
            更新: {new Date(image.file.lastModified).toLocaleString('ja-JP')}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <button onClick={onRotate} className="p-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors" title="右へ90度回転" aria-label={`${image.file.name}を右へ90度回転`}>
            <RotateCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => onAdjust({ grayscale: !adjustments.grayscale })}
            className={`p-2 rounded-lg transition-colors ${adjustments.grayscale ? 'bg-gray-700 text-white hover:bg-gray-800' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            title="白黒を切り替え"
            aria-pressed={adjustments.grayscale}
          >
            <Palette className="w-4 h-4" />
          </button>
          <button
            onClick={onToggleCropEditor}
            className={`p-2 rounded-lg transition-colors ${isCropEditorOpen ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            title="トリミングとコントラスト"
            aria-expanded={isCropEditorOpen}
          >
            <Crop className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col gap-1">
          <button onClick={() => onMoveTo(index - 1)} disabled={index === 0} className="p-1 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="上に移動">
            <ChevronUp className="w-4 h-4" />
          </button>
          <button onClick={() => onMoveTo(index + 1)} disabled={index === imageCount - 1} className="p-1 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="下に移動">
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>

        <button onClick={onRemove} className="p-2 text-red-500 hover:bg-red-50 rounded-lg" title="削除">
          <Trash2 className="w-5 h-5" />
        </button>
      </div>

      {isCropEditorOpen && (
        <ImageAdjustmentPanel image={image} adjustments={adjustments} onChange={onAdjust} />
      )}
    </div>
  );
}

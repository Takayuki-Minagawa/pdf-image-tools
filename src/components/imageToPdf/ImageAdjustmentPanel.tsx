import type { ImageAdjustments, ImageFile } from '../../utils/imagesToPdf';
import { imagePreviewStyle } from './imagePreviewStyle';

export function ImageAdjustmentPanel({
  image,
  adjustments,
  onChange,
}: {
  image: ImageFile;
  adjustments: ImageAdjustments;
  onChange: (update: Partial<ImageAdjustments>) => void;
}) {
  const cropValues: Array<{ key: keyof ImageAdjustments['crop']; label: string }> = [
    { key: 'top', label: '上' },
    { key: 'right', label: '右' },
    { key: 'bottom', label: '下' },
    { key: 'left', label: '左' },
  ];

  return (
    <div className="border-t border-gray-200 bg-gray-50 p-4 grid md:grid-cols-[160px_1fr] gap-4">
      <div className="h-36 rounded-lg overflow-hidden bg-white border border-gray-200">
        <img src={image.preview} alt="補正プレビュー" className="w-full h-full object-contain" style={imagePreviewStyle(adjustments)} />
      </div>
      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between text-sm text-gray-700 mb-1">
            <span>コントラスト</span><span>{Math.round(adjustments.contrast * 100)}%</span>
          </div>
          <input
            type="range"
            min={50}
            max={200}
            step={5}
            value={Math.round(adjustments.contrast * 100)}
            onChange={(event) => onChange({ contrast: Number(event.target.value) / 100 })}
            className="w-full accent-green-600"
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">端をトリミング</span>
            <button
              onClick={() => onChange({ crop: { top: 0, right: 0, bottom: 0, left: 0 } })}
              className="text-xs text-green-700 hover:underline"
            >
              リセット
            </button>
          </div>
          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2">
            {cropValues.map(({ key, label }) => (
              <label key={key} className="grid grid-cols-[2rem_1fr_3rem] items-center gap-2 text-xs text-gray-600">
                <span>{label}</span>
                <input
                  type="range"
                  min={0}
                  max={40}
                  step={1}
                  value={adjustments.crop[key]}
                  onChange={(event) => onChange({ crop: { ...adjustments.crop, [key]: Number(event.target.value) } })}
                  className="w-full accent-green-600"
                />
                <span className="text-right">{adjustments.crop[key]}%</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

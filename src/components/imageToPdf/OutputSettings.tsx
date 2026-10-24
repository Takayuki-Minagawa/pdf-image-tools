import { Settings2 } from 'lucide-react';
import { getImageAdjustments } from '../../utils/imagesToPdf';
import type { ImageFile, ImagesToPdfOptions, PageDimensions, QualityPreset } from '../../utils/imagesToPdf';
import { clampNumber } from '../../utils/imageToPdfSettings';
import { imagePreviewStyle } from './imagePreviewStyle';

const FIELD_CLASS_NAME = 'w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-green-500';

const QUALITY_LABELS: Record<QualityPreset, { label: string; description: string }> = {
  high: { label: '高画質', description: '印刷・保存向け' },
  standard: { label: '標準', description: '画質と容量のバランス' },
  compact: { label: '軽量', description: '共有・メール向け' },
};

interface OutputSettingsProps {
  options: ImagesToPdfOptions;
  outputName: string;
  previewImage: ImageFile;
  previewPage: PageDimensions | null;
  onOptionsChange: (value: ImagesToPdfOptions | ((current: ImagesToPdfOptions) => ImagesToPdfOptions)) => void;
  onOutputNameChange: (value: string) => void;
  onChoosePreset: (preset: QualityPreset) => void;
}

export function OutputSettings({
  options,
  outputName,
  previewImage,
  previewPage,
  onOptionsChange,
  onOutputNameChange,
  onChoosePreset,
}: OutputSettingsProps) {
  const previewAdjustments = getImageAdjustments(previewImage);
  const previewMargin = previewPage
    ? Math.min(45, options.margin / Math.min(previewPage.width, previewPage.height) * 100)
    : 0;

  return (
    <section className="border border-gray-200 rounded-xl bg-white overflow-hidden" aria-labelledby="pdf-output-settings">
      <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 border-b border-gray-200">
        <Settings2 className="w-5 h-5 text-green-600" />
        <h3 id="pdf-output-settings" className="font-semibold text-gray-800">出力設定とプレビュー</h3>
      </div>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_260px] gap-5 p-4">
        <div className="space-y-5 min-w-0">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
              出力ファイル名
              <div className="flex items-center">
                <input
                  value={outputName}
                  onChange={(event) => onOutputNameChange(event.target.value.replace(/\.pdf$/i, ''))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-l-lg bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="images_to_pdf"
                />
                <span className="px-3 py-2 border border-l-0 border-gray-300 rounded-r-lg bg-gray-50 text-gray-500">.pdf</span>
              </div>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
              ページサイズ
              <select
                value={options.pageSize}
                onChange={(event) => onOptionsChange((current) => ({ ...current, pageSize: event.target.value as ImagesToPdfOptions['pageSize'] }))}
                className={FIELD_CLASS_NAME}
              >
                <option value="original">画像の原寸</option>
                <option value="a4">A4</option>
                <option value="a3">A3</option>
                <option value="b5">B5</option>
                <option value="letter">Letter</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
              向き
              <select
                value={options.orientation}
                onChange={(event) => onOptionsChange((current) => ({ ...current, orientation: event.target.value as ImagesToPdfOptions['orientation'] }))}
                className={FIELD_CLASS_NAME}
              >
                <option value="auto">画像に合わせて自動</option>
                <option value="portrait">縦</option>
                <option value="landscape">横</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
              余白（mm）
              <input
                type="number"
                min={0}
                max={50}
                step={1}
                value={options.margin}
                onChange={(event) => onOptionsChange((current) => ({ ...current, margin: clampNumber(Number(event.target.value), 0, 50) }))}
                className={FIELD_CLASS_NAME}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
              画像の収め方
              <select
                value={options.fit}
                onChange={(event) => onOptionsChange((current) => ({ ...current, fit: event.target.value as ImagesToPdfOptions['fit'] }))}
                className={FIELD_CLASS_NAME}
              >
                <option value="contain">全体を表示（contain）</option>
                <option value="cover">全面に表示（cover）</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
              画像形式
              <select
                value={options.imageFormat}
                onChange={(event) => onOptionsChange((current) => ({ ...current, imageFormat: event.target.value as ImagesToPdfOptions['imageFormat'] }))}
                className={FIELD_CLASS_NAME}
              >
                <option value="auto">自動（透明画像はPNG）</option>
                <option value="png">PNG（透明を保持）</option>
                <option value="jpeg">JPEG（容量優先）</option>
              </select>
            </label>
          </div>

          <div>
            <div className="text-sm font-medium text-gray-700 mb-2">画質プリセット</div>
            <div className="grid sm:grid-cols-3 gap-2">
              {(Object.keys(QUALITY_LABELS) as QualityPreset[]).map((preset) => (
                <button
                  key={preset}
                  onClick={() => onChoosePreset(preset)}
                  className={`text-left p-3 border rounded-lg transition-colors ${
                    options.qualityPreset === preset ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                  aria-pressed={options.qualityPreset === preset}
                >
                  <span className="block font-medium text-gray-800">{QUALITY_LABELS[preset].label}</span>
                  <span className="block text-xs text-gray-500">{QUALITY_LABELS[preset].description}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
              JPEG品質: {Math.round(options.jpegQuality * 100)}%
              <input
                type="range"
                min={30}
                max={100}
                step={1}
                value={Math.round(options.jpegQuality * 100)}
                onChange={(event) => onOptionsChange((current) => ({ ...current, jpegQuality: Number(event.target.value) / 100 }))}
                disabled={options.imageFormat === 'png'}
                className="w-full accent-green-600 disabled:opacity-40"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
              ページ背景色
              <div className="flex gap-2">
                <input
                  type="color"
                  value={options.backgroundColor}
                  onChange={(event) => onOptionsChange((current) => ({ ...current, backgroundColor: event.target.value }))}
                  className="h-10 w-14 border border-gray-300 rounded-lg p-1 bg-white"
                />
                <input
                  value={options.backgroundColor}
                  readOnly
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-800 uppercase focus:outline-none focus:ring-2 focus:ring-green-500"
                  aria-label="背景色のカラーコード"
                />
              </div>
            </label>
          </div>
          <p className="text-xs text-gray-500">
            設定はこの端末に自動保存されます。「自動」はPNG・WebP・GIFの透明部分をPNGとして保持します。
          </p>
        </div>

        <div className="bg-gray-100 rounded-xl p-4 flex flex-col items-center justify-center min-h-72">
          <div className="text-xs font-medium text-gray-500 mb-3">1ページ目のプレビュー</div>
          {previewPage && (
            <div
              className="relative shadow-lg border border-gray-300 overflow-hidden"
              style={{
                width: previewPage.orientation === 'portrait' ? 150 : 210,
                aspectRatio: `${previewPage.width} / ${previewPage.height}`,
                maxHeight: 230,
                backgroundColor: options.backgroundColor,
              }}
            >
              <div
                className="absolute overflow-hidden"
                style={{ inset: `${previewMargin}%` }}
              >
                <img
                  src={previewImage.preview}
                  alt="1ページ目の出力プレビュー"
                  className="w-full h-full"
                  style={{
                    ...imagePreviewStyle(previewAdjustments),
                    objectFit: options.fit,
                  }}
                />
              </div>
            </div>
          )}
          <div className="mt-3 text-xs text-gray-500 text-center">
            {previewPage && `${previewPage.width.toFixed(1)} × ${previewPage.height.toFixed(1)} mm`}
            <br />{options.fit === 'cover' ? '端が切れる場合があります' : '画像全体を収めます'}
          </div>
        </div>
      </div>
    </section>
  );
}

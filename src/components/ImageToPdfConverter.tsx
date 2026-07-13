import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, DragEvent } from 'react';
import {
  ArrowDownUp,
  ChevronDown,
  ChevronUp,
  Crop,
  Download,
  FileImage,
  GripVertical,
  Image,
  Palette,
  RotateCw,
  Send,
  Settings2,
  Trash2,
} from 'lucide-react';
import { Dropzone } from './Dropzone';
import { ProgressBar } from './ProgressBar';
import {
  DEFAULT_IMAGES_TO_PDF_OPTIONS,
  QUALITY_PRESETS,
  getEffectiveImageDimensions,
  getImageAdjustments,
  imagesToPdf,
  loadImage,
  normalizePdfFileName,
  removeDuplicateFiles,
  resolvePageDimensions,
  sortImageFiles,
} from '../utils/imagesToPdf';
import { sendPdfToEditor } from '../utils/workflowHandoff';
import { downloadBlob } from '../utils/download';
import type {
  ImageAdjustments,
  ImageFile,
  ImageRotation,
  ImageSortOrder,
  ImagesToPdfOptions,
  QualityPreset,
} from '../utils/imagesToPdf';

const SETTINGS_STORAGE_KEY = 'pdf-image-tools:image-to-pdf-settings:v1';
const OUTPUT_NAME_STORAGE_KEY = 'pdf-image-tools:image-to-pdf-output-name:v1';
const MAX_IMAGE_FILES = 100;
const MAX_IMAGE_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_INPUT_BYTES = 250 * 1024 * 1024;

const QUALITY_LABELS: Record<QualityPreset, { label: string; description: string }> = {
  high: { label: '高画質', description: '印刷・保存向け' },
  standard: { label: '標準', description: '画質と容量のバランス' },
  compact: { label: '軽量', description: '共有・メール向け' },
};

export default function ImageToPdfConverter() {
  const [images, setImages] = useState<ImageFile[]>([]);
  const [options, setOptions] = useState<ImagesToPdfOptions>(readStoredOptions);
  const [outputName, setOutputName] = useState(() => readStoredString(OUTPUT_NAME_STORAGE_KEY, 'images_to_pdf'));
  const [isConverting, setIsConverting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [cropEditorId, setCropEditorId] = useState<string | null>(null);
  const [lastPdfBlob, setLastPdfBlob] = useState<Blob | null>(null);

  useEffect(() => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(options));
  }, [options]);

  useEffect(() => {
    localStorage.setItem(OUTPUT_NAME_STORAGE_KEY, outputName);
  }, [outputName]);

  useEffect(() => {
    setLastPdfBlob(null);
  }, [images, options, outputName]);

  const previewPage = useMemo(
    () => images[0] ? resolvePageDimensions(images[0], options) : null,
    [images, options],
  );

  const handleDrop = useCallback(async (files: File[]) => {
    setError(null);
    setNotice(null);
    const imageFiles = files.filter(isSupportedImageFile);

    if (imageFiles.length === 0) {
      setError('画像ファイルを選択してください');
      return;
    }

    const deduplicated = removeDuplicateFiles(imageFiles, images);
    if (deduplicated.files.length === 0) {
      setNotice(`${deduplicated.duplicateCount}件の重複画像を除外しました`);
      return;
    }

    const accepted: File[] = [];
    let acceptedBytes = 0;
    let rejectedByLimit = 0;
    for (const file of deduplicated.files) {
      if (accepted.length >= MAX_IMAGE_FILES || file.size > MAX_IMAGE_FILE_BYTES || acceptedBytes + file.size > MAX_TOTAL_INPUT_BYTES) {
        rejectedByLimit += 1;
        continue;
      }
      accepted.push(file);
      acceptedBytes += file.size;
    }

    const loadedImages: ImageFile[] = [];
    let failedCount = 0;
    // 高解像度画像を同時展開するとメモリが急増するため、1件ずつデコードする。
    for (const file of accepted) {
      try {
        loadedImages.push(await loadImage(file));
      } catch {
        failedCount += 1;
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }

    if (loadedImages.length > 0) {
      setImages((previous) => [...previous, ...loadedImages]);
    }
    if (failedCount > 0 || rejectedByLimit > 0) {
      setError(`${failedCount}件を読み込めず、${rejectedByLimit}件を安全上限（1件50MB・合計250MB・100件）により除外しました。読み込み済みの画像は利用できます。`);
    }
    if (deduplicated.duplicateCount > 0) {
      setNotice(`${deduplicated.duplicateCount}件の重複画像を除外しました`);
    }
  }, [images]);

  const handleRemove = useCallback((id: string) => {
    setImages((previous) => previous.filter((image) => image.id !== id));
    setCropEditorId((current) => current === id ? null : current);
  }, []);

  const handleClear = useCallback(() => {
    setImages([]);
    setProgress(0);
    setError(null);
    setNotice(null);
    setCropEditorId(null);
    setLastPdfBlob(null);
  }, []);

  const handleConvert = useCallback(async () => {
    if (images.length === 0) {
      setError('画像を追加してください');
      return;
    }

    setIsConverting(true);
    setProgress(0);
    setError(null);
    setNotice(null);

    try {
      const pdfBlob = await imagesToPdf(images, setProgress, options);
      setLastPdfBlob(pdfBlob);
      const fileName = normalizePdfFileName(outputName);
      downloadBlob(pdfBlob, fileName);
      setNotice(`${fileName} を作成しました`);
    } catch (conversionError) {
      setError('PDFの作成中にエラーが発生しました。画像や設定を確認して再試行してください。');
      console.error(conversionError);
    } finally {
      setIsConverting(false);
    }
  }, [images, options, outputName]);

  const moveUp = (index: number) => {
    if (index <= 0) return;
    setImages((previous) => moveItem(previous, index, index - 1));
  };

  const moveDown = (index: number) => {
    if (index >= images.length - 1) return;
    setImages((previous) => moveItem(previous, index, index + 1));
  };

  const reverseOrder = () => setImages((previous) => [...previous].reverse());

  const applySort = (order: ImageSortOrder) => {
    setImages((previous) => sortImageFiles(previous, order));
  };

  const moveTo = (fromIndex: number, toPosition: number) => {
    const targetIndex = toPosition - 1;
    if (targetIndex < 0 || targetIndex >= images.length || targetIndex === fromIndex) return;
    setImages((previous) => moveItem(previous, fromIndex, targetIndex));
  };

  const startEditing = (index: number) => {
    setEditingIndex(index);
    setEditingValue(String(index + 1));
  };

  const commitEditing = (fromIndex: number) => {
    const target = Number.parseInt(editingValue, 10);
    if (Number.isFinite(target)) moveTo(fromIndex, target);
    setEditingIndex(null);
  };

  const handleDragOver = (event: DragEvent, index: number) => {
    event.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    setImages((previous) => moveItem(previous, draggedIndex, index));
    setDraggedIndex(index);
  };

  const updateAdjustments = (id: string, update: Partial<ImageAdjustments>) => {
    setImages((previous) => previous.map((image) => {
      if (image.id !== id) return image;
      const current = getImageAdjustments(image);
      return {
        ...image,
        adjustments: {
          ...current,
          ...update,
          crop: { ...current.crop, ...update.crop },
        },
      };
    }));
  };

  const rotateImage = (id: string) => {
    const image = images.find((candidate) => candidate.id === id);
    if (!image) return;
    updateAdjustments(id, { rotation: nextRotation(getImageAdjustments(image).rotation) });
  };

  const rotateAll = () => {
    setImages((previous) => previous.map((image) => {
      const adjustments = getImageAdjustments(image);
      return { ...image, adjustments: { ...adjustments, rotation: nextRotation(adjustments.rotation) } };
    }));
  };

  const choosePreset = (preset: QualityPreset) => {
    setOptions((current) => ({
      ...current,
      qualityPreset: preset,
      jpegQuality: QUALITY_PRESETS[preset].jpegQuality,
    }));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-3 bg-green-100 rounded-lg">
          <Image className="w-6 h-6 text-green-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-800">画像 → PDF変換</h2>
          <p className="text-sm text-gray-500">順序や見た目、用紙設定を確認して1つのPDFにまとめます</p>
        </div>
      </div>

      <Dropzone
        accept={['image/*', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']}
        onDrop={handleDrop}
        title="画像ファイルをドラッグ＆ドロップ"
        description="またはクリックしてファイルを選択（複数選択可・重複は自動除外）"
        icon="image"
      />

      <div aria-live="polite" className="space-y-2">
        {error && <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{error}</div>}
        {notice && <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">{notice}</div>}
      </div>

      {images.length > 0 && (
        <div className="space-y-5">
          <OutputSettings
            options={options}
            outputName={outputName}
            previewImage={images[0]}
            previewPage={previewPage}
            onOptionsChange={setOptions}
            onOutputNameChange={setOutputName}
            onChoosePreset={choosePreset}
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-gray-600">
              <span className="font-semibold">{images.length}</span> 枚の画像
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-sm text-gray-600">
                並び替え
                <select
                  defaultValue=""
                  onChange={(event) => {
                    if (event.target.value) applySort(event.target.value as ImageSortOrder);
                    event.target.value = '';
                  }}
                  className="px-3 py-2 border border-gray-300 rounded-lg bg-white"
                  aria-label="画像の並び替え"
                >
                  <option value="" disabled>選択...</option>
                  <option value="natural">ファイル名（自然順）</option>
                  <option value="modified-newest">更新日時（新しい順）</option>
                  <option value="modified-oldest">更新日時（古い順）</option>
                </select>
              </label>
              <button onClick={reverseOrder} className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm" title="順序を逆にする">
                <ArrowDownUp className="w-4 h-4" />逆順
              </button>
              <button onClick={rotateAll} className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm" title="すべて右へ90度回転">
                <RotateCw className="w-4 h-4" />全て回転
              </button>
              <button onClick={handleClear} className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm">
                <Trash2 className="w-4 h-4" />クリア
              </button>
              <button
                onClick={handleConvert}
                disabled={isConverting}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download className="w-4 h-4" />
                {isConverting ? '作成中...' : 'PDFを作成'}
              </button>
              {lastPdfBlob && (
                <button
                  type="button"
                  onClick={() => sendPdfToEditor(lastPdfBlob, normalizePdfFileName(outputName))}
                  className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-amber-800 hover:bg-amber-100"
                >
                  <Send className="h-4 w-4" />続けて編集
                </button>
              )}
            </div>
          </div>

          {isConverting && <ProgressBar progress={progress} label="PDF作成中..." />}

          <div className="text-sm text-gray-600 bg-gray-50 border border-gray-200 p-3 rounded-lg">
            ドラッグ、矢印、番号入力で順序を変更できます。回転・白黒・コントラスト・トリミングは画像ごとに設定できます。
          </div>

          <div className="space-y-3">
            {images.map((image, index) => {
              const adjustments = getImageAdjustments(image);
              const effectiveDimensions = getEffectiveImageDimensions(image);
              const isCropEditorOpen = cropEditorId === image.id;
              return (
                <div
                  key={image.id}
                  draggable
                  onDragStart={() => setDraggedIndex(index)}
                  onDragOver={(event) => handleDragOver(event, index)}
                  onDragEnd={() => setDraggedIndex(null)}
                  className={`bg-white border rounded-xl transition-all ${
                    draggedIndex === index ? 'opacity-50 border-green-400' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-3 p-3">
                    <div className="cursor-grab active:cursor-grabbing p-1 text-gray-400" aria-label="ドラッグして並び替え">
                      <GripVertical className="w-5 h-5" />
                    </div>

                    {editingIndex === index ? (
                      <input
                        type="number"
                        min={1}
                        max={images.length}
                        value={editingValue}
                        onChange={(event) => setEditingValue(event.target.value)}
                        onBlur={() => commitEditing(index)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitEditing(index);
                          if (event.key === 'Escape') setEditingIndex(null);
                        }}
                        autoFocus
                        aria-label={`${image.file.name}の移動先`}
                        className="w-11 h-9 text-center bg-green-50 border-2 border-green-400 text-green-700 font-bold rounded-lg text-sm outline-none"
                      />
                    ) : (
                      <button
                        onClick={() => startEditing(index)}
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
                      <button onClick={() => rotateImage(image.id)} className="p-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors" title="右へ90度回転" aria-label={`${image.file.name}を右へ90度回転`}>
                        <RotateCw className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => updateAdjustments(image.id, { grayscale: !adjustments.grayscale })}
                        className={`p-2 rounded-lg transition-colors ${adjustments.grayscale ? 'bg-gray-700 text-white hover:bg-gray-800' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                        title="白黒を切り替え"
                        aria-pressed={adjustments.grayscale}
                      >
                        <Palette className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setCropEditorId(isCropEditorOpen ? null : image.id)}
                        className={`p-2 rounded-lg transition-colors ${isCropEditorOpen ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                        title="トリミングとコントラスト"
                        aria-expanded={isCropEditorOpen}
                      >
                        <Crop className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="flex flex-col gap-1">
                      <button onClick={() => moveUp(index)} disabled={index === 0} className="p-1 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="上に移動">
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <button onClick={() => moveDown(index)} disabled={index === images.length - 1} className="p-1 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="下に移動">
                        <ChevronDown className="w-4 h-4" />
                      </button>
                    </div>

                    <button onClick={() => handleRemove(image.id)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg" title="削除">
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>

                  {isCropEditorOpen && (
                    <ImageAdjustmentPanel
                      image={image}
                      adjustments={adjustments}
                      onChange={(update) => updateAdjustments(image.id, update)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

interface OutputSettingsProps {
  options: ImagesToPdfOptions;
  outputName: string;
  previewImage: ImageFile;
  previewPage: ReturnType<typeof resolvePageDimensions> | null;
  onOptionsChange: (value: ImagesToPdfOptions | ((current: ImagesToPdfOptions) => ImagesToPdfOptions)) => void;
  onOutputNameChange: (value: string) => void;
  onChoosePreset: (preset: QualityPreset) => void;
}

function OutputSettings({
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
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-green-500"
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
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-green-500"
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
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
              画像の収め方
              <select
                value={options.fit}
                onChange={(event) => onOptionsChange((current) => ({ ...current, fit: event.target.value as ImagesToPdfOptions['fit'] }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-green-500"
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
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-green-500"
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

function ImageAdjustmentPanel({
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

function imagePreviewStyle(adjustments: ImageAdjustments): CSSProperties {
  return {
    transform: `rotate(${adjustments.rotation}deg)`,
    filter: `grayscale(${adjustments.grayscale ? 1 : 0}) contrast(${adjustments.contrast})`,
    clipPath: `inset(${adjustments.crop.top}% ${adjustments.crop.right}% ${adjustments.crop.bottom}% ${adjustments.crop.left}%)`,
  };
}

function nextRotation(rotation: ImageRotation): ImageRotation {
  return ((rotation + 90) % 360) as ImageRotation;
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

function isSupportedImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp)$/i.test(file.name);
}

function readStoredOptions(): ImagesToPdfOptions {
  if (typeof localStorage === 'undefined') return DEFAULT_IMAGES_TO_PDF_OPTIONS;
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}') as Partial<ImagesToPdfOptions>;
    return {
      pageSize: isOneOf(stored.pageSize, ['original', 'a4', 'a3', 'b5', 'letter'])
        ? stored.pageSize : DEFAULT_IMAGES_TO_PDF_OPTIONS.pageSize,
      orientation: isOneOf(stored.orientation, ['auto', 'portrait', 'landscape'])
        ? stored.orientation : DEFAULT_IMAGES_TO_PDF_OPTIONS.orientation,
      margin: clampNumber(stored.margin ?? DEFAULT_IMAGES_TO_PDF_OPTIONS.margin, 0, 50),
      fit: isOneOf(stored.fit, ['contain', 'cover']) ? stored.fit : DEFAULT_IMAGES_TO_PDF_OPTIONS.fit,
      backgroundColor: typeof stored.backgroundColor === 'string' && /^#[0-9a-f]{6}$/i.test(stored.backgroundColor)
        ? stored.backgroundColor : DEFAULT_IMAGES_TO_PDF_OPTIONS.backgroundColor,
      qualityPreset: isOneOf(stored.qualityPreset, ['high', 'standard', 'compact'])
        ? stored.qualityPreset : DEFAULT_IMAGES_TO_PDF_OPTIONS.qualityPreset,
      jpegQuality: clampNumber(stored.jpegQuality ?? DEFAULT_IMAGES_TO_PDF_OPTIONS.jpegQuality, 0.3, 1),
      imageFormat: isOneOf(stored.imageFormat, ['auto', 'jpeg', 'png'])
        ? stored.imageFormat : DEFAULT_IMAGES_TO_PDF_OPTIONS.imageFormat,
    };
  } catch {
    return DEFAULT_IMAGES_TO_PDF_OPTIONS;
  }
}

function readStoredString(key: string, fallback: string): string {
  if (typeof localStorage === 'undefined') return fallback;
  return localStorage.getItem(key) ?? fallback;
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function isOneOf<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === 'string' && choices.includes(value as T);
}

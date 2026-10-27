import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DragEvent } from 'react';
import { ArrowDownUp, Download, Image, RotateCw, Send, Trash2 } from 'lucide-react';
import { Dropzone } from './Dropzone';
import { ProgressBar } from './ProgressBar';
import { ImageListItem } from './imageToPdf/ImageListItem';
import { OutputSettings } from './imageToPdf/OutputSettings';
import {
  QUALITY_PRESETS,
  getImageAdjustments,
  imagesToPdf,
  loadImage,
  normalizePdfFileName,
  removeDuplicateFiles,
  resolvePageDimensions,
  sortImageFiles,
} from '../utils/imagesToPdf';
import {
  IMAGE_TO_PDF_OUTPUT_NAME_STORAGE_KEY,
  IMAGE_TO_PDF_SETTINGS_STORAGE_KEY,
  readStoredImagesToPdfOptions,
  readStoredOutputName,
} from '../utils/imageToPdfSettings';
import { moveItem } from '../utils/arrayUtils';
import { isAbortError, nextFrame, throwIfAborted } from '../utils/async';
import { useOperationLifetime } from '../hooks/useOperationLifetime';
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

const MAX_IMAGE_FILES = 100;
const MAX_IMAGE_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_INPUT_BYTES = 250 * 1024 * 1024;

export default function ImageToPdfConverter() {
  const [images, setImages] = useState<ImageFile[]>([]);
  const [options, setOptions] = useState<ImagesToPdfOptions>(readStoredImagesToPdfOptions);
  const [outputName, setOutputName] = useState(() => readStoredOutputName('images_to_pdf'));
  const [isConverting, setIsConverting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [cropEditorId, setCropEditorId] = useState<string | null>(null);
  const [lastPdfBlob, setLastPdfBlob] = useState<Blob | null>(null);
  const getOperationSignal = useOperationLifetime();

  useEffect(() => {
    localStorage.setItem(IMAGE_TO_PDF_SETTINGS_STORAGE_KEY, JSON.stringify(options));
  }, [options]);

  useEffect(() => {
    localStorage.setItem(IMAGE_TO_PDF_OUTPUT_NAME_STORAGE_KEY, outputName);
  }, [outputName]);

  useEffect(() => {
    setLastPdfBlob(null);
  }, [images, options, outputName]);

  const previewPage = useMemo(
    () => images[0] ? resolvePageDimensions(images[0], options) : null,
    [images, options],
  );

  const handleDrop = useCallback(async (files: File[]) => {
    const signal = getOperationSignal();
    if (signal.aborted) return;
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
      if (signal.aborted) return;
      try {
        const image = await loadImage(file);
        if (signal.aborted) return;
        loadedImages.push(image);
      } catch {
        failedCount += 1;
      }
      await nextFrame();
      if (signal.aborted) return;
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
  }, [getOperationSignal, images]);

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
    const signal = getOperationSignal();
    if (signal.aborted) return;
    if (images.length === 0) {
      setError('画像を追加してください');
      return;
    }

    setIsConverting(true);
    setProgress(0);
    setError(null);
    setNotice(null);

    try {
      const pdfBlob = await imagesToPdf(images, (value) => { if (!signal.aborted) setProgress(value); }, options, signal);
      throwIfAborted(signal);
      setLastPdfBlob(pdfBlob);
      const fileName = normalizePdfFileName(outputName);
      downloadBlob(pdfBlob, fileName);
      setNotice(`${fileName} を作成しました`);
    } catch (conversionError) {
      if (signal.aborted || isAbortError(conversionError)) return;
      setError('PDFの作成中にエラーが発生しました。画像や設定を確認して再試行してください。');
      console.error(conversionError);
    } finally {
      if (!signal.aborted) setIsConverting(false);
    }
  }, [getOperationSignal, images, options, outputName]);

  const reverseOrder = () => setImages((previous) => [...previous].reverse());

  const applySort = (order: ImageSortOrder) => {
    setImages((previous) => sortImageFiles(previous, order));
  };

  const moveTo = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= images.length || toIndex === fromIndex) return;
    setImages((previous) => moveItem(previous, fromIndex, toIndex));
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
                  onClick={() => { if (!getOperationSignal().aborted) sendPdfToEditor(lastPdfBlob, normalizePdfFileName(outputName)); }}
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
            {images.map((image, index) => (
              <ImageListItem
                key={image.id}
                image={image}
                index={index}
                imageCount={images.length}
                isDragged={draggedIndex === index}
                isCropEditorOpen={cropEditorId === image.id}
                onDragStart={() => setDraggedIndex(index)}
                onDragOver={(event) => handleDragOver(event, index)}
                onDragEnd={() => setDraggedIndex(null)}
                onMoveTo={(toIndex) => moveTo(index, toIndex)}
                onRotate={() => rotateImage(image.id)}
                onAdjust={(update) => updateAdjustments(image.id, update)}
                onToggleCropEditor={() => setCropEditorId(cropEditorId === image.id ? null : image.id)}
                onRemove={() => handleRemove(image.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function nextRotation(rotation: ImageRotation): ImageRotation {
  return ((rotation + 90) % 360) as ImageRotation;
}

function isSupportedImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp)$/i.test(file.name);
}

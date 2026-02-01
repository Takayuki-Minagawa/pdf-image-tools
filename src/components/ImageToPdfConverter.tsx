import { useState, useCallback } from 'react';
import { Dropzone } from './Dropzone';
import { ProgressBar } from './ProgressBar';
import { imagesToPdf, loadImage } from '../utils/imagesToPdf';
import type { ImageFile } from '../utils/imagesToPdf';
import { Image, Download, Trash2, GripVertical, ChevronUp, ChevronDown, FileImage } from 'lucide-react';

export function ImageToPdfConverter() {
  const [images, setImages] = useState<ImageFile[]>([]);
  const [isConverting, setIsConverting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const handleDrop = useCallback(async (files: File[]) => {
    setError(null);
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));

    if (imageFiles.length === 0) {
      setError('画像ファイルを選択してください');
      return;
    }

    try {
      const loadedImages = await Promise.all(imageFiles.map(loadImage));
      setImages((prev) => [...prev, ...loadedImages]);
    } catch (err) {
      setError('画像の読み込み中にエラーが発生しました');
      console.error(err);
    }
  }, []);

  const handleRemove = useCallback((id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  const handleClear = useCallback(() => {
    setImages([]);
    setProgress(0);
    setError(null);
  }, []);

  const handleConvert = useCallback(async () => {
    if (images.length === 0) {
      setError('画像を追加してください');
      return;
    }

    setIsConverting(true);
    setProgress(0);
    setError(null);

    try {
      const pdfBlob = await imagesToPdf(images, setProgress);
      const url = URL.createObjectURL(pdfBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'images_to_pdf.pdf';
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError('PDFの作成中にエラーが発生しました');
      console.error(err);
    } finally {
      setIsConverting(false);
    }
  }, [images]);

  const moveUp = (index: number) => {
    if (index <= 0) return;
    const newImages = [...images];
    [newImages[index - 1], newImages[index]] = [newImages[index], newImages[index - 1]];
    setImages(newImages);
  };

  const moveDown = (index: number) => {
    if (index >= images.length - 1) return;
    const newImages = [...images];
    [newImages[index], newImages[index + 1]] = [newImages[index + 1], newImages[index]];
    setImages(newImages);
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newImages = [...images];
    const [draggedItem] = newImages.splice(draggedIndex, 1);
    newImages.splice(index, 0, draggedItem);
    setImages(newImages);
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-3 bg-green-100 rounded-lg">
          <Image className="w-6 h-6 text-green-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-800">画像 → PDF変換</h2>
          <p className="text-sm text-gray-500">複数の画像を1つのPDFにまとめます</p>
        </div>
      </div>

      <Dropzone
        accept={['image/*', '.jpg', '.jpeg', '.png', '.gif', '.webp']}
        onDrop={handleDrop}
        title="画像ファイルをドラッグ＆ドロップ"
        description="またはクリックしてファイルを選択（複数選択可）"
        icon="image"
      />

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-600">
          {error}
        </div>
      )}

      {images.length > 0 && (
        <div className="space-y-4">
          {/* ヘッダー */}
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              <span className="font-medium">{images.length}</span> 枚の画像
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleClear}
                className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors text-sm"
              >
                <Trash2 className="w-4 h-4" />
                クリア
              </button>
              <button
                onClick={handleConvert}
                disabled={isConverting}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download className="w-4 h-4" />
                {isConverting ? '作成中...' : 'PDFを作成'}
              </button>
            </div>
          </div>

          {isConverting && (
            <ProgressBar progress={progress} label="PDF作成中..." />
          )}

          {/* 操作説明 */}
          <div className="text-sm text-gray-500 bg-gray-50 p-3 rounded-lg">
            💡 ドラッグ＆ドロップまたは矢印ボタンで順番を変更できます
          </div>

          {/* 画像リスト */}
          <div className="space-y-2">
            {images.map((image, index) => (
              <div
                key={image.id}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                className={`flex items-center gap-3 p-3 bg-white border rounded-lg transition-all ${
                  draggedIndex === index ? 'opacity-50 border-green-400' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                {/* ドラッグハンドル */}
                <div className="cursor-grab active:cursor-grabbing p-1 text-gray-400 hover:text-gray-600">
                  <GripVertical className="w-5 h-5" />
                </div>

                {/* 順番 */}
                <div className="w-8 h-8 flex items-center justify-center bg-green-100 text-green-700 font-bold rounded-lg text-sm">
                  {index + 1}
                </div>

                {/* サムネイル */}
                <div className="w-16 h-16 bg-gray-100 rounded overflow-hidden flex-shrink-0">
                  <img
                    src={image.preview}
                    alt={image.file.name}
                    className="w-full h-full object-contain"
                  />
                </div>

                {/* ファイル情報 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <FileImage className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <span className="font-medium text-gray-800 truncate">{image.file.name}</span>
                  </div>
                  <div className="text-sm text-gray-500">{image.width} × {image.height} px</div>
                </div>

                {/* 上下移動ボタン */}
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => moveUp(index)}
                    disabled={index === 0}
                    className="p-1 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    title="上に移動"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => moveDown(index)}
                    disabled={index === images.length - 1}
                    className="p-1 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    title="下に移動"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>

                {/* 削除ボタン */}
                <button
                  onClick={() => handleRemove(image.id)}
                  className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  title="削除"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

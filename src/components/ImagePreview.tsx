import { Download, Trash2 } from 'lucide-react';
import type { ConvertedImage } from '../utils/pdfToImages';

interface ImagePreviewProps {
  images: ConvertedImage[];
  onDownload: (image: ConvertedImage) => void;
  onDownloadAll: () => void;
  onClear: () => void;
}

export function ImagePreview({ images, onDownload, onDownloadAll, onClear }: ImagePreviewProps) {
  if (images.length === 0) return null;

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-800">
          変換結果 ({images.length}ページ)
        </h3>
        <div className="flex gap-2">
          <button
            onClick={onDownloadAll}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Download className="w-4 h-4" />
            すべてダウンロード
          </button>
          <button
            onClick={onClear}
            className="flex items-center gap-2 px-4 py-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            クリア
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {images.map((image) => (
          <div
            key={image.pageNumber}
            className="relative group bg-white rounded-lg shadow-md overflow-hidden border border-gray-200"
          >
            <img
              src={image.dataUrl}
              alt={`Page ${image.pageNumber}`}
              className="w-full h-48 object-contain bg-gray-100"
            />
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <button
                onClick={() => onDownload(image)}
                className="p-3 bg-white rounded-full hover:bg-gray-100 transition-colors"
              >
                <Download className="w-5 h-5 text-gray-800" />
              </button>
            </div>
            <div className="p-2 text-center bg-gray-50 border-t border-gray-200">
              <div className="text-sm font-medium text-gray-700">ページ {image.pageNumber}</div>
              <div className="text-xs text-gray-500 mt-1">
                {Math.round(image.width)} × {Math.round(image.height)} px
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

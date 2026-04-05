import { useState, useCallback } from 'react';
import { Dropzone } from './Dropzone';
import { ProgressBar } from './ProgressBar';
import { ImagePreview } from './ImagePreview';
import { pdfToImages } from '../utils/pdfToImages';
import type { ConvertedImage } from '../utils/pdfToImages';
import { Download, FileText, Layers, X } from 'lucide-react';

export function PdfToImageConverter() {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [images, setImages] = useState<ConvertedImage[]>([]);
  const [isConverting, setIsConverting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');

  const handleDrop = useCallback((files: File[]) => {
    const file = files.find((f) => f.type === 'application/pdf');
    if (!file) {
      setError('PDFファイルを選択してください');
      return;
    }

    setError(null);
    setPdfFile(file);
    setFileName(file.name);
    setImages([]);
    setProgress(0);
  }, []);

  const handleConvert = useCallback(async () => {
    if (!pdfFile) return;

    setIsConverting(true);
    setProgress(0);
    setError(null);
    setImages([]);

    try {
      const convertedImages = await pdfToImages(pdfFile, 2, setProgress);
      setImages(convertedImages);
    } catch (err) {
      setError('PDFの変換中にエラーが発生しました');
      console.error(err);
    } finally {
      setIsConverting(false);
    }
  }, [pdfFile]);

  const handleDownload = useCallback((image: ConvertedImage) => {
    const link = document.createElement('a');
    link.href = image.dataUrl;
    link.download = `${fileName.replace('.pdf', '')}_page_${image.pageNumber}.png`;
    link.click();
  }, [fileName]);

  const handleDownloadAll = useCallback(() => {
    images.forEach((image) => {
      handleDownload(image);
    });
  }, [images, handleDownload]);

  const handleClear = useCallback(() => {
    setPdfFile(null);
    setImages([]);
    setProgress(0);
    setFileName('');
    setError(null);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-100 rounded-lg">
            <FileText className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-800">PDF → 画像変換</h2>
            <p className="text-sm text-gray-500">PDFをそのままPNGに変換します</p>
          </div>
        </div>
        {pdfFile && (
          <button
            onClick={handleClear}
            className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
            閉じる
          </button>
        )}
      </div>

      {!pdfFile ? (
        <Dropzone
          accept={['.pdf', 'application/pdf']}
          onDrop={handleDrop}
          title="PDFファイルをドラッグ＆ドロップ"
          description="またはクリックしてファイルを選択"
          icon="upload"
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-4 rounded-xl border border-blue-100 bg-blue-50/60 p-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm text-blue-700">
                <FileText className="h-4 w-4" />
                <span className="truncate font-medium">{fileName}</span>
              </div>
              <p className="mt-2 text-sm text-gray-600">
                ページ削除・並び替え・PDF編集をしたい場合は「PDF編集」タブから処理してください。
              </p>
            </div>
            <button
              onClick={handleConvert}
              disabled={isConverting}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {isConverting ? 'PNGに変換中...' : 'PNGに変換'}
            </button>
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-white p-2 shadow-sm">
                <Layers className="h-5 w-5 text-gray-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-800">変換フロー</h3>
                <p className="mt-1 text-sm text-gray-600">
                  この画面では元のPDFをそのままPNG化します。編集結果をPNGで出力する場合は「PDF編集」で編集後にPNG出力を使います。
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-600">
          {error}
        </div>
      )}

      {isConverting && (
        <ProgressBar progress={progress} label="PNGに変換中..." />
      )}

      <ImagePreview
        images={images}
        onDownload={handleDownload}
        onDownloadAll={handleDownloadAll}
        onClear={() => setImages([])}
      />
    </div>
  );
}

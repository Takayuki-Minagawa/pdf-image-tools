import { useState, useCallback } from 'react';
import { Dropzone } from './Dropzone';
import { ProgressBar } from './ProgressBar';
import { ImagePreview } from './ImagePreview';
import { PdfViewer } from './PdfViewer';
import { pdfToImages } from '../utils/pdfToImages';
import type { ConvertedImage } from '../utils/pdfToImages';
import { FileText, X } from 'lucide-react';

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
            <p className="text-sm text-gray-500">PDFファイルを画像（PNG）に変換します</p>
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
        <>
          <div className="flex items-center gap-2 text-sm text-gray-600 bg-gray-50 p-3 rounded-lg">
            <FileText className="w-4 h-4" />
            <span className="font-medium">{fileName}</span>
          </div>
          <PdfViewer 
            file={pdfFile} 
            onConvert={handleConvert}
            isConverting={isConverting}
          />
        </>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-600">
          {error}
        </div>
      )}

      {isConverting && (
        <ProgressBar progress={progress} label="変換中..." />
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

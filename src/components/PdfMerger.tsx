import { useState, useCallback } from 'react';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  Combine,
  Upload,
  Trash2,
  ChevronUp,
  ChevronDown,
  Download,
  FileText,
  GripVertical,
  ArrowDownUp,
} from 'lucide-react';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface PdfFile {
  id: string;
  file: File;
  name: string;
  pageCount: number;
  thumbnail: string;
  bytes: ArrayBuffer;
}

export function PdfMerger() {
  const [pdfFiles, setPdfFiles] = useState<PdfFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState('');

  const loadPdfFile = async (file: File): Promise<PdfFile> => {
    const arrayBuffer = await file.arrayBuffer();
    const bufferCopy = arrayBuffer.slice(0);
    
    // ページ数を取得
    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pageCount = pdfDoc.numPages;
    
    // サムネイルを生成
    const page = await pdfDoc.getPage(1);
    const viewport = page.getViewport({ scale: 0.3 });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    await page.render({
      canvasContext: context,
      viewport: viewport,
      canvas: canvas,
    }).promise;
    
    const thumbnail = canvas.toDataURL('image/png');
    
    return {
      id: crypto.randomUUID(),
      file,
      name: file.name,
      pageCount,
      thumbnail,
      bytes: bufferCopy,
    };
  };

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const files = Array.from(e.dataTransfer.files).filter(
      (f) => f.type === 'application/pdf'
    );
    
    if (files.length === 0) {
      setError('PDFファイルを選択してください');
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const loadedFiles = await Promise.all(files.map(loadPdfFile));
      setPdfFiles((prev) => [...prev, ...loadedFiles]);
    } catch (err) {
      console.error(err);
      setError('PDFの読み込み中にエラーが発生しました');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files).filter(
      (f) => f.type === 'application/pdf'
    ) : [];
    
    if (files.length === 0) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const loadedFiles = await Promise.all(files.map(loadPdfFile));
      setPdfFiles((prev) => [...prev, ...loadedFiles]);
    } catch (err) {
      console.error(err);
      setError('PDFの読み込み中にエラーが発生しました');
    } finally {
      setIsLoading(false);
    }
    
    e.target.value = '';
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const removeFile = (id: string) => {
    setPdfFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const moveUp = (index: number) => {
    if (index <= 0) return;
    const newFiles = [...pdfFiles];
    [newFiles[index - 1], newFiles[index]] = [newFiles[index], newFiles[index - 1]];
    setPdfFiles(newFiles);
  };

  const moveDown = (index: number) => {
    if (index >= pdfFiles.length - 1) return;
    const newFiles = [...pdfFiles];
    [newFiles[index], newFiles[index + 1]] = [newFiles[index + 1], newFiles[index]];
    setPdfFiles(newFiles);
  };

  const reverseOrder = () => {
    setPdfFiles((prev) => [...prev].reverse());
  };

  const moveTo = (fromIndex: number, toPosition: number) => {
    const targetIndex = toPosition - 1;
    if (targetIndex < 0 || targetIndex >= pdfFiles.length || targetIndex === fromIndex) return;
    const newFiles = [...pdfFiles];
    const [item] = newFiles.splice(fromIndex, 1);
    newFiles.splice(targetIndex, 0, item);
    setPdfFiles(newFiles);
  };

  const startEditing = (index: number) => {
    setEditingIndex(index);
    setEditingValue(String(index + 1));
  };

  const commitEditing = (fromIndex: number) => {
    const target = parseInt(editingValue, 10);
    if (!isNaN(target)) {
      moveTo(fromIndex, target);
    }
    setEditingIndex(null);
  };

  const handleListDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleListDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newFiles = [...pdfFiles];
    const [draggedItem] = newFiles.splice(draggedIndex, 1);
    newFiles.splice(index, 0, draggedItem);
    setPdfFiles(newFiles);
    setDraggedIndex(index);
  };

  const handleListDragEnd = () => {
    setDraggedIndex(null);
  };

  const clearAll = () => {
    setPdfFiles([]);
    setError(null);
  };

  const mergePdfs = async () => {
    if (pdfFiles.length < 2) {
      setError('2つ以上のPDFファイルを追加してください');
      return;
    }

    setIsMerging(true);
    setError(null);

    try {
      const mergedPdf = await PDFDocument.create();

      for (const pdfFile of pdfFiles) {
        const srcDoc = await PDFDocument.load(pdfFile.bytes);
        const copiedPages = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices());
        for (const page of copiedPages) {
          mergedPdf.addPage(page);
        }
      }

      const mergedBytes = await mergedPdf.save();
      const blob = new Blob([new Uint8Array(mergedBytes)], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'merged.pdf';
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      setError('PDF結合中にエラーが発生しました');
    } finally {
      setIsMerging(false);
    }
  };

  const totalPages = pdfFiles.reduce((sum, f) => sum + f.pageCount, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-3 bg-purple-100 rounded-lg">
          <Combine className="w-6 h-6 text-purple-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-800">PDF結合</h2>
          <p className="text-sm text-gray-500">複数のPDFを1つにまとめます</p>
        </div>
      </div>

      {/* ドロップゾーン */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        className="relative flex flex-col items-center justify-center w-full h-48 border-2 border-dashed rounded-xl cursor-pointer transition-all duration-200 border-gray-300 bg-gray-50 hover:bg-gray-100 hover:border-gray-400"
      >
        <input
          type="file"
          accept=".pdf,application/pdf"
          multiple
          onChange={handleFileSelect}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        <Upload className="w-10 h-10 mb-3 text-gray-400" />
        <p className="text-lg font-medium text-gray-700">PDFファイルをドラッグ＆ドロップ</p>
        <p className="text-sm text-gray-500">またはクリックしてファイルを選択（複数選択可）</p>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-600">
          {error}
        </div>
      )}

      {isLoading && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-blue-600">
          PDFを読み込み中...
        </div>
      )}

      {pdfFiles.length > 0 && (
        <div className="space-y-4">
          {/* ヘッダー */}
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              <span className="font-medium">{pdfFiles.length}</span> ファイル / 
              <span className="font-medium"> {totalPages}</span> ページ
            </div>
            <div className="flex gap-2">
              <button
                onClick={reverseOrder}
                className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors text-sm"
                title="順序を逆にする"
              >
                <ArrowDownUp className="w-4 h-4" />
                逆順
              </button>
              <button
                onClick={clearAll}
                className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors text-sm"
              >
                <Trash2 className="w-4 h-4" />
                クリア
              </button>
              <button
                onClick={mergePdfs}
                disabled={isMerging || pdfFiles.length < 2}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download className="w-4 h-4" />
                {isMerging ? '結合中...' : '結合してダウンロード'}
              </button>
            </div>
          </div>

          {/* 操作説明 */}
          <div className="text-sm text-gray-500 bg-gray-50 p-3 rounded-lg">
            💡 ドラッグ＆ドロップ、矢印ボタン、または番号クリックで順番を変更できます
          </div>

          {/* ファイルリスト */}
          <div className="space-y-2">
            {pdfFiles.map((pdfFile, index) => (
              <div
                key={pdfFile.id}
                draggable
                onDragStart={() => handleListDragStart(index)}
                onDragOver={(e) => handleListDragOver(e, index)}
                onDragEnd={handleListDragEnd}
                className={`flex items-center gap-3 p-3 bg-white border rounded-lg transition-all ${
                  draggedIndex === index ? 'opacity-50 border-purple-400' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                {/* ドラッグハンドル */}
                <div className="cursor-grab active:cursor-grabbing p-1 text-gray-400 hover:text-gray-600">
                  <GripVertical className="w-5 h-5" />
                </div>

                {/* 順番（クリックで直接指定） */}
                {editingIndex === index ? (
                  <input
                    type="number"
                    min={1}
                    max={pdfFiles.length}
                    value={editingValue}
                    onChange={(e) => setEditingValue(e.target.value)}
                    onBlur={() => commitEditing(index)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitEditing(index);
                      if (e.key === 'Escape') setEditingIndex(null);
                    }}
                    autoFocus
                    className="w-10 h-8 text-center bg-purple-50 border-2 border-purple-400 text-purple-700 font-bold rounded-lg text-sm outline-none"
                  />
                ) : (
                  <button
                    onClick={() => startEditing(index)}
                    className="w-8 h-8 flex items-center justify-center bg-purple-100 text-purple-700 font-bold rounded-lg text-sm hover:bg-purple-200 transition-colors cursor-pointer"
                    title="クリックして移動先を指定"
                  >
                    {index + 1}
                  </button>
                )}

                {/* サムネイル */}
                <div className="w-12 h-16 bg-gray-100 rounded overflow-hidden flex-shrink-0">
                  <img
                    src={pdfFile.thumbnail}
                    alt={pdfFile.name}
                    className="w-full h-full object-contain"
                  />
                </div>

                {/* ファイル情報 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <span className="font-medium text-gray-800 truncate">{pdfFile.name}</span>
                  </div>
                  <div className="text-sm text-gray-500">{pdfFile.pageCount} ページ</div>
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
                    disabled={index === pdfFiles.length - 1}
                    className="p-1 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    title="下に移動"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>

                {/* 削除ボタン */}
                <button
                  onClick={() => removeFile(pdfFile.id)}
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

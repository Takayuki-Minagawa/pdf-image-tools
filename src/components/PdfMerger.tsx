import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { PDFDocument } from 'pdf-lib';
import {
  AlertTriangle,
  ArrowDownUp,
  Ban,
  Combine,
  LoaderCircle,
  Trash2,
  Upload,
} from 'lucide-react';
import { MergeCompletionPanel, type MergeCompletion } from './pdfMerge/MergeCompletionPanel';
import { MergeFileCard } from './pdfMerge/MergeFileCard';
import { MergePageOrder } from './pdfMerge/MergePageOrder';
import { moveItem } from '../utils/arrayUtils';
import { nextFrame, throwIfAborted } from '../utils/async';
import {
  classifyPdfLoadError,
  interleavePages,
  regroupPagesByFile,
  sanitizePdfFilename,
} from '../utils/pdfMergeUtils';
import {
  isPageOfFile,
  loadPdfFile,
  newLoadingEntry,
  type LoadedPdf,
  type MergePage,
  type PdfFileEntry,
} from '../utils/pdfMergeLoader';

const MAX_MERGE_FILES = 50;
const MAX_MERGE_TOTAL_BYTES = 500 * 1024 * 1024;

interface MergeProgress {
  current: number;
  total: number;
  label: string;
}

export default function PdfMerger() {
  const [pdfFiles, setPdfFiles] = useState<PdfFileEntry[]>([]);
  const [pageOrder, setPageOrder] = useState<string[]>([]);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outputName, setOutputName] = useState('merged.pdf');
  const [progress, setProgress] = useState<MergeProgress | null>(null);
  const [completion, setCompletion] = useState<MergeCompletion | null>(null);
  const [draggedFileIndex, setDraggedFileIndex] = useState<number | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);
  const mergeAbortRef = useRef<AbortController | null>(null);

  const pageById = useMemo(() => {
    const map = new Map<string, MergePage>();
    for (const file of pdfFiles) for (const page of file.pages) map.set(page.id, page);
    return map;
  }, [pdfFiles]);

  const resolvePages = useCallback(
    (ids: readonly string[]) => ids.map((id) => pageById.get(id)).filter((page): page is MergePage => Boolean(page)),
    [pageById],
  );
  const orderedPages = useMemo(() => resolvePages(pageOrder), [pageOrder, resolvePages]);
  const activePages = useMemo(() => orderedPages.filter((page) => !page.excluded), [orderedPages]);
  const readyFiles = useMemo(() => pdfFiles.filter((file) => file.status === 'ready'), [pdfFiles]);
  const failedCount = pdfFiles.filter((file) => file.status === 'error').length;
  const duplicateCount = readyFiles.filter((file) => file.duplicateOf).length;

  useEffect(() => {
    const url = completion?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [completion?.url]);

  useEffect(
    () => () => {
      loadAbortRef.current?.abort();
      mergeAbortRef.current?.abort();
    },
    [],
  );

  const invalidateCompletion = () => setCompletion(null);

  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0 || isLoading) return;
      const remainingSlots = Math.max(0, MAX_MERGE_FILES - pdfFiles.length);
      let acceptedBytes = pdfFiles.reduce((total, entry) => total + entry.file.size, 0);
      const acceptedFiles = files.slice(0, remainingSlots).filter((file) => {
        if (acceptedBytes + file.size > MAX_MERGE_TOTAL_BYTES) return false;
        acceptedBytes += file.size;
        return true;
      });
      const rejectedCount = files.length - acceptedFiles.length;
      if (acceptedFiles.length === 0) {
        setError('安全上限（50ファイル・合計500MB）を超えるため追加できません。');
        return;
      }
      const entries = acceptedFiles.map(newLoadingEntry);
      const controller = new AbortController();
      loadAbortRef.current = controller;
      setIsLoading(true);
      setError(null);
      setMessage(`${entries.length}件のファイルを読み込んでいます。`);
      setPdfFiles((current) => [...current, ...entries]);
      invalidateCompletion();

      const settled: PromiseSettledResult<LoadedPdf>[] = [];
      // PDF.js workerと全ページCanvasを同時に多数作らないよう、1ファイルずつ読む。
      for (const entry of entries) {
        try {
          settled.push({ status: 'fulfilled', value: await loadPdfFile(entry.id, entry.file, controller.signal) });
        } catch (reason) {
          settled.push({ status: 'rejected', reason });
        }
        await nextFrame();
      }
      const knownSignatures = new Map(
        pdfFiles
          .filter((file) => file.status === 'ready' && file.signature)
          .map((file) => [file.signature as string, file.name]),
      );
      const updates = new Map<string, PdfFileEntry>();
      const addedPageIds: string[] = [];
      let successCount = 0;

      settled.forEach((result, index) => {
        const entry = entries[index];
        if (!entry) return;
        if (result.status === 'fulfilled') {
          const duplicateOf = knownSignatures.get(result.value.signature);
          if (!duplicateOf) knownSignatures.set(result.value.signature, entry.name);
          updates.set(entry.id, {
            ...entry,
            ...result.value,
            status: 'ready',
            duplicateOf,
          });
          addedPageIds.push(...result.value.pages.map((page) => page.id));
          successCount += 1;
        } else {
          updates.set(entry.id, {
            ...entry,
            status: 'error',
            error: classifyPdfLoadError(result.reason),
          });
        }
      });

      setPdfFiles((current) => current.map((file) => updates.get(file.id) ?? file));
      setPageOrder((current) => [...current, ...addedPageIds]);
      setExpandedFiles((current) => {
        const next = new Set(current);
        for (const entry of entries) {
          if (updates.get(entry.id)?.status === 'ready') next.add(entry.id);
        }
        return next;
      });
      const failureCount = entries.length - successCount;
      setMessage(
        failureCount > 0 || rejectedCount > 0
          ? `${successCount}件を読み込み、${failureCount}件が失敗、${rejectedCount}件を安全上限により除外しました。成功したファイルで続行できます。`
          : `${successCount}件のPDFを読み込みました。`,
      );
      setIsLoading(false);
      loadAbortRef.current = null;
    },
    [isLoading, pdfFiles],
  );

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    void addFiles(Array.from(event.dataTransfer.files));
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = '';
    void addFiles(files);
  };

  const retryFile = async (id: string) => {
    const target = pdfFiles.find((file) => file.id === id);
    if (!target || isLoading) return;
    const controller = new AbortController();
    loadAbortRef.current = controller;
    setIsLoading(true);
    setError(null);
    setMessage(`${target.name}を再読み込みしています。`);
    setPdfFiles((current) =>
      current.map((file) =>
        file.id === id ? { ...file, status: 'loading', error: undefined, duplicateOf: undefined } : file,
      ),
    );

    try {
      const loaded = await loadPdfFile(target.id, target.file, controller.signal);
      const duplicateOf = pdfFiles.find(
        (file) => file.id !== id && file.status === 'ready' && file.signature === loaded.signature,
      )?.name;
      setPdfFiles((current) =>
        current.map((file) =>
          file.id === id ? { ...file, ...loaded, status: 'ready', duplicateOf } : file,
        ),
      );
      setPageOrder((current) => [
        ...current.filter((pageId) => !isPageOfFile(pageId, id)),
        ...loaded.pages.map((page) => page.id),
      ]);
      setExpandedFiles((current) => new Set(current).add(id));
      setMessage(`${target.name}を読み込みました。`);
    } catch (loadError) {
      setPdfFiles((current) =>
        current.map((file) =>
          file.id === id
            ? { ...file, status: 'error', error: classifyPdfLoadError(loadError), pages: [] }
            : file,
        ),
      );
      setMessage(`${target.name}を読み込めませんでした。`);
    } finally {
      setIsLoading(false);
      loadAbortRef.current = null;
    }
  };

  const removeFile = (id: string) => {
    setPdfFiles((current) => current.filter((file) => file.id !== id));
    setPageOrder((current) => current.filter((pageId) => !isPageOfFile(pageId, id)));
    setExpandedFiles((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    invalidateCompletion();
    setMessage('ファイルを一覧から除外しました。');
  };

  // ファイル順を変えたら、結合ページ順もファイル単位にまとめ直す。
  const applyFileOrder = (nextFiles: PdfFileEntry[]) => {
    setPdfFiles(nextFiles);
    const fileOrder = nextFiles.map((file) => file.id);
    setPageOrder((current) => regroupPagesByFile(resolvePages(current), fileOrder).map((page) => page.id));
    invalidateCompletion();
  };

  const reorderFiles = (fromIndex: number, toIndex: number) => applyFileOrder(moveItem(pdfFiles, fromIndex, toIndex));

  const reverseFileOrder = () => applyFileOrder([...pdfFiles].reverse());

  const toggleExpanded = (id: string) => {
    setExpandedFiles((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const togglePageExcluded = (pageId: string) => {
    setPdfFiles((current) =>
      current.map((file) => ({
        ...file,
        pages: file.pages.map((page) =>
          page.id === pageId ? { ...page, excluded: !page.excluded } : page,
        ),
      })),
    );
    invalidateCompletion();
  };

  const toggleWholeFile = (fileId: string) => {
    setPdfFiles((current) =>
      current.map((file) => {
        if (file.id !== fileId) return file;
        const shouldExclude = file.pages.some((page) => !page.excluded);
        return { ...file, pages: file.pages.map((page) => ({ ...page, excluded: shouldExclude })) };
      }),
    );
    invalidateCompletion();
  };

  const reorderPage = (fromIndex: number, toIndex: number) => {
    setPageOrder((current) => moveItem(current, fromIndex, toIndex));
    invalidateCompletion();
  };

  const applyInterleave = () => {
    const fileOrder = readyFiles.map((file) => file.id);
    setPageOrder((current) => interleavePages(resolvePages(current), fileOrder).map((page) => page.id));
    invalidateCompletion();
    setMessage('ファイル順に1ページずつ交互に差し込みました。');
  };

  const clearAll = () => {
    loadAbortRef.current?.abort();
    mergeAbortRef.current?.abort();
    setPdfFiles([]);
    setPageOrder([]);
    setExpandedFiles(new Set());
    setCompletion(null);
    setError(null);
    setMessage('一覧をクリアしました。');
  };

  const mergePdfs = async () => {
    if (activePages.length === 0) {
      setError('出力するページがありません。少なくとも1ページを含めてください。');
      return;
    }

    const controller = new AbortController();
    mergeAbortRef.current = controller;
    setIsMerging(true);
    setCompletion(null);
    setError(null);
    setMessage('PDFの結合を開始しました。');
    setProgress({ current: 0, total: activePages.length, label: 'PDFを準備しています' });
    const startedAt = performance.now();

    try {
      const output = await PDFDocument.create();
      const sourceDocuments = new Map<string, PDFDocument>();
      for (const file of readyFiles) {
        throwIfAborted(controller.signal);
        if (file.bytes) sourceDocuments.set(file.id, await PDFDocument.load(file.bytes));
      }

      for (let index = 0; index < activePages.length; index += 1) {
        throwIfAborted(controller.signal);
        const page = activePages[index];
        if (!page) continue;
        const source = sourceDocuments.get(page.fileId);
        if (!source) throw new Error('結合元のPDFが見つかりません。');
        const [copiedPage] = await output.copyPages(source, [page.sourcePageIndex]);
        if (copiedPage) output.addPage(copiedPage);
        setProgress({
          current: index + 1,
          total: activePages.length,
          label: `${index + 1} / ${activePages.length}ページを処理しました`,
        });
        if (index % 3 === 0) await nextFrame();
      }

      throwIfAborted(controller.signal);
      setProgress({ current: activePages.length, total: activePages.length, label: '保存しています' });
      const saved = await output.save();
      throwIfAborted(controller.signal);
      const data = new Uint8Array(saved);
      const blob = new Blob([data], { type: 'application/pdf' });
      const filename = sanitizePdfFilename(outputName);
      setCompletion({
        url: URL.createObjectURL(blob),
        blob,
        filename,
        pageCount: activePages.length,
        byteLength: data.byteLength,
        elapsedMs: performance.now() - startedAt,
      });
      setMessage(`${filename}を作成しました。`);
    } catch (mergeError) {
      const classified = classifyPdfLoadError(mergeError);
      if (classified.kind === 'cancelled') {
        setMessage('PDFの結合をキャンセルしました。編集内容は保持されています。');
      } else {
        console.error(mergeError);
        setError('PDFの結合に失敗しました。元ファイルを確認して再試行してください。');
      }
    } finally {
      setIsMerging(false);
      setProgress(null);
      mergeAbortRef.current = null;
    }
  };

  const getFileName = (fileId: string) => pdfFiles.find((file) => file.id === fileId)?.name ?? 'PDF';

  return (
    <section className="space-y-6" aria-labelledby="pdf-merger-title">
      <header className="flex items-center gap-3 text-left">
        <div className="rounded-lg bg-purple-100 p-3" aria-hidden="true">
          <Combine className="h-6 w-6 text-purple-600" />
        </div>
        <div>
          <h2 id="pdf-merger-title" className="text-xl font-bold text-gray-800">
            PDF結合
          </h2>
          <p className="text-sm text-gray-500">ファイルとページを確認し、好きな順番で1つにまとめます</p>
        </div>
      </header>

      <label
        onDrop={handleDrop}
        onDragOver={(event) => event.preventDefault()}
        className="relative flex h-44 w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 transition hover:border-purple-400 hover:bg-purple-50 focus-within:ring-2 focus-within:ring-purple-500 focus-within:ring-offset-2"
      >
        <input
          type="file"
          accept=".pdf,application/pdf"
          multiple
          disabled={isLoading || isMerging}
          onChange={handleFileSelect}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          aria-label="結合するPDFファイルを選択"
        />
        <Upload className="mb-3 h-10 w-10 text-purple-400" aria-hidden="true" />
        <span className="text-lg font-medium text-gray-700">PDFをドロップ、またはクリックして選択</span>
        <span className="mt-1 text-sm text-gray-500">複数ファイルをまとめて追加できます（1件の失敗で中断しません）</span>
      </label>

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {message}
      </div>
      {message && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-left text-sm text-blue-800" role="status">
          {message}
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-left text-red-700" role="alert">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-none" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 p-4 text-blue-800">
          <span className="flex items-center gap-2">
            <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
            ファイルを読み込み中…
          </span>
          <button
            type="button"
            onClick={() => loadAbortRef.current?.abort()}
            className="rounded-lg bg-white px-3 py-2 text-sm font-medium shadow-sm hover:bg-blue-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            すべてキャンセル
          </button>
        </div>
      )}

      {pdfFiles.length > 0 && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-gray-600">
              <strong>{readyFiles.length}</strong>件を使用・<strong>{orderedPages.length}</strong>ページ
              {failedCount > 0 && <span className="ml-2 text-red-600">失敗 {failedCount}件</span>}
              {duplicateCount > 0 && <span className="ml-2 text-amber-700">重複候補 {duplicateCount}件</span>}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={reverseFileOrder}
                disabled={pdfFiles.length < 2 || isMerging}
                className="flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200 disabled:opacity-40"
              >
                <ArrowDownUp className="h-4 w-4" aria-hidden="true" />
                ファイル順を反転
              </button>
              <button
                type="button"
                onClick={clearAll}
                className="flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                すべてクリア
              </button>
            </div>
          </div>

          <div className="rounded-lg bg-gray-50 p-3 text-left text-sm text-gray-600">
            ファイルはドラッグまたは矢印で並べ替えられます。ファイル順を変えると、ページもファイル単位にまとまります。
          </div>

          <ol className="space-y-3" aria-label="PDFファイル一覧">
            {pdfFiles.map((pdfFile, index) => (
              <MergeFileCard
                key={pdfFile.id}
                pdfFile={pdfFile}
                index={index}
                fileCount={pdfFiles.length}
                isExpanded={expandedFiles.has(pdfFile.id)}
                isDragged={draggedFileIndex === index}
                isLoading={isLoading}
                isMerging={isMerging}
                onDragStart={() => setDraggedFileIndex(index)}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (draggedFileIndex !== null && draggedFileIndex !== index) {
                    reorderFiles(draggedFileIndex, index);
                    setDraggedFileIndex(index);
                  }
                }}
                onDragEnd={() => setDraggedFileIndex(null)}
                onMove={reorderFiles}
                onToggleWholeFile={() => toggleWholeFile(pdfFile.id)}
                onToggleExpanded={() => toggleExpanded(pdfFile.id)}
                onRemove={() => removeFile(pdfFile.id)}
                onRetry={() => void retryFile(pdfFile.id)}
                onTogglePageExcluded={togglePageExcluded}
              />
            ))}
          </ol>

          {orderedPages.length > 0 && (
            <MergePageOrder
              pages={orderedPages}
              getFileName={getFileName}
              canInterleave={readyFiles.length >= 2}
              isMerging={isMerging}
              onInterleave={applyInterleave}
              onReorder={reorderPage}
              onToggleExcluded={togglePageExcluded}
            />
          )}

          <section className="rounded-xl border border-gray-200 bg-white p-4 text-left" aria-labelledby="output-settings-title">
            <h3 id="output-settings-title" className="font-bold text-gray-800">出力設定</h3>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="min-w-60 flex-1 text-sm font-medium text-gray-700">
                出力ファイル名
                <input
                  type="text"
                  value={outputName}
                  onChange={(event) => {
                    setOutputName(event.target.value);
                    invalidateCompletion();
                  }}
                  disabled={isMerging}
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
                  aria-describedby="output-name-preview"
                />
              </label>
              <p id="output-name-preview" className="pb-2 text-sm text-gray-500">
                保存名: {sanitizePdfFilename(outputName)}
              </p>
              {!isMerging ? (
                <button
                  type="button"
                  onClick={() => void mergePdfs()}
                  disabled={activePages.length === 0 || isLoading}
                  className="flex items-center gap-2 rounded-lg bg-purple-600 px-5 py-2.5 font-medium text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-700"
                >
                  <Combine className="h-5 w-5" aria-hidden="true" />
                  {activePages.length}ページのPDFを作成
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => mergeAbortRef.current?.abort()}
                  className="flex items-center gap-2 rounded-lg bg-red-600 px-5 py-2.5 font-medium text-white hover:bg-red-700"
                >
                  <Ban className="h-5 w-5" aria-hidden="true" /> 結合をキャンセル
                </button>
              )}
            </div>
            <p className="mt-2 text-sm text-gray-500">除外中の{orderedPages.length - activePages.length}ページは出力されません。</p>
          </section>

          {isMerging && progress && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-left" aria-live="polite">
              <div className="mb-2 flex justify-between text-sm text-blue-800">
                <span>{progress.label}</span>
                <span>{Math.round((progress.current / Math.max(progress.total, 1)) * 100)}%</span>
              </div>
              <progress
                value={progress.current}
                max={progress.total}
                className="h-2 w-full accent-purple-600"
                aria-label="PDF結合の進捗"
              />
            </div>
          )}

          {completion && <MergeCompletionPanel completion={completion} />}
        </div>
      )}
    </section>
  );
}

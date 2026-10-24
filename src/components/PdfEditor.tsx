import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Dropzone } from './Dropzone';
import { ImagePreview } from './ImagePreview';
import { DraftResumeBanner } from './pdfEdit/DraftResumeBanner';
import { PageManagementPanel } from './pdfEdit/PageManagementPanel';
import { PdfDocumentNotices } from './pdfEdit/PdfDocumentNotices';
import { PdfEditorFileBar } from './pdfEdit/PdfEditorFileBar';
import { PdfEditorSidebar, type EditorSubTab } from './pdfEdit/PdfEditorSidebar';
import { PdfEditorPreview } from './pdfEdit/PdfEditorPreview';
import { PdfLoadErrorPanel } from './pdfEdit/PdfLoadErrorPanel';
import { PdfOutputNameBar } from './pdfEdit/PdfOutputNameBar';
import { PdfOutputStatus } from './pdfEdit/PdfOutputStatus';
import { PdfPasswordForm } from './pdfEdit/PdfPasswordForm';
import { GraphicsOverlay } from './pdfEdit/GraphicsOverlay';
import { PdfTextSearch } from './pdfEdit/PdfTextSearch';
import { RedactionFailureDialog } from './pdfEdit/RedactionFailureDialog';
import { DEFAULT_WATERMARK, type PdfGraphic, type WatermarkConfig } from '../types/pdfGraphics';
import { remapGraphicsForPages, duplicateGraphicsForPages } from '../utils/pdfGraphics';
import { rotateGraphicsToPagePlan } from '../utils/pageGraphicRotation';
import {
  duplicatePagePlanSelection,
  getUnrotatedPageSize,
  remapPageSelection,
  remapTextBoxesForPagePlan,
  remapWatermarkForPagePlan,
  retainContentEditsForPagePlan,
} from '../utils/pdfEditor';
import {
  buildEditedPdf as runEditPipeline,
  createIdentityPagePlan,
  hasPagePlanChanges,
} from '../utils/editPipeline';
import { resolveContentRules } from '../utils/contentRules';
import { usePdfDocument } from '../hooks/usePdfDocument';
import { useUndoHistory } from '../hooks/useUndoHistory';
import { usePdfDraftAutosave } from '../hooks/usePdfDraftAutosave';
import { usePdfEditorOutput } from '../hooks/usePdfEditorOutput';
import { usePdfPageRenderer } from '../hooks/usePdfPageRenderer';
import { usePreviewOverlay } from '../hooks/usePreviewOverlay';
import { usePageContentRecognition } from '../hooks/usePageContentRecognition';
import { usePageNavigation } from '../hooks/usePageNavigation';
import { useBeforeUnloadWarning, useUndoRedoShortcut } from '../hooks/useEditorKeyboard';
import { recognizePageContent, hitTestRecognizedItems } from '../utils/contentRecognition';
import {
  contentEditsForPage,
  mergeScopedContentEdits,
  scopeContentEditsToPagePlan,
  upsertScopedContentEdit,
} from '../utils/contentEditScope';
import { prepareRecipeGraphicsForEditor } from '../utils/recipeEditor';
import { selectPagesByParity, toggleSelectAllPages, togglePageInSelection } from '../utils/pageSelection';
import type {
  TextBoxConfig,
  HeaderFooterSettings,
  PageNumberingConfig,
  PagePlanEntry,
  PdfImageExportOptions,
} from '../types/pdfEdit';
import {
  DEFAULT_HEADER_FOOTER,
  DEFAULT_PAGE_NUMBERING,
} from '../types/pdfEdit';
import type { ContentEdit } from '../types/contentEdit';
import {
  deletePdfDraft,
  type PdfEditorDraftSnapshot,
  type StoredPdfDraft,
} from '../utils/draftStorage';
import type { PdfEditRecipe } from '../types/recipe';
import { IMAGE_EXPORT_STORAGE_KEY, readStoredImageExportOptions } from '../utils/imageExport';
import { moveItem } from '../utils/arrayUtils';
import { getErrorMessage } from '../utils/format';
import {
  consumePendingPdf,
  peekPendingPdf,
  subscribePdfEditorHandoff,
} from '../utils/workflowHandoff';

function defaultOutputName(fileName: string) {
  return fileName.replace(/\.pdf$/i, '') + '_edited';
}

export default function PdfEditor() {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const {
    pdf,
    pdfBytes,
    loadedFile,
    isLoading,
    loadingMessage,
    error: pdfLoadError,
    retry: retryPdfLoad,
    passwordRequired,
    submitPassword,
    passwordRasterized,
    thumbnails,
    ensureThumbnail,
    isGeneratingThumbnails,
    thumbnailProgress,
    cancelThumbnailGeneration,
    estimatedMemoryBytes,
  } = usePdfDocument(pdfFile);
  const originalTotalPages = pdf?.numPages ?? 0;

  const [scale, setScale] = useState(1);

  const [activeSubTab, setActiveSubTab] = useState<EditorSubTab>('page-number');
  const [textBoxes, setTextBoxes] = useState<TextBoxConfig[]>([]);
  const [headerFooter, setHeaderFooter] = useState<HeaderFooterSettings>(DEFAULT_HEADER_FOOTER);
  const [pageNumbering, setPageNumbering] = useState<PageNumberingConfig>(DEFAULT_PAGE_NUMBERING);
  const [activeTextBoxId, setActiveTextBoxId] = useState<string | null>(null);
  const [graphics, setGraphics] = useState<PdfGraphic[]>([]);
  const [watermark, setWatermark] = useState<WatermarkConfig>(DEFAULT_WATERMARK);
  const [activeGraphicId, setActiveGraphicId] = useState<string | null>(null);

  const [contentEdits, setContentEdits] = useState<ContentEdit[]>([]);
  const [selectedContentId, setSelectedContentId] = useState<string | null>(null);

  const [pageEntries, setPageEntries] = useState<PagePlanEntry[]>([]);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<number | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const draggedIndexRef = useRef<number | null>(null);
  const pageEntriesRef = useRef<PagePlanEntry[]>([]);
  const [extractStart, setExtractStart] = useState('');
  const [extractEnd, setExtractEnd] = useState('');

  const [isRotatingPages, setIsRotatingPages] = useState(false);
  const [outputError, setOutputError] = useState<string | null>(null);
  const [outputMessage, setOutputMessage] = useState<string | null>(null);
  const [pdfOutputName, setPdfOutputName] = useState('edited');
  const [imageExportOptions, setImageExportOptions] = useState<PdfImageExportOptions>(readStoredImageExportOptions);
  const pendingDraftRef = useRef<StoredPdfDraft | null>(null);
  const savedSignatureRef = useRef('');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const displayPageCount = pageEntries.length;
  const {
    currentPage,
    setCurrentPage,
    pageInputValue,
    setPageInputValue,
    commitPageInput,
    handlePageInputKeyDown,
    goToPreviousPage,
    goToNextPage,
  } = usePageNavigation(displayPageCount);
  const currentPageEntry = pageEntries[currentPage - 1];
  const currentOriginalPageIndex = currentPageEntry?.sourcePageIndex ?? -1;
  const { recognizedByPage, setRecognizedByPage, isRecognizing } = usePageContentRecognition(
    pdf,
    currentOriginalPageIndex,
    activeSubTab === 'content',
  );
  const currentPageItems =
    currentOriginalPageIndex >= 0
      ? (recognizedByPage.get(currentOriginalPageIndex) ?? null)
      : null;
  const selectedContentItem = selectedContentId
    ? (currentPageItems?.find((item) => item.id === selectedContentId) ?? null)
    : null;
  const currentPageContentEdits = useMemo(
    () => contentEditsForPage(contentEdits, currentPageEntry?.id, currentOriginalPageIndex),
    [contentEdits, currentOriginalPageIndex, currentPageEntry?.id],
  );
  const hasRedactions = contentEdits.some(
    (edit) => edit.kind === 'text' && edit.action === 'redact',
  );
  const hasPageChanges = hasPagePlanChanges(pageEntries, originalTotalPages);

  const editSnapshot = useMemo<PdfEditorDraftSnapshot>(() => ({
    pageEntries,
    textBoxes,
    headerFooter,
    pageNumbering,
    contentEdits,
    graphics,
    watermark,
  }), [contentEdits, graphics, watermark, headerFooter, pageEntries, pageNumbering, textBoxes]);
  const latestSnapshotRef = useRef(editSnapshot);
  useEffect(() => { latestSnapshotRef.current = editSnapshot; }, [editSnapshot]);

  const restoreSnapshot = useCallback((snapshot: PdfEditorDraftSnapshot) => {
    setPageEntries(snapshot.pageEntries);
    pageEntriesRef.current = snapshot.pageEntries;
    setTextBoxes(snapshot.textBoxes);
    setHeaderFooter(snapshot.headerFooter);
    setPageNumbering(snapshot.pageNumbering);
    setContentEdits(snapshot.contentEdits);
    setGraphics(snapshot.graphics ?? []);
    setWatermark(snapshot.watermark ?? DEFAULT_WATERMARK);
    setActiveGraphicId(null);
    setSelectedPages(new Set());
    setSelectedContentId(null);
  }, []);

  const history = useUndoHistory({
    value: editSnapshot,
    onRestore: restoreSnapshot,
    enabled: Boolean(pdf),
    label: 'PDF編集',
    limit: 50,
  });
  const resetHistory = history.reset;

  const snapshotSignature = JSON.stringify(editSnapshot);
  const isDirty = Boolean(pdfFile) && savedSignatureRef.current !== snapshotSignature;

  useEffect(() => {
    pageEntriesRef.current = pageEntries;
  }, [pageEntries]);

  useEffect(() => {
    if (!pdf) {
      setPageEntries([]);
      return;
    }

    const pendingDraft = pendingDraftRef.current;
    const draftSnapshot = pendingDraft?.snapshot;
    const initialSnapshot: PdfEditorDraftSnapshot = {
      pageEntries: draftSnapshot?.pageEntries.length
        ? draftSnapshot.pageEntries
        : createIdentityPagePlan(pdf.numPages),
      textBoxes: draftSnapshot?.textBoxes ?? [],
      headerFooter: draftSnapshot?.headerFooter ?? DEFAULT_HEADER_FOOTER,
      pageNumbering: draftSnapshot?.pageNumbering ?? DEFAULT_PAGE_NUMBERING,
      contentEdits: draftSnapshot?.contentEdits ?? [],
      graphics: draftSnapshot?.graphics ?? [],
      watermark: draftSnapshot?.watermark ?? DEFAULT_WATERMARK,
    };
    restoreSnapshot(initialSnapshot);
    setCurrentPage(pendingDraft ? Math.min(pendingDraft.currentPage, initialSnapshot.pageEntries.length) : 1);
    setScale(pendingDraft?.scale ?? 1);
    setActiveSubTab(pendingDraft?.activeSubTab ?? 'page-number');
    setPageInputValue(String(pendingDraft?.currentPage ?? 1));
    setExtractStart('');
    setExtractEnd('');
    if (pendingDraft) setImageExportOptions(pendingDraft.imageExportOptions);
    setRecognizedByPage(new Map());
    resetHistory(initialSnapshot);
    savedSignatureRef.current = JSON.stringify(initialSnapshot);
    pendingDraftRef.current = null;
  }, [pdf, resetHistory, restoreSnapshot, setCurrentPage, setPageInputValue, setRecognizedByPage]);

  const { pageSize, pageViewport } = usePdfPageRenderer({
    pdf,
    entry: currentPageEntry,
    scale,
    canvasRef,
    overlayCanvasRef,
  });

  // ページサイズ変更でオーバーレイキャンバスが初期化された後に描くため、usePdfPageRenderer より後に呼ぶ。
  usePreviewOverlay({
    overlayCanvasRef,
    pageSize,
    scale,
    pageViewport,
    pageNumber: currentPage,
    pageCount: displayPageCount,
    fileName: pdfFile?.name || '',
    contentEdits: currentPageContentEdits,
    recognizedItems: activeSubTab === 'content' ? currentPageItems : null,
    selectedContentId,
    textBoxes,
    activeTextBoxId,
    headerFooter,
    pageNumbering,
  });

  useEffect(() => {
    if (displayPageCount === 0) return;

    setPageNumbering((prev) =>
      prev.startPage > displayPageCount ? { ...prev, startPage: displayPageCount } : prev,
    );
  }, [displayPageCount]);

  const {
    availableDraft,
    setAvailableDraft,
    autoSaveEnabled,
    setAutoSaveEnabled,
    draftStatus,
    draftSavedAt,
    storageSummary,
    clearDraftState,
    refreshStorageSummary,
    discardDraft,
  } = usePdfDraftAutosave({
    pdfFile,
    loadedFile,
    pdfBytes,
    pdf,
    snapshot: editSnapshot,
    snapshotSignature,
    isDirty,
    hasRedactions,
    savedSignatureRef,
    currentPage,
    scale,
    activeSubTab,
    imageExportOptions,
  });

  useEffect(() => {
    localStorage.setItem(IMAGE_EXPORT_STORAGE_KEY, JSON.stringify(imageExportOptions));
  }, [imageExportOptions]);

  useBeforeUnloadWarning(isDirty);
  useUndoRedoShortcut(history.undo, history.redo);

  // 保存・抽出・画像出力は共通パイプライン（バッチ処理・CLIと同一の適用順序）を使う。
  const buildEditedPdf = useCallback(async (allowCoverOnly = false) => {
    if (!pdfBytes || !pdfFile) {
      throw new Error('PDFが読み込まれていません');
    }
    return runEditPipeline(
      pdfBytes,
      { pageEntries, textBoxes, headerFooter, pageNumbering, contentEdits, graphics, watermark },
      { fileName: pdfFile.name, originalPageCount: originalTotalPages, allowCoverOnly },
    );
  }, [
    graphics,
    watermark,
    pdfBytes,
    pdfFile,
    originalTotalPages,
    pageEntries,
    textBoxes,
    headerFooter,
    pageNumbering,
    contentEdits,
  ]);

  const output = usePdfEditorOutput({
    buildEditedPdf,
    sourceFileName: pdfFile?.name,
    outputName: pdfOutputName,
    pageCount: displayPageCount,
    selectedPages,
    extractStart,
    extractEnd,
    imageExportOptions,
    hasRedactions,
    snapshotSignature,
    beforeSaveDownload: deletePdfDraft,
    onSaved: () => {
      savedSignatureRef.current = snapshotSignature;
      clearDraftState();
      refreshStorageSummary();
    },
    setOutputError,
    setOutputMessage,
  });
  const { clearImages: clearOutputImages, resetOutput } = output;

  const resumeDraft = async () => {
    if (!availableDraft) return;
    pendingDraftRef.current = availableDraft;
    const file = new File([availableDraft.fileBytes], availableDraft.fileName, {
      type: availableDraft.fileType,
      lastModified: availableDraft.fileLastModified,
    });
    setPdfOutputName(defaultOutputName(file.name));
    setAvailableDraft(null);
    setPdfFile(file);
  };

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;

      if (activeSubTab === 'content') {
        if (!currentPageItems || !pageViewport) return;

        // キャンバス座標 → PDFユーザー空間（CropBox原点・回転を含めてviewportで逆変換）
        const [pageX, pageY] = pageViewport.convertToPdfPoint(canvasX, canvasY);
        const hit = hitTestRecognizedItems(currentPageItems, { x: pageX, y: pageY });
        setSelectedContentId(hit?.id ?? null);
        return;
      }

      if (!activeTextBoxId || activeSubTab !== 'textbox') return;

      const pdfX = Math.round(canvasX / scale);
      const pdfY = Math.round(canvasY / scale);

      setTextBoxes((prev) =>
        prev.map((box) => (box.id === activeTextBoxId ? { ...box, x: pdfX, y: pdfY } : box)),
      );
    },
    [activeTextBoxId, activeSubTab, scale, currentPageItems, pageViewport],
  );

  // ファイル切り替え・リセット時に、編集内容と出力結果を初期状態へ戻す。
  const resetEditState = useCallback(() => {
    setTextBoxes([]);
    setHeaderFooter(DEFAULT_HEADER_FOOTER);
    setPageNumbering(DEFAULT_PAGE_NUMBERING);
    setActiveTextBoxId(null);
    setContentEdits([]);
    setGraphics([]);
    setWatermark(DEFAULT_WATERMARK);
    setActiveGraphicId(null);
    setRecognizedByPage(new Map());
    setSelectedContentId(null);
    resetOutput();
    setOutputError(null);
    setOutputMessage(null);
    savedSignatureRef.current = '';
  }, [resetOutput, setRecognizedByPage]);

  const handleFileDrop = useCallback((files: File[]) => {
    const nextPdfFile = files.find((file) =>
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'),
    );
    if (!nextPdfFile) return false;

    if (isDirty && !window.confirm('未保存の編集があります。別のPDFへ切り替えますか？')) return false;

    setPdfFile(nextPdfFile);
    resetEditState();
    setPdfOutputName(defaultOutputName(nextPdfFile.name));
    return true;
  }, [isDirty, resetEditState]);

  useEffect(() => {
    const consume = () => {
      const file = peekPendingPdf();
      if (!file) return;
      if (handleFileDrop([file])) {
        consumePendingPdf();
        setOutputMessage('前のツールからPDFを受け取りました');
      }
    };
    consume();
    return subscribePdfEditorHandoff(consume);
  }, [handleFileDrop]);

  const handleReset = (force = false) => {
    if (!force && isDirty && !window.confirm('未保存の編集を破棄してファイル選択へ戻りますか？')) return;
    setPdfFile(null);
    setCurrentPage(1);
    setPageInputValue('1');
    setPageEntries([]);
    setSelectedPages(new Set());
    setSelectionAnchor(null);
    setDraggedIndex(null);
    draggedIndexRef.current = null;
    setExtractStart('');
    setExtractEnd('');
    resetEditState();
    history.reset();
  };

  const upsertContentEdit = useCallback((edit: ContentEdit) => {
    const scopedEdit = { ...edit, pageEntryId: currentPageEntry?.id } as ContentEdit;
    setContentEdits((prev) => upsertScopedContentEdit(prev, scopedEdit));
  }, [currentPageEntry?.id]);

  const removeContentEdit = useCallback((targetId: string) => {
    setContentEdits((prev) => prev.filter((edit) =>
      edit.target.id !== targetId || edit.pageEntryId !== currentPageEntry?.id,
    ));
  }, [currentPageEntry?.id]);

  const updatePageEntries = useCallback(
    (nextEntries: PagePlanEntry[]) => {
      const previousEntries = pageEntriesRef.current;
      pageEntriesRef.current = nextEntries;
      setPageEntries(nextEntries);
      setSelectedPages((current) => remapPageSelection(current, previousEntries, nextEntries));
      setTextBoxes((current) => {
        const nextTextBoxes = remapTextBoxesForPagePlan(current, previousEntries, nextEntries);
        if (activeTextBoxId && !nextTextBoxes.some((box) => box.id === activeTextBoxId)) {
          setActiveTextBoxId(null);
        }
        return nextTextBoxes;
      });
      setGraphics((current) => remapGraphicsForPages(current, previousEntries, nextEntries));
      setWatermark((current) => remapWatermarkForPagePlan(current, previousEntries, nextEntries));
      setContentEdits((current) => retainContentEditsForPagePlan(current, nextEntries));
    },
    [activeTextBoxId],
  );

  // 非同期処理の間に別の編集・Undo・別PDFの読み込みが起きたかを判定する。
  const editStateChangedSince = (snapshot: PdfEditorDraftSnapshot, entries: PagePlanEntry[]) =>
    latestSnapshotRef.current !== snapshot || pageEntriesRef.current !== entries;

  const togglePageSelection = (displayIndex: number, extend = false) => {
    setSelectedPages(togglePageInSelection(selectedPages, displayIndex, selectionAnchor, extend));
    setSelectionAnchor(displayIndex);
  };

  const toggleSelectAll = () => setSelectedPages(toggleSelectAllPages(selectedPages, displayPageCount));

  const selectPagePattern = (pattern: 'odd' | 'even' | 'none') => {
    setSelectedPages(pattern === 'none' ? new Set() : selectPagesByParity(displayPageCount, pattern));
  };

  const deleteSelectedPages = () => {
    if (selectedPages.size === 0) return;
    if (selectedPages.size === displayPageCount) {
      alert('すべてのページを削除することはできません');
      return;
    }

    const nextEntries = pageEntries.filter((_, index) => !selectedPages.has(index));
    updatePageEntries(nextEntries);
    setSelectedPages(new Set());
    clearOutputImages();
    setOutputError(null);

    if (currentPage > nextEntries.length) {
      setCurrentPage(nextEntries.length);
    }
  };

  const rotateSelectedPages = async () => {
    if (!pdf || isRotatingPages || selectedPages.size === 0) return;
    setIsRotatingPages(true);
    setOutputError(null);
    try {
      const nextEntries = pageEntries.map((entry, index) => selectedPages.has(index)
        ? { ...entry, rotation: ((entry.rotation + 90) % 360) as PagePlanEntry['rotation'] }
        : entry);
      const rotatedGraphics = await rotateGraphicsToPagePlan(pdf, graphics, pageEntries, nextEntries);
      // Do not overwrite another edit, undo, or a newly opened document while images decode.
      if (editStateChangedSince(editSnapshot, pageEntries)) {
        setOutputMessage('処理中に編集内容が変わったため回転を中止しました。もう一度実行してください。');
        return;
      }
      updatePageEntries(nextEntries);
      setGraphics(rotatedGraphics);
      setActiveGraphicId(null);
      clearOutputImages();
    } catch (error) {
      setOutputError(getErrorMessage(error, 'ページを回転できませんでした'));
    } finally {
      setIsRotatingPages(false);
    }
  };

  const duplicateSelectedPages = () => {
    if (selectedPages.size === 0) return;
    const duplicated = duplicatePagePlanSelection(
      pageEntries,
      selectedPages,
      textBoxes,
      contentEdits,
    );
    pageEntriesRef.current = duplicated.pageEntries;
    setPageEntries(duplicated.pageEntries);
    setTextBoxes(duplicated.textBoxes);
    setGraphics(duplicateGraphicsForPages(graphics, pageEntries, duplicated.pageEntries));
    setWatermark(remapWatermarkForPagePlan(watermark, pageEntries, duplicated.pageEntries));
    setContentEdits(duplicated.contentEdits);
    setSelectedPages(new Set());
    clearOutputImages();
  };

  const insertBlankPage = () => {
    const insertAt = Math.min(currentPage, pageEntries.length);
    const unrotatedPageSize = getUnrotatedPageSize(
      pageSize,
      currentPageEntry?.rotation ?? 0,
    );
    const nextEntries = [...pageEntries];
    nextEntries.splice(insertAt, 0, {
      id: crypto.randomUUID(),
      sourcePageIndex: null,
      rotation: 0,
      width: unrotatedPageSize.width || 595.28,
      height: unrotatedPageSize.height || 841.89,
    });
    updatePageEntries(nextEntries);
    setCurrentPage(insertAt + 1);
    setSelectedPages(new Set([insertAt]));
  };

  const resetPageChanges = async () => {
    if (!pdf || isRotatingPages) return;
    const initialEntries = Array.from({ length: originalTotalPages }, (_, sourcePageIndex) => {
      const existing = pageEntries.find((entry) => entry.sourcePageIndex === sourcePageIndex);
      return existing
        ? { ...existing, rotation: 0 as const }
        : { id: crypto.randomUUID(), sourcePageIndex, rotation: 0 as const };
    });
    setIsRotatingPages(true);
    setOutputError(null);
    try {
      const rotated = await rotateGraphicsToPagePlan(pdf, graphics, pageEntries, initialEntries);
      if (editStateChangedSince(editSnapshot, pageEntries)) {
        setOutputMessage('処理中に編集内容が変わったためリセットを中止しました。もう一度実行してください。');
        return;
      }
      updatePageEntries(initialEntries);
      setGraphics(remapGraphicsForPages(rotated, pageEntries, initialEntries));
      setActiveGraphicId(null);
      setSelectedPages(new Set());
      setCurrentPage(1);
      setExtractStart('');
      setExtractEnd('');
      clearOutputImages();
    } catch (error) {
      setOutputError(getErrorMessage(error, 'ページ操作をリセットできませんでした'));
    } finally {
      setIsRotatingPages(false);
    }
  };

  const handleDragStart = (displayIndex: number) => {
    draggedIndexRef.current = displayIndex;
    setDraggedIndex(displayIndex);
  };

  const handleDragOver = (e: React.DragEvent, displayIndex: number) => {
    e.preventDefault();
    const fromIndex = draggedIndexRef.current;
    if (fromIndex === null || fromIndex === displayIndex) return;

    updatePageEntries(moveItem(pageEntriesRef.current, fromIndex, displayIndex));
    draggedIndexRef.current = displayIndex;
    setDraggedIndex(displayIndex);
    clearOutputImages();
    setOutputError(null);
  };

  const handleDragEnd = () => {
    draggedIndexRef.current = null;
    setDraggedIndex(null);
  };

  const movePage = (displayIndex: number, direction: -1 | 1) => {
    const targetIndex = displayIndex + direction;
    if (targetIndex < 0 || targetIndex >= pageEntries.length) return;
    updatePageEntries(moveItem(pageEntries, displayIndex, targetIndex));
  };

  const applyRecipe = async (recipe: PdfEditRecipe) => {
    setOutputError(null);
    setTextBoxes(structuredClone(recipe.textBoxes));
    setHeaderFooter(structuredClone(recipe.headerFooter));
    setPageNumbering(structuredClone(recipe.pageNumbering));
    setImageExportOptions(structuredClone(recipe.imageExportOptions));

    const prepared = prepareRecipeGraphicsForEditor(recipe.graphics, recipe.watermark, displayPageCount);
    setGraphics(prepared.graphics);
    setWatermark(prepared.watermark);
    const skippedImages = prepared.skippedImageCount;
    setActiveGraphicId(null);

    const notes: string[] = [];
    if (skippedImages > 0) notes.push(`画像${skippedImages}件はファイルパス指定のため除外`);

    // コンテンツ編集ルールは現在のPDFの認識結果へ解決する（ページ単位でキャッシュ）。
    if (recipe.contentRules.length > 0 && pdf) {
      try {
        const cache = new Map(recognizedByPage);
        const readPage = async (sourceIndex: number) => {
          const cached = cache.get(sourceIndex);
          if (cached) return cached;
          const items = await recognizePageContent(await pdf.getPage(sourceIndex + 1));
          cache.set(sourceIndex, items);
          return items;
        };
        const resolved = await resolveContentRules(recipe.contentRules, pdf.numPages, readPage);
        setRecognizedByPage(cache);
        const scoped = scopeContentEditsToPagePlan(resolved.edits, pageEntriesRef.current);
        setContentEdits((previous) => mergeScopedContentEdits(previous, scoped));
        notes.push(`コンテンツ編集 ${resolved.edits.length}件を一致`);
        if (resolved.unmatched.length > 0) notes.push(`ルール${resolved.unmatched.length}件は一致なし`);
      } catch (error) {
        setOutputError(`コンテンツ編集ルールを解決できませんでした: ${getErrorMessage(error)}`);
      }
    }

    setOutputMessage(`レシピ「${recipe.name}」を適用しました${notes.length ? `（${notes.join('、')}）` : ''}`);
  };

  if (!pdfFile) {
    return (
      <div className="space-y-4">
        {availableDraft && (
          <DraftResumeBanner
            draft={availableDraft}
            onResume={() => void resumeDraft()}
            onDiscard={() => void discardDraft()}
          />
        )}
        <Dropzone
          accept={['.pdf', 'application/pdf']}
          onDrop={handleFileDrop}
          title="PDFファイルをドロップ"
          description="またはクリックしてファイルを選択"
        />
      </div>
    );
  }

  if (passwordRequired) {
    return <PdfPasswordForm onSubmit={submitPassword} onCancel={() => handleReset(true)} />;
  }

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center rounded-lg bg-gray-100">
        <div className="text-gray-500" role="status">{loadingMessage}</div>
      </div>
    );
  }

  if (pdfLoadError || !pdf) {
    return (
      <PdfLoadErrorPanel
        error={pdfLoadError}
        file={pdfFile}
        onRetry={retryPdfLoad}
        onChooseAnother={() => handleReset(true)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <PdfEditorFileBar
        file={pdfFile}
        displayPageCount={displayPageCount}
        originalPageCount={originalTotalPages}
        isDirty={isDirty}
        redactionVerifiedAt={output.redactionVerifiedAt}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onUndo={history.undo}
        onRedo={history.redo}
        autoSaveEnabled={autoSaveEnabled}
        onAutoSaveChange={setAutoSaveEnabled}
        draftStatus={draftStatus}
        draftSavedAt={draftSavedAt}
        storageSummary={storageSummary}
        onDeleteDraft={() => {
          setAutoSaveEnabled(false);
          void discardDraft();
        }}
        onChangeFile={() => handleReset()}
      />

      <PdfDocumentNotices estimatedMemoryBytes={estimatedMemoryBytes} passwordRasterized={passwordRasterized} />

      <PdfOutputNameBar
        outputName={pdfOutputName}
        onOutputNameChange={setPdfOutputName}
        historyEntries={history.entries}
        onRestoreHistory={history.restoreAt}
      />

      <PdfTextSearch
        key={pageEntries[0]?.id ?? 'search'}
        pdf={pdf}
        pageEntries={pageEntries}
        onSelect={(pageIndex, items, selectedId) => {
          const sourceIndex = pageEntries[pageIndex]?.sourcePageIndex;
          if (sourceIndex === null || sourceIndex === undefined) return;
          setRecognizedByPage((previous) => new Map(previous).set(sourceIndex, items));
          setCurrentPage(pageIndex + 1);
          setSelectedContentId(selectedId);
          setActiveSubTab('content');
        }}
      />

      <PageManagementPanel
        displayPageCount={displayPageCount}
        selectedPages={selectedPages}
        hasPageChanges={hasPageChanges}
        extractStart={extractStart}
        extractEnd={extractEnd}
        isGeneratingThumbnails={isGeneratingThumbnails}
        thumbnailProgress={thumbnailProgress}
        pageEntries={pageEntries}
        thumbnails={thumbnails}
        draggedIndex={draggedIndex}
        onRequestThumbnail={ensureThumbnail}
        onCancelThumbnails={cancelThumbnailGeneration}
        onToggleSelectAll={toggleSelectAll}
        onSelectPattern={selectPagePattern}
        onDeleteSelectedPages={deleteSelectedPages}
        onRotateSelectedPages={rotateSelectedPages}
        isRotatingPages={isRotatingPages}
        onDuplicateSelectedPages={duplicateSelectedPages}
        onInsertBlankPage={insertBlankPage}
        onResetPageChanges={resetPageChanges}
        onExtractStartChange={setExtractStart}
        onExtractEndChange={setExtractEnd}
        onExtract={() => void output.extractRange()}
        onExtractSelected={() => void output.extractSelected()}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onMovePage={movePage}
        onTogglePageSelection={togglePageSelection}
      />

      <div className="flex flex-col gap-4 lg:flex-row">
        <PdfEditorSidebar
          documentKey={pageEntries.map((entry) => entry.id).join(',')}
          graphics={graphics}
          onGraphicsChange={setGraphics}
          activeGraphicId={activeGraphicId}
          onActiveGraphicChange={(id) => {
            setActiveGraphicId(id);
            const graphic = graphics.find((item) => item.id === id);
            if (graphic && graphic.pageIndex >= 0) setCurrentPage(graphic.pageIndex + 1);
          }}
          watermark={watermark}
          onWatermarkChange={setWatermark}
          currentPageIndex={currentPage - 1}
          pageSize={pageSize}
          activeSubTab={activeSubTab}
          onActiveSubTabChange={setActiveSubTab}
          textBoxes={textBoxes}
          onTextBoxesChange={setTextBoxes}
          totalPages={displayPageCount}
          activeTextBoxId={activeTextBoxId}
          onActiveTextBoxChange={setActiveTextBoxId}
          headerFooter={headerFooter}
          onHeaderFooterChange={setHeaderFooter}
          pageNumbering={pageNumbering}
          onPageNumberingChange={setPageNumbering}
          isRecognizing={isRecognizing}
          hasRecognized={currentPageItems !== null}
          recognizedItems={currentPageItems ?? []}
          selectedContentItem={selectedContentItem}
          contentEdits={currentPageContentEdits}
          allContentEdits={contentEdits}
          onUpsertContentEdit={upsertContentEdit}
          onRemoveContentEdit={removeContentEdit}
          onSelectContentItem={setSelectedContentId}
          onSavePdf={() => void output.savePdf()}
          onExportPng={() => void output.exportImages()}
          isSavingPdf={output.isSavingPdf}
          isExportingPng={output.isExportingImages}
          imageExportOptions={imageExportOptions}
          onImageExportOptionsChange={setImageExportOptions}
          selectedPageCount={selectedPages.size}
          onApplyRecipe={applyRecipe}
        />

        <PdfEditorPreview
          currentPage={currentPage}
          displayPageCount={displayPageCount}
          pageInputValue={pageInputValue}
          onPageInputValueChange={setPageInputValue}
          onPageInputCommit={commitPageInput}
          onPageInputKeyDown={handlePageInputKeyDown}
          onPrevPage={goToPreviousPage}
          onNextPage={goToNextPage}
          scale={scale}
          onZoomOut={() => setScale((value) => Math.max(0.25, value - 0.25))}
          onZoomIn={() => setScale((value) => Math.min(3, value + 0.25))}
          onScaleChange={setScale}
          containerRef={containerRef}
          canvasRef={canvasRef}
          overlayCanvasRef={overlayCanvasRef}
          onCanvasClick={handleCanvasClick}
          isTextPlacementActive={Boolean(activeTextBoxId && activeSubTab === 'textbox')}
          isContentSelectionActive={activeSubTab === 'content'}
          pageSize={pageSize}
          graphicsOverlay={
            <GraphicsOverlay
              key={`${currentPageEntry?.id}-${currentPageEntry?.rotation}-${scale}`}
              graphics={graphics}
              watermark={watermark}
              currentPageIndex={currentPage - 1}
              pageSize={pageSize}
              scale={scale}
              interactive={activeSubTab === 'graphics'}
              activeGraphicId={activeGraphicId}
              onActiveChange={setActiveGraphicId}
              onChange={(graphic) => setGraphics((previous) => previous.map((item) => item.id === graphic.id ? graphic : item))}
              onDelete={(id) => {
                setGraphics((previous) => previous.filter((item) => item.id !== id));
                setActiveGraphicId(null);
              }}
            />
          }
        />
      </div>

      <PdfOutputStatus
        error={outputError}
        message={outputMessage}
        imageExportProgress={output.isExportingImages ? output.imageProgress : null}
        imageExportFormat={imageExportOptions.format}
        onCancelImageExport={output.cancelImageExport}
      />

      <ImagePreview
        images={output.images}
        onDownload={output.downloadImage}
        onDownloadAll={output.downloadAllImages}
        onClear={clearOutputImages}
      />

      {output.redactionFailure && (
        <RedactionFailureDialog
          error={output.redactionFailure.error}
          isBusy={output.isSavingPdf || output.isExportingImages}
          onClose={output.dismissRedactionFailure}
          onBackToEdit={() => {
            output.dismissRedactionFailure();
            setActiveSubTab('content');
          }}
          onRetryWithCover={() => void output.retryWithCoverOnly()}
        />
      )}
    </div>
  );
}

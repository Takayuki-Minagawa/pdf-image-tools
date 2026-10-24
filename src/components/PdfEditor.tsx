import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { AlertTriangle, CheckCircle2, HardDrive, ShieldCheck } from 'lucide-react';
import { Dropzone } from './Dropzone';
import { ImagePreview } from './ImagePreview';
import { ProgressBar } from './ProgressBar';
import { DraftResumeBanner } from './pdfEdit/DraftResumeBanner';
import { PageManagementPanel } from './pdfEdit/PageManagementPanel';
import { PdfEditorFileBar, type DraftStatus } from './pdfEdit/PdfEditorFileBar';
import { PdfEditorSidebar, type EditorSubTab } from './pdfEdit/PdfEditorSidebar';
import { PdfEditorPreview } from './pdfEdit/PdfEditorPreview';
import { PdfLoadErrorPanel } from './pdfEdit/PdfLoadErrorPanel';
import { PdfPasswordForm } from './pdfEdit/PdfPasswordForm';
import { GraphicsOverlay } from './pdfEdit/GraphicsOverlay';
import { PdfTextSearch } from './pdfEdit/PdfTextSearch';
import { RedactionFailureDialog } from './pdfEdit/RedactionFailureDialog';
import { DEFAULT_WATERMARK, type PdfGraphic, type WatermarkConfig } from '../types/pdfGraphics';
import { remapGraphicsForPages, duplicateGraphicsForPages } from '../utils/pdfGraphics';
import { rotateGraphicsToPagePlan } from '../utils/pageGraphicRotation';
import {
  downloadPdf,
  duplicatePagePlanSelection,
  extractPdfPageIndices,
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
import { pdfBytesToImages } from '../utils/pdfToImages';
import { usePdfDocument } from '../hooks/usePdfDocument';
import { useUndoHistory } from '../hooks/useUndoHistory';
import {
  drawTextBoxesOverlay,
  drawHeaderFooterOverlay,
  drawPageNumberOverlay,
  drawRecognizedItemsOverlay,
  drawContentEditsOverlay,
  type OverlayContext,
} from '../utils/overlayRenderer';
import { recognizePageContent, hitTestRecognizedItems } from '../utils/contentRecognition';
import { RedactionVerificationError } from '../utils/contentEditOperations';
import type { ConvertedImage } from '../utils/pdfToImages';
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
import type { ContentEdit, RecognizedItem } from '../types/contentEdit';
import type { PageViewport, RenderTask } from 'pdfjs-dist';
import {
  deletePdfDraft,
  getStorageSummary,
  loadPdfDraft,
  requestPersistentStorage,
  savePdfDraft,
  type PdfEditorDraftSnapshot,
  type StoredPdfDraft,
} from '../utils/draftStorage';
import type { PdfEditRecipe } from '../types/recipe';
import { sanitizeFilename } from '../utils/download';
import {
  IMAGE_EXPORT_STORAGE_KEY,
  downloadImagesAsZip,
  imageExportFileName,
  readStoredImageExportOptions,
  resolveImageExportPageIndices,
} from '../utils/imageExport';
import { moveItem, pageRangeToIndices } from '../utils/arrayUtils';
import { isAbortError } from '../utils/async';
import { formatBytes, getErrorMessage } from '../utils/format';
import {
  consumePendingPdf,
  peekPendingPdf,
  subscribePdfEditorHandoff,
} from '../utils/workflowHandoff';

type RedactionFailureOperation = 'save' | 'extract-range' | 'extract-selected' | 'export-images';

interface RedactionFailureState {
  error: RedactionVerificationError;
  operation: RedactionFailureOperation;
}

const AUTO_SAVE_STORAGE_KEY = 'pdf-image-tools:auto-save';

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

  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  // 表示中ページのviewport。ユーザー空間⇔キャンバス座標の変換に使う
  // （CropBox原点や回転を考慮するため、scaleによる単純な換算では不十分）。
  const [pageViewport, setPageViewport] = useState<PageViewport | null>(null);
  const [pageInputValue, setPageInputValue] = useState('1');

  const [activeSubTab, setActiveSubTab] = useState<EditorSubTab>('page-number');
  const [textBoxes, setTextBoxes] = useState<TextBoxConfig[]>([]);
  const [headerFooter, setHeaderFooter] = useState<HeaderFooterSettings>(DEFAULT_HEADER_FOOTER);
  const [pageNumbering, setPageNumbering] = useState<PageNumberingConfig>(DEFAULT_PAGE_NUMBERING);
  const [activeTextBoxId, setActiveTextBoxId] = useState<string | null>(null);
  const [graphics, setGraphics] = useState<PdfGraphic[]>([]);
  const [watermark, setWatermark] = useState<WatermarkConfig>(DEFAULT_WATERMARK);
  const [activeGraphicId, setActiveGraphicId] = useState<string | null>(null);

  const [contentEdits, setContentEdits] = useState<ContentEdit[]>([]);
  const [recognizedByPage, setRecognizedByPage] = useState<Map<number, RecognizedItem[]>>(
    new Map(),
  );
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [selectedContentId, setSelectedContentId] = useState<string | null>(null);

  const [pageEntries, setPageEntries] = useState<PagePlanEntry[]>([]);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<number | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const draggedIndexRef = useRef<number | null>(null);
  const pageEntriesRef = useRef<PagePlanEntry[]>([]);
  const [extractStart, setExtractStart] = useState('');
  const [extractEnd, setExtractEnd] = useState('');

  const [isSavingPdf, setIsSavingPdf] = useState(false);
  const [isRotatingPages, setIsRotatingPages] = useState(false);
  const [isExportingPng, setIsExportingPng] = useState(false);
  const [pngProgress, setPngProgress] = useState(0);
  const [pngImages, setPngImages] = useState<ConvertedImage[]>([]);
  const [outputError, setOutputError] = useState<string | null>(null);
  const [outputMessage, setOutputMessage] = useState<string | null>(null);
  const [pdfOutputName, setPdfOutputName] = useState('edited');
  const [imageExportOptions, setImageExportOptions] = useState<PdfImageExportOptions>(readStoredImageExportOptions);
  const exportAbortRef = useRef<AbortController | null>(null);
  const [redactionFailure, setRedactionFailure] = useState<RedactionFailureState | null>(null);
  const [redactionVerifiedAt, setRedactionVerifiedAt] = useState<number | null>(null);
  const [availableDraft, setAvailableDraft] = useState<StoredPdfDraft | null>(null);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(
    () => localStorage.getItem(AUTO_SAVE_STORAGE_KEY) !== 'off',
  );
  const [draftStatus, setDraftStatus] = useState<DraftStatus>('idle');
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [storageSummary, setStorageSummary] = useState({ usage: 0, quota: 0 });
  const pendingDraftRef = useRef<StoredPdfDraft | null>(null);
  const savedSignatureRef = useRef('');
  const redactionDraftBlockedRef = useRef(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const displayPageCount = pageEntries.length;
  const currentPageEntry = pageEntries[currentPage - 1];
  const currentOriginalPageIndex = currentPageEntry?.sourcePageIndex ?? -1;
  const currentPageItems =
    currentOriginalPageIndex >= 0
      ? (recognizedByPage.get(currentOriginalPageIndex) ?? null)
      : null;
  const selectedContentItem = selectedContentId
    ? (currentPageItems?.find((item) => item.id === selectedContentId) ?? null)
    : null;
  const currentPageContentEdits = useMemo(
    () => contentEdits.filter((edit) =>
      edit.pageEntryId
        ? edit.pageEntryId === currentPageEntry?.id
        : edit.target.pageIndex === currentOriginalPageIndex,
    ),
    [contentEdits, currentOriginalPageIndex, currentPageEntry?.id],
  );
  const hasRedactions = contentEdits.some(
    (edit) => edit.kind === 'text' && edit.action === 'redact',
  );
  redactionDraftBlockedRef.current = hasRedactions;
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

  const refreshStorageSummary = useCallback(() => {
    void getStorageSummary().then(setStorageSummary).catch(() => undefined);
  }, []);

  const clearDraftState = useCallback(() => {
    setAvailableDraft(null);
    setDraftSavedAt(null);
    setDraftStatus('idle');
  }, []);

  useEffect(() => {
    setRedactionVerifiedAt(null);
  }, [snapshotSignature]);

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
    setPageViewport(null);
    resetHistory(initialSnapshot);
    savedSignatureRef.current = JSON.stringify(initialSnapshot);
    pendingDraftRef.current = null;
  }, [pdf, resetHistory, restoreSnapshot]);

  // コンテンツ編集タブで表示中のページを解析する（ページ単位でキャッシュ）
  useEffect(() => {
    if (activeSubTab !== 'content' || !pdf || currentOriginalPageIndex < 0) return;
    if (recognizedByPage.has(currentOriginalPageIndex)) return;

    let cancelled = false;

    const recognize = async () => {
      setIsRecognizing(true);
      try {
        const page = await pdf.getPage(currentOriginalPageIndex + 1);
        const items = await recognizePageContent(page);
        if (!cancelled) {
          setRecognizedByPage((prev) => new Map(prev).set(currentOriginalPageIndex, items));
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setRecognizedByPage((prev) => new Map(prev).set(currentOriginalPageIndex, []));
        }
      } finally {
        if (!cancelled) setIsRecognizing(false);
      }
    };

    recognize();

    return () => {
      cancelled = true;
    };
  }, [activeSubTab, pdf, currentOriginalPageIndex, recognizedByPage]);

  useEffect(() => {
    let cancelled = false;
    let renderTask: RenderTask | null = null;

    const renderPage = async () => {
      if (!pdf || !canvasRef.current || displayPageCount === 0) return;

      const entry = pageEntries[currentPage - 1];
      if (!entry) return;

      const canvas = canvasRef.current;
      const context = canvas.getContext('2d')!;
      if (entry.sourcePageIndex === null) {
        const baseWidth = entry.width ?? 595.28;
        const baseHeight = entry.height ?? 841.89;
        const rotated = entry.rotation === 90 || entry.rotation === 270;
        const width = (rotated ? baseHeight : baseWidth) * scale;
        const height = (rotated ? baseWidth : baseHeight) * scale;
        canvas.width = width;
        canvas.height = height;
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, width, height);
        setPageSize({ width: rotated ? baseHeight : baseWidth, height: rotated ? baseWidth : baseHeight });
        setPageViewport(null);
        return;
      }

      const page = await pdf.getPage(entry.sourcePageIndex + 1);
      if (cancelled) return;
      const viewport = page.getViewport({ scale, rotation: (page.rotate + entry.rotation) % 360 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const originalViewport = page.getViewport({ scale: 1, rotation: (page.rotate + entry.rotation) % 360 });
      setPageSize({ width: originalViewport.width, height: originalViewport.height });
      setPageViewport(viewport);

      renderTask = page.render({
        canvasContext: context,
        viewport,
        canvas,
      });
      await renderTask.promise;
    };

    void renderPage().catch((error) => {
      if (cancelled || (error instanceof Error && error.name === 'RenderingCancelledException')) return;
      console.error(error);
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdf, currentPage, scale, pageEntries, displayPageCount]);

  useEffect(() => {
    const base = canvasRef.current;
    const overlay = overlayCanvasRef.current;
    if (!base || !overlay) return;

    overlay.width = base.width;
    overlay.height = base.height;
  }, [pageSize, scale]);

  const drawOverlay = useCallback(() => {
    const overlayCanvas = overlayCanvasRef.current;
    if (!overlayCanvas || pageSize.width === 0) return;

    const ctx = overlayCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    const overlay: OverlayContext = {
      ctx,
      scale,
      canvasWidth: overlayCanvas.width,
      canvasHeight: overlayCanvas.height,
      viewport: pageViewport,
    };

    // コンテンツ編集（カバー+再描画）は元ページ内容の変更を模すため最初に描く
    drawContentEditsOverlay(overlay, currentPageContentEdits);
    if (activeSubTab === 'content' && currentPageItems) {
      drawRecognizedItemsOverlay(overlay, currentPageItems, selectedContentId);
    }

    drawTextBoxesOverlay(overlay, textBoxes, currentPage - 1, activeTextBoxId);
    drawHeaderFooterOverlay(
      overlay,
      headerFooter,
      currentPage,
      displayPageCount,
      pdfFile?.name || '',
    );
    drawPageNumberOverlay(overlay, pageNumbering, currentPage);
  }, [
    textBoxes,
    headerFooter,
    pageNumbering,
    currentPage,
    displayPageCount,
    scale,
    pageSize,
    pageViewport,
    pdfFile,
    activeTextBoxId,
    activeSubTab,
    currentPageItems,
    currentPageContentEdits,
    selectedContentId,
  ]);

  useEffect(() => {
    drawOverlay();
  }, [drawOverlay]);

  useEffect(() => {
    setPageInputValue(String(currentPage));
  }, [currentPage]);

  useEffect(() => {
    if (displayPageCount === 0) return;

    if (currentPage > displayPageCount) {
      setCurrentPage(displayPageCount);
    }
  }, [currentPage, displayPageCount]);

  useEffect(() => {
    if (displayPageCount === 0) return;

    setPageNumbering((prev) =>
      prev.startPage > displayPageCount ? { ...prev, startPage: displayPageCount } : prev,
    );
  }, [displayPageCount]);

  useEffect(() => {
    let cancelled = false;
    loadPdfDraft()
      .then((draft) => {
        if (!cancelled && !pdfFile) setAvailableDraft(draft);
      })
      .catch((error) => console.warn('下書きを確認できませんでした', error));
    return () => {
      cancelled = true;
    };
  }, [pdfFile]);

  useEffect(() => {
    localStorage.setItem(AUTO_SAVE_STORAGE_KEY, autoSaveEnabled ? 'on' : 'off');
    if (autoSaveEnabled) void requestPersistentStorage();
  }, [autoSaveEnabled]);

  useEffect(() => {
    localStorage.setItem(IMAGE_EXPORT_STORAGE_KEY, JSON.stringify(imageExportOptions));
  }, [imageExportOptions]);

  useEffect(() => {
    if (!hasRedactions) return;
    let cancelled = false;
    void deletePdfDraft()
      .then(() => {
        if (cancelled) return;
        clearDraftState();
        refreshStorageSummary();
      })
      .catch((error) => console.warn('墨消しを含む下書きを削除できませんでした', error));
    return () => {
      cancelled = true;
    };
  }, [clearDraftState, hasRedactions, refreshStorageSummary]);

  useEffect(() => {
    if (
      !autoSaveEnabled ||
      !isDirty ||
      hasRedactions ||
      !pdfFile ||
      loadedFile !== pdfFile ||
      !pdfBytes ||
      !pdf ||
      pageEntries.length === 0
    ) return;
    let cancelled = false;
    setDraftStatus('saving');
    const timeout = window.setTimeout(() => {
      savePdfDraft({
        fileName: pdfFile.name,
        fileType: pdfFile.type || 'application/pdf',
        fileLastModified: pdfFile.lastModified,
        fileBytes: pdfBytes.slice(0),
        snapshot: structuredClone(editSnapshot),
        currentPage,
        scale,
        activeSubTab,
        imageExportOptions,
        savedAt: Date.now(),
      }).then(async () => {
        if (redactionDraftBlockedRef.current) {
          await deletePdfDraft();
          if (!cancelled) {
            setDraftSavedAt(null);
            setDraftStatus('idle');
          }
          return;
        }
        savedSignatureRef.current = snapshotSignature;
        if (cancelled) return;
        setDraftSavedAt(Date.now());
        setDraftStatus('saved');
        refreshStorageSummary();
      }).catch((error) => {
        if (cancelled) return;
        console.warn('下書きを保存できませんでした', error);
        setDraftStatus('error');
      });
    }, 900);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [activeSubTab, autoSaveEnabled, currentPage, editSnapshot, hasRedactions, imageExportOptions, isDirty, loadedFile, pageEntries.length, pdf, pdfBytes, pdfFile, refreshStorageSummary, scale, snapshotSignature]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const isTextInput = target?.matches('input, textarea, [contenteditable="true"]');
      if (isTextInput) return;
      if (event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) history.redo();
      else history.undo();
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [history]);

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

  const discardDraft = async () => {
    await deletePdfDraft();
    clearDraftState();
    refreshStorageSummary();
  };

  const handlePageInputCommit = () => {
    const page = parseInt(pageInputValue, 10);
    if (!Number.isNaN(page) && page >= 1 && page <= displayPageCount) {
      setCurrentPage(page);
    } else {
      setPageInputValue(String(currentPage));
    }
  };

  const handlePageInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
      handlePageInputCommit();
    }
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
    setPngImages([]);
    setOutputError(null);
    setPngProgress(0);
    setOutputMessage(null);
    savedSignatureRef.current = '';
  }, []);

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
    setContentEdits((prev) => {
      const index = prev.findIndex((entry) =>
        entry.target.id === edit.target.id && entry.pageEntryId === scopedEdit.pageEntryId,
      );
      if (index === -1) return [...prev, scopedEdit];
      const next = [...prev];
      next[index] = scopedEdit;
      return next;
    });
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
    const nextSelected = new Set(selectedPages);
    if (extend && selectionAnchor !== null) {
      const start = Math.min(selectionAnchor, displayIndex);
      const end = Math.max(selectionAnchor, displayIndex);
      for (let index = start; index <= end; index++) nextSelected.add(index);
    } else if (nextSelected.has(displayIndex)) {
      nextSelected.delete(displayIndex);
    } else {
      nextSelected.add(displayIndex);
    }
    setSelectedPages(nextSelected);
    setSelectionAnchor(displayIndex);
  };

  const toggleSelectAll = () => {
    if (selectedPages.size === displayPageCount) {
      setSelectedPages(new Set());
    } else {
      setSelectedPages(new Set(pageEntries.map((_, index) => index)));
    }
  };

  const selectPagePattern = (pattern: 'odd' | 'even' | 'none') => {
    if (pattern === 'none') {
      setSelectedPages(new Set());
      return;
    }
    setSelectedPages(new Set(pageEntries.flatMap((_, index) =>
      ((index + 1) % 2 === (pattern === 'odd' ? 1 : 0)) ? [index] : [],
    )));
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
    setPngImages([]);
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
      setPngImages([]);
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
    setPngImages([]);
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
      setPngImages([]);
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
    setPngImages([]);
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

  const reportOutputFailure = (
    error: unknown,
    operation: RedactionFailureOperation,
    describe: (error: unknown) => string,
  ) => {
    console.error(error);
    if (error instanceof RedactionVerificationError) {
      setRedactionFailure({ error, operation });
    } else {
      setOutputError(describe(error));
    }
  };

  const handleExtract = async (allowCoverOnly = false) => {
    if (!pdfFile) return;

    const start = parseInt(extractStart, 10);
    const end = parseInt(extractEnd, 10);

    if (
      Number.isNaN(start) ||
      Number.isNaN(end) ||
      start < 1 ||
      end > displayPageCount ||
      start > end
    ) {
      alert(`有効なページ範囲を指定してください (1〜${displayPageCount})`);
      return;
    }

    try {
      const editedPdf = await buildEditedPdf(allowCoverOnly);
      const extractedPdf = await extractPdfPageIndices(editedPdf, pageRangeToIndices(start, end));
      downloadPdf(extractedPdf, `${pdfFile.name.replace('.pdf', '')}_pages_${start}-${end}.pdf`);
      setRedactionFailure(null);
    } catch (err) {
      reportOutputFailure(err, 'extract-range', (error) => '抽出中にエラーが発生しました: ' + getErrorMessage(error));
    }
  };

  const handleExtractSelected = async (allowCoverOnly = false) => {
    if (selectedPages.size === 0) return;
    setOutputError(null);
    try {
      const editedPdf = await buildEditedPdf(allowCoverOnly);
      const pageIndices = [...selectedPages].sort((a, b) => a - b);
      const extractedPdf = await extractPdfPageIndices(editedPdf, pageIndices);
      downloadPdf(extractedPdf, `${sanitizeFilename(pdfOutputName, 'selected-pages')}_selected.pdf`);
      setRedactionFailure(null);
      setOutputMessage(`${pageIndices.length}ページを抽出しました`);
    } catch (error) {
      reportOutputFailure(error, 'extract-selected', (reason) => getErrorMessage(reason, '選択ページを抽出できませんでした'));
    }
  };

  const handleSavePdf = async (allowCoverOnly = false) => {
    if (!pdfFile) return;

    setIsSavingPdf(true);
    setOutputError(null);
    setOutputMessage(null);

    try {
      const result = await buildEditedPdf(allowCoverOnly);
      const filename = `${sanitizeFilename(pdfOutputName, 'edited')}.pdf`;
      await deletePdfDraft();
      downloadPdf(result, filename);
      savedSignatureRef.current = snapshotSignature;
      clearDraftState();
      setRedactionFailure(null);
      setRedactionVerifiedAt(hasRedactions && !allowCoverOnly ? Date.now() : null);
      refreshStorageSummary();
      setOutputMessage(`${filename}（${formatBytes(result.byteLength)}）を保存しました`);
    } catch (err) {
      reportOutputFailure(err, 'save', (error) => 'PDF保存中にエラーが発生しました: ' + getErrorMessage(error));
    } finally {
      setIsSavingPdf(false);
    }
  };

  const handleExportPng = async (allowCoverOnly = false) => {
    if (!pdfFile) return;

    setIsExportingPng(true);
    setOutputError(null);
    setOutputMessage(null);
    setPngProgress(0);
    setPngImages([]);
    const controller = new AbortController();
    exportAbortRef.current = controller;

    try {
      const result = await buildEditedPdf(allowCoverOnly);
      const pageIndices = resolveImageExportPageIndices(imageExportOptions, selectedPages, displayPageCount);
      const images = await pdfBytesToImages(result, {
        scale: imageExportOptions.scale,
        format: imageExportOptions.format,
        quality: imageExportOptions.quality,
        pageIndices,
        onProgress: setPngProgress,
        signal: controller.signal,
      });
      setPngImages(images);
      setRedactionFailure(null);
      if (imageExportOptions.zip && images.length > 1) {
        await downloadImagesAsZip(images, imageExportOptions);
        setOutputMessage(`${images.length}ページをZIPで保存しました`);
      } else {
        setOutputMessage(`${images.length}ページの画像を生成しました`);
      }
    } catch (err) {
      if (isAbortError(err)) {
        setOutputMessage('画像出力をキャンセルしました');
      } else {
        reportOutputFailure(err, 'export-images', (error) => '画像出力中にエラーが発生しました: ' + getErrorMessage(error));
      }
    } finally {
      setIsExportingPng(false);
      exportAbortRef.current = null;
    }
  };

  const retryRedactionFailureWithCover = async () => {
    if (!redactionFailure) return;
    switch (redactionFailure.operation) {
      case 'extract-range':
        await handleExtract(true);
        break;
      case 'extract-selected':
        await handleExtractSelected(true);
        break;
      case 'export-images':
        await handleExportPng(true);
        break;
      default:
        await handleSavePdf(true);
    }
  };

  const handleDownloadPng = useCallback(
    (image: ConvertedImage) => {
      const link = document.createElement('a');
      link.href = image.dataUrl;
      link.download = imageExportFileName(imageExportOptions, image.pageNumber);
      link.click();
    },
    [imageExportOptions],
  );

  const handleDownloadAllPng = useCallback(async () => {
    if (pngImages.length === 1 && !imageExportOptions.zip) {
      handleDownloadPng(pngImages[0]);
      return;
    }
    await downloadImagesAsZip(pngImages, imageExportOptions);
  }, [handleDownloadPng, imageExportOptions, pngImages]);

  const applyRecipe = async (recipe: PdfEditRecipe) => {
    setOutputError(null);
    setTextBoxes(structuredClone(recipe.textBoxes));
    setHeaderFooter(structuredClone(recipe.headerFooter));
    setPageNumbering(structuredClone(recipe.pageNumbering));
    setImageExportOptions(structuredClone(recipe.imageExportOptions));

    // 図形は新しいIDで複製し、存在しないページ向けのもの・パス指定だけの画像は除外する。
    const candidates: PdfGraphic[] = recipe.graphics
      .filter((graphic) => graphic.pageIndex < displayPageCount)
      .map((graphic) => {
        const copy: PdfGraphic & { imagePath?: string } = { ...structuredClone(graphic), id: crypto.randomUUID() };
        delete copy.imagePath;
        return copy;
      });
    const skippedImages = candidates.filter((graphic) => graphic.kind === 'image' && !graphic.imageDataUrl).length;
    setGraphics(candidates.filter((graphic) => graphic.kind !== 'image' || graphic.imageDataUrl));
    setWatermark({
      ...recipe.watermark,
      pageIndex: recipe.watermark.pageIndex < displayPageCount ? recipe.watermark.pageIndex : -1,
    });
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
        const scoped = resolved.edits.map((edit) => ({
          ...edit,
          pageEntryId: pageEntriesRef.current.find((entry) => entry.sourcePageIndex === edit.target.pageIndex)?.id,
        }) as ContentEdit);
        setContentEdits((previous) => [
          ...previous.filter((edit) => !scoped.some((candidate) =>
            candidate.target.id === edit.target.id && candidate.pageEntryId === edit.pageEntryId,
          )),
          ...scoped,
        ]);
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
        redactionVerifiedAt={hasRedactions ? redactionVerifiedAt : null}
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

      {estimatedMemoryBytes > 100 * 1024 * 1024 && (
        <div className="flex items-start gap-2 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
          <HardDrive className="mt-0.5 h-4 w-4 shrink-0" />
          <span>推定メモリ使用量は約{formatBytes(estimatedMemoryBytes)}です。サムネイルは表示範囲だけ遅延生成されます。</span>
        </div>
      )}

      {passwordRasterized && (
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>パスワード保護PDFは編集可能な画像PDFへ変換しました。元のテキスト層は出力に残らず、画質とファイル容量が変わる場合があります。</span>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <label className="min-w-56 flex-1 text-xs text-gray-600">
          PDF出力名
          <div className="mt-1 flex items-center gap-1">
            <input value={pdfOutputName} onChange={(event) => setPdfOutputName(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800" />
            <span>.pdf</span>
          </div>
        </label>
        <details className="relative">
          <summary className="cursor-pointer rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700">操作履歴 ({history.entries.length})</summary>
          <ol className="absolute right-0 z-40 mt-1 max-h-60 w-64 overflow-auto rounded-lg border border-gray-200 bg-white p-2 shadow-xl">
            {history.entries.map((entry) => (
              <li key={`${entry.createdAt}-${entry.index}`}>
                <button type="button" onClick={() => history.restoreAt(entry.index)} className={`w-full rounded px-2 py-1.5 text-left text-xs hover:bg-gray-50 ${entry.active ? 'bg-blue-50 font-semibold text-blue-700' : 'text-gray-600'}`}>
                  {entry.label}・{new Date(entry.createdAt).toLocaleTimeString('ja-JP')}
                </button>
              </li>
            ))}
          </ol>
        </details>
      </div>

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
        onExtract={() => void handleExtract()}
        onExtractSelected={() => void handleExtractSelected()}
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
          onSavePdf={() => void handleSavePdf()}
          onExportPng={() => void handleExportPng()}
          isSavingPdf={isSavingPdf}
          isExportingPng={isExportingPng}
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
          onPageInputCommit={handlePageInputCommit}
          onPageInputKeyDown={handlePageInputKeyDown}
          onPrevPage={() => setCurrentPage((page) => Math.max(1, page - 1))}
          onNextPage={() => setCurrentPage((page) => Math.min(displayPageCount, page + 1))}
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

      {outputError && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {outputError}
        </div>
      )}

      {outputMessage && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-4 text-green-700" role="status">
          <CheckCircle2 className="h-4 w-4 shrink-0" />{outputMessage}
        </div>
      )}

      {isExportingPng && (
        <div className="space-y-2 rounded-lg border border-blue-100 bg-blue-50 p-3">
          <ProgressBar progress={pngProgress} label={`編集結果を${imageExportOptions.format.toUpperCase()}に変換中...`} />
          <button type="button" onClick={() => exportAbortRef.current?.abort()} className="text-sm text-red-600 underline">画像出力をキャンセル</button>
        </div>
      )}

      <ImagePreview
        images={pngImages}
        onDownload={handleDownloadPng}
        onDownloadAll={handleDownloadAllPng}
        onClear={() => setPngImages([])}
      />

      {redactionFailure && (
        <RedactionFailureDialog
          error={redactionFailure.error}
          isBusy={isSavingPdf || isExportingPng}
          onClose={() => setRedactionFailure(null)}
          onBackToEdit={() => {
            setRedactionFailure(null);
            setActiveSubTab('content');
          }}
          onRetryWithCover={() => void retryRedactionFailureWithCover()}
        />
      )}
    </div>
  );
}

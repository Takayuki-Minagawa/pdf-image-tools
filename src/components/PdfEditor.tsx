import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  HardDrive,
  Redo2,
  RotateCcw,
  ShieldCheck,
  Trash2,
  FileUp,
  Undo2,
  X,
} from 'lucide-react';
import { Dropzone } from './Dropzone';
import { ImagePreview } from './ImagePreview';
import { ProgressBar } from './ProgressBar';
import { PageManagementPanel } from './pdfEdit/PageManagementPanel';
import { PdfEditorSidebar, type EditorSubTab } from './pdfEdit/PdfEditorSidebar';
import { PdfEditorPreview } from './pdfEdit/PdfEditorPreview';
import { applyPdfEdits } from '../utils/pdfEditOperations';
import {
  buildPdfFromPagePlan,
  copyPdfBytes,
  downloadPdf,
  duplicatePagePlanSelection,
  extractPdfPageIndices,
  getUnrotatedPageSize,
} from '../utils/pdfEditor';
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
import { applyContentEdits, RedactionVerificationError } from '../utils/contentEditOperations';
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
  DEFAULT_IMAGE_EXPORT_OPTIONS,
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
import type { PdfEditRecipe } from '../utils/recipeStorage';
import { downloadDataUrlsAsZip, sanitizeFilename } from '../utils/download';
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

function createInitialPageEntries(pageCount: number): PagePlanEntry[] {
  return Array.from({ length: pageCount }, (_, sourcePageIndex) => ({
    id: crypto.randomUUID(),
    sourcePageIndex,
    rotation: 0,
  }));
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function loadImageExportOptions(): PdfImageExportOptions {
  try {
    const stored = JSON.parse(localStorage.getItem('pdf-image-tools:pdf-image-export') ?? '{}') as Partial<PdfImageExportOptions>;
    return { ...DEFAULT_IMAGE_EXPORT_OPTIONS, ...stored };
  } catch {
    return DEFAULT_IMAGE_EXPORT_OPTIONS;
  }
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
  const [isExportingPng, setIsExportingPng] = useState(false);
  const [pngProgress, setPngProgress] = useState(0);
  const [pngImages, setPngImages] = useState<ConvertedImage[]>([]);
  const [outputError, setOutputError] = useState<string | null>(null);
  const [outputMessage, setOutputMessage] = useState<string | null>(null);
  const [pdfOutputName, setPdfOutputName] = useState('edited');
  const [imageExportOptions, setImageExportOptions] = useState<PdfImageExportOptions>(loadImageExportOptions);
  const exportAbortRef = useRef<AbortController | null>(null);
  const [redactionFailure, setRedactionFailure] = useState<RedactionFailureState | null>(null);
  const [redactionVerifiedAt, setRedactionVerifiedAt] = useState<number | null>(null);
  const [availableDraft, setAvailableDraft] = useState<StoredPdfDraft | null>(null);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(
    () => localStorage.getItem('pdf-image-tools:auto-save') !== 'off',
  );
  const [draftStatus, setDraftStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [storageSummary, setStorageSummary] = useState({ usage: 0, quota: 0 });
  const [pdfPassword, setPdfPassword] = useState('');
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
  const hasPageChanges =
    pageEntries.length > 0 &&
    (pageEntries.length !== originalTotalPages ||
      pageEntries.some((entry, index) =>
        entry.sourcePageIndex !== index || entry.rotation !== 0,
      ));
  const hasOverlayEdits =
    textBoxes.length > 0 ||
    headerFooter.header.enabled ||
    headerFooter.footer.enabled ||
    pageNumbering.enabled;

  const editSnapshot = useMemo<PdfEditorDraftSnapshot>(() => ({
    pageEntries,
    textBoxes,
    headerFooter,
    pageNumbering,
    contentEdits,
  }), [contentEdits, headerFooter, pageEntries, pageNumbering, textBoxes]);

  const restoreSnapshot = useCallback((snapshot: PdfEditorDraftSnapshot) => {
    setPageEntries(snapshot.pageEntries);
    pageEntriesRef.current = snapshot.pageEntries;
    setTextBoxes(snapshot.textBoxes);
    setHeaderFooter(snapshot.headerFooter);
    setPageNumbering(snapshot.pageNumbering);
    setContentEdits(snapshot.contentEdits);
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
    setRedactionVerifiedAt(null);
  }, [snapshotSignature]);

  useEffect(() => {
    if (!pdf) {
      setPageEntries([]);
      return;
    }

    const pendingDraft = pendingDraftRef.current;
    const initialEntries = pendingDraft?.snapshot.pageEntries.length
      ? pendingDraft.snapshot.pageEntries
      : createInitialPageEntries(pdf.numPages);
    setPageEntries(initialEntries);
    pageEntriesRef.current = initialEntries;
    setSelectedPages(new Set());
    setCurrentPage(pendingDraft ? Math.min(pendingDraft.currentPage, initialEntries.length) : 1);
    setScale(pendingDraft?.scale ?? 1);
    setActiveSubTab(pendingDraft?.activeSubTab ?? 'page-number');
    setPageInputValue(String(pendingDraft?.currentPage ?? 1));
    setExtractStart('');
    setExtractEnd('');
    setTextBoxes(pendingDraft?.snapshot.textBoxes ?? []);
    setHeaderFooter(pendingDraft?.snapshot.headerFooter ?? DEFAULT_HEADER_FOOTER);
    setPageNumbering(pendingDraft?.snapshot.pageNumbering ?? DEFAULT_PAGE_NUMBERING);
    setContentEdits(pendingDraft?.snapshot.contentEdits ?? []);
    if (pendingDraft) setImageExportOptions(pendingDraft.imageExportOptions);
    setRecognizedByPage(new Map());
    setSelectedContentId(null);
    setPageViewport(null);
    const initialSnapshot: PdfEditorDraftSnapshot = {
      pageEntries: initialEntries,
      textBoxes: pendingDraft?.snapshot.textBoxes ?? [],
      headerFooter: pendingDraft?.snapshot.headerFooter ?? DEFAULT_HEADER_FOOTER,
      pageNumbering: pendingDraft?.snapshot.pageNumbering ?? DEFAULT_PAGE_NUMBERING,
      contentEdits: pendingDraft?.snapshot.contentEdits ?? [],
    };
    resetHistory(initialSnapshot);
    savedSignatureRef.current = JSON.stringify(initialSnapshot);
    pendingDraftRef.current = null;
  }, [pdf, resetHistory]);

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
    localStorage.setItem('pdf-image-tools:auto-save', autoSaveEnabled ? 'on' : 'off');
    if (autoSaveEnabled) void requestPersistentStorage();
  }, [autoSaveEnabled]);

  useEffect(() => {
    localStorage.setItem('pdf-image-tools:pdf-image-export', JSON.stringify(imageExportOptions));
  }, [imageExportOptions]);

  useEffect(() => {
    if (!hasRedactions) return;
    let cancelled = false;
    void deletePdfDraft()
      .then(() => {
        if (cancelled) return;
        setAvailableDraft(null);
        setDraftSavedAt(null);
        setDraftStatus('idle');
        void getStorageSummary().then(setStorageSummary).catch(() => undefined);
      })
      .catch((error) => console.warn('墨消しを含む下書きを削除できませんでした', error));
    return () => {
      cancelled = true;
    };
  }, [hasRedactions]);

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
        void getStorageSummary().then(setStorageSummary).catch(() => undefined);
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
  }, [activeSubTab, autoSaveEnabled, currentPage, editSnapshot, hasRedactions, imageExportOptions, isDirty, loadedFile, pageEntries.length, pdf, pdfBytes, pdfFile, scale, snapshotSignature]);

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
    setPdfOutputName(file.name.replace(/\.pdf$/i, '') + '_edited');
    setAvailableDraft(null);
    setPdfFile(file);
  };

  const discardDraft = async () => {
    await deletePdfDraft();
    setAvailableDraft(null);
    setDraftSavedAt(null);
    setDraftStatus('idle');
    void getStorageSummary().then(setStorageSummary).catch(() => undefined);
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

  const handleFileDrop = useCallback((files: File[]) => {
    const nextPdfFile = files.find((file) =>
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'),
    );
    if (!nextPdfFile) return false;

    if (isDirty && !window.confirm('未保存の編集があります。別のPDFへ切り替えますか？')) return false;

    setPdfFile(nextPdfFile);
    setTextBoxes([]);
    setHeaderFooter(DEFAULT_HEADER_FOOTER);
    setPageNumbering(DEFAULT_PAGE_NUMBERING);
    setActiveTextBoxId(null);
    setContentEdits([]);
    setRecognizedByPage(new Map());
    setSelectedContentId(null);
    setPngImages([]);
    setOutputError(null);
    setPngProgress(0);
    setOutputMessage(null);
    setPdfOutputName(nextPdfFile.name.replace(/\.pdf$/i, '') + '_edited');
    savedSignatureRef.current = '';
    return true;
  }, [isDirty]);

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
    setTextBoxes([]);
    setHeaderFooter(DEFAULT_HEADER_FOOTER);
    setPageNumbering(DEFAULT_PAGE_NUMBERING);
    setActiveTextBoxId(null);
    setContentEdits([]);
    setRecognizedByPage(new Map());
    setSelectedContentId(null);
    setPngImages([]);
    setOutputError(null);
    setPngProgress(0);
    setOutputMessage(null);
    history.reset();
    savedSignatureRef.current = '';
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
      setSelectedPages((prevSelectedPages) => {
        const nextSelectedPages = new Set<number>();

        prevSelectedPages.forEach((displayIndex) => {
          const entryId = previousEntries[displayIndex]?.id;
          const nextDisplayIndex = nextEntries.findIndex((entry) => entry.id === entryId);
          if (nextDisplayIndex !== -1) nextSelectedPages.add(nextDisplayIndex);
        });

        return nextSelectedPages;
      });
      setTextBoxes((prevTextBoxes) => {
        const nextTextBoxes = prevTextBoxes.flatMap((box) => {
          if (box.pageIndex === -1) return [box];
          const entryId = previousEntries[box.pageIndex]?.id;
          if (!entryId) return [];
          const nextDisplayIndex = nextEntries.findIndex((entry) => entry.id === entryId);
          return nextDisplayIndex === -1 ? [] : [{ ...box, pageIndex: nextDisplayIndex }];
        });

        if (activeTextBoxId && !nextTextBoxes.some((box) => box.id === activeTextBoxId)) {
          setActiveTextBoxId(null);
        }

        return nextTextBoxes;
      });
      const retainedEntryIds = new Set(nextEntries.map((entry) => entry.id));
      setContentEdits((current) => current.filter((edit) =>
        !edit.pageEntryId || retainedEntryIds.has(edit.pageEntryId),
      ));
    },
    [activeTextBoxId],
  );

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

  const rotateSelectedPages = () => {
    updatePageEntries(pageEntries.map((entry, index) => selectedPages.has(index)
      ? { ...entry, rotation: ((entry.rotation + 90) % 360) as PagePlanEntry['rotation'] }
      : entry));
    setPngImages([]);
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

  const resetPageChanges = () => {
    const initialEntries = Array.from({ length: originalTotalPages }, (_, sourcePageIndex) => {
      const existing = pageEntries.find((entry) => entry.sourcePageIndex === sourcePageIndex);
      return existing
        ? { ...existing, rotation: 0 as const }
        : { id: crypto.randomUUID(), sourcePageIndex, rotation: 0 as const };
    });
    updatePageEntries(initialEntries);
    setSelectedPages(new Set());
    setCurrentPage(1);
    setExtractStart('');
    setExtractEnd('');
    setPngImages([]);
    setOutputError(null);
  };

  const handleDragStart = (displayIndex: number) => {
    draggedIndexRef.current = displayIndex;
    setDraggedIndex(displayIndex);
  };

  const handleDragOver = (e: React.DragEvent, displayIndex: number) => {
    e.preventDefault();
    const fromIndex = draggedIndexRef.current;
    if (fromIndex === null || fromIndex === displayIndex) return;

    const nextEntries = [...pageEntriesRef.current];
    const [draggedPage] = nextEntries.splice(fromIndex, 1);
    nextEntries.splice(displayIndex, 0, draggedPage);
    updatePageEntries(nextEntries);
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
    const nextEntries = [...pageEntries];
    [nextEntries[displayIndex], nextEntries[targetIndex]] = [nextEntries[targetIndex], nextEntries[displayIndex]];
    updatePageEntries(nextEntries);
  };

  const buildEditedPdf = useCallback(async (allowCoverOnly = false) => {
    if (!pdfBytes || !pdfFile) {
      throw new Error('PDFが読み込まれていません');
    }

    let workingPdf: ArrayBuffer | Uint8Array = pdfBytes;

    if (hasPageChanges) {
      workingPdf = await buildPdfFromPagePlan(workingPdf, pageEntries);
    }

    // ページ計画を反映した後、entry idを最終ページ番号へ変換する。
    // 同じ元ページを複製しても、選択したコピーだけを編集できる。
    const scopedContentEdits = contentEdits.flatMap((edit) => {
      const pageIndex = edit.pageEntryId
        ? pageEntries.findIndex((entry) => entry.id === edit.pageEntryId)
        : pageEntries.findIndex((entry) => entry.sourcePageIndex === edit.target.pageIndex);
      return pageIndex === -1
        ? []
        : [{ ...edit, target: { ...edit.target, pageIndex } } as ContentEdit];
    });

    if (scopedContentEdits.length > 0) {
      try {
        workingPdf = await applyContentEdits(
          workingPdf,
          scopedContentEdits,
          undefined,
          { failOnResidual: true },
        );
      } catch (error) {
        if (!(error instanceof RedactionVerificationError)) throw error;
        if (!allowCoverOnly) throw error;
        workingPdf = error.coveredPdfBytes;
      }
    }

    if (hasOverlayEdits) {
      return applyPdfEdits(
        workingPdf,
        { textBoxes, headerFooter, pageNumbering },
        pdfFile.name,
      );
    }

    return copyPdfBytes(workingPdf);
  }, [
    pdfBytes,
    pdfFile,
    hasOverlayEdits,
    hasPageChanges,
    pageEntries,
    textBoxes,
    headerFooter,
    pageNumbering,
    contentEdits,
  ]);

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
      const extractedPdf = await extractPdfPageIndices(
        editedPdf,
        Array.from({ length: end - start + 1 }, (_, index) => start - 1 + index),
      );
      downloadPdf(extractedPdf, `${pdfFile.name.replace('.pdf', '')}_pages_${start}-${end}.pdf`);
      setRedactionFailure(null);
    } catch (err) {
      console.error(err);
      if (err instanceof RedactionVerificationError) {
        setRedactionFailure({ error: err, operation: 'extract-range' });
      } else {
        setOutputError('抽出中にエラーが発生しました: ' + (err instanceof Error ? err.message : '不明なエラー'));
      }
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
      console.error(error);
      if (error instanceof RedactionVerificationError) {
        setRedactionFailure({ error, operation: 'extract-selected' });
      } else {
        setOutputError(error instanceof Error ? error.message : '選択ページを抽出できませんでした');
      }
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
      setAvailableDraft(null);
      setDraftSavedAt(null);
      setDraftStatus('idle');
      setRedactionFailure(null);
      setRedactionVerifiedAt(hasRedactions && !allowCoverOnly ? Date.now() : null);
      void getStorageSummary().then(setStorageSummary).catch(() => undefined);
      setOutputMessage(`${filename}（${formatBytes(result.byteLength)}）を保存しました`);
    } catch (err) {
      console.error(err);
      if (err instanceof RedactionVerificationError) {
        setRedactionFailure({ error: err, operation: 'save' });
      } else {
        setOutputError('PDF保存中にエラーが発生しました: ' + (err instanceof Error ? err.message : '不明なエラー'));
      }
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
      let pageIndices: number[] | undefined;
      if (imageExportOptions.pageMode === 'selected') {
        pageIndices = [...selectedPages].sort((a, b) => a - b);
      } else if (imageExportOptions.pageMode === 'range') {
        const start = Math.max(1, imageExportOptions.rangeStart);
        const end = Math.min(displayPageCount, imageExportOptions.rangeEnd);
        if (start > end) throw new Error('画像出力のページ範囲が正しくありません');
        pageIndices = Array.from({ length: end - start + 1 }, (_, index) => start - 1 + index);
      }
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
        const extension = imageExportOptions.format === 'jpeg' ? 'jpg' : imageExportOptions.format;
        const zipName = sanitizeFilename(imageExportOptions.filename, 'edited-pages');
        await downloadDataUrlsAsZip(
          images.map((image) => ({
            filename: `${zipName}_page_${image.pageNumber}.${extension}`,
            dataUrl: image.dataUrl,
          })),
          zipName,
        );
        setOutputMessage(`${images.length}ページをZIPで保存しました`);
      } else {
        setOutputMessage(`${images.length}ページの画像を生成しました`);
      }
    } catch (err) {
      console.error(err);
      if (err instanceof DOMException && err.name === 'AbortError') {
        setOutputMessage('画像出力をキャンセルしました');
      } else if (err instanceof RedactionVerificationError) {
        setRedactionFailure({ error: err, operation: 'export-images' });
      } else {
        setOutputError('画像出力中にエラーが発生しました: ' + (err instanceof Error ? err.message : '不明なエラー'));
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
      const extension = imageExportOptions.format === 'jpeg' ? 'jpg' : imageExportOptions.format;
      const link = document.createElement('a');
      link.href = image.dataUrl;
      link.download = `${sanitizeFilename(imageExportOptions.filename, 'edited-pages')}_page_${image.pageNumber}.${extension}`;
      link.click();
    },
    [imageExportOptions.filename, imageExportOptions.format],
  );

  const handleDownloadAllPng = useCallback(async () => {
    if (pngImages.length === 1 && !imageExportOptions.zip) {
      handleDownloadPng(pngImages[0]);
      return;
    }
    const extension = imageExportOptions.format === 'jpeg' ? 'jpg' : imageExportOptions.format;
    const zipName = sanitizeFilename(imageExportOptions.filename, 'edited-pages');
    await downloadDataUrlsAsZip(
      pngImages.map((image) => ({ filename: `${zipName}_page_${image.pageNumber}.${extension}`, dataUrl: image.dataUrl })),
      zipName,
    );
  }, [handleDownloadPng, imageExportOptions.filename, imageExportOptions.format, imageExportOptions.zip, pngImages]);

  const applyRecipe = (recipe: PdfEditRecipe) => {
    setTextBoxes(structuredClone(recipe.textBoxes));
    setHeaderFooter(structuredClone(recipe.headerFooter));
    setPageNumbering(structuredClone(recipe.pageNumbering));
    setImageExportOptions(structuredClone(recipe.imageExportOptions));
    setOutputMessage(`レシピ「${recipe.name}」を適用しました`);
  };

  if (!pdfFile) {
    return (
      <div className="space-y-4">
        {availableDraft && (
          <section className="rounded-xl border border-blue-200 bg-blue-50 p-4" aria-labelledby="draft-resume-title">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id="draft-resume-title" className="flex items-center gap-2 font-semibold text-blue-900"><Clock3 className="h-5 w-5" />前回の作業を再開できます</h2>
                <p className="mt-1 text-sm text-blue-800">{availableDraft.fileName}・{availableDraft.snapshot.pageEntries.length}ページ・{new Date(availableDraft.savedAt).toLocaleString('ja-JP')}</p>
                <p className="mt-1 text-xs text-blue-700">下書きはこの端末内だけに保存されています。</p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => void resumeDraft()} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800">再開</button>
                <button type="button" onClick={() => void discardDraft()} className="rounded-lg border border-blue-300 bg-white px-4 py-2 text-sm text-blue-800 hover:bg-blue-100">破棄</button>
              </div>
            </div>
          </section>
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
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (submitPassword(pdfPassword)) setPdfPassword('');
        }}
        className="mx-auto max-w-md rounded-xl border border-blue-200 bg-blue-50 p-6"
      >
        <h2 className="font-semibold text-blue-950">パスワード付きPDF</h2>
        <p className="mt-1 text-sm text-blue-800">このファイルを開くためのパスワードを入力してください。パスワードは保存されません。</p>
        <label className="mt-4 block text-sm text-blue-900">PDFパスワード<input autoFocus type="password" value={pdfPassword} onChange={(event) => setPdfPassword(event.target.value)} className="mt-1 w-full rounded-lg border border-blue-300 bg-white px-3 py-2" /></label>
        <div className="mt-4 flex gap-2">
          <button type="submit" disabled={!pdfPassword} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">開く</button>
          <button type="button" onClick={() => handleReset(true)} className="rounded-lg border border-blue-300 bg-white px-4 py-2 text-sm text-blue-800">別のファイル</button>
        </div>
      </form>
    );
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
      <div className="rounded-xl border border-red-200 bg-red-50 p-6" role="alert">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-red-600" />
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-red-900">{pdfLoadError?.message ?? 'PDFを開けませんでした'}</h2>
            <p className="mt-1 text-sm text-red-700">{pdfLoadError?.action}</p>
            <p className="mt-2 truncate text-xs text-red-600">{pdfFile.name}（{formatBytes(pdfFile.size)}）</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={retryPdfLoad} className="rounded-lg bg-red-700 px-4 py-2 text-sm text-white hover:bg-red-800">再試行</button>
              <button type="button" onClick={() => handleReset(true)} className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm text-red-700 hover:bg-red-100">別のファイルを選ぶ</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <FileUp className="h-5 w-5 shrink-0 text-amber-600" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-700">{pdfFile.name}</p>
              <p className="text-xs text-gray-500">
                {displayPageCount} ページ / 元ファイル {originalTotalPages} ページ / {formatBytes(pdfFile.size)}
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${isDirty ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`} aria-live="polite">
            {isDirty ? <Clock3 className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {isDirty ? '未保存' : '保存済み'}
          </span>
          {hasRedactions && redactionVerifiedAt && (
            <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800" title={`最終検証: ${new Date(redactionVerifiedAt).toLocaleString('ja-JP')}`}>
              <ShieldCheck className="h-3.5 w-3.5" />完全削除を検証済み
            </span>
          )}
          <button type="button" onClick={history.undo} disabled={!history.canUndo} title="元に戻す (Ctrl/Cmd+Z)" className="rounded-lg bg-white p-2 text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-40"><Undo2 className="h-4 w-4" /></button>
          <button type="button" onClick={history.redo} disabled={!history.canRedo} title="やり直す (Ctrl/Cmd+Shift+Z)" className="rounded-lg bg-white p-2 text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-40"><Redo2 className="h-4 w-4" /></button>
          <label className="flex items-center gap-1.5 rounded-lg bg-white px-2 py-1.5 text-xs text-gray-600 shadow-sm" title="元PDFと編集内容をこの端末内のIndexedDBに保存します">
            <input type="checkbox" checked={autoSaveEnabled} onChange={(event) => setAutoSaveEnabled(event.target.checked)} />
            自動保存
            {draftStatus === 'saving' && '中…'}
            {draftStatus === 'saved' && draftSavedAt && ` ${new Date(draftSavedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`}
            {draftStatus === 'error' && ' 失敗'}
          </label>
          {storageSummary.quota > 0 && (
            <span className="text-[11px] text-gray-500" title="ブラウザ保存領域の使用量">
              {formatBytes(storageSummary.usage)} / {formatBytes(storageSummary.quota)}
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              setAutoSaveEnabled(false);
              void discardDraft();
            }}
            title="ローカル下書きを削除して自動保存をオフにする"
            aria-label="ローカル下書きを削除"
            className="rounded-lg bg-white p-2 text-gray-500 shadow-sm hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => handleReset()} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-amber-100 hover:text-gray-800">
            <RotateCcw className="h-4 w-4" />ファイルを変更
          </button>
        </div>
      </div>

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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="redaction-failure-title">
          <div className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-7 w-7 shrink-0 text-red-600" />
                <div>
                  <h2 id="redaction-failure-title" className="text-lg font-bold text-gray-900">完全削除を確認できないため保存を停止しました</h2>
                  <p className="mt-2 text-sm text-gray-600">見た目は隠れても、次の文字データを抽出できる可能性があります。</p>
                </div>
              </div>
              <button type="button" onClick={() => setRedactionFailure(null)} aria-label="閉じる" className="rounded p-1 hover:bg-gray-100"><X className="h-5 w-5" /></button>
            </div>
            <ul className="mt-4 max-h-52 space-y-2 overflow-auto rounded-lg bg-red-50 p-3 text-sm text-red-800">
              {redactionFailure.error.residual.map((item) => (
                <li key={item.id}>ページ {item.pageIndex + 1}: 「{item.text}」</li>
              ))}
            </ul>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => { setRedactionFailure(null); setActiveSubTab('content'); }} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">編集へ戻る</button>
              <button type="button" onClick={() => void retryRedactionFailureWithCover()} disabled={isSavingPdf || isExportingPng} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50">リスクを理解してカバーのみで再試行</button>
            </div>
            <p className="mt-3 text-xs text-gray-500">カバーのみの保存では、コピー、検索、AIによる抽出などで元の文字が取得される場合があります。</p>
          </div>
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PdfImageExportOptions } from '../types/pdfEdit';
import {
  deletePdfDraft,
  getStorageSummary,
  loadPdfDraft,
  requestPersistentStorage,
  savePdfDraft,
  type PdfEditorDraftSnapshot,
  type StoredPdfDraft,
} from '../utils/draftStorage';

export type DraftStatus = 'idle' | 'saving' | 'saved' | 'error';

const AUTO_SAVE_STORAGE_KEY = 'pdf-image-tools:auto-save';
const AUTO_SAVE_DELAY_MS = 900;

interface UsePdfDraftAutosaveOptions {
  pdfFile: File | null;
  /** usePdfDocument が実際に読み込み終えたファイル */
  loadedFile: File | null;
  pdfBytes: ArrayBuffer | null;
  pdf: PDFDocumentProxy | null;
  snapshot: PdfEditorDraftSnapshot;
  snapshotSignature: string;
  isDirty: boolean;
  /** 墨消しを含む編集は端末内にも残さない */
  hasRedactions: boolean;
  /** 最後に保存（下書き・PDF保存）した編集内容の署名。保存成功時に更新する */
  savedSignatureRef: RefObject<string>;
  currentPage: number;
  scale: number;
  activeSubTab: StoredPdfDraft['activeSubTab'];
  imageExportOptions: PdfImageExportOptions;
}

/**
 * PDF編集の下書きを IndexedDB に自動保存し、再開できる下書きと保存領域の使用量を管理する。
 */
export function usePdfDraftAutosave({
  pdfFile,
  loadedFile,
  pdfBytes,
  pdf,
  snapshot,
  snapshotSignature,
  isDirty,
  hasRedactions,
  savedSignatureRef,
  currentPage,
  scale,
  activeSubTab,
  imageExportOptions,
}: UsePdfDraftAutosaveOptions) {
  const [availableDraft, setAvailableDraft] = useState<StoredPdfDraft | null>(null);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(
    () => localStorage.getItem(AUTO_SAVE_STORAGE_KEY) !== 'off',
  );
  const [draftStatus, setDraftStatus] = useState<DraftStatus>('idle');
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [storageSummary, setStorageSummary] = useState({ usage: 0, quota: 0 });
  // 保存完了時点の最新値で墨消しの有無を判定するため、ref でも保持する。
  const redactionDraftBlockedRef = useRef(hasRedactions);
  useEffect(() => {
    redactionDraftBlockedRef.current = hasRedactions;
  }, [hasRedactions]);

  const refreshStorageSummary = useCallback(() => {
    void getStorageSummary().then(setStorageSummary).catch(() => undefined);
  }, []);

  const clearDraftState = useCallback(() => {
    setAvailableDraft(null);
    setDraftSavedAt(null);
    setDraftStatus('idle');
  }, []);

  const discardDraft = useCallback(async () => {
    await deletePdfDraft();
    clearDraftState();
    refreshStorageSummary();
  }, [clearDraftState, refreshStorageSummary]);

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

  const shouldAutoSave = Boolean(
    autoSaveEnabled &&
    isDirty &&
    !hasRedactions &&
    pdfFile &&
    loadedFile === pdfFile &&
    pdfBytes &&
    pdf &&
    snapshot.pageEntries.length > 0,
  );

  // 保存を予約し直すたびに「保存中」を表示し、保存せずに予約が取り消された（変更を元に戻した・
  // 自動保存をオフにした）場合は直前の状態へ戻す。effect 内で同期的に setState しないよう、
  // 予約内容が変わったことをレンダー中に検知して状態を合わせる。
  const scheduleKey = shouldAutoSave
    ? [
      pdfFile?.name,
      pdfFile?.lastModified,
      snapshotSignature,
      currentPage,
      scale,
      activeSubTab,
      JSON.stringify(imageExportOptions),
    ].join('|')
    : null;
  const [lastScheduleKey, setLastScheduleKey] = useState<string | null>(null);
  if (scheduleKey !== lastScheduleKey) {
    setLastScheduleKey(scheduleKey);
    if (scheduleKey !== null) setDraftStatus('saving');
    else if (draftStatus === 'saving') setDraftStatus(draftSavedAt ? 'saved' : 'idle');
  }

  useEffect(() => {
    if (
      !shouldAutoSave ||
      !pdfFile ||
      !pdfBytes
    ) return;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      savePdfDraft({
        fileName: pdfFile.name,
        fileType: pdfFile.type || 'application/pdf',
        fileLastModified: pdfFile.lastModified,
        fileBytes: pdfBytes.slice(0),
        snapshot: structuredClone(snapshot),
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
    }, AUTO_SAVE_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [activeSubTab, currentPage, imageExportOptions, pdfBytes, pdfFile, refreshStorageSummary, savedSignatureRef, scale, shouldAutoSave, snapshot, snapshotSignature]);

  return {
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
  };
}

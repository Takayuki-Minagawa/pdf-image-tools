import type {
  HeaderFooterSettings,
  PageNumberingConfig,
  PagePlanEntry,
  PdfImageExportOptions,
  TextBoxConfig,
} from '../types/pdfEdit';
import type { ContentEdit } from '../types/contentEdit';

const DATABASE_NAME = 'pdf-image-tools';
const DATABASE_VERSION = 1;
const STORE_NAME = 'drafts';
const LATEST_DRAFT_ID = 'pdf-editor-latest';
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

export interface PdfEditorDraftSnapshot {
  pageEntries: PagePlanEntry[];
  textBoxes: TextBoxConfig[];
  headerFooter: HeaderFooterSettings;
  pageNumbering: PageNumberingConfig;
  contentEdits: ContentEdit[];
}

export interface StoredPdfDraft {
  id: typeof LATEST_DRAFT_ID;
  fileName: string;
  fileType: string;
  fileLastModified: number;
  fileBytes: ArrayBuffer;
  snapshot: PdfEditorDraftSnapshot;
  currentPage: number;
  scale: number;
  activeSubTab: 'content' | 'textbox' | 'header-footer' | 'page-number';
  imageExportOptions: PdfImageExportOptions;
  savedAt: number;
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('下書きデータベースを開けません'));
  });
}

async function runRequest<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    let result!: T;
    let settled = false;
    request.onsuccess = () => {
      result = request.result;
    };
    const fail = (error: DOMException | null) => {
      if (settled) return;
      settled = true;
      database.close();
      reject(error ?? new Error('下書きの保存に失敗しました'));
    };
    request.onerror = () => fail(request.error);
    transaction.onerror = () => fail(transaction.error);
    transaction.onabort = () => fail(transaction.error);
    transaction.oncomplete = () => {
      if (settled) return;
      settled = true;
      database.close();
      resolve(result);
    };
  });
}

export function savePdfDraft(draft: Omit<StoredPdfDraft, 'id'>) {
  return runRequest('readwrite', (store) => store.put({ ...draft, id: LATEST_DRAFT_ID } as StoredPdfDraft));
}

export async function loadPdfDraft() {
  const result = await runRequest<StoredPdfDraft | undefined>(
    'readonly',
    (store) => store.get(LATEST_DRAFT_ID),
  );
  if (result && Date.now() - result.savedAt > DRAFT_MAX_AGE_MS) {
    await deletePdfDraft();
    return null;
  }
  return result ?? null;
}

export function deletePdfDraft() {
  return runRequest('readwrite', (store) => store.delete(LATEST_DRAFT_ID));
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}

export async function getStorageSummary() {
  const estimate = await navigator.storage?.estimate?.();
  return {
    usage: estimate?.usage ?? 0,
    quota: estimate?.quota ?? 0,
  };
}

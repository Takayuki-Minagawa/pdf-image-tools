/**
 * PDF文書情報（Info辞書のタイトル・作成者など）の読み書き。ブラウザ版と CLI で共有する。
 */
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';

/** 編集できる文書情報。空文字は「その項目を削除する」を表す。 */
export interface PdfDocumentMetadata {
  title: string;
  author: string;
  subject: string;
  keywords: string;
}

export interface PdfDocumentInfo extends PdfDocumentMetadata {
  creator: string;
  producer: string;
  creationDate: string | null;
  modificationDate: string | null;
}

export const EMPTY_PDF_METADATA: PdfDocumentMetadata = {
  title: '',
  author: '',
  subject: '',
  keywords: '',
};

const INFO_KEYS: Record<keyof PdfDocumentMetadata, string> = {
  title: 'Title',
  author: 'Author',
  subject: 'Subject',
  keywords: 'Keywords',
};

function getInfoDict(doc: PDFDocument): PDFDict | undefined {
  const infoRef = doc.context.trailerInfo.Info;
  if (!infoRef) return undefined;
  const info = doc.context.lookup(infoRef);
  return info instanceof PDFDict ? info : undefined;
}

export async function readPdfInfo(pdfBytes: ArrayBuffer | Uint8Array): Promise<PdfDocumentInfo> {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false, ignoreEncryption: true });
  return {
    title: doc.getTitle() ?? '',
    author: doc.getAuthor() ?? '',
    subject: doc.getSubject() ?? '',
    keywords: doc.getKeywords() ?? '',
    creator: doc.getCreator() ?? '',
    producer: doc.getProducer() ?? '',
    creationDate: doc.getCreationDate()?.toISOString() ?? null,
    modificationDate: doc.getModificationDate()?.toISOString() ?? null,
  };
}

export function isSameMetadata(a: PdfDocumentMetadata, b: PdfDocumentMetadata): boolean {
  return (Object.keys(INFO_KEYS) as Array<keyof PdfDocumentMetadata>).every((key) => a[key].trim() === b[key].trim());
}

/**
 * 文書情報を書き込む。`undefined` の項目は変更せず、空文字の項目は Info 辞書から削除する。
 * 更新日時は現在時刻にする。
 */
export async function applyPdfMetadata(
  pdfBytes: ArrayBuffer | Uint8Array,
  metadata: Partial<PdfDocumentMetadata>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const setters: Record<keyof PdfDocumentMetadata, (value: string) => void> = {
    title: (value) => doc.setTitle(value),
    author: (value) => doc.setAuthor(value),
    subject: (value) => doc.setSubject(value),
    // pdf-lib は配列を空白で連結するため、入力文字列をそのまま1要素として渡す。
    keywords: (value) => doc.setKeywords([value]),
  };
  for (const key of Object.keys(INFO_KEYS) as Array<keyof PdfDocumentMetadata>) {
    const value = metadata[key];
    if (value === undefined) continue;
    const trimmed = value.trim();
    if (trimmed) setters[key](trimmed);
    else getInfoDict(doc)?.delete(PDFName.of(INFO_KEYS[key]));
  }
  doc.setModificationDate(new Date());
  return doc.save();
}

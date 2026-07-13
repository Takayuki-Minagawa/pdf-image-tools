export type PdfLoadErrorKind =
  | 'unsupported'
  | 'encrypted'
  | 'corrupt'
  | 'too-large'
  | 'cancelled'
  | 'unknown';

export interface PdfLoadErrorInfo {
  kind: PdfLoadErrorKind;
  title: string;
  message: string;
  suggestion: string;
}

export interface OrderableMergePage {
  id: string;
  fileId: string;
}

const MAX_PDF_BYTES = 250 * 1024 * 1024;

export function isLikelyPdf(file: Pick<File, 'name' | 'type'>): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

export function validatePdfFile(file: Pick<File, 'name' | 'type' | 'size'>): void {
  if (!isLikelyPdf(file)) {
    throw new Error('UNSUPPORTED_PDF_TYPE');
  }
  if (file.size > MAX_PDF_BYTES) {
    throw new Error('PDF_TOO_LARGE');
  }
}

export function classifyPdfLoadError(error: unknown): PdfLoadErrorInfo {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  const normalized = `${name} ${message}`.toLowerCase();

  if (
    normalized.includes('abort') ||
    normalized.includes('cancel') ||
    normalized.includes('worker was destroyed')
  ) {
    return {
      kind: 'cancelled',
      title: 'キャンセル済み',
      message: 'このファイルの読み込みをキャンセルしました。',
      suggestion: '必要であれば「再試行」を選んでください。',
    };
  }
  if (normalized.includes('unsupported_pdf_type')) {
    return {
      kind: 'unsupported',
      title: 'PDFではないファイル',
      message: '対応しているのはPDFファイルだけです。',
      suggestion: 'PDFに変換してから追加するか、この項目を除外してください。',
    };
  }
  if (normalized.includes('pdf_too_large')) {
    return {
      kind: 'too-large',
      title: 'ファイルが大きすぎます',
      message: '250 MBを超えるPDFは、この画面では読み込めません。',
      suggestion: 'PDFを分割または圧縮してから再試行してください。',
    };
  }
  if (
    normalized.includes('password') ||
    normalized.includes('encrypted') ||
    normalized.includes('passwordexception')
  ) {
    return {
      kind: 'encrypted',
      title: 'パスワード保護PDF',
      message: 'パスワードで保護されているため読み込めません。',
      suggestion: '保護を解除したコピーを用意してから再試行してください。',
    };
  }
  if (
    normalized.includes('invalidpdf') ||
    normalized.includes('missing pdf') ||
    normalized.includes('invalid pdf') ||
    normalized.includes('corrupt')
  ) {
    return {
      kind: 'corrupt',
      title: '破損または非対応のPDF',
      message: 'PDFの構造を読み取れませんでした。',
      suggestion: '別のPDFビューアーで開けるか確認し、再保存したPDFをお試しください。',
    };
  }
  return {
    kind: 'unknown',
    title: '読み込みエラー',
    message: 'PDFの読み込み中に予期しないエラーが発生しました。',
    suggestion: 'もう一度試すか、このファイルを除外してください。',
  };
}

export function moveItem<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length ||
    fromIndex === toIndex
  ) {
    return [...items];
  }
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

export function regroupPagesByFile<T extends OrderableMergePage>(
  pages: readonly T[],
  fileOrder: readonly string[],
): T[] {
  const order = new Map(fileOrder.map((id, index) => [id, index]));
  return pages
    .map((page, originalIndex) => ({ page, originalIndex }))
    .sort((a, b) => {
      const aOrder = order.get(a.page.fileId) ?? Number.MAX_SAFE_INTEGER;
      const bOrder = order.get(b.page.fileId) ?? Number.MAX_SAFE_INTEGER;
      return aOrder - bOrder || a.originalIndex - b.originalIndex;
    })
    .map(({ page }) => page);
}

export function interleavePages<T extends OrderableMergePage>(
  pages: readonly T[],
  fileOrder: readonly string[],
): T[] {
  const buckets = new Map<string, T[]>();
  for (const fileId of fileOrder) buckets.set(fileId, []);
  const remainder: T[] = [];
  for (const page of pages) {
    const bucket = buckets.get(page.fileId);
    if (bucket) bucket.push(page);
    else remainder.push(page);
  }

  const result: T[] = [];
  const longest = Math.max(0, ...[...buckets.values()].map((bucket) => bucket.length));
  for (let pageIndex = 0; pageIndex < longest; pageIndex += 1) {
    for (const fileId of fileOrder) {
      const page = buckets.get(fileId)?.[pageIndex];
      if (page) result.push(page);
    }
  }
  return [...result, ...remainder];
}

export function sanitizePdfFilename(value: string): string {
  const withoutExtension = value.trim().replace(/\.pdf$/i, '');
  const safe = withoutExtension.replace(/[<>:"/\\|?*\p{Cc}]/gu, '_').replace(/[. ]+$/g, '');
  return `${safe || 'merged'}.pdf`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

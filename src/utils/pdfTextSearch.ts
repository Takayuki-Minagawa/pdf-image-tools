import type { RecognizedItem, RecognizedTextItem } from '../types/contentEdit';
import type { PagePlanEntry } from '../types/pdfEdit';

export const MAX_PDF_SEARCH_RESULTS = 200;

export interface PdfTextSearchHit {
  pageEntryId: string;
  pageIndex: number;
  item: RecognizedTextItem;
  pageItems: RecognizedItem[];
}

export interface PdfTextSearchResult {
  hits: PdfTextSearchHit[];
  totalMatches: number;
  textItemCount: number;
  failedPages: number[];
}

/** Search text runs on the displayed pages; a duplicate keeps its own navigation target. */
export async function searchPdfText({
  pageEntries,
  query,
  readPage,
  signal,
  onProgress,
}: {
  pageEntries: PagePlanEntry[];
  query: string;
  readPage: (sourcePageIndex: number) => Promise<RecognizedItem[]>;
  signal: AbortSignal;
  onProgress?: (completed: number) => void;
}): Promise<PdfTextSearchResult> {
  const result: PdfTextSearchResult = { hits: [], totalMatches: 0, textItemCount: 0, failedPages: [] };
  const needle = query.trim().toLowerCase();
  if (!needle) return result;

  for (const [pageIndex, entry] of pageEntries.entries()) {
    signal.throwIfAborted();
    if (entry.sourcePageIndex !== null) {
      let pageItems: RecognizedItem[];
      try {
        pageItems = await readPage(entry.sourcePageIndex);
      } catch {
        signal.throwIfAborted();
        result.failedPages.push(pageIndex + 1);
        onProgress?.(pageIndex + 1);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        continue;
      }
      signal.throwIfAborted();
      for (const item of pageItems) {
        if (item.kind !== 'text') continue;
        result.textItemCount++;
        if (!item.text.toLowerCase().includes(needle)) continue;
        result.totalMatches++;
        if (result.hits.length < MAX_PDF_SEARCH_RESULTS) {
          result.hits.push({ pageEntryId: entry.id, pageIndex, item, pageItems });
        }
      }
    }
    onProgress?.(pageIndex + 1);
    // Cached pages can otherwise occupy the microtask queue and prevent Cancel clicks.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  signal.throwIfAborted();
  return result;
}

export function getSearchSnippet(text: string, query: string): string {
  const matchIndex = text.toLowerCase().indexOf(query.trim().toLowerCase());
  const start = Math.max(0, matchIndex - 35);
  const end = Math.min(text.length, Math.max(start + 110, matchIndex + query.trim().length));
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

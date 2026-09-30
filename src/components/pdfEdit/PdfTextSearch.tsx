import { Loader2, Search, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { RecognizedItem } from '../../types/contentEdit';
import type { PagePlanEntry } from '../../types/pdfEdit';
import { recognizePageContent } from '../../utils/contentRecognition';
import { getSearchSnippet, MAX_PDF_SEARCH_RESULTS, searchPdfText } from '../../utils/pdfTextSearch';
import type { PdfTextSearchResult } from '../../utils/pdfTextSearch';

interface PdfTextSearchProps {
  pdf: PDFDocumentProxy;
  pageEntries: PagePlanEntry[];
  onSelect: (pageIndex: number, items: RecognizedItem[], selectedId: string) => void;
}

interface SearchState {
  pdf: PDFDocumentProxy;
  pageEntries: PagePlanEntry[];
  query: string;
  phase: 'searching' | 'done' | 'cancelled' | 'error';
  completed: number;
  result?: PdfTextSearchResult;
}

export function PdfTextSearch({ pdf, pageEntries, onSelect }: PdfTextSearchProps) {
  const inputId = useId();
  const [query, setQuery] = useState('');
  const [searchState, setSearchState] = useState<SearchState | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const pageCacheRef = useRef<{ pdf: PDFDocumentProxy; pages: Map<number, Promise<RecognizedItem[]>> } | null>(null);
  const current = searchState?.pdf === pdf && searchState.pageEntries === pageEntries ? searchState : null;
  const isSearching = current?.phase === 'searching';

  const readPage = (sourcePageIndex: number) => {
    if (pageCacheRef.current?.pdf !== pdf) pageCacheRef.current = { pdf, pages: new Map() };
    const pages = pageCacheRef.current.pages;
    let pending = pages.get(sourcePageIndex);
    if (!pending) {
      pending = pdf.getPage(sourcePageIndex + 1).then(recognizePageContent).catch((error: unknown) => {
        pages.delete(sourcePageIndex);
        throw error;
      });
      pages.set(sourcePageIndex, pending);
    }
    return pending;
  };

  useEffect(() => () => {
    controllerRef.current?.abort();
  }, [pdf, pageEntries]);

  const search = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const initial: SearchState = { pdf, pageEntries, query: trimmed, phase: 'searching', completed: 0 };
    setSearchState(initial);
    try {
      const result = await searchPdfText({
        pageEntries,
        query: trimmed,
        readPage,
        signal: controller.signal,
        onProgress: (completed) => {
          if (!controller.signal.aborted) setSearchState({ ...initial, completed });
        },
      });
      if (!controller.signal.aborted) {
        setSearchState({ ...initial, phase: 'done', completed: pageEntries.length, result });
      }
    } catch {
      if (!controller.signal.aborted) setSearchState({ ...initial, phase: 'error' });
    }
  };

  const cancel = () => {
    controllerRef.current?.abort();
    setSearchState((previous) => previous ? { ...previous, phase: 'cancelled' } : null);
  };

  return (
    <section className="space-y-2 rounded-lg border border-gray-200 bg-white p-3" aria-label="元PDFのテキスト検索">
      <form onSubmit={(event) => { void search(event); }} className="space-y-2">
        <label htmlFor={inputId} className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
          <Search className="h-4 w-4" />元PDFのテキスト検索
        </label>
        <div className="flex gap-2">
          <input
            id={inputId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="検索する文字列"
            className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          <button type="submit" disabled={!query.trim() || isSearching} className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">検索</button>
          {isSearching && <button type="button" onClick={cancel} aria-label="検索を中止" className="rounded-md border border-gray-300 p-1.5 hover:bg-gray-50"><X className="h-4 w-4" /></button>}
        </div>
      </form>
      <p className="text-xs text-gray-500">現在のページ構成に含まれる元の文字を検索します。追加・置換した文字は対象外です。画像だけのPDFにはOCRが必要です。</p>
      <div role="status" aria-live="polite" className="text-xs text-gray-600">
        {isSearching && <span className="flex items-center gap-1"><Loader2 className="h-3.5 w-3.5 animate-spin" />検索中 {current.completed} / {pageEntries.length}ページ</span>}
        {current?.phase === 'cancelled' && '検索を中止しました。'}
        {current?.phase === 'error' && '検索に失敗しました。もう一度お試しください。'}
        {current?.phase === 'done' && current.result && (
          current.result.totalMatches > 0
            ? `「${current.query}」に一致するテキスト: ${current.result.totalMatches}件${current.result.totalMatches > MAX_PDF_SEARCH_RESULTS ? `（先頭${MAX_PDF_SEARCH_RESULTS}件を表示。検索語を絞り込んでください）` : ''}`
            : current.result.textItemCount === 0 && current.result.failedPages.length === 0
              ? '検索できる文字がありません。画像やアウトライン化された文字は検索できません。'
              : `「${current.query}」に一致するテキストは見つかりませんでした。`
        )}
      </div>
      {current?.result && current.result.failedPages.length > 0 && (
        <p role="alert" className="text-xs text-amber-700">読み取れなかったページ: {current.result.failedPages.slice(0, 20).join(', ')}{current.result.failedPages.length > 20 ? ' ほか' : ''}。これらのページは検索結果に含まれません。</p>
      )}
      {current?.result && current.result.hits.length > 0 && (
        <ul className="max-h-56 space-y-1 overflow-auto" aria-label="検索結果">
          {current.result.hits.map((hit) => (
            <li key={`${hit.pageEntryId}-${hit.item.id}`}>
              <button
                type="button"
                onClick={() => onSelect(hit.pageIndex, hit.pageItems, hit.item.id)}
                className="w-full rounded-md bg-gray-50 px-2 py-2 text-left text-xs text-gray-700 hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                <span className="font-medium text-amber-700">{hit.pageIndex + 1}ページ</span>
                <span className="mt-0.5 block break-words">{getSearchSnippet(hit.item.text, current.query)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

import { describe, expect, it, vi } from 'vitest';
import type { RecognizedTextItem } from '../types/contentEdit';
import { getSearchSnippet, MAX_PDF_SEARCH_RESULTS, searchPdfText } from './pdfTextSearch';

const textItem = (text: string, pageIndex = 0, id = 'text'): RecognizedTextItem => ({
  id, kind: 'text', pageIndex, text, x: 0, y: 0, width: 100, height: 12, fontSize: 12,
});

describe('searchPdfText', () => {
  it('uses displayed order, includes copies, and excludes deleted and blank source pages', async () => {
    const readPage = vi.fn(async (index: number) => [textItem('Budget [A].*', index)]);
    const result = await searchPdfText({
      pageEntries: [
        { id: 'second', sourcePageIndex: 1, rotation: 90 },
        { id: 'blank', sourcePageIndex: null, rotation: 0 },
        { id: 'second-copy', sourcePageIndex: 1, rotation: 0 },
      ],
      query: 'BUDGET [a].*', readPage, signal: new AbortController().signal,
    });
    expect(result.hits.map((hit) => [hit.pageEntryId, hit.pageIndex, hit.item.pageIndex])).toEqual([
      ['second', 0, 1], ['second-copy', 2, 1],
    ]);
    expect(readPage.mock.calls.every(([index]) => index === 1)).toBe(true);
    expect(result.hits[0].pageItems).toEqual([textItem('Budget [A].*', 1)]);
  });

  it('caps retained hits but reports the complete match count', async () => {
    const result = await searchPdfText({
      pageEntries: [{ id: 'page', sourcePageIndex: 0, rotation: 0 }],
      query: '日本語',
      readPage: async () => Array.from({ length: 235 }, (_, index) => textItem('日本語検索', 0, `text-${index}`)),
      signal: new AbortController().signal,
    });
    expect(result.totalMatches).toBe(235);
    expect(result.hits).toHaveLength(MAX_PDF_SEARCH_RESULTS);
  });

  it('rejects cancelled in-flight work before exposing stale results or reading another page', async () => {
    const controller = new AbortController();
    const readPage = vi.fn(async () => {
      controller.abort();
      return [textItem('match')];
    });
    await expect(searchPdfText({
      pageEntries: [
        { id: 'first', sourcePageIndex: 0, rotation: 0 },
        { id: 'second', sourcePageIndex: 1, rotation: 0 },
      ],
      query: 'match', readPage, signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(readPage).toHaveBeenCalledTimes(1);
  });

  it('reports unreadable pages and continues searching the remaining pages', async () => {
    const result = await searchPdfText({
      pageEntries: [
        { id: 'broken', sourcePageIndex: 0, rotation: 0 },
        { id: 'readable', sourcePageIndex: 1, rotation: 0 },
      ],
      query: 'match',
      readPage: async (index) => {
        if (index === 0) throw new Error('Unreadable PDF page');
        return [textItem('match', index)];
      },
      signal: new AbortController().signal,
    });
    expect(result.failedPages).toEqual([1]);
    expect(result.totalMatches).toBe(1);
    expect(result.hits[0].pageIndex).toBe(1);
  });

  it('does not read pages for an empty search', async () => {
    const readPage = vi.fn(async () => [textItem('anything')]);
    const result = await searchPdfText({
      pageEntries: [{ id: 'first', sourcePageIndex: 0, rotation: 0 }],
      query: '  ', readPage, signal: new AbortController().signal,
    });
    expect(readPage).not.toHaveBeenCalled();
    expect(result.totalMatches).toBe(0);
  });

  it('keeps matches beyond a long prefix visible in snippets', () => {
    const snippet = getSearchSnippet(`${'x'.repeat(200)}Needle${'z'.repeat(200)}`, 'needle');
    expect(snippet).toContain('Needle');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet.length).toBeLessThan(120);
  });
});

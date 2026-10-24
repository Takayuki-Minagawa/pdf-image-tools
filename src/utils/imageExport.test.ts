import { describe, expect, it } from 'vitest';
import { imageExportFileName, resolveImageExportPageIndices } from './imageExport';

describe('imageExportFileName', () => {
  it('uses the jpg extension for JPEG and sanitizes the base name', () => {
    expect(imageExportFileName({ filename: 'report', format: 'jpeg' }, 3)).toBe('report_page_3.jpg');
    expect(imageExportFileName({ filename: 'a/b', format: 'png' }, 1)).toBe('a_b_page_1.png');
    expect(imageExportFileName({ filename: '  ', format: 'webp' }, 2)).toBe('edited-pages_page_2.webp');
  });
});

describe('resolveImageExportPageIndices', () => {
  const range = { rangeStart: 1, rangeEnd: 1 };

  it('exports every page in "all" mode', () => {
    expect(resolveImageExportPageIndices({ pageMode: 'all', ...range }, new Set([1]), 5)).toBeUndefined();
  });

  it('sorts the selected pages', () => {
    expect(resolveImageExportPageIndices({ pageMode: 'selected', ...range }, new Set([3, 0, 2]), 5)).toEqual([0, 2, 3]);
  });

  it('clamps the range to the document', () => {
    expect(resolveImageExportPageIndices({ pageMode: 'range', rangeStart: 0, rangeEnd: 9 }, new Set(), 3)).toEqual([0, 1, 2]);
  });

  it('rejects an empty range', () => {
    expect(() => resolveImageExportPageIndices({ pageMode: 'range', rangeStart: 4, rangeEnd: 2 }, new Set(), 5)).toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  formatPageSpec,
  parsePageSpec,
  planSplitBefore,
  planSplitEvery,
  planSplitRanges,
  splitPartFilename,
  splitPdf,
} from './pageSpec';

async function blankPdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pageCount; index++) doc.addPage([200 + index, 300]);
  return doc.save();
}

describe('parsePageSpec', () => {
  it('accepts open-ended ranges and Japanese separators', () => {
    expect(parsePageSpec('3-', 5)).toEqual([2, 3, 4]);
    expect(parsePageSpec('-2', 5)).toEqual([0, 1]);
    expect(parsePageSpec('1〜2、5', 5)).toEqual([0, 1, 4]);
    expect(parsePageSpec(' 2 - 3 ', 5)).toEqual([1, 2]);
  });

  it('rejects malformed or out-of-range specs', () => {
    expect(() => parsePageSpec('-', 5)).toThrow(/不正/);
    expect(() => parsePageSpec('4-2', 5)).toThrow(/1〜5/);
    expect(() => parsePageSpec('6-', 5)).toThrow(/1〜5/);
  });
});

describe('formatPageSpec', () => {
  it('collapses consecutive pages into ranges', () => {
    expect(formatPageSpec([0, 1, 2, 4, 6, 7])).toBe('1-3,5,7-8');
    expect(formatPageSpec([3])).toBe('4');
    expect(formatPageSpec([])).toBe('');
  });
});

describe('split planning', () => {
  it('splits every n pages with a remainder file', () => {
    expect(planSplitEvery(5, 2)).toEqual([[0, 1], [2, 3], [4]]);
    expect(planSplitEvery(3, 10)).toEqual([[0, 1, 2]]);
    expect(() => planSplitEvery(3, 0)).toThrow(/1以上/);
  });

  it('splits by ;-separated or newline-separated groups', () => {
    expect(planSplitRanges('1-2; 3\n4-', 5)).toEqual([[0, 1], [2], [3, 4]]);
    expect(() => planSplitRanges(' ; ', 5)).toThrow(/指定/);
  });

  it('splits before the given pages', () => {
    expect(planSplitBefore(6, [3, 1, 3, 0, 9])).toEqual([[0], [1, 2], [3, 4, 5]]);
    expect(planSplitBefore(3, [])).toEqual([[0, 1, 2]]);
  });
});

describe('splitPdf', () => {
  it('creates one PDF per group in order', async () => {
    const parts = await splitPdf(await blankPdf(5), [[0, 1], [4, 2]]);
    expect(parts.map((part) => part.label)).toEqual(['1-2', '5,3']);
    const docs = await Promise.all(parts.map((part) => PDFDocument.load(part.bytes)));
    expect(docs.map((doc) => doc.getPageCount())).toEqual([2, 2]);
    expect(docs[1].getPage(0).getWidth()).toBe(204);
  });

  it('names files with zero-padded sequence numbers', () => {
    expect(splitPartFilename('report', { label: '1-3' }, 0, 3)).toBe('report_01_p1-3.pdf');
    expect(splitPartFilename('report', { label: '5,7' }, 99, 120)).toBe('report_100_p5_7.pdf');
  });
});

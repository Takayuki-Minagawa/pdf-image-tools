import { describe, expect, it } from 'vitest';
import {
  classifyPdfLoadError,
  interleavePages,
  moveItem,
  regroupPagesByFile,
  sanitizePdfFilename,
} from './pdfMergeUtils';

const page = (id: string, fileId: string) => ({ id, fileId });

describe('PDF merge ordering', () => {
  it('moves one item without mutating the input', () => {
    const input = ['a', 'b', 'c'];
    expect(moveItem(input, 0, 2)).toEqual(['b', 'c', 'a']);
    expect(input).toEqual(['a', 'b', 'c']);
  });

  it('regroups pages using file order while preserving order inside each file', () => {
    const pages = [page('b2', 'b'), page('a1', 'a'), page('b1', 'b'), page('a2', 'a')];
    expect(regroupPagesByFile(pages, ['a', 'b']).map(({ id }) => id)).toEqual([
      'a1',
      'a2',
      'b2',
      'b1',
    ]);
  });

  it('interleaves files and handles different page counts', () => {
    const pages = [page('a1', 'a'), page('a2', 'a'), page('a3', 'a'), page('b1', 'b')];
    expect(interleavePages(pages, ['a', 'b']).map(({ id }) => id)).toEqual([
      'a1',
      'b1',
      'a2',
      'a3',
    ]);
  });
});

describe('PDF merge validation helpers', () => {
  it('normalizes safe output names', () => {
    expect(sanitizePdfFilename(' report:final.PDF ')).toBe('report_final.pdf');
    expect(sanitizePdfFilename('   ')).toBe('merged.pdf');
  });

  it('classifies password and corruption errors', () => {
    expect(classifyPdfLoadError(new Error('PasswordException')).kind).toBe('encrypted');
    expect(classifyPdfLoadError(new Error('InvalidPDFException')).kind).toBe('corrupt');
    expect(classifyPdfLoadError(new Error('Worker was destroyed')).kind).toBe('cancelled');
  });
});

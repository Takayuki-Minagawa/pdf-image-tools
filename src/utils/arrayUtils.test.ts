import { describe, expect, it } from 'vitest';
import { moveItem, pageRangeToIndices } from './arrayUtils';

describe('moveItem', () => {
  it('moves one item without mutating the input', () => {
    const input = ['a', 'b', 'c'];
    expect(moveItem(input, 0, 2)).toEqual(['b', 'c', 'a']);
    expect(input).toEqual(['a', 'b', 'c']);
  });

  it('returns an unchanged copy for out-of-range indices', () => {
    const input = ['a', 'b'];
    const result = moveItem(input, 0, 5);
    expect(result).toEqual(['a', 'b']);
    expect(result).not.toBe(input);
  });
});

describe('pageRangeToIndices', () => {
  it('converts an inclusive 1-based range to 0-based indices', () => {
    expect(pageRangeToIndices(2, 4)).toEqual([1, 2, 3]);
    expect(pageRangeToIndices(3, 3)).toEqual([2]);
  });

  it('returns an empty list for a reversed range', () => {
    expect(pageRangeToIndices(4, 2)).toEqual([]);
  });
});

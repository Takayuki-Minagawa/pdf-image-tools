import { describe, expect, it } from 'vitest';
import { selectPagesByParity, toggleSelectAllPages, togglePageInSelection } from './pageSelection';

const sorted = (set: Set<number>) => [...set].sort((a, b) => a - b);

describe('togglePageInSelection', () => {
  it('toggles a single page', () => {
    expect(sorted(togglePageInSelection(new Set([1]), 2, null, false))).toEqual([1, 2]);
    expect(sorted(togglePageInSelection(new Set([1, 2]), 2, 1, false))).toEqual([1]);
  });

  it('adds the range from the anchor when extending', () => {
    expect(sorted(togglePageInSelection(new Set([0]), 4, 2, true))).toEqual([0, 2, 3, 4]);
    expect(sorted(togglePageInSelection(new Set(), 1, 3, true))).toEqual([1, 2, 3]);
  });

  it('falls back to a toggle when extending without an anchor', () => {
    expect(sorted(togglePageInSelection(new Set(), 2, null, true))).toEqual([2]);
  });

  it('does not mutate the input', () => {
    const input = new Set([1]);
    togglePageInSelection(input, 1, null, false);
    expect(sorted(input)).toEqual([1]);
  });
});

describe('toggleSelectAllPages', () => {
  it('selects every page unless all are already selected', () => {
    expect(sorted(toggleSelectAllPages(new Set([0]), 3))).toEqual([0, 1, 2]);
    expect(sorted(toggleSelectAllPages(new Set([0, 1, 2]), 3))).toEqual([]);
  });
});

describe('selectPagesByParity', () => {
  it('uses 1-based page numbers', () => {
    expect(sorted(selectPagesByParity(5, 'odd'))).toEqual([0, 2, 4]);
    expect(sorted(selectPagesByParity(5, 'even'))).toEqual([1, 3]);
  });
});

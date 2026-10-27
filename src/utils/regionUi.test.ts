import { describe, expect, it } from 'vitest';
import { mismatchedRegionPages, mmToPoint, parseRegionPages, pointToMm } from './regionUi';

describe('secure region page selection', () => {
  it('normalizes ranges without losing intended pages', () => {
    expect(parseRegionPages('3, 1-2,2', 3)).toEqual([1, 2, 3]);
    expect(parseRegionPages('all', 2)).toEqual([1, 2]);
  });
  it.each(['', '0', '1-4', '3-2', '1,', '1.5', '1x', '-1'])('rejects ambiguous or invalid selection %s', (value) => {
    expect(() => parseRegionPages(value, 3)).toThrow();
  });
  it('never accepts a rotated paper or missing target as a template match', () => {
    const region = { id: 'r', pages: [1, 2, 3], x: 0, y: 0, width: 10, height: 10, pageWidth: 600, pageHeight: 800, fill: 'white' as const };
    expect(mismatchedRegionPages(region, [
      { pageNumber: 1, width: 600, height: 800, rotation: 0, userUnit: 1 },
      { pageNumber: 2, width: 800, height: 600, rotation: 90, userUnit: 1 },
    ])).toEqual([2, 3]);
    expect(pointToMm(mmToPoint(210))).toBeCloseTo(210, 10);
  });
});

import type { RegionPageInfo, RegionRedactionRegion } from '../types/regionRedaction';

/** Strict 1-based page selection; never silently truncate an out-of-range page. */
export function parseRegionPages(value: string, pageCount: number): number[] {
  if (value.trim() === 'all') return Array.from({ length: pageCount }, (_, index) => index + 1);
  if (!value.trim()) throw new Error('対象ページを指定してください（例: 1-3,5）。');
  const pages = new Set<number>();
  for (const part of value.split(',')) {
    const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error('対象ページは 1-3,5 または all の形式で指定してください。');
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (start < 1 || end < start || end > pageCount) throw new Error(`対象ページは 1 から ${pageCount} の範囲で指定してください。`);
    for (let page = start; page <= end; page++) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}

export function mismatchedRegionPages(region: RegionRedactionRegion, pages: RegionPageInfo[]): number[] {
  return region.pages.filter((pageNumber) => {
    const page = pages.find((item) => item.pageNumber === pageNumber);
    return !page || Math.abs(page.width - region.pageWidth) > 0.01 || Math.abs(page.height - region.pageHeight) > 0.01;
  });
}

export const pointToMm = (value: number) => value * 25.4 / 72;
export const mmToPoint = (value: number) => value * 72 / 25.4;

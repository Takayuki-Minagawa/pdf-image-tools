import { describe, expect, it } from 'vitest';
import { DEFAULT_IMAGES_TO_PDF_OPTIONS } from './imagesToPdf';
import type { ImagesToPdfOptions } from './imagesToPdf';
import { clampNumber, sanitizeImagesToPdfOptions } from './imageToPdfSettings';

describe('sanitizeImagesToPdfOptions', () => {
  it('fills missing fields with defaults', () => {
    expect(sanitizeImagesToPdfOptions({})).toEqual(DEFAULT_IMAGES_TO_PDF_OPTIONS);
  });

  it('keeps valid stored values', () => {
    const stored: ImagesToPdfOptions = {
      pageSize: 'a4',
      orientation: 'landscape',
      margin: 10,
      fit: 'cover',
      backgroundColor: '#112233',
      qualityPreset: 'compact',
      jpegQuality: 0.6,
      imageFormat: 'jpeg',
    };
    expect(sanitizeImagesToPdfOptions(stored)).toEqual(stored);
  });

  it('replaces invalid values and clamps numbers', () => {
    const result = sanitizeImagesToPdfOptions({
      pageSize: 'tabloid',
      backgroundColor: 'red',
      margin: 999,
      jpegQuality: 0.01,
    } as unknown as Partial<ImagesToPdfOptions>);
    expect(result.pageSize).toBe(DEFAULT_IMAGES_TO_PDF_OPTIONS.pageSize);
    expect(result.backgroundColor).toBe(DEFAULT_IMAGES_TO_PDF_OPTIONS.backgroundColor);
    expect(result.margin).toBe(50);
    expect(result.jpegQuality).toBe(0.3);
  });
});

describe('clampNumber', () => {
  it('falls back to the minimum for non-finite input', () => {
    expect(clampNumber(Number.NaN, 2, 5)).toBe(2);
    expect(clampNumber(7, 2, 5)).toBe(5);
  });
});

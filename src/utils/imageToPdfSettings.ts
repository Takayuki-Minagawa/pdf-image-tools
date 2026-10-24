import { DEFAULT_IMAGES_TO_PDF_OPTIONS } from './imagesToPdf';
import type { ImagesToPdfOptions } from './imagesToPdf';

export const IMAGE_TO_PDF_SETTINGS_STORAGE_KEY = 'pdf-image-tools:image-to-pdf-settings:v1';
export const IMAGE_TO_PDF_OUTPUT_NAME_STORAGE_KEY = 'pdf-image-tools:image-to-pdf-output-name:v1';

export function clampNumber(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function isOneOf<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === 'string' && choices.includes(value as T);
}

/** 保存済みの設定値を検証し、不正な項目だけ既定値へ戻す。 */
export function sanitizeImagesToPdfOptions(stored: Partial<ImagesToPdfOptions>): ImagesToPdfOptions {
  const defaults = DEFAULT_IMAGES_TO_PDF_OPTIONS;
  return {
    pageSize: isOneOf(stored.pageSize, ['original', 'a4', 'a3', 'b5', 'letter'])
      ? stored.pageSize : defaults.pageSize,
    orientation: isOneOf(stored.orientation, ['auto', 'portrait', 'landscape'])
      ? stored.orientation : defaults.orientation,
    margin: clampNumber(stored.margin ?? defaults.margin, 0, 50),
    fit: isOneOf(stored.fit, ['contain', 'cover']) ? stored.fit : defaults.fit,
    backgroundColor: typeof stored.backgroundColor === 'string' && /^#[0-9a-f]{6}$/i.test(stored.backgroundColor)
      ? stored.backgroundColor : defaults.backgroundColor,
    qualityPreset: isOneOf(stored.qualityPreset, ['high', 'standard', 'compact'])
      ? stored.qualityPreset : defaults.qualityPreset,
    jpegQuality: clampNumber(stored.jpegQuality ?? defaults.jpegQuality, 0.3, 1),
    imageFormat: isOneOf(stored.imageFormat, ['auto', 'jpeg', 'png'])
      ? stored.imageFormat : defaults.imageFormat,
  };
}

export function readStoredImagesToPdfOptions(): ImagesToPdfOptions {
  if (typeof localStorage === 'undefined') return DEFAULT_IMAGES_TO_PDF_OPTIONS;
  try {
    const stored = JSON.parse(localStorage.getItem(IMAGE_TO_PDF_SETTINGS_STORAGE_KEY) ?? '{}') as Partial<ImagesToPdfOptions>;
    return sanitizeImagesToPdfOptions(stored);
  } catch {
    return DEFAULT_IMAGES_TO_PDF_OPTIONS;
  }
}

export function readStoredOutputName(fallback: string): string {
  if (typeof localStorage === 'undefined') return fallback;
  return localStorage.getItem(IMAGE_TO_PDF_OUTPUT_NAME_STORAGE_KEY) ?? fallback;
}

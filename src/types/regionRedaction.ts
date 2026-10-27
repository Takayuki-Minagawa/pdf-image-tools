/** Rectangles use the displayed CropBox, top-left origin, physical PDF points. */
export interface RegionRedactionRegion {
  id: string;
  /** One-based page numbers. A template must explicitly name its target pages. */
  pages: number[];
  x: number;
  y: number;
  width: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
  fill: 'white' | 'black';
}

export interface RegionRedactionSettings {
  version: 1;
  dpi: number;
  regions: RegionRedactionRegion[];
}

export interface RegionPageInfo {
  pageNumber: number;
  width: number;
  height: number;
  rotation: number;
  userUnit: number;
}

export const REGION_REDACTION_LIMITS = {
  minDpi: 36,
  maxDpi: 600,
  maxPagePixels: 40_000_000,
  maxTotalPixels: 150_000_000,
  maxCanvasSide: 16_384,
  maxPages: 200,
  maxInputBytes: 128 * 1024 * 1024,
  maxOutputBytes: 256 * 1024 * 1024,
  maxEstimatedBytes: 1024 * 1024 * 1024,
} as const;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Strict parsing keeps coordinates, source text and arbitrary metadata out of templates. */
export function parseRegionRedactionSettings(value: unknown): RegionRedactionSettings {
  if (!record(value) || value.version !== 1) throw new Error('領域除去の方式は version 1 を指定してください');
  if (typeof value.dpi !== 'number' || !Number.isInteger(value.dpi) || value.dpi < REGION_REDACTION_LIMITS.minDpi || value.dpi > REGION_REDACTION_LIMITS.maxDpi) {
    throw new Error(`DPI は ${REGION_REDACTION_LIMITS.minDpi}〜${REGION_REDACTION_LIMITS.maxDpi} の整数を指定してください`);
  }
  if (!Array.isArray(value.regions) || value.regions.length > 1000) throw new Error('領域は 1000 件以下の配列を指定してください');
  const ids = new Set<string>();
  const regions = value.regions.map((entry, index): RegionRedactionRegion => {
    const label = `領域 ${index + 1}`;
    if (!record(entry)) throw new Error(`${label} の形式が正しくありません`);
    if (!Array.isArray(entry.pages) || entry.pages.length === 0 || entry.pages.some((page) => typeof page !== 'number' || !Number.isInteger(page) || page < 1) || new Set(entry.pages).size !== entry.pages.length) {
      throw new Error(`${label} の対象ページは重複のない 1 以上の整数で指定してください`);
    }
    if (entry.fill !== 'white' && entry.fill !== 'black') throw new Error(`${label} の色は white または black を指定してください`);
    const numeric = (name: string, positive: boolean) => {
      const n = entry[name];
      if (typeof n !== 'number' || !Number.isFinite(n) || (positive ? n <= 0 : n < 0)) throw new Error(`${label} の座標・寸法が正しくありません`);
      return n;
    };
    // IDs are local control identifiers, never copied from source strings.
    const id = typeof entry.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(entry.id) ? entry.id : `region-${index + 1}`;
    if (ids.has(id)) throw new Error('領域 ID が重複しています');
    ids.add(id);
    const region: RegionRedactionRegion = { id, pages: [...entry.pages] as number[], x: numeric('x', false), y: numeric('y', false), width: numeric('width', true), height: numeric('height', true), pageWidth: numeric('pageWidth', true), pageHeight: numeric('pageHeight', true), fill: entry.fill };
    if (region.x + region.width > region.pageWidth + 0.001 || region.y + region.height > region.pageHeight + 0.001) throw new Error(`${label} が用紙の範囲を超えています`);
    return region;
  });
  return { version: 1, dpi: value.dpi, regions };
}

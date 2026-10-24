/**
 * ページ指定文字列の解析と、PDF分割の区切り計画。ブラウザ版と CLI で共有する。
 */
import { extractPdfPageIndices } from './pdfEditor';

/**
 * `1-3,5,8` 形式（1始まり）を 0 始まりのページインデックス配列へ変換する。
 * `9-` のように終了を省略すると最終ページまで、`-3` は先頭から3ページ目までを表す。
 */
export function parsePageSpec(spec: string, pageCount: number): number[] {
  const result: number[] = [];
  for (const part of spec.split(/[,、]/).map((value) => value.trim()).filter(Boolean)) {
    const match = /^(\d*)\s*(?:(-|〜|~)\s*(\d*))?$/.exec(part);
    if (!match || (!match[1] && !match[3])) throw new Error(`ページ指定が不正です: ${part}`);
    const start = match[1] ? Number(match[1]) : 1;
    const end = match[3] ? Number(match[3]) : match[2] ? pageCount : start;
    if (start < 1 || end < start || end > pageCount) {
      throw new Error(`ページ範囲 ${part} は 1〜${pageCount} の外です`);
    }
    for (let page = start; page <= end; page++) result.push(page - 1);
  }
  if (result.length === 0) throw new Error('ページを1つ以上指定してください');
  return result;
}

/** 0 始まりのページインデックス配列を `1-3,5` 形式（1始まり）へ戻す。 */
export function formatPageSpec(pageIndices: number[]): string {
  const parts: string[] = [];
  let index = 0;
  while (index < pageIndices.length) {
    const start = pageIndices[index];
    let end = start;
    while (index + 1 < pageIndices.length && pageIndices[index + 1] === end + 1) {
      end = pageIndices[++index];
    }
    parts.push(start === end ? `${start + 1}` : `${start + 1}-${end + 1}`);
    index++;
  }
  return parts.join(',');
}

/** n ページごとに区切る（最後のファイルは端数ページ）。 */
export function planSplitEvery(pageCount: number, pagesPerFile: number): number[][] {
  if (!Number.isInteger(pagesPerFile) || pagesPerFile < 1) {
    throw new Error('分割するページ数は1以上の整数を指定してください');
  }
  const groups: number[][] = [];
  for (let start = 0; start < pageCount; start += pagesPerFile) {
    groups.push(Array.from({ length: Math.min(pagesPerFile, pageCount - start) }, (_, offset) => start + offset));
  }
  return groups;
}

/**
 * `1-3; 4-8; 9-` のように `;` または改行で区切った各グループを1ファイルとして扱う。
 * 各グループの中は parsePageSpec と同じ書式。
 */
export function planSplitRanges(spec: string, pageCount: number): number[][] {
  const groups = spec
    .split(/[;\n；]/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((group) => parsePageSpec(group, pageCount));
  if (groups.length === 0) throw new Error('分割するページ範囲を指定してください');
  return groups;
}

/** 指定したページの直前で区切る（例: [3, 7] → 1-2 / 3-6 / 7-最後）。0 始まり。 */
export function planSplitBefore(pageCount: number, breakIndices: number[]): number[][] {
  const breaks = [...new Set(breakIndices)].filter((index) => index > 0 && index < pageCount).sort((a, b) => a - b);
  const boundaries = [0, ...breaks, pageCount];
  return boundaries.slice(0, -1).map((start, index) =>
    Array.from({ length: boundaries[index + 1] - start }, (_, offset) => start + offset),
  );
}

export interface SplitPdfPart {
  /** 1始まりのページ指定（ファイル名用、例: `1-3`） */
  label: string;
  pageIndices: number[];
  bytes: Uint8Array;
}

/** ページグループごとに新しいPDFを作る。 */
export async function splitPdf(
  pdfBytes: ArrayBuffer | Uint8Array,
  groups: number[][],
  onProgress?: (completed: number, total: number) => void,
): Promise<SplitPdfPart[]> {
  if (groups.length === 0) throw new Error('分割するページ範囲を指定してください');
  const parts: SplitPdfPart[] = [];
  for (const pageIndices of groups) {
    parts.push({
      label: formatPageSpec(pageIndices),
      pageIndices,
      bytes: await extractPdfPageIndices(pdfBytes, pageIndices),
    });
    onProgress?.(parts.length, groups.length);
  }
  return parts;
}

/** 分割ファイル名（`report_01_p1-3.pdf`）。並び順が崩れないよう連番を桁揃えする。 */
export function splitPartFilename(baseName: string, part: Pick<SplitPdfPart, 'label'>, index: number, total: number): string {
  const digits = String(total).length;
  const pageLabel = part.label.replace(/,/g, '_').slice(0, 40);
  return `${baseName}_${String(index + 1).padStart(Math.max(2, digits), '0')}_p${pageLabel}.pdf`;
}
